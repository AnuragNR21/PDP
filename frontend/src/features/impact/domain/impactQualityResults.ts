/**
 * Two layers, resolved together and never written back into one another.
 *
 * PDP says what *should* be true: the relationships Structure asserts, the
 * rule configuration a property is subject to, the reference data it is
 * governed by. Discover says what was *found* in the data representing it:
 * which source column was mapped to that property, which run assessed it, what
 * the checks concluded and which records needed attention.
 *
 * They are different kinds of statement and the workspace must never blur
 * them. A failed check is not a relationship; it is an observation *about* the data
 * behind one. So nothing here persists anything, nothing merges a finding into
 * the model, and every function takes the two layers as plain data and returns
 * new values — which is also what makes the read-only promise testable rather
 * than merely intended.
 *
 * Pure on purpose: no React, no fetch, no `@/` runtime imports, so the
 * acceptance criteria in `impactQualityResults.test.ts` can be run with
 * `node --test` and read as the specification they are.
 */
import type {
  GovernanceEdge,
  GovernanceItem,
} from "@/features/structure/domain/structureGovernanceGraph";

// ── vocabulary ───────────────────────────────────────────────────────────────

/**
 * The kinds of thing the workspace can show.
 *
 * `RELATIONSHIP`, `TARGET` and `REFERENCE_VALUE` belong to the model layer;
 * `MAPPING`, `QUALITY_RUN`, `QUALITY_CHECK`, `FINDING` and `FINDINGS_GROUP`
 * belong to the observed layer. `layerOf` is the one place that says which.
 */
export const ITEM_KIND = {
  RELATIONSHIP: "relationship",
  TARGET: "target",
  RULE_CONFIGURATION: "rule_configuration",
  REFERENCE_VALUE: "reference_value",
  SOURCE_COLUMN: "source_column",
  MAPPING: "mapping",
  QUALITY_RUN: "quality_run",
  QUALITY_CHECK: "quality_check",
  FINDING: "finding",
  FINDINGS_GROUP: "findings_group",
} as const;

export type ItemKind = (typeof ITEM_KIND)[keyof typeof ITEM_KIND];

/** Which of the two layers a thing belongs to. */
export type ItemLayer = "model" | "observed";

const MODEL_KINDS: readonly string[] = [
  ITEM_KIND.RELATIONSHIP,
  ITEM_KIND.TARGET,
  ITEM_KIND.RULE_CONFIGURATION,
  ITEM_KIND.REFERENCE_VALUE,
];

export function layerOf(kind: ItemKind): ItemLayer {
  return MODEL_KINDS.includes(kind) ? "model" : "observed";
}

/**
 * What a check concluded.
 *
 * `NOT_ASSESSED` exists because the absence of a result is not a pass, and the
 * two are the easiest things in this workspace to confuse. `ERROR` is a check
 * that could not run — also not a pass.
 */
export const QUALITY_OUTCOME = {
  PASSED: "passed",
  ATTENTION: "attention",
  FAILED: "failed",
  NOT_ASSESSED: "not_assessed",
  ERROR: "error",
} as const;

export type QualityOutcome = (typeof QUALITY_OUTCOME)[keyof typeof QUALITY_OUTCOME];

// ── the shapes the server sends ──────────────────────────────────────────────

export type QualityRun = {
  quality_run_id: string;
  session_id: string;
  session_name: string;
  source_file_id: string;
  table_name: string;
  status: string;
  checked_columns: number;
  findings_total: number;
  failed_count: number;
  warning_count: number;
  rows_total: number;
  completed_at: string;
  created_at: string;
};

