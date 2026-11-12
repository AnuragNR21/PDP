"""
DiscoverValidationRepository — authoritative reads/writes for
discovery_import_validation_result and discovery_import_validation_issue.

Implements AC-DWS-VALIDATE-001 through AC-DWS-VALIDATE-006.
"""
from uuid import uuid4

from shared.contracts.canonical_types import (
    DiscoveryImportValidationIssueSummary,
    DiscoveryImportValidationResultSummary,
    ValidationStatus,
)
from shared.db import get_connection, utc_now_iso


class DiscoverValidationRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── reads ────────────────────────────────────────────────────────────────

    def get_validation_result(
        self, session_id: str
    ) -> DiscoveryImportValidationResultSummary | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT validation_result_id, session_id, source_file_id, "
                "validation_status, row_count, column_count, has_header_row, "
                "blocking_failure, validated_at, created_at, updated_at "
                "FROM discovery_import_validation_result WHERE session_id = %s "
                "ORDER BY created_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        return (
            None
            if row is None
            else DiscoveryImportValidationResultSummary(**dict(row))
        )

    def list_validation_issues(
        self, session_id: str
    ) -> list[DiscoveryImportValidationIssueSummary]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT issue_id, validation_result_id, session_id, issue_type, "
                "severity, is_blocking, column_ordinal, original_label, "
                "internal_name, detail, created_at "
                "FROM discovery_import_validation_issue "
                "WHERE session_id = %s ORDER BY column_ordinal NULLS LAST, created_at",
                (session_id,),
            ).fetchall()
        return [DiscoveryImportValidationIssueSummary(**dict(r)) for r in rows]

    def has_blocking_failure(self, session_id: str) -> bool:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT blocking_failure FROM discovery_import_validation_result "
                "WHERE session_id = %s ORDER BY created_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        return bool(row["blocking_failure"]) if row else False

    # ── writes ───────────────────────────────────────────────────────────────

    def create_validation_result(
        self,
        session_id: str,
        source_file_id: str,
        validation_status: ValidationStatus,
        row_count: int | None,
        column_count: int | None,
        has_header_row: bool | None,
        blocking_failure: bool,
    ) -> DiscoveryImportValidationResultSummary:
        validation_result_id = f"vr_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO discovery_import_validation_result "
                "(validation_result_id, session_id, source_file_id, validation_status, "
                "row_count, column_count, has_header_row, blocking_failure, "
                "validated_at, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    validation_result_id,
                    session_id,
                    source_file_id,
                    validation_status,
                    row_count,
                    column_count,
                    has_header_row,
                    blocking_failure,
                    now,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT validation_result_id, session_id, source_file_id, "
                "validation_status, row_count, column_count, has_header_row, "
                "blocking_failure, validated_at, created_at, updated_at "
                "FROM discovery_import_validation_result WHERE validation_result_id = %s",
                (validation_result_id,),
            ).fetchone()
        return DiscoveryImportValidationResultSummary(**dict(row))

    def add_validation_issue(
        self,
        validation_result_id: str,
        session_id: str,
        issue_type: str,
        detail: str,
        severity: str = "warning",
        is_blocking: bool = False,
        column_ordinal: int | None = None,
        original_label: str | None = None,
        internal_name: str | None = None,
    ) -> DiscoveryImportValidationIssueSummary:
        issue_id = f"vi_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO discovery_import_validation_issue "
                "(issue_id, validation_result_id, session_id, issue_type, "
                "severity, is_blocking, column_ordinal, original_label, "
                "internal_name, detail, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    issue_id,
                    validation_result_id,
                    session_id,
                    issue_type,
                    severity,
                    is_blocking,
                    column_ordinal,
                    original_label,
                    internal_name,
                    detail,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT issue_id, validation_result_id, session_id, issue_type, "
                "severity, is_blocking, column_ordinal, original_label, "
                "internal_name, detail, created_at "
                "FROM discovery_import_validation_issue WHERE issue_id = %s",
                (issue_id,),
            ).fetchone()
        return DiscoveryImportValidationIssueSummary(**dict(row))
