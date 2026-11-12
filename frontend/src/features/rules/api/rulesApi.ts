import { apiClient } from "@/shared/http/apiClient";

/** How a check's parameter is captured in the form. */
/** Where a rule is in use: attached to node instances (SWS) or chosen in Discover sessions. */
export type RuleUsage = {
  in_use: boolean;
  node_instances: { total: number; items: Array<{ id: string; name: string; model_name: string | null }> };
  discover_sessions: { total: number; items: Array<{ id: string; name: string }> };
};

export type RuleParameterKind = "number" | "text" | "list" | "select";

export type RuleParameterSpec = {
  name: string;
  label: string;
  kind: RuleParameterKind;
  required: boolean;
  help?: string;
  options?: { key: string; label: string }[];
};

export type RuleCheckType = {
  check_type: string;
  label: string;
  /** "field" reads one field; "dataset" reads the whole record. */
  scope: string;
  summary: string;
  parameters: RuleParameterSpec[];
  /** Names of the shared parameters this check accepts, e.g. tolerance. */
  shared: string[];
  /** The kinds of field this check suits, e.g. ["number"]. */
  data_types: string[];
  /** The quality dimension it measures, offered as the default. */
  dimension: string;
};

export type RuleOption = { key: string; label: string };

/** The two ways to write a rule: fill in a check, or write a script. */
export type RuleDefinitionKind = { key: string; label: string; detail: string };

export type ScriptAuthoringHelp = {
  template: string;
  context: { name: string; detail: string }[];
  helpers: { signature: string; detail: string }[];
  max_bytes: number;
  params_help: string;
};

export type ScriptValidation = {
  ok: boolean;
  errors: { message: string; line: number; column: number }[];
  row_fields: string[];
  param_names: string[];
  sha256: string;
  summary: string;
};

export type ExampleResult = {
  value: string;
  expected: string;
  verdict: "pass" | "fail" | "skipped";
  reason: string;
  agrees: boolean;
};

export type ExampleReport = {
  checked: number;
  disagreements: number;
  results: ExampleResult[];
  /** False when the check reads a whole column, so one value proves nothing. */
  testable: boolean;
};

export type RuleCatalogue = {
  /** The categories already in use — suggestions, not a closed list. */
  categories: string[];
  default_category: string;
  definition_kinds: RuleDefinitionKind[];
  dimensions: (RuleOption & { detail: string })[];
  data_types: RuleOption[];
  /** What kind of execution a rule needs, and whether the engine has it yet. */
  execution_scopes: (RuleOption & { detail: string; executable: boolean })[];
  python: ScriptAuthoringHelp;
  check_types: RuleCheckType[];
  severities: RuleOption[];
  statuses: RuleOption[];
  /** Offered on every check that accepts them — tolerance, ignored values. */
  shared_parameters: RuleParameterSpec[];
};

export type RuleParameters = Record<string, string | number | string[] | undefined>;

export type RuleDefinition = {
  rule_definition_id: string;
  /** Short, stable, cited by every result. Never changes once issued. */
  code: string;
  name: string;
  dimension: string;
  dimension_label: string;
  /** The kind of field it may be attached to. */
  data_type: string;
  applies_to_label: string;
  rationale: string;
  reference: string;
  message_template: string;
  examples_pass: string[];
  examples_fail: string[];
  owner: string;
  version: number;
  updated_by: string;
  description: string;
  category: string;
  scope: string;
  /**
   * What kind of execution the rule needs: column, row, multi_column,
   * cross_table, cross_source, aggregate, historical.
   *
   * Different from `scope`, which is how the engine binds the check. A rule
   * may declare execution the engine does not have yet — that is the point.
   */
  execution_scope: string;
  execution_scope_label: string;
  /** Whether the engine can run it today. Not a property of the rule. */
  is_executable: boolean;
  definition_kind: string;
  check_type: string;
  parameters: RuleParameters;
  script: string;
  severity: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Server-rendered labels, so the list never re-derives them. */
  check_label: string;
  statement: string;
  /** Identifies the exact script a result came from. Empty for form rules. */
  script_sha256: string;

  /**
   * What this rule checks against.
   *
   * An approved-list rule names a governed vocabulary and ticks the values it
   * accepts. Both live on the rule, so the person writing it finishes the
   * sentence in one place instead of two.
   */
  rule_configuration_id: string;
  reference_element_type_id: string;
  reference_element_type_name: string;
  reference_model_name: string;
  /** The values ticked. Empty means the whole vocabulary. */
  reference_value_ids: string[];
  /** Those values by name, as the run will see them. */
  reference_values: string[];
};

