/**
 * The Impact canvas rules, and what they are allowed to cost.
 *
 * Run with:  npm run test:impact
 *
 * Two kinds of test live here on purpose. The first kind pins behaviour a
 * reader depends on — a re-added node does not jump, an edge never outlives
 * the node it points at. The second kind pins *cost*: the canvas is specified
 * to carry several hundred nodes, and the way that specification gets broken
 * is never a visible bug, it is somebody replacing a Set lookup with an array
 * scan and nobody noticing until a customer opens a big diagram. A budget in
 * the suite is the only thing that notices.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  absorbNeighbourhood,
  addItems,
  canvasItemIds,
  degreeIndex,
  edgesWithin,
  EMPTY_CANVAS,
  forgetReveals,
  freePlacements,
  gridPlacements,
  lowestEdge,
  moveItem,
  NODE_HEIGHT,
  NODE_WIDTH,
  radialPlacements,
  reachableFrom,
  recordReveal,
  removeItems,
  restoreCanvas,
  revealedUnder,
  toSavedNodes,
  type CanvasState,
} from "./impactGraph.ts";
import {
  GOVERNANCE_EDGE_KIND,
  GOVERNANCE_ITEM_KIND,
  type GovernanceEdge,
  type GovernanceItem,
} from "../../structure/domain/structureGovernanceGraph.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

function item(id: string, extra: Partial<GovernanceItem> = {}): GovernanceItem {
  return {
    item_id: id,
    item_kind: GOVERNANCE_ITEM_KIND.HIERARCHY_NODE,
    name: id,
    status: "active",
    model_id: "m1",
    model_name: "Model",
    type_name: "Asset Property",
    is_property: false,
    parent_id: null,
    ...extra,
  };
}

function edge(id: string, source: string, target: string, extra: Partial<GovernanceEdge> = {}): GovernanceEdge {
  return {
    edge_id: id,
    edge_kind: GOVERNANCE_EDGE_KIND.CROSS_MODEL,
    source_id: source,
    target_id: target,
    label: "governs",
    governance_role: null,
    asserted: true,
    ...extra,
  };
}

const grid = (startY = 0) => (ids: string[]) => gridPlacements(ids, { startY });

// ── membership ───────────────────────────────────────────────────────────────

test("adding items places them and records what they are", () => {
  const canvas = addItems(EMPTY_CANVAS, [item("a"), item("b")], grid());
  assert.deepEqual(canvasItemIds(canvas), ["a", "b"]);
  assert.equal(canvas.items.a.name, "a");
  assert.notEqual(canvas.placements[0].x, canvas.placements[1].x);
});

test("re-adding an item never moves it", () => {
  let canvas = addItems(EMPTY_CANVAS, [item("a")], grid());
  canvas = moveItem(canvas, "a", 999, 777);
  canvas = addItems(canvas, [item("a"), item("b")], grid(500));

  const placed = canvas.placements.find((p) => p.itemId === "a");
  assert.deepEqual({ x: placed?.x, y: placed?.y }, { x: 999, y: 777 });
  assert.equal(canvas.placements.length, 2);
});

test("re-adding refreshes what the canvas knows about an item", () => {
  let canvas = addItems(EMPTY_CANVAS, [item("a", { name: "Old name" })], grid());
  canvas = addItems(canvas, [item("a", { name: "New name", status: "retired" })], grid());
  assert.equal(canvas.items.a.name, "New name");
  assert.equal(canvas.items.a.status, "retired");
  assert.equal(canvas.placements.length, 1);
});

test("a duplicate in one batch is added once", () => {
  const canvas = addItems(EMPTY_CANVAS, [item("a"), item("a"), item("b")], grid());
  assert.deepEqual(canvasItemIds(canvas), ["a", "b"]);
});

test("removing an item takes its edges with it", () => {
  let canvas = addItems(EMPTY_CANVAS, [item("a"), item("b"), item("c")], grid());
  canvas = absorbNeighbourhood(
    canvas,
    { items: [], edges: [edge("e1", "a", "b"), edge("e2", "b", "c")] },
    grid(),
  );
  assert.equal(Object.keys(canvas.edges).length, 2);

  canvas = removeItems(canvas, ["b"]);
  assert.deepEqual(canvasItemIds(canvas), ["a", "c"]);
  assert.deepEqual(Object.keys(canvas.edges), [], "an edge must not outlive either of its ends");
  assert.equal(canvas.items.b, undefined);
});

test("moving an item the canvas does not hold changes nothing", () => {
  const canvas = addItems(EMPTY_CANVAS, [item("a")], grid());
  assert.equal(moveItem(canvas, "ghost", 10, 10), canvas);
});

// ── which lines may be drawn ─────────────────────────────────────────────────

test("an edge is drawn only when both ends are on the canvas", () => {
  const edges = [edge("e1", "a", "b"), edge("e2", "b", "offscreen"), edge("e3", "ghost", "a")];
  const kept = edgesWithin(edges, ["a", "b"]);
  assert.deepEqual(kept.map((e) => e.edge_id), ["e1"]);
});

test("the same edge arriving twice is drawn once", () => {
  const kept = edgesWithin([edge("e1", "a", "b"), edge("e1", "a", "b")], ["a", "b"]);
  assert.equal(kept.length, 1);
});

test("absorbing a neighbourhood keeps only edges it can close", () => {
  const canvas = absorbNeighbourhood(
    EMPTY_CANVAS,
    {
      items: [item("a"), item("b")],
      edges: [edge("e1", "a", "b"), edge("e2", "a", "never-added")],
    },
    grid(),
  );
  assert.deepEqual(canvasItemIds(canvas), ["a", "b"]);
  assert.deepEqual(Object.keys(canvas.edges), ["e1"]);
});

test("projected edges are carried through, still marked as projected", () => {
  const canvas = absorbNeighbourhood(
    EMPTY_CANVAS,
    {
      items: [item("v1", { item_kind: GOVERNANCE_ITEM_KIND.SUPPORT_DOMAIN_ELEMENT }),
        item("v2", { item_kind: GOVERNANCE_ITEM_KIND.SUPPORT_DOMAIN_ELEMENT }),],
      edges: [edge("s1", "v1", "v2", { edge_kind: GOVERNANCE_EDGE_KIND.SUPPORT_DOMAIN, asserted: false })],
    },
    grid(),
  );
  assert.equal(canvas.edges.s1.asserted, false);
  assert.equal(canvas.edges.s1.edge_kind, GOVERNANCE_EDGE_KIND.SUPPORT_DOMAIN);
});

// ── reading the canvas ───────────────────────────────────────────────────────

test("degree counts both ends of every edge", () => {
  const degree = degreeIndex([edge("e1", "a", "b"), edge("e2", "a", "c")]);
  assert.deepEqual(degree, { a: 2, b: 1, c: 1 });
});

test("reachability ignores direction and respects the hop limit", () => {
  const edges = [edge("e1", "a", "b"), edge("e2", "c", "b"), edge("e3", "c", "d")];
  assert.deepEqual([...reachableFrom(edges, ["a"], 1)].sort(), ["a", "b"]);
  assert.deepEqual([...reachableFrom(edges, ["a"], 2)].sort(), ["a", "b", "c"]);
  assert.deepEqual([...reachableFrom(edges, ["a"], 9)].sort(), ["a", "b", "c", "d"]);
});

test("reachability terminates on a cycle", () => {
  const edges = [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")];
  assert.deepEqual([...reachableFrom(edges, ["a"], 50)].sort(), ["a", "b", "c"]);
});

// ── layout ───────────────────────────────────────────────────────────────────

test("a grid is deterministic and never stacks two items", () => {
  const once = gridPlacements(["a", "b", "c", "d", "e"], { columns: 2 });
  const again = gridPlacements(["a", "b", "c", "d", "e"], { columns: 2 });
  assert.deepEqual(once, again);
  const seen = new Set(once.map((p) => `${p.x},${p.y}`));
  assert.equal(seen.size, once.length);
});

test("a new batch lands clear of what is already placed", () => {
  const first = gridPlacements(["a", "b"], {});
  const second = gridPlacements(["c"], { startY: lowestEdge(first) });
  assert.ok(second[0].y >= lowestEdge(first));
});

test("a radial expansion puts every neighbour somewhere distinct", () => {
  const ring = radialPlacements({ x: 0, y: 0 }, Array.from({ length: 24 }, (_, i) => `n${i}`));
  assert.equal(ring.length, 24);
  assert.equal(new Set(ring.map((p) => `${p.x},${p.y}`)).size, 24);
});

test("a radial expansion leaves the centre free", () => {
  const ring = radialPlacements({ x: 100, y: 100 }, ["a", "b", "c"]);
  for (const placement of ring) {
    const distance = Math.hypot(placement.x - 100, placement.y - 100);
    assert.ok(distance > 100, "a neighbour must not land on top of what was expanded");
  }
});

// ── saving and reopening ─────────────────────────────────────────────────────

test("a saved diagram round-trips positions exactly", () => {
  let canvas = addItems(EMPTY_CANVAS, [item("a"), item("b")], grid());
  canvas = moveItem(canvas, "a", 40, 90);
  const saved = toSavedNodes(canvas);

  const { canvas: restored, missingIds } = restoreCanvas(saved, [item("a"), item("b")], []);
  assert.deepEqual(missingIds, []);
  assert.deepEqual(
    restored.placements.find((p) => p.itemId === "a"),
    { itemId: "a", x: 40, y: 90 },
  );
});

test("reopening names the items that no longer exist instead of dropping them quietly", () => {
  const saved = [
    { item_id: "a", item_kind: GOVERNANCE_ITEM_KIND.HIERARCHY_NODE, pos_x: 0, pos_y: 0 },
    { item_id: "gone", item_kind: GOVERNANCE_ITEM_KIND.HIERARCHY_NODE, pos_x: 10, pos_y: 10 },
  ];
  const { canvas, missingIds } = restoreCanvas(saved, [item("a")], [edge("e1", "a", "gone")]);
  assert.deepEqual(missingIds, ["gone"]);
  assert.deepEqual(canvasItemIds(canvas), ["a"]);
  assert.deepEqual(Object.keys(canvas.edges), [], "no line may point at a node that is gone");
});

test("saving skips a placement whose item was never resolved", () => {
  const canvas: CanvasState = {
    placements: [{ itemId: "ghost", x: 1, y: 2 }],
    items: {},
    edges: {},
  };
  assert.deepEqual(toSavedNodes(canvas), []);
});

// ── cost ─────────────────────────────────────────────────────────────────────
//
// Budgets are deliberately loose — several times what the operation takes on a
// developer machine — because a tight budget on shared CI fails for reasons
// that have nothing to do with the code. They are set to catch a change in
// *complexity*, which blows past them by orders of magnitude, not a change in
// speed.

const LARGE_ITEMS = 2000;
const LARGE_EDGES = 6000;

function largeGraph() {
  const items = Array.from({ length: LARGE_ITEMS }, (_, i) => item(`n${i}`));
  const edges = Array.from({ length: LARGE_EDGES }, (_, i) =>
    edge(`e${i}`, `n${i % LARGE_ITEMS}`, `n${(i * 7 + 3) % LARGE_ITEMS}`),
  );
  return { items, edges };
}

function millisFor(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

test(`filtering ${LARGE_EDGES} edges against ${LARGE_ITEMS} items stays linear`, () => {
  const { items, edges } = largeGraph();
  const ids = new Set(items.map((i) => i.item_id));
  const elapsed = millisFor(() => {
    const kept = edgesWithin(edges, ids);
    assert.ok(kept.length > 0);
  });
  assert.ok(elapsed < 150, `edgesWithin took ${elapsed.toFixed(1)}ms, budget 150ms`);
});

test(`building a canvas of ${LARGE_ITEMS} items stays inside a frame budget`, () => {
  const { items, edges } = largeGraph();
  let canvas = EMPTY_CANVAS;
  const elapsed = millisFor(() => {
    canvas = absorbNeighbourhood(EMPTY_CANVAS, { items, edges }, grid());
  });
  assert.equal(canvas.placements.length, LARGE_ITEMS);
  assert.ok(elapsed < 400, `absorbNeighbourhood took ${elapsed.toFixed(1)}ms, budget 400ms`);
});

test("adding one item to a full canvas does not cost what building it did", () => {
  const { items, edges } = largeGraph();
  const canvas = absorbNeighbourhood(EMPTY_CANVAS, { items, edges }, grid());
  const elapsed = millisFor(() => {
    addItems(canvas, [item("one-more")], grid());
  });
  assert.ok(elapsed < 60, `adding one item took ${elapsed.toFixed(1)}ms, budget 60ms`);
});

test("removing one item from a full canvas stays linear", () => {
  const { items, edges } = largeGraph();
  const canvas = absorbNeighbourhood(EMPTY_CANVAS, { items, edges }, grid());
  const elapsed = millisFor(() => {
    const after = removeItems(canvas, ["n0"]);
    assert.equal(after.placements.length, LARGE_ITEMS - 1);
  });
  assert.ok(elapsed < 150, `removeItems took ${elapsed.toFixed(1)}ms, budget 150ms`);
});

test("reachability over a large graph stays linear", () => {
  const { edges } = largeGraph();
  const elapsed = millisFor(() => {
    const reached = reachableFrom(edges, ["n0"], 4);
    assert.ok(reached.size > 1);
  });
  assert.ok(elapsed < 150, `reachableFrom took ${elapsed.toFixed(1)}ms, budget 150ms`);
});


// ── placing what an expansion reveals ────────────────────────────────────────

/** Two cards overlap when both axes are inside a card's own size. */
function overlapping(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;
}

