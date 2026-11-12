"""Round-trip Data Transfer for the drawn Support Domain diagram links.

MWS defines the allowable relationships (``support_domain_relationship``):
a source Element Type, a target Element Type, a direction and a name. At the
Structure level those relationships are inherited — every instance of A
relates to every instance of B — and that is not stored anywhere. What the SWS
stores is only what a person draws on the diagram / matrix
(the ``support_domain_element_instance_relationship_diagram_edges`` of the
model's diagram), and this module moves those drawn links through the
same CSV the element instances use, as rows with
``object_type = support_domain_model_element_instance_relationship``. Importing
them changes the diagram only, never the inherited relationships.

The import never creates a relationship definition, and never picks one when
the file does not say which: ``relationship_type_id`` (authoritative) or
``relationship_name`` must identify exactly one allowable relationship between
the two Element Types, in the file's direction. Instance rows are validated
first, so a link can refer to an instance created by the same file.
"""

from __future__ import annotations

from typing import Any, Callable
from uuid import uuid4

from features.structure.domain.models import StructureImportRow
from shared import lifecycle
from features.structure.repo.support_domain_instance_relationship_diagram_repo import (
    DIAGRAM_EDGE_TABLE,
    DIAGRAM_EDGES_WITH_DIAGRAM,
    diagram_edge_key,
    ensure_diagram_id,
    mark_diagram_updated,
)
from shared.db import utc_now_iso

SD_LINK_OBJECT = "support_domain_model_element_instance_relationship"

# Columns of a relationship row in the CSV, in the order they are exported.
SD_LINK_EXPORT_COLUMNS = (
    "action",
    "pdp_system_id",
    "external_id",
    "support_domain_model_id",
    "model_name",
    "relationship_type_id",
    "relationship_name",
    "source_element_type_id",
    "source_instance_id",
    "source_instance_name",
    "target_element_type_id",
    "target_instance_id",
    "target_instance_name",
)


def relationship_label(kind: str | None) -> str:
    """The governed name the screens show for a relationship (same rule as the UI's relationshipKindLabel)."""
    text = (kind or "").strip()
    # A name of the model's own ("zz 123") is shown as written; only a kind key is humanised.
    if not text or " " in text or text != text.lower():
        return text
    spaced = text.replace("_", " ")
    return spaced[:1].upper() + spaced[1:]


def _name_key(value: str | None) -> str:
    return " ".join((value or "").replace("_", " ").split()).lower()


class _StagedInstances:
    """Element instances accepted earlier in the same file, so links can point at them before commit."""

    def __init__(self, staged_rows: list[dict[str, Any]]):
        self.by_id: dict[str, dict[str, Any]] = {}
        self.by_external: dict[str, dict[str, Any]] = {}
        self.by_name: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for staged in staged_rows:
            data = dict(staged["data"])
            data["staged_action"] = staged["action"]
            data["staged_row_number"] = staged["row_number"]
            self.by_id[data["instance_id"]] = data
            if data.get("external_id"):
                self.by_external[data["external_id"]] = data
            key = (data["support_domain_model_id"], data["element_type_id"], _name_key(data["name"]))
            self.by_name.setdefault(key, []).append(data)


