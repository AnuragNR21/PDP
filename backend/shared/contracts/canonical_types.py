from typing import Literal

from pydantic import BaseModel

DefinitionStatus = Literal['draft', 'active', 'retired']
NodeStatus = Literal['draft', 'active', 'retired']
RelationshipKind = Literal['parent_child', 'typed_link']
DiscoverSessionStatus = Literal['draft', 'ready', 'running', 'completed', 'error', 'archived']
MappingState = Literal['suggested', 'confirmed', 'overridden']
Severity = Literal['low', 'medium', 'high']
ImprovePriority = Literal['low', 'medium', 'high']
ImproveCandidateStatus = Literal['open', 'in_progress', 'closed']
ProgramStatus = Literal['planned', 'active', 'in_progress', 'blocked', 'complete', 'closed']
TaskStatus = Literal['open', 'in_progress', 'blocked', 'done', 'verified']
VerificationOutcome = Literal['pending', 'passed', 'failed']
AccountabilityRoleCode = Literal['owner', 'steward', 'analyst', 'manager', 'assignee', 'reviewer']
AccountabilityScopeType = Literal['node', 'check_result', 'candidate', 'task']

# W2-DWS-FEATURE-01 types
ImportStatus = Literal['pending', 'uploading', 'uploaded', 'validating', 'validation_failed', 'validated', 'importing', 'completed', 'error']
ValidationStatus = Literal['pending', 'passed', 'failed', 'warning']
ValidationIssueType = Literal['max_columns_exceeded', 'max_rows_exceeded', 'missing_header_row', 'duplicate_column_label', 'unsupported_file_type', 'empty_file']
DiscoverAuditOutcome = Literal['success', 'failure', 'rejected']


AttentionSeverity = Literal['low', 'medium', 'high']
FollowUpQueueStatus = Literal['open', 'in_progress', 'resolved']


class ImproveAttentionSignalSummary(BaseModel):
    signal_id: str
    signal_type: str
    severity: AttentionSeverity
    title: str
    detail: str
    related_route: str
    related_count: int
    detected_at: str


class VerificationFollowUpSummary(BaseModel):
    verification_id: str
    candidate_id: str
    candidate_title: str | None = None
    task_id: str | None = None
    task_title: str | None = None
    outcome: VerificationOutcome
    queue_status: FollowUpQueueStatus
    due_date: str | None = None
    owner_party_id: str | None = None
    owner_party_name: str | None = None
    evidence_note: str
    follow_up_note: str | None = None
    verified_at: str
    updated_at: str


class HierarchyModelSummary(BaseModel):
    model_id: str
    name: str
    purpose: str
    owning_domain: str
    status: DefinitionStatus


class NodeTypeSummary(BaseModel):
    node_type_id: str
    model_id: str
    name: str
    description: str
    status: DefinitionStatus


class StructuralRuleSummary(BaseModel):
    rule_id: str
    model_id: str
    parent_node_type_id: str
    child_node_type_id: str
    relationship_kind: RelationshipKind
    status: DefinitionStatus
    notes: str


class CanonicalNodeSummary(BaseModel):
    node_id: str
    model_id: str
    node_type_id: str
    name: str
    badge: str
    status: NodeStatus
    parent_node_id: str | None = None
    sort_order: int | None = None


class RelationshipInstanceSummary(BaseModel):
    relationship_id: str
    semantic_key: str
    source_node_id: str
    target_node_id: str
    status: DefinitionStatus


class TreePathItem(BaseModel):
    node_id: str
    name: str
    node_type_id: str
    badge: str
    depth: int


class DiagramNodeSummary(BaseModel):
    node_id: str
    model_id: str
    node_type_id: str
    name: str
    badge: str
    level: int
    x: int
    y: int


class DiagramEdgeSummary(BaseModel):
    edge_id: str
    source_node_id: str
    target_node_id: str
    semantic_key: str
    projection_kind: Literal['hierarchy', 'relationship']


class DiagramProjectionSummary(BaseModel):
    model_id: str
    nodes: list[DiagramNodeSummary]
    edges: list[DiagramEdgeSummary]


class MatrixAxisItem(BaseModel):
    node_id: str
    name: str
    node_type_id: str
    badge: str


class MatrixCellSummary(BaseModel):
    row_node_id: str
    column_node_id: str
    relationship_id: str | None = None
    semantic_key: str | None = None
    linked: bool


class MatrixProjectionSummary(BaseModel):
    model_id: str
    rows: list[MatrixAxisItem]
    columns: list[MatrixAxisItem]
    cells: list[MatrixCellSummary]


