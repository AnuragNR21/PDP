/**
 * The Impact Visualiser feedback, as executable statements.
 *
 * Written before the code. Each test names the numbered requirement from the
 * feedback document it pins, so a regression fails under the requirement's own
 * name rather than under a helper's.
 *
 * The thread running through all of it: direction is a recorded fact about a
 * relationship, not a property of where a node happens to sit. Everything here
 * reads direction from the edge and derives the picture from that — never the
 * other way round.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECTION,
  affectedRecordSummary,
  anchorsToRefresh,
  connectedModels,
  directedLayout,
  dragSelection,
  observedPath,
  filterByDirection,
  nearestPaths,
  relayoutVisible,
  type LayoutItem,
  canvasSignature,
  hasUnsavedChanges,
} from "./impactLayout.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

function edge(source: string, target: string, id = `${source}->${target}`) {
  return { edge_id: id, source_id: source, target_id: target };
}

function item(id: string, modelId = "m1", extra: Partial<LayoutItem> = {}): LayoutItem {
  return {
    item_id: id,
    name: id,
    model_id: modelId,
    model_name: modelId === "m1" ? "Assets" : "Classification",
    model_kind: modelId === "m1" ? "HIERARCHY_MODEL" : "SUPPORT_DOMAIN_MODEL",
    type_name: "Asset",
    ...extra,
  };
}

/** `a → b → focus → x → y`, plus an unrelated island. */
function chain() {
  return {
    items: ["a", "b", "focus", "x", "y", "island"].map((id) => item(id)),
    edges: [edge("b", "a"), edge("a", "focus"), edge("focus", "x"), edge("x", "y")],
  };
}

// ── 1. directional layout ────────────────────────────────────────────────────

test("docx 1: the focus sits centrally and upstream goes left, downstream right", () => {
  const { items, edges } = chain();
  const places = new Map(
    directedLayout("focus", items, edges).map((p) => [p.itemId, p]),
  );

  assert.equal(places.get("focus")?.x, 0);
  assert.ok((places.get("a")?.x ?? 0) < 0, "a leads into the focus, so it is left of it");
  assert.ok((places.get("b")?.x ?? 0) < (places.get("a")?.x ?? 0), "b is further upstream than a");
  assert.ok((places.get("x")?.x ?? 0) > 0, "x is reached from the focus, so it is right of it");
  assert.ok((places.get("y")?.x ?? 0) > (places.get("x")?.x ?? 0), "y is further downstream than x");
});

test("docx 1: successive levels are successive columns, evenly spaced", () => {
  const { items, edges } = chain();
  const places = new Map(directedLayout("focus", items, edges).map((p) => [p.itemId, p]));
  const step = (places.get("x")?.x ?? 0) - (places.get("focus")?.x ?? 0);
  assert.ok(step > 0);
  assert.equal((places.get("y")?.x ?? 0) - (places.get("x")?.x ?? 0), step);
  assert.equal((places.get("focus")?.x ?? 0) - (places.get("a")?.x ?? 0), step);
});

test("docx 1: an instance reachable both ways is placed once", () => {
  const items = ["focus", "both"].map((id) => item(id));
  const edges = [edge("both", "focus", "in"), edge("focus", "both", "out")];
  const places = directedLayout("focus", items, edges);
  assert.equal(places.filter((p) => p.itemId === "both").length, 1);
});

test("docx 1: cards in one column do not land on top of each other", () => {
  const items = ["focus", "x1", "x2", "x3"].map((id) => item(id));
  const edges = [edge("focus", "x1"), edge("focus", "x2"), edge("focus", "x3")];
  const places = directedLayout("focus", items, edges);
  const column = places.filter((p) => p.itemId !== "focus");
  const ys = column.map((p) => p.y).sort((a, b) => a - b);
  assert.equal(new Set(ys).size, 3, "three distinct rows");
  assert.ok(ys[1] - ys[0] >= 80, "far enough apart to read");
});