class SupportDomainInstanceRelationshipTransfer:
    def __init__(self, normalized: Callable[[Any], str | None], action: Callable[[dict[str, Any]], str | None]):
        self._normalized = normalized
        self._action = action

    # ------------------------------------------------------------------ import

    def validate_rows(
        self,
        conn,
        rows: list[dict[str, Any]],
        staged_support_rows: list[dict[str, Any]],
        row_offset: int,
    ) -> list[tuple[StructureImportRow, dict[str, Any] | None]]:
        staged = _StagedInstances(staged_support_rows)
        external_counts: dict[str, int] = {}
        for raw in rows:
            external_id = self._normalized(raw.get("external_id"))
            if external_id:
                external_counts[external_id] = external_counts.get(external_id, 0) + 1
        seen_keys: dict[tuple[str, str, str], int] = {}
        seen_existing: dict[str, int] = {}
        results: list[tuple[StructureImportRow, dict[str, Any] | None]] = []
        for index, raw in enumerate(rows, start=1):
            row_number = row_offset + index
            result, data = self._validate_row(conn, row_number, raw, staged, external_counts)
            if data is not None:
                key = (data["support_domain_relationship_id"], data["source_instance_id"], data["target_instance_id"])
                if key in seen_keys:
                    result, data = self._rejected(
                        row_number,
                        result.action,
                        "DUPLICATE_RELATIONSHIP",
                        f"{data['_label']} The same relationship is already in this file at row {seen_keys[key]}.",
                    ), None
                elif data.get("relationship_instance_id") and data["relationship_instance_id"] in seen_existing:
                    result, data = self._rejected(
                        row_number,
                        result.action,
                        "DUPLICATE_RELATIONSHIP",
                        f"{data['_label']} Row {seen_existing[data['relationship_instance_id']]} already updates the same relationship.",
                    ), None
                else:
                    seen_keys[key] = row_number
                    if data.get("existing"):
                        seen_existing[data["relationship_instance_id"]] = row_number
            staged_row = None
            if data is not None:
                data.pop("_label", None)
                staged_row = {
                    "row_number": row_number,
                    "object_type": SD_LINK_OBJECT,
                    "action": result.action,
                    "key": result.key,
                    "warnings": list(result.warnings),
                    "data": data,
                }
            results.append((result, staged_row))
        return results

    def _validate_row(self, conn, row_number: int, raw: dict[str, Any], staged: _StagedInstances, external_counts: dict[str, int]):
        n = self._normalized
        action = self._action(raw)
        if action is None:
            return self._rejected(row_number, "CREATE", "INVALID_ACTION", "Action must be CREATE or UPSERT."), None

        model_id = n(raw.get("support_domain_model_id"))
        relationship_id = n(raw.get("relationship_type_id"))
        relationship_name = n(raw.get("relationship_name"))
        pdp_id = n(raw.get("pdp_system_id"))
        external_id = n(raw.get("external_id"))
        source_type_id = n(raw.get("source_element_type_id"))
        target_type_id = n(raw.get("target_element_type_id"))
        source_name = n(raw.get("source_instance_name"))
        target_name = n(raw.get("target_instance_name"))

        if model_id is None:
            return self._rejected(row_number, action, "MISSING_REQUIRED", "support_domain_model_id is required."), None
        if relationship_id is None and relationship_name is None:
            return self._rejected(
                row_number, action, "MISSING_REQUIRED",
                "relationship_type_id or relationship_name is required — the import does not choose a relationship for you.",
            ), None
        if external_id and external_counts.get(external_id, 0) > 1:
            return self._rejected(row_number, action, "DUPLICATE_EXTERNAL_ID", "duplicate External ID within the import file."), None

        model = conn.execute(
            "SELECT support_domain_model_id, name, status FROM support_domain_model WHERE support_domain_model_id = %s",
            (model_id,),
        ).fetchone()
        if model is None:
            return self._rejected(row_number, action, "MODEL_NOT_FOUND", "Referenced support domain model does not exist."), None

        # 1. Source and target instances.
        source, problem = self._resolve_endpoint(conn, staged, model_id, "source", raw, source_type_id)
        if problem:
            return self._rejected(row_number, action, "SOURCE_NOT_FOUND" if problem[0] == "missing" else "SOURCE_INVALID", problem[1]), None
        target, problem = self._resolve_endpoint(conn, staged, model_id, "target", raw, target_type_id)
        if problem:
            return self._rejected(row_number, action, "TARGET_NOT_FOUND" if problem[0] == "missing" else "TARGET_INVALID", problem[1]), None
        if source["instance_id"] == target["instance_id"]:
            return self._rejected(row_number, action, "SELF_RELATIONSHIP", "Source and target must be different instances."), None

        shown_name = relationship_name or ""
        type_names = self._type_names(conn, [source["element_type_id"], target["element_type_id"]])
        source_type_name = type_names.get(source["element_type_id"], source["element_type_id"])
        target_type_name = type_names.get(target["element_type_id"], target["element_type_id"])

        # 2. The MWS allowable relationship it is an instance of.
        relationship = None
        if relationship_id is not None:
            relationship = conn.execute(
                """
                SELECT relationship_id, support_domain_model_id, source_element_id, target_element_id,
                       relationship_type, name, status
                FROM support_domain_relationship WHERE relationship_id = %s
                """,
                (relationship_id,),
            ).fetchone()
            relationship = dict(relationship) if relationship else None
            shown_name = shown_name or (relationship_label(relationship["relationship_type"]) if relationship else relationship_id)
        label = f"Relationship rejected: {source['name']} → {shown_name} → {target['name']}."
        not_allowable = (
            f"{label} Relationship {shown_name} is not an allowable relationship between "
            f"{source_type_name} and {target_type_name} in the selected Support Domain model."
        )

        if relationship_id is not None:
            if relationship is None or relationship["support_domain_model_id"] != model_id:
                return self._rejected(
                    row_number, action, "RELATIONSHIP_NOT_FOUND",
                    f"{label} The relationship definition '{relationship_id}' does not exist in the selected Support Domain model. "
                    "Import does not create relationship definitions — define it in the Model Workspace first.",
                ), None
            ends = (relationship["source_element_id"], relationship["target_element_id"])
            if ends != (source["element_type_id"], target["element_type_id"]):
                if ends == (target["element_type_id"], source["element_type_id"]):
                    return self._rejected(
                        row_number, action, "WRONG_DIRECTION",
                        f"{not_allowable} It is defined in the other direction ({target_type_name} → "
                        f"{relationship_label(relationship['relationship_type'])} → {source_type_name}).",
                    ), None
                return self._rejected(row_number, action, "NOT_ALLOWABLE", not_allowable), None
            if relationship_name is not None and not self._name_matches(relationship, relationship_name):
                return self._rejected(
                    row_number, action, "RELATIONSHIP_NAME_MISMATCH",
                    f"{label} relationship_type_id '{relationship_id}' is "
                    f"'{relationship_label(relationship['relationship_type'])}', not '{relationship_name}'.",
                ), None
        else:
            candidates = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT relationship_id, support_domain_model_id, source_element_id, target_element_id,
                           relationship_type, name, status
                    FROM support_domain_relationship
                    WHERE support_domain_model_id = %s AND source_element_id = %s AND target_element_id = %s
                    """,
                    (model_id, source["element_type_id"], target["element_type_id"]),
                ).fetchall()
            ]
            matches = [row for row in candidates if self._name_matches(row, relationship_name)]
            if not matches:
                reversed_match = conn.execute(
                    """
                    SELECT relationship_type, name FROM support_domain_relationship
                    WHERE support_domain_model_id = %s AND source_element_id = %s AND target_element_id = %s
                    """,
                    (model_id, target["element_type_id"], source["element_type_id"]),
                ).fetchall()
                if any(self._name_matches(dict(row), relationship_name) for row in reversed_match):
                    return self._rejected(
                        row_number, action, "WRONG_DIRECTION",
                        f"{not_allowable} It is defined in the other direction ({target_type_name} → {shown_name} → {source_type_name}).",
                    ), None
                return self._rejected(row_number, action, "NOT_ALLOWABLE", not_allowable), None
            if len(matches) > 1:
                return self._rejected(
                    row_number, action, "AMBIGUOUS_RELATIONSHIP",
                    f"{label} More than one allowable relationship is named {shown_name} between {source_type_name} and "
                    f"{target_type_name}. Give relationship_type_id to say which.",
                ), None
            relationship = matches[0]

        # 3. Lifecycle: only Active definitions and authorable instances take new links.
        if relationship["status"] != lifecycle.ACTIVE:
            return self._rejected(
                row_number, action, "DEFINITION_NOT_ACTIVE",
                f"{label} The relationship {relationship_label(relationship['relationship_type'])} is "
                f"{lifecycle.label(relationship['status'])} in the Model Workspace; only Active relationships can be used.",
            ), None
        for end in (source, target):
            problem = self._authoring_problem(conn, end)
            if problem:
                return self._rejected(row_number, action, "INSTANCE_NOT_AUTHORABLE", f"{label} {problem}"), None

        # 4. The record itself, and duplicates.
        existing_by_id = self._fetch_link(conn, "relationship_instance_id", pdp_id) if pdp_id else None
        existing_by_external = self._fetch_link(conn, "external_id", external_id) if external_id else None
        if pdp_id and existing_by_id is None and action == "UPSERT":
            return self._rejected(row_number, action, "UPSERT_NOT_FOUND", f"No relationship with PDP system ID '{pdp_id}' exists."), None
        if existing_by_id and existing_by_external and existing_by_id["relationship_instance_id"] != existing_by_external["relationship_instance_id"]:
            return self._rejected(row_number, action, "MISMATCHED_KEYS", "PDP system ID and External ID resolve to different relationships."), None
        existing_by_key = conn.execute(
            f"""
            SELECT diagram_edge_id AS relationship_instance_id, external_id FROM {DIAGRAM_EDGE_TABLE}
            WHERE support_domain_relationship_id = %s AND source_instance_id = %s AND target_instance_id = %s
            """,
            (relationship["relationship_id"], source["instance_id"], target["instance_id"]),
        ).fetchone()
        existing_by_key = dict(existing_by_key) if existing_by_key else None
        existing = existing_by_id or existing_by_external

        shown = relationship_label(relationship["relationship_type"])
        link_text = f"{source['name']} → {shown} → {target['name']}"
        if action == "CREATE":
            if existing is not None:
                return self._rejected(row_number, action, "CREATE_CONFLICT", "External ID or PDP system ID already exists for Action=CREATE."), None
            if existing_by_key is not None:
                return self._rejected(
                    row_number, action, "DUPLICATE_RELATIONSHIP",
                    f"Relationship rejected: {link_text} already exists. Use UPSERT to update it.",
                ), None
        else:
            existing = existing or existing_by_key
            if existing is None:
                return self._rejected(
                    row_number, action, "UPSERT_NOT_FOUND",
                    f"{link_text} does not exist yet. Use Action=CREATE to create it.",
                ), None
            if existing_by_key is not None and existing_by_key["relationship_instance_id"] != existing["relationship_instance_id"]:
                return self._rejected(
                    row_number, action, "DUPLICATE_RELATIONSHIP",
                    f"Relationship rejected: {link_text} already exists as another relationship record.",
                ), None

        key = pdp_id or external_id or (existing["relationship_instance_id"] if existing else None)
        data = {
            "relationship_instance_id": existing["relationship_instance_id"] if existing else str(uuid4()),
            "existing": existing is not None,
            "support_domain_relationship_id": relationship["relationship_id"],
            "support_domain_model_id": model_id,
            "source_instance_id": source["instance_id"],
            "target_instance_id": target["instance_id"],
            "source_staged_row": source.get("staged_row_number"),
            "target_staged_row": target.get("staged_row_number"),
            "external_id": external_id if external_id else (existing.get("external_id") if existing else None),
            "_label": label,
        }
        warnings: list[str] = []
        if source_name and _name_key(source_name) != _name_key(source["name"]):
            warnings.append(f"source_instance_name '{source_name}' differs from the instance's name '{source['name']}'; the ID is used.")
        if target_name and _name_key(target_name) != _name_key(target["name"]):
            warnings.append(f"target_instance_name '{target_name}' differs from the instance's name '{target['name']}'; the ID is used.")
        result = StructureImportRow(
            row_number=row_number,
            object_type=SD_LINK_OBJECT,
            action=action,
            status="accepted",
            code="VALIDATED",
            message=f"Validated for commit: {link_text}." + (" Updates the existing relationship." if existing else ""),
            warnings=warnings,
            key=key,
        )
        return result, data

    def _resolve_endpoint(self, conn, staged: _StagedInstances, model_id: str, end: str, raw: dict[str, Any], expected_type_id: str | None):
        """The instance at one end of a link: by PDP id, else External ID, else name within its Element Type."""
        n = self._normalized
        instance_id = n(raw.get(f"{end}_instance_id"))
        external_id = n(raw.get(f"{end}_external_id"))
        name = n(raw.get(f"{end}_instance_name"))
        word = end.capitalize()
        found: dict[str, Any] | None = None
        if instance_id:
            found = staged.by_id.get(instance_id) or self._db_instance(conn, "instance_id = %s", (instance_id,))
            if found is None:
                return None, ("missing", f"{word} instance '{instance_id}' does not exist.")
        elif external_id:
            found = staged.by_external.get(external_id) or self._db_instance(conn, "external_id = %s", (external_id,))
            if found is None:
                return None, ("missing", f"{word} instance with External ID '{external_id}' does not exist.")
        elif name:
            if expected_type_id is None:
                return None, ("invalid", f"{end}_element_type_id is required to find the {end} instance by name.")
            in_file = staged.by_name.get((model_id, expected_type_id, _name_key(name)), [])
            if len(in_file) > 1:
                return None, ("invalid", f"{word} instance name '{name}' matches more than one instance in this file; give {end}_instance_id.")
            if in_file:
                found = in_file[0]
            else:
                rows = conn.execute(
                    """
                    SELECT instance_id, support_domain_model_id, element_type_id, name, status
                    FROM support_domain_element_instance
                    WHERE support_domain_model_id = %s AND element_type_id = %s AND lower(name) = lower(%s)
                    """,
                    (model_id, expected_type_id, name),
                ).fetchall()
                if len(rows) > 1:
                    return None, ("invalid", f"{word} instance name '{name}' matches more than one instance; give {end}_instance_id.")
                if not rows:
                    return None, ("missing", f"{word} instance '{name}' does not exist in the selected Support Domain model.")
                found = dict(rows[0])
        else:
            return None, ("missing", f"{end}_instance_id (or {end}_instance_name) is required.")

        if found["support_domain_model_id"] != model_id:
            return None, ("invalid", f"{word} instance '{found['name']}' belongs to a different Support Domain model.")
        if expected_type_id is not None and found["element_type_id"] != expected_type_id:
            type_names = self._type_names(conn, [found["element_type_id"], expected_type_id])
            return None, (
                "invalid",
                f"{word} instance '{found['name']}' is a {type_names.get(found['element_type_id'], found['element_type_id'])}, "
                f"not a {type_names.get(expected_type_id, expected_type_id)} as {end}_element_type_id says.",
            )
        return found, None

    def _db_instance(self, conn, where: str, params: tuple) -> dict[str, Any] | None:
        row = conn.execute(
            f"""
            SELECT instance_id, support_domain_model_id, element_type_id, name, status
            FROM support_domain_element_instance WHERE {where}
            """,
            params,
        ).fetchone()
        return dict(row) if row else None

    def _authoring_problem(self, conn, instance: dict[str, Any]) -> str | None:
        if instance.get("staged_action") == "CREATE":
            return None  # created Active by this file; its definition was checked on its own row
        try:
            lifecycle.require_authorable(conn, "element", instance["instance_id"])
        except lifecycle.LifecycleError as exc:
            return str(exc)
        return None

    def _type_names(self, conn, type_ids: list[str]) -> dict[str, str]:
        rows = conn.execute(
            "SELECT element_id, name, display_name FROM support_domain_element_type WHERE element_id = ANY(%s)",
            (list(type_ids),),
        ).fetchall()
        return {row["element_id"]: (row.get("display_name") or row["name"]) for row in rows}

    def _name_matches(self, relationship: dict[str, Any], name: str | None) -> bool:
        wanted = _name_key(name)
        return bool(wanted) and wanted in {_name_key(relationship.get("relationship_type")), _name_key(relationship.get("name"))}

    def _fetch_link(self, conn, column: str, value: str) -> dict[str, Any] | None:
        column = {"relationship_instance_id": "diagram_edge_id", "external_id": "external_id"}[column]
        row = conn.execute(
            f"""
            SELECT diagram_edge_id AS relationship_instance_id, external_id, support_domain_relationship_id,
                   source_instance_id, target_instance_id
            FROM {DIAGRAM_EDGE_TABLE} WHERE {column} = %s
            """,
            (value,),
        ).fetchone()
        return dict(row) if row else None

    def _rejected(self, row_number: int, action: str, code: str, message: str) -> StructureImportRow:
        return StructureImportRow(
            row_number=row_number,
            object_type=SD_LINK_OBJECT,
            action=action,
            status="rejected",
            code=code,
            message=message,
            warnings=[],
            key=None,
        )

    def commit(self, conn, action: str, data: dict[str, Any]) -> None:
        # Check before writing: one failed statement would abort the whole import transaction.
        for end in ("source", "target"):
            row = conn.execute(
                "SELECT 1 FROM support_domain_element_instance WHERE instance_id = %s", (data[f"{end}_instance_id"],)
            ).fetchone()
            if row is None:
                staged_row = data.get(f"{end}_staged_row")
                hint = f" — select row {staged_row}, which creates it, as well" if staged_row else ""
                raise ValueError(f"The {end} instance is not in the Support Domain model{hint}.")
        clash = conn.execute(
            f"""
            SELECT diagram_edge_id AS relationship_instance_id FROM {DIAGRAM_EDGE_TABLE}
            WHERE support_domain_relationship_id = %s AND source_instance_id = %s AND target_instance_id = %s
            """,
            (data["support_domain_relationship_id"], data["source_instance_id"], data["target_instance_id"]),
        ).fetchone()
        if clash is not None and clash["relationship_instance_id"] != data["relationship_instance_id"]:
            raise ValueError("The relationship already exists.")
        if data.get("external_id"):
            owner = self._fetch_link(conn, "external_id", data["external_id"])
            if owner is not None and owner["relationship_instance_id"] != data["relationship_instance_id"]:
                raise ValueError(f"External ID '{data['external_id']}' already belongs to another relationship.")

        now = utc_now_iso()
        key = diagram_edge_key(data["support_domain_relationship_id"], data["source_instance_id"], data["target_instance_id"])
        if data.get("existing"):
            row = conn.execute(
                f"""
                UPDATE {DIAGRAM_EDGE_TABLE}
                SET support_domain_relationship_id = %s, source_instance_id = %s, target_instance_id = %s,
                    edge_key = %s, external_id = %s, updated_at = %s
                WHERE diagram_edge_id = %s
                RETURNING diagram_id
                """,
                (
                    data["support_domain_relationship_id"],
                    data["source_instance_id"],
                    data["target_instance_id"],
                    key,
                    data.get("external_id"),
                    now,
                    data["relationship_instance_id"],
                ),
            ).fetchone()
            if row is not None:
                mark_diagram_updated(conn, row["diagram_id"])
            return
        diagram_id = ensure_diagram_id(conn, data["support_domain_model_id"])
        conn.execute(
            f"""
            INSERT INTO {DIAGRAM_EDGE_TABLE} (
                diagram_edge_id, diagram_id, edge_key, support_domain_relationship_id,
                source_instance_id, target_instance_id, external_id, status, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'active', %s, %s)
            """,
            (
                data["relationship_instance_id"],
                diagram_id,
                key,
                data["support_domain_relationship_id"],
                data["source_instance_id"],
                data["target_instance_id"],
                data.get("external_id"),
                now,
                now,
            ),
        )
        mark_diagram_updated(conn, diagram_id)

    # ------------------------------------------------------------------ export

    def export_rows(self, conn, model_ids: list[str] | None = None) -> list[dict[str, Any]]:
        """Every stored link whose two instances are both in the exported models."""
        if model_ids is not None and not model_ids:
            return []
        model_filter = (
            "WHERE source_instance.support_domain_model_id = ANY(%s) AND target_instance.support_domain_model_id = ANY(%s)"
            if model_ids is not None else ""
        )
        params = (model_ids, model_ids) if model_ids is not None else None
        rows = conn.execute(
            f"""
            SELECT
                'UPSERT' AS action,
                edge.diagram_edge_id AS pdp_system_id,
                edge.external_id,
                diagram.support_domain_model_id,
                model.name AS model_name,
                relationship.relationship_id AS relationship_type_id,
                relationship.relationship_type,
                source_instance.element_type_id AS source_element_type_id,
                source_instance.instance_id AS source_instance_id,
                source_instance.name AS source_instance_name,
                target_instance.element_type_id AS target_element_type_id,
                target_instance.instance_id AS target_instance_id,
                target_instance.name AS target_instance_name
            {DIAGRAM_EDGES_WITH_DIAGRAM}
            JOIN support_domain_relationship relationship
              ON relationship.relationship_id = edge.support_domain_relationship_id
            JOIN support_domain_element_instance source_instance
              ON source_instance.instance_id = edge.source_instance_id
            JOIN support_domain_element_instance target_instance
              ON target_instance.instance_id = edge.target_instance_id
            LEFT JOIN support_domain_model model ON model.support_domain_model_id = diagram.support_domain_model_id
            {model_filter}
            ORDER BY diagram.support_domain_model_id, relationship.relationship_type, source_instance.name, target_instance.name
            """,
            params,
        ).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item["relationship_name"] = relationship_label(item.pop("relationship_type"))
            out.append({column: item.get(column) for column in SD_LINK_EXPORT_COLUMNS})
        return out
