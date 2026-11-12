import { apiClient } from "@/shared/http/apiClient";
import type {
  CheckExecutionSummary,
  CheckResultSummary,
  ColumnMappingSummary,
  ColumnProfileSummary,
  DiscoverAuditEventSummary,
  DiscoveryColumnSummary,
  DiscoveryImportValidationIssueSummary,
  DiscoveryImportValidationResultSummary,
  DiscoverySessionSummary,
  DiscoverySourceContextSummary,
  DiscoverySourceFileSummary,
  OverviewReadModel,
  RefreshRequest,
  SourceColumnSummary,
  StructureApplicationSummary,
  StructureModuleSummary
} from "@/shared/contracts";

// ── Commands ─────────────────────────────────────────────────────────────────

export type CreateDiscoverySessionCommand = {
  name: string;
  source_name?: string;
};

export type AttachSourceFileCommand = {
  original_filename: string;
  file_type: "csv" | "xlsx" | "xls";
  file_size_bytes: number;
  storage_ref: string;
  uploaded_by: string;
};

export type SetSourceContextCommand = {
  source_application: string;
  source_module?: string | null;
  application_ref_id?: string | null;
  module_ref_id?: string | null;
};

export type ValidateImportCommand = {
  source_file_id: string;
  actor: string;
  row_count: number;
  column_count: number;
  has_header_row: boolean;
  column_labels: string[];
};

// Legacy MVP commands (kept for backward compat)
export type ImportColumnSeed = {
  column_name: string;
  detected_type: string;
  sample_values: string[];
};

export type ImportDatasetCommand = {
  source_name: string;
  row_count: number;
  columns: ImportColumnSeed[];
};

export type QualityCheckType =
  | "completeness"
  | "uniqueness"
  | "type_conformance"
  | "duplicate_records"
  | "overlap"
  | "usability"
  // A rule that was turned on but could not run. Neither a pass nor a failure:
  // the governance behind it is unfinished, not the data.
  | "configuration_error"
  // Missing or placeholder values on a field somebody mapped. Reported by the
  // run because the field was mapped; never counted as a rule.
  | "mapped_field_issue"
  /** A governed rule the session enabled, run with its permitted parameters. */
  | "governed_rule";

/** How much of the data can be used as it stands, row by row. */
export type QualityUsability = {
  total_rows: number;
  usable_rows: number;
  unusable_rows: number;
  usable_percent: number;
  unusable_percent: number;
  rows_with_field_problems: number;
  duplicate_copies: number;
  /**
   * What is making rows unusable, worst first — a percentage on its own is
   * not something anyone can act on. Each entry is a rule and the number of
   * rows it breaks; a row breaking three rules appears in all three, so these
   * do not add up to `unusable_rows`.
   */
  reasons?: { key: string; label: string; rows: number; percent: number }[];
  /**
   * What the old structure-only count was: required/unique/datatype and
   * duplicates, with every governed rule left out. Kept so the two figures
   * can be told apart rather than silently replacing one with the other.
   */
  structure_only_unusable_rows?: number;
};

export type QualityStatus = "passed" | "warning" | "failed";

export type QualityFinding = {
  quality_check_id: string;
  scope: "column" | "dataset" | "governed";
  column_id: string | null;
  column_name: string;
  target_node_id: string | null;
  target_name: string | null;
  check_type: QualityCheckType;
  status: QualityStatus;
  /** Where the rule came from: "model structure", "field name" or "default". */
  rule_source: string;
  observed_count: number;
  total_count: number;
  metric_value: number;
  message: string;
  detail: {
    datatype?: string;
    required?: boolean;
    unique_required?: boolean;
    rule_source?: string;
    distinct_count?: number;
    invalid_examples?: string[];
    duplicate_values?: Array<{ value: string; count: number }>;
    example_rows?: number[];
    duplicate_groups?: number;
    duplicate_rows?: number;
    total_rows?: number;
    usable_rows?: number;
    unusable_rows?: number;
    usable_percent?: number;
    unusable_percent?: number;
    rows_with_field_problems?: number;
    duplicate_copies?: number;
    pairs?: Array<{ left: string; right: string; shared_count: number; samples: string[] }>;
    // Governed-rule findings carry the rule that produced them.
    rule_code?: string;
    rule_kind?: GovernedRuleKind;
    rule_name?: string;
    severity?: string;
    parameters?: Record<string, unknown>;
    needs_parameters?: boolean;
    allowed_values?: string[];
    pattern?: string;
    min_value?: number | null;
    max_value?: number | null;
    out_of_range_examples?: string[];
    non_numeric?: number;
    unresolved_values?: string[];
    limit_percent?: number;
    grouped_by?: string | null;
    groups?: Array<{
      group: string;
      numerator: number;
      denominator: number;
      share_percent: number;
    }>;
    breaches?: Array<{
      group: string;
      numerator: number;
      denominator: number;
      share_percent: number;
    }>;
  };
};

/** One place a rule was evaluated: a field, in a table. */
export type QualityRuleTarget = {
  quality_check_id: string;
  source_file_id: string;
  table_name: string;
  is_active_table: boolean;
  column_name: string;
  target_name: string | null;
  status: QualityStatus;
  observed_count: number;
  total_count: number;
  message: string;
  detail: QualityFinding["detail"];
};

/**
 * One rule, however many tables and fields it was run against.
 *
 * `severity` is what was set on the rule in the Rule Workspace. Automatic
 * checks were never given one, so theirs is empty — they are `kind:
 * "automatic"` and are shown apart rather than given a made-up level.
 */
export type QualityRuleSummary = {
  key: string;
  kind: "governed" | "automatic";
  code: string;
  name: string;
  severity: string;
  check_type: string;
  status: QualityStatus;
  runs: number;
  passed: number;
  warnings: number;
  failed: number;
  /** Distinct rows this rule flags, counted once however many of its fields a row breaks. */
  rows_flagged: number;
  /** Rows in the tables this rule ran on. rows_flagged can never exceed it. */
  rows_total: number;
  /** Offending values (cells). Always >= rows_flagged. */
  values_flagged: number;
  values_checked: number;
  /** False for a rule that measures a share rather than rows — it has no row count. */
  counts_rows: boolean;
  /** False when the rule counts something other than cells (pairs of fields, check groups). */
  counts_values: boolean;
  tables_checked: number;
  tables_failing_count: number;
  fields_failing_count: number;
  targets: QualityRuleTarget[];
};