test("revealed cards never land on a card already on the canvas", () => {
  const taken = gridPlacements(
    Array.from({ length: 24 }, (_, i) => `old${i}`),
    { columns: 6 },
  );
  const placed = freePlacements({ x: 0, y: 0 }, ["a", "b", "c", "d", "e", "f"], taken);

  assert.equal(placed.length, 6);
  for (const fresh of placed) {
    for (const old of taken) {
      assert.ok(!overlapping(fresh, old), `${fresh.itemId} landed on ${old.itemId}`);
    }
  }
});

test("revealed cards do not land on each other", () => {
  const placed = freePlacements({ x: 0, y: 0 }, Array.from({ length: 40 }, (_, i) => `n${i}`));
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      assert.ok(!overlapping(placed[i], placed[j]), `${placed[i].itemId} sits on ${placed[j].itemId}`);
    }
  }
});

test("the card that was expanded keeps its own spot", () => {
  const anchor = { itemId: "anchor", x: 120, y: -40 };
  const placed = freePlacements({ x: anchor.x, y: anchor.y }, ["a", "b", "c"], [anchor]);
  for (const fresh of placed) assert.ok(!overlapping(fresh, anchor));
});

test("revealed cards fan out from the anchor, nearest first", () => {
  const placed = freePlacements({ x: 1000, y: 500 }, ["a", "b", "c", "d"]);
  const distance = (p: { x: number; y: number }) =>
    Math.hypot(p.x - 1000, p.y - 500);
  // Everything lands in the first ring around the anchor, not off in a corner.
  for (const fresh of placed) assert.ok(distance(fresh) < 700, `${fresh.itemId} is ${distance(fresh)} away`);
});

