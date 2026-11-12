/**
 * Where a connector runs.
 *
 * Every connector leaves the right side of its source and enters the left side
 * of its target, with the arrowhead at the target — the same for a node, a
 * governed value or a card Discover found. What this module decides is the
 * route in between, under three rules from the feedback:
 *
 * - **Around cards, not through them.** A line drawn across a card reads as a
 *   relationship with that card. Each candidate route is tested against every
 *   card it could cross, and the first clear one wins.
 * - **Return connections stay legible.** A relationship whose target sits to
 *   the left of its source — a cycle back into the focus, a card the reader
 *   dragged — is not reversed and not drawn as a hook through the middle of the
 *   diagram. It leaves to the right, travels above (or below) both cards, and
 *   comes back in from the left, so its meaning is the same as any other line.
 * - **Labels can be read.** The label sits on the stub that enters the target,
 *   so the fan of "contains" lines out of one hub puts each label beside the
 *   card it belongs to instead of stacking them all on the hub.
 *
 * Orthogonal routes only: they are what makes "around a card" a tractable
 * question, and they read as a flow diagram.
 *
 * Pure — no React, no ReactFlow — so the routes can be tested as geometry.
 */

export type Point = { x: number; y: number };

export type Rect = { id: string; x: number; y: number; width: number; height: number };

export type Route = {
  /** Corner points, from the source handle to the target handle. */
  points: Point[];
  /** Where the label goes. */
  label: Point;
  /** `direct`: the plain three-segment route. `detour`: around cards. `return`: target sits left. */
  kind: "direct" | "detour" | "return";
};

/** How far a line keeps from a card it passes. */
const CLEARANCE = 10;
/** How far a line runs straight out of a handle before it may turn. */
const STUB = 18;

type Segment = { a: Point; b: Point };

function inflate(rect: Rect, by: number) {
  return {
    left: rect.x - by,
    right: rect.x + rect.width + by,
    top: rect.y - by,
    bottom: rect.y + rect.height + by,
  };
}

/** Does an axis-aligned segment pass through a card (with clearance)? */
function hits(segment: Segment, rect: Rect): boolean {
  const box = inflate(rect, CLEARANCE);
  const minX = Math.min(segment.a.x, segment.b.x);
  const maxX = Math.max(segment.a.x, segment.b.x);
  const minY = Math.min(segment.a.y, segment.b.y);
  const maxY = Math.max(segment.a.y, segment.b.y);
  return maxX > box.left && minX < box.right && maxY > box.top && minY < box.bottom;
}

function segmentsOf(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    out.push({ a: points[index - 1], b: points[index] });
  }
  return out;
}

function clear(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  for (const segment of segmentsOf(points)) {
    for (const rect of obstacles) if (hits(segment, rect)) return false;
  }
  return true;
}

function length(points: readonly Point[]): number {
  let total = 0;
  for (const { a, b } of segmentsOf(points)) total += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return total;
}

/** Drop repeated and collinear corners, so the drawn path has no zero-length kinks. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    out.push(point);
  }
  for (let index = out.length - 2; index > 0; index -= 1) {
    const a = out[index - 1];
    const b = out[index];
    const c = out[index + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(index, 1);
  }
  return out;
}

/** The label sits on the segment entering the target, when there is room for it. */
function labelPoint(points: readonly Point[]): Point {
  const n = points.length;
  if (n === 2 && points[0].y === points[1].y) {
    // A straight line: the label goes where the bent routes beside it put
    // theirs — on the half nearest the target — so a column of labels lines
    // up instead of one sitting on the fan's vertical leg.
    return { x: (points[0].x + 3 * points[1].x) / 4, y: points[1].y };
  }
  if (n >= 2) {
    const last = points[n - 1];
    const before = points[n - 2];
    if (before.y === last.y && Math.abs(last.x - before.x) >= 44) {
      return { x: (last.x + before.x) / 2, y: last.y };
    }
  }
  let best = { a: points[0], b: points[n - 1] };
  let bestLength = -1;
  for (const segment of segmentsOf(points)) {
    const l = Math.abs(segment.a.x - segment.b.x) + Math.abs(segment.a.y - segment.b.y);
    if (l > bestLength) {
      best = segment;
      bestLength = l;
    }
  }
  return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
}

function done(points: Point[], kind: Route["kind"], labelOn: "end" | "leg" = "end"): Route {
  const simple = simplify(points);
  return { points: simple, label: labelOn === "leg" ? legPoint(simple) : labelPoint(simple), kind };
}