export type QualityByRuleReport = {
  session_id: string;
  has_run: boolean;
  rules_run: number;
  rules_failing: number;
  rules_warning: number;
  rules_clean: number;
  governed_rules: number;
  automatic_checks: number;
  /** Distinct rows failing anything at all, summed over tables. */
  rows_flagged: number;
  rows_total: number;
  /** Offending values (cells) across every rule. */
  values_flagged: number;
  values_checked: number;
  tables_checked: number;
  /** Rules that were turned on but could not run. Never counted as a pass or
   *  a failure: the governance behind them is unfinished, not the data. */
  field_issue_count: number;
  field_issues: {
    column_name: string;
    target_name: string | null;
    table_name: string;
    issue: string;
    status: QualityStatus;
    observed_count: number;
    total_count: number;
    message: string;
  }[];
  configuration_error_count: number;
  configuration_errors: {
    rule_code: string;
    rule_name: string;
    column_name: string;
    target_name: string | null;
    table_name: string;
    reason: string;
  }[];
  table_names: string[];
  by_severity: Array<{
    severity: string;
    rules: number;
    failing: number;
    values_flagged: number;
  }>;
  worst_rule: {
    key: string;
    name: string;
    check_type: string;
    severity: string;
    kind: "governed" | "automatic";
    fields_failing_count: number;
    tables_failing_count: number;
    rows_flagged: number;
    values_flagged: number;
    counts_rows: boolean;
    counts_values: boolean;
  } | null;
  rules: QualityRuleSummary[];
};

/** One table's place in a quality run. */
export type QualityJob = {
  job_id: string;
  session_id: string;
  source_file_id: string;
  table_name: string;
  run_id: string;
  /** queued → running → succeeded | skipped | failed. */
  status: "waiting" | "queued" | "running" | "succeeded" | "skipped" | "failed";
  /** What it is doing right now, in words. */
  stage: string;
  progress: number;
  columns_done: number;
  columns_total: number;
  checked_columns: number;
  findings: number;
  failed_count: number;
  warnings: number;
  message: string;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
};

export type QualityRunProgress = {
  session_id: string;
  jobs: QualityJob[];
  tables_total: number;
  tables_done: number;
  waiting: number;
  running: number;
  succeeded: number;
  skipped: number;
  failed: number;
  /** The whole run, 0–100, averaged over the tables. */
  percent: number;
  is_working: boolean;
  has_run: boolean;
  findings: number;
  failing_checks: number;
};

/**
 * One completed quality run over one table — the evidence record.
 *
 * The snapshots are the part that matters: the mapping and the rules exactly
 * as they were when the run read them, not as they are now.
 */
export type QualityRun = {
  quality_run_id: string;
  session_id: string;
  source_file_id: string;
  table_name: string;
  execution_id: string;
  /** Ties the per-table runs of one "check every table" together. */
  run_group_id: string;
  status: string;
  file_hash: string;
  mapping_version: string;
  rule_version: string;
  mapping_snapshot: { column_id: string; column_name: string; target_node_id: string; target_name: string }[];
  rule_snapshot: QualityRuleSnapshot[];
  checked_columns: number;
  findings_total: number;
  failed_count: number;
  warning_count: number;
  rows_total: number;
  requested_by: string;
  completed_at: string;
  created_at: string;
  /** The distinct library rules and versions this run executed. */
  rule_versions: QualityRuleVersionUsed[];
};

export type QualityRuleSnapshot = {
  configuration_id: string;
  rule_id: string;
  code: string;
  name: string;
  rule_kind: string;
  check_type: string;
  applies_to: string;
  column_id: string;
  column_name: string;
  target_node_id: string;
  target_name: string;
  severity: string;
  parameters: Record<string, unknown>;
  source_rule_definition_id: string;
  source_rule_version: string;
};

export type QualityRuleVersionUsed = {
  rule_definition_id: string;
  version: string;
  code: string;
  name: string;
};

/** One check of the session: the per-table runs started together. */
export type QualityRunGroup = {
  run_group_id: string;
  key: string;
  completed_at: string;
  requested_by: string;
  tables: number;
  checked_columns: number;
  findings_total: number;
  failed_count: number;
  warning_count: number;
  rows_total: number;
  runs: QualityRun[];
  rule_versions: QualityRuleVersionUsed[];
};

export type QualityRunHistory = {
  session_id: string;
  items: QualityRun[];
  /** Per-table records. Two tables checked once is two. */
  total: number;
  groups: QualityRunGroup[];
  /** What a person means by "how many times has this been checked". */
  run_count: number;
  current_run_ids: string[];
};

export type QualityRunDetail = QualityRun & { findings: QualityFinding[] };

export type QualityReport = {
  session_id: string;
  /** The table these figures describe — this report is one table's, not the session's. */
  table_name: string;
  source_file_id: string;
  checked_columns: number;
  total_checks: number;
  /** Fields a governed rule actually ran on — not the number mapped. */
  assessed_columns: number;
  /** Distinct rules behind those checks. One rule on two fields is two checks. */
  rules_run: number;
  passed: number;
  warnings: number;
  failed: number;
  is_clean: boolean;
  has_run: boolean;
  usability: QualityUsability | null;
  governed_checks: number;
  governed_failed: number;
  findings: QualityFinding[];
};

// ── Governed layer: classify values, determine rules, set parameters ─────────

/**
 * Profile rules observe, Data Quality rules test a stated expectation, and
 * Business Quality rules apply governed semantics over mapped Structure
 * instances. All three are governed instances — a session never authors one.
 */
export type GovernedRuleKind = "profile" | "dq" | "bq";

export type ClassificationState = "suggested" | "confirmed" | "rejected";

/** One source value and the governed instance Discover proposes it stands for. */
export type ValueClassification = {
  classification_id: string;
  session_id: string;
  column_id: string;
  column_name: string;
  source_value: string;
  target_node_id: string | null;
  target_name: string | null;
  state: ClassificationState;
  confidence: number;
  /** How the suggestion was reached, e.g. "exact name" or "matches wording". */
  match_method: string;
  occurrences: number;
};