test("placing the same reveal twice gives the same layout", () => {
  const taken = gridPlacements(["x", "y", "z"]);
  const once = freePlacements({ x: 0, y: 0 }, ["a", "b", "c"], taken);
  const twice = freePlacements({ x: 0, y: 0 }, ["a", "b", "c"], taken);
  assert.deepEqual(once, twice);
});

// ── the expansion ledger ─────────────────────────────────────────────────────

test("collapsing takes back exactly what that expansion revealed", () => {
  const ledger = recordReveal({}, "hub", ["a", "b", "c"]);
  assert.deepEqual(revealedUnder(ledger, "hub").sort(), ["a", "b", "c"]);
});

test("collapsing also takes back what was revealed beneath it", () => {
  let ledger = recordReveal({}, "hub", ["a", "b"]);
  ledger = recordReveal(ledger, "a", ["a1", "a2"]);
  ledger = recordReveal(ledger, "a1", ["deep"]);
  assert.deepEqual(revealedUnder(ledger, "hub").sort(), ["a", "a1", "a2", "b", "deep"]);
});

test("a ledger with a cycle in it still terminates", () => {
  let ledger = recordReveal({}, "a", ["b"]);
  ledger = recordReveal(ledger, "b", ["a", "c"]);
  assert.deepEqual(revealedUnder(ledger, "a").sort(), ["b", "c"]);
});