export type QualityCheck = {
  quality_check_id: string;
  quality_run_id: string;
  session_id: string;
  target_node_id: string | null;
  target_name: string | null;
  column_id: string | null;
  column_name: string;
  rule_id: string | null;
  rule_code: string | null;
  rule_name: string | null;
  configuration_id: string | null;
  check_type: string;
  status: string;
  severity: string | null;
  observed_count: number;
  total_count: number;
  message: string;
  /** Which dataset the check ran over — with the session, the way back to Discover. */
  source_file_id?: string | null;
  /** The governed rule configuration the check executed, resolved from the run. */
  rule_configuration_id?: string | null;
  configuration_code?: string | null;
  configuration_name?: string | null;
  /** The check never ran because its governance was incomplete. */
  is_configuration_error?: boolean;
  detail?: Record<string, unknown>;
};

export type Finding = {
  finding_id: string;
  quality_check_id: string;
  quality_run_id: string;
  severity: string | null;
  outcome: QualityOutcome;
  row_reference: string;
  observed_value: string;
  message: string;
};

export type SourceMapping = {
  mapping_id: string;
  session_id: string;
  session_name: string;
  source_file_id: string | null;
  file_name: string | null;
  column_id: string;
  column_name: string;
  target_node_id: string;
  target_name: string | null;
  mapping_state: string;
  confidence: number;
};

export type RuleConfiguration = {
  configuration_id: string;
  rule_id: string;
  rule_code: string | null;
  rule_name: string | null;
  target_node_id: string;
  severity: string | null;
  is_enabled: boolean;
  parameters: Record<string, unknown>;
};

export type ReferenceValue = {
  reference_id: string;
  name: string;
  element_type_name: string | null;
  model_name: string | null;
};

/** Everything one read of the workspace resolved, both layers side by side. */
export type ImpactBundle = {
  focus_id: string;
  items: GovernanceItem[];
  edges: GovernanceEdge[];
  mappings: SourceMapping[];
  runs: QualityRun[];
  checks: QualityCheck[];
  findings: Finding[];
  configurations: RuleConfiguration[];
  references: ReferenceValue[];
};

// ── outcome ──────────────────────────────────────────────────────────────────

/**
 * What a check concluded, with absence treated honestly.
 *
 * Nothing at all is `NOT_ASSESSED`. A check that raised is `ERROR`. And a
 * check whose status says "passed" while its counts say records were observed
 * is `ATTENTION`: the count is a fact about records and the status is a
 * summary of it, so when they disagree the fact wins.
 */
export function outcomeOf(check: QualityCheck | null | undefined): QualityOutcome {
  if (!check) return QUALITY_OUTCOME.NOT_ASSESSED;

  // A check that could not run because its governance was incomplete is an
  // error of configuration, not data that needs attention — and certainly not
  // a pass. Discover records it as a warning so its own screen can list it;
  // here it has to be told apart.
  if (
    check.is_configuration_error ||
    check.check_type === "configuration_error" ||
    (check.detail as { configuration_error?: boolean } | undefined)?.configuration_error
  ) {
    return QUALITY_OUTCOME.ERROR;
  }

  const status = (check.status ?? "").toLowerCase();
  if (status === "error" || status === "failed_to_run") return QUALITY_OUTCOME.ERROR;
  if (status === "not_assessed" || status === "skipped" || status === "") {
    return QUALITY_OUTCOME.NOT_ASSESSED;
  }
  if (status === "failed") return QUALITY_OUTCOME.FAILED;
  if (status === "warning" || status === "attention") return QUALITY_OUTCOME.ATTENTION;

  return (check.observed_count ?? 0) > 0 ? QUALITY_OUTCOME.ATTENTION : QUALITY_OUTCOME.PASSED;
}

// ── runs ─────────────────────────────────────────────────────────────────────

/**
 * The newest run, under a total ordering.
 *
 * Two runs can share a completion instant, and a reader that picks arbitrarily
 * between them is a bug that only shows under load — so the comparison falls
 * through to creation time and then to the id, which is unique.
 */
export function latestRun(runs: readonly QualityRun[]): QualityRun | null {
  let newest: QualityRun | null = null;
  for (const run of runs) {
    if (!newest || compareRuns(run, newest) > 0) newest = run;
  }
  return newest;
}