/** The middle of the longest vertical leg — where a second label into the same card can sit. */
function legPoint(points: readonly Point[]): Point {
  let best: Segment | null = null;
  let bestLength = -1;
  for (const segment of segmentsOf(points)) {
    if (segment.a.x !== segment.b.x) continue;
    const l = Math.abs(segment.a.y - segment.b.y);
    if (l > bestLength) {
      best = segment;
      bestLength = l;
    }
  }
  if (!best || bestLength < 24) return labelPoint(points);
  return { x: best.a.x, y: (best.a.y + best.b.y) / 2 };
}

/**
 * The route from a source handle (right side) to a target handle (left side).
 *
 * `obstacles` are the cards on screen; the source and target cards are passed
 * separately so a return route can be kept clear of both ends.
 */
export function routeConnector(
  source: Point,
  target: Point,
  obstacles: readonly Rect[],
  ends: { source?: Rect; target?: Rect } = {},
  options: { laneX?: number; labelOn?: "end" | "leg" } = {},
): Route {
  const others = obstacles.filter(
    (rect) => rect.id !== ends.source?.id && rect.id !== ends.target?.id,
  );
  const startX = source.x + STUB;
  const endX = target.x - STUB;

  if (endX >= startX) {
    // ── forward: the target is to the right ─────────────────────────────────
    if (source.y === target.y) {
      const straight = [source, target];
      if (clear(straight, others)) return done(straight, "direct", options.labelOn);
    }

    // Where the vertical leg can run: in this source's own lane of the gap
    // (so two sources' lines do not run on top of each other), halfway,
    // hugging either end, or in any gap between cards that lie across the way.
    const middle =
      options.laneX !== undefined && options.laneX >= startX && options.laneX <= endX
        ? options.laneX
        : (source.x + target.x) / 2;
    const xs = new Set<number>([middle, startX, endX]);
    const minY = Math.min(source.y, target.y);
    const maxY = Math.max(source.y, target.y);
    for (const rect of others) {
      const box = inflate(rect, CLEARANCE + 1);
      if (box.right < startX || box.left > endX) continue;
      if (box.left >= startX && box.left <= endX) xs.add(box.left);
      if (box.right >= startX && box.right <= endX) xs.add(box.right);
    }
    const legs = [...xs].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
    for (const x of legs) {
      const route = [source, { x, y: source.y }, { x, y: target.y }, target];
      if (clear(route, others)) {
        return done(route, x === middle ? "direct" : "detour", options.labelOn);
      }
    }

    // Nothing clear on the straight legs: run along a lane between rows.
    const lanes = new Set<number>([source.y, target.y, (minY + maxY) / 2]);
    for (const rect of others) {
      const box = inflate(rect, CLEARANCE + 2);
      if (box.right < source.x || box.left > target.x) continue;
      lanes.add(box.top);
      lanes.add(box.bottom);
    }
    const centre = (minY + maxY) / 2;
    const candidates = [...lanes]
      .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b)
      .map((lane) => [
        source,
        { x: startX, y: source.y },
        { x: startX, y: lane },
        { x: endX, y: lane },
        { x: endX, y: target.y },
        target,
      ]);
    let best: Point[] | null = null;
    for (const route of candidates) {
      if (!clear(route, others)) continue;
      if (!best || length(route) < length(best)) best = route;
    }
    if (best) return done(best, "detour", options.labelOn);
    // Boxed in on every side: the plain route is still the honest one.
    return done([source, { x: middle, y: source.y }, { x: middle, y: target.y }, target], "direct", options.labelOn);
  }

  // ── return: the target is to the left of (or level with) the source ───────
  // Out to the right, over or under both cards, and back in from the left.
  const ends2 = [ends.source, ends.target].filter((rect): rect is Rect => Boolean(rect));
  const spanLeft = Math.min(endX, startX);
  const spanRight = Math.max(endX, startX);
  const inSpan = [...others, ...ends2].filter((rect) => {
    const box = inflate(rect, CLEARANCE);
    return box.right >= spanLeft && box.left <= spanRight;
  });
  const top = Math.min(
    source.y,
    target.y,
    ...inSpan.map((rect) => inflate(rect, CLEARANCE + 6).top),
  );
  const bottom = Math.max(
    source.y,
    target.y,
    ...inSpan.map((rect) => inflate(rect, CLEARANCE + 6).bottom),
  );
  const lanes = [top, bottom];
  // Prefer the side nearer both ends; fall back to the other.
  const near = Math.abs(top - (source.y + target.y) / 2) <= Math.abs(bottom - (source.y + target.y) / 2);
  const ordered = near ? lanes : [...lanes].reverse();
  for (const lane of ordered) {
    const route = [
      source,
      { x: startX, y: source.y },
      { x: startX, y: lane },
      { x: endX, y: lane },
      { x: endX, y: target.y },
      target,
    ];
    if (clear(route, others)) return done(route, "return", options.labelOn);
  }
  const lane = ordered[0];
  return done(
    [
      source,
      { x: startX, y: source.y },
      { x: startX, y: lane },
      { x: endX, y: lane },
      { x: endX, y: target.y },
      target,
    ],
    "return",
  );
}

