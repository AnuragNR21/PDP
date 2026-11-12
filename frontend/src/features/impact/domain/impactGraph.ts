/**
 * The Impact canvas, as arithmetic.
 *
 * Everything here is a pure function over plain data: no React, no ReactFlow,
 * no imports that resolve through the bundler. That is deliberate twice over.
 * It keeps the rules of the canvas — what is on it, which lines may be drawn,
 * where a newly added item lands — testable without mounting anything; and it
 * keeps the hot paths in one file where their cost can be measured, because a
 * canvas holding several hundred nodes is where an accidental O(n²) stops
 * being a style note and starts being a frozen tab.
 *
 * The canvas is a *view*. Nothing in this module creates a node or a
 * relationship: items and edges arrive from the governed graph, and all the
 * canvas decides is which of them are on screen and where.
 *
 * On the two words, which are not synonyms:
 *
 * - The **graph** is the governance — every node instance, every governed
 *   value, and every relationship Structure asserts between them. One of it,
 *   shared, owned by nobody, read-only from here.
 * - A **diagram** is one person's saved *reading* of that graph: the few items
 *   they put on a canvas, where they dragged them, under a name. Many of them,
 *   each owned by whoever saved it, none authoritative. Deleting every diagram
 *   leaves the graph untouched; retiring a node leaves every diagram that
 *   showed it out of date, which is why `restoreCanvas` names what has gone
 *   instead of drawing a blank box.
 *
 * `CanvasState` is a diagram in progress. `toSavedNodes` / `restoreCanvas` are
 * the two ends of putting one away and taking it out again.
 */

import type {
  GovernanceEdge,
  GovernanceItem,
} from "@/features/structure/domain/structureGovernanceGraph";

/** Where one item sits. The canvas owns this; the graph knows nothing about it. */
export type Placement = {
  itemId: string;
  x: number;
  y: number;
};

export type CanvasState = {
  /** Insertion order is preserved: it is what the eye uses to follow a build-up. */
  placements: Placement[];
  items: Record<string, GovernanceItem>;
  edges: Record<string, GovernanceEdge>;
};

export const EMPTY_CANVAS: CanvasState = { placements: [], items: {}, edges: {} };

/**
 * The drag payload a selection row writes and the canvas reads.
 *
 * A private type rather than text/plain: a drop from somewhere else in the
 * browser should do nothing here, not put a stray card on the diagram.
 */
export const IMPACT_DRAG_TYPE = "application/pdp-impact-item";

// ── geometry ─────────────────────────────────────────────────────────────────

/** Node box, in canvas units. Layout spacing is derived from these. */
export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 64;
const COLUMN_GAP = 70;
const ROW_GAP = 34;

const STEP_X = NODE_WIDTH + COLUMN_GAP;
const STEP_Y = NODE_HEIGHT + ROW_GAP;

/**
 * Where to drop a batch of newly added items.
 *
 * A grid, filled column by column, starting below whatever is already there.
 * Deterministic on purpose: adding the same five items twice must put them in
 * the same place, or a saved diagram stops being reproducible and nobody can
 * say whether a layout changed because they moved something or because the
 * code felt like it.
 */
export function gridPlacements(
  itemIds: string[],
  options: { startY?: number; columns?: number; originX?: number } = {},
): Placement[] {
  const columns = Math.max(1, options.columns ?? 4);
  const originX = options.originX ?? 0;
  const startY = options.startY ?? 0;
  return itemIds.map((itemId, index) => ({
    itemId,
    x: originX + (index % columns) * STEP_X,
    y: startY + Math.floor(index / columns) * STEP_Y,
  }));
}

/**
 * Ring the neighbours of one item around it.
 *
 * Used when somebody expands a node: the thing they expanded stays put and
 * what it touches appears around it, so the shape of the answer is visible
 * without reading a single label. Rings grow outward as the count does, which
 * keeps a node with forty neighbours from drawing a circle the size of a
 * postcode.
 */