test("docx 1: a column is centred on the focus rather than hanging below it", () => {
  const items = ["focus", "x1", "x2"].map((id) => item(id));
  const edges = [edge("focus", "x1"), edge("focus", "x2")];
  const places = directedLayout("focus", items, edges);
  const ys = places.filter((p) => p.itemId !== "focus").map((p) => p.y);
  assert.equal(ys.reduce((total, y) => total + y, 0), 0, "the column balances around zero");
});

test("docx 1: an unconnected instance is still placed, below the focus's diagram rather than beside it", () => {
  const { items, edges } = chain();
  const placements = directedLayout("focus", items, edges);
  const places = new Map(placements.map((p) => [p.itemId, p]));
  const island = places.get("island");
  assert.ok(island, "it is not dropped");
  // Parking unconnected cards in a column beside the focus is what piled a
  // whole model into one unreadable column; they go below instead.
  const lowest = Math.max(...placements.filter((p) => p.itemId !== "island").map((p) => p.y));
  assert.ok(island!.y > lowest, "it sits below everything connected to the focus");
});

test("docx 1: the same graph laid out twice gives the same picture", () => {
  const { items, edges } = chain();
  assert.deepEqual(directedLayout("focus", items, edges), directedLayout("focus", items, edges));
});

test("docx 1: a cycle back to the focus does not reverse anyone's meaning", () => {
  const items = ["focus", "a", "b"].map((id) => item(id));
  const edges = [edge("focus", "a"), edge("a", "b"), edge("b", "focus")];
  const places = new Map(directedLayout("focus", items, edges).map((p) => [p.itemId, p]));
  assert.equal(places.get("focus")?.x, 0);
  assert.ok((places.get("a")?.x ?? 0) > 0, "a is still reached from the focus");
});

// ── 1b. direction filter ─────────────────────────────────────────────────────

test("docx 1: Both shows everything", () => {
  const { items, edges } = chain();
  const view = filterByDirection("focus", items, edges, DIRECTION.BOTH);
  assert.equal(view.itemIds.length, items.length);
});

test("docx 1: Upstream shows only what leads into the focus", () => {
  const { items, edges } = chain();
  const view = filterByDirection("focus", items, edges, DIRECTION.UPSTREAM);
  assert.deepEqual([...view.itemIds].sort(), ["a", "b", "focus"]);
});

test("docx 1: Downstream shows only what the focus leads to", () => {
  const { items, edges } = chain();
  const view = filterByDirection("focus", items, edges, DIRECTION.DOWNSTREAM);
  assert.deepEqual([...view.itemIds].sort(), ["focus", "x", "y"]);
});

test("docx 1: the focus itself is never filtered away", () => {
  const { items, edges } = chain();
  for (const mode of [DIRECTION.BOTH, DIRECTION.UPSTREAM, DIRECTION.DOWNSTREAM]) {
    assert.ok(filterByDirection("focus", items, edges, mode).itemIds.includes("focus"), mode);
  }
});

test("docx 1: a filtered view keeps only the connectors whose both ends it kept", () => {
  const { items, edges } = chain();
  const view = filterByDirection("focus", items, edges, DIRECTION.UPSTREAM);
  assert.deepEqual([...view.edgeIds].sort(), ["a->focus", "b->a"]);
});

test("docx 1: filtering reports a view and never edits what it was given", () => {
  const { items, edges } = chain();
  const snapshot = JSON.stringify({ items, edges });
  filterByDirection("focus", items, edges, DIRECTION.UPSTREAM);
  assert.equal(JSON.stringify({ items, edges }), snapshot);
});

// ── 2. depth changes refresh what is already open ────────────────────────────

test("docx 2: changing depth refreshes every open branch, not just the last", () => {
  const ledger = { hub_a: ["x"], hub_b: ["y", "z"] };
  assert.deepEqual(anchorsToRefresh(ledger).sort(), ["hub_a", "hub_b"]);
});

test("docx 2: with nothing expanded there is nothing to refresh", () => {
  assert.deepEqual(anchorsToRefresh({}), []);
});