function compareRuns(a: QualityRun, b: QualityRun): number {
  if (a.completed_at !== b.completed_at) return a.completed_at > b.completed_at ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? 1 : -1;
  return a.quality_run_id > b.quality_run_id ? 1 : a.quality_run_id < b.quality_run_id ? -1 : 0;
}

/**
 * The checks of exactly one run.
 *
 * Two runs measured different bytes against possibly different rules. Showing
 * their findings together would present a reading nobody ever took.
 */
export function checksOfRun(checks: readonly QualityCheck[], runId: string): QualityCheck[] {
  return checks.filter((check) => check.quality_run_id === runId);
}

export type CheckDescription = {
  quality_check_id: string;
  quality_run_id: string;
  session_name: string | null;
  file_name: string | null;
  rule_code: string | null;
  rule_name: string | null;
  configuration_id: string | null;
  target_node_id: string | null;
  target_name: string | null;
  column_id: string | null;
  column_name: string;
  check_type: string;
  severity: string | null;
  outcome: QualityOutcome;
  records_assessed: number;
  records_passed: number;
  records_attention: number;
  message: string;
};

/** Everything a reader needs to judge one check without opening anything else. */
export function describeCheck(
  check: QualityCheck,
  context: { run?: QualityRun | null; mapping?: SourceMapping | null } = {},
): CheckDescription {
  const assessed = check.total_count ?? 0;
  const attention = check.observed_count ?? 0;
  return {
    quality_check_id: check.quality_check_id,
    quality_run_id: check.quality_run_id,
    session_name: context.run?.session_name ?? context.mapping?.session_name ?? null,
    file_name: context.run?.table_name ?? context.mapping?.file_name ?? null,
    rule_code: check.rule_code,
    rule_name: check.rule_name,
    configuration_id: check.configuration_id,
    target_node_id: check.target_node_id,
    target_name: check.target_name,
    column_id: check.column_id,
    column_name: check.column_name,
    check_type: check.check_type,
    severity: check.severity,
    outcome: outcomeOf(check),
    records_assessed: assessed,
    // Never negative: counts come from two queries and a reader should not be
    // shown "-40 passed" because they disagreed.
    records_passed: Math.max(0, assessed - attention),
    records_attention: attention,
    message: check.message,
  };
}

export type RunSummary = {
  quality_run_id: string;
  session_name: string;
  table_name: string;
  completed_at: string;
  checks_total: number;
  checks_passed: number;
  checks_attention: number;
  checks_failed: number;
  records_assessed: number;
  outcome: QualityOutcome;
};

/** One run, summarised from its own checks rather than from its stored counters. */
export function runSummary(run: QualityRun, checks: readonly QualityCheck[]): RunSummary {
  const mine = checksOfRun(checks, run.quality_run_id).length
    ? checksOfRun(checks, run.quality_run_id)
    : checks;

  let passed = 0;
  let attention = 0;
  let failed = 0;
  let assessed = 0;
  for (const check of mine) {
    assessed += check.total_count ?? 0;
    const outcome = outcomeOf(check);
    if (outcome === QUALITY_OUTCOME.PASSED) passed += 1;
    else if (outcome === QUALITY_OUTCOME.ATTENTION) attention += 1;
    else if (outcome === QUALITY_OUTCOME.FAILED) failed += 1;
  }

  return {
    quality_run_id: run.quality_run_id,
    session_name: run.session_name,
    table_name: run.table_name,
    completed_at: run.completed_at,
    checks_total: mine.length,
    checks_passed: passed,
    checks_attention: attention,
    checks_failed: failed,
    records_assessed: assessed,
    // A run that checked nothing has not passed; it has not been assessed.
    outcome:
      mine.length === 0
        ? QUALITY_OUTCOME.NOT_ASSESSED
        : failed > 0
          ? QUALITY_OUTCOME.FAILED
          : attention > 0
            ? QUALITY_OUTCOME.ATTENTION
            : QUALITY_OUTCOME.PASSED,
  };
}

