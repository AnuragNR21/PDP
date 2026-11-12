from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Any
from uuid import uuid4

from features.structure.domain.models import StructureImportRow
from shared.model_config import HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL
from shared import lifecycle
from shared.db import get_connection, utc_now_iso
from features.structure.service.support_domain_instance_relationship_transfer import (
    SD_LINK_OBJECT as _SD_LINK_OBJECT,
    SupportDomainInstanceRelationshipTransfer,
)

_STAGE_TTL = timedelta(minutes=20)
_STAGE_LOCK = Lock()
_STAGE_STORE: dict[str, "_StageEntry"] = {}

_HIERARCHY_OBJECT = "hierarchy_model_node_instance"
_SUPPORT_OBJECT = "support_domain_model_element_instance"
# SD element relationships (support_domain_relationship table) and cross-model relationships
# share this object_type. Only element relationships are importable via the UI.
_REL_OBJECT = "support_domain_relationship_instance"

_LOCKED_FIELDS = {
    "status",
    "sort_order",
    "created_at",
    "updated_at",
}


@dataclass
class _StageEntry:
    created_at: datetime
    accepted_rows: list[dict[str, Any]]
    result_rows: list[StructureImportRow]


class _StageStore:
    @staticmethod
    def _purge_expired() -> None:
        now = datetime.now(UTC)
        for key in list(_STAGE_STORE.keys()):
            if now - _STAGE_STORE[key].created_at > _STAGE_TTL:
                del _STAGE_STORE[key]

    @classmethod
    def put(cls, accepted_rows: list[dict[str, Any]], result_rows: list[StructureImportRow]) -> str:
        with _STAGE_LOCK:
            cls._purge_expired()
            stage_id = f"stage_{uuid4().hex}"
            _STAGE_STORE[stage_id] = _StageEntry(
                created_at=datetime.now(UTC),
                accepted_rows=accepted_rows,
                result_rows=result_rows,
            )
            return stage_id

    @classmethod
    def pop(cls, stage_id: str) -> _StageEntry | None:
        with _STAGE_LOCK:
            cls._purge_expired()
            return _STAGE_STORE.pop(stage_id, None)


