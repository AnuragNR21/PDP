export type DefinitionStatus = 'draft' | 'active' | 'retired';
export type NodeStatus = 'draft' | 'active' | 'retired';
export type RelationshipKind = 'parent_child' | 'typed_link';
export type DiscoverSessionStatus =
  | 'draft' | 'ready' | 'running' | 'completed' | 'error'
  /** Retired after a quality run; deleted once the retention policy runs out. */
  | 'archived';
export type MappingState = 'suggested' | 'confirmed' | 'overridden';
export type Severity = 'low' | 'medium' | 'high';
export type ImprovePriority = 'low' | 'medium' | 'high';
export type ImproveCandidateStatus = 'open' | 'in_progress' | 'closed';
export type ProgramStatus = 'planned' | 'active' | 'in_progress' | 'blocked' | 'complete' | 'closed';
export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'verified';
export type VerificationOutcome = 'pending' | 'passed' | 'failed';
export type AccountabilityRoleCode = 'owner' | 'steward' | 'analyst' | 'manager' | 'assignee' | 'reviewer';
export type AccountabilityScopeType = 'node' | 'check_result' | 'candidate' | 'task';

export type AttentionSeverity = 'low' | 'medium' | 'high';
export type FollowUpQueueStatus = 'open' | 'in_progress' | 'resolved';

export type ImproveAttentionSignalSummary = {
  signal_id: string;
  signal_type: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  related_route: string;
  related_count: number;
  detected_at: string;
};

export type VerificationFollowUpSummary = {
  verification_id: string;
  candidate_id: string;
  candidate_title?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  outcome: VerificationOutcome;
  queue_status: FollowUpQueueStatus;
  due_date?: string | null;
  owner_party_id?: string | null;
  owner_party_name?: string | null;
  evidence_note: string;
  follow_up_note?: string | null;
  verified_at: string;
  updated_at: string;
};


export type HierarchyModelSummary = {
  model_id: string;
  name: string;
  purpose: string;
  owning_domain: string;
  status: DefinitionStatus;
};

export type NodeTypeSummary = {
  node_type_id: string;
  model_id: string;
  name: string;
  description: string;
  status: DefinitionStatus;
};

export type StructuralRuleSummary = {
  rule_id: string;
  model_id: string;
  parent_node_type_id: string;
  child_node_type_id: string;
  relationship_kind: RelationshipKind;
  status: DefinitionStatus;
  notes: string;
};

export type CanonicalNodeSummary = {
  node_id: string;
  model_id: string;
  node_type_id: string;
  name: string;
  badge: string;
  status: NodeStatus;
  parent_node_id?: string | null;
  sort_order?: number | null;
};

export type RelationshipInstanceSummary = {
  relationship_id: string;
  semantic_key: string;
  source_node_id: string;
  target_node_id: string;
  status: DefinitionStatus;
};

export type TreePathItem = {
  node_id: string;
  name: string;
  node_type_id: string;
  badge: string;
  depth: number;
};

export type ModelOverview = {
  models: HierarchyModelSummary[];
  node_types: NodeTypeSummary[];
  rules: StructuralRuleSummary[];
};

export type StructureTreeResponse = {
  items: CanonicalNodeSummary[];
};

export type StructurePathResponse = {
  items: TreePathItem[];
};

export type NodeDetail = {
  node: CanonicalNodeSummary;
  children: CanonicalNodeSummary[];
  relationships: RelationshipInstanceSummary[];
};

export type DiagramNodeSummary = {
  node_id: string;
  model_id: string;
  node_type_id: string;
  name: string;
  badge: string;
  level: number;
  x: number;
  y: number;
};

export type DiagramEdgeSummary = {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  semantic_key: string;
  projection_kind: 'hierarchy' | 'relationship';
};

export type DiagramProjectionSummary = {
  model_id: string;
  nodes: DiagramNodeSummary[];
  edges: DiagramEdgeSummary[];
};

export type MatrixAxisItem = {
  node_id: string;
  name: string;
  node_type_id: string;
  badge: string;
};

export type MatrixCellSummary = {
  row_node_id: string;
  column_node_id: string;
  relationship_id?: string | null;
  semantic_key?: string | null;
  linked: boolean;
};

export type MatrixProjectionSummary = {
  model_id: string;
  rows: MatrixAxisItem[];
  columns: MatrixAxisItem[];
  cells: MatrixCellSummary[];
};

export type RefreshRequest = {
  scope: 'workspace' | 'feature' | 'entity' | 'projection' | 'session';
  reason: string;
  targets: string[];
};

