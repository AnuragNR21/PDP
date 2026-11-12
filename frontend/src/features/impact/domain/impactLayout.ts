/**
 * Where things go on the Visualiser, and which of them are shown.
 *
 * One idea underneath all of it: **direction is a recorded fact about a
 * relationship, not a property of where a card happens to sit.** Upstream is
 * "there is a directed path into the focus"; downstream is "there is one out
 * of it". The picture is derived from that, so expanding, filtering or
 * dragging can never quietly reverse what a relationship means.
 *
 * Pure on purpose — no React, no `@/` runtime imports — so the feedback
 * document's requirements can be run as tests and read as the specification
 * they are.
 */

// ── vocabulary ───────────────────────────────────────────────────────────────

export const DIRECTION = {
  BOTH: "both",
  UPSTREAM: "upstream",
  DOWNSTREAM: "downstream",
} as const;

export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];

export type LayoutEdge = { edge_id: string; source_id: string; target_id: string };

export type LayoutItem = {
  item_id: string;
  name: string;
  model_id: string;
  model_name: string;
  model_kind: string;
  type_name: string | null;
};

export type Placement = { itemId: string; x: number; y: number };

/** Card size and breathing room, in canvas units. */
const COLUMN_STEP = 320;
const ROW_STEP = 110;

// ── reachability ─────────────────────────────────────────────────────────────

type Adjacency = Map<string, string[]>;

function adjacencyOf(edges: readonly LayoutEdge[], reverse: boolean): Adjacency {
  const map: Adjacency = new Map();
  for (const edge of edges) {
    const from = reverse ? edge.target_id : edge.source_id;
    const to = reverse ? edge.source_id : edge.target_id;
    const list = map.get(from);
    if (list) list.push(to);
    else map.set(from, [to]);
  }
  return map;
}

/**
 * How many steps each item is from the focus, in one direction.
 *
 * Breadth first, so the first distance recorded is the shortest — an item
 * reachable in one step and again in three belongs beside the step that
 * actually reaches it. The focus is never its own neighbour, so a cycle back
 * to it cannot push it off the centre.
 */
function distances(
  focusId: string,
  edges: readonly LayoutEdge[],
  reverse: boolean,
  maxDepth = Number.POSITIVE_INFINITY,
): Map<string, number> {
  const adjacency = adjacencyOf(edges, reverse);
  const found = new Map<string, number>();
  let frontier = [focusId];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (neighbour === focusId || found.has(neighbour)) continue;
        found.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return found;
}

/**
 * Signed distance from the focus: negative upstream, positive downstream.
 *
 * An item reachable both ways is given one level only — the downstream one —
 * so it is drawn once with all of its connectors rather than twice with half
 * of them each.
 */
export function signedLevels(
  focusId: string,
  edges: readonly LayoutEdge[],
  options: { depth?: number; direction?: Direction } = {},
): Map<string, number> {
  const depth = options.depth ?? Number.POSITIVE_INFINITY;
  const direction = options.direction ?? DIRECTION.BOTH;

  const levels = new Map<string, number>([[focusId, 0]]);

  if (direction !== DIRECTION.UPSTREAM) {
    for (const [id, steps] of distances(focusId, edges, false, depth)) {
      levels.set(id, steps);
    }
  }
  if (direction !== DIRECTION.DOWNSTREAM) {
    for (const [id, steps] of distances(focusId, edges, true, depth)) {
      if (!levels.has(id)) levels.set(id, -steps);
    }
  }
  return levels;
}

// ── layout ───────────────────────────────────────────────────────────────────

/**
 * Order each column by the rows of the column before it.
 *
 * Levels decide the columns; nothing yet decides who sits at the top of one.
 * Taken in input order, two cards whose sources are the other way round draw
 * a pair of lines straight through each other, and the reader has to follow
 * both to see that nothing is tangled. The median heuristic — put each card
 * at the height of the neighbours that reach it — is the standard answer and
 * removes most crossings for the cost of one sweep outwards from the focus.
 *
 * Columns are walked from the focus outwards so each is ordered against a
 * column that has already been settled. A card nothing reaches keeps the
 * place it had, which keeps the sweep stable: re-laying out an unchanged
 * diagram cannot shuffle it.
 */