// ── Navigator groupings ──────────────────────────────────────────────────────

export type NavigatorGroup = {
  group_id: string;
  kind: ItemKind;
  layer: ItemLayer;
  label: string;
  count: number;
};

/**
 * The branches under the focused item.
 *
 * Structure relationships are grouped by relationship *type*, because that is
 * the question a reader is asking — "what contains this", "what governs this"
 * — and a flat list of neighbours answers none of it. Observed results get their own
 * branches, and only where it exists: an empty "Quality Checks" branch reads
 * as "checked, nothing found", which is the one thing it must never say.
 */
export function navigatorGroups(bundle: ImpactBundle): NavigatorGroup[] {
  const groups: NavigatorGroup[] = [];

  const byLabel = new Map<string, number>();
  for (const edge of bundle.edges) {
    if (edge.source_id !== bundle.focus_id && edge.target_id !== bundle.focus_id) continue;
    const label = edge.label || edge.edge_kind;
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }
  for (const [label, count] of byLabel) {
    groups.push({
      group_id: `relationship:${label}`,
      kind: ITEM_KIND.RELATIONSHIP,
      layer: "model",
      label,
      count,
    });
  }

  if (bundle.mappings.length > 0) {
    groups.push({
      group_id: "mapping",
      kind: ITEM_KIND.MAPPING,
      layer: "observed",
      label: "Source Data / Mapping",
      count: bundle.mappings.length,
    });
  }

  if (bundle.checks.length > 0) {
    groups.push({
      group_id: "quality",
      kind: ITEM_KIND.QUALITY_CHECK,
      layer: "observed",
      label: "Quality Checks",
      count: bundle.checks.length,
    });
  }

  if (bundle.configurations.length > 0) {
    groups.push({
      group_id: "rules",
      kind: ITEM_KIND.RULE_CONFIGURATION,
      layer: "model",
      label: "Rule Configuration",
      count: bundle.configurations.length,
    });
  }

  if (bundle.references.length > 0) {
    groups.push({
      group_id: "references",
      kind: ITEM_KIND.REFERENCE_VALUE,
      layer: "model",
      label: "Reference Data",
      count: bundle.references.length,
    });
  }

  return groups;
}

// ── findings ─────────────────────────────────────────────────────────────────

export type FindingPage = {
  rows: Finding[];
  total: number;
  has_more: boolean;
  next_offset: number | null;
};

/**
 * One page of findings.
 *
 * A check over a large table can hold thousands. Opening the Navigator must
 * not fetch or render them all, so the tree asks for a window and is told
 * whether there is more behind it.
 */
export function pageFindings(
  findings: readonly Finding[],
  options: { offset?: number; limit?: number; qualityCheckId?: string } = {},
): FindingPage {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? 50);
  const mine = options.qualityCheckId
    ? findings.filter((f) => f.quality_check_id === options.qualityCheckId)
    : findings;

  const rows = mine.slice(offset, offset + limit);
  const consumed = offset + rows.length;
  return {
    rows,
    total: mine.length,
    has_more: consumed < mine.length,
    next_offset: consumed < mine.length ? consumed : null,
  };
}

export type FindingNode = {
  kind: typeof ITEM_KIND.FINDING | typeof ITEM_KIND.FINDINGS_GROUP;
  node_id: string;
  label: string;
  count: number;
  finding_ids: string[];
};

/**
 * Findings as the graph should draw them.
 *
 * Nineteen findings are nineteen facts but they are not nineteen things worth
 * looking at on a canvas; drawn individually they bury the relationships the
 * canvas exists to show. Past a threshold they collapse into one node that
 * says how many there are and keeps their ids, so selecting it can still open
 * every one.
 */