// ── 4. connected models for the selected hubs ────────────────────────────────

function twoModels() {
  const items = [
    item("focus", "m1"),
    item("near", "m2"),
    item("far", "m2"),
    item("other", "m1"),
  ];
  const edges = [edge("focus", "near"), edge("near", "far"), edge("focus", "other")];
  return { items, edges };
}

test("docx 4: each connected model is listed once, with its distinct instance count", () => {
  const { items, edges } = twoModels();
  const models = connectedModels(["focus"], items, edges);
  const classification = models.find((m) => m.model_id === "m2");
  assert.equal(models.filter((m) => m.model_id === "m2").length, 1);
  assert.equal(classification?.instance_count, 2);
  assert.equal(classification?.model_name, "Classification");
  assert.equal(classification?.model_kind, "SUPPORT_DOMAIN_MODEL");
});

test("docx 4: the hub's own model is identified separately", () => {
  const { items, edges } = twoModels();
  const models = connectedModels(["focus"], items, edges);
  assert.equal(models.find((m) => m.model_id === "m1")?.is_own_model, true);
  assert.equal(models.find((m) => m.model_id === "m2")?.is_own_model, false);
});

test("docx 4: the hub itself is not counted as one of its model's connected instances", () => {
  const { items, edges } = twoModels();
  const own = connectedModels(["focus"], items, edges).find((m) => m.model_id === "m1");
  assert.equal(own?.instance_count, 1, "only 'other', not the focus");
});

test("docx 4: depth limits what counts as connected", () => {
  const { items, edges } = twoModels();
  const shallow = connectedModels(["focus"], items, edges, { depth: 1 });
  assert.equal(shallow.find((m) => m.model_id === "m2")?.instance_count, 1, "only 'near'");
});

test("docx 4: direction limits what counts as connected", () => {
  const items = [item("focus", "m1"), item("up", "m2"), item("down", "m2")];
  const edges = [edge("up", "focus"), edge("focus", "down")];
  const upstream = connectedModels(["focus"], items, edges, { direction: DIRECTION.UPSTREAM });
  assert.equal(upstream.find((m) => m.model_id === "m2")?.instance_count, 1);
});

test("docx 4: 'any selected hub' is the default and lists what one hub reaches", () => {
  const items = [item("h1", "m1"), item("h2", "m1"), item("only_h1", "m2")];
  const edges = [edge("h1", "only_h1")];
  const models = connectedModels(["h1", "h2"], items, edges);
  assert.ok(models.some((m) => m.model_id === "m2"));
});

test("docx 4: 'every selected hub' drops what only some of them reach", () => {
  const items = [item("h1", "m1"), item("h2", "m1"), item("only_h1", "m2")];
  const edges = [edge("h1", "only_h1")];
  const models = connectedModels(["h1", "h2"], items, edges, { match: "every" });
  assert.ok(!models.some((m) => m.model_id === "m2"));
});

test("docx 4: each entry says which hubs reach it, so '2 of 3' can be shown", () => {
  const items = [item("h1", "m1"), item("h2", "m1"), item("h3", "m1"), item("shared", "m2")];
  const edges = [edge("h1", "shared"), edge("h2", "shared")];
  const entry = connectedModels(["h1", "h2", "h3"], items, edges).find((m) => m.model_id === "m2");
  assert.deepEqual(entry?.connected_hub_ids.sort(), ["h1", "h2"]);
  assert.equal(entry?.selected_hub_count, 3);
});

test("docx 4: the nearest instance is the one fewest steps away, not the first alphabetically", () => {
  const items = [item("focus", "m1"), item("aaa", "m2"), item("zzz", "m2")];
  // zzz is one step away; aaa is two. Alphabetically aaa would win, and that
  // is exactly the answer the requirement rules out.
  const edges = [edge("focus", "zzz"), edge("zzz", "aaa")];
  const found = nearestPaths("focus", "m2", items, edges);
  assert.deepEqual(found.paths[0], ["focus", "zzz"]);
  assert.equal(found.ambiguous, false);
});