test("an expansion never claims the card it was made from", () => {
  const ledger = recordReveal({}, "hub", ["hub", "a"]);
  assert.deepEqual(ledger.hub, ["a"]);
});

test("cards taken off the canvas leave the ledger", () => {
  let ledger = recordReveal({}, "hub", ["a", "b"]);
  ledger = recordReveal(ledger, "a", ["a1"]);
  const after = forgetReveals(ledger, ["a"]);
  assert.equal(after.a, undefined);
  assert.deepEqual(after.hub, ["b"]);
});

test("forgetting nothing leaves the ledger alone", () => {
  const ledger = recordReveal({}, "hub", ["a"]);
  assert.equal(forgetReveals(ledger, []), ledger);
});

test("placing a large reveal onto a crowded canvas stays inside a frame budget", () => {
  const taken = gridPlacements(
    Array.from({ length: 400 }, (_, i) => `old${i}`),
    { columns: 20 },
  );
  const ids = Array.from({ length: 300 }, (_, i) => `new${i}`);
  const elapsed = millisFor(() => {
    const placed = freePlacements({ x: 0, y: 0 }, ids, taken);
    assert.equal(placed.length, 300);
  });
  assert.ok(elapsed < 250, `freePlacements took ${elapsed.toFixed(1)}ms, budget 250ms`);
});
