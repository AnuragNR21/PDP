"""
DiscoverImportService — authoritative write service for file attachment
and source application/module context.

Enforces the governed import boundary:
  - A file must be uploaded before Start Import proceeds (AC-DWS-IMPORT-002).
    The model it is mapped to is chosen later, on the Mapping step.
  - All import metadata is persisted through this service only (AC-DWS-IMPORT-005).
  - Structure application/module data is consumed read-only (AC-DWS-IMPORT-006).

StructureApplicationContextReadService — read-only adapter for Structure
application/module options. Discover must NOT mutate Structure records.
"""
from features.discover.domain.models import (
    AttachSourceFileCommand,
    SetSourceContextCommand,
    SourceContextResponse,
    SourceFileResponse,
    StartImportCommand,
)
from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_import_repository import DiscoverImportRepository
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from shared.contracts.refresh import RefreshRequest


class SourceContextLocked(ValueError):
    """
    Raised when the chosen model cannot be applied — it has no fields, or
    columns are already paired against a different one. Distinct from a
    "not found" error so the API can answer 409 Conflict rather than 404.
    """


class DiscoverImportService:
    """Authoritative writes for file attachment and source context."""

    def __init__(self, db_url: str) -> None:
        self._db_url = db_url
        self._imports = DiscoverImportRepository(db_url)
        self._sessions = DiscoverSessionRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)

    # ── attach file ───────────────────────────────────────────────────────────

    def attach_source_file(
        self,
        session_id: str,
        command: AttachSourceFileCommand,
    ) -> dict:
        """
        Persist source file metadata for a discovery session.
        All fields required by AC-DWS-IMPORT-007 are captured here.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")
        try:
            source_file = self._imports.attach_source_file(
                session_id=session_id,
                original_filename=command.original_filename,
                file_type=command.file_type,
                file_size_bytes=command.file_size_bytes,
                storage_ref=command.storage_ref,
                uploaded_by=command.uploaded_by,
                import_status="uploaded",
            )
            # Update session source_name to reflect the attached file
            self._sessions.update_status(session_id, "draft")
            self._audit.record(
                actor=command.uploaded_by,
                action="import.file_attached",
                outcome="success",
                session_id=session_id,
                source_file_id=source_file.source_file_id,
                detail={
                    "filename": command.original_filename,
                    "file_type": command.file_type,
                    "size_bytes": command.file_size_bytes,
                },
            )
            return {
                "file": source_file,
                "refresh": RefreshRequest(
                    scope="session",
                    reason="Source file attached to discovery session.",
                    targets=[session_id, source_file.source_file_id],
                ),
            }
        except Exception as exc:
            self._audit.record(
                actor=command.uploaded_by,
                action="import.file_attached",
                outcome="failure",
                session_id=session_id,
                detail={"error": str(exc)},
            )
            raise

    # ── source context ────────────────────────────────────────────────────────

    def set_source_context(
        self,
        session_id: str,
        command: SetSourceContextCommand,
        actor: str = "system",
    ) -> dict:
        """
        Persist the selected source application/module for a session.
        Discover reads Structure read-only and stores only the selection here.
        (AC-DWS-IMPORT-003, AC-DWS-IMPORT-006)
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        # Once a table's columns are paired, they are tied to that model's
        # structure — switching now would leave them pointing at fields of a
        # different one. The context belongs to the table being worked on, so
        # only that table's pairings can stand in the way: a session may hold
        # five files read against five different models, and the fifth must be
        # choosable without disturbing the four already mapped. Re-sending the
        # same model is always fine (Start Import does it on every attempt).
        existing = self._imports.get_source_context(session_id)
        if (
            existing
            and existing.application_ref_id
            and command.application_ref_id
            and existing.application_ref_id != command.application_ref_id
            and self._has_downstream_work(session_id, self._imports.get_active_file_id(session_id))
        ):
            raise SourceContextLocked(
                f"Columns are already paired with fields of '{existing.source_application}'. "
                "Remove those pairings before switching to a different model."
            )

        # A model with nothing beneath it has no fields to pair columns with.
        if command.application_ref_id:
            structure = StructureApplicationContextReadService(self._db_url)
            if not structure.list_application_fields(command.application_ref_id):
                raise SourceContextLocked(
                    f"'{command.source_application}' has no fields defined in the model structure, "
                    "so columns cannot be mapped to it. Choose a different model, or define its "
                    "fields in the Structure workspace first."
                )

        try:
            ctx = self._imports.upsert_source_context(
                session_id=session_id,
                source_application=command.source_application,
                source_module=command.source_module,
                application_ref_id=command.application_ref_id,
                module_ref_id=command.module_ref_id,
            )
            self._audit.record(
                actor=actor,
                action="import.context_set",
                outcome="success",
                session_id=session_id,
                detail={
                    "source_application": command.source_application,
                    "source_module": command.source_module,
                },
            )
            return {
                "context": ctx,
                "refresh": RefreshRequest(
                    scope="session",
                    reason="Source application/module context updated.",
                    targets=[session_id],
                ),
            }
        except Exception as exc:
            self._audit.record(
                actor=actor,
                action="import.context_set",
                outcome="failure",
                session_id=session_id,
                detail={"error": str(exc)},
            )
            raise

    def _has_downstream_work(self, session_id: str, source_file_id: str | None = None) -> bool:
        """
        True once *this table's* columns are paired.

        Only mappings tie a table to a particular model — profiled columns
        come from the file and are model-independent, so they must not block
        the choice.

        Named with a table, this counts that table's pairings and no others.
        Counting the whole session was how mapping four files and then
        choosing a model for the fifth became impossible: the other four
        blocked a switch that had nothing to do with them, and the screen —
        which clears one table — could never satisfy it.
        """
        from shared.db import get_connection

        with get_connection(self._db_url) as conn:
            if source_file_id:
                row = conn.execute(
                    "SELECT COUNT(*) AS mappings FROM column_mapping "
                    "WHERE session_id = %s AND source_file_id = %s",
                    (session_id, source_file_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT COUNT(*) AS mappings FROM column_mapping WHERE session_id = %s",
                    (session_id,),
                ).fetchone()
        return bool(row) and int(row["mappings"]) > 0

    # ── start import gate ─────────────────────────────────────────────────────

    def validate_start_import_preconditions(
        self, session_id: str, source_file_id: str
    ) -> None:
        """
        Check that there is a file to import. The model this file will be mapped
        to is chosen later, on the Mapping step, once profiling has shown what
        the file actually contains — so it is not required here.
        (AC-DWS-IMPORT-002)
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        # The only real precondition is that a file is attached. The id the
        # caller sends is not required to match: replacing a file gives it a new
        # id, and a page that has not refetched yet would otherwise be refused
        # an import that is perfectly valid.
        if self._imports.get_source_file(session_id) is None:
            raise ValueError(
                "No uploaded file was found for this session. Upload a CSV or Excel file first."
            )

    # ── replace file ──────────────────────────────────────────────────────────

    def replace_source_file(
        self,
        session_id: str,
        command: "AttachSourceFileCommand",
    ) -> dict:
        """
        Replace the existing source file for a session with a new one.

        Steps:
          1. Verify session exists.
          2. Delete all existing source_file rows for the session (audit logged).
          3. Attach the new file via the standard attach flow.

        This allows the user to correct an incorrect upload without creating a
        new session.  All prior profiling/mapping/DQ data remains until a new
        import is explicitly started.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        # Remove old file(s) and audit the removal
        deleted_ids = self._imports.delete_source_files_for_session(session_id)
        for old_id in deleted_ids:
            self._audit.record(
                actor=command.uploaded_by,
                action="import.file_replaced",
                outcome="success",
                session_id=session_id,
                source_file_id=old_id,
                detail={"replaced_by": command.original_filename},
            )

        # Attach the new file using the standard path
        return self.attach_source_file(session_id, command)

    # ── read-only helpers (for the router) ───────────────────────────────────

    def get_source_file(self, session_id: str) -> SourceFileResponse:
        return SourceFileResponse(file=self._imports.get_source_file(session_id))

    def get_source_context(self, session_id: str) -> SourceContextResponse:
        return SourceContextResponse(context=self._imports.get_source_context(session_id))



class StructureApplicationContextReadService:
    """
    Read-only adapter for Structure application/module options.

    Discover must NOT mutate Structure-owned records. This service exposes
    a read contract only. (AC-DWS-IMPORT-006)

    In the current implementation the Structure data lives in
    hierarchy_model_node_instance. Future iterations may call a dedicated
    Structure API endpoint instead.
    """

    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    def list_applications(self) -> list[dict]:
        """
        Return the list of application-level node instances from Structure.
        The node_type filter relies on the seeded Structure model setup.
        Returns a lightweight summary suitable for the import selector dropdown.
        """
        from shared.db import get_connection

        with get_connection(self._db_url) as conn:
            # Applications are top-level nodes in the Structure hierarchy model.
            # We select nodes whose parent_node_id IS NULL (root nodes) as
            # a pragmatic approximation; a future iteration can filter by node_type.
            #
            # field_count is how many nodes exist beneath each application. An
            # application with none cannot be mapped or quality-checked against,
            # so the import step warns before the user commits to it.
            rows = conn.execute(
                """
                WITH RECURSIVE descendants AS (
                    SELECT n.node_instance_id AS root_id,
                           c.node_instance_id
                    FROM hierarchy_model_node_instance n
                    JOIN hierarchy_model_node_instance c
                      ON c.parent_node_id = n.node_instance_id
                    WHERE n.parent_node_id IS NULL
                      AND n.status = 'active'
                      AND c.status = 'active'
                    UNION ALL
                    SELECT d.root_id, c.node_instance_id
                    FROM hierarchy_model_node_instance c
                    JOIN descendants d ON c.parent_node_id = d.node_instance_id
                    WHERE c.status = 'active'
                ),
                counts AS (
                    SELECT root_id, COUNT(*) AS field_count
                    FROM descendants GROUP BY root_id
                )
                SELECT n.node_instance_id             AS application_ref_id,
                       n.name                         AS application_name,
                       n.status,
                       COALESCE(counts.field_count, 0) AS field_count
                FROM hierarchy_model_node_instance n
                LEFT JOIN counts ON counts.root_id = n.node_instance_id
                WHERE n.parent_node_id IS NULL
                  AND n.status = 'active'
                ORDER BY n.name
                """
            ).fetchall()
        return [dict(r) for r in rows]

    def list_application_fields(self, application_ref_id: str) -> list[dict]:
        """
        Return every descendant node of an application as a flat, ordered list
        carrying its full path — the fields Discover offers as mapping targets
        once a source application has been selected for the session.

        Read-only: Discover never mutates Structure-owned records.
        """
        from shared.db import get_connection

        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                """
                WITH RECURSIVE subtree AS (
                    SELECT n.node_instance_id,
                           n.name,
                           n.parent_node_id,
                           n.node_type_id,
                           1 AS depth,
                           n.name AS path,
                           LPAD(n.sort_order::text, 6, '0') || n.name AS sort_path
                    FROM hierarchy_model_node_instance n
                    WHERE n.parent_node_id = %s
                      AND n.status = 'active'
                    UNION ALL
                    SELECT c.node_instance_id,
                           c.name,
                           c.parent_node_id,
                           c.node_type_id,
                           s.depth + 1,
                           s.path || ' > ' || c.name,
                           s.sort_path || '/' || LPAD(c.sort_order::text, 6, '0') || c.name
                    FROM hierarchy_model_node_instance c
                    JOIN subtree s ON c.parent_node_id = s.node_instance_id
                    WHERE c.status = 'active'
                )
                SELECT s.node_instance_id AS node_id,
                       s.name,
                       s.path,
                       s.depth,
                       s.parent_node_id,
                       t.name AS node_type,
                       NOT EXISTS (
                           SELECT 1 FROM hierarchy_model_node_instance ch
                           WHERE ch.parent_node_id = s.node_instance_id
                             AND ch.status = 'active'
                       ) AS is_leaf
                FROM subtree s
                LEFT JOIN hierarchy_model_node_type t ON t.node_type_id = s.node_type_id
                ORDER BY s.sort_path
                """,
                (application_ref_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def list_modules(self, application_ref_id: str) -> list[dict]:
        """
        Return direct child nodes (modules) of the given application node.
        Read-only — Discover does not mutate Structure.
        """
        from shared.db import get_connection

        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                """
                SELECT n.node_instance_id AS module_ref_id,
                       n.name             AS module_name,
                       n.status
                FROM hierarchy_model_node_instance n
                WHERE n.parent_node_id = %s
                  AND n.status = 'active'
                ORDER BY n.sort_order, n.name
                """,
                (application_ref_id,),
            ).fetchall()
        return [dict(r) for r in rows]