export function aggregateFindings(
  findings: readonly Finding[],
  options: { threshold?: number } = {},
): { aggregated: boolean; nodes: FindingNode[] } {
  const threshold = options.threshold ?? 5;
  const ids = findings.map((f) => f.finding_id);

  if (findings.length > threshold) {
    const noun = findings.length === 1 ? "finding" : "findings";
    return {
      aggregated: true,
      nodes: [
        {
          kind: ITEM_KIND.FINDINGS_GROUP,
          node_id: `findings:${findings[0]?.quality_check_id ?? "all"}`,
          label: `${findings.length} ${noun} requiring attention`,
          count: findings.length,
          finding_ids: ids,
        },
      ],
    };
  }

  return {
    aggregated: false,
    nodes: findings.map((f) => ({
      kind: ITEM_KIND.FINDING,
      node_id: f.finding_id,
      label: `${f.row_reference}: ${f.observed_value}`.trim(),
      count: 1,
      finding_ids: [f.finding_id],
    })),
  };
}

// ── lineage ──────────────────────────────────────────────────────────────────

export type LineageStep = {
  kind: ItemKind;
  layer: ItemLayer;
  /** How this step is reached from the one before it; null for the first. */
  relation: string | null;
  id: string;
  label: string;
};

export type LineageContext = {
  mapping: SourceMapping | null;
  check: QualityCheck | null;
  configuration: RuleConfiguration | null;
  references: readonly ReferenceValue[];
};

/**
 * The three chains the workspace must be able to draw.
 *
 * Each one crosses the boundary between the layers exactly once, and the
 * relation words are the crossing: *mapped to* enters the model from the
 * source, *assessed by* leaves it for the observed layer, *subject to* and *governed
 * by* stay inside the model.
 */
export function lineageFor(
  chain: "mapping" | "rule" | "reference",
  context: LineageContext,
): LineageStep[] {
  const { mapping, check, configuration, references } = context;

  const targetStep = (relation: string | null): LineageStep | null => {
    const id = mapping?.target_node_id ?? check?.target_node_id ?? configuration?.target_node_id;
    if (!id) return null;
    return {
      kind: ITEM_KIND.TARGET,
      layer: "model",
      relation,
      id,
      label: mapping?.target_name ?? check?.target_name ?? id,
    };
  };

  const checkStep = (): LineageStep | null =>
    check
      ? {
          kind: ITEM_KIND.QUALITY_CHECK,
          layer: "observed",
          relation: "assessed by",
          id: check.quality_check_id,
          label: check.rule_name ?? check.check_type,
        }
      : null;

  const configurationStep = (relation: string): LineageStep | null =>
    configuration
      ? {
          kind: ITEM_KIND.RULE_CONFIGURATION,
          layer: "model",
          relation,
          id: configuration.configuration_id,
          label: configuration.rule_name ?? configuration.rule_code ?? configuration.rule_id,
        }
      : null;

  if (chain === "mapping") {
    if (!mapping) return [];
    return compact([
      {
        kind: ITEM_KIND.SOURCE_COLUMN,
        layer: "observed",
        relation: null,
        id: mapping.column_id,
        label: mapping.column_name,
      },
      targetStep("mapped to"),
      checkStep(),
    ]);
  }

  if (chain === "rule") {
    if (!configuration) return [];
    return compact([targetStep(null), configurationStep("subject to"), checkStep()]);
  }

  if (references.length === 0 || !configuration) return [];
  const first = references[0];
  return compact([
    targetStep(null),
    configurationStep("subject to"),
    {
      kind: ITEM_KIND.REFERENCE_VALUE,
      layer: "model",
      relation: "governed by",
      id: first.reference_id,
      label: first.name,
    },
  ]);
}

function compact(steps: (LineageStep | null)[]): LineageStep[] {
  return steps.filter((step): step is LineageStep => step !== null);
}

// ── filters ──────────────────────────────────────────────────────────────────

