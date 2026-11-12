"""
W2-DWS-FEATURE-01 domain models — commands, responses, and validation config.

These models represent the authoritative request/response contracts for
DiscoverSessionService, DiscoverImportService, DiscoverValidationService,
and DiscoverColumnService.
"""
from pydantic import BaseModel, Field

from shared.contracts.canonical_types import (
    CheckExecutionSummary,
    CheckResultSummary,
    ColumnMappingSummary,
    ColumnProfileSummary,
    DiscoveryColumnSummary,
    DiscoveryImportValidationIssueSummary,
    DiscoveryImportValidationResultSummary,
    DiscoverySessionSummary,
    DiscoverySourceContextSummary,
    DiscoverySourceFileSummary,
    MappingSummaryReadModel,
    OverviewReadModel,
    SourceColumnSummary,
)

# ── Session commands ──────────────────────────────────────────────────────────


class CreateDiscoverySessionCommand(BaseModel):
    name: str = Field(min_length=1)
    source_name: str = Field(default="")


# ── Import commands ───────────────────────────────────────────────────────────


class AttachSourceFileCommand(BaseModel):
    """Attach a CSV/Excel file to a discovery session (AC-DWS-IMPORT-001)."""

    original_filename: str = Field(min_length=1)
    file_type: str = Field(pattern=r"^(csv|xlsx|xls)$")
    file_size_bytes: int = Field(ge=0)
    storage_ref: str = Field(min_length=1, description="Object-store key or SHA-256 content hash")
    uploaded_by: str = Field(min_length=1, description="Actor display name or email")


class SetSourceContextCommand(BaseModel):
    """
    Persist the selected source application and module.
    Values come from Structure Workspace (read-only); Discover stores only
    the selection, never mutates Structure. (AC-DWS-IMPORT-006)
    """

    source_application: str = Field(min_length=1)
    source_module: str | None = None
    application_ref_id: str | None = None
    module_ref_id: str | None = None


class StartImportCommand(BaseModel):
    """
    Trigger the governed import flow for W2-DWS-02.

    Requires source application (and optionally module) to be set before
    this can proceed — missing selection must be rejected (AC-DWS-IMPORT-002).
    """

    source_file_id: str = Field(min_length=1)
    actor: str = Field(min_length=1)


# ── Legacy MVP import command (kept for backward compatibility) ────────────────


class ImportColumnSeed(BaseModel):
    column_name: str = Field(min_length=1)
    detected_type: str = Field(min_length=1)
    sample_values: list[str] = Field(min_length=1)


class ImportDatasetCommand(BaseModel):
    source_name: str = Field(min_length=1)
    row_count: int = Field(ge=0)
    columns: list[ImportColumnSeed] = Field(min_length=1)


# ── Validation commands ───────────────────────────────────────────────────────


class ValidateImportCommand(BaseModel):
    """
    Trigger import validation against Admin-configured limits.
    (AC-DWS-VALIDATE-001 through AC-DWS-VALIDATE-006)
    """

    source_file_id: str = Field(min_length=1)
    actor: str = Field(min_length=1)
    # Parsed metadata from the uploaded file
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    has_header_row: bool = True
    column_labels: list[str] = Field(default_factory=list)


# ── Admin import config (read-only from Admin, used by ValidationService) ─────


class AdminImportConfig(BaseModel):
    """
    Import validation configuration owned by Admin.
    Discover reads this read-only — never writes to Admin-owned config.
    Defaults match sensible production limits; Admin overrides take precedence.
    """

    max_rows: int = 1_000_000                   # 1 M rows (Australian utility meter scale)
    max_columns: int = 500
    max_file_size_bytes: int = 100 * 1024 * 1024  # 100 MB — configurable via org setting
    require_header_row: bool = True
    duplicate_suffix_pattern: str = "__{n}"     # e.g. Revenue__2, Revenue__3



# ── Mapping commands (legacy MVP — kept unchanged) ────────────────────────────


class UpsertColumnMappingCommand(BaseModel):
    column_id: str = Field(min_length=1)
    target_node_id: str = Field(min_length=1)
    mapping_state: str = Field(pattern="^(confirmed|overridden)$")
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(min_length=1)


class RunChecksCommand(BaseModel):
    rule_version: str = Field(min_length=1, default="mvp-v1")