test("docx 4: equally short paths are all offered rather than one picked silently", () => {
  const items = [item("focus", "m1"), item("left", "m2"), item("right", "m2")];
  const edges = [edge("focus", "left"), edge("focus", "right")];
  const found = nearestPaths("focus", "m2", items, edges);
  assert.equal(found.ambiguous, true);
  assert.equal(found.paths.length, 2);
  assert.deepEqual(found.paths.map((p) => p[p.length - 1]).sort(), ["left", "right"]);
});

test("docx 4: a path carries every instance in between, not just the destination", () => {
  const items = [item("focus", "m1"), item("middle", "m1"), item("end", "m2")];
  const edges = [edge("focus", "middle"), edge("middle", "end")];
  const found = nearestPaths("focus", "m2", items, edges);
  assert.deepEqual(found.paths[0], ["focus", "middle", "end"]);
});

test("docx 4: a model nothing reaches yields no path at all", () => {
  const { items, edges } = twoModels();
  assert.deepEqual(nearestPaths("focus", "m_missing", items, edges).paths, []);
});

test("docx 4: failed-record counts are reported per result and never summed blindly", () => {
  const summary = affectedRecordSummary([
    { result_id: "r1", failed_count: 19 },
    { result_id: "r2", failed_count: 4 },
  ]);
  assert.deepEqual(summary.per_result, [
    { result_id: "r1", failed_count: 19 },
    { result_id: "r2", failed_count: 4 },
  ]);
  assert.equal(summary.unique_total, null, "overlap has not been resolved, so there is no total");
  assert.ok(summary.reason.length > 0);
});

test("docx 4: one result alone can state its own total", () => {
  const summary = affectedRecordSummary([{ result_id: "r1", failed_count: 19 }]);
  assert.equal(summary.unique_total, 19);
});

// ── 5. dragging a multi-selection ────────────────────────────────────────────

test("docx 5: dragging one of several selected instances brings all of them", () => {
  assert.deepEqual(dragSelection("b", ["a", "b", "c"]), ["a", "b", "c"]);
});

test("docx 5: dragging an instance outside the selection brings only that one", () => {
  assert.deepEqual(dragSelection("z", ["a", "b"]), ["z"]);
});

test("docx 5: with nothing selected, a drag brings the instance dragged", () => {
  assert.deepEqual(dragSelection("z", []), ["z"]);
});

test("docx 5: the selection order is preserved, so the drop order is predictable", () => {
  assert.deepEqual(dragSelection("c", ["c", "a", "b"]), ["c", "a", "b"]);
});

// ── 1b. re-layout leaves hidden cards alone ──────────────────────────────────

test("docx 1: re-layout rearranges the visible cards and leaves hidden ones where they were", () => {
  const items = ["focus", "shown", "hidden"].map((id) => item(id));
  const edges = [edge("focus", "shown")];
  const stored = [
    { itemId: "focus", x: 999, y: 999 },
    { itemId: "shown", x: 888, y: 888 },
    { itemId: "hidden", x: 777, y: 777 },
  ];

  const next = relayoutVisible("focus", items, edges, stored, new Set(["focus", "shown"]));
  const at = (id: string) => next.find((p) => p.itemId === id);

  assert.equal(at("focus")?.x, 0, "the focus is re-centred");
  assert.ok((at("shown")?.x ?? 0) > 0, "a downstream card moves to the right");
  assert.deepEqual(at("hidden"), { itemId: "hidden", x: 777, y: 777 }, "a hidden card is untouched");
});

test("docx 1: re-layout keeps every card, visible or not", () => {
  const items = ["focus", "hidden"].map((id) => item(id));
  const stored = [
    { itemId: "focus", x: 10, y: 10 },
    { itemId: "hidden", x: 20, y: 20 },
  ];
  const next = relayoutVisible("focus", items, [], stored, new Set(["focus"]));
  assert.equal(next.length, 2);
});