export type BundleContent = "relationships" | "mappings" | "checks" | "findings";

export type BundleFilters = {
  contents?: readonly BundleContent[];
  outcome?: QualityOutcome | "all";
  severity?: string | "all";
  modelIds?: readonly string[];
  instanceTypes?: readonly string[];
  relationshipTypes?: readonly string[];
};

/**
 * A narrower view of the same bundle.
 *
 * Filtering changes what is displayed and nothing else — it returns a new
 * bundle and never edits the one it was given, which is what keeps a
 * discovery projection from quietly becoming a modelling one. The focus always
 * survives every filter: a view that can hide the thing it is centred on has
 * no centre.
 */
export function filterBundle(bundle: ImpactBundle, filters: BundleFilters): ImpactBundle {
  const types = filters.contents;
  const allows = (type: BundleContent) => !types || types.includes(type);

  const keepItem = (item: GovernanceItem) => {
    if (item.item_id === bundle.focus_id) return true;
    if (filters.modelIds && filters.modelIds.length > 0 && !filters.modelIds.includes(item.model_id)) {
      return false;
    }
    if (
      filters.instanceTypes &&
      filters.instanceTypes.length > 0 &&
      !filters.instanceTypes.includes(item.type_name ?? "")
    ) {
      return false;
    }
    return true;
  };

  const items = bundle.items.filter(keepItem);
  const present = new Set(items.map((item) => item.item_id));

  const edges = allows("relationships")
    ? bundle.edges.filter((edge) => {
        if (
          filters.relationshipTypes &&
          filters.relationshipTypes.length > 0 &&
          !filters.relationshipTypes.includes(edge.label || edge.edge_kind)
        ) {
          return false;
        }
        if (items.length === 0) return true;
        return present.has(edge.source_id) && present.has(edge.target_id);
      })
    : [];

  const checks = allows("checks")
    ? bundle.checks.filter((check) => {
        if (filters.outcome && filters.outcome !== "all" && outcomeOf(check) !== filters.outcome) {
          return false;
        }
        return true;
      })
    : [];

  const keptCheckIds = new Set(checks.map((check) => check.quality_check_id));
  const findings = allows("findings")
    ? bundle.findings.filter((f) => {
        if (filters.severity && filters.severity !== "all" && f.severity !== filters.severity) {
          return false;
        }
        // A finding without its check is an orphan; it would be presented with
        // nothing explaining what was measured.
        if (checks.length > 0 && !keptCheckIds.has(f.quality_check_id)) return false;
        return true;
      })
    : [];

  return {
    ...bundle,
    items,
    edges,
    mappings: allows("mappings") ? [...bundle.mappings] : [],
    runs: [...bundle.runs],
    checks,
    findings,
    configurations: [...bundle.configurations],
    references: [...bundle.references],
  };
}

/**
 * The same bundle with the quality layer switched off.
 *
 * What remains has to be the whole relationship graph, untouched: turning
 * quality results off is a way of asking "what does PDP say, on its own", and an
 * answer that had also dropped model relationships would be a different
 * question.
 */
export function withoutQualityResults(bundle: ImpactBundle): ImpactBundle {
  return {
    ...bundle,
    items: [...bundle.items],
    edges: [...bundle.edges],
    mappings: [...bundle.mappings],
    runs: [],
    checks: [],
    findings: [],
    configurations: [...bundle.configurations],
    references: [...bundle.references],
  };
}

// ── direction and layout ─────────────────────────────────────────────────────

type DirectedEdge = Pick<GovernanceEdge, "source_id" | "target_id">;

/**
 * What leads into the focus and what leads out of it.
 *
 * Direction is read from the recorded relationship, never from the order the
 * edges happen to arrive in or the side a node was drawn on. An instance
 * reachable both ways is reported on the side it reaches first, and only
 * there, so the canvas can show it once with all its connections intact.
 */