/**
 * One version of a rule, as it was when it was in force.
 *
 * `recorded` is false for the one entry that was never copied into the log —
 * a rule authored before versions were kept has its current state offered in
 * place of version N, and the next edit records it properly.
 */
export type RuleVersion = {
  rule_version_id: string;
  rule_definition_id: string;
  version: number;
  code: string;
  name: string;
  description: string;
  category: string;
  scope: string;
  execution_scope: string;
  definition_kind: string;
  check_type: string;
  parameters: RuleParameters;
  script: string;
  severity: string;
  status: string;
  dimension: string;
  data_type: string;
  rationale: string;
  reference: string;
  message_template: string;
  examples_pass: string[];
  examples_fail: string[];
  owner: string;
  recorded_by: string;
  recorded_at: string;
  recorded: boolean;
  is_current: boolean;
};

export type RuleVersionHistory = {
  rule_definition_id: string;
  name: string;
  code: string;
  current_version: number;
  /** True when the rule itself is gone and only its versions remain. */
  rule_deleted: boolean;
  items: RuleVersion[];
  total: number;
};

export type RuleListReport = {
  items: RuleDefinition[];
  total: number;
  active: number;
};

export type SaveRulePayload = {
  name: string;
  description: string;
  category: string;
  dimension: string;
  data_type: string;
  rationale: string;
  reference: string;
  message_template: string;
  examples_pass: string[];
  examples_fail: string[];
  owner: string;
  definition_kind: string;
  check_type: string;
  script: string;
  parameters: RuleParameters;
  severity: string;
  status: string;
  /** Empty means "whatever this check normally needs". */
  execution_scope: string;
  /** The governed vocabulary an approved-list rule reads. */
  reference_element_type_id: string;
  /** Which of its values the rule approves. Empty means all of them. */
  reference_value_ids: string[];
  /** True when this payload means to set the two fields above. */
  governs_values: boolean;
};

/**
 * One category's code family.
 *
 * `source` is "default" when nothing has been configured and the prefix was
 * guessed from the category name, "configured" when the team chose it.
 * Changing a prefix never rewrites a code already issued — `next_code` is what
 * the *next* rule in this category would get.
 */
export type RuleCodePrefix = {
  category: string;
  prefix: string;
  default_prefix: string;
  source: "configured" | "default";
  /** How many codes have already been issued in this family. */
  issued: number;
  next_code: string;
  /** Other categories handing out the same family. Allowed, but worth knowing. */
  shared_with: string[];
};

export type RuleCodePrefixReport = {
  items: RuleCodePrefix[];
  total: number;
  max_length: number;
};

/** What one line of an import file would do, and why. */
export type RuleImportRow = {
  /** The line in the spreadsheet, header included — so row 2 is the first rule. */
  row_number: number;
  action: "new" | "changed" | "unchanged" | "invalid";
  /** Which identifier matched: rule_definition_id, code, name, or none. */
  match_on: string;
  rule_definition_id: string;
  code: string;
  name: string;
  category: string;
  changes: { field: string; from: string; to: string }[];
  notes: string[];
  errors: string[];
  /** Only on a commit report. */
  outcome?: "applied" | "skipped" | "failed";
  version?: number;
};

export type RuleImportPlan = {
  stage_id: string;
  summary: { total: number; new: number; changed: number; unchanged: number; invalid: number };
  rows: RuleImportRow[];
  /** Headers the library does not recognise — reported, not silently dropped. */
  unknown_columns: string[];
  /** Ticked to begin with: everything that would do something and can. */
  selected_row_numbers: number[];
};

export type RuleImportReport = {
  stage_id: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: RuleImportRow[];
};

const query = (params: Record<string, string>) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value.length > 0),
  ).toString();
  return search ? `?${search}` : "";
};