export type ClassificationReport = {
  session_id: string;
  items: ValueClassification[];
  /**
   * The governed instances each column may choose from — the ones declared
   * beneath the model field it was mapped to, keyed by column id. A value can
   * only mean something its own field declares, so there is no global list.
   */
  candidates_by_column: Record<string, StructureFieldOption[]>;
  /** Mapped fields whose model node declares no instances, so cannot classify. */
  fields_without_instances: string[];
  columns_with_values: number;
  confirmed: number;
  suggested: number;
  rejected: number;
  unmatched: number;
  high_confidence_pending: number;
  has_run: boolean;
  /** Only present on the response to a bulk confirm. */
  confirmed_now?: number;
};

/** A parameter a governed rule permits a session to set. */
export type PermittedParameter = {
  key: string;
  label: string;
  /** "choice" is picked from `options`; everything else is typed or selected. */
  type: "number" | "text" | "boolean" | "list" | "node" | "column" | "choice";
  default: unknown;
  help: string;
  /** Only populated for "choice": the values the checker understands. */
  options?: Array<{ value: string; label: string }>;
};

/** One governed rule as it applies to this session, with its configuration. */
export type RuleConfiguration = {
  configuration_id: string;
  session_id: string;
  rule_id: string;
  column_id: string;
  column_name: string;
  target_node_id: string | null;
  target_name: string | null;
  is_enabled: boolean;
  severity: string | null;
  parameters: Record<string, unknown>;
  code: string;
  rule_name: string;
  rule_kind: GovernedRuleKind;
  check_type: string;
  applies_to: "field" | "dataset" | "classification";
  default_severity: string;
  requires_parameters: boolean;
  permitted_parameters: PermittedParameter[];
  default_parameters: Record<string, unknown>;
};

/** One mapped field, the rules on it, and the rules that could be added. */
export type FieldRuleGroup = {
  column_id: string;
  column_name: string;
  target_node_id: string | null;
  target_name: string | null;
  datatype: string;
  rules: RuleConfiguration[];
};

export type RuleConfigurationReport = {
  session_id: string;
  items: RuleConfiguration[];
  /** The per-field view the rules screen is built from. */
  fields: FieldRuleGroup[];
  /** Rules that span the whole record rather than one field. */
  dataset_rules: RuleConfiguration[];
  total: number;
  enabled: number;
  by_kind: Record<GovernedRuleKind, number>;
  needs_parameters: number;
  has_run: boolean;
};

// ── Rule Builder ──────────────────────────────────────────────────────────
// The only way a rule enters a session: a Support Domain model, a cross-model
// relationship that binds it to a mapped field, and a condition.

/** One Support Domain model a session may draw governance from. */
export type SupportDomainModelOption = {
  model_id: string;
  name: string;
  description: string | null;
  status: string;
  element_count: number;
};

/** A mapped column a governed relationship reaches. */
export type ReachableColumn = {
  column_id: string;
  column_name: string;
  target_node_id: string;
  target_name: string;
  datatype: string;
};

/**
 * One cross-model relationship, seen from the chosen Support Domain model.
 *
 * `columns` is what makes it actionable — the session's mapped fields that sit
 * on the model type this relationship binds to. When it is empty the link is
 * still listed, with `unusable_reason` saying why, rather than quietly dropped.
 */
export type CrossModelLink = {
  relationship_type_id: string;
  relationship_name: string;
  relationship_description: string | null;
  status: string;
  direction: "outgoing" | "incoming";
  governed_item_type_id: string;
  governed_type_name: string;
  governed_type_display_name: string | null;
  bound_model_type: string;
  bound_item_type_id: string | null;
  bound_type_name: string | null;
  bound_model_name: string | null;
  bound_model_id: string | null;
  columns: ReachableColumn[];
  is_usable: boolean;
  unusable_reason: string;
};

/** An operator the builder offers. `sql` is null for the list comparator. */
export type RuleComparator = {
  key: string;
  symbol: string;
  label: string;
  sql: string | null;
};


/** What a check needs from the person before it can run. */
export type CheckKind = {
  check_type: string;
  label: string;
  /** "none" | "number" | "list" */
  needs: string;
  help: string;
};

/** One governed rule declared by a support model, for the checklist. */
export type GovernedRuleInstance = {
  instance_id: string;
  name: string;
  description: string | null;
  status: string;
  element_type_id: string;
  element_type_name: string;
  /** The check its wording implies — a suggestion the person can change. */
  suggested_check: string;
};

/** One category of governed rules — the element type they are declared under. */
export type GovernedRuleGroup = {
  element_id: string;
  name: string;
  display_name: string;
  instance_count: number;
  rules: GovernedRuleInstance[];
};

export type RuleCatalogReport = {
  support_model_id: string;
  /** Every rule the model declares, under its own category heading. */
  groups: GovernedRuleGroup[];
  total: number;
  check_kinds: CheckKind[];
  comparators: RuleComparator[];
};

/** One ticked rule and whatever its check needs. */
/** One library rule as the picker shows it — what it is, not how to set it up. */
export type LibraryRuleOffer = {
  rule_definition_id: string;
  /** Empty until the rule is chosen for this field; set once it is attached. */
  configuration_id: string;
  code: string;
  name: string;
  description: string;
  /** The team's own grouping — what the picker collapses and expands by. */
  category: string;
  dimension: string;
  /** The kind of field the rule was written for. */
  data_type: string;
  severity: string;
  check_label: string;
  statement: string;
  rationale: string;
  version: number;
  /** False when the rule was written for a different kind of field. */
  /** What kind of execution this rule needs, and whether the engine has it. */
  execution_scope: string;
  execution_scope_label: string;
  is_executable: boolean;
  /**
   * What governance says about this rule against this field.
   *
   * Four states, never a filter: "does not belong here" and "cannot run
   * anywhere yet" are different facts and a person acts on them differently.
   */
  applicability: {
    state: "applicable" | "compatible" | "mismatch" | "not_executable";
    label: string;
    reason: string;
  };
  suits_field: boolean;
  /** Set when the rule is listed but cannot be chosen yet (custom scripts). */
  blocked_reason: string;
};

export type FieldRuleGroupOffer = {
  column_id: string;
  column_name: string;
  target_name: string | null;
  data_type: string;
  /** The table this field belongs to — a session maps several. */
  source_file_id: string;
  table_name: string;
  is_active_table: boolean;
  /** Every rule that could apply, in a stable order that ticking never changes. */
  rules: LibraryRuleOffer[];
  chosen_ids: string[];
};