export function directionFrom(
  focusId: string,
  edges: readonly DirectedEdge[],
): { upstream: Set<string>; downstream: Set<string> } {
  const downstream = walk(focusId, edges, "forward");
  const upstream = walk(focusId, edges, "backward");
  // Reachable both ways: keep it upstream-free so it is listed once. Upstream
  // loses the tie because the eye reads a diagram left to right, and the
  // shared instance is more useful on the side the reader arrives at last.
  for (const id of downstream) upstream.delete(id);
  return { upstream, downstream };
}

function walk(
  focusId: string,
  edges: readonly DirectedEdge[],
  direction: "forward" | "backward",
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = direction === "forward" ? edge.source_id : edge.target_id;
    const to = direction === "forward" ? edge.target_id : edge.source_id;
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  }

  const reached = new Set<string>();
  const queue = [...(adjacency.get(focusId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    // The focus is the centre, never its own neighbour — a cycle back to it
    // must not place it on one of the sides.
    if (id === focusId || reached.has(id)) continue;
    reached.add(id);
    for (const next of adjacency.get(id) ?? []) if (!reached.has(next)) queue.push(next);
  }
  return reached;
}

/**
 * How far each item sits from the focus, signed by direction.
 *
 * Zero is the focus, negative is upstream and positive is downstream, so a
 * layout can place columns by level and get upstream-left / downstream-right
 * without deciding direction a second time. Distance is the shortest one:
 * an item reachable in one step and again in three belongs in the first
 * column, beside the step that actually reaches it.
 */
export function layoutLevels(
  focusId: string,
  edges: readonly DirectedEdge[],
): Map<string, number> {
  const levels = new Map<string, number>([[focusId, 0]]);
  assign(levels, focusId, edges, "forward", 1);
  assign(levels, focusId, edges, "backward", -1);
  return levels;
}

function assign(
  levels: Map<string, number>,
  focusId: string,
  edges: readonly DirectedEdge[],
  direction: "forward" | "backward",
  step: number,
): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = direction === "forward" ? edge.source_id : edge.target_id;
    const to = direction === "forward" ? edge.target_id : edge.source_id;
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  }

  // Breadth first, so the first level written for an item is the shortest one.
  let frontier = [focusId];
  let depth = 0;
  const seen = new Set<string>([focusId]);
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        if (!levels.has(neighbour)) levels.set(neighbour, depth * step);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
}

// ── results for the selected hubs ────────────────────────────────────────────

/** A property governance says should be checked that no shown run checked. */
export type NotAssessed = {
  target_node_id: string;
  target_name: string | null;
  configuration_id: string | null;
  rule_code: string | null;
  rule_name: string | null;
  applicability: string | null;
  /** `not_mapped`: no column stands for the property. `mapped_not_run`: one does, the rule did not run. */
  reason: "not_mapped" | "mapped_not_run";
  session_id?: string | null;
  session_name?: string | null;
  column_name?: string | null;
};

/** How a hub reaches one of its relevant properties. */
export type HubLink = { hub_id: string; node_id: string; path: string[] };

/** One row of the Data quality results list. */
export type ResultEntry = {
  key: string;
  kind: "check" | "not_assessed";
  outcome: QualityOutcome;
  target_node_id: string;
  target_name: string | null;
  check: QualityCheck | null;
  not_assessed: NotAssessed | null;
  run: QualityRun | null;
  mapping: SourceMapping | null;
  /** The selected hubs this result is traceable to, in selection order. */
  hub_ids: string[];
  selected_hub_count: number;
};

/**
 * The results to list for the selected hubs, each tied to the hubs it is
 * traceable to.
 *
 * A result belongs to a hub when its property is one of the hub's relevant
 * properties — the hub itself, something it contains, or a node a governed
 * value is joined to. With `every`, a result is kept only when the *same*
 * result is traceable to every selected hub; a different result on a sibling
 * property does not count. Properties governance expects to be checked and no
 * shown run checked are listed as *not assessed*, never left out.
 */