# ── Governed layer commands ───────────────────────────────────────────────────


class SetValueClassificationCommand(BaseModel):
    """
    One user decision on a proposed value-to-governed-instance classification.
    Discover proposes; this records what the user confirmed, corrected or rejected.
    """

    column_id: str = Field(min_length=1)
    source_value: str
    target_node_id: str | None = None
    state: str = Field(pattern="^(confirmed|rejected|suggested)$")


class ConfirmClassificationsCommand(BaseModel):
    """Accept every strong suggestion at once, leaving only the ambiguous ones."""

    column_id: str | None = None
    min_confidence: float = Field(ge=0, le=1, default=0.9)


class RemoveRuleCommand(BaseModel):
    rule_id: str = Field(min_length=1)
    column_id: str = ""


class RuleSelection(BaseModel):
    """
    One ticked governed rule, and what it needs to run.

    `comparator` and `value` are only read for a comparison; `values` only for
    an approved list. A uniqueness or mandatory rule carries none of them and
    that is not an omission — there is nothing to state.
    """

    rule_instance_id: str = ""
    rule_name: str = Field(min_length=1)
    check_type: str = Field(min_length=1)
    column_id: str = Field(min_length=1)
    comparator: str = ""
    value: float | None = None
    values: list[str] = Field(default_factory=list)
    severity: str = "high"


class BuildRulesCommand(BaseModel):
    """
    One Finish of the Rule Builder: the governance it draws on, and the rules
    ticked from it. Each selection becomes one rule on one field.
    """

    support_model_id: str = Field(min_length=1)
    relationship_type_ids: list[str] = Field(min_length=1)
    selections: list[RuleSelection] = Field(min_length=1)


class SetFieldRulesCommand(BaseModel):
    """
    The rules one field should have, as a whole list.

    Sending the whole selection rather than one change at a time means unticking
    needs no separate call, and the field can never end up holding a rule the
    person did not choose.
    """

    rule_definition_ids: list[str] = Field(default_factory=list)


class ConfigureRuleCommand(BaseModel):
    """
    Session configuration for one governed rule. Only the parameters a rule
    permits may be set here — a session never authors rule behaviour.
    """

    rule_id: str = Field(min_length=1)
    column_id: str = ""
    is_enabled: bool | None = None
    severity: str | None = None
    parameters: dict = Field(default_factory=dict)


# ── Response wrappers ─────────────────────────────────────────────────────────


class DiscoverySessionsResponse(BaseModel):
    items: list[DiscoverySessionSummary]


class SourceColumnsResponse(BaseModel):
    items: list[SourceColumnSummary]


class DiscoveryColumnsResponse(BaseModel):
    """W2-DWS persisted discovery columns (source_label + internal_name retained)."""

    items: list[DiscoveryColumnSummary]


class MappingsResponse(BaseModel):
    items: list[ColumnMappingSummary]


class ResultsResponse(BaseModel):
    execution: CheckExecutionSummary | None = None
    items: list[CheckResultSummary]


class ProfileResponse(BaseModel):
    profile: ColumnProfileSummary


class ValidationResultResponse(BaseModel):
    result: DiscoveryImportValidationResultSummary | None
    issues: list[DiscoveryImportValidationIssueSummary]


class SourceFileResponse(BaseModel):
    file: DiscoverySourceFileSummary | None


class SourceContextResponse(BaseModel):
    context: DiscoverySourceContextSummary | None


class OverviewResponse(BaseModel):
    overview: OverviewReadModel


class UpdateRetentionPolicyCommand(BaseModel):
    """
    How long an archived session is kept, and when the sweep runs.

    Both optional so the Admin page can change one without restating the
    other. The bounds are enforced where the values are stored rather than
    here, so a row written before a bound existed is still read within it.
    """

    #: 1 to 31 days. Anything outside is pulled to the nearest end.
    retention_days: int | None = None
    #: 0 to 23, UTC+0 — the hour the deletion job runs.
    purge_hour_utc: int | None = None


class StructureInstanceQualityCommand(BaseModel):
    """
    Which structure instances to read Discover quality results for, and from which run.

    `run_id` empty means the newest run. Naming one is how an earlier
    assessment is opened deliberately — the two are never merged, because two
    runs measured different bytes against possibly different rules.
    """

    item_ids: list[str] = Field(default_factory=list)
    run_id: str = ""
