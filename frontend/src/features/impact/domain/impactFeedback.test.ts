/**
 * impact_feedback_1.docx, the parts the first pass left open — as executable
 * statements. Each test names the requirement it pins.
 *
 * Run with `npm run test:impact`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  childrenOf,
  collapsedHidden,
  DIRECTION,
  MODEL_CATEGORY,
  canvasSignature,
  directedLayout,
  directionalPlacements,
  edgesOfKinds,
  filterByDirection,
  modelCategoryOf,
  pathEdgeIds,
  primaryFocus,
  refreshReveals,
  relaxedLevels,
  type LayoutItem,
} from "./impactLayout.ts";
import { gapLanes, labelPlacement, pathThrough, routeConnector, type Point, type Rect } from "./impactRouting.ts";
import {
  QUALITY_OUTCOME,
  discoverHrefFor,
  hubPathsTo,
  outcomeOf,
  resultEntries,
  type QualityCheck,
} from "./impactQualityResults.ts";
import { popUndo, pushUndo, revealedUnder, toSavedNodes, EMPTY_CANVAS } from "./impactGraph.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

const e = (source: string, target: string, kind = "hierarchy") => ({
  edge_id: `${source}->${target}`,
  source_id: source,
  target_id: target,
  edge_kind: kind,
});

const item = (id: string): LayoutItem => ({
  item_id: id,
  name: id,
  model_id: "m1",
  model_name: "Assets",
  model_kind: MODEL_CATEGORY.HIERARCHY,
  type_name: "Asset",
});

const W = 210;
const H = 64;
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < W && Math.abs(a.y - b.y) < H;

// ── 1. expanding places by direction, not in a ring ──────────────────────────

test("docx 1: expanding a card puts what leads into it on its left and what it leads to on its right", () => {
  // Network Asset contains Device; Device contains Transformer and Switch.
  const edges = [e("network", "device"), e("device", "transformer"), e("device", "switch")];
  const taken = [{ itemId: "device", x: 500, y: 300 }];
  const placed = new Map(
    directionalPlacements("device", ["network", "transformer", "switch"], edges, taken).map((p) => [
      p.itemId,
      p,
    ]),
  );
  assert.ok(placed.get("network")!.x < 500, "the parent is upstream, so left");
  assert.equal(placed.get("network")!.y, 300, "level with the card it leads into");
  assert.ok(placed.get("transformer")!.x > 500, "a child is downstream, so right");
  assert.ok(placed.get("switch")!.x > 500);
  assert.equal(placed.get("transformer")!.x, placed.get("switch")!.x, "one level, one column");
});

test("docx 1: revealed cards never land on a card already on the canvas", () => {
  const edges = [e("hub", "a"), e("hub", "b"), e("hub", "c")];
  const taken = [
    { itemId: "hub", x: 0, y: 0 },
    { itemId: "squatter", x: 320, y: 0 },
    { itemId: "squatter2", x: 320, y: 110 },
  ];
  const placed = directionalPlacements("hub", ["a", "b", "c"], edges, taken);
  for (const p of placed) for (const t of taken) assert.ok(!overlaps(p, t), `${p.itemId} on ${t.itemId}`);
  for (const p of placed) for (const q of placed) if (p !== q) assert.ok(!overlaps(p, q));
});

test("docx 1: expanding never moves a card that is already placed", () => {
  const edges = [e("hub", "a")];
  const taken = [
    { itemId: "hub", x: 10, y: 20 },
    { itemId: "a", x: -999, y: -999 },
  ];
  assert.deepEqual(directionalPlacements("hub", ["a"], edges, taken), [], "a is not new");
});

test("docx 1: the same expansion twice gives the same placements", () => {
  const edges = [e("p", "hub"), e("hub", "a"), e("hub", "b")];
  const taken = [{ itemId: "hub", x: 0, y: 0 }];
  assert.deepEqual(
    directionalPlacements("hub", ["p", "a", "b"], edges, taken),
    directionalPlacements("hub", ["p", "a", "b"], edges, taken),
  );
});

test("docx 1: two steps out keeps going in the same direction, a column further each step", () => {
  const edges = [e("hub", "child"), e("child", "grandchild")];
  const placed = new Map(
    directionalPlacements("hub", ["child", "grandchild"], edges, [{ itemId: "hub", x: 0, y: 0 }]).map(
      (p) => [p.itemId, p],
    ),
  );
  assert.ok(placed.get("grandchild")!.x > placed.get("child")!.x);
});

test("docx 1: a sibling reached through a shared parent sits beside the focus, not in a far column", () => {
  const items = ["parent", "focus", "sibling"].map(item);
  const edges = [e("parent", "focus"), e("parent", "sibling")];
  const at = new Map(directedLayout("focus", items, edges).map((p) => [p.itemId, p]));
  assert.deepEqual(at.get("focus"), { itemId: "focus", x: 0, y: 0 }, "the focus keeps the centre");
  assert.equal(at.get("sibling")!.x, 0, "parent → sibling still runs left to right");
  assert.ok(at.get("parent")!.x < 0);
});

test("docx 1: relaxed levels put every connector one column to the right of its source", () => {
  const edges = [e("a", "b"), e("c", "b"), e("c", "d")];
  const levels = relaxedLevels("a", edges);
  for (const edge of edges) {
    assert.equal(levels.get(edge.target_id)! - levels.get(edge.source_id)!, 1, edge.edge_id);
  }
});

// ── 1. connectors ────────────────────────────────────────────────────────────

const rect = (id: string, x: number, y: number): Rect => ({ id, x, y, width: W, height: H });
const rightOf = (r: Rect): Point => ({ x: r.x + r.width, y: r.y + r.height / 2 });
const leftOf = (r: Rect): Point => ({ x: r.x, y: r.y + r.height / 2 });

function crosses(points: Point[], r: Rect): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (maxX > r.x && minX < r.x + r.width && maxY > r.y && minY < r.y + r.height) return true;
  }
  return false;
}

test("docx 1: a connector leaves the right of its source and enters the left of its target", () => {
  const s = rect("s", 0, 0);
  const t = rect("t", 400, 200);
  const route = routeConnector(rightOf(s), leftOf(t), [s, t], { source: s, target: t });
  assert.deepEqual(route.points[0], rightOf(s));
  assert.deepEqual(route.points[route.points.length - 1], leftOf(t));
  const [before, last] = route.points.slice(-2);
  assert.equal(before.y, last.y, "it arrives horizontally");
  assert.ok(before.x < last.x, "travelling right, so the arrowhead points into the target");
});

test("docx 1: connectors route around cards rather than through them", () => {
  const s = rect("s", 0, 0);
  const t = rect("t", 640, 0);
  const wall = rect("wall", 320, 0); // squarely in the straight line
  const route = routeConnector(rightOf(s), leftOf(t), [s, t, wall], { source: s, target: t });
  assert.ok(!crosses(route.points, wall), JSON.stringify(route.points));
  assert.equal(route.kind, "detour");
});

test("docx 1: every segment is horizontal or vertical", () => {
  const s = rect("s", 0, 0);
  const t = rect("t", 640, 330);
  const route = routeConnector(rightOf(s), leftOf(t), [s, t, rect("w", 320, 160)], { source: s, target: t });
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1];
    const b = route.points[i];
    assert.ok(a.x === b.x || a.y === b.y, `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
});

test("docx 1: a return connection goes round both cards and still enters its target from the left", () => {
  // The target sits to the left: a cycle back into the focus.
  const s = rect("s", 320, 0);
  const t = rect("t", 0, 0);
  const route = routeConnector(rightOf(s), leftOf(t), [s, t], { source: s, target: t });
  assert.equal(route.kind, "return");
  assert.ok(!crosses(route.points.slice(1, -1), s), "it does not cut back through the source");
  assert.ok(!crosses(route.points.slice(1, -1), t), "or through the target");
  const [before, last] = route.points.slice(-2);
  assert.ok(before.x < last.x && before.y === last.y, "direction preserved at the arrowhead");
  assert.ok(route.points[1].x > route.points[0].x, "it still leaves to the right");
});

test("docx 1: labels sit beside the card they belong to, so a fan of labels does not stack", () => {
  const hub = rect("hub", 0, 110);
  const targets = [rect("a", 320, 0), rect("b", 320, 110), rect("c", 320, 220)];
  const labels = targets.map(
    (t) => routeConnector(rightOf(hub), leftOf(t), [hub, ...targets], { source: hub, target: t }).label,
  );
  const ys = new Set(labels.map((l) => l.y));
  assert.equal(ys.size, 3, "one label row per target");
  for (const [index, label] of labels.entries()) {
    assert.equal(label.y, leftOf(targets[index]).y);
  }
});

test("docx 1: two sources crossing the same gap get their own lanes, so their lines never merge", () => {
  const upper = rect("upper", 0, -110);
  const lower = rect("lower", 0, 110);
  const target = rect("target", 320, 0);
  const rects = new Map([upper, lower, target].map((r) => [r.id, r]));
  const lanes = gapLanes(
    [
      { edge_id: "u", source_id: "upper", target_id: "target" },
      { edge_id: "l", source_id: "lower", target_id: "target" },
    ],
    rects,
  );
  assert.notEqual(lanes.get("u"), lanes.get("l"));
  assert.ok(lanes.get("u")! < lanes.get("l")!, "the upper source takes the left lane, so the legs do not cross");
  const route = routeConnector(rightOf(upper), leftOf(target), [...rects.values()], { source: upper, target }, { laneX: lanes.get("u") });
  assert.ok(route.points.some((p) => p.x === lanes.get("u")), "the vertical leg runs in its lane");
});

test("docx 1: two connectors into one card do not print their labels on top of each other", () => {
  const near = rect("near", 0, 0);
  const far = rect("far", 0, -220);
  const target = rect("target", 320, 0);
  const rects = new Map([near, far, target].map((r) => [r.id, r]));
  const edges = [
    { edge_id: "n", source_id: "near", target_id: "target" },
    { edge_id: "f", source_id: "far", target_id: "target" },
  ];
  const where = labelPlacement(edges, rects);
  assert.equal(where.get("n"), "end");
  assert.equal(where.get("f"), "leg");
  const lanes = gapLanes(edges, rects);
  const a = routeConnector(rightOf(near), leftOf(target), [...rects.values()], { source: near, target }, { laneX: lanes.get("n"), labelOn: "end" }).label;
  const b = routeConnector(rightOf(far), leftOf(target), [...rects.values()], { source: far, target }, { laneX: lanes.get("f"), labelOn: "leg" }).label;
  assert.ok(Math.abs(a.x - b.x) > 30 || Math.abs(a.y - b.y) > 14, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
});

test("docx 1: the drawn path starts and ends where the route does", () => {
  const d = pathThrough([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 80 },
    { x: 100, y: 80 },
  ]);
  assert.match(d, /^M 0,0 /);
  assert.match(d, / L 100,80$/);
});

// ── 1. filters ───────────────────────────────────────────────────────────────

test("docx 1: switching off a kind of relationship hides those connectors and nothing else", () => {
  const edges = [e("a", "b", "hierarchy"), e("b", "c", "cross_model")];
  assert.deepEqual(edgesOfKinds(edges, new Set(["cross_model"])).map((x) => x.edge_id), ["a->b"]);
  assert.equal(edgesOfKinds(edges, new Set()).length, 2);
});

test("docx 1: the direction filter works together with the relationship filter", () => {
  const items = ["up", "focus", "down"].map(item);
  const edges = [e("up", "focus", "hierarchy"), e("focus", "down", "cross_model")];
  const view = filterByDirection(
    "focus",
    items,
    edgesOfKinds(edges, new Set(["cross_model"])),
    DIRECTION.DOWNSTREAM,
  );
  assert.deepEqual(view.itemIds, ["focus"], "down is only reached through a hidden kind");
});

// ── considerations: one primary focus ────────────────────────────────────────

test("docx 5: with several hubs there is exactly one focus, the one chosen first", () => {
  const canvasIds = ["a", "b", "c"];
  assert.equal(primaryFocus({ chosen: "c", hubIds: ["a", "b"], canvasIds }), "c");
  assert.equal(primaryFocus({ hubIds: ["b", "a"], canvasIds }), "b", "else the first hub opened");
  assert.equal(primaryFocus({ selectedIds: ["c"], canvasIds }), "c", "else what is selected");
  assert.equal(primaryFocus({ canvasIds }), "a", "else the first card");
  assert.equal(primaryFocus({ chosen: "gone", canvasIds }), "a", "a focus taken off the canvas is dropped");
  assert.equal(primaryFocus({ canvasIds: [] }), null);
});

// ── 2. depth changes, both ways ──────────────────────────────────────────────

test("docx 2: going from three steps to one takes back the outer rings", () => {
  const ledger = { hub: ["one", "two", "three"] };
  const { removeIds, ledger: next } = refreshReveals(ledger, { hub: ["one"] }, ["hub", "one", "two", "three"]);
  assert.deepEqual(removeIds.sort(), ["three", "two"]);
  assert.deepEqual(next.hub, ["one"]);
});

test("docx 2: going from one step to three brings in what is now reached", () => {
  const ledger = { hub: ["one"] };
  const { addIds, ledger: next, removeIds } = refreshReveals(
    ledger,
    { hub: ["one", "two", "three"] },
    ["hub", "one"],
  );
  assert.deepEqual(addIds.hub, ["two", "three"]);
  assert.deepEqual(next.hub, ["one", "two", "three"]);
  assert.deepEqual(removeIds, []);
});

test("docx 2: a card the reader added themselves is never taken back", () => {
  const ledger = { hub: ["one", "two"] };
  const { removeIds } = refreshReveals(ledger, { hub: ["one"] }, ["hub", "one", "two", "mine"]);
  assert.ok(!removeIds.includes("mine"));
});

test("docx 2: a card reached by another open branch stays", () => {
  const ledger = { a: ["shared"], b: [] as string[] };
  const { removeIds } = refreshReveals(ledger, { a: [], b: ["shared"] }, ["a", "b", "shared"]);
  assert.deepEqual(removeIds, []);
});

test("docx 2: a card the reader expanded is not taken back from under them", () => {
  const ledger = { hub: ["child"], child: ["grandchild"] };
  const { removeIds } = refreshReveals(ledger, { hub: [], child: ["grandchild"] }, ["hub", "child", "grandchild"]);
  assert.ok(!removeIds.includes("child"));
});

test("docx 2: after a refresh, collapsing still takes back only what expanding brought", () => {
  const ledger = { hub: ["one"] };
  const refreshed = refreshReveals(ledger, { hub: ["one", "mine", "two"] }, ["hub", "one", "mine"]).ledger;
  assert.deepEqual(revealedUnder(refreshed, "hub").sort(), ["one", "two"], "'mine' was the reader's");
});

// ── 4. connected models ──────────────────────────────────────────────────────

test("docx 4: a governed value's model is a Support Domain model, a node's a Hierarchy model", () => {
  assert.equal(modelCategoryOf("SUPPORT_DOMAIN_ELEMENT"), MODEL_CATEGORY.SUPPORT_DOMAIN);
  assert.equal(modelCategoryOf("HIERARCHY_NODE"), MODEL_CATEGORY.HIERARCHY);
  assert.equal(modelCategoryOf("HIERARCHY_MODEL"), MODEL_CATEGORY.HIERARCHY);
});

test("docx 4: a path's connectors are found whichever way each relationship points", () => {
  const edges = [e("hub", "mid"), e("end", "mid")];
  assert.deepEqual(pathEdgeIds(["hub", "mid", "end"], edges), ["hub->mid", "end->mid"]);
});

// ── 4. data quality results ──────────────────────────────────────────────────

function check(id: string, target: string, extra: Partial<QualityCheck> = {}): QualityCheck {
  return {
    quality_check_id: id,
    quality_run_id: "run1",
    session_id: "s1",
    target_node_id: target,
    target_name: target,
    column_id: `col_${target}`,
    column_name: `Col ${target}`,
    rule_id: null,
    rule_code: "R1",
    rule_name: "Rule",
    configuration_id: null,
    check_type: "governed_rule",
    status: "passed",
    severity: null,
    observed_count: 0,
    total_count: 10,
    message: "",
    ...extra,
  };
}

const run = {
  quality_run_id: "run1",
  session_id: "s1",
  session_name: "Session",
  source_file_id: "f1",
  table_name: "assets.csv",
  status: "completed",
  checked_columns: 1,
  findings_total: 0,
  failed_count: 0,
  warning_count: 0,
  rows_total: 10,
  completed_at: "2026-10-20T00:00:00Z",
  created_at: "2026-10-20T00:00:00Z",
};

test("docx 4: a hub's results are read through its properties", () => {
  // The hub is an Asset; Discover mapped the column onto its Voltage property.
  const entries = resultEntries(
    {
      checks: [check("c1", "voltage")],
      runs: [run],
      mappings: [],
      links: [{ hub_id: "transformer", node_id: "voltage", path: ["transformer", "voltage"] }],
    },
    ["transformer"],
  );
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].hub_ids, ["transformer"]);
});

test("docx 4: a configuration error is told apart from data that needs attention", () => {
  const broken = check("c1", "p", { check_type: "configuration_error", status: "warning" });
  assert.equal(outcomeOf(broken), QUALITY_OUTCOME.ERROR);
  assert.equal(outcomeOf(check("c2", "p", { status: "warning" })), QUALITY_OUTCOME.ATTENTION);
});

test("docx 4: a property governance expects checked and no run checked is listed as not assessed", () => {
  const entries = resultEntries(
    {
      checks: [],
      runs: [],
      mappings: [],
      not_assessed: [
        {
          target_node_id: "voltage",
          target_name: "Voltage",
          configuration_id: "cfg",
          rule_code: "COM-1",
          rule_name: "Approved voltage",
          applicability: "required",
          reason: "not_mapped",
        },
      ],
      links: [{ hub_id: "transformer", node_id: "voltage", path: ["transformer", "voltage"] }],
    },
    ["transformer"],
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].outcome, QUALITY_OUTCOME.NOT_ASSESSED);
  assert.notEqual(entries[0].outcome, QUALITY_OUTCOME.PASSED);
});

test("docx 4: 'every selected hub' keeps only a result traceable to each of them", () => {
  const report = {
    checks: [check("shared", "p_shared"), check("only_a", "p_a")],
    runs: [run],
    mappings: [],
    links: [
      { hub_id: "a", node_id: "p_shared", path: ["a", "p_shared"] },
      { hub_id: "b", node_id: "p_shared", path: ["b", "x", "p_shared"] },
      { hub_id: "a", node_id: "p_a", path: ["a", "p_a"] },
    ],
  };
  const any = resultEntries(report, ["a", "b"], "any");
  const every = resultEntries(report, ["a", "b"], "every");
  assert.equal(any.length, 2);
  assert.deepEqual(every.map((x) => x.check?.quality_check_id), ["shared"]);
  assert.equal(any.find((x) => x.check?.quality_check_id === "only_a")?.hub_ids.length, 1, "1 of 2");
});

test("docx 4: selecting a result draws a path from each hub that reaches it, and none from one that does not", () => {
  const links = [
    { hub_id: "a", node_id: "p", path: ["a", "p"] },
    { hub_id: "b", node_id: "p", path: ["b", "x", "p"] },
  ];
  const paths = hubPathsTo("p", ["a", "b", "c"], links);
  assert.deepEqual(
    paths.map((p) => p.hub_id),
    ["a", "b"],
  );
  assert.deepEqual(paths[1].path, ["b", "x", "p"]);
});

test("docx 4: the authoritative result is one click away in Discover", () => {
  assert.equal(discoverHrefFor("sess 1"), "/discover/mapping/sess%201");
  assert.equal(discoverHrefFor(null), null);
});

// ── considerations: undo and unsaved work ────────────────────────────────────

test("docx 5: a bulk change can be undone in one step", () => {
  const before = { ...EMPTY_CANVAS };
  const after = { ...EMPTY_CANVAS, placements: [{ itemId: "a", x: 0, y: 0 }] };
  const stack = pushUndo([], before);
  const { canvas, stack: rest } = popUndo(stack);
  assert.equal(canvas, before);
  assert.deepEqual(rest, []);
  assert.notEqual(canvas, after);
});

test("docx 5: undo keeps a bounded history", () => {
  let stack: (typeof EMPTY_CANVAS)[] = [];
  for (let i = 0; i < 50; i += 1) stack = pushUndo(stack, { ...EMPTY_CANVAS }, 30);
  assert.equal(stack.length, 30);
});

test("docx 4: observed cards are a reading of one run, so they are neither saved nor counted as unsaved work", () => {
  const canvas = {
    placements: [
      { itemId: "node", x: 0, y: 0 },
      { itemId: "observed:check:1", x: 100, y: 0 },
    ],
    items: {
      node: { item_id: "node", item_kind: "HIERARCHY_NODE" } as never,
      "observed:check:1": { item_id: "observed:check:1", item_kind: "OBSERVED" } as never,
    },
    edges: {},
  };
  assert.deepEqual(toSavedNodes(canvas).map((n) => n.item_id), ["node"]);
  assert.equal(
    canvasSignature(canvas),
    canvasSignature({ placements: [{ itemId: "node", x: 0, y: 0 }] }),
  );
});

// ── re-layout as a tree of tiers ─────────────────────────────────────────────

test("re-layout: each card sits level with its own block of children", () => {
  // root → (a → a1, a2), (b → b1, b2): a's children and b's never interleave.
  const items = ["root", "a", "a1", "a2", "b", "b1", "b2"].map(item);
  const edges = [e("root", "a"), e("root", "b"), e("a", "a1"), e("a", "a2"), e("b", "b1"), e("b", "b2")];
  const at = new Map(directedLayout("root", items, edges).map((p) => [p.itemId, p]));
  const ys = (ids: string[]) => ids.map((id) => at.get(id)!.y);
  assert.ok(Math.max(...ys(["a1", "a2"])) < Math.min(...ys(["b1", "b2"])), "blocks do not interleave");
  assert.equal(at.get("a")!.y, (at.get("a1")!.y + at.get("a2")!.y) / 2, "a is centred on its children");
  assert.equal(at.get("b")!.y, (at.get("b1")!.y + at.get("b2")!.y) / 2);
  assert.ok(at.get("a1")!.x > at.get("a")!.x && at.get("a")!.x > at.get("root")!.x, "one tier per level");
});

test("re-layout: a focus that reaches nothing does not pile the rest into one column", () => {
  // The screenshot case: 11kV on its own, a whole hierarchy beside it.
  const items = ["11kV", "model", "group", "type", "asset", "p1", "p2"].map(item);
  const edges = [e("model", "group"), e("group", "type"), e("type", "asset"), e("asset", "p1"), e("asset", "p2")];
  const at = new Map(directedLayout("11kV", items, edges).map((p) => [p.itemId, p]));
  assert.deepEqual(at.get("11kV"), { itemId: "11kV", x: 0, y: 0 });
  const columns = new Set(["model", "group", "type", "asset", "p1"].map((id) => at.get(id)!.x));
  assert.equal(columns.size, 5, "the hierarchy keeps one tier per level");
  assert.ok(at.get("model")!.y > 0, "and is laid out below the focus");
});

test("re-layout: no two cards share a slot, even a sibling in the focus's column", () => {
  const items = ["parent", "focus", "s1", "s2", "s3"].map(item);
  const edges = [e("parent", "focus"), e("parent", "s1"), e("parent", "s2"), e("parent", "s3")];
  const placements = directedLayout("focus", items, edges);
  for (const p of placements) for (const q of placements) {
    if (p !== q) assert.ok(!(p.x === q.x && Math.abs(p.y - q.y) < 64), `${p.itemId} on ${q.itemId}`);
  }
  assert.deepEqual(placements.find((p) => p.itemId === "focus"), { itemId: "focus", x: 0, y: 0 });
});

// ── collapse and expand children per card ────────────────────────────────────

test("children: a card's children are the cards it leads to", () => {
  assert.deepEqual(childrenOf("a", [e("a", "b"), e("a", "c"), e("c", "a")]), ["b", "c"]);
});

test("children: collapsing a card hides everything beneath it", () => {
  const edges = [e("asset", "p1"), e("asset", "p2"), e("p2", "value")];
  assert.deepEqual([...collapsedHidden(["asset"], edges)].sort(), ["p1", "p2", "value"]);
});

test("children: a card another open card still leads to stays on screen", () => {
  const edges = [e("t", "volts"), e("s", "volts"), e("t", "name")];
  const hidden = collapsedHidden(["t"], edges);
  assert.ok(!hidden.has("volts"), "s is open and governs it too");
  assert.ok(hidden.has("name"));
});

test("children: the focus is never hidden by collapsing its parent", () => {
  const edges = [e("device", "focus"), e("device", "switch")];
  const hidden = collapsedHidden(["device"], edges, new Set(["focus"]));
  assert.ok(!hidden.has("focus"));
  assert.ok(hidden.has("switch"));
});

test("children: expanding again shows exactly what collapsing hid", () => {
  const edges = [e("asset", "p1")];
  assert.equal(collapsedHidden([], edges).size, 0);
});