function orderColumnsToFollowTheFlow(
  columns: Map<number, string[]>,
  edges: readonly LayoutEdge[],
): void {
  const neighbours = new Map<string, string[]>();
  const connect = (from: string, to: string) => {
    const seen = neighbours.get(from);
    if (seen) seen.push(to);
    else neighbours.set(from, [to]);
  };
  for (const edge of edges) {
    connect(edge.source_id, edge.target_id);
    connect(edge.target_id, edge.source_id);
  }

  // Nearest the focus first, so the column a card is read against is already
  // in its final order. Ties (-1 before 1) are settled by level so the sweep
  // is the same every time.
  const levels = [...columns.keys()].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);

  for (const level of levels) {
    if (level === 0) continue;
    const ids = columns.get(level);
    if (!ids || ids.length < 2) continue;

    const reference = columns.get(level > 0 ? level - 1 : level + 1);
    if (!reference) continue;
    const rowInReference = new Map(reference.map((id, index) => [id, index]));

    const keyed = ids.map((id, index) => {
      const rows = (neighbours.get(id) ?? [])
        .map((other) => rowInReference.get(other))
        .filter((row): row is number => row !== undefined)
        .sort((a, b) => a - b);
      return { id, index, key: rows.length === 0 ? index : median(rows) };
    });

    keyed.sort((a, b) => a.key - b.key || a.index - b.index);
    columns.set(
      level,
      keyed.map((entry) => entry.id),
    );
  }
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Upstream to the left, the focus in the middle, downstream to the right.
 *
 * Each level is a column and each column is centred on the focus's row, so the
 * eye reads the diagram as a flow rather than as a cloud. Items with no path
 * either way are not dropped — they are parked in a column past the last
 * downstream one, visible but plainly not part of the flow.
 *
 * Deterministic: the same graph laid out twice gives the same picture, which
 * is what makes "Auto re-layout" a repeatable action rather than a shuffle.
 */
export function directedLayout(
  focusId: string,
  items: readonly LayoutItem[],
  edges: readonly LayoutEdge[],
  options: { depth?: number; direction?: Direction } = {},
): Placement[] {
  const present = new Set(items.map((item) => item.item_id));
  const names = new Map(items.map((item) => [item.item_id, item.name ?? item.item_id]));
  const inView = edges.filter((e) => present.has(e.source_id) && present.has(e.target_id));
  // Strictly upstream or downstream is what the requirement defines, so those
  // columns win; anything else connected takes the column its own
  // relationships give it, so every connector still runs left to right.
  const strict = signedLevels(focusId, inView, options);

  type Step = { id: string; step: 1 | -1 };
  const adjacency = new Map<string, Step[]>();
  const link = (from: string, step: Step) => {
    const list = adjacency.get(from);
    if (list) list.push(step);
    else adjacency.set(from, [step]);
  };
  for (const edge of inView) {
    link(edge.source_id, { id: edge.target_id, step: 1 });
    link(edge.target_id, { id: edge.source_id, step: -1 });
  }
  // Upstream first, then by name: the order a reader scans a column in.
  const byName = (a: Step, b: Step) =>
    a.step - b.step ||
    (names.get(a.id) ?? a.id).localeCompare(names.get(b.id) ?? b.id) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const list of adjacency.values()) list.sort(byName);

  // ── a layout tree per connected part, breadth first ──────────────────────
  const column = new Map<string, number>();
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const grow = (root: string, useStrict: boolean) => {
    roots.push(root);
    column.set(root, 0);
    const queue = [root];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      for (const { id: next, step } of adjacency.get(id) ?? []) {
        if (column.has(next)) continue;
        const strictLevel = useStrict ? strict.get(next) : undefined;
        column.set(next, strictLevel ?? (column.get(id) ?? 0) + step);
        const kids = children.get(id);
        if (kids) kids.push(next);
        else children.set(id, [next]);
        queue.push(next);
      }
    }
  };
  if (present.has(focusId)) grow(focusId, true);
  // Parts the focus does not reach are laid out on their own, below it, each
  // from its most upstream card so it too reads left to right — never piled
  // into one column beside the focus.
  const rest = items
    .map((item) => item.item_id)
    .filter((id) => !column.has(id))
    .sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b) || (a < b ? -1 : 1));
  for (const candidate of rest) {
    if (column.has(candidate)) continue;
    const levels = relaxedLevels(candidate, inView);
    let root = candidate;
    for (const [id, level] of levels) {
      const best = levels.get(root) ?? 0;
      if (level < best || (level === best && (names.get(id) ?? id).localeCompare(names.get(root) ?? root) < 0)) {
        root = id;
      }
    }
    grow(root, false);
  }

  // ── rows: each card beside the cards it leads to ─────────────────────────
  // Leaves take the next free row; a card sits level with the middle of its
  // own children. A card and its children are therefore always one block,
  // and two blocks never interleave.
  const row = new Map<string, number>();
  let nextRow = 0;
  const place = (id: string) => {
    const kids = children.get(id) ?? [];
    for (const kid of kids) place(kid);
    if (kids.length === 0) {
      row.set(id, nextRow);
      nextRow += 1;
      return;
    }
    const rows = kids.map((kid) => row.get(kid) ?? 0);
    row.set(id, (Math.min(...rows) + Math.max(...rows)) / 2);
  };
  for (const root of roots) {
    place(root);
    nextRow += 1; // a blank row between separate parts
  }

  // ── nothing shares a slot ────────────────────────────────────────────────
  // A sibling can land in the focus's own column at the focus's own row.
  // Walk each column top to bottom and push anything too close down; the
  // focus, first among equals, keeps its place.
  const columns = new Map<number, string[]>();
  for (const [id, col] of column) {
    const list = columns.get(col);
    if (list) list.push(id);
    else columns.set(col, [id]);
  }
  for (const ids of columns.values()) {
    ids.sort(
      (a, b) =>
        (row.get(a) ?? 0) - (row.get(b) ?? 0) ||
        (a === focusId ? -1 : b === focusId ? 1 : 0) ||
        (a < b ? -1 : 1),
    );
    let last = Number.NEGATIVE_INFINITY;
    for (const id of ids) {
      const r = Math.max(row.get(id) ?? 0, last + 1);
      row.set(id, r);
      last = r;
    }
  }

  const focusRow = row.get(focusId) ?? 0;
  const placements: Placement[] = [];
  for (const item of items) {
    const id = item.item_id;
    placements.push({
      itemId: id,
      x: (column.get(id) ?? 0) * COLUMN_STEP,
      y: Math.round(((row.get(id) ?? 0) - focusRow) * ROW_STEP),
    });
  }
  // Stable order so two runs produce identical arrays, not merely identical
  // positions.
  return placements.sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.itemId < b.itemId ? -1 : 1));
}

