"""
DiscoverValidationService — authoritative write service for import validation.
DiscoverColumnService     — authoritative write service for discovery_column.
AdminDiscoverImportConfigReadService — read-only Admin import config.

Validation runs against Admin-configured limits.  Blocking failures set
import_status to 'validation_failed' and prevent profiling/mapping/DQ.
(AC-DWS-VALIDATE-001 to 006, AC-DWS-COLUMN-001 to 004)
"""
from features.discover.domain.models import (
    AdminImportConfig,
    DiscoveryColumnsResponse,
    ValidateImportCommand,
    ValidationResultResponse,
)
from features.discover.domain.validation import run_import_validation
from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_column_repository import DiscoverColumnRepository
from features.discover.repo.discover_import_repository import DiscoverImportRepository
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from features.discover.repo.discover_validation_repository import DiscoverValidationRepository
from shared.contracts.canonical_types import DiscoveryColumnSummary
from shared.contracts.refresh import RefreshRequest


class AdminDiscoverImportConfigReadService:
    """
    Read-only service that returns Admin-configured import validation limits.

    Currently returns hardcoded defaults; a future iteration will read from
    the organisation_setting table via the Admin feature.
    Discover never writes to Admin-owned configuration.
    """

    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    def get_config(self) -> AdminImportConfig:
        """
        Load import validation config from organisation_setting if overrides exist,
        otherwise return the default config.
        """
        from shared.db import get_connection

        defaults = AdminImportConfig()
        try:
            with get_connection(self._db_url) as conn:
                rows = conn.execute(
                    "SELECT setting_key, setting_value FROM organisation_setting "
                    "WHERE setting_key IN ("
                    "  'discover.import.max_rows',"
                    "  'discover.import.max_columns',"
                    "  'discover.import.max_file_size_bytes',"
                    "  'discover.import.require_header_row',"
                    "  'discover.import.duplicate_suffix_pattern'"
                    ")"
                ).fetchall()
            overrides = {r["setting_key"]: r["setting_value"] for r in rows}
            return AdminImportConfig(
                max_rows=int(overrides.get("discover.import.max_rows", defaults.max_rows)),
                max_columns=int(
                    overrides.get("discover.import.max_columns", defaults.max_columns)
                ),
                max_file_size_bytes=int(
                    overrides.get("discover.import.max_file_size_bytes", defaults.max_file_size_bytes)
                ),
                require_header_row=overrides.get(
                    "discover.import.require_header_row", str(defaults.require_header_row)
                ).lower()
                != "false",
                duplicate_suffix_pattern=overrides.get(
                    "discover.import.duplicate_suffix_pattern",
                    defaults.duplicate_suffix_pattern,
                ),
            )
        except Exception:
            return defaults


