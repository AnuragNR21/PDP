"""
DiscoverSessionRepository — authoritative reads/writes for discovery_session.

Handles session creation, status updates, and the session-scoped overview
read model aggregation used by DiscoverOverviewReadService.
"""
from uuid import uuid4

from shared.contracts.canonical_types import (
    ColumnHighlightsReadModel,
    DataQualityPanelReadModel,
    DiscoverSessionStatus,
    DiscoverySessionSummary,
    MappingSummaryReadModel,
    OverviewReadModel,
    SessionSummaryReadModel,
)
from shared.db import get_connection, utc_now_iso


class DiscoverSessionRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── reads ────────────────────────────────────────────────────────────────

    def list_sessions(self, archived: bool | None = None) -> list[DiscoverySessionSummary]:
        """
        Every session, or only the archived ones, or only the live ones.

        `archived=None` is every session, which is what the old callers want
        and what the count on the Admin page reads.
        """
        clause = ""
        if archived is True:
            clause = "WHERE archived_at <> '' "
        elif archived is False:
            clause = "WHERE archived_at = '' "
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT session_id, name, source_name, status, created_at, updated_at, "
                "archived_at FROM discovery_session "
                f"{clause}ORDER BY updated_at DESC, name"
            ).fetchall()
        return [DiscoverySessionSummary(**dict(r)) for r in rows]

    def get_session(self, session_id: str) -> DiscoverySessionSummary | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT session_id, name, source_name, status, created_at, updated_at, archived_at "
                "FROM discovery_session WHERE session_id = %s",
                (session_id,),
            ).fetchone()
        return None if row is None else DiscoverySessionSummary(**dict(row))

    def delete_session(self, session_id: str) -> bool:
        """
        Remove a session and everything derived from it.

        Every table that hangs off a session cascades from this row — files,
        rows, columns, mappings, rules, findings, jobs — so deleting the
        session is the whole deletion. False means there was nothing to
        delete, which the caller turns into a 404 rather than a silent no-op.
        """
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "DELETE FROM discovery_session WHERE session_id = %s RETURNING session_id",
                (session_id,),
            ).fetchone()
        return row is not None

    def session_exists(self, session_id: str) -> bool:
        with get_connection(self._db_url) as conn:
            return (
                conn.execute(
                    "SELECT 1 FROM discovery_session WHERE session_id = %s",
                    (session_id,),
                ).fetchone()
                is not None
            )

    def get_overview(self, session_id: str) -> OverviewReadModel:
        """
        Aggregate the Overview read model from persisted backend state only.
        Never returns local placeholder data — returns zero-value panels when
        no data exists for a given panel (AC-DWS-SHELL-003, AC-DWS-SHELL-004).
        """
        with get_connection(self._db_url) as conn:
            session_row = conn.execute(
                "SELECT session_id, name, source_name, status, created_at, updated_at, archived_at "
                "FROM discovery_session WHERE session_id = %s",
                (session_id,),
            ).fetchone()

            # The source file the session is working on — not the newest one.
            #
            # A session holds as many tables as the upload produced, and every
            # step reads the active one. Taking the most recently uploaded file
            # instead meant that after a seven-sheet upload every header named
            # the seventh sheet, whichever table the person had actually opened.
            # The newest file is still the fallback, for a session whose active
            # file was never set.
            file_row = conn.execute(
                "SELECT f.original_filename, f.file_size_bytes, f.file_type "
                "FROM discovery_source_file f "
                "JOIN discovery_session s ON s.session_id = f.session_id "
                "WHERE f.session_id = %s "
                "ORDER BY (f.source_file_id = s.active_source_file_id) DESC, f.created_at DESC "
                "LIMIT 1",
                (session_id,),
            ).fetchone()

            # Source context
            ctx_row = conn.execute(
                "SELECT source_application, source_module FROM discovery_source_context "
                "WHERE session_id = %s",
                (session_id,),
            ).fetchone()

            # Column counts from discovery_column (authoritative) or fallback to source_column
            col_count_row = conn.execute(
                "SELECT COUNT(*) AS total FROM active_discovery_column WHERE session_id = %s",
                (session_id,),
            ).fetchone()

            # Profile counts belong to the active table, not to the session.
            # Counting every file's columns together is how a two-column sheet
            # came to report 27 profiled columns and 1350% profiled.
            profiled_row = conn.execute(
                "SELECT COUNT(*) AS profiled FROM column_profile_result p "
                "JOIN active_source_column c ON c.column_id = p.column_id "
                "WHERE p.session_id = %s",
                (session_id,),
            ).fetchone()

            # A column counts as "null" for the overview when it has any missing
            # value — either a JSON null (null_count) or an empty cell (blank_count).
            null_col_row = conn.execute(
                "SELECT COUNT(*) AS null_cols FROM column_profile_result p "
                "JOIN active_source_column c ON c.column_id = p.column_id "
                "WHERE p.session_id = %s AND (p.null_count > 0 OR p.blank_count > 0)",
                (session_id,),
            ).fetchone()

            high_card_row = conn.execute(
                "SELECT COUNT(*) AS high_card FROM column_profile_result p "
                "JOIN active_source_column c ON c.column_id = p.column_id "
                "WHERE p.session_id = %s AND p.distinct_count > 100",
                (session_id,),
            ).fetchone()

            # Dataset row count
            dataset_row = conn.execute(
                "SELECT d.row_count FROM source_dataset d "
                "JOIN discovery_session s ON s.session_id = d.session_id "
                "WHERE d.session_id = %s "
                "ORDER BY (d.source_file_id = s.active_source_file_id) DESC, d.created_at DESC "
                "LIMIT 1",
                (session_id,),
            ).fetchone()

            # DQ
            total_checks_row = conn.execute(
                "SELECT COUNT(*) AS total FROM check_result WHERE session_id = %s",
                (session_id,),
            ).fetchone()
            dq_passed = conn.execute(
                "SELECT COUNT(*) AS cnt FROM check_result WHERE session_id = %s AND severity = 'low' AND metric_value = 0",
                (session_id,),
            ).fetchone()
            dq_warn = conn.execute(
                "SELECT COUNT(*) AS cnt FROM check_result WHERE session_id = %s AND severity = 'medium'",
                (session_id,),
            ).fetchone()
            dq_failed = conn.execute(
                "SELECT COUNT(*) AS cnt FROM check_result WHERE session_id = %s AND severity = 'high'",
                (session_id,),
            ).fetchone()

            # Mappings
            total_map_row = conn.execute(
                "SELECT COUNT(*) AS total FROM active_source_column WHERE session_id = %s",
                (session_id,),
            ).fetchone()
            confirmed_map = conn.execute(
                "SELECT COUNT(*) AS cnt FROM column_mapping m "
                "JOIN discovery_session s ON s.session_id = m.session_id "
                "WHERE m.session_id = %s AND m.mapping_state = 'confirmed' "
                "AND m.source_file_id = s.active_source_file_id",
                (session_id,),
            ).fetchone()
            suggested_map = conn.execute(
                "SELECT COUNT(*) AS cnt FROM column_mapping m "
                "JOIN discovery_session s ON s.session_id = m.session_id "
                "WHERE m.session_id = %s AND m.mapping_state = 'suggested' "
                "AND m.source_file_id = s.active_source_file_id",
                (session_id,),
            ).fetchone()

        total_cols: int = col_count_row["total"] if col_count_row else 0
        profiled_count: int = profiled_row["profiled"] if profiled_row else 0
        total_source_cols: int = total_map_row["total"] if total_map_row else 0
        confirmed_count: int = confirmed_map["cnt"] if confirmed_map else 0
        suggested_count: int = suggested_map["cnt"] if suggested_map else 0
        unmapped_count = max(0, total_source_cols - confirmed_count - suggested_count)

        session_summary = SessionSummaryReadModel(
            session_id=session_id,
            session_name=session_row["name"] if session_row else "",
            status=session_row["status"] if session_row else "draft",
            source_filename=file_row["original_filename"] if file_row else None,
            row_count=dataset_row["row_count"] if dataset_row else None,
            column_count=total_cols or None,
            profiled_column_count=profiled_count or None,
            profiled_column_pct=(
                round(profiled_count / total_cols * 100, 1) if total_cols > 0 else None
            ),
            dq_checks_run=total_checks_row["total"] if total_checks_row else None,
            mappings_confirmed=confirmed_count or None,
            last_updated=session_row["updated_at"] if session_row else None,
            source_application=ctx_row["source_application"] if ctx_row else None,
            source_module=ctx_row["source_module"] if ctx_row else None,
        )

        col_highlights = ColumnHighlightsReadModel(
            total_columns=total_cols,
            key_columns=0,  # to be enhanced when key column inference is added
            high_cardinality_columns=high_card_row["high_card"] if high_card_row else 0,
            null_columns=null_col_row["null_cols"] if null_col_row else 0,
        )

        total_checks: int = total_checks_row["total"] if total_checks_row else 0
        dq = DataQualityPanelReadModel(
            total_checks=total_checks,
            passed=dq_passed["cnt"] if dq_passed else 0,
            warnings=dq_warn["cnt"] if dq_warn else 0,
            failed=dq_failed["cnt"] if dq_failed else 0,
        )

        mapping_summary = MappingSummaryReadModel(
            total_mappings=total_source_cols,
            confirmed=confirmed_count,
            suggested=suggested_count,
            unmapped=unmapped_count,
        )

        return OverviewReadModel(
            session=session_summary,
            column_highlights=col_highlights,
            data_quality=dq,
            mapping_summary=mapping_summary,
        )

    # ── writes ───────────────────────────────────────────────────────────────

    def create_session(self, name: str, source_name: str) -> DiscoverySessionSummary:
        session_id = f"sess_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO discovery_session (session_id, name, source_name, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (session_id, name, source_name, "draft", now, now),
            )
            row = conn.execute(
                "SELECT session_id, name, source_name, status, created_at, updated_at, archived_at "
                "FROM discovery_session WHERE session_id = %s",
                (session_id,),
            ).fetchone()
        return DiscoverySessionSummary(**dict(row))

    def archive_session(self, session_id: str) -> DiscoverySessionSummary | None:
        """
        Put a session away, without deleting anything.

        The status becomes `archived` and `archived_at` starts the countdown
        the retention sweep measures. Archiving something already archived
        does not restart that countdown — otherwise a second click would
        quietly buy the session another week.
        """
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "UPDATE discovery_session SET status = 'archived', "
                "archived_at = CASE WHEN archived_at = '' THEN %s ELSE archived_at END, "
                "updated_at = %s WHERE session_id = %s "
                "RETURNING session_id, name, source_name, status, created_at, updated_at, "
                "archived_at",
                (now, now, session_id),
            ).fetchone()
        return None if row is None else DiscoverySessionSummary(**dict(row))

    def restore_session(
        self, session_id: str, status: DiscoverSessionStatus = "completed"
    ) -> DiscoverySessionSummary | None:
        """Bring it back and stop the clock. Clearing archived_at is the stop."""
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "UPDATE discovery_session SET status = %s, archived_at = '', updated_at = %s "
                "WHERE session_id = %s "
                "RETURNING session_id, name, source_name, status, created_at, updated_at, "
                "archived_at",
                (status, now, session_id),
            ).fetchone()
        return None if row is None else DiscoverySessionSummary(**dict(row))

    def archived_before(self, cutoff_iso: str) -> list[dict]:
        """
        Archived sessions whose countdown ran out at `cutoff_iso`.

        The cutoff is computed by the caller from the retention setting, so
        changing that setting moves every session's due date at once rather
        than only the ones archived afterwards.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT session_id, name, archived_at FROM discovery_session "
                "WHERE archived_at <> '' AND archived_at <= %s ORDER BY archived_at",
                (cutoff_iso,),
            ).fetchall()
        return [dict(row) for row in rows]

    def has_quality_run(self, session_id: str) -> bool:
        """
        Whether the checks have ever been run on this session.

        Archiving is offered only after a run, because the point of archiving
        is to put away work that is finished, and a session nobody has checked
        is not finished — it is abandoned, and deleting it is a different
        decision from retiring it.
        """
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT 1 FROM discovery_quality_check WHERE session_id = %s LIMIT 1",
                (session_id,),
            ).fetchone()
        return row is not None

    def update_status(self, session_id: str, status: DiscoverSessionStatus) -> None:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_session SET status = %s, updated_at = %s WHERE session_id = %s",
                (status, now, session_id),
            )
