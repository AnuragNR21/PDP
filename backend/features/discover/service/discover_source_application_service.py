"""Source application context of a Discover table.

Import Data says where a table came from: which Application (an instance of a
governed PDP model, e.g. "GIS" in the Applications model) produced it. That is
a different relationship from Mapping, which says what the table's columns
mean (Manufacturer → Asset Information.Switch.Manufacturer); both are kept.

    Application → Source File/Table → Source Column → Asset Property → Finding → Remediation

The association is held per table — the same source-object level Mapping uses
(``discovery_source_file``) — so each sheet of a workbook keeps its own, and
several tables may name the same Application. It is stored explicitly; nothing
here derives an Application from a file name.

Changing or clearing it once the table has mappings or quality findings needs
``confirm``: those records were produced under the old provenance, so the change
is made knowingly and written to the audit trail with the counts it affected.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from shared.db import get_connection, utc_now_iso

MODEL_KINDS = ("hierarchy", "support")
ARCHIVED = "retired"


class SourceApplicationNotFound(ValueError):
    """Session, table, model or instance does not exist."""


class SourceApplicationInvalid(ValueError):
    """The choice is not a valid Application for this table."""


class SourceApplicationNeedsConfirmation(ValueError):
    """The table already has downstream records; the change must be confirmed."""

    def __init__(self, message: str, dependents: dict[str, int]):
        super().__init__(message)
        self.dependents = dependents


class DiscoverSourceApplicationService:
    def __init__(self, db_url: str):
        self._db_url = db_url
        self._audit = DiscoverAuditRepository(db_url)

    # ------------------------------------------------------------------ read

    def list_for_session(self, session_id: str) -> dict[str, Any]:
        with get_connection(self._db_url) as conn:
            self._require_session(conn, session_id)
            files = conn.execute(
                """
                SELECT source_file_id, original_filename
                FROM discovery_source_file WHERE session_id = %s
                ORDER BY uploaded_at, original_filename
                """,
                (session_id,),
            ).fetchall()
            items = [self._item(conn, session_id, row["source_file_id"], row["original_filename"]) for row in files]
        return {"session_id": session_id, "items": items}

    def get(self, session_id: str, source_file_id: str) -> dict[str, Any]:
        with get_connection(self._db_url) as conn:
            self._require_session(conn, session_id)
            name = self._require_table(conn, session_id, source_file_id)
            return self._item(conn, session_id, source_file_id, name)

    def _item(self, conn, session_id: str, source_file_id: str, filename: str) -> dict[str, Any]:
        row = conn.execute(
            """
            SELECT association_id, model_kind, model_id, instance_id, set_by, created_at, updated_at
            FROM discovery_source_application WHERE session_id = %s AND source_file_id = %s
            """,
            (session_id, source_file_id),
        ).fetchone()
        application = None
        if row is not None:
            row = dict(row)
            model = self._model(conn, row["model_kind"], row["model_id"])
            instance = self._instance(conn, row["model_kind"], row["instance_id"])
            application = {
                "association_id": row["association_id"],
                "model_kind": row["model_kind"],
                "model_id": row["model_id"],
                "model_name": model["name"] if model else None,
                "model_status": model["status"] if model else None,
                "instance_id": row["instance_id"],
                "instance_name": instance["name"] if instance else None,
                "instance_type_name": instance["type_name"] if instance else None,
                "instance_status": instance["status"] if instance else None,
                # Kept, not dropped, when the Application is later deleted in SWS:
                # the provenance still says what was recorded, and that it is gone.
                "missing": model is None or instance is None or instance["model_id"] != row["model_id"],
                "set_by": row["set_by"],
                "updated_at": row["updated_at"],
            }
        return {
            "session_id": session_id,
            "source_file_id": source_file_id,
            "source_name": filename,
            "application": application,
            "dependents": self._dependents(conn, session_id, source_file_id),
        }

    # ------------------------------------------------------------------ write

    def set(
        self,
        session_id: str,
        source_file_id: str,
        *,
        model_kind: str,
        model_id: str,
        instance_id: str,
        confirm: bool = False,
        actor: str = "user",
    ) -> dict[str, Any]:
        if model_kind not in MODEL_KINDS:
            raise SourceApplicationInvalid("model_kind must be 'hierarchy' or 'support'.")
        with get_connection(self._db_url) as conn:
            self._require_session(conn, session_id)
            filename = self._require_table(conn, session_id, source_file_id)
            model = self._model(conn, model_kind, model_id)
            if model is None:
                raise SourceApplicationNotFound("The selected model does not exist.")
            if model["status"] != "active":
                raise SourceApplicationInvalid(
                    f"Model '{model['name']}' is not Active, so it cannot be used as the source application model."
                )
            instance = self._instance(conn, model_kind, instance_id)
            if instance is None:
                raise SourceApplicationNotFound("The selected Application does not exist.")
            if instance["model_id"] != model_id:
                raise SourceApplicationInvalid(f"'{instance['name']}' is not an instance of model '{model['name']}'.")
            if instance["status"] == ARCHIVED:
                raise SourceApplicationInvalid(f"'{instance['name']}' is Archived and cannot be chosen as a source application.")

            existing = conn.execute(
                """
                SELECT association_id, model_kind, model_id, instance_id
                FROM discovery_source_application WHERE session_id = %s AND source_file_id = %s
                """,
                (session_id, source_file_id),
            ).fetchone()
            existing = dict(existing) if existing else None
            unchanged = existing is not None and (existing["model_kind"], existing["model_id"], existing["instance_id"]) == (
                model_kind,
                model_id,
                instance_id,
            )
            if unchanged:
                return self._item(conn, session_id, source_file_id, filename)

            dependents = self._dependents(conn, session_id, source_file_id)
            if existing is not None and not confirm and any(dependents.values()):
                raise SourceApplicationNeedsConfirmation(
                    "This table already has "
                    + self._describe(dependents)
                    + " recorded against its current source application. Confirm to change it.",
                    dependents,
                )

            now = utc_now_iso()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO discovery_source_application (
                        association_id, session_id, source_file_id, model_kind, model_id, instance_id,
                        set_by, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (f"dsa_{uuid4().hex[:16]}", session_id, source_file_id, model_kind, model_id, instance_id, actor, now, now),
                )
            else:
                conn.execute(
                    """
                    UPDATE discovery_source_application
                    SET model_kind = %s, model_id = %s, instance_id = %s, set_by = %s, updated_at = %s
                    WHERE association_id = %s
                    """,
                    (model_kind, model_id, instance_id, actor, now, existing["association_id"]),
                )
            item = self._item(conn, session_id, source_file_id, filename)

        self._audit.record(
            actor=actor,
            action="source_application.change" if existing else "source_application.set",
            outcome="success",
            session_id=session_id,
            source_file_id=source_file_id,
            detail={
                "source_name": filename,
                "model_kind": model_kind,
                "model_id": model_id,
                "model_name": model["name"],
                "instance_id": instance_id,
                "application": instance["name"],
                "previous": existing,
                "dependents": dependents,
            },
        )
        return item

    def clear(self, session_id: str, source_file_id: str, *, confirm: bool = False, actor: str = "user") -> dict[str, Any]:
        with get_connection(self._db_url) as conn:
            self._require_session(conn, session_id)
            filename = self._require_table(conn, session_id, source_file_id)
            existing = conn.execute(
                "SELECT association_id, model_kind, model_id, instance_id FROM discovery_source_application "
                "WHERE session_id = %s AND source_file_id = %s",
                (session_id, source_file_id),
            ).fetchone()
            if existing is None:
                return self._item(conn, session_id, source_file_id, filename)
            dependents = self._dependents(conn, session_id, source_file_id)
            if not confirm and any(dependents.values()):
                raise SourceApplicationNeedsConfirmation(
                    "This table already has "
                    + self._describe(dependents)
                    + " recorded against its source application. Confirm to clear it.",
                    dependents,
                )
            conn.execute("DELETE FROM discovery_source_application WHERE association_id = %s", (existing["association_id"],))
            item = self._item(conn, session_id, source_file_id, filename)
        self._audit.record(
            actor=actor,
            action="source_application.clear",
            outcome="success",
            session_id=session_id,
            source_file_id=source_file_id,
            detail={"source_name": filename, "previous": dict(existing), "dependents": dependents},
        )
        return item

    # ------------------------------------------------------------------ helpers

    def _require_session(self, conn, session_id: str) -> None:
        if conn.execute("SELECT 1 FROM discovery_session WHERE session_id = %s", (session_id,)).fetchone() is None:
            raise SourceApplicationNotFound("Session not found.")

    def _require_table(self, conn, session_id: str, source_file_id: str) -> str:
        row = conn.execute(
            "SELECT original_filename FROM discovery_source_file WHERE session_id = %s AND source_file_id = %s",
            (session_id, source_file_id),
        ).fetchone()
        if row is None:
            raise SourceApplicationNotFound("Source table not found in this session.")
        return row["original_filename"]

    def _model(self, conn, kind: str, model_id: str) -> dict[str, Any] | None:
        if kind == "hierarchy":
            row = conn.execute("SELECT name, status FROM hierarchy_model WHERE model_id = %s", (model_id,)).fetchone()
        else:
            row = conn.execute(
                "SELECT name, status FROM support_domain_model WHERE support_domain_model_id = %s", (model_id,)
            ).fetchone()
        return dict(row) if row else None

    def _instance(self, conn, kind: str, instance_id: str) -> dict[str, Any] | None:
        if kind == "hierarchy":
            row = conn.execute(
                """
                SELECT i.name, i.status, i.model_id, COALESCE(NULLIF(t.display_name, ''), t.name) AS type_name
                FROM hierarchy_model_node_instance i
                LEFT JOIN hierarchy_model_node_type t ON t.node_type_id = i.node_type_id
                WHERE i.node_instance_id = %s
                """,
                (instance_id,),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT i.name, i.status, i.support_domain_model_id AS model_id,
                       COALESCE(NULLIF(t.display_name, ''), t.name) AS type_name
                FROM support_domain_element_instance i
                LEFT JOIN support_domain_element_type t ON t.element_id = i.element_type_id
                WHERE i.instance_id = %s
                """,
                (instance_id,),
            ).fetchone()
        return dict(row) if row else None

    def _dependents(self, conn, session_id: str, source_file_id: str) -> dict[str, int]:
        mappings = conn.execute(
            "SELECT COUNT(*) AS n FROM column_mapping WHERE session_id = %s AND source_file_id = %s",
            (session_id, source_file_id),
        ).fetchone()["n"]
        findings = conn.execute(
            "SELECT COUNT(*) AS n FROM discovery_quality_check WHERE session_id = %s AND source_file_id = %s",
            (session_id, source_file_id),
        ).fetchone()["n"]
        return {"mappings": int(mappings), "quality_findings": int(findings)}

    @staticmethod
    def _describe(dependents: dict[str, int]) -> str:
        parts = []
        if dependents.get("mappings"):
            n = dependents["mappings"]
            parts.append(f"{n} column mapping{'' if n == 1 else 's'}")
        if dependents.get("quality_findings"):
            n = dependents["quality_findings"]
            parts.append(f"{n} quality finding{'' if n == 1 else 's'}")
        return " and ".join(parts)