export function radialPlacements(
  centre: { x: number; y: number },
  itemIds: string[],
  options: { radius?: number; perRing?: number } = {},
): Placement[] {
  const baseRadius = options.radius ?? 260;
  const perRing = Math.max(1, options.perRing ?? 10);
  return itemIds.map((itemId, index) => {
    const ring = Math.floor(index / perRing);
    const indexInRing = index % perRing;
    const inThisRing = Math.min(perRing, itemIds.length - ring * perRing);
    const radius = baseRadius + ring * (baseRadius * 0.7);
    const angle = (2 * Math.PI * indexInRing) / inThisRing - Math.PI / 2;
    return {
      itemId,
      x: Math.round(centre.x + radius * Math.cos(angle)),
      y: Math.round(centre.y + radius * Math.sin(angle) * 0.75),
    };
  });
}

/**
 * How close two cards may sit before they read as one blob.
 *
 * Not the node size: two cards exactly a node apart share an edge and the eye
 * cannot tell where one stops. The gap is part of what makes a fan of twenty
 * revealed cards legible.
 */
const MIN_GAP_X = 28;
const MIN_GAP_Y = 22;

function collides(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return (
    Math.abs(a.x - b.x) < NODE_WIDTH + MIN_GAP_X && Math.abs(a.y - b.y) < NODE_HEIGHT + MIN_GAP_Y
  );
}

/**
 * The cells around a point, nearest ring first, each ring read round the clock.
 *
 * A plain grid fills left to right and buries the thing that was expanded in
 * the middle of a block. Walking rings outward keeps the expanded card at the
 * centre of its own answer, and going round by angle inside each ring means
 * the first few neighbours land above and beside it rather than all in a line.
 */
function* ringCells(maxRing: number): Generator<{ dx: number; dy: number }> {
  for (let ring = 1; ring <= maxRing; ring += 1) {
    const cells: { dx: number; dy: number }[] = [];
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) cells.push({ dx, dy });
      }
    }
    // Clockwise from straight up, so a handful of neighbours reads as a fan.
    cells.sort((a, b) => {
      const angle = (c: { dx: number; dy: number }) => {
        const raw = Math.atan2(c.dy, c.dx) + Math.PI / 2;
        return raw < 0 ? raw + 2 * Math.PI : raw;
      };
      return angle(a) - angle(b) || a.dx - b.dx || a.dy - b.dy;
    });
    yield* cells;
  }
}

/** How far out the ring search will look before it gives up and stacks below. */
const MAX_RING = 24;

/**
 * Place new cards around a point, in space nothing is using.
 *
 * This is what keeps an expansion readable. Ringing the neighbours around the
 * card that was expanded is right, but doing it blind drops them on top of
 * whatever was already there, and two canvases' worth of cards in one place is
 * worse than no layout at all. Here each card takes the nearest free cell
 * going outward, so the answer grows away from the question and never lands on
 * work the reader has already arranged.
 *
 * Deterministic: the same anchor, the same ids and the same occupied canvas
 * produce the same placements, so a saved diagram stays reproducible.
 */