export type DiscoverySessionSummary = {
  session_id: string;
  name: string;
  source_name: string;
  status: DiscoverSessionStatus;
  created_at: string;
  updated_at: string;
  /** When it was archived. Empty when it is not archived. */
  archived_at: string;
  /** When the retention sweep will delete it. Empty when it is not archived. */
  purge_due_at: string;
};

// ── W2-DWS-FEATURE-01 types ────────────────────────────────────────────────

export type ImportStatus =
  | 'pending' | 'uploading' | 'uploaded' | 'validating'
  | 'validation_failed' | 'validated' | 'importing' | 'completed' | 'error';

export type ValidationStatus = 'pending' | 'passed' | 'failed' | 'warning';

export type ValidationIssueType =
  | 'max_columns_exceeded' | 'max_rows_exceeded' | 'missing_header_row'
  | 'duplicate_column_label' | 'unsupported_file_type' | 'empty_file';

export type DiscoverAuditOutcome = 'success' | 'failure' | 'rejected';

export type DiscoverySourceFileSummary = {
  source_file_id: string;
  session_id: string;
  original_filename: string;
  file_type: string;
  file_size_bytes: number;
  storage_ref: string;
  uploaded_by: string;
  uploaded_at: string;
  import_status: ImportStatus;
  created_at: string;
  updated_at: string;
};