/** An SVG path through the corners, each corner rounded so the line reads as one stroke. */
export function pathThrough(points: readonly Point[], radius = 8): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1];
    const corner = points[index];
    const after = points[index + 1];
    const inLength = Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y);
    const outLength = Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const inDir = { x: Math.sign(corner.x - before.x), y: Math.sign(corner.y - before.y) };
    const outDir = { x: Math.sign(after.x - corner.x), y: Math.sign(after.y - corner.y) };
    const start = { x: corner.x - inDir.x * r, y: corner.y - inDir.y * r };
    const end = { x: corner.x + outDir.x * r, y: corner.y + outDir.y * r };
    d += ` L ${start.x},${start.y} Q ${corner.x},${corner.y} ${end.x},${end.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/**
 * A lane in the gap between two columns for each source that crosses it.
 *
 * Without lanes, every connector crossing a gap turns at its midpoint, and the
 * vertical legs of different sources lie on top of one another — two
 * relationships drawn as one line. Each source crossing the same gap gets its
 * own lane, ordered top to bottom as the sources are, so the legs sit side by
 * side and do not cross each other.
 *
 * Returns the lane's x for every forward edge, keyed by edge id.
 */
export function gapLanes(
  edges: readonly { edge_id: string; source_id: string; target_id: string }[],
  rects: ReadonlyMap<string, Rect>,
  options: { spacing?: number; stub?: number } = {},
): Map<string, number> {
  const spacing = options.spacing ?? 12;
  const stub = options.stub ?? STUB;
  type Gap = { left: number; right: number; sources: Map<string, number>; edges: string[] };
  const gaps = new Map<string, Gap>();
  for (const edge of edges) {
    const s = rects.get(edge.source_id);
    const t = rects.get(edge.target_id);
    if (!s || !t) continue;
    const left = s.x + s.width;
    const right = t.x;
    if (right - left < 2 * stub + 4) continue; // not a forward connector
    const key = `${Math.round(left)}:${Math.round(right)}`;
    const gap: Gap = gaps.get(key) ?? { left, right, sources: new Map<string, number>(), edges: [] };
    gap.sources.set(edge.source_id, s.y + s.height / 2);
    gap.edges.push(edge.edge_id);
    gaps.set(key, gap);
  }
  const bySource = new Map<string, string>();
  for (const edge of edges) bySource.set(edge.edge_id, edge.source_id);

  const out = new Map<string, number>();
  for (const gap of gaps.values()) {
    const order = [...gap.sources.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    const n = order.length;
    const room = gap.right - gap.left - 2 * stub;
    const step = n > 1 ? Math.min(spacing, room / (n - 1)) : 0;
    const middle = (gap.left + gap.right) / 2;
    const laneOf = new Map(order.map(([id], index) => [id, middle + (index - (n - 1) / 2) * step]));
    for (const edgeId of gap.edges) out.set(edgeId, laneOf.get(bySource.get(edgeId)!)!);
  }
  return out;
}

/**
 * Where each connector's label goes when several enter the same card.
 *
 * Labels sit on the stub that enters the target — but two connectors into one
 * card share that stub, and their labels would print on top of each other.
 * The connector whose source is nearest the target's row keeps the stub; the
 * others carry their label on their own vertical leg, which no other
 * connector shares.
 */
export function labelPlacement(
  edges: readonly { edge_id: string; source_id: string; target_id: string }[],
  rects: ReadonlyMap<string, Rect>,
): Map<string, "end" | "leg"> {
  const byTarget = new Map<string, { edge_id: string; distance: number }[]>();
  for (const edge of edges) {
    const s = rects.get(edge.source_id);
    const t = rects.get(edge.target_id);
    if (!s || !t) continue;
    const distance = Math.abs(s.y + s.height / 2 - (t.y + t.height / 2));
    const list = byTarget.get(edge.target_id) ?? [];
    list.push({ edge_id: edge.edge_id, distance });
    byTarget.set(edge.target_id, list);
  }
  const out = new Map<string, "end" | "leg">();
  for (const list of byTarget.values()) {
    list.sort((a, b) => a.distance - b.distance || (a.edge_id < b.edge_id ? -1 : 1));
    list.forEach((entry, index) => out.set(entry.edge_id, index === 0 ? "end" : "leg"));
  }
  return out;
}