export function freePlacements(
  centre: { x: number; y: number },
  itemIds: string[],
  taken: Placement[] = [],
  options: { stepX?: number; stepY?: number } = {},
): Placement[] {
  const stepX = options.stepX ?? STEP_X;
  const stepY = options.stepY ?? STEP_Y;
  const placements: Placement[] = [];

  /*
   * A bucket per card-sized patch of canvas.
   *
   * Checking a candidate against every card already placed is quadratic, and
   * an expansion that reveals a few hundred neighbours onto a canvas that
   * already holds a few hundred is exactly when the reader is least willing to
   * wait. Two cards can only collide if they share or touch a bucket, so nine
   * bucket lookups settle it however large the canvas is.
   */
  const bucketW = NODE_WIDTH + MIN_GAP_X;
  const bucketH = NODE_HEIGHT + MIN_GAP_Y;
  const buckets = new Map<string, { x: number; y: number }[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / bucketW)}:${Math.floor(y / bucketH)}`;

  const occupy = (spot: { x: number; y: number }) => {
    const key = keyOf(spot.x, spot.y);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(spot);
    else buckets.set(key, [spot]);
  };

  const isFree = (spot: { x: number; y: number }) => {
    const cx = Math.floor(spot.x / bucketW);
    const cy = Math.floor(spot.y / bucketH);
    for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
      for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
        const bucket = buckets.get(`${ix}:${iy}`);
        if (!bucket) continue;
        for (const other of bucket) if (collides(spot, other)) return false;
      }
    }
    return true;
  };

  for (const placement of taken) occupy({ x: placement.x, y: placement.y });

  let cells = ringCells(MAX_RING);
  let exhausted = false;
  // Where the fallback stacks, once every ring is full.
  let fallbackY = lowestEdge(taken) + stepY;

  for (const itemId of itemIds) {
    let spot: { x: number; y: number } | null = null;

    while (!exhausted) {
      const next = cells.next();
      if (next.done) {
        exhausted = true;
        break;
      }
      const candidate = {
        x: centre.x + next.value.dx * stepX,
        y: centre.y + next.value.dy * stepY,
      };
      if (isFree(candidate)) {
        spot = candidate;
        break;
      }
    }

    if (!spot) {
      spot = { x: centre.x, y: fallbackY };
      fallbackY += stepY;
    }

    occupy(spot);
    placements.push({ itemId, x: Math.round(spot.x), y: Math.round(spot.y) });
    // Each card restarts the search at the innermost ring, so a gap left by an
    // earlier card is used rather than stepped over.
    cells = ringCells(MAX_RING);
    exhausted = false;
  }

  return placements;
}

// ── what an expansion brought in ─────────────────────────────────────────────

/**
 * Which cards each expanded card put on the canvas.
 *
 * Expanding is a toggle, and a toggle has to be able to undo exactly what it
 * did: not everything related to the card — some of that the reader put there
 * themselves — but the cards that this expansion, and the expansions made from
 * inside it, actually added.
 */
export type RevealLedger = Record<string, string[]>;

export function recordReveal(
  ledger: RevealLedger,
  anchorId: string,
  revealedIds: string[],
): RevealLedger {
  const fresh = revealedIds.filter((id) => id && id !== anchorId);
  return { ...ledger, [anchorId]: Array.from(new Set(fresh)) };
}

/**
 * Everything an expansion is responsible for, expansions beneath it included.
 *
 * Collapse a card whose neighbour you then expanded, and leaving that
 * neighbour's own discoveries behind would strand them: cards with nothing
 * left on screen explaining why they are there.
 */
export function revealedUnder(ledger: RevealLedger, anchorId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([anchorId]);
  const queue = [...(ledger[anchorId] ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of ledger[id] ?? []) if (!seen.has(child)) queue.push(child);
  }
  return out;
}

/** Drop everything the ledger says about cards that are no longer on the canvas. */
export function forgetReveals(ledger: RevealLedger, goneIds: Iterable<string>): RevealLedger {
  const gone = new Set(goneIds);
  if (gone.size === 0) return ledger;
  const next: RevealLedger = {};
  for (const anchorId of Object.keys(ledger)) {
    if (gone.has(anchorId)) continue;
    next[anchorId] = ledger[anchorId].filter((id) => !gone.has(id));
  }
  return next;
}

/** The lowest point anything occupies, so a new batch lands clear of it. */
export function lowestEdge(placements: Placement[]): number {
  let lowest = 0;
  for (const placement of placements) {
    const bottom = placement.y + NODE_HEIGHT;
    if (bottom > lowest) lowest = bottom;
  }
  return lowest;
}

// ── canvas membership ────────────────────────────────────────────────────────

/**
 * Put items on the canvas, leaving the ones already there exactly where they are.
 *
 * Re-adding something must not move it. People add a node, drag it somewhere
 * meaningful, then expand its neighbour and find the first node has jumped
 * back to a grid — that is the behaviour this guards against.
 */
export function addItems(
  canvas: CanvasState,
  items: GovernanceItem[],
  place: (newIds: string[]) => Placement[],
): CanvasState {
  const known = canvas.items;
  const fresh: GovernanceItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item?.item_id || known[item.item_id] || seen.has(item.item_id)) continue;
    seen.add(item.item_id);
    fresh.push(item);
  }
  if (fresh.length === 0) {
    // Still refresh what we know about items already present: a name or status
    // may have changed since they were put on the canvas.
    const refreshed = { ...canvas.items };
    for (const item of items) {
      if (item?.item_id && refreshed[item.item_id]) refreshed[item.item_id] = item;
    }
    return { ...canvas, items: refreshed };
  }

  const nextItems = { ...canvas.items };
  for (const item of items) {
    if (item?.item_id) nextItems[item.item_id] = item;
  }
  return {
    ...canvas,
    items: nextItems,
    placements: [...canvas.placements, ...place(fresh.map((item) => item.item_id))],
  };
}

/**
 * Take items off the canvas, and with them every line that had an end on one.
 *
 * Leaving the edge behind would draw a relationship to nothing — the canvas
 * would be asserting something the graph does not say.
 */
export function removeItems(canvas: CanvasState, itemIds: string[]): CanvasState {
  const doomed = new Set(itemIds);
  if (doomed.size === 0) return canvas;

  const items: Record<string, GovernanceItem> = {};
  for (const id of Object.keys(canvas.items)) {
    if (!doomed.has(id)) items[id] = canvas.items[id];
  }
  const edges: Record<string, GovernanceEdge> = {};
  for (const key of Object.keys(canvas.edges)) {
    const edge = canvas.edges[key];
    if (!doomed.has(edge.source_id) && !doomed.has(edge.target_id)) edges[key] = edge;
  }
  return {
    placements: canvas.placements.filter((placement) => !doomed.has(placement.itemId)),
    items,
    edges,
  };
}

/** Move one item. Unknown items are ignored rather than silently appended. */
export function moveItem(canvas: CanvasState, itemId: string, x: number, y: number): CanvasState {
  let moved = false;
  const placements = canvas.placements.map((placement) => {
    if (placement.itemId !== itemId) return placement;
    moved = true;
    return { ...placement, x, y };
  });
  return moved ? { ...canvas, placements } : canvas;
}

/**
 * Keep only the edges whose *both* ends are on the canvas.
 *
 * The hot path. Membership is a Set rather than a scan of the placement list,
 * which is the whole difference between a canvas of 500 nodes redrawing in a
 * frame and one that takes a second and a half.
 */
export function edgesWithin(edges: GovernanceEdge[], itemIds: Iterable<string>): GovernanceEdge[] {
  const present = itemIds instanceof Set ? itemIds : new Set(itemIds);
  const kept: GovernanceEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!edge || seen.has(edge.edge_id)) continue;
    if (!present.has(edge.source_id) || !present.has(edge.target_id)) continue;
    seen.add(edge.edge_id);
    kept.push(edge);
  }
  return kept;
}

/** Fold a freshly fetched neighbourhood into the canvas. */
export function absorbNeighbourhood(
  canvas: CanvasState,
  graph: { items: GovernanceItem[]; edges: GovernanceEdge[] },
  place: (newIds: string[]) => Placement[],
): CanvasState {
  const withItems = addItems(canvas, graph.items, place);
  const present = new Set(withItems.placements.map((placement) => placement.itemId));
  const edges = { ...withItems.edges };
  for (const edge of edgesWithin(graph.edges, present)) edges[edge.edge_id] = edge;
  // An edge kept from before may now point at something that has since left.
  for (const key of Object.keys(edges)) {
    const edge = edges[key];
    if (!present.has(edge.source_id) || !present.has(edge.target_id)) delete edges[key];
  }
  return { ...withItems, edges };
}

// ── reading the canvas ───────────────────────────────────────────────────────

/** How many canvas edges touch each item — "3 related" without a second query. */
export function degreeIndex(edges: GovernanceEdge[]): Record<string, number> {
  const degree: Record<string, number> = {};
  for (const edge of edges) {
    degree[edge.source_id] = (degree[edge.source_id] ?? 0) + 1;
    degree[edge.target_id] = (degree[edge.target_id] ?? 0) + 1;
  }
  return degree;
}

/**
 * Items reachable from a starting point, over the canvas's own edges.
 *
 * Direction is ignored: impact runs both ways, and a reader asking "what is
 * this connected to" does not mean "what does this point at".
 */
export function reachableFrom(
  edges: GovernanceEdge[],
  startIds: string[],
  maxHops = 1,
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    (adjacency.get(edge.source_id) ?? adjacency.set(edge.source_id, []).get(edge.source_id)!).push(
      edge.target_id,
    );
    (adjacency.get(edge.target_id) ?? adjacency.set(edge.target_id, []).get(edge.target_id)!).push(
      edge.source_id,
    );
  }
  const seen = new Set<string>(startIds);
  let frontier = [...startIds];
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return seen;
}

/** The ids on the canvas, in the order they were added. */
export function canvasItemIds(canvas: CanvasState): string[] {
  return canvas.placements.map((placement) => placement.itemId);
}

// ── saved diagrams ───────────────────────────────────────────────────────────

export type SavedImpactNode = { item_id: string; item_kind: string; pos_x: number; pos_y: number };

export function toSavedNodes(canvas: CanvasState): SavedImpactNode[] {
  const saved: SavedImpactNode[] = [];
  for (const placement of canvas.placements) {
    const item = canvas.items[placement.itemId];
    if (!item) continue;
    // A card Discover's results put there is a reading of one run, not part
    // of the governance graph: the graph cannot resolve it when the view is
    // reopened, so it is not stored as though it could.
    if (placement.itemId.startsWith("observed:")) continue;
    saved.push({
      item_id: placement.itemId,
      item_kind: item.item_kind,
      pos_x: placement.x,
      pos_y: placement.y,
    });
  }
  return saved;
}

/**
 * Rebuild a canvas from a saved diagram and the items that still resolve.
 *
 * Saved positions win over any layout: reopening a diagram must show what was
 * saved, not a fresh arrangement of the same nodes. Items that no longer exist
 * are dropped and named, so the reader is told their view is out of date
 * rather than being handed a quietly smaller picture.
 */
export function restoreCanvas(
  saved: SavedImpactNode[],
  items: GovernanceItem[],
  edges: GovernanceEdge[],
): { canvas: CanvasState; missingIds: string[] } {
  const byId = new Map(items.map((item) => [item.item_id, item]));
  const placements: Placement[] = [];
  const present: Record<string, GovernanceItem> = {};
  const missingIds: string[] = [];
  const seen = new Set<string>();

  for (const node of saved) {
    if (!node?.item_id || seen.has(node.item_id)) continue;
    seen.add(node.item_id);
    const item = byId.get(node.item_id);
    if (!item) {
      missingIds.push(node.item_id);
      continue;
    }
    present[node.item_id] = item;
    placements.push({ itemId: node.item_id, x: node.pos_x ?? 0, y: node.pos_y ?? 0 });
  }

  const kept: Record<string, GovernanceEdge> = {};
  for (const edge of edgesWithin(edges, new Set(Object.keys(present)))) kept[edge.edge_id] = edge;
  return { canvas: { placements, items: present, edges: kept }, missingIds };
}

// ── undo ─────────────────────────────────────────────────────────────────────

/** How many steps back Undo can go. Each step is one whole canvas. */
export const UNDO_LIMIT = 30;

/**
 * Remember a canvas before a change that touches many cards at once.
 *
 * The canvas is immutable, so a step is the value itself — no diffing, no
 * replaying. The oldest step falls off once the limit is reached, and a step
 * identical to the last one is not stored twice.
 */
export function pushUndo<T>(stack: readonly T[], step: T, limit = UNDO_LIMIT): T[] {
  if (stack[stack.length - 1] === step) return [...stack];
  const next = [...stack, step];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Take the last step back off the stack. */
export function popUndo<T>(stack: readonly T[]): { canvas: T | null; stack: T[] } {
  if (stack.length === 0) return { canvas: null, stack: [] };
  return { canvas: stack[stack.length - 1], stack: stack.slice(0, -1) };
}