export type ParsedTableSummary = {
  /** The sheet's name, or the title above a block in a CSV. Empty for a plain file. */
  name: string;
  row_count: number;
  column_count: number;
  column_labels: string[];
};

export type UploadedSourceFiles = {
  /** The first source this upload produced — what the session now works on. */
  file: DiscoverySourceFileSummary;
  parsed: { row_count: number; column_count: number; column_labels: string[] };
  /** Every source it produced: one per sheet when the file was split, else one. */
  files: DiscoverySourceFileSummary[];
  tables: ParsedTableSummary[];
  /** Sheets the file holds that this import did not take. */
  unimported_sheets: string[];
  refresh: RefreshRequest;
};

export type FieldRuleReport = {
  session_id: string;
  fields: FieldRuleGroupOffer[];
  record_rules: LibraryRuleOffer[];
  record_chosen_ids: string[];
  attached_total: number;
  /** The tables that have mapped fields, in upload order. */
  tables: { source_file_id: string; name: string; fields: number }[];
  /** Every category the library uses, in the order each field groups by. */
  categories: string[];
  /** Rules the library holds that cannot run yet, named rather than hidden. */
  not_runnable: {
    code: string;
    name: string;
    execution_scope_label: string;
    reason: string;
  }[];
};

export type RuleSelection = {
  rule_instance_id: string;
  rule_name: string;
  check_type: string;
  column_id: string;
  comparator?: string;
  value?: number | null;
  values?: string[];
  severity?: string;
};

export type CrossModelLinkReport = {
  session_id: string;
  support_model_id: string;
  links: CrossModelLink[];
  total: number;
  /** How many links reach a mapped field. A hint, not a gate. */
  usable: number;
  /** Every field of this session a rule may be set on. */
  mapped_columns: ReachableColumn[];
  comparators: RuleComparator[];
};

/** One uploaded file in a session. A session may hold several. */
export type SessionSourceFile = {
  source_file_id: string;
  original_filename: string;
  file_type: string;
  file_size_bytes: number;
  /** "sha256:…" — ties every stored result back to the exact bytes checked. */
  storage_ref: string;
  uploaded_by: string;
  uploaded_at: string;
  import_status: string;
  /** The upload this table came out of — several tables can share one. */
  origin_filename: string;
  /** The sheet or block it was inside that upload; empty for a one-table file. */
  sheet_name: string;
  /** True for the file the session is currently working on. */
  is_active: boolean;
  row_count: number | null;
  column_count: number | null;
  /** How far this one table has got, so a session of seven can be read at a glance. */
  mapped_columns: number;
  rules_attached: number;
  /** Findings stored from the last quality run; 0 means it has not been run. */
  findings: number;
  failing_checks: number;
};

export type ProfiledTable = {
  source_file_id: string;
  name: string;
  status: "profiled" | "failed";
  row_count: number | null;
  column_count: number | null;
  validation_status: string;
  /** Why this one could not be profiled, when it could not. */
  reason: string;
};

export type ProfileAllReport = {
  session_id: string;
  tables: ProfiledTable[];
  profiled: number;
  failed: number;
  active_source_file_id: string;
};

export type CheckedTable = {
  source_file_id: string;
  name: string;
  status: "checked" | "skipped" | "failed";
  /** Why it was skipped or could not run. */
  reason: string;
  checked_columns: number;
  findings: number;
  failed: number;
  warnings: number;
};

export type QualityRunAllReport = {
  session_id: string;
  tables: CheckedTable[];
  checked: number;
  skipped: number;
  failed: number;
  active_source_file_id: string;
  /** The findings of the table left on screen, so the step can show them at once. */
  report: unknown;
};