export function resultEntries(
  report: {
    checks: readonly QualityCheck[];
    runs: readonly QualityRun[];
    mappings: readonly SourceMapping[];
    not_assessed?: readonly NotAssessed[];
    links?: readonly HubLink[];
  },
  hubIds: readonly string[],
  match: "any" | "every" = "any",
): ResultEntry[] {
  const hubs = [...new Set(hubIds)].filter(Boolean);
  const hubsByNode = new Map<string, string[]>();
  for (const link of report.links ?? []) {
    if (!hubs.includes(link.hub_id)) continue;
    const list = hubsByNode.get(link.node_id) ?? [];
    if (!list.includes(link.hub_id)) list.push(link.hub_id);
    hubsByNode.set(link.node_id, list);
  }
  // Without links (an older server) a result belongs to the hub it names.
  const hubsOf = (nodeId: string) => {
    const linked = hubsByNode.get(nodeId);
    if (linked) return hubs.filter((hub) => linked.includes(hub));
    return hubs.includes(nodeId) ? [nodeId] : [];
  };

  const runs = new Map(report.runs.map((run) => [run.quality_run_id, run]));
  const mappingOf = (check: QualityCheck) =>
    report.mappings.find(
      (m) =>
        m.target_node_id === check.target_node_id &&
        m.session_id === check.session_id &&
        (!check.column_id || m.column_id === check.column_id),
    ) ??
    report.mappings.find((m) => m.target_node_id === check.target_node_id) ??
    null;

  const entries: ResultEntry[] = [];
  for (const check of report.checks) {
    const target = check.target_node_id ?? "";
    entries.push({
      key: `check:${check.quality_check_id}`,
      kind: "check",
      outcome: outcomeOf(check),
      target_node_id: target,
      target_name: check.target_name,
      check,
      not_assessed: null,
      run: runs.get(check.quality_run_id) ?? null,
      mapping: mappingOf(check),
      hub_ids: hubsOf(target),
      selected_hub_count: hubs.length,
    });
  }
  for (const missing of report.not_assessed ?? []) {
    entries.push({
      key: `not_assessed:${missing.target_node_id}:${missing.configuration_id ?? ""}`,
      kind: "not_assessed",
      outcome: QUALITY_OUTCOME.NOT_ASSESSED,
      target_node_id: missing.target_node_id,
      target_name: missing.target_name,
      check: null,
      not_assessed: missing,
      run: null,
      mapping: report.mappings.find((m) => m.target_node_id === missing.target_node_id) ?? null,
      hub_ids: hubsOf(missing.target_node_id),
      selected_hub_count: hubs.length,
    });
  }

  return entries.filter((entry) =>
    match === "every" ? entry.hub_ids.length === hubs.length && hubs.length > 0 : entry.hub_ids.length > 0,
  );
}

/**
 * The path from each connected hub to a result's property, shortest first.
 *
 * Selecting a result draws one of these per hub that reaches it, and none for
 * a hub that does not.
 */
export function hubPathsTo(
  targetNodeId: string,
  hubIds: readonly string[],
  links: readonly HubLink[],
): { hub_id: string; path: string[] }[] {
  const out: { hub_id: string; path: string[] }[] = [];
  for (const hub of hubIds) {
    let best: string[] | null = null;
    for (const link of links) {
      if (link.hub_id !== hub || link.node_id !== targetNodeId) continue;
      if (!best || link.path.length < best.length) best = link.path;
    }
    if (best) out.push({ hub_id: hub, path: best });
    else if (hub === targetNodeId) out.push({ hub_id: hub, path: [hub] });
  }
  return out;
}

/** Discover's own page for a result: the session it ran in. */
export function discoverHrefFor(sessionId: string | null | undefined): string | null {
  return sessionId ? `/discover/mapping/${encodeURIComponent(sessionId)}` : null;
}