// ── 4b. the traceable observed path ──────────────────────────────────────────

const sampleObserved = {
  hubId: "node_voltage",
  mapping: {
    mapping_id: "map_1",
    column_id: "col_voltage",
    column_name: "Voltage",
    target_node_id: "node_voltage",
    target_name: "Tx Voltage",
    session_name: "January load",
    file_name: "assets.csv",
  },
  check: {
    quality_check_id: "chk_1",
    rule_name: "Voltage is an approved value",
    rule_code: "DQ-0001",
    outcome: "failed",
    observed_count: 7,
    total_count: 100,
  },
};

test("docx 4: selecting a result adds the whole traceable path, not just its end", () => {
  const { items: added, edges: links } = observedPath(sampleObserved);
  assert.deepEqual(added.map((i) => i.item_id), [
    "observed:column:col_voltage",
    "observed:check:chk_1",
  ]);
  assert.deepEqual(links.map((e) => e.label), ["mapped to", "assessed by"]);
});

test("docx 4: the path runs source column → PDP target → quality result", () => {
  const { edges: links } = observedPath(sampleObserved);
  assert.equal(links[0].source_id, "observed:column:col_voltage");
  assert.equal(links[0].target_id, "node_voltage");
  assert.equal(links[1].source_id, "node_voltage");
  assert.equal(links[1].target_id, "observed:check:chk_1");
});

test("docx 4: observed links are distinguishable from model relationships", () => {
  const { edges: links } = observedPath(sampleObserved);
  // Never asserted: Discover found this, Structure did not state it.
  assert.ok(links.every((e) => e.asserted === false));
  assert.ok(links.every((e) => e.edge_kind === "observed"));
});

test("docx 4: observed cards are marked as observed rather than as model instances", () => {
  const { items: added } = observedPath(sampleObserved);
  assert.deepEqual(added.map((i) => i.observed_kind), ["source_column", "quality_check"]);
});

test("docx 4: the quality card carries enough to read the result without opening it", () => {
  const { items: added } = observedPath(sampleObserved);
  const card = added[1];
  assert.match(card.name, /Voltage is an approved value/);
  assert.equal(card.type_name, "7 of 100 need attention");
  assert.equal(card.model_name, "January load · assets.csv");
});

test("docx 4: a result with no mapping still links the check to its target", () => {
  const { items: added, edges: links } = observedPath({
    ...sampleObserved,
    mapping: null,
  });
  assert.deepEqual(added.map((i) => i.item_id), ["observed:check:chk_1"]);
  assert.deepEqual(links.map((e) => e.label), ["assessed by"]);
});

test("docx 4: adding the same path twice does not duplicate its cards", () => {
  const first = observedPath(sampleObserved);
  const second = observedPath(sampleObserved);
  assert.deepEqual(first.items.map((i) => i.item_id), second.items.map((i) => i.item_id));
  assert.deepEqual(first.edges.map((e) => e.edge_id), second.edges.map((e) => e.edge_id));
});

// ── docx 1: a revised layout is an unsaved change ───────────────────────────

const placedAt = (entries: Array<[string, number, number]>) => ({
  placements: entries.map(([itemId, x, y]) => ({ itemId, x, y })),
});

test("docx 1: a canvas is unchanged against the signature it was saved with", () => {
  const canvas = placedAt([
    ["a", 0, 0],
    ["b", 320, 0],
  ]);
  assert.equal(hasUnsavedChanges(canvas, canvasSignature(canvas)), false);
});

test("docx 1: moving a card marks the diagram unsaved", () => {
  const saved = canvasSignature(placedAt([["a", 0, 0]]));
  assert.equal(hasUnsavedChanges(placedAt([["a", 0, 120]]), saved), true);
});

test("docx 1: adding or taking off a card marks the diagram unsaved", () => {
  const saved = canvasSignature(placedAt([["a", 0, 0]]));
  assert.equal(hasUnsavedChanges(placedAt([["a", 0, 0], ["b", 320, 0]]), saved), true);
  assert.equal(hasUnsavedChanges({ placements: [] }, saved), true);
});