// ── children: collapse and expand per card ───────────────────────────────────

/** The cards a card leads to directly — its children on the diagram. */
export function childrenOf(id: string, edges: readonly LayoutEdge[]): string[] {
  const out: string[] = [];
  for (const edge of edges) {
    if (edge.source_id === id && edge.target_id !== id && !out.includes(edge.target_id)) {
      out.push(edge.target_id);
    }
  }
  return out;
}

/**
 * Which cards collapsing these cards hides.
 *
 * Everything a collapsed card leads to, all the way down — unless something
 * still on screen leads to it some other way: a governed value two properties
 * share stays while either property is open. Cards in `keep` (the focus) are
 * never hidden. A view, never an edit: expanding puts back exactly what
 * collapsing took away.
 */
export function collapsedHidden(
  collapsed: Iterable<string>,
  edges: readonly LayoutEdge[],
  keep: ReadonlySet<string> = new Set(),
): Set<string> {
  const closed = new Set(collapsed);
  if (closed.size === 0) return new Set();
  const forward = adjacencyOf(edges, false);

  const candidates = new Set<string>();
  const queue = [...closed];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const next of forward.get(id) ?? []) {
      if (candidates.has(next) || keep.has(next)) continue;
      candidates.add(next);
      queue.push(next);
    }
  }

  // Still reachable from an open card that is itself on screen? Then it stays.
  const all = new Set<string>();
  for (const edge of edges) {
    all.add(edge.source_id);
    all.add(edge.target_id);
  }
  const visible = new Set([...all].filter((id) => !candidates.has(id)));
  const walk = [...visible].filter((id) => !closed.has(id));
  while (walk.length > 0) {
    const id = walk.shift() as string;
    if (closed.has(id)) continue;
    for (const next of forward.get(id) ?? []) {
      if (!candidates.has(next)) continue;
      candidates.delete(next);
      walk.push(next);
    }
  }
  return candidates;
}

/**
 * A column for everything connected to the anchor, read along each edge.
 *
 * Following an edge forwards is one column to the right, backwards one to the
 * left, whatever the direction of the path as a whole. That is the column in
 * which every connector runs left to right — the layered drawing a flow
 * diagram is read as. Breadth first, so the first column found is the one the
 * nearest relationship asks for.
 */