export const rulesApi = {
  /** Check types and their parameters — everything the authoring form needs. */
  getCatalogue: () => apiClient.get<RuleCatalogue>("/api/rules/catalogue"),

  /** Holds a draft rule to its worked examples. Reads no data, saves nothing. */
  testExamples: (payload: {
    check_type: string;
    parameters: RuleParameters;
    examples_pass: string[];
    examples_fail: string[];
  }) => apiClient.post<ExampleReport>("/api/rules/test-examples", payload),

  /** Checks a script without saving or running it. Drives the editor's errors. */
  validateScript: (script: string) =>
    apiClient.post<ScriptValidation>("/api/rules/validate-script", { script }),

  listRules: (filters: { search?: string; status?: string; category?: string } = {}) =>
    apiClient.get<RuleListReport>(
      `/api/rules${query({
        search: filters.search ?? "",
        status: filters.status ?? "",
        category: filters.category ?? "",
      })}`,
    ),

  createRule: (payload: SaveRulePayload, actor = "user") =>
    apiClient.post<RuleDefinition>(`/api/rules?actor=${encodeURIComponent(actor)}`, payload),

  updateRule: (ruleDefinitionId: string, payload: SaveRulePayload) =>
    apiClient.put<RuleDefinition>(`/api/rules/${ruleDefinitionId}`, payload),

  /** A rule in use is refused (409) unless `force` — set once the person has been warned. */
  deleteRule: (ruleDefinitionId: string, options: { force?: boolean } = {}) =>
    apiClient.delete<void>(`/api/rules/${ruleDefinitionId}${options.force ? "?force=true" : ""}`),

  /** Where the rule is in use — shown as a warning before deleting it. */
  getUsage: (ruleDefinitionId: string) =>
    apiClient.get<RuleUsage>(`/api/rules/${ruleDefinitionId}/usage`),

  /** Every version this rule has been, newest first. */
  getVersions: (ruleDefinitionId: string) =>
    apiClient.get<RuleVersionHistory>(`/api/rules/${ruleDefinitionId}/versions`),

  /**
   * One version, exactly as it was in force — what a quality run's evidence
   * points at when it cites a rule at a version.
   */
  getVersion: (ruleDefinitionId: string, version: number) =>
    apiClient.get<RuleVersion>(`/api/rules/${ruleDefinitionId}/versions/${version}`),

  // ── code families ──────────────────────────────────────────────────────────

  getCodePrefixes: () => apiClient.get<RuleCodePrefixReport>("/api/rules/code-prefixes"),

  setCodePrefix: (category: string, prefix: string) =>
    apiClient.put<RuleCodePrefixReport>(
      `/api/rules/code-prefixes/${encodeURIComponent(category)}`,
      { prefix },
    ),

  clearCodePrefix: (category: string) =>
    apiClient.delete<RuleCodePrefixReport>(
      `/api/rules/code-prefixes/${encodeURIComponent(category)}`,
    ),

  // ── import / export ────────────────────────────────────────────────────────

  /**
   * The library as CSV text.
   *
   * Fetched directly rather than through apiClient, which parses every reply
   * as JSON. The first column is the internal rule id, so the file that comes
   * back re-imports by identity rather than by name.
   */
  exportCsv: async (filters: { status?: string; category?: string; search?: string } = {}) => {
    const base = import.meta.env.VITE_API_BASE_URL || "";
    const response = await fetch(
      `${base}/api/rules/export${query({
        status: filters.status ?? "",
        category: filters.category ?? "",
        search: filters.search ?? "",
      })}`,
    );
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    return response.text();
  },

  templateCsv: async () => {
    const base = import.meta.env.VITE_API_BASE_URL || "";
    const response = await fetch(`${base}/api/rules/export/template`);
    if (!response.ok) throw new Error(`Template failed: ${response.status}`);
    return response.text();
  },

  /** Reconcile a file against the library. Writes nothing. */
  validateImport: (csv: string) =>
    apiClient.post<RuleImportPlan>("/api/rules/imports/validate", { csv }),

  /** Apply the rows that were ticked, and nothing else. */
  commitImport: (stageId: string, selectedRowNumbers: number[]) =>
    apiClient.post<RuleImportReport>("/api/rules/imports/commit", {
      stage_id: stageId,
      selected_row_numbers: selectedRowNumbers,
    }),
};

/** Hand the browser a file without leaving the page. */
export function downloadCsv(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