class StructureImportService:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def validate(self, payload: dict[str, Any]) -> tuple[str, dict[str, Any], list[StructureImportRow]]:
        rows: list[StructureImportRow] = []
        accepted_rows: list[dict[str, Any]] = []

        hierarchy_rows = payload.get("load_hierarchy_node_instances") or []
        support_rows = payload.get("load_support_domain_elements") or []
        support_element_relationship_rows = payload.get("load_support_domain_element_relationships") or []
        relationship_rows = payload.get("load_support_domain_relationships") or []
        # Links between SD element instances. Validated after the instance rows, so a
        # link may point at an instance the same file creates.
        sd_link_rows = payload.get("load_support_domain_element_instance_relationships") or []

        hierarchy_external_ids = self._duplicate_external_ids(hierarchy_rows)
        support_external_ids = self._duplicate_external_ids(support_rows)
        support_element_relationship_keys = self._duplicate_support_relationship_keys(support_element_relationship_rows)
        relationship_external_ids = self._duplicate_external_ids(relationship_rows)

        with get_connection(self._db_url) as conn:
            for index, raw in enumerate(hierarchy_rows, start=1):
                result, staged = self._validate_hierarchy_row(
                    conn,
                    index,
                    raw,
                    hierarchy_external_ids,
                )
                rows.append(result)
                if staged is not None:
                    accepted_rows.append(staged)

            for index, raw in enumerate(support_rows, start=1):
                result, staged = self._validate_support_row(
                    conn,
                    index,
                    raw,
                    support_external_ids,
                )
                rows.append(result)
                if staged is not None:
                    accepted_rows.append(staged)

            if sd_link_rows:
                staged_support = [row for row in accepted_rows if row["object_type"] == _SUPPORT_OBJECT]
                # Row numbers continue after the instance rows: in an exported CSV the
                # relationship rows follow the instances, so this is their data-row number.
                for result, staged in self._sd_links().validate_rows(conn, sd_link_rows, staged_support, len(support_rows)):
                    rows.append(result)
                    if staged is not None:
                        accepted_rows.append(staged)

            for index, raw in enumerate(support_element_relationship_rows, start=1):
                result, staged = self._validate_support_element_relationship_row(
                    conn,
                    index,
                    raw,
                    support_element_relationship_keys,
                )
                rows.append(result)
                if staged is not None:
                    accepted_rows.append(staged)

            for index, raw in enumerate(relationship_rows, start=1):
                result, staged = self._validate_relationship_row(
                    conn,
                    index,
                    raw,
                    relationship_external_ids,
                )
                rows.append(result)
                if staged is not None:
                    accepted_rows.append(staged)

        stage_id = _StageStore.put(accepted_rows, rows)
        accepted = sum(1 for row in rows if row.status == "accepted")
        rejected = len(rows) - accepted
        warnings = sum(len(row.warnings) for row in rows)
        summary = {
            "total": len(rows),
            "accepted": accepted,
            "rejected": rejected,
            "warnings": warnings,
        }
        return stage_id, summary, rows

    def commit(self, stage_id: str, selected_row_numbers: list[int] | None = None) -> tuple[int, int, list[StructureImportRow]]:
        stage = _StageStore.pop(stage_id)
        if stage is None:
            raise ValueError("Stage ID is invalid or has expired.")

        committed = 0
        failed = 0
        results: list[StructureImportRow] = []

        selected = set(selected_row_numbers or [])
        rows_to_commit = (
            [row for row in stage.accepted_rows if int(row.get("row_number", -1)) in selected]
            if selected_row_numbers is not None
            else stage.accepted_rows
        )

        # Instances before the relationships that refer to them.
        rows_to_commit = sorted(rows_to_commit, key=lambda row: row["object_type"] == _SD_LINK_OBJECT)

        with get_connection(self._db_url) as conn:
            for staged in rows_to_commit:
                try:
                    object_type = staged["object_type"]
                    action = staged["action"]
                    data = staged["data"]
                    if object_type == _HIERARCHY_OBJECT:
                        self._commit_hierarchy(conn, action, data)
                    elif object_type == _SUPPORT_OBJECT:
                        self._commit_support(conn, action, data)
                    elif object_type == _SD_LINK_OBJECT:
                        self._sd_links().commit(conn, action, data)
                    elif object_type == _REL_OBJECT:
                        self._commit_support_element_relationship(conn, action, data)
                    else:
                        self._commit_relationship(conn, action, data)
                    committed += 1
                    results.append(
                        StructureImportRow(
                            row_number=int(staged["row_number"]),
                            object_type=object_type,
                            action=action,
                            status="accepted",
                            code="COMMITTED",
                            message="Row committed successfully.",
                            warnings=list(staged.get("warnings") or []),
                            key=staged.get("key"),
                        )
                    )
                except Exception as exc:  # pragma: no cover - defensive handling for runtime data races
                    failed += 1
                    results.append(
                        StructureImportRow(
                            row_number=int(staged["row_number"]),
                            object_type=staged["object_type"],
                            action=staged["action"],
                            status="rejected",
                            code="COMMIT_FAILED",
                            message=f"Commit failed: {exc}",
                            warnings=list(staged.get("warnings") or []),
                            key=staged.get("key"),
                        )
                    )

        return committed, failed, results

    def _sd_links(self) -> SupportDomainInstanceRelationshipTransfer:
        return SupportDomainInstanceRelationshipTransfer(self._normalized, self._action)

    def _duplicate_external_ids(self, rows: list[dict[str, Any]]) -> set[str]:
        seen: set[str] = set()
        duplicates: set[str] = set()
        for raw in rows:
            external_id = self._normalized(raw.get("external_id"))
            if external_id is None:
                continue
            if external_id in seen:
                duplicates.add(external_id)
            seen.add(external_id)
        return duplicates

    def _duplicate_support_relationship_keys(self, rows: list[dict[str, Any]]) -> set[tuple[str, str, str, str]]:
        seen: set[tuple[str, str, str, str]] = set()
        duplicates: set[tuple[str, str, str, str]] = set()
        for raw in rows:
            model_id = self._normalized(raw.get("support_domain_model_id"))
            source_element_type_id = self._normalized(raw.get("source_element_type_id"))
            target_element_type_id = self._normalized(raw.get("target_element_type_id"))
            relationship_type = self._normalized(raw.get("relationship_type"))
            if None in (model_id, source_element_type_id, target_element_type_id, relationship_type):
                continue
            key = (model_id, source_element_type_id, target_element_type_id, relationship_type)
            if key in seen:
                duplicates.add(key)
            seen.add(key)
        return duplicates

    def _validate_hierarchy_row(
        self,
        conn,
        row_number: int,
        raw: dict[str, Any],
        duplicate_external_ids: set[str],
    ) -> tuple[StructureImportRow, dict[str, Any] | None]:
        action = self._action(raw)
        model_id = self._normalized(raw.get("model_id"))
        node_type_id = self._normalized(raw.get("node_type_id"))
        name = self._normalized(raw.get("name"))
        parent_pdp_id = self._normalized(raw.get("parent_pdp_system_id"))
        parent_external_id = self._normalized(raw.get("parent_external_id"))
        pdp_id = self._normalized(raw.get("pdp_system_id"))
        external_id = self._normalized(raw.get("external_id"))
        warnings = self._collect_locked_field_warnings(raw)

        if action is None:
            return self._rejected(row_number, _HIERARCHY_OBJECT, "CREATE", "INVALID_ACTION", "Action must be CREATE or UPSERT."), None
        if model_id is None or node_type_id is None or name is None:
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "MISSING_REQUIRED", "model_id, node_type_id, and name are required."), None
        if external_id in duplicate_external_ids:
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "DUPLICATE_EXTERNAL_ID", "duplicate External ID within the import file."), None

        existing_by_id = self._fetch_hierarchy_by_id(conn, pdp_id) if pdp_id else None
        existing_by_external = self._fetch_hierarchy_by_external_id(conn, external_id) if external_id else None

        if existing_by_id is not None and existing_by_external is not None and existing_by_id["node_instance_id"] != existing_by_external["node_instance_id"]:
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "MISMATCHED_KEYS", "PDP system ID and External ID resolve to different records."), None

        existing = existing_by_id or existing_by_external

        if action == "CREATE" and existing is not None:
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "CREATE_CONFLICT", "External ID or PDP system ID already exists for Action=CREATE."), None
        if action == "UPSERT" and existing is None:
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "UPSERT_NOT_FOUND", "UPSERT requires a valid PDP system ID or External ID resolving to an existing record."), None

        if not self._exists(conn, "SELECT 1 FROM hierarchy_model WHERE model_id = %s", (model_id,)):
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "MODEL_NOT_FOUND", "Referenced hierarchy model does not exist."), None
        if not self._exists(
            conn,
            "SELECT 1 FROM hierarchy_model_node_type WHERE node_type_id = %s AND model_id = %s",
            (node_type_id, model_id),
        ):
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "NODE_TYPE_NOT_FOUND", "Referenced hierarchy model node type does not exist for model."), None
        if action == "CREATE":
            problem = lifecycle.instantiate_problem(conn, "node", model_id, node_type_id)
            if problem:
                return self._rejected(row_number, _HIERARCHY_OBJECT, action, "DEFINITION_NOT_ACTIVE", problem), None

        parent_id, parent_error = self._resolve_hierarchy_parent(conn, parent_pdp_id, parent_external_id)
        if parent_error:
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "PARENT_RESOLUTION_FAILED", parent_error), None

        if action == "CREATE" and parent_id is None:
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "MISSING_PARENT", "CREATE requires a valid parent reference."), None

        if parent_id and self._would_cycle(conn, existing["node_instance_id"] if existing else None, parent_id):
            return self._rejected(row_number, _HIERARCHY_OBJECT, action, "CIRCULAR_HIERARCHY", "Import would create a circular hierarchy."), None

        if parent_id is not None:
            parent_row = self._fetch_hierarchy_by_id(conn, parent_id)
            if parent_row is None:
                return self._rejected(row_number, _HIERARCHY_OBJECT, action, "PARENT_NOT_FOUND", "Parent reference could not be resolved."), None
            if parent_row["model_id"] != model_id:
                return self._rejected(row_number, _HIERARCHY_OBJECT, action, "CROSS_MODEL_PARENT", "Parent belongs to a different hierarchy model."), None

            parent_rule_ok = self._exists(
                conn,
                """
                SELECT 1
                FROM structural_rule sr
                JOIN hierarchy_model_node_instance p ON p.node_instance_id = %s
                WHERE sr.model_id = %s
                  AND sr.parent_node_type_id = p.node_type_id
                  AND sr.child_node_type_id = %s
                  AND sr.relationship_kind IN ('parent_child', 'recursive')
                  AND sr.status = 'active'
                """,
                (parent_id, model_id, node_type_id),
            )
            if not parent_rule_ok:
                return self._rejected(row_number, _HIERARCHY_OBJECT, action, "RULE_NOT_ALLOWED", "Parent-child rule does not permit this node type combination."), None

        key = pdp_id or external_id or (existing["node_instance_id"] if existing else None)
        staged = {
            "row_number": row_number,
            "object_type": _HIERARCHY_OBJECT,
            "action": action,
            "key": key,
            "warnings": warnings,
            "data": {
                "node_instance_id": existing["node_instance_id"] if existing else f"node_{uuid4().hex[:12]}",
                "model_id": model_id,
                "node_type_id": node_type_id,
                "name": name,
                "description": self._normalized(raw.get("description")),
                "external_id": external_id,
                "parent_node_id": parent_id if action == "CREATE" or parent_id is not None else existing.get("parent_node_id") if existing else None,
            },
        }

        message = "Validated for commit."
        if warnings:
            message = "Validated with warnings; locked/system fields will be ignored."
        return (
            StructureImportRow(
                row_number=row_number,
                object_type=_HIERARCHY_OBJECT,
                action=action,
                status="accepted",
                code="VALIDATED",
                message=message,
                warnings=warnings,
                key=key,
            ),
            staged,
        )

    def _validate_support_row(
        self,
        conn,
        row_number: int,
        raw: dict[str, Any],
        duplicate_external_ids: set[str],
    ) -> tuple[StructureImportRow, dict[str, Any] | None]:
        action = self._action(raw)
        model_id = self._normalized(raw.get("support_domain_model_id"))
        element_type_id = self._normalized(raw.get("element_type_id"))
        name = self._normalized(raw.get("name"))
        pdp_id = self._normalized(raw.get("pdp_system_id"))
        external_id = self._normalized(raw.get("external_id"))
        warnings = self._collect_locked_field_warnings(raw)

        if action is None:
            return self._rejected(row_number, _SUPPORT_OBJECT, "CREATE", "INVALID_ACTION", "Action must be CREATE or UPSERT."), None
        if model_id is None or element_type_id is None or name is None:
            return self._rejected(row_number, _SUPPORT_OBJECT, action, "MISSING_REQUIRED", "support_domain_model_id, element_type_id, and name are required."), None
        if external_id in duplicate_external_ids:
            return self._rejected(row_number, _SUPPORT_OBJECT, action, "DUPLICATE_EXTERNAL_ID", "duplicate External ID within the import file."), None

        existing_by_id = self._fetch_support_by_id(conn, pdp_id) if pdp_id else None
        existing_by_external = self._fetch_support_by_external_id(conn, external_id) if external_id else None
        if existing_by_id is not None and existing_by_external is not None and existing_by_id["instance_id"] != existing_by_external["instance_id"]:
            return self._rejected(row_number, _SUPPORT_OBJECT, action, "MISMATCHED_KEYS", "PDP system ID and External ID resolve to different records."), None

        existing = existing_by_id or existing_by_external
        if action == "CREATE" and existing is not None:
            return self._rejected(row_number, _SUPPORT_OBJECT, action, "CREATE_CONFLICT", "External ID or PDP system ID already exists for Action=CREATE."), None
        if action == "UPSERT" and existing is None:
            return self._rejected(row_number, _SUPPORT_OBJECT, action, "UPSERT_NOT_FOUND", "UPSERT requires a valid PDP system ID or External ID resolving to an existing record."), None

        if not self._exists(conn, "SELECT 1 FROM support_domain_model WHERE support_domain_model_id = %s", (model_id,)):
            return self._rejected(row_number, _SUPPORT_OBJECT, action, "MODEL_NOT_FOUND", "Referenced support domain model does not exist."), None
        if not self._exists(
            conn,
            "SELECT 1 FROM support_domain_element_type WHERE element_id = %s AND support_domain_model_id = %s",
            (element_type_id, model_id),
        ):
            return self._rejected(row_number, _SUPPORT_OBJECT, action, "ELEMENT_TYPE_NOT_FOUND", "Referenced support domain model element type does not exist for model."), None
        if action == "CREATE":
            problem = lifecycle.instantiate_problem(conn, "element", model_id, element_type_id)
            if problem:
                return self._rejected(row_number, _SUPPORT_OBJECT, action, "DEFINITION_NOT_ACTIVE", problem), None

        key = pdp_id or external_id or (existing["instance_id"] if existing else None)
        staged = {
            "row_number": row_number,
            "object_type": _SUPPORT_OBJECT,
            "action": action,
            "key": key,
            "warnings": warnings,
            "data": {
                "instance_id": existing["instance_id"] if existing else str(uuid4()),
                "support_domain_model_id": model_id,
                "element_type_id": element_type_id,
                "name": name,
                "description": self._normalized(raw.get("description")),
                "external_id": external_id,
            },
        }

        message = "Validated for commit."
        if warnings:
            message = "Validated with warnings; locked/system fields will be ignored."
        return (
            StructureImportRow(
                row_number=row_number,
                object_type=_SUPPORT_OBJECT,
                action=action,
                status="accepted",
                code="VALIDATED",
                message=message,
                warnings=warnings,
                key=key,
            ),
            staged,
        )

    def _validate_relationship_row(
        self,
        conn,
        row_number: int,
        raw: dict[str, Any],
        duplicate_external_ids: set[str],
    ) -> tuple[StructureImportRow, dict[str, Any] | None]:
        action = self._action(raw)
        relationship_rule_id = self._normalized(raw.get("relationship_rule_id"))
        source_instance_type = self._normalized(raw.get("source_instance_type"))
        target_instance_type = self._normalized(raw.get("target_instance_type"))
        pdp_id = self._normalized(raw.get("pdp_system_id"))
        external_id = self._normalized(raw.get("external_id"))
        warnings = self._collect_locked_field_warnings(raw)

        if action is None:
            return self._rejected(row_number, _REL_OBJECT, "CREATE", "INVALID_ACTION", "Action must be CREATE or UPSERT."), None
        if relationship_rule_id is None or source_instance_type is None or target_instance_type is None:
            return self._rejected(row_number, _REL_OBJECT, action, "MISSING_REQUIRED", "relationship_rule_id, source_instance_type and target_instance_type are required."), None
        if external_id in duplicate_external_ids:
            return self._rejected(row_number, _REL_OBJECT, action, "DUPLICATE_EXTERNAL_ID", "duplicate External ID within the import file."), None

        existing_by_id = self._fetch_relationship_by_id(conn, pdp_id) if pdp_id else None
        existing_by_external = self._fetch_relationship_by_external_id(conn, external_id) if external_id else None
        if existing_by_id is not None and existing_by_external is not None and existing_by_id["relationship_id"] != existing_by_external["relationship_id"]:
            return self._rejected(row_number, _REL_OBJECT, action, "MISMATCHED_KEYS", "PDP system ID and External ID resolve to different records."), None

        existing = existing_by_id or existing_by_external
        if action == "CREATE" and existing is not None:
            return self._rejected(row_number, _REL_OBJECT, action, "CREATE_CONFLICT", "External ID or PDP system ID already exists for Action=CREATE."), None
        if action == "UPSERT" and existing is None:
            return self._rejected(row_number, _REL_OBJECT, action, "UPSERT_NOT_FOUND", "UPSERT requires a valid PDP system ID or External ID resolving to an existing record."), None

        rule = conn.execute(
            """
            SELECT relationship_type_id, status, source_model_type, target_model_type
            FROM cross_model_relationship_type
            WHERE relationship_type_id = %s
            """,
            (relationship_rule_id,),
        ).fetchone()
        if rule is None:
            return self._rejected(row_number, _REL_OBJECT, action, "RELATIONSHIP_TYPE_NOT_FOUND", "Referenced relationship type does not exist."), None
        if rule["status"] != "active":
            return self._rejected(row_number, _REL_OBJECT, action, "RELATIONSHIP_TYPE_INACTIVE", "Referenced relationship type is not active."), None

        if source_instance_type != rule["source_model_type"] or target_instance_type != rule["target_model_type"]:
            return self._rejected(row_number, _REL_OBJECT, action, "TYPE_MISMATCH", "Source/target instance types do not match relationship type constraints."), None

        source_id, source_error = self._resolve_instance_reference(
            conn,
            source_instance_type,
            self._normalized(raw.get("source_pdp_system_id")),
            self._normalized(raw.get("source_external_id")),
        )
        if source_error:
            return self._rejected(row_number, _REL_OBJECT, action, "SOURCE_RESOLUTION_FAILED", source_error), None

        target_id, target_error = self._resolve_instance_reference(
            conn,
            target_instance_type,
            self._normalized(raw.get("target_pdp_system_id")),
            self._normalized(raw.get("target_external_id")),
        )
        if target_error:
            return self._rejected(row_number, _REL_OBJECT, action, "TARGET_RESOLUTION_FAILED", target_error), None

        if source_id is None or target_id is None:
            return self._rejected(row_number, _REL_OBJECT, action, "MISSING_ENDPOINT", "Source and target references are required."), None
        if source_id == target_id and source_instance_type == target_instance_type:
            return self._rejected(row_number, _REL_OBJECT, action, "SELF_RELATIONSHIP", "Relationship source and target must be distinct."), None

        key = pdp_id or external_id or (existing["relationship_id"] if existing else None)
        staged = {
            "row_number": row_number,
            "object_type": _REL_OBJECT,
            "action": action,
            "key": key,
            "warnings": warnings,
            "data": {
                "relationship_id": existing["relationship_id"] if existing else str(uuid4()),
                "relationship_rule_id": relationship_rule_id,
                "source_instance_id": source_id,
                "source_instance_type": source_instance_type,
                "target_instance_id": target_id,
                "target_instance_type": target_instance_type,
                "external_id": external_id,
            },
        }

        message = "Validated for commit."
        if warnings:
            message = "Validated with warnings; locked/system fields will be ignored."
        return (
            StructureImportRow(
                row_number=row_number,
                object_type=_REL_OBJECT,
                action=action,
                status="accepted",
                code="VALIDATED",
                message=message,
                warnings=warnings,
                key=key,
            ),
            staged,
        )

    def _validate_support_element_relationship_row(
        self,
        conn,
        row_number: int,
        raw: dict[str, Any],
        duplicate_keys: set[tuple[str, str, str, str]],
    ) -> tuple[StructureImportRow, dict[str, Any] | None]:
        # Relationships are stored and imported/exported at element-type level
        # (support_domain_relationship). Endpoints are element type ids.
        action = self._action(raw)
        model_id = self._normalized(raw.get("support_domain_model_id"))
        source_element_type_id = self._normalized(raw.get("source_element_type_id"))
        target_element_type_id = self._normalized(raw.get("target_element_type_id"))
        relationship_type = self._normalized(raw.get("relationship_type"))
        warnings = self._collect_locked_field_warnings(raw)

        if action is None:
            return self._rejected(row_number, _REL_OBJECT, "CREATE", "INVALID_ACTION", "Action must be CREATE or UPSERT."), None
        if model_id is None or source_element_type_id is None or target_element_type_id is None or relationship_type is None:
            return self._rejected(row_number, _REL_OBJECT, action, "MISSING_REQUIRED", "support_domain_model_id, source_element_type_id, target_element_type_id, and relationship_type are required."), None
        if source_element_type_id == target_element_type_id:
            return self._rejected(row_number, _REL_OBJECT, action, "SELF_RELATIONSHIP", "Relationship source and target element types must be distinct."), None

        type_key = (model_id, source_element_type_id, target_element_type_id, relationship_type)
        if type_key in duplicate_keys:
            return self._rejected(row_number, _REL_OBJECT, action, "DUPLICATE_RELATIONSHIP", "duplicate model/source_element_type/target_element_type/relationship_type within the import file."), None

        if not self._exists(conn, "SELECT 1 FROM support_domain_model WHERE support_domain_model_id = %s", (model_id,)):
            return self._rejected(row_number, _REL_OBJECT, action, "MODEL_NOT_FOUND", "Referenced support domain model does not exist."), None
        if not self._exists(
            conn,
            "SELECT 1 FROM support_domain_element_type WHERE element_id = %s AND support_domain_model_id = %s",
            (source_element_type_id, model_id),
        ):
            return self._rejected(row_number, _REL_OBJECT, action, "SOURCE_ELEMENT_TYPE_NOT_FOUND", "Referenced source element type does not exist for model."), None
        if not self._exists(
            conn,
            "SELECT 1 FROM support_domain_element_type WHERE element_id = %s AND support_domain_model_id = %s",
            (target_element_type_id, model_id),
        ):
            return self._rejected(row_number, _REL_OBJECT, action, "TARGET_ELEMENT_TYPE_NOT_FOUND", "Referenced target element type does not exist for model."), None

        existing = self._fetch_support_relationship_by_natural_key(conn, model_id, source_element_type_id, target_element_type_id, relationship_type)
        if action == "CREATE" and existing is not None:
            return self._rejected(row_number, _REL_OBJECT, action, "CREATE_CONFLICT", "An element-type relationship for the source/target element types already exists for Action=CREATE."), None
        if action == "UPSERT" and existing is None:
            return self._rejected(row_number, _REL_OBJECT, action, "UPSERT_NOT_FOUND", "UPSERT requires an existing element-type relationship for the source/target element types."), None

        key = f"{source_element_type_id}->{target_element_type_id}:{relationship_type}"
        staged = {
            "row_number": row_number,
            "object_type": _REL_OBJECT,
            "action": action,
            "key": key,
            "warnings": warnings,
            "data": {
                "support_domain_model_id": model_id,
                "source_element_id": source_element_type_id,
                "target_element_id": target_element_type_id,
                "relationship_type": relationship_type,
            },
        }

        message = "Validated for commit."
        if warnings:
            message = "Validated with warnings; locked/system fields will be ignored."
        return (
            StructureImportRow(
                row_number=row_number,
                object_type=_REL_OBJECT,
                action=action,
                status="accepted",
                code="VALIDATED",
                message=message,
                warnings=warnings,
                key=key,
            ),
            staged,
        )

    def _commit_hierarchy(self, conn, action: str, data: dict[str, Any]) -> None:
        now = utc_now_iso()
        if action == "CREATE":
            conn.execute(
                """
                INSERT INTO hierarchy_model_node_instance (
                    node_instance_id, model_id, node_type_id, name, description,
                    parent_node_id, external_id, sort_order, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 0, 'active', %s, %s)
                """,
                (
                    data["node_instance_id"],
                    data["model_id"],
                    data["node_type_id"],
                    data["name"],
                    data.get("description"),
                    data.get("parent_node_id"),
                    data.get("external_id"),
                    now,
                    now,
                ),
            )
            return

        conn.execute(
            """
            UPDATE hierarchy_model_node_instance
            SET name = %s,
                description = %s,
                parent_node_id = %s,
                updated_at = %s
            WHERE node_instance_id = %s
            """,
            (
                data["name"],
                data.get("description"),
                data.get("parent_node_id"),
                now,
                data["node_instance_id"],
            ),
        )

    def _commit_support(self, conn, action: str, data: dict[str, Any]) -> None:
        now = utc_now_iso()
        if action == "CREATE":
            conn.execute(
                """
                INSERT INTO support_domain_element_instance (
                    instance_id, support_domain_model_id, element_type_id,
                    name, description, external_id, status, sort_order, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, 'active', 0, %s, %s)
                """,
                (
                    data["instance_id"],
                    data["support_domain_model_id"],
                    data["element_type_id"],
                    data["name"],
                    data.get("description"),
                    data.get("external_id"),
                    now,
                    now,
                ),
            )
            return

        conn.execute(
            """
            UPDATE support_domain_element_instance
            SET name = %s,
                description = %s,
                updated_at = %s
            WHERE instance_id = %s
            """,
            (
                data["name"],
                data.get("description"),
                now,
                data["instance_id"],
            ),
        )

    def _commit_support_element_relationship(self, conn, action: str, data: dict[str, Any]) -> None:
        # Many instance-level rows collapse onto a single element-type relationship, so the
        # commit is an idempotent upsert keyed by the element-type natural key. Repeated rows
        # that resolve to the same type relationship simply refresh it.
        now = utc_now_iso()
        conn.execute(
            """
            INSERT INTO support_domain_relationship (
                relationship_id, support_domain_model_id, source_element_id, target_element_id,
                relationship_type, cardinality, name, description, status, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, '', NULL, NULL, 'active', %s, %s)
            ON CONFLICT (support_domain_model_id, source_element_id, target_element_id, relationship_type)
            DO UPDATE SET updated_at = EXCLUDED.updated_at
            """,
            (
                str(uuid4()),
                data["support_domain_model_id"],
                data["source_element_id"],
                data["target_element_id"],
                data["relationship_type"],
                now,
                now,
            ),
        )

    def _commit_relationship(self, conn, action: str, data: dict[str, Any]) -> None:
        now = utc_now_iso()
        if action == "CREATE":
            conn.execute(
                """
                INSERT INTO cross_model_relationship_instance (
                    relationship_id, relationship_rule_id,
                    source_instance_id, source_instance_type,
                    target_instance_id, target_instance_type,
                    external_id, sort_order, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 0, 'active', %s, %s)
                """,
                (
                    data["relationship_id"],
                    data["relationship_rule_id"],
                    data["source_instance_id"],
                    data["source_instance_type"],
                    data["target_instance_id"],
                    data["target_instance_type"],
                    data.get("external_id"),
                    now,
                    now,
                ),
            )
            return

        # An existing link can only be re-pointed at another governed type.
        conn.execute(
            """
            UPDATE cross_model_relationship_instance
            SET relationship_rule_id = %s,
                updated_at = %s
            WHERE relationship_id = %s
            """,
            (
                data["relationship_rule_id"],
                now,
                data["relationship_id"],
            ),
        )

    def _resolve_hierarchy_parent(
        self,
        conn,
        parent_pdp_id: str | None,
        parent_external_id: str | None,
    ) -> tuple[str | None, str | None]:
        parent_by_id = self._fetch_hierarchy_by_id(conn, parent_pdp_id) if parent_pdp_id else None
        parent_by_external = self._fetch_hierarchy_by_external_id(conn, parent_external_id) if parent_external_id else None

        if parent_by_id is not None and parent_by_external is not None and parent_by_id["node_instance_id"] != parent_by_external["node_instance_id"]:
            return None, "Parent PDP system ID and Parent External ID resolve to different records."

        parent = parent_by_id or parent_by_external
        return (parent["node_instance_id"], None) if parent is not None else (None, None)

    def _resolve_instance_reference(
        self,
        conn,
        instance_type: str,
        pdp_id: str | None,
        external_id: str | None,
    ) -> tuple[str | None, str | None]:
        if instance_type == HIERARCHY_MODEL:
            by_id = self._fetch_hierarchy_by_id(conn, pdp_id) if pdp_id else None
            by_external = self._fetch_hierarchy_by_external_id(conn, external_id) if external_id else None
            key = "node_instance_id"
        elif instance_type == SUPPORT_DOMAIN_MODEL:
            by_id = self._fetch_support_by_id(conn, pdp_id) if pdp_id else None
            by_external = self._fetch_support_by_external_id(conn, external_id) if external_id else None
            key = "instance_id"
        else:
            return None, "Unsupported instance type for relationship endpoint."

        if by_id is not None and by_external is not None and by_id[key] != by_external[key]:
            return None, "PDP system ID and External ID resolve to different endpoint records."

        resolved = by_id or by_external
        if resolved is None:
            return None, "Endpoint record could not be resolved by PDP system ID or External ID."
        return resolved[key], None

    def _fetch_hierarchy_by_id(self, conn, node_id: str | None):
        if node_id is None:
            return None
        return conn.execute(
            """
            SELECT node_instance_id, model_id, node_type_id, parent_node_id, external_id
            FROM hierarchy_model_node_instance
            WHERE node_instance_id = %s
            """,
            (node_id,),
        ).fetchone()

    def _fetch_hierarchy_by_external_id(self, conn, external_id: str | None):
        if external_id is None:
            return None
        return conn.execute(
            """
            SELECT node_instance_id, model_id, node_type_id, parent_node_id, external_id
            FROM hierarchy_model_node_instance
            WHERE external_id = %s
            """,
            (external_id,),
        ).fetchone()

    def _fetch_support_by_id(self, conn, instance_id: str | None):
        if instance_id is None:
            return None
        return conn.execute(
            """
            SELECT instance_id, support_domain_model_id, element_type_id, external_id
            FROM support_domain_element_instance
            WHERE instance_id = %s
            """,
            (instance_id,),
        ).fetchone()

    def _fetch_support_by_external_id(self, conn, external_id: str | None):
        if external_id is None:
            return None
        return conn.execute(
            """
            SELECT instance_id, support_domain_model_id, element_type_id, external_id
            FROM support_domain_element_instance
            WHERE external_id = %s
            """,
            (external_id,),
        ).fetchone()

    def _fetch_support_relationship_by_natural_key(
        self,
        conn,
        model_id: str,
        source_element_id: str,
        target_element_id: str,
        relationship_type: str,
    ):
        return conn.execute(
            """
            SELECT relationship_id, support_domain_model_id, source_element_id, target_element_id, relationship_type
            FROM support_domain_relationship
            WHERE support_domain_model_id = %s
              AND source_element_id = %s
              AND target_element_id = %s
              AND relationship_type = %s
            """,
            (model_id, source_element_id, target_element_id, relationship_type),
        ).fetchone()

    def _fetch_relationship_by_id(self, conn, relationship_id: str | None):
        if relationship_id is None:
            return None
        return conn.execute(
            """
            SELECT relationship_id, external_id
            FROM cross_model_relationship_instance
            WHERE relationship_id = %s
            """,
            (relationship_id,),
        ).fetchone()

    def _fetch_relationship_by_external_id(self, conn, external_id: str | None):
        if external_id is None:
            return None
        return conn.execute(
            """
            SELECT relationship_id, external_id
            FROM cross_model_relationship_instance
            WHERE external_id = %s
            """,
            (external_id,),
        ).fetchone()

    def _exists(self, conn, sql: str, params: tuple[Any, ...]) -> bool:
        return conn.execute(sql, params).fetchone() is not None

    def _would_cycle(self, conn, node_id: str | None, new_parent_id: str) -> bool:
        if node_id is None:
            return False
        return (
            conn.execute(
                """
                WITH RECURSIVE traversal(node_instance_id, parent_node_id) AS (
                    SELECT node_instance_id, parent_node_id
                    FROM hierarchy_model_node_instance
                    WHERE node_instance_id = %s
                    UNION ALL
                    SELECT n.node_instance_id, n.parent_node_id
                    FROM hierarchy_model_node_instance n
                    JOIN traversal t ON t.parent_node_id = n.node_instance_id
                )
                SELECT 1
                FROM traversal
                WHERE node_instance_id = %s
                LIMIT 1
                """,
                (new_parent_id, node_id),
            ).fetchone()
            is not None
        )

    def _collect_locked_field_warnings(self, raw: dict[str, Any]) -> list[str]:
        warnings: list[str] = []
        for field in _LOCKED_FIELDS:
            if field in raw and raw.get(field) not in (None, ""):
                warnings.append(f"Locked/system field '{field}' is ignored.")
        return warnings

    def _action(self, raw: dict[str, Any]) -> str | None:
        action = self._normalized(raw.get("action"))
        if action is None:
            return None
        action = action.upper()
        if action not in {"CREATE", "UPSERT"}:
            return None
        return action

    def _action_error_message(self, raw: dict[str, Any]) -> str:
        raw_value = raw.get("action")
        if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
            return "Action is required and must be CREATE or UPSERT."
        return f"Invalid action '{raw_value}'. Action must be CREATE or UPSERT."

    def _normalized(self, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return str(value)

    def _rejected(self, row_number: int, object_type: str, action: str, code: str, message: str) -> StructureImportRow:
        return StructureImportRow(
            row_number=row_number,
            object_type=object_type,
            action=action,
            status="rejected",
            code=code,
            message=message,
            warnings=[],
            key=None,
        )


class StructureExportService:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def export(self, template_type: str = "all", model_ids: list[str] | None = None) -> dict[str, Any]:
        include_hierarchy = template_type in {"all", "hierarchy"}
        include_support_instances = template_type in {"all", "support-domain"}
        include_relationships = template_type == "all"

        # An empty list means "no models selected" and must not be treated as "all models".
        selected_model_ids = list(model_ids) if model_ids is not None else None

        with get_connection(self._db_url) as conn:
            hierarchy_rows = self._export_hierarchy_rows(conn, selected_model_ids) if include_hierarchy else []
            support_rows = self._export_support_rows(conn, selected_model_ids) if include_support_instances else []
            support_element_relationship_rows = (
                self._export_support_element_relationship_rows(conn, selected_model_ids)
                if include_support_instances
                else []
            )
            relationship_rows = self._export_relationship_rows(conn) if include_relationships else []
            sd_link_rows = (
                SupportDomainInstanceRelationshipTransfer(lambda v: v, lambda r: None).export_rows(conn, selected_model_ids)
                if include_support_instances
                else []
            )

        return {
            "Template_Metadata": {
                "generated_at": utc_now_iso(),
                "template_type": template_type,
                "model_ids": selected_model_ids,
                "authoritative_source": "persisted_backend_state",
                "system_controlled_fields_policy": "ignored_on_import",
            },
            "Load_Hierarchy_Node_Instances": hierarchy_rows,
            "Load_Support_Domain_Elements": support_rows,
            "Load_Support_Domain_Element_Relationships": support_element_relationship_rows,
            "Load_Support_Domain_Relationships": relationship_rows,
            "Load_Support_Domain_Element_Instance_Relationships": sd_link_rows,
            "Validation_Lists": {
                "actions": ["CREATE", "UPSERT"],
                "instance_types": [HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL],
            },
            "Validation_Result": [],
        }

    def _export_hierarchy_rows(self, conn, model_ids: list[str] | None = None) -> list[dict[str, Any]]:
        if model_ids is not None and not model_ids:
            return []
        # Filtering happens in the outer SELECT so the recursive CTE can still walk
        # a full parent chain when building hierarchy_path/depth.
        model_filter = "WHERE n.model_id = ANY(%s)" if model_ids is not None else ""
        params = (model_ids,) if model_ids is not None else None
        rows = conn.execute(
            f"""
            WITH RECURSIVE path_cte AS (
                SELECT
                    n.node_instance_id,
                    n.parent_node_id,
                    n.name::text AS path,
                    0 AS depth
                FROM hierarchy_model_node_instance n
                WHERE n.parent_node_id IS NULL
                UNION ALL
                SELECT
                    c.node_instance_id,
                    c.parent_node_id,
                    (p.path || ' > ' || c.name)::text AS path,
                    p.depth + 1 AS depth
                FROM hierarchy_model_node_instance c
                JOIN path_cte p ON p.node_instance_id = c.parent_node_id
            )
            SELECT
                'UPSERT' AS action,
                n.node_instance_id AS pdp_system_id,
                n.external_id,
                n.model_id,
                m.name AS model_name,
                n.node_type_id,
                n.name,
                n.description,
                n.parent_node_id AS parent_pdp_system_id,
                p_parent.external_id AS parent_external_id,
                p_parent.name AS parent_name,
                p.path AS hierarchy_path,
                p.depth
            FROM hierarchy_model_node_instance n
            LEFT JOIN hierarchy_model m ON m.model_id = n.model_id
            LEFT JOIN hierarchy_model_node_instance p_parent ON p_parent.node_instance_id = n.parent_node_id
            LEFT JOIN path_cte p ON p.node_instance_id = n.node_instance_id
            {model_filter}
            ORDER BY n.model_id, p.depth, n.sort_order, n.name
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def _export_support_rows(self, conn, model_ids: list[str] | None = None) -> list[dict[str, Any]]:
        if model_ids is not None and not model_ids:
            return []
        model_filter = "WHERE i.support_domain_model_id = ANY(%s)" if model_ids is not None else ""
        params = (model_ids,) if model_ids is not None else None
        rows = conn.execute(
            f"""
            SELECT
                'UPSERT' AS action,
                i.instance_id AS pdp_system_id,
                i.external_id,
                i.support_domain_model_id,
                m.name AS model_name,
                i.element_type_id,
                i.name,
                i.description
            FROM support_domain_element_instance i
            LEFT JOIN support_domain_model m ON m.support_domain_model_id = i.support_domain_model_id
            {model_filter}
            ORDER BY i.support_domain_model_id, i.element_type_id, i.sort_order, i.name
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def _export_support_element_relationship_rows(self, conn, model_ids: list[str] | None = None) -> list[dict[str, Any]]:
        if model_ids is not None and not model_ids:
            return []
        # Relationships live at element-type level and are exported as-is (one row per type
        # relationship), keeping the file compact.
        model_filter = "WHERE r.support_domain_model_id = ANY(%s)" if model_ids is not None else ""
        params = (model_ids,) if model_ids is not None else None
        rows = conn.execute(
            f"""
            SELECT
                'UPSERT' AS action,
                r.support_domain_model_id,
                m.name AS model_name,
                r.source_element_id AS source_element_type_id,
                src.name AS source_element_type_name,
                r.target_element_id AS target_element_type_id,
                tgt.name AS target_element_type_name,
                r.relationship_type
            FROM support_domain_relationship r
            JOIN support_domain_model m ON m.support_domain_model_id = r.support_domain_model_id
            JOIN support_domain_element_type src ON src.element_id = r.source_element_id
            JOIN support_domain_element_type tgt ON tgt.element_id = r.target_element_id
            {model_filter}
            ORDER BY r.support_domain_model_id, src.name, tgt.name
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def _export_relationship_rows(self, conn) -> list[dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT
                'UPSERT' AS action,
                r.relationship_id AS pdp_system_id,
                r.external_id,
                r.relationship_rule_id,
                r.source_instance_type,
                r.source_instance_id AS source_pdp_system_id,
                src.external_id AS source_external_id,
                r.target_instance_type,
                r.target_instance_id AS target_pdp_system_id,
                tgt.external_id AS target_external_id
            FROM cross_model_relationship_instance r
            LEFT JOIN (
                SELECT node_instance_id AS instance_id, external_id FROM hierarchy_model_node_instance
                UNION ALL
                SELECT instance_id, external_id FROM support_domain_element_instance
            ) src ON src.instance_id = r.source_instance_id
            LEFT JOIN (
                SELECT node_instance_id AS instance_id, external_id FROM hierarchy_model_node_instance
                UNION ALL
                SELECT instance_id, external_id FROM support_domain_element_instance
            ) tgt ON tgt.instance_id = r.target_instance_id
            ORDER BY r.created_at, r.relationship_id
            """
        ).fetchall()
        return [dict(row) for row in rows]