class DiscoverySessionSummary(BaseModel):
    session_id: str
    name: str
    source_name: str
    status: DiscoverSessionStatus
    created_at: str
    updated_at: str
    #: When the session was archived. Empty means it is not archived.
    archived_at: str = ''
    #: When the retention sweep will delete it, given today's settings. Empty
    #: when it is not archived. Recomputed on every read rather than stored,
    #: because changing the retention setting has to move every countdown.
    purge_due_at: str = ''


class SourceColumnSummary(BaseModel):
    column_id: str
    session_id: str
    dataset_id: str
    column_name: str
    ordinal: int
    detected_type: str
    sample_values: list[str]


class ColumnProfileSummary(BaseModel):
    profile_id: str
    session_id: str
    column_id: str
    distinct_count: int
    null_count: int
    blank_count: int
    inferred_kind: str
    value_distribution: list[dict[str, int | str]]
    profiled_at: str


class ColumnMappingSummary(BaseModel):
    mapping_id: str
    session_id: str
    column_id: str
    target_node_id: str
    mapping_state: MappingState
    confidence: float
    rationale: str
    target_name: str | None = None


class CheckExecutionSummary(BaseModel):
    execution_id: str
    session_id: str
    execution_status: str
    rule_version: str
    started_at: str
    completed_at: str


class CheckResultSummary(BaseModel):
    result_id: str
    execution_id: str
    session_id: str
    column_id: str
    target_node_id: str | None = None
    severity: Severity
    message: str
    metric_value: float
    created_at: str
    column_name: str | None = None
    target_name: str | None = None


class AccountabilityPartySummary(BaseModel):
    party_id: str
    display_name: str
    email: str
    party_type: str
    party_status: str


class AccountabilityAssignmentSummary(BaseModel):
    assignment_id: str
    scope_type: AccountabilityScopeType
    scope_id: str
    role_code: AccountabilityRoleCode
    party_id: str
    party_name: str
    party_email: str
    assignment_status: str
    assigned_at: str


ImpactSubjectType = Literal['node', 'check_result']
ImpactAnalysisStatus = Literal['queued', 'running', 'completed', 'failed']


class ImpactAnalysisSummary(BaseModel):
    analysis_id: str
    analysis_status: ImpactAnalysisStatus
    subject_type: ImpactSubjectType
    subject_id: str
    seed_node_id: str
    max_depth: int
    include_relationships: bool
    created_at: str


class AffectedItemSummary(BaseModel):
    affected_item_id: str
    analysis_id: str
    node_id: str
    node_name: str
    node_type_id: str
    depth: int
    reached_via: str
    reached_from_node_id: str | None = None


class ImpactPathSummary(BaseModel):
    path_id: str
    analysis_id: str
    from_node_id: str
    from_node_name: str
    to_node_id: str
    to_node_name: str
    semantic_key: str
    depth: int
    path_order: int


class ImpactFindingSummary(BaseModel):
    finding_id: str
    analysis_id: str
    target_node_id: str | None = None
    target_node_name: str | None = None
    severity: Severity
    score: float
    title: str
    detail: str


class ImproveCandidateSummary(BaseModel):
    candidate_id: str
    analysis_id: str
    finding_id: str
    target_node_id: str | None = None
    target_name: str | None = None
    priority: ImprovePriority
    title: str
    detail: str
    status: ImproveCandidateStatus
    created_at: str


class WorkProgramSummary(BaseModel):
    program_id: str
    name: str
    status: ProgramStatus
    priority: ImprovePriority
    owner_name: str
    owner_party_id: str | None = None
    target_count: int
    open_task_count: int
    created_at: str


class RemediationTaskSummary(BaseModel):
    task_id: str
    program_id: str
    candidate_id: str | None = None
    title: str
    detail: str
    status: TaskStatus
    assignee_name: str
    assignee_party_id: str | None = None
    due_date: str | None = None
    source_title: str | None = None
    priority: ImprovePriority


class VerificationEvidenceSummary(BaseModel):
    verification_id: str
    candidate_id: str
    task_id: str | None = None
    result_id: str | None = None
    outcome: VerificationOutcome
    evidence_note: str
    follow_up_required: bool
    verified_at: str
    verified_by_party_id: str | None = None
    verified_by_name: str | None = None
    candidate_title: str | None = None
    task_title: str | None = None


class DashboardMetricSummary(BaseModel):
    metric_key: str
    metric_label: str
    metric_value: float
    unit: str
    as_of: str
    drill_target: str