class DiscoverValidationService:
    """
    Authoritative validation service.

    Runs import validation against Admin-configured limits, persists the
    result and all issues, updates the source file import_status, and
    emits an audit event.  If blocking failures exist the session cannot
    proceed to profiling, mapping, or DQ execution.
    (AC-DWS-VALIDATE-001 through AC-DWS-VALIDATE-006)
    """

    def __init__(self, db_url: str) -> None:
        self._validations = DiscoverValidationRepository(db_url)
        self._imports = DiscoverImportRepository(db_url)
        self._sessions = DiscoverSessionRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)
        self._config_svc = AdminDiscoverImportConfigReadService(db_url)

    def run_validation(
        self,
        session_id: str,
        command: ValidateImportCommand,
    ) -> dict:
        """
        Execute import validation and persist all outcomes.

        Steps:
          1. Load Admin import config (read-only).
          2. Run validation engine (pure domain logic).
          3. Persist validation result + individual issues.
          4. Update source file import_status.
          5. Update session status.
          6. Emit audit event.
          7. Return ValidationResultResponse.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        config = self._config_svc.get_config()

        outcome = run_import_validation(
            column_labels=command.column_labels,
            row_count=command.row_count,
            has_header_row=command.has_header_row,
            config=config,
        )

        validation_status = "failed" if outcome.is_blocking else (
            "warning" if outcome.issues else "passed"
        )

        try:
            # Persist validation result
            result = self._validations.create_validation_result(
                session_id=session_id,
                source_file_id=command.source_file_id,
                validation_status=validation_status,
                row_count=command.row_count,
                column_count=len(command.column_labels),
                has_header_row=command.has_header_row,
                blocking_failure=outcome.is_blocking,
            )

            # Persist each issue
            for issue in outcome.issues:
                self._validations.add_validation_issue(
                    validation_result_id=result.validation_result_id,
                    session_id=session_id,
                    issue_type=issue.issue_type,
                    detail=issue.detail,
                    severity=issue.severity,
                    is_blocking=issue.is_blocking,
                    column_ordinal=issue.column_ordinal,
                    original_label=issue.original_label,
                    internal_name=issue.internal_name,
                )

            # Update source file status (AC-DWS-VALIDATE-005)
            import_status = "validation_failed" if outcome.is_blocking else "validated"
            self._imports.update_file_status(command.source_file_id, import_status)

            # Update session status
            session_status = "error" if outcome.is_blocking else "ready"
            self._sessions.update_status(session_id, session_status)

            self._audit.record(
                actor=command.actor,
                action="import.validation_run",
                outcome="success",
                session_id=session_id,
                source_file_id=command.source_file_id,
                detail={
                    "validation_status": validation_status,
                    "blocking_failure": outcome.is_blocking,
                    "issue_count": len(outcome.issues),
                },
            )

            issues = self._validations.list_validation_issues(session_id)
            return {
                "result": result,
                "issues": issues,
                "normalised_columns": outcome.normalised_columns,
                "refresh": RefreshRequest(
                    scope="session",
                    reason="Import validation completed.",
                    targets=[session_id, command.source_file_id],
                ),
            }

        except Exception as exc:
            self._audit.record(
                actor=command.actor,
                action="import.validation_run",
                outcome="failure",
                session_id=session_id,
                source_file_id=command.source_file_id,
                detail={"error": str(exc)},
            )
            raise

    def get_validation_result(self, session_id: str) -> ValidationResultResponse:
        return ValidationResultResponse(
            result=self._validations.get_validation_result(session_id),
            issues=self._validations.list_validation_issues(session_id),
        )


class DiscoverColumnService:
    """
    Authoritative write service for discovery_column.

    Persists parsed discovery columns after successful validation.
    Retains both original source_label and normalised internal_name
    so duplicates are visible and deterministic.
    (AC-DWS-COLUMN-001 through AC-DWS-COLUMN-004)
    """

    def __init__(self, db_url: str) -> None:
        self._columns = DiscoverColumnRepository(db_url)
        self._validations = DiscoverValidationRepository(db_url)
        self._sessions = DiscoverSessionRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)

    def persist_columns(
        self,
        session_id: str,
        source_file_id: str,
        normalised_columns: list[dict],
        actor: str = "system",
    ) -> dict:
        """
        Persist discovery_column records from the normalised column list
        produced by the validation engine.

        Blocked when the session has a blocking validation failure.
        (AC-DWS-VALIDATE-005)
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        if self._validations.has_blocking_failure(session_id):
            raise ValueError(
                "Import has a blocking validation failure. "
                "Columns cannot be persisted until validation issues are resolved."
            )

        try:
            columns = self._columns.persist_columns(
                session_id=session_id,
                source_file_id=source_file_id,
                columns=normalised_columns,
            )
            self._audit.record(
                actor=actor,
                action="import.columns_persisted",
                outcome="success",
                session_id=session_id,
                source_file_id=source_file_id,
                detail={"column_count": len(columns)},
            )
            return {
                "columns": columns,
                "refresh": RefreshRequest(
                    scope="session",
                    reason="Discovery columns persisted.",
                    targets=[session_id, source_file_id],
                ),
            }
        except Exception as exc:
            self._audit.record(
                actor=actor,
                action="import.columns_persisted",
                outcome="failure",
                session_id=session_id,
                source_file_id=source_file_id,
                detail={"error": str(exc)},
            )
            raise

    def list_discovery_columns(self, session_id: str) -> DiscoveryColumnsResponse:
        """
        Return persisted discovery columns rehydrated from backend state.
        (AC-DWS-COLUMN-003)
        """
        if self._validations.has_blocking_failure(session_id):
            # Return empty list when blocked — profiling/columns unavailable
            return DiscoveryColumnsResponse(items=[])
        return DiscoveryColumnsResponse(
            items=self._columns.list_discovery_columns(session_id)
        )


class DiscoverColumnReadService:
    """Read-only projections for discovery_column."""

    def __init__(self, db_url: str) -> None:
        self._columns = DiscoverColumnRepository(db_url)

    def list_discovery_columns(self, session_id: str) -> list[DiscoveryColumnSummary]:
        return self._columns.list_discovery_columns(session_id)