export type ImportJob = {
  job_id: string;
  session_id: string;
  filename: string;
  file_size_bytes: number;
  /** waiting → queued → running → succeeded | failed. */
  status: "waiting" | "queued" | "running" | "succeeded" | "failed";
  /** What it is doing right now, in words. */
  stage: string;
  progress: number;
  rows_done: number;
  rows_total: number;
  tables_created: number;
  table_names: string[];
  /** Why it failed, or what could not be profiled. */
  message: string;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type ImportProgress = {
  session_id: string;
  jobs: ImportJob[];
  waiting: number;
  running: number;
  succeeded: number;
  failed: number;
  /** True while anything is queued or running — what the poll follows. */
  is_working: boolean;
  tables_created: number;
};

export type SourceFileList = {
  session_id: string;
  items: SessionSourceFile[];
};

/** What auto-mapping did, so the user knows what to review. */
export type AutoMapResult = {
  session_id: string;
  mapped: Array<{
    column_id: string;
    column_name: string;
    target_node_id: string;
    target_name: string;
    target_path: string;
    confidence: number;
    method: string;
  }>;
  unmatched: string[];
  already_mapped: number;
};

/** A mapping target: one node in the selected application's structure tree. */
export type StructureFieldOption = {
  node_id: string;
  name: string;
  /** Full path from the application down to this node, e.g. "Accounts > Phone". */
  path: string;
  depth: number;
  parent_node_id: string | null;
  node_type: string | null;
  /** True when the node has no children — a mappable field rather than a group. */
  is_leaf: boolean;
};

export type UpsertColumnMappingCommand = {
  column_id: string;
  target_node_id: string;
  mapping_state: "confirmed" | "overridden";
  confidence: number;
  rationale: string;
};

/** Why the Archive button is or is not offered on a session. */
export type ArchiveEligibility = {
  can_archive: boolean;
  is_archived?: boolean;
  /** Plain words for the tooltip when the button is disabled. */
  reason: string;
  retention_days?: number;
  purge_due_at?: string;
};

/** The retention policy, plus what the sweep last did and when it runs next. */
export type RetentionStatus = {
  /** 1–31. How long an archived session is kept before it is deleted. */
  retention_days: number;
  /** 0–23, UTC+0. The hour the deletion job runs. */
  purge_hour_utc: number;
  last_run_at: string;
  last_deleted_count: number;
  last_outcome: string;
  next_run_at: string;
  /** How many sessions are archived right now. */
  archived_sessions: number;
  /** How many of those are already past their retention. */
  due_now: number;
  /**
   * When the first archived session falls out of retention, or "" if none are
   * archived. Without it, a sweep that correctly deletes nothing is
   * indistinguishable on screen from a sweep that is not running.
   */
  next_due_at: string;
};

// ── W2-DWS API ───────────────────────────────────────────────────────────────

/**
 * Where a table came from: the Application (an instance of a governed model,
 * e.g. GIS in the Applications model) that produced it. Separate from the
 * model a table's columns are mapped against.
 */
export type SourceApplication = {
  association_id: string;
  model_kind: "hierarchy" | "support";
  model_id: string;
  model_name: string | null;
  model_status: string | null;
  instance_id: string;
  instance_name: string | null;
  instance_type_name: string | null;
  instance_status: string | null;
  /** The recorded model or instance no longer exists in PDP. */
  missing: boolean;
  set_by: string;
  updated_at: string;
};

export type SourceApplicationItem = {
  session_id: string;
  source_file_id: string;
  source_name: string;
  application: SourceApplication | null;
  /** Records made under the current provenance — changing it asks first. */
  dependents: { mappings: number; quality_findings: number };
};

export type SetSourceApplicationCommand = {
  model_kind: "hierarchy" | "support";
  model_id: string;
  instance_id: string;
  confirm?: boolean;
};

export const discoverApi = {
  // Sessions
  listSessions: (archived?: boolean) =>
    apiClient.get<{ items: DiscoverySessionSummary[] }>(
      archived === undefined
        ? "/api/discover/sessions"
        : `/api/discover/sessions?archived=${archived}`
    ),

  /** Whether the Archive button should be offered, and why not when it should not. */
  archiveEligibility: (sessionId: string) =>
    apiClient.get<ArchiveEligibility>(
      `/api/discover/sessions/${sessionId}/archive-eligibility`
    ),

  archiveSession: (sessionId: string) =>
    apiClient.post<{
      session: DiscoverySessionSummary;
      retention_days: number;
      refresh: RefreshRequest;
    }>(`/api/discover/sessions/${sessionId}/archive`, {}),

  restoreSession: (sessionId: string) =>
    apiClient.post<{ session: DiscoverySessionSummary; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/restore`,
      {}
    ),

  // Retention — how long an archived session is kept, and when the sweep runs
  getRetention: () => apiClient.get<RetentionStatus>("/api/discover/retention"),

  updateRetention: (payload: { retention_days?: number; purge_hour_utc?: number }) =>
    apiClient.put<RetentionStatus>("/api/discover/retention", payload),

  runRetentionNow: () =>
    apiClient.post<{ deleted: number; failed: number; status: RetentionStatus }>(
      "/api/discover/retention/run",
      {}
    ),

  createSession: (payload: CreateDiscoverySessionCommand) =>
    apiClient.post<{ session: DiscoverySessionSummary; refresh: RefreshRequest }>(
      "/api/discover/sessions",
      payload
    ),

  getSession: (sessionId: string) =>
    apiClient.get<{ session: DiscoverySessionSummary }>(`/api/discover/sessions/${sessionId}`),

  // Overview (AC-DWS-SHELL-003, AC-DWS-SHELL-004)
  getOverview: (sessionId: string) =>
    apiClient.get<{ overview: OverviewReadModel }>(
      `/api/discover/sessions/${sessionId}/overview`
    ),

  // Source file (AC-DWS-IMPORT-001, AC-DWS-IMPORT-007)
  attachSourceFile: (sessionId: string, payload: AttachSourceFileCommand) =>
    apiClient.post<{ file: DiscoverySourceFileSummary; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/files`,
      payload
    ),

  getSourceFile: (sessionId: string) =>
    apiClient.get<{ file: DiscoverySourceFileSummary | null }>(
      `/api/discover/sessions/${sessionId}/files`
    ),

  /**
   * Uploads the real file bytes. The server parses the CSV/Excel, stores every
   * row as JSON in Postgres, and returns the file's true row/column counts.
   * Replaces any file already attached to the session.
   */
  /**
   * Hand over one file. The request stores it and returns; reading it — the
   * sheets, the rows, the profile — is a job the workers pick up when Start
   * Import runs, and `importProgress` is how that job is followed.
   */
  /**
   * Send one file's bytes. `onProgress` is what makes a 100 MB upload visible
   * — without it the screen has nothing to show until the server replies.
   */
  uploadSourceFile: (
    sessionId: string,
    file: File,
    onProgress?: (sentBytes: number, totalBytes: number) => void,
    uploadedBy = "user",
    signal?: AbortSignal
  ) =>
    apiClient.postRawWithProgress<{ job: ImportJob; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/files/upload?filename=${encodeURIComponent(file.name)}` +
        `&uploaded_by=${encodeURIComponent(uploadedBy)}`,
      file,
      onProgress,
      signal
    ),

  replaceSourceFile: (sessionId: string, payload: AttachSourceFileCommand) =>
    apiClient.put<{ file: DiscoverySourceFileSummary; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/files`,
      payload
    ),

  // Source context (AC-DWS-IMPORT-003, AC-DWS-IMPORT-006)
  setSourceContext: (sessionId: string, payload: SetSourceContextCommand, actor = "user") =>
    apiClient.post<{ context: DiscoverySourceContextSummary; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/context?actor=${encodeURIComponent(actor)}`,
      payload
    ),

  getSourceContext: (sessionId: string) =>
    apiClient.get<{ context: DiscoverySourceContextSummary | null }>(
      `/api/discover/sessions/${sessionId}/context`
    ),

  // Start import gate (AC-DWS-IMPORT-002, AC-DWS-SHELL-006)
  startImport: (sessionId: string, sourceFileId: string, actor = "user") =>
    apiClient.post<{ session_id: string; source_file_id: string; status: string; message: string }>(
      `/api/discover/sessions/${sessionId}/start-import?actor=${encodeURIComponent(actor)}`,
      { source_file_id: sourceFileId, actor }
    ),

  // Validation (AC-DWS-VALIDATE-001 to 006)
  runValidation: (sessionId: string, payload: ValidateImportCommand) =>
    apiClient.post<{
      result: DiscoveryImportValidationResultSummary;
      issues: DiscoveryImportValidationIssueSummary[];
      normalised_columns: Array<{
        source_label: string;
        internal_name: string;
        inferred_datatype: string;
        ordinal: number;
        is_nullable: boolean;
        duplicate_group_key: string | null;
      }>;
      refresh: RefreshRequest;
    }>(`/api/discover/sessions/${sessionId}/validate`, payload),

  getValidationResult: (sessionId: string) =>
    apiClient.get<{
      result: DiscoveryImportValidationResultSummary | null;
      issues: DiscoveryImportValidationIssueSummary[];
    }>(`/api/discover/sessions/${sessionId}/validation`),

  // Discovery columns (AC-DWS-COLUMN-001 to 004)
  listDiscoveryColumns: (sessionId: string) =>
    apiClient.get<{ items: DiscoveryColumnSummary[] }>(
      `/api/discover/sessions/${sessionId}/discovery-columns`
    ),

  /**
   * Runs profiling on the server against the rows already persisted in Postgres:
   * validates the file's real shape, persists discovery columns, and computes
   * per-column missing / non-missing / distinct statistics.
   */
  runProfiling: (sessionId: string, actor = "user") =>
    apiClient.post<{
      session_id: string;
      source_file_id: string;
      row_count: number;
      column_count: number;
      columns: Array<{
        column_name: string;
        detected_type: string;
        total_rows: number;
        missing: number;
        non_missing: number;
        distinct_values: number;
      }>;
      validation_status: string;
      refresh: RefreshRequest;
    }>(`/api/discover/sessions/${sessionId}/profile?actor=${encodeURIComponent(actor)}`),

  /**
   * Profiles one column from the persisted rows: totals, missing/non-missing
   * and the field's real distinct values (variants) with their counts.
   */
  getColumnProfile: (sessionId: string, discoveryColumnId: string, limit = 50) =>
    apiClient.get<{
      discovery_column_id: string;
      source_label: string;
      internal_name: string;
      inferred_datatype: string;
      ordinal: number;
      is_nullable: boolean;
      total_rows: number;
      missing: number;
      non_missing: number;
      distinct_count: number;
      values: Array<{ value: string; is_missing: boolean; count: number; percent: number }>;
      /** Smallest/largest value and text length — automatic, no rule needed. */
      extremes: {
        min_value: string | null;
        max_value: string | null;
        min_length: number | null;
        max_length: number | null;
      };
      /** The shapes values take, e.g. "A-999", most common first. */
      patterns: Array<{ pattern: string; count: number; example: string }>;
      /** Numbers far outside the middle of the distribution (interquartile rule). */
      outliers: {
        count: number;
        lower_bound: string | null;
        upper_bound: string | null;
        samples: Array<{ value: string; row_number: number }>;
        numeric_values: number;
      };
      /** Values that do not parse as the column's inferred type. */
      parse_errors: { count: number; examples: string[]; expected: string };
    }>(
      `/api/discover/sessions/${sessionId}/columns/${discoveryColumnId}/profile?limit=${limit}`
    ),

  /**
   * Checks the stored data against the model structure. Only columns mapped to
   * a model field are checked.
   */
  runQualityChecks: (sessionId: string, actor = "user") =>
    apiClient.post<QualityReport>(
      `/api/discover/sessions/${sessionId}/quality/run?actor=${encodeURIComponent(actor)}`
    ),

  /** The persisted findings from the last quality run. */
  getQualityReport: (sessionId: string) =>
    apiClient.get<QualityReport>(`/api/discover/sessions/${sessionId}/quality`),

  /** Every run the session has completed, newest first, and grouped. */
  getQualityRuns: (sessionId: string) =>
    apiClient.get<QualityRunHistory>(`/api/discover/sessions/${sessionId}/quality/runs`),

  /** One run: its snapshots and the findings it wrote, unchanged since. */
  getQualityRun: (sessionId: string, qualityRunId: string) =>
    apiClient.get<QualityRunDetail>(
      `/api/discover/sessions/${sessionId}/quality/runs/${qualityRunId}`,
    ),

  // ── Classify values ─────────────────────────────────────────────────────
  /**
   * Propose the governed instance each distinct value stands for — KIOSK →
   * Kiosk Transformer. Suggestions only: nothing is applied until confirmed.
   */
  suggestClassifications: (sessionId: string, actor = "user") =>
    apiClient.post<ClassificationReport>(
      `/api/discover/sessions/${sessionId}/classifications/suggest?actor=${encodeURIComponent(actor)}`
    ),

  getClassifications: (sessionId: string) =>
    apiClient.get<ClassificationReport>(`/api/discover/sessions/${sessionId}/classifications`),

  /** Confirm, correct or reject one proposed classification. */
  setClassification: (
    sessionId: string,
    payload: {
      column_id: string;
      source_value: string;
      target_node_id: string | null;
      state: ClassificationState;
    },
    actor = "user"
  ) =>
    apiClient.post<ClassificationReport>(
      `/api/discover/sessions/${sessionId}/classifications/decide?actor=${encodeURIComponent(actor)}`,
      payload
    ),

  /** Accept every strong suggestion at once, leaving only the ambiguous ones. */
  confirmClassifications: (
    sessionId: string,
    payload: { column_id?: string | null; min_confidence?: number } = {},
    actor = "user"
  ) =>
    apiClient.post<ClassificationReport>(
      `/api/discover/sessions/${sessionId}/classifications/confirm-suggested?actor=${encodeURIComponent(actor)}`,
      { column_id: payload.column_id ?? null, min_confidence: payload.min_confidence ?? 0.9 }
    ),

  // ── Governed rules ──────────────────────────────────────────────────────
  /** Work out which governed rules apply to what this session mapped. */
  determineGovernedRules: (sessionId: string, actor = "user") =>
    apiClient.post<RuleConfigurationReport>(
      `/api/discover/sessions/${sessionId}/governed-rules/determine?actor=${encodeURIComponent(actor)}`
    ),

  getGovernedRules: (sessionId: string) =>
    apiClient.get<RuleConfigurationReport>(`/api/discover/sessions/${sessionId}/governed-rules`),

  /** Take a rule off a field. */
  removeGovernedRule: (
    sessionId: string,
    payload: { rule_id: string; column_id?: string },
    actor = "user"
  ) =>
    apiClient.post<RuleConfigurationReport>(
      `/api/discover/sessions/${sessionId}/governed-rules/remove?actor=${encodeURIComponent(actor)}`,
      { rule_id: payload.rule_id, column_id: payload.column_id ?? "" }
    ),

  // ── Rule library: choosing which rules apply to which field ─────────────
  /** Each mapped field, the library rules on it, and the ones it could have. */
  listFieldRules: (sessionId: string) =>
    apiClient.get<FieldRuleReport>(`/api/discover/sessions/${sessionId}/rule-library/fields`),

  /** Make the rules on one field exactly these. Unticking is the same call. */
  setFieldRules: (sessionId: string, columnId: string, ruleDefinitionIds: string[]) =>
    apiClient.put<FieldRuleReport>(
      `/api/discover/sessions/${sessionId}/rule-library/fields/${columnId}`,
      { rule_definition_ids: ruleDefinitionIds },
    ),

  /** The same, for rules that read whole records. */
  setRecordRules: (sessionId: string, ruleDefinitionIds: string[]) =>
    apiClient.put<FieldRuleReport>(
      `/api/discover/sessions/${sessionId}/rule-library/record-rules`,
      { rule_definition_ids: ruleDefinitionIds },
    ),

  // ── Rule Builder ────────────────────────────────────────────────────────
  /** The Support Domain models a session may draw governance from. */
  listRuleBuilderSupportModels: () =>
    apiClient.get<{ models: SupportDomainModelOption[] }>(
      `/api/discover/rule-builder/support-models`
    ),

  /**
   * The cross-model relationships of one Support Domain model, already resolved
   * against what this session has mapped.
   */
  listRuleBuilderLinks: (sessionId: string, supportModelId: string) =>
    apiClient.get<CrossModelLinkReport>(
      `/api/discover/sessions/${sessionId}/rule-builder/links` +
        `?support_model_id=${encodeURIComponent(supportModelId)}`
    ),

  /**
   * Every rule a support model declares, grouped by category, each with the
   * check its wording implies.
   */
  listRuleBuilderRules: (sessionId: string, supportModelId: string) =>
    apiClient.get<RuleCatalogReport>(
      `/api/discover/sessions/${sessionId}/rule-builder/rules` +
        `?support_model_id=${encodeURIComponent(supportModelId)}`
    ),

  /** Finish the builder: each ticked governed rule becomes one session rule. */
  buildRules: (
    sessionId: string,
    payload: {
      support_model_id: string;
      relationship_type_ids: string[];
      selections: RuleSelection[];
    },
    actor = "user"
  ) =>
    apiClient.post<RuleConfigurationReport>(
      `/api/discover/sessions/${sessionId}/rule-builder/rules?actor=${encodeURIComponent(actor)}`,
      payload
    ),

  // ── Files in a session ──────────────────────────────────────────────────
  /** Every file in the session, with the one being worked on marked. */
  listSourceFiles: (sessionId: string) =>
    apiClient.get<SourceFileList>(`/api/discover/sessions/${sessionId}/source-files`),

  /**
   * Switch which file the session works on. Columns, mappings, rules and
   * results are all scoped to a file, so this changes what every step shows.
   */
  activateSourceFile: (sessionId: string, sourceFileId: string, actor = "user") =>
    apiClient.post<SourceFileList>(
      `/api/discover/sessions/${sessionId}/source-files/${sourceFileId}/activate?actor=${encodeURIComponent(actor)}`
    ),

  /** Set the workers going on every file this session has uploaded. */
  runImport: (sessionId: string, actor = "user") =>
    apiClient.post<ImportProgress>(
      `/api/discover/sessions/${sessionId}/import/run?actor=${encodeURIComponent(actor)}`
    ),

  /**
   * How far each uploaded file has got. Asking also restarts anything the
   * server dropped, so a reload is enough to get an import moving again.
   */
  importProgress: (sessionId: string) =>
    apiClient.get<ImportProgress>(`/api/discover/sessions/${sessionId}/import/progress`),

  /** Profile every table of the session in one run. */
  profileAllTables: (sessionId: string, actor = "user") =>
    apiClient.post<ProfileAllReport>(
      `/api/discover/sessions/${sessionId}/profile-all?actor=${encodeURIComponent(actor)}`
    ),

  /** Run the quality checks on every mapped table of the session. */
  runQualityChecksEverywhere: (sessionId: string, actor = "user") =>
    apiClient.post<QualityRunAllReport>(
      `/api/discover/sessions/${sessionId}/quality/run-all?actor=${encodeURIComponent(actor)}`
    ),

  /**
   * Queue a check for every table and return at once. The workers run the
   * tables together; the screen watches `qualityProgress`.
   */
  startQualityRun: (sessionId: string, actor = "user") =>
    apiClient.post<QualityRunProgress>(
      `/api/discover/sessions/${sessionId}/quality/start?actor=${encodeURIComponent(actor)}`
    ),

  /**
   * How far the run has got, table by table. Asking also restarts a run the
   * server dropped, so reopening the page picks it back up.
   */
  qualityProgress: (sessionId: string) =>
    apiClient.get<QualityRunProgress>(
      `/api/discover/sessions/${sessionId}/quality/progress`
    ),

  /**
   * The last run's findings grouped by the rule that produced them, across
   * every table — not just the one on screen.
   */
  getQualityByRule: (sessionId: string) =>
    apiClient.get<QualityByRuleReport>(
      `/api/discover/sessions/${sessionId}/quality/by-rule`
    ),

  /** Remove an uploaded file and every table it produced. */
  removeUpload: (sessionId: string, filename: string, actor = "user") =>
    apiClient.delete<SourceFileList>(
      `/api/discover/sessions/${sessionId}/uploads?filename=${encodeURIComponent(filename)}` +
        `&actor=${encodeURIComponent(actor)}`
    ),

  /** Remove one file and everything derived from it. */
  removeSourceFile: (sessionId: string, sourceFileId: string, actor = "user") =>
    apiClient.delete<SourceFileList>(
      `/api/discover/sessions/${sessionId}/source-files/${sourceFileId}?actor=${encodeURIComponent(actor)}`
    ),

  // ── Assisted mapping ────────────────────────────────────────────────────
  /** Pair columns with model fields automatically; every pairing stays editable. */
  autoMap: (sessionId: string, actor = "user") =>
    apiClient.post<AutoMapResult>(
      `/api/discover/sessions/${sessionId}/mappings/auto?actor=${encodeURIComponent(actor)}`
    ),

  /** Set only what a rule permits a session to set. */
  configureGovernedRule: (
    sessionId: string,
    payload: {
      rule_id: string;
      column_id?: string;
      is_enabled?: boolean | null;
      severity?: string | null;
      parameters?: Record<string, unknown>;
    },
    actor = "user"
  ) =>
    apiClient.post<RuleConfigurationReport>(
      `/api/discover/sessions/${sessionId}/governed-rules/configure?actor=${encodeURIComponent(actor)}`,
      {
        rule_id: payload.rule_id,
        column_id: payload.column_id ?? "",
        is_enabled: payload.is_enabled ?? null,
        severity: payload.severity ?? null,
        parameters: payload.parameters ?? {}
      }
    ),

  /**
   * The parsed file's headers plus a page of its real data rows.
   *
   * Cheap by design — a shape lookup and one indexed page. The duplicate-row
   * figure is deliberately not here; it reads every row, so it has its own
   * call and the preview never waits on it.
   */
  getDataset: (sessionId: string, limit = 50, offset = 0) =>
    apiClient.get<{
      column_labels: string[];
      internal_names: string[];
      row_count: number;
      column_count: number;
      rows: Array<{ row_number: number; row_data: Record<string, string> }>;
    }>(`/api/discover/sessions/${sessionId}/dataset?limit=${limit}&offset=${offset}`),

  /**
   * The automatic risk observations of the last run: missing values, repeated
   * records, overlapping fields, values that do not parse.
   *
   * These belong to the Profile stage. The Quality Check stage reports the
   * governed DQ and BQ rules and nothing else, so the two never share a total.
   */
  getProfileObservations: (sessionId: string, sourceFileId = "") =>
    apiClient.get<{
      session_id: string;
      has_run: boolean;
      total: number;
      needs_attention: number;
      observations: Array<{
        quality_check_id: string;
        column_id: string | null;
        column_name: string;
        target_name: string | null;
        check_type: string;
        status: QualityStatus;
        observed_count: number;
        total_count: number;
        message: string;
        detail: Record<string, unknown>;
      }>;
      by_check: Array<{
        check_type: string;
        label: string;
        total: number;
        needs_attention: number;
      }>;
    }>(
      `/api/discover/sessions/${sessionId}/profile-observations` +
        (sourceFileId ? `?source_file_id=${encodeURIComponent(sourceFileId)}` : "")
    ),

  /** How many stored rows are exact copies of another. Reads every row. */
  getDatasetDuplicates: (sessionId: string) =>
    apiClient.get<{ duplicate_row_count: number; duplicate_groups: number }>(
      `/api/discover/sessions/${sessionId}/dataset/duplicates`
    ),

  persistDiscoveryColumns: (
    sessionId: string,
    sourceFileId: string,
    normalisedColumns: Array<Record<string, unknown>>,
    actor = "user"
  ) =>
    apiClient.post<{ columns: DiscoveryColumnSummary[]; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/discovery-columns?source_file_id=${encodeURIComponent(sourceFileId)}&actor=${encodeURIComponent(actor)}`,
      normalisedColumns
    ),

  // Structure read-only context (AC-DWS-IMPORT-006)
  listApplications: () =>
    apiClient.get<{ items: StructureApplicationSummary[] }>("/api/discover/structure/applications"),

  listModules: (applicationRefId: string) =>
    apiClient.get<{ items: StructureModuleSummary[] }>(
      `/api/discover/structure/applications/${applicationRefId}/modules`
    ),

  /**
   * Every node beneath the selected source application, flattened with its full
   * path — the model fields a source column can be mapped to.
   */
  listApplicationFields: (applicationRefId: string) =>
    apiClient.get<{ items: StructureFieldOption[] }>(
      `/api/discover/structure/applications/${applicationRefId}/fields`
    ),

  // ── Legacy MVP endpoints (kept for backward compat) ─────────────────────
  importDataset: (sessionId: string, payload: ImportDatasetCommand) =>
    apiClient.post<{ session_id: string; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/imports`,
      payload
    ),

  listColumns: (sessionId: string) =>
    apiClient.get<{ items: SourceColumnSummary[] }>(`/api/discover/sessions/${sessionId}/columns`),

  getProfile: (sessionId: string, columnId: string) =>
    apiClient.get<{ profile: ColumnProfileSummary }>(
      `/api/discover/sessions/${sessionId}/profiles/${columnId}`
    ),

  listMappings: (sessionId: string) =>
    apiClient.get<{ items: ColumnMappingSummary[] }>(`/api/discover/sessions/${sessionId}/mappings`),

  upsertMapping: (sessionId: string, payload: UpsertColumnMappingCommand) =>
    apiClient.post<{ mapping: ColumnMappingSummary; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/mappings`,
      payload
    ),

  clearMapping: (sessionId: string, columnId: string) =>
    apiClient.delete<{ session_id: string; column_id: string; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/mappings/${columnId}`
    ),

  runChecks: (sessionId: string) =>
    apiClient.post<{ execution: CheckExecutionSummary; refresh: RefreshRequest }>(
      `/api/discover/sessions/${sessionId}/checks/run`,
      { rule_version: "mvp-v1" }
    ),

  listResults: (sessionId: string, severity?: string) =>
    apiClient.get<{ execution: CheckExecutionSummary | null; items: CheckResultSummary[] }>(
      severity
        ? `/api/discover/sessions/${sessionId}/results?severity=${encodeURIComponent(severity)}`
        : `/api/discover/sessions/${sessionId}/results`
    ),

  listSourceApplications: (sessionId: string) =>
    apiClient.get<{ session_id: string; items: SourceApplicationItem[] }>(
      `/api/discover/sessions/${sessionId}/source-applications`
    ),

  setSourceApplication: (sessionId: string, sourceFileId: string, command: SetSourceApplicationCommand, actor = "user") =>
    apiClient.put<SourceApplicationItem>(
      `/api/discover/sessions/${sessionId}/source-files/${sourceFileId}/source-application?actor=${encodeURIComponent(actor)}`,
      command
    ),

  clearSourceApplication: (sessionId: string, sourceFileId: string, confirm = false, actor = "user") =>
    apiClient.delete<SourceApplicationItem>(
      `/api/discover/sessions/${sessionId}/source-files/${sourceFileId}/source-application?confirm=${confirm}&actor=${encodeURIComponent(actor)}`
    ),

  listAuditEvents: (sessionId: string, limit = 10) =>
    apiClient.get<{ items: DiscoverAuditEventSummary[] }>(
      `/api/discover/sessions/${sessionId}/audit?limit=${limit}`
    )
};
