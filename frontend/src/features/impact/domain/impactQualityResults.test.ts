/**
 * The Impact Workspace's acceptance criteria, as executable statements.
 *
 * Run with:  npm run test:impact
 *
 * These tests were written before the code they test. Each one names the
 * criterion it pins, so a change that breaks a requirement fails under the
 * requirement's own name rather than under some helper's.
 *
 * The thing being pinned is the join the whole workspace rests on: PDP says
 * what *should* be true (relationships, rule configuration, reference data);
 * Discover says what was *found* in the data representing it (mappings, runs,
 * checks, findings). The two are resolved together at read time and never
 * written back into one another — so every function here is pure, takes the
 * two layers as data, and returns new values.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ITEM_KIND,
  QUALITY_OUTCOME,
  aggregateFindings,
  checksOfRun,
  describeCheck,
  directionFrom,
  filterBundle,
  latestRun,
  layoutLevels,
  lineageFor,
  navigatorGroups,
  outcomeOf,
  pageFindings,
  runSummary,
  withoutQualityResults,
  type ImpactBundle,
  type Finding,
  type QualityCheck,
  type QualityRun,
  type SourceMapping,
} from "./impactQualityResults.ts";
import { GOVERNANCE_EDGE_KIND } from "../../structure/domain/structureGovernanceGraph.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

function run(id: string, extra: Partial<QualityRun> = {}): QualityRun {
  return {
    quality_run_id: id,
    session_id: "sess_1",
    session_name: "January load",
    source_file_id: "file_1",
    table_name: "assets.csv",
    status: "completed",
    checked_columns: 3,
    findings_total: 3,
    failed_count: 1,
    warning_count: 1,
    rows_total: 100,
    completed_at: "2026-10-01T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    ...extra,
  };
}

function check(id: string, extra: Partial<QualityCheck> = {}): QualityCheck {
  return {
    quality_check_id: id,
    quality_run_id: "run_1",
    session_id: "sess_1",
    target_node_id: "node_voltage",
    target_name: "Tx Voltage",
    column_id: "col_voltage",
    column_name: "Voltage",
    rule_id: "rule_1",
    rule_code: "DQ-0001",
    rule_name: "Voltage is an approved value",
    configuration_id: "cfg_1",
    check_type: "allowed_values",
    status: "failed",
    severity: "high",
    observed_count: 7,
    total_count: 100,
    message: "7 of 100 rows do not carry an approved value.",
    ...extra,
  };
}

function finding(id: string, extra: Partial<Finding> = {}): Finding {
  return {
    finding_id: id,
    quality_check_id: "chk_1",
    quality_run_id: "run_1",
    severity: "high",
    outcome: QUALITY_OUTCOME.FAILED,
    row_reference: "row 12",
    observed_value: "11 kv",
    message: "Not an approved value.",
    ...extra,
  };
}

function mapping(extra: Partial<SourceMapping> = {}): SourceMapping {
  return {
    mapping_id: "map_1",
    session_id: "sess_1",
    session_name: "January load",
    source_file_id: "file_1",
    file_name: "assets.csv",
    column_id: "col_voltage",
    column_name: "Voltage",
    target_node_id: "node_voltage",
    target_name: "Tx Voltage",
    mapping_state: "confirmed",
    confidence: 0.98,
    ...extra,
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  extra: Partial<{ edge_kind: string; label: string; asserted: boolean }> = {},
) {
  return {
    edge_id: id,
    edge_kind: GOVERNANCE_EDGE_KIND.HIERARCHY,
    source_id: source,
    target_id: target,
    label: "contains",
    governance_role: null,
    asserted: true,
    ...extra,
  } as ImpactBundle["edges"][number];
}

function bundle(extra: Partial<ImpactBundle> = {}): ImpactBundle {
  return {
    focus_id: "node_voltage",
    items: [],
    edges: [],
    mappings: [],
    runs: [],
    checks: [],
    findings: [],
    configurations: [],
    references: [],
    ...extra,
  };
}

// ── outcome: absence of a result is not a pass ───────────────────────────────

test("AC-NAV-04 / AC-VIS-08: a check with no issue reads as passed", () => {
  assert.equal(outcomeOf(check("c", { status: "passed", observed_count: 0 })), QUALITY_OUTCOME.PASSED);
});

test("AC-NAV-04 / AC-VIS-08: a warning reads as attention, not as a pass", () => {
  assert.equal(outcomeOf(check("c", { status: "warning" })), QUALITY_OUTCOME.ATTENTION);
});

test("AC-NAV-04 / AC-VIS-08: a failure reads as failed", () => {
  assert.equal(outcomeOf(check("c", { status: "failed" })), QUALITY_OUTCOME.FAILED);
});

test("feedback 4: a check that could not run reads as an error, never as a pass", () => {
  assert.equal(outcomeOf(check("c", { status: "error" })), QUALITY_OUTCOME.ERROR);
});

test("feedback 4: no result at all is 'not assessed', never a pass", () => {
  assert.equal(outcomeOf(undefined), QUALITY_OUTCOME.NOT_ASSESSED);
  assert.equal(outcomeOf(null), QUALITY_OUTCOME.NOT_ASSESSED);
});

test("feedback 4: a passed status with records still observed is attention, not a pass", () => {
  // The status column and the counts can disagree. The counts win, because a
  // row that needed attention is a fact and a status is a summary of it.
  assert.equal(
    outcomeOf(check("c", { status: "passed", observed_count: 4 })),
    QUALITY_OUTCOME.ATTENTION,
  );
});

// ── runs: never mix two of them ──────────────────────────────────────────────

test("AC-NAV-08 / AC-VIS-09: the latest run is the one presented by default", () => {
  const runs = [
    run("run_old", { completed_at: "2026-09-01T00:00:00Z" }),
    run("run_new", { completed_at: "2026-10-05T00:00:00Z" }),
    run("run_mid", { completed_at: "2026-10-01T00:00:00Z" }),
  ];
  assert.equal(latestRun(runs)?.quality_run_id, "run_new");
});

test("AC-NAV-08: runs completed at the same instant are ordered totally, never arbitrarily", () => {
  const same = "2026-10-05T00:00:00Z";
  const runs = [
    run("run_a", { completed_at: same, created_at: "2026-10-05T00:00:00Z" }),
    run("run_b", { completed_at: same, created_at: "2026-10-05T01:00:00Z" }),
  ];
  assert.equal(latestRun(runs)?.quality_run_id, "run_b");
  assert.equal(latestRun([...runs].reverse())?.quality_run_id, "run_b");
});

test("AC-NAV-08: with no runs at all there is no latest run to show", () => {
  assert.equal(latestRun([]), null);
});

test("AC-VIS-09: findings of separate runs are never combined", () => {
  const checks = [
    check("chk_1", { quality_run_id: "run_new" }),
    check("chk_2", { quality_run_id: "run_old" }),
    check("chk_3", { quality_run_id: "run_new" }),
  ];
  const kept = checksOfRun(checks, "run_new");
  assert.deepEqual(kept.map((c) => c.quality_check_id), ["chk_1", "chk_3"]);
});

test("AC-NAV-08: an earlier run can be read on its own terms", () => {
  const checks = [
    check("chk_1", { quality_run_id: "run_new" }),
    check("chk_2", { quality_run_id: "run_old", status: "passed", observed_count: 0 }),
  ];
  const earlier = checksOfRun(checks, "run_old");
  assert.equal(earlier.length, 1);
  assert.equal(outcomeOf(earlier[0]), QUALITY_OUTCOME.PASSED);
});

// ── what a check has to be able to say ───────────────────────────────────────

test("AC-NAV-02 / AC-VIS-02: a check identifies rule, run, target, column, outcome and counts", () => {
  const described = describeCheck(check("chk_1"), {
    run: run("run_1"),
    mapping: mapping(),
  });

  assert.equal(described.rule_name, "Voltage is an approved value");
  assert.equal(described.rule_code, "DQ-0001");
  assert.equal(described.configuration_id, "cfg_1");
  assert.equal(described.quality_run_id, "run_1");
  assert.equal(described.session_name, "January load");
  assert.equal(described.target_name, "Tx Voltage");
  assert.equal(described.column_name, "Voltage");
  assert.equal(described.file_name, "assets.csv");
  assert.equal(described.outcome, QUALITY_OUTCOME.FAILED);
  assert.equal(described.records_assessed, 100);
  assert.equal(described.records_attention, 7);
  assert.equal(described.records_passed, 93);
});

test("AC-VIS-02: the passed count is never negative, however odd the counts are", () => {
  const described = describeCheck(check("chk_1", { observed_count: 140, total_count: 100 }), {
    run: run("run_1"),
    mapping: mapping(),
  });
  assert.equal(described.records_passed, 0);
});

test("AC-NAV-02: a check with no mapping still reports what it does know", () => {
  // The mapping is one way to learn which file was assessed; the run is
  // another, and it is the authoritative one — it is what actually ran. So a
  // missing mapping must not blank out a table name the run can state.
  const described = describeCheck(check("chk_1"), { run: run("run_1"), mapping: null });
  assert.equal(described.column_name, "Voltage");
  assert.equal(described.file_name, "assets.csv");
  assert.equal(described.session_name, "January load");
});

test("AC-NAV-02: with neither run nor mapping, unknown context is reported as unknown", () => {
  const described = describeCheck(check("chk_1"), { run: null, mapping: null });
  assert.equal(described.file_name, null);
  assert.equal(described.session_name, null);
  // What the check itself holds is still reported.
  assert.equal(described.column_name, "Voltage");
  assert.equal(described.rule_code, "DQ-0001");
  assert.equal(described.outcome, QUALITY_OUTCOME.FAILED);
});

test("AC-NAV-02 / AC-VIS-02: a run summary counts assessed, passed and attention", () => {
  const summary = runSummary(run("run_1"), [
    check("chk_1", { status: "failed", observed_count: 7, total_count: 100 }),
    check("chk_2", { status: "passed", observed_count: 0, total_count: 100 }),
    check("chk_3", { status: "warning", observed_count: 2, total_count: 100 }),
  ]);
  assert.equal(summary.checks_total, 3);
  assert.equal(summary.checks_passed, 1);
  assert.equal(summary.checks_attention, 1);
  assert.equal(summary.checks_failed, 1);
  assert.equal(summary.outcome, QUALITY_OUTCOME.FAILED);
});

test("AC-NAV-04: a run where everything passed reads as passed", () => {
  const summary = runSummary(run("run_1"), [
    check("chk_1", { status: "passed", observed_count: 0 }),
    check("chk_2", { status: "passed", observed_count: 0 }),
  ]);
  assert.equal(summary.outcome, QUALITY_OUTCOME.PASSED);
});

test("feedback 4: a run with no checks is not assessed rather than passed", () => {
  assert.equal(runSummary(run("run_1"), []).outcome, QUALITY_OUTCOME.NOT_ASSESSED);
});

// ── Navigator groupings ──────────────────────────────────────────────────────

test("AC-NAV-01: a Quality Checks grouping appears when the focus has checks", () => {
  const groups = navigatorGroups(
    bundle({
      runs: [run("run_1")],
      checks: [check("chk_1")],
      mappings: [mapping()],
    }),
  );
  assert.ok(groups.some((g) => g.kind === ITEM_KIND.QUALITY_CHECK));
});

test("AC-NAV-01: no Quality Checks grouping when there are none", () => {
  const groups = navigatorGroups(bundle({ mappings: [mapping()] }));
  assert.ok(!groups.some((g) => g.kind === ITEM_KIND.QUALITY_CHECK));
});

test("AC-NAV-01: a Source Data grouping appears only where a mapping exists", () => {
  const withMapping = navigatorGroups(bundle({ mappings: [mapping()] }));
  assert.ok(withMapping.some((g) => g.kind === ITEM_KIND.MAPPING));
  assert.ok(!navigatorGroups(bundle()).some((g) => g.kind === ITEM_KIND.MAPPING));
});

test("AC-NAV-01: structure relationships are grouped by relationship type", () => {
  const groups = navigatorGroups(
    bundle({
      items: [
        { item_id: "node_voltage", name: "Tx Voltage" },
        { item_id: "node_tx", name: "Transformer" },
        { item_id: "val_11kv", name: "11 kv" },
      ].map((i) => ({
        item_kind: "HIERARCHY_NODE",
        status: "active",
        model_id: "m1",
        model_name: "Assets",
        type_name: "Asset Property",
        is_property: false,
        parent_id: null,
        ...i,
      })) as ImpactBundle["items"],
      edges: [
        edge("e1", "node_tx", "node_voltage"),
        edge("e2", "node_voltage", "val_11kv", {
          edge_kind: GOVERNANCE_EDGE_KIND.CROSS_MODEL,
          label: "Governs",
        }),
      ],
    }),
  );

  const relationship = groups.filter((g) => g.kind === ITEM_KIND.RELATIONSHIP);
  assert.equal(relationship.length, 2);
  assert.deepEqual(relationship.map((g) => g.label).sort(), ["Governs", "contains"]);
});

test("AC-NAV-01: every grouping says how many connected items it holds", () => {
  const groups = navigatorGroups(bundle({ runs: [run("run_1")], checks: [check("chk_1"), check("chk_2")] }));
  const quality = groups.find((g) => g.kind === ITEM_KIND.QUALITY_CHECK);
  assert.equal(quality?.count, 2);
});

test("AC-NAV-04: model structure is marked apart from observed quality results", () => {
  const groups = navigatorGroups(
    bundle({
      items: [
        {
          item_id: "node_tx",
          item_kind: "HIERARCHY_NODE",
          name: "Transformer",
          status: "active",
          model_id: "m1",
          model_name: "Assets",
          type_name: "Asset",
          is_property: false,
          parent_id: null,
        },
      ] as ImpactBundle["items"],
      edges: [edge("e1", "node_tx", "node_voltage")],
      runs: [run("run_1")],
      checks: [check("chk_1")],
      mappings: [mapping()],
    }),
  );
  const layerOf = (kind: string) => groups.find((g) => g.kind === kind)?.layer;
  assert.equal(layerOf(ITEM_KIND.RELATIONSHIP), "model");
  assert.equal(layerOf(ITEM_KIND.QUALITY_CHECK), "observed");
  assert.equal(layerOf(ITEM_KIND.MAPPING), "observed");
});

// ── findings: paging and aggregation ─────────────────────────────────────────

test("AC-NAV-09: a large finding set is not all loaded at once", () => {
  const findings = Array.from({ length: 500 }, (_, i) => finding(`f${i}`));
  const page = pageFindings(findings, { offset: 0, limit: 50 });
  assert.equal(page.rows.length, 50);
  assert.equal(page.total, 500);
  assert.equal(page.has_more, true);
  assert.equal(page.next_offset, 50);
});

test("AC-NAV-09: the last page says there is no more to fetch", () => {
  const findings = Array.from({ length: 60 }, (_, i) => finding(`f${i}`));
  const page = pageFindings(findings, { offset: 50, limit: 50 });
  assert.equal(page.rows.length, 10);
  assert.equal(page.has_more, false);
  assert.equal(page.next_offset, null);
});

test("AC-NAV-03: a check's findings can be read, and only that check's", () => {
  const findings = [
    finding("f1", { quality_check_id: "chk_1" }),
    finding("f2", { quality_check_id: "chk_2" }),
    finding("f3", { quality_check_id: "chk_1" }),
  ];
  const page = pageFindings(findings, { offset: 0, limit: 10, qualityCheckId: "chk_1" });
  assert.deepEqual(page.rows.map((f) => f.finding_id), ["f1", "f3"]);
  assert.equal(page.total, 2);
});

test("AC-VIS-03: a large finding set is one aggregated node, not one node per record", () => {
  const findings = Array.from({ length: 19 }, (_, i) => finding(`f${i}`));
  const shown = aggregateFindings(findings, { threshold: 5 });
  assert.equal(shown.aggregated, true);
  assert.equal(shown.nodes.length, 1);
  assert.equal(shown.nodes[0].kind, ITEM_KIND.FINDINGS_GROUP);
  assert.equal(shown.nodes[0].count, 19);
  assert.equal(shown.nodes[0].label, "19 findings requiring attention");
});

test("AC-VIS-03: a small finding set is drawn record by record", () => {
  const findings = [finding("f1"), finding("f2")];
  const shown = aggregateFindings(findings, { threshold: 5 });
  assert.equal(shown.aggregated, false);
  assert.deepEqual(shown.nodes.map((n) => n.kind), [ITEM_KIND.FINDING, ITEM_KIND.FINDING]);
});

test("AC-VIS-03: one finding is described in the singular", () => {
  const shown = aggregateFindings([finding("f1")], { threshold: 0 });
  assert.equal(shown.nodes[0].label, "1 finding requiring attention");
});

test("AC-VIS-04: the aggregated node carries the findings it stands for", () => {
  const findings = Array.from({ length: 19 }, (_, i) => finding(`f${i}`));
  const shown = aggregateFindings(findings, { threshold: 5 });
  assert.deepEqual(shown.nodes[0].finding_ids.slice(0, 2), ["f0", "f1"]);
  assert.equal(shown.nodes[0].finding_ids.length, 19);
});

test("AC-VIS-03 / AC-VIS-11: aggregating does not touch the findings it was given", () => {
  const findings = [finding("f1"), finding("f2")];
  const snapshot = JSON.stringify(findings);
  aggregateFindings(findings, { threshold: 1 });
  assert.equal(JSON.stringify(findings), snapshot);
});

// ── lineage ──────────────────────────────────────────────────────────────────

test("AC-VIS-05: mapping lineage reads source column → PDP target → quality check", () => {
  const path = lineageFor("mapping", {
    mapping: mapping(),
    check: check("chk_1"),
    configuration: null,
    references: [],
  });
  assert.deepEqual(path.map((step) => step.kind), [
    ITEM_KIND.SOURCE_COLUMN,
    ITEM_KIND.TARGET,
    ITEM_KIND.QUALITY_CHECK,
  ]);
  assert.deepEqual(path.map((step) => step.relation), [null, "mapped to", "assessed by"]);
});

test("AC-VIS-06: rule lineage reads PDP target → rule configuration → quality check", () => {
  const path = lineageFor("rule", {
    mapping: mapping(),
    check: check("chk_1"),
    configuration: {
      configuration_id: "cfg_1",
      rule_id: "rule_1",
      rule_code: "DQ-0001",
      rule_name: "Voltage is an approved value",
      target_node_id: "node_voltage",
      severity: "high",
      is_enabled: true,
      parameters: {},
    },
    references: [],
  });
  assert.deepEqual(path.map((step) => step.kind), [
    ITEM_KIND.TARGET,
    ITEM_KIND.RULE_CONFIGURATION,
    ITEM_KIND.QUALITY_CHECK,
  ]);
  assert.deepEqual(path.map((step) => step.relation), [null, "subject to", "assessed by"]);
});

test("AC-VIS-07: reference lineage reads PDP target → governed by → reference data", () => {
  const path = lineageFor("reference", {
    mapping: mapping(),
    check: check("chk_1"),
    configuration: {
      configuration_id: "cfg_1",
      rule_id: "rule_1",
      rule_code: "DQ-0001",
      rule_name: "Voltage is an approved value",
      target_node_id: "node_voltage",
      severity: "high",
      is_enabled: true,
      parameters: {},
    },
    references: [
      { reference_id: "val_11kv", name: "11 kv", element_type_name: "Voltage Class", model_name: "Classification" },
    ],
  });
  assert.deepEqual(path.map((step) => step.kind), [
    ITEM_KIND.TARGET,
    ITEM_KIND.RULE_CONFIGURATION,
    ITEM_KIND.REFERENCE_VALUE,
  ]);
  assert.equal(path[2].relation, "governed by");
  assert.equal(path[2].label, "11 kv");
});

test("AC-VIS-07: a rule with no reference data yields no reference lineage", () => {
  const path = lineageFor("reference", {
    mapping: mapping(),
    check: check("chk_1"),
    configuration: null,
    references: [],
  });
  assert.deepEqual(path, []);
});

// ── filters ──────────────────────────────────────────────────────────────────

test("AC-VIS-10: turning Quality Checks off leaves the relationship graph standing", () => {
  const source = bundle({
    items: [
      {
        item_id: "node_tx",
        item_kind: "HIERARCHY_NODE",
        name: "Transformer",
        status: "active",
        model_id: "m1",
        model_name: "Assets",
        type_name: "Asset",
        is_property: false,
        parent_id: null,
      },
    ] as ImpactBundle["items"],
    edges: [edge("e1", "node_tx", "node_voltage")],
    runs: [run("run_1")],
    checks: [check("chk_1")],
    findings: [finding("f1")],
    mappings: [mapping()],
  });

  const filtered = withoutQualityResults(source);
  assert.equal(filtered.checks.length, 0);
  assert.equal(filtered.findings.length, 0);
  assert.equal(filtered.items.length, 1, "model items survive");
  assert.equal(filtered.edges.length, 1, "model relationships survive");
  assert.equal(filtered.mappings.length, 1, "mappings are not quality results");
});

test("AC-VIS-11 / read-only: filtering never edits the bundle it was handed", () => {
  const source = bundle({ runs: [run("run_1")], checks: [check("chk_1")], findings: [finding("f1")] });
  const snapshot = JSON.stringify(source);
  withoutQualityResults(source);
  filterBundle(source, { outcome: QUALITY_OUTCOME.FAILED });
  assert.equal(JSON.stringify(source), snapshot);
});

test("filters: Quality Outcome keeps only the checks asked for", () => {
  const source = bundle({
    runs: [run("run_1")],
    checks: [
      check("chk_pass", { status: "passed", observed_count: 0 }),
      check("chk_warn", { status: "warning" }),
      check("chk_fail", { status: "failed" }),
    ],
  });
  assert.deepEqual(
    filterBundle(source, { outcome: QUALITY_OUTCOME.FAILED }).checks.map((c) => c.quality_check_id),
    ["chk_fail"],
  );
  assert.deepEqual(
    filterBundle(source, { outcome: QUALITY_OUTCOME.ATTENTION }).checks.map((c) => c.quality_check_id),
    ["chk_warn"],
  );
  assert.equal(filterBundle(source, { outcome: "all" }).checks.length, 3);
});

test("filters: severity narrows findings without touching the checks", () => {
  const source = bundle({
    checks: [check("chk_1")],
    findings: [finding("f1", { severity: "high" }), finding("f2", { severity: "low" })],
  });
  const filtered = filterBundle(source, { severity: "high" });
  assert.deepEqual(filtered.findings.map((f) => f.finding_id), ["f1"]);
  assert.equal(filtered.checks.length, 1);
});

test("filters: bundle contents can be turned off one at a time", () => {
  const source = bundle({
    mappings: [mapping()],
    runs: [run("run_1")],
    checks: [check("chk_1")],
    findings: [finding("f1")],
  });
  const noFindings = filterBundle(source, { contents: ["relationships", "mappings", "checks"] });
  assert.equal(noFindings.findings.length, 0);
  assert.equal(noFindings.checks.length, 1);

  const onlyRelationships = filterBundle(source, { contents: ["relationships"] });
  assert.equal(onlyRelationships.mappings.length, 0);
  assert.equal(onlyRelationships.checks.length, 0);
  assert.equal(onlyRelationships.findings.length, 0);
});

test("filters: a model filter keeps the focus itself visible", () => {
  const items = [
    {
      item_id: "node_voltage",
      item_kind: "HIERARCHY_NODE",
      name: "Tx Voltage",
      status: "active",
      model_id: "m1",
      model_name: "Assets",
      type_name: "Asset Property",
      is_property: true,
      parent_id: null,
    },
    {
      item_id: "val_11kv",
      item_kind: "SUPPORT_DOMAIN_ELEMENT",
      name: "11 kv",
      status: "active",
      model_id: "m2",
      model_name: "Classification",
      type_name: "Voltage Class",
      is_property: false,
      parent_id: null,
    },
  ] as ImpactBundle["items"];
  const filtered = filterBundle(bundle({ items }), { modelIds: ["m2"] });
  assert.deepEqual(filtered.items.map((i) => i.item_id).sort(), ["node_voltage", "val_11kv"]);
});

// ── direction and layout ─────────────────────────────────────────────────────

test("feedback 1: upstream is what leads into the focus, downstream what leads out", () => {
  const edges = [
    edge("e1", "a", "focus"),
    edge("e2", "b", "a"),
    edge("e3", "focus", "x"),
    edge("e4", "x", "y"),
  ];
  const sides = directionFrom("focus", edges);
  assert.deepEqual([...sides.upstream].sort(), ["a", "b"]);
  assert.deepEqual([...sides.downstream].sort(), ["x", "y"]);
});

test("feedback 1: an instance reachable both ways is listed once", () => {
  const edges = [edge("e1", "both", "focus"), edge("e2", "focus", "both")];
  const sides = directionFrom("focus", edges);
  const everywhere = [...sides.upstream, ...sides.downstream].filter((id) => id === "both");
  assert.equal(everywhere.length, 1);
});

test("feedback 1: a cycle does not make the walk run forever", () => {
  const edges = [edge("e1", "focus", "a"), edge("e2", "a", "b"), edge("e3", "b", "focus")];
  const sides = directionFrom("focus", edges);
  assert.ok(sides.downstream.size >= 1);
  assert.ok(!sides.downstream.has("focus"));
});

test("feedback 1: the focus sits at level zero, upstream left, downstream right", () => {
  const edges = [edge("e1", "a", "focus"), edge("e2", "b", "a"), edge("e3", "focus", "x")];
  const levels = layoutLevels("focus", edges);
  assert.equal(levels.get("focus"), 0);
  assert.equal(levels.get("a"), -1);
  assert.equal(levels.get("b"), -2);
  assert.equal(levels.get("x"), 1);
});

test("feedback 1: the shortest distance wins when an item is reachable two ways", () => {
  const edges = [
    edge("e1", "focus", "a"),
    edge("e2", "a", "far"),
    edge("e3", "focus", "far"),
  ];
  assert.equal(layoutLevels("focus", edges).get("far"), 1);
});

test("feedback 1: direction is read from the recorded relationship, not from drawing order", () => {
  const reversed = [edge("e1", "focus", "x"), edge("e2", "a", "focus")].reverse();
  const sides = directionFrom("focus", reversed);
  assert.ok(sides.downstream.has("x"));
  assert.ok(sides.upstream.has("a"));
});