export function relaxedLevels(anchorId: string, edges: readonly LayoutEdge[]): Map<string, number> {
  const out = new Map<string, number>([[anchorId, 0]]);
  const forward = adjacencyOf(edges, false);
  const backward = adjacencyOf(edges, true);
  let frontier = [anchorId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const level = out.get(id) ?? 0;
      for (const target of forward.get(id) ?? []) {
        if (out.has(target)) continue;
        out.set(target, level + 1);
        next.push(target);
      }
      for (const source of backward.get(id) ?? []) {
        if (out.has(source)) continue;
        out.set(source, level - 1);
        next.push(source);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Where the cards an expansion brought in should land.
 *
 * Beside the card that was expanded, in the column its relationships put them
 * in — what leads into it to the left, what it leads to on the right — and in
 * the free row nearest the neighbours that brought them, so a reader who
 * expands a hub sees its parent appear to its left and its properties to its
 * right, not a ring of cards whose connectors double back on themselves.
 *
 * Cards already on the canvas never move. A new card that nothing on the
 * canvas reaches (which an expansion should not produce) falls back to the
 * first free row under the anchor.
 */
export function directionalPlacements(
  anchorId: string,
  newIds: readonly string[],
  edges: readonly LayoutEdge[],
  taken: readonly Placement[],
): Placement[] {
  const already = new Set(taken.map((p) => p.itemId));
  const fresh = [...new Set(newIds)].filter((id) => id !== anchorId && !already.has(id));
  if (fresh.length === 0) return [];

  const anchor = taken.find((p) => p.itemId === anchorId) ?? { itemId: anchorId, x: 0, y: 0 };
  const levels = relaxedLevels(anchorId, edges);

  const at = new Map<string, Placement>();
  for (const placement of taken) at.set(placement.itemId, placement);
  if (!at.has(anchorId)) at.set(anchorId, anchor);

  // Occupancy by column bucket, so a free row is found by looking at the
  // cards near that column rather than at every card on the canvas.
  const bucketOf = (x: number) => Math.round(x / COLUMN_STEP);
  const occupied = new Map<number, Placement[]>();
  const occupy = (placement: Placement) => {
    const key = bucketOf(placement.x);
    const list = occupied.get(key);
    if (list) list.push(placement);
    else occupied.set(key, [placement]);
  };
  for (const placement of at.values()) occupy(placement);

  const clearAt = (x: number, y: number) => {
    const key = bucketOf(x);
    for (const k of [key - 1, key, key + 1]) {
      for (const other of occupied.get(k) ?? []) {
        if (Math.abs(other.x - x) < CARD_WIDTH + MIN_GAP && Math.abs(other.y - y) < CARD_HEIGHT + MIN_GAP) {
          return false;
        }
      }
    }
    return true;
  };

  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    (neighbours.get(edge.source_id) ?? neighbours.set(edge.source_id, []).get(edge.source_id)!).push(edge.target_id);
    (neighbours.get(edge.target_id) ?? neighbours.set(edge.target_id, []).get(edge.target_id)!).push(edge.source_id);
  }

  // Nearest the anchor first, so each card is placed against neighbours that
  // already have a place; ties in input order, so the result is repeatable.
  const order = fresh
    .map((id, index) => ({ id, index, level: levels.get(id) }))
    .sort((a, b) => {
      const da = a.level === undefined ? Number.POSITIVE_INFINITY : Math.abs(a.level);
      const db = b.level === undefined ? Number.POSITIVE_INFINITY : Math.abs(b.level);
      return da - db || a.index - b.index;
    });

  const out: Placement[] = [];
  for (const { id, level } of order) {
    let x: number;
    let wantY: number;
    if (level === undefined) {
      x = anchor.x;
      wantY = anchor.y + ROW_STEP;
    } else {
      x = anchor.x + level * COLUMN_STEP;
      const placedNeighbours = (neighbours.get(id) ?? [])
        .map((other) => at.get(other))
        // Only neighbours that already have a place: cards already on the
        // canvas, and new ones placed earlier in this pass.
        .filter((p): p is Placement => p !== undefined)
        .map((p) => p.y)
        .sort((a, b) => a - b);
      wantY = placedNeighbours.length > 0 ? median(placedNeighbours) : anchor.y;
    }
    let y = Math.round(wantY);
    // Search outwards from the wanted row: below, above, two below, …
    for (let step = 0; step < 2000; step += 1) {
      const ring = Math.ceil(step / 2);
      const candidate = Math.round(wantY + (step % 2 === 1 ? 1 : -1) * ring * ROW_STEP);
      if (clearAt(x, candidate)) {
        y = candidate;
        break;
      }
    }
    const placement = { itemId: id, x: Math.round(x), y };
    out.push(placement);
    at.set(id, placement);
    occupy(placement);
  }

  // Report in the order the caller gave, which is the order it will append.
  const byId = new Map(out.map((p) => [p.itemId, p]));
  return fresh.map((id) => byId.get(id)!).filter(Boolean);
}

/** Card size as the layout reasons about it; kept in step with the canvas. */
const CARD_WIDTH = 210;
const CARD_HEIGHT = 64;
const MIN_GAP = 24;

// ── direction filter ─────────────────────────────────────────────────────────

/**
 * Which items and connectors a direction shows.
 *
 * The focus survives every mode: a view that can hide the thing it is centred
 * on has no centre. Connectors are kept only when both of their ends are, so
 * the filtered picture never shows a line reaching off into something it is
 * not displaying.
 */
export function filterByDirection(
  focusId: string,
  items: readonly LayoutItem[],
  edges: readonly LayoutEdge[],
  mode: Direction,
  options: { depth?: number } = {},
): { itemIds: string[]; edgeIds: string[] } {
  if (mode === DIRECTION.BOTH) {
    return { itemIds: items.map((i) => i.item_id), edgeIds: edges.map((e) => e.edge_id) };
  }

  const levels = signedLevels(focusId, edges, { depth: options.depth, direction: mode });
  const kept = new Set<string>([focusId]);
  for (const item of items) if (levels.has(item.item_id)) kept.add(item.item_id);

  return {
    itemIds: items.filter((i) => kept.has(i.item_id)).map((i) => i.item_id),
    edgeIds: edges
      .filter((e) => kept.has(e.source_id) && kept.has(e.target_id))
      .map((e) => e.edge_id),
  };
}

// ── depth changes ────────────────────────────────────────────────────────────

/**
 * Which open branches a depth change has to re-read.
 *
 * All of them. Refreshing only the most recent one leaves a diagram showing
 * two expansions measured at two different depths, which is a picture of
 * nothing in particular.
 */
export function anchorsToRefresh(revealed: Record<string, readonly string[]>): string[] {
  return Object.keys(revealed);
}

/**
 * Bring every open branch to a new depth in one step — growing *and* shrinking.
 *
 * `reachable` is what each expanded card reaches at the new depth. A card an
 * expansion brought in stays while some open branch still reaches it, and
 * goes when none does — so moving from three steps to one takes back the
 * second and third rings instead of leaving them stranded. Cards the reader
 * put on the canvas themselves were never in the ledger and are never taken,
 * and a card the reader expanded stays: its own branch is being refreshed.
 *
 * Returns the new ledger, what to take off, and what each anchor still has to
 * bring in (the first anchor to reach a new card is the one that owns it).
 */
export function refreshReveals(
  ledger: Readonly<Record<string, readonly string[]>>,
  reachable: Readonly<Record<string, readonly string[]>>,
  onCanvas: readonly string[],
): { ledger: Record<string, string[]>; removeIds: string[]; addIds: Record<string, string[]> } {
  const anchors = Object.keys(ledger);
  const anchorSet = new Set(anchors);
  const present = new Set(onCanvas);

  const stillReached = new Set<string>();
  for (const anchor of anchors) for (const id of reachable[anchor] ?? []) stillReached.add(id);

  const revealedAnywhere = new Set<string>();
  for (const anchor of anchors) for (const id of ledger[anchor] ?? []) revealedAnywhere.add(id);

  const removeIds = [...revealedAnywhere].filter(
    (id) => !stillReached.has(id) && !anchorSet.has(id) && present.has(id),
  );
  const removed = new Set(removeIds);

  const next: Record<string, string[]> = {};
  const addIds: Record<string, string[]> = {};
  const claimed = new Set<string>();
  for (const anchor of anchors) {
    const reach = new Set(reachable[anchor] ?? []);
    const kept = (ledger[anchor] ?? []).filter((id) => reach.has(id) && !removed.has(id));
    for (const id of kept) claimed.add(id);
    next[anchor] = kept;
  }
  for (const anchor of anchors) {
    const brought: string[] = [];
    for (const id of reachable[anchor] ?? []) {
      if (id === anchor || present.has(id) || claimed.has(id)) continue;
      claimed.add(id);
      brought.push(id);
    }
    addIds[anchor] = brought;
    next[anchor] = [...next[anchor], ...brought];
  }
  return { ledger: next, removeIds, addIds };
}

// ── focus ────────────────────────────────────────────────────────────────────

/**
 * The one card the diagram is arranged around.
 *
 * With several hubs active there still has to be exactly one centre for the
 * layout and the direction filter: the one the reader chose, else the first
 * hub they opened, else what they selected, else the first card. The other
 * hubs stay what they were — starting points for exploring — without fighting
 * over the middle of the picture.
 */
export function primaryFocus(candidates: {
  chosen?: string | null;
  hubIds?: readonly string[];
  selectedIds?: readonly string[];
  canvasIds: readonly string[];
}): string | null {
  const present = new Set(candidates.canvasIds);
  if (candidates.chosen && present.has(candidates.chosen)) return candidates.chosen;
  for (const id of candidates.hubIds ?? []) if (present.has(id)) return id;
  for (const id of candidates.selectedIds ?? []) if (present.has(id)) return id;
  return candidates.canvasIds[0] ?? null;
}

// ── relationship filter ──────────────────────────────────────────────────────

/**
 * Connectors of the kinds the reader has switched on.
 *
 * A view, like the direction filter: hiding a kind of relationship changes
 * what is drawn and what the direction filter and the connected context read,
 * never what the graph says.
 */
export function edgesOfKinds<E extends LayoutEdge & { edge_kind?: string }>(
  edges: readonly E[],
  hiddenKinds: ReadonlySet<string>,
): E[] {
  if (hiddenKinds.size === 0) return [...edges];
  return edges.filter((edge) => !hiddenKinds.has(edge.edge_kind ?? ""));
}

/** The connectors along a path, in order, whichever way each one points. */
export function pathEdgeIds(path: readonly string[], edges: readonly LayoutEdge[]): string[] {
  const out: string[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    const hit = edges.find(
      (edge) =>
        (edge.source_id === a && edge.target_id === b) ||
        (edge.source_id === b && edge.target_id === a),
    );
    if (hit) out.push(hit.edge_id);
  }
  return out;
}

/** What a model is, in the words the Connected context panel uses. */
export const MODEL_CATEGORY = {
  HIERARCHY: "HIERARCHY_MODEL",
  SUPPORT_DOMAIN: "SUPPORT_DOMAIN_MODEL",
} as const;

/** A card's item kind, read as the category of the model it belongs to. */
export function modelCategoryOf(itemKind: string): string {
  return itemKind === "SUPPORT_DOMAIN_ELEMENT"
    ? MODEL_CATEGORY.SUPPORT_DOMAIN
    : MODEL_CATEGORY.HIERARCHY;
}

// ── connected models ─────────────────────────────────────────────────────────

export type ConnectedModel = {
  model_id: string;
  model_name: string;
  model_kind: string;
  instance_count: number;
  is_own_model: boolean;
  connected_hub_ids: string[];
  selected_hub_count: number;
};

/**
 * The models the selected hubs reach, each listed once.
 *
 * Counted over the relationship graph rather than over what happens to be on
 * the canvas, because the question is "what is connected", not "what have I
 * already drawn". A hub's own model is reported too, marked as its own, since
 * "the rest of my model" is a different kind of answer from "another model".
 *
 * With several hubs selected, `any` (the default) lists what at least one of
 * them reaches and `every` lists what all of them do; either way each entry
 * names the hubs that reach it, so a screen can say "connected to 2 of 3".
 */
export function connectedModels(
  hubIds: readonly string[],
  items: readonly LayoutItem[],
  edges: readonly LayoutEdge[],
  options: { depth?: number; direction?: Direction; match?: "any" | "every" } = {},
): ConnectedModel[] {
  const hubs = [...new Set(hubIds)].filter(Boolean);
  if (hubs.length === 0) return [];

  const byId = new Map(items.map((item) => [item.item_id, item]));
  const ownModels = new Set(hubs.map((id) => byId.get(id)?.model_id).filter(Boolean) as string[]);

  // model id → instance id → the hubs that reach that instance
  const reach = new Map<string, Map<string, Set<string>>>();

  for (const hubId of hubs) {
    const levels = signedLevels(hubId, edges, options);
    for (const [itemId] of levels) {
      if (itemId === hubId) continue;
      const item = byId.get(itemId);
      if (!item) continue;
      const instances = reach.get(item.model_id) ?? new Map<string, Set<string>>();
      const hubsHere = instances.get(itemId) ?? new Set<string>();
      hubsHere.add(hubId);
      instances.set(itemId, hubsHere);
      reach.set(item.model_id, instances);
    }
  }

  const match = options.match ?? "any";
  const models: ConnectedModel[] = [];

  for (const [modelId, instances] of reach) {
    const hubsForModel = new Set<string>();
    for (const hubsHere of instances.values()) for (const hub of hubsHere) hubsForModel.add(hub);
    if (match === "every" && hubsForModel.size < hubs.length) continue;

    const first = byId.get([...instances.keys()][0]);
    models.push({
      model_id: modelId,
      model_name: first?.model_name ?? modelId,
      model_kind: first?.model_kind ?? "",
      instance_count: instances.size,
      is_own_model: ownModels.has(modelId),
      connected_hub_ids: [...hubsForModel],
      selected_hub_count: hubs.length,
    });
  }

  return models.sort((a, b) =>
    a.is_own_model === b.is_own_model
      ? a.model_name.localeCompare(b.model_name)
      : a.is_own_model
        ? -1
        : 1,
  );
}

/**
 * The shortest ways from a hub into a model.
 *
 * "First" means fewest relationship steps — not the model's root and not the
 * first instance alphabetically, both of which are easy to reach for and
 * neither of which answers "what is nearest". Where several instances tie, all
 * the tying paths come back and `ambiguous` says so, because picking one
 * silently would hide a choice the reader should make.
 *
 * Each path carries every instance along the way, so the caller can add the
 * intermediate cards and connectors rather than a line from nowhere.
 */
const MAX_PATHS_PER_LEVEL = 5000;

export function nearestPaths(
  hubId: string,
  modelId: string,
  items: readonly LayoutItem[],
  edges: readonly LayoutEdge[],
  options: { depth?: number; direction?: Direction } = {},
): { paths: string[][]; ambiguous: boolean } {
  const byId = new Map(items.map((item) => [item.item_id, item]));
  const direction = options.direction ?? DIRECTION.BOTH;
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;

  const forward = adjacencyOf(edges, false);
  const backward = adjacencyOf(edges, true);
  const neighbours = (id: string): string[] => [
    ...(direction === DIRECTION.UPSTREAM ? [] : (forward.get(id) ?? [])),
    ...(direction === DIRECTION.DOWNSTREAM ? [] : (backward.get(id) ?? [])),
  ];

  const seen = new Set<string>([hubId]);
  let frontier: string[][] = [[hubId]];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1;
    const next: string[][] = [];
    const arrivals: string[][] = [];

    for (const path of frontier) {
      const tail = path[path.length - 1];
      for (const neighbour of neighbours(tail)) {
        if (seen.has(neighbour)) continue;
        const extended = [...path, neighbour];
        if (byId.get(neighbour)?.model_id === modelId) arrivals.push(extended);
        else next.push(extended);
      }
    }

    // Mark the whole level seen only after it has been walked, so two paths of
    // the same length both survive instead of the first one winning the race.
    for (const path of [...next, ...arrivals]) seen.add(path[path.length - 1]);
    // Equal-length paths multiply level by level; past this many the walk is
    // describing a mesh, not a choice anyone can make.
    if (next.length > MAX_PATHS_PER_LEVEL) next.length = MAX_PATHS_PER_LEVEL;

    if (arrivals.length > 0) {
      return { paths: arrivals, ambiguous: arrivals.length > 1 };
    }
    frontier = next;
  }

  return { paths: [], ambiguous: false };
}

// ── affected records ─────────────────────────────────────────────────────────

export type ResultCount = { result_id: string; failed_count: number };

/**
 * Failed-record counts, reported honestly.
 *
 * Two results over the same table can flag the same row twice. Adding their
 * counts and calling the answer "unique affected records" would overstate the
 * problem, so the total is withheld until overlap has been resolved and the
 * per-result figures are given instead. One result has no overlap to resolve,
 * so it can state its own total.
 */
export function affectedRecordSummary(results: readonly ResultCount[]): {
  per_result: ResultCount[];
  unique_total: number | null;
  reason: string;
} {
  const per_result = results.map((r) => ({ result_id: r.result_id, failed_count: r.failed_count }));
  if (results.length <= 1) {
    return {
      per_result,
      unique_total: results[0]?.failed_count ?? 0,
      reason: "",
    };
  }
  return {
    per_result,
    unique_total: null,
    reason:
      "Two results can flag the same record, so these counts are not added together until the overlap between them has been resolved.",
  };
}

// ── dragging a selection ─────────────────────────────────────────────────────

/**
 * What a drag is carrying.
 *
 * Dragging one of several selected instances carries the whole selection —
 * that is what the selection was for. Dragging something outside it carries
 * only that one, because reaching past a selection to grab a different card is
 * how a person changes their mind, not how they confirm it.
 */
export function dragSelection(draggedId: string, selectedIds: readonly string[]): string[] {
  return selectedIds.includes(draggedId) ? [...selectedIds] : [draggedId];
}

// ── re-layout without disturbing what is hidden ──────────────────────────────

/**
 * Re-arrange the cards on screen and leave the rest exactly where they were.
 *
 * A filtered-out card still has a position the reader chose; re-laying out the
 * whole canvas would quietly rewrite work they cannot currently see, and they
 * would only discover it by switching the filter back. So the action applies
 * to what it appears to apply to.
 */
export function relayoutVisible(
  focusId: string,
  items: readonly LayoutItem[],
  edges: readonly LayoutEdge[],
  stored: readonly Placement[],
  visibleIds: ReadonlySet<string>,
  options: { depth?: number; direction?: Direction } = {},
): Placement[] {
  const visibleItems = items.filter((item) => visibleIds.has(item.item_id));
  const visibleEdges = edges.filter(
    (edge) => visibleIds.has(edge.source_id) && visibleIds.has(edge.target_id),
  );
  const arranged = new Map(
    directedLayout(focusId, visibleItems, visibleEdges, options).map((p) => [p.itemId, p]),
  );

  return stored.map((placement) => arranged.get(placement.itemId) ?? placement);
}

/**
 * What Discover's observed results are called on the canvas.
 *
 * Two strings that have to match in four places — the cards, the connectors,
 * the colour the canvas draws them in and the legend that names that colour —
 * so they live here once. "observed" is deliberately not in
 * `GOVERNANCE_EDGE_KIND`: that object is a contract with the backend's three
 * governance kinds, and an observed result is not one of them. It is drawn by the
 * diagram, never stored as a relationship.
 */
export const OBSERVED_ITEM_KIND = "OBSERVED";

/** Every observed card's id starts with this, so it can be told apart by id alone. */
export const OBSERVED_ID_PREFIX = "observed:";
export const OBSERVED_EDGE_KIND = "observed";

// ── the traceable observed path ──────────────────────────────────────────────

/** A card the canvas draws for something Discover found, not something PDP states. */
export type ObservedCard = {
  item_id: string;
  item_kind: string;
  name: string;
  status: string;
  model_id: string;
  model_name: string;
  type_name: string;
  is_property: boolean;
  parent_id: string | null;
  /** Present only on observed cards; a model instance has none. */
  observed_kind: "source_column" | "quality_check";
};

export type ObservedLink = {
  edge_id: string;
  edge_kind: typeof OBSERVED_EDGE_KIND;
  source_id: string;
  target_id: string;
  label: string;
  governance_role: null;
  /** Always false. Discover found this; Structure did not state it. */
  asserted: false;
};

export type ObservedSelection = {
  hubId: string;
  mapping: {
    mapping_id: string;
    column_id: string;
    column_name: string;
    target_node_id: string;
    target_name: string | null;
    session_name: string | null;
    file_name: string | null;
  } | null;
  check: {
    quality_check_id: string;
    rule_name: string | null;
    rule_code: string | null;
    outcome: string;
    observed_count: number;
    total_count: number;
  } | null;
};

/**
 * Source column → mapped to → PDP target → assessed by → Quality Check.
 *
 * The cards and connectors a reader gets when they pick a quality result: the
 * whole chain, so the picture explains itself, rather than a lone result card
 * floating beside the model with nothing saying how it got there.
 *
 * Ids are derived from what they stand for, so adding the same result twice
 * produces the same cards and the canvas de-duplicates them for free.
 */
export function observedPath(selection: ObservedSelection): {
  items: ObservedCard[];
  edges: ObservedLink[];
} {
  const { hubId, mapping, check } = selection;
  const items: ObservedCard[] = [];
  const edges: ObservedLink[] = [];

  const targetId = mapping?.target_node_id ?? hubId;

  if (mapping) {
    const columnId = `observed:column:${mapping.column_id}`;
    items.push({
      item_id: columnId,
      item_kind: OBSERVED_ITEM_KIND,
      name: mapping.column_name,
      status: "active",
      model_id: "discover",
      model_name: [mapping.session_name, mapping.file_name].filter(Boolean).join(" · "),
      type_name: "Source column",
      is_property: false,
      parent_id: null,
      observed_kind: "source_column",
    });
    edges.push({
      edge_id: `observed:map:${mapping.mapping_id}`,
      edge_kind: OBSERVED_EDGE_KIND,
      source_id: columnId,
      target_id: targetId,
      label: "mapped to",
      governance_role: null,
      asserted: false,
    });
  }

  if (check) {
    const checkId = `observed:check:${check.quality_check_id}`;
    const attention = check.observed_count ?? 0;
    items.push({
      item_id: checkId,
      item_kind: OBSERVED_ITEM_KIND,
      name: check.rule_name ?? check.rule_code ?? "Quality check",
      status: check.outcome,
      model_id: "discover",
      model_name: [mapping?.session_name, mapping?.file_name].filter(Boolean).join(" · "),
      // The result, on the card: a reader should not have to open it to learn
      // whether it found anything.
      type_name:
        attention > 0
          ? `${attention} of ${check.total_count} need attention`
          : `${check.total_count} assessed, none flagged`,
      is_property: false,
      parent_id: null,
      observed_kind: "quality_check",
    });
    edges.push({
      edge_id: `observed:assessed:${check.quality_check_id}`,
      edge_kind: OBSERVED_EDGE_KIND,
      source_id: targetId,
      target_id: checkId,
      label: "assessed by",
      governance_role: null,
      asserted: false,
    });
  }

  return { items, edges };
}

// ── is there anything to save? ───────────────────────────────────────────────

/**
 * What the diagram currently looks like, as one comparable string.
 *
 * A reading is which cards are on the canvas and where they sit, so that is
 * all the signature carries. Positions are rounded: ReactFlow settles a card
 * a fraction of a pixel from where it was put, and a reader who has touched
 * nothing should not be told they have unsaved work. Sorted, because the
 * order cards were added in is not part of what gets saved.
 */
export function canvasSignature(canvas: { placements: Placement[] }): string {
  return canvas.placements
    .filter((p) => !p.itemId.startsWith(OBSERVED_ID_PREFIX))
    .map((p) => `${p.itemId}@${Math.round(p.x)},${Math.round(p.y)}`)
    .sort()
    .join("|");
}

/**
 * Compared against the signature taken when the diagram was last saved or
 * opened. An empty baseline is a diagram that has never been saved, so its
 * first card already counts as unsaved work.
 */
export function hasUnsavedChanges(
  canvas: { placements: Placement[] },
  savedSignature: string,
): boolean {
  return canvasSignature(canvas) !== savedSignature;
}