export type DiscoverySourceContextSummary = {
  context_id: string;
  session_id: string;
  source_application: string;
  source_module?: string | null;
  application_ref_id?: string | null;
  module_ref_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type DiscoveryImportValidationResultSummary = {
  validation_result_id: string;
  session_id: string;
  source_file_id: string;
  validation_status: ValidationStatus;
  row_count?: number | null;
  column_count?: number | null;
  has_header_row?: boolean | null;
  blocking_failure: boolean;
  validated_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type DiscoveryImportValidationIssueSummary = {
  issue_id: string;
  validation_result_id: string;
  session_id: string;
  issue_type: ValidationIssueType;
  severity: string;
  is_blocking: boolean;
  column_ordinal?: number | null;
  original_label?: string | null;
  internal_name?: string | null;
  detail: string;
  created_at: string;
};

export type DiscoveryColumnSummary = {
  discovery_column_id: string;
  session_id: string;
  source_file_id: string;
  source_label: string;
  internal_name: string;
  inferred_datatype: string;
  ordinal: number;
  is_nullable: boolean;
  duplicate_group_key?: string | null;
  created_at: string;
};

export type SessionSummaryReadModel = {
  session_id: string;
  session_name: string;
  status: DiscoverSessionStatus;
  source_filename?: string | null;
  row_count?: number | null;
  column_count?: number | null;
  profiled_column_count?: number | null;
  profiled_column_pct?: number | null;
  dq_checks_run?: number | null;
  mappings_confirmed?: number | null;
  last_updated?: string | null;
  export_before_purge_enabled: boolean;
  last_export_at?: string | null;
  export_metadata_retained: boolean;
  source_application?: string | null;
  source_module?: string | null;
  session_completed_at?: string | null;
};

export type ColumnHighlightsReadModel = {
  total_columns: number;
  key_columns: number;
  high_cardinality_columns: number;
  null_columns: number;
};

export type DataQualityPanelReadModel = {
  total_checks: number;
  passed: number;
  warnings: number;
  failed: number;
};

export type MappingSummaryReadModel = {
  total_mappings: number;
  confirmed: number;
  suggested: number;
  unmapped: number;
};

export type OverviewReadModel = {
  session: SessionSummaryReadModel;
  column_highlights: ColumnHighlightsReadModel;
  data_quality: DataQualityPanelReadModel;
  mapping_summary: MappingSummaryReadModel;
};

export type StructureApplicationSummary = {
  application_ref_id: string;
  application_name: string;
  status: string;
  /**
   * How many nodes exist beneath this application in the model structure.
   * Zero means nothing can be mapped or quality-checked against it.
   */
  field_count?: number;
};

export type StructureModuleSummary = {
  module_ref_id: string;
  module_name: string;
  status: string;
};

export type SourceColumnSummary = {
  column_id: string;
  session_id: string;
  dataset_id: string;
  column_name: string;
  ordinal: number;
  detected_type: string;
  sample_values: string[];
};

export type ColumnProfileSummary = {
  profile_id: string;
  session_id: string;
  column_id: string;
  distinct_count: number;
  null_count: number;
  blank_count: number;
  inferred_kind: string;
  value_distribution: Array<{ value: string; count: number }>;
  profiled_at: string;
};

export type ColumnMappingSummary = {
  mapping_id: string;
  session_id: string;
  column_id: string;
  target_node_id: string;
  mapping_state: MappingState;
  confidence: number;
  rationale: string;
  target_name?: string | null;
};

export type CheckExecutionSummary = {
  execution_id: string;
  session_id: string;
  execution_status: string;
  rule_version: string;
  started_at: string;
  completed_at: string;
};

export type CheckResultSummary = {
  result_id: string;
  execution_id: string;
  session_id: string;
  column_id: string;
  target_node_id?: string | null;
  severity: Severity;
  message: string;
  metric_value: number;
  created_at: string;
  column_name?: string | null;
  target_name?: string | null;
};

export type AccountabilityPartySummary = {
  party_id: string;
  display_name: string;
  email: string;
  party_type: string;
  party_status: string;
};

export type AccountabilityAssignmentSummary = {
  assignment_id: string;
  scope_type: AccountabilityScopeType;
  scope_id: string;
  role_code: AccountabilityRoleCode;
  party_id: string;
  party_name: string;
  party_email: string;
  assignment_status: string;
  assigned_at: string;
};

export type ImpactSubjectType = 'node' | 'check_result';
export type ImpactAnalysisStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ImpactAnalysisSummary = {
  analysis_id: string;
  analysis_status: ImpactAnalysisStatus;
  subject_type: ImpactSubjectType;
  subject_id: string;
  seed_node_id: string;
  max_depth: number;
  include_relationships: boolean;
  created_at: string;
};

export type AffectedItemSummary = {
  affected_item_id: string;
  analysis_id: string;
  node_id: string;
  node_name: string;
  node_type_id: string;
  depth: number;
  reached_via: string;
  reached_from_node_id?: string | null;
};

export type ImpactPathSummary = {
  path_id: string;
  analysis_id: string;
  from_node_id: string;
  from_node_name: string;
  to_node_id: string;
  to_node_name: string;
  semantic_key: string;
  depth: number;
  path_order: number;
};

export type ImpactFindingSummary = {
  finding_id: string;
  analysis_id: string;
  target_node_id?: string | null;
  target_node_name?: string | null;
  severity: Severity;
  score: number;
  title: string;
  detail: string;
};

export type ImproveCandidateSummary = {
  candidate_id: string;
  analysis_id: string;
  finding_id: string;
  target_node_id?: string | null;
  target_name?: string | null;
  priority: ImprovePriority;
  title: string;
  detail: string;
  status: ImproveCandidateStatus;
  created_at: string;
};

export type WorkProgramSummary = {
  program_id: string;
  name: string;
  status: ProgramStatus;
  priority: ImprovePriority;
  owner_name: string;
  owner_party_id?: string | null;
  target_count: number;
  open_task_count: number;
  created_at: string;
};

export type RemediationTaskSummary = {
  task_id: string;
  program_id: string;
  candidate_id?: string | null;
  title: string;
  detail: string;
  status: TaskStatus;
  assignee_name: string;
  assignee_party_id?: string | null;
  due_date?: string | null;
  source_title?: string | null;
  priority: ImprovePriority;
};

export type VerificationEvidenceSummary = {
  verification_id: string;
  candidate_id: string;
  task_id?: string | null;
  result_id?: string | null;
  outcome: VerificationOutcome;
  evidence_note: string;
  follow_up_required: boolean;
  verified_at: string;
  verified_by_party_id?: string | null;
  verified_by_name?: string | null;
  candidate_title?: string | null;
  task_title?: string | null;
};

export type DashboardMetricSummary = {
  metric_key: string;
  metric_label: string;
  metric_value: number;
  unit: string;
  as_of: string;
  drill_target: string;
};

export type DashboardTrendPoint = {
  point_key: string;
  point_label: string;
  open_count: number;
  in_progress_count: number;
  closed_count: number;
};

export type DashboardSummary = {
  metrics: DashboardMetricSummary[];
  trend: DashboardTrendPoint[];
};

// ── Discover audit events ────────────────────────────────────────────────────
export type DiscoverAuditEventSummary = {
  audit_event_id: string;
  session_id: string | null;
  source_file_id: string | null;
  actor: string;
  action: string;
  outcome: DiscoverAuditOutcome;
  correlation_id: string | null;
  detail_json: Record<string, unknown>;
  created_at: string;
};
