"""
DiscoverImportRepository — authoritative writes for discovery_source_file
and discovery_source_context.

Implements the import file-attach and source-context persist operations
required by AC-DWS-IMPORT-001 through AC-DWS-IMPORT-007.
"""
from uuid import uuid4

from shared.contracts.canonical_types import (
    DiscoverySourceContextSummary,
    DiscoverySourceFileSummary,
    ImportStatus,
)
from shared.db import get_connection, utc_now_iso


class DiscoverImportRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── reads ────────────────────────────────────────────────────────────────

    def get_source_file_by_id(self, source_file_id: str) -> DiscoverySourceFileSummary | None:
        """One named file, whichever the session happens to have open."""
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT source_file_id, session_id, original_filename, file_type, "
                "file_size_bytes, storage_ref, uploaded_by, uploaded_at, "
                "import_status, created_at, updated_at "
                "FROM discovery_source_file WHERE source_file_id = %s",
                (source_file_id,),
            ).fetchone()
        return None if row is None else DiscoverySourceFileSummary(**dict(row))

    def get_source_file(self, session_id: str) -> DiscoverySourceFileSummary | None:
        """
        Return the file the session is working on. A session may hold several,
        so this is the active one rather than simply the newest.
        """
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT f.source_file_id, f.session_id, f.original_filename, f.file_type, "
                "f.file_size_bytes, f.storage_ref, f.uploaded_by, f.uploaded_at, "
                "f.import_status, f.created_at, f.updated_at "
                "FROM discovery_source_file f "
                "JOIN discovery_session s ON s.session_id = f.session_id "
                "WHERE f.session_id = %s "
                "  AND (f.source_file_id = s.active_source_file_id "
                "       OR s.active_source_file_id IS NULL) "
                "ORDER BY f.created_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        return None if row is None else DiscoverySourceFileSummary(**dict(row))

    def get_source_context(self, session_id: str) -> DiscoverySourceContextSummary | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT c.context_id, c.session_id, c.source_application, c.source_module, "
                "c.application_ref_id, c.module_ref_id, c.created_at, c.updated_at "
                "FROM discovery_source_context c "
                "JOIN discovery_session s ON s.session_id = c.session_id "
                "WHERE c.session_id = %s AND c.source_file_id = s.active_source_file_id",
                (session_id,),
            ).fetchone()
        return None if row is None else DiscoverySourceContextSummary(**dict(row))

    def get_context_for_file(self, source_file_id: str) -> DiscoverySourceContextSummary | None:
        """The model context of one specific file, whichever file is active."""
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT context_id, session_id, source_application, source_module, "
                "application_ref_id, module_ref_id, created_at, updated_at "
                "FROM discovery_source_context WHERE source_file_id = %s",
                (source_file_id,),
            ).fetchone()
        return None if row is None else DiscoverySourceContextSummary(**dict(row))

    # ── writes ───────────────────────────────────────────────────────────────

    def attach_source_file(
        self,
        session_id: str,
        original_filename: str,
        file_type: str,
        file_size_bytes: int,
        storage_ref: str,
        uploaded_by: str,
        import_status: ImportStatus = "uploaded",
        origin_filename: str = "",
        sheet_name: str = "",
    ) -> DiscoverySourceFileSummary:
        """
        Persist source file metadata.  All required fields from AC-DWS-IMPORT-007
        are captured here.  Storage ref holds the object-store key / content hash.
        """
        source_file_id = f"sf_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO discovery_source_file "
                "(source_file_id, session_id, original_filename, file_type, "
                "file_size_bytes, storage_ref, uploaded_by, uploaded_at, "
                "import_status, created_at, updated_at, origin_filename, sheet_name) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    source_file_id,
                    session_id,
                    original_filename,
                    file_type,
                    file_size_bytes,
                    storage_ref,
                    uploaded_by,
                    now,
                    import_status,
                    now,
                    now,
                    origin_filename or original_filename,
                    sheet_name,
                ),
            )
            row = conn.execute(
                "SELECT source_file_id, session_id, original_filename, file_type, "
                "file_size_bytes, storage_ref, uploaded_by, uploaded_at, "
                "import_status, created_at, updated_at "
                "FROM discovery_source_file WHERE source_file_id = %s",
                (source_file_id,),
            ).fetchone()
        return DiscoverySourceFileSummary(**dict(row))

    def upsert_source_context(
        self,
        session_id: str,
        source_application: str,
        source_module: str | None = None,
        application_ref_id: str | None = None,
        module_ref_id: str | None = None,
    ) -> DiscoverySourceContextSummary:
        """
        Persist (or replace) the governed model context for the file being
        worked on. Each file in a session carries its own context, because two
        files can legitimately belong to two different source systems.

        Discover reads application/module options read-only from Structure; this
        method only stores the selected values — it never writes to Structure.
        (AC-DWS-IMPORT-006)
        """
        now = utc_now_iso()
        context_id = f"ctx_{uuid4().hex[:12]}"
        source_file_id = self.get_active_file_id(session_id)
        if source_file_id is None:
            raise ValueError(
                "No file is selected for this session, so there is nothing to link a model to."
            )
        with get_connection(self._db_url) as conn:
            conn.execute(
                """
                INSERT INTO discovery_source_context
                    (context_id, session_id, source_file_id, source_application,
                     source_module, application_ref_id, module_ref_id,
                     created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (session_id, source_file_id)
                DO UPDATE SET
                    source_application = EXCLUDED.source_application,
                    source_module      = EXCLUDED.source_module,
                    application_ref_id = EXCLUDED.application_ref_id,
                    module_ref_id      = EXCLUDED.module_ref_id,
                    updated_at         = EXCLUDED.updated_at
                """,
                (
                    context_id,
                    session_id,
                    source_file_id,
                    source_application,
                    source_module,
                    application_ref_id,
                    module_ref_id,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT context_id, session_id, source_application, source_module, "
                "application_ref_id, module_ref_id, created_at, updated_at "
                "FROM discovery_source_context "
                "WHERE session_id = %s AND source_file_id = %s",
                (session_id, source_file_id),
            ).fetchone()
        return DiscoverySourceContextSummary(**dict(row))

    def update_file_status(
        self, source_file_id: str, import_status: ImportStatus
    ) -> None:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_source_file SET import_status = %s, updated_at = %s "
                "WHERE source_file_id = %s",
                (import_status, now, source_file_id),
            )

    def list_source_files_from(self, session_id: str, origin_filename: str) -> list[str]:
        """Every table that came out of one uploaded file."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT source_file_id FROM discovery_source_file "
                "WHERE session_id = %s AND origin_filename = %s ORDER BY uploaded_at",
                (session_id, origin_filename),
            ).fetchall()
        return [dict(row)["source_file_id"] for row in rows]

    def delete_source_files_named(self, session_id: str, filename: str) -> list[str]:
        """
        Remove earlier uploads of the same file name, so re-uploading a file is
        a new version of that file rather than a second copy beside it. Files
        with other names in the session are untouched.

        A file is matched by the upload it came from as well as by its own
        name: a workbook re-uploaded after a sheet was renamed must take its
        old sheets with it, or the session keeps tables that no longer exist.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT source_file_id FROM discovery_source_file "
                "WHERE session_id = %s AND (original_filename = %s OR origin_filename = %s)",
                (session_id, filename, filename),
            ).fetchall()
            deleted = [r["source_file_id"] for r in rows]
            for file_id in deleted:
                conn.execute(
                    "DELETE FROM discovery_source_file WHERE source_file_id = %s",
                    (file_id,),
                )
        return deleted

    def list_source_files(self, session_id: str) -> list[dict]:
        """
        Every file in the session, with the one being worked on marked and how
        far each has got.

        A session that holds one file needs only its name. A session built from
        a workbook of seven sheets needs to say, per table, whether it has been
        mapped, whether rules are on it and whether it has been checked —
        otherwise the later steps show one table at a time with no way to tell
        which of the seven are done.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT f.source_file_id, f.original_filename, f.file_type, "
                "       f.file_size_bytes, f.storage_ref, f.uploaded_by, f.uploaded_at, "
                "       f.import_status, f.origin_filename, f.sheet_name, "
                "       (f.source_file_id = s.active_source_file_id) AS is_active, "
                "       p.row_count, p.column_count, "
                "       (SELECT COUNT(*) FROM column_mapping m "
                "         WHERE m.source_file_id = f.source_file_id) AS mapped_columns, "
                "       (SELECT COUNT(*) FROM discovery_rule_configuration c "
                "          JOIN source_column sc ON sc.column_id = c.column_id "
                "         WHERE sc.source_file_id = f.source_file_id "
                "           AND c.session_id = f.session_id) AS rules_attached, "
                # The table list describes the file as it stands, so it counts
                # the newest run only. Counting every run would make a table
                # look worse each time it was checked.
                #
                # COALESCE is on the comparison rather than inside the lateral
                # on purpose: a file with no run at all makes the lateral
                # return no row, so `latest.quality_run_id` is NULL and a
                # COALESCE in there would never fire. Findings written before
                # runs existed carry '', which is what this matches.
                "       (SELECT COUNT(*) FROM discovery_quality_check q "
                "         WHERE q.source_file_id = f.source_file_id "
                "           AND q.quality_run_id = COALESCE(latest.quality_run_id, '')) "
                "        AS findings, "
                "       (SELECT COUNT(*) FROM discovery_quality_check q "
                "         WHERE q.source_file_id = f.source_file_id "
                "           AND q.quality_run_id = COALESCE(latest.quality_run_id, '') "
                "           AND q.status <> 'passed') AS failing_checks "
                "FROM discovery_source_file f "
                "JOIN discovery_session s ON s.session_id = f.session_id "
                "LEFT JOIN discovery_parsed_file p ON p.source_file_id = f.source_file_id "
                "LEFT JOIN LATERAL ("
                "  SELECT r.quality_run_id "
                "    FROM discovery_quality_run r "
                "   WHERE r.source_file_id = f.source_file_id "
                "   ORDER BY r.completed_at DESC, r.created_at DESC, "
                "            r.quality_run_id DESC LIMIT 1"
                ") latest ON TRUE "
                "WHERE f.session_id = %s ORDER BY f.uploaded_at",
                (session_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def set_active_file(self, session_id: str, source_file_id: str | None) -> None:
        """Choose which of the session's files is being worked on."""
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_session SET active_source_file_id = %s WHERE session_id = %s",
                (source_file_id, session_id),
            )

    def get_active_file_id(self, session_id: str) -> str | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT active_source_file_id FROM discovery_session WHERE session_id = %s",
                (session_id,),
            ).fetchone()
        return row["active_source_file_id"] if row else None

    def delete_source_file(self, session_id: str, source_file_id: str) -> str | None:
        """
        Remove one file from the session. If it was the file being worked on,
        the most recent remaining file takes over, so the session is never left
        pointing at nothing.
        """
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_source_file WHERE session_id = %s AND source_file_id = %s",
                (session_id, source_file_id),
            )
            row = conn.execute(
                "SELECT source_file_id FROM discovery_source_file WHERE session_id = %s "
                "ORDER BY uploaded_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
            replacement = row["source_file_id"] if row else None
            conn.execute(
                "UPDATE discovery_session SET active_source_file_id = %s "
                "WHERE session_id = %s AND active_source_file_id = %s",
                (replacement, session_id, source_file_id),
            )
        return replacement

    def delete_source_files_for_session(self, session_id: str) -> list[str]:
        """
        Remove all source file rows for a session to allow replacement.
        Returns the deleted source_file_ids for audit logging.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT source_file_id FROM discovery_source_file WHERE session_id = %s",
                (session_id,),
            ).fetchall()
            deleted_ids = [r["source_file_id"] for r in rows]
            if deleted_ids:
                conn.execute(
                    "DELETE FROM discovery_source_file WHERE session_id = %s",
                    (session_id,),
                )
        return deleted_ids