class DashboardTrendPoint(BaseModel):
    point_key: str
    point_label: str
    open_count: int
    in_progress_count: int
    closed_count: int


class DashboardSummary(BaseModel):
    metrics: list[DashboardMetricSummary]
    trend: list[DashboardTrendPoint]


SettingsValueScope = Literal['organisation', 'preference']
AccessLevel = Literal['none', 'view', 'edit', 'admin']
IntegrationBaseStatus = Literal['healthy', 'warning', 'offline']


class OrganisationSettingSummary(BaseModel):
    setting_key: str
    setting_value: str
    description: str
    updated_at: str


class UserPreferenceSummary(BaseModel):
    preference_key: str
    preference_value: str
    description: str
    updated_at: str


class PermissionAssignmentSummary(BaseModel):
    permission_id: str
    role_code: str
    action_code: str
    access_level: AccessLevel
    updated_at: str


class IntegrationConfigSummary(BaseModel):
    integration_key: str
    display_name: str
    base_status: IntegrationBaseStatus
    config_json: dict[str, str]
    updated_at: str


class AuditRecordSummary(BaseModel):
    audit_id: str
    category: str
    action_code: str
    object_ref: str
    actor_label: str
    detail: str
    created_at: str


# ── W2-DWS-FEATURE-01: Discover read models ──────────────────────────────────

class DiscoverySourceFileSummary(BaseModel):
    source_file_id: str
    session_id: str
    original_filename: str
    file_type: str
    file_size_bytes: int
    storage_ref: str
    uploaded_by: str
    uploaded_at: str
    import_status: ImportStatus
    created_at: str
    updated_at: str


class DiscoverySourceContextSummary(BaseModel):
    context_id: str
    session_id: str
    source_application: str
    source_module: str | None = None
    application_ref_id: str | None = None
    module_ref_id: str | None = None
    created_at: str
    updated_at: str


class DiscoveryImportValidationResultSummary(BaseModel):
    validation_result_id: str
    session_id: str
    source_file_id: str
    validation_status: ValidationStatus
    row_count: int | None = None
    column_count: int | None = None
    has_header_row: bool | None = None
    blocking_failure: bool
    validated_at: str | None = None
    created_at: str
    updated_at: str


class DiscoveryImportValidationIssueSummary(BaseModel):
    issue_id: str
    validation_result_id: str
    session_id: str
    issue_type: ValidationIssueType
    severity: str
    is_blocking: bool
    column_ordinal: int | None = None
    original_label: str | None = None
    internal_name: str | None = None
    detail: str
    created_at: str


class DiscoveryColumnSummary(BaseModel):
    discovery_column_id: str
    session_id: str
    source_file_id: str
    source_label: str
    internal_name: str
    inferred_datatype: str
    ordinal: int
    is_nullable: bool
    duplicate_group_key: str | None = None
    created_at: str


class DiscoverAuditEventSummary(BaseModel):
    audit_event_id: str
    session_id: str | None = None
    source_file_id: str | None = None
    actor: str
    action: str
    outcome: DiscoverAuditOutcome
    correlation_id: str | None = None
    detail_json: dict
    created_at: str


# ── W2-DWS-FEATURE-01: Overview panel read models ────────────────────────────

class SessionSummaryReadModel(BaseModel):
    session_id: str
    session_name: str
    status: DiscoverSessionStatus
    source_filename: str | None = None
    row_count: int | None = None
    column_count: int | None = None
    profiled_column_count: int | None = None
    profiled_column_pct: float | None = None
    dq_checks_run: int | None = None
    mappings_confirmed: int | None = None
    last_updated: str | None = None
    export_before_purge_enabled: bool = False
    last_export_at: str | None = None
    export_metadata_retained: bool = False
    source_application: str | None = None
    source_module: str | None = None
    session_completed_at: str | None = None


class ColumnHighlightsReadModel(BaseModel):
    total_columns: int = 0
    key_columns: int = 0
    high_cardinality_columns: int = 0
    null_columns: int = 0


class DataQualityPanelReadModel(BaseModel):
    total_checks: int = 0
    passed: int = 0
    warnings: int = 0
    failed: int = 0


class MappingSummaryReadModel(BaseModel):
    total_mappings: int = 0
    confirmed: int = 0
    suggested: int = 0
    unmapped: int = 0


class OverviewReadModel(BaseModel):
    session: SessionSummaryReadModel
    column_highlights: ColumnHighlightsReadModel
    data_quality: DataQualityPanelReadModel
    mapping_summary: MappingSummaryReadModel
