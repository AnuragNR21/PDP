"""
DiscoverColumnRepository — authoritative writes/reads for discovery_column.

Implements AC-DWS-COLUMN-001 through AC-DWS-COLUMN-004.
"""
from uuid import uuid4

from shared.contracts.canonical_types import DiscoveryColumnSummary
from shared.db import get_connection, utc_now_iso


class DiscoverColumnRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── reads ────────────────────────────────────────────────────────────────

    def list_discovery_columns(self, session_id: str) -> list[DiscoveryColumnSummary]:
        """
        Return persisted discovery columns for a session ordered by ordinal.
        Rehydrates from backend state only — never from client state.
        (AC-DWS-COLUMN-003)
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT discovery_column_id, session_id, source_file_id, "
                "source_label, internal_name, inferred_datatype, ordinal, "
                "is_nullable, duplicate_group_key, created_at "
                "FROM active_discovery_column "
                "WHERE session_id = %s ORDER BY ordinal",
                (session_id,),
            ).fetchall()
        return [DiscoveryColumnSummary(**dict(r)) for r in rows]

    def get_discovery_column(
        self, session_id: str, discovery_column_id: str
    ) -> DiscoveryColumnSummary | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT discovery_column_id, session_id, source_file_id, "
                "source_label, internal_name, inferred_datatype, ordinal, "
                "is_nullable, duplicate_group_key, created_at "
                "FROM active_discovery_column "
                "WHERE session_id = %s AND discovery_column_id = %s",
                (session_id, discovery_column_id),
            ).fetchone()
        return None if row is None else DiscoveryColumnSummary(**dict(row))

    # ── writes ───────────────────────────────────────────────────────────────

    def persist_columns(
        self,
        session_id: str,
        source_file_id: str,
        columns: list[dict],
    ) -> list[DiscoveryColumnSummary]:
        """
        Bulk-persist discovery_column records for a session + file.

        Each dict in `columns` must include:
          - source_label: str           — original column header from source file
          - internal_name: str          — normalised identifier (suffix-de-duped)
          - inferred_datatype: str      — inferred type (String, Integer, Decimal, …)
          - ordinal: int                — 1-based position in source file
          - is_nullable: bool           — nullable indicator
          - duplicate_group_key: str|None — set when source_label was a duplicate

        Both source_label and internal_name are retained so original labels are
        preserved while deterministic internal names are queryable.
        (AC-DWS-COLUMN-001, AC-DWS-COLUMN-002, AC-DWS-COLUMN-004)
        """
        now = utc_now_iso()
        results: list[DiscoveryColumnSummary] = []

        # Wipe any existing columns for this session+file before re-persisting
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_column WHERE session_id = %s AND source_file_id = %s",
                (session_id, source_file_id),
            )
            for col in columns:
                dc_id = f"dc_{uuid4().hex[:12]}"
                conn.execute(
                    "INSERT INTO discovery_column "
                    "(discovery_column_id, session_id, source_file_id, source_label, "
                    "internal_name, inferred_datatype, ordinal, is_nullable, "
                    "duplicate_group_key, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        dc_id,
                        session_id,
                        source_file_id,
                        col["source_label"],
                        col["internal_name"],
                        col["inferred_datatype"],
                        col["ordinal"],
                        col.get("is_nullable", True),
                        col.get("duplicate_group_key"),
                        now,
                    ),
                )
            rows = conn.execute(
                "SELECT discovery_column_id, session_id, source_file_id, "
                "source_label, internal_name, inferred_datatype, ordinal, "
                "is_nullable, duplicate_group_key, created_at "
                "FROM active_discovery_column WHERE session_id = %s AND source_file_id = %s "
                "ORDER BY ordinal",
                (session_id, source_file_id),
            ).fetchall()
        return [DiscoveryColumnSummary(**dict(r)) for r in rows]