test("docx 1: a sub-pixel settle is not a change a reader made", () => {
  const saved = canvasSignature(placedAt([["a", 100, 100]]));
  assert.equal(hasUnsavedChanges(placedAt([["a", 100.4, 99.6]]), saved), false);
});

test("docx 1: the order cards were added in does not decide the signature", () => {
  const one = canvasSignature(placedAt([["a", 0, 0], ["b", 320, 0]]));
  const other = canvasSignature(placedAt([["b", 320, 0], ["a", 0, 0]]));
  assert.equal(one, other);
});

test("docx 1: a diagram that was never saved is unsaved as soon as it has a card", () => {
  const nothingSaved = canvasSignature({ placements: [] });
  assert.equal(hasUnsavedChanges({ placements: [] }, nothingSaved), false);
  assert.equal(hasUnsavedChanges(placedAt([["a", 0, 0]]), nothingSaved), true);
});

// ── docx 1: connectors should cross as little as the levels allow ───────────

const rowOf = (placements: Array<{ itemId: string; y: number }>, id: string) =>
  placements.find((p) => p.itemId === id)!.y;

test("docx 1: a column is ordered to follow the column before it, not the input", () => {
  // f feeds a and b; a feeds y and b feeds x. Listed in the order x, y the
  // third column crosses itself; read off its neighbours it does not.
  const items = ["f", "a", "b", "x", "y"].map((id) => item(id));
  const edges = [
    edge("f", "a"),
    edge("f", "b"),
    edge("a", "y"),
    edge("b", "x"),
  ];
  const placements = directedLayout("f", items, edges);
  assert.ok(rowOf(placements, "a") < rowOf(placements, "b"));
  assert.ok(
    rowOf(placements, "y") < rowOf(placements, "x"),
    "the card fed by the upper one should sit above the card fed by the lower one",
  );
});

test("docx 1: a card with nothing feeding it is laid out apart from the flow", () => {
  const items = ["f", "a", "b", "loner"].map((id) => item(id));
  const edges = [edge("f", "a"), edge("f", "b")];
  const placements = directedLayout("f", items, edges);
  assert.ok(rowOf(placements, "a") < rowOf(placements, "b"));
  const loner = placements.find((p) => p.itemId === "loner")!;
  const flow = placements.filter((p) => p.itemId !== "loner");
  assert.ok(loner.y > Math.max(...flow.map((p) => p.y)), "below the flow, not shuffled into it");
});

test("docx 1: ordering a column does not move it to a different level", () => {
  const items = ["f", "a", "b", "x", "y"].map((id) => item(id));
  const edges = [
    edge("f", "a"),
    edge("f", "b"),
    edge("a", "y"),
    edge("b", "x"),
  ];
  const placements = directedLayout("f", items, edges);
  const columnOf = (id: string) => placements.find((p) => p.itemId === id)!.x;
  assert.equal(columnOf("a"), columnOf("b"));
  assert.equal(columnOf("x"), columnOf("y"));
  assert.ok(columnOf("x") > columnOf("a"));
});

test("docx 1: upstream columns are ordered off their own neighbours too", () => {
  const items = ["f", "a", "b", "x", "y"].map((id) => item(id));
  const edges = [
    edge("a", "f"),
    edge("b", "f"),
    edge("y", "a"),
    edge("x", "b"),
  ];
  const placements = directedLayout("f", items, edges);
  assert.ok(rowOf(placements, "a") < rowOf(placements, "b"));
  assert.ok(rowOf(placements, "y") < rowOf(placements, "x"));
});

test("docx 1: the same graph laid out twice gives the same rows", () => {
  const items = ["f", "a", "b", "x", "y"].map((id) => item(id));
  const edges = [
    edge("f", "a"),
    edge("f", "b"),
    edge("a", "y"),
    edge("b", "x"),
  ];
  assert.deepEqual(directedLayout("f", items, edges), directedLayout("f", items, edges));
});
