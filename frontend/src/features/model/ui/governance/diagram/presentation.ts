import type { DiagramShape, EdgeStyle } from "@/features/cross-model";

/**
 * How one diagram looks, as opposed to what it shows. Everything here is
 * projection only: none of it touches a node type, an element type or a
 * relationship, and none of it travels to the server — the saved diagram keeps
 * positions, line shapes and annotations; these settings are kept per diagram in
 * this browser.
 */

export const NODE_SIZES = ["small", "medium", "large"] as const;
export type NodeSize = (typeof NODE_SIZES)[number];
export const NODE_SIZE_LABEL: Record<NodeSize, string> = { small: "Small", medium: "Medium", large: "Large" };

export const NODE_STYLES = ["default", "outlined", "filled", "minimal"] as const;
export type NodeStyle = (typeof NODE_STYLES)[number];
export const NODE_STYLE_LABEL: Record<NodeStyle, string> = {
  default: "Default",
  outlined: "Outlined",
  filled: "Filled",
  minimal: "Minimal",
};

export const LINE_COLOURS = [
  { value: "#1565C0", label: "Blue" },
  { value: "#2E7D32", label: "Green" },
  { value: "#EF6C00", label: "Orange" },
  { value: "#C62828", label: "Red" },
  { value: "#6A1B9A", label: "Purple" },
  { value: "#00838F", label: "Teal" },
  { value: "#455A64", label: "Slate" },
  { value: "#212121", label: "Black" },
] as const;

export const LINE_WEIGHTS = [1, 1.6, 2.5, 4] as const;
export const LINE_WEIGHT_LABEL: Record<number, string> = { 1: "Thin", 1.6: "Normal", 2.5: "Medium", 4: "Thick" };
export const DEFAULT_LINE_WEIGHT = 1.6;

export type Point = { x: number; y: number };

export type NodePresentation = {
  size?: NodeSize;
  style?: NodeStyle;
  /** Stacking order; unset sits on the card layer. */
  z?: number;
  locked?: boolean;
  hidden?: boolean;
  /** Hides the "Node Type · model" caption, leaving badge and name. */
  labelHidden?: boolean;
};

export type EdgePresentation = {
  color?: string;
  weight?: number;
  labelHidden?: boolean;
  /** Points the line is routed through, in canvas coordinates. */
  bends?: Point[];
};

export type DiagramGroup = { id: string; members: string[] };

export type DiagramPresentation = {
  /** Type cards, by node type / element type id. */
  nodes: Record<string, NodePresentation>;
  /** Connections, by edge key. */
  edges: Record<string, EdgePresentation>;
  /** Annotation rotation in degrees, by the shape's client id. */
  shapeRotation: Record<string, number>;
  /** Members are card ids and shape ids. */
  groups: DiagramGroup[];
  /** Groups taken apart, newest last — what Regroup puts back. */
  ungrouped: string[][];
};

export const EMPTY_PRESENTATION: DiagramPresentation = { nodes: {}, edges: {}, shapeRotation: {}, groups: [], ungrouped: [] };

export type DiagramPrefs = { grid: boolean; snap: boolean; legend: boolean };
export const DEFAULT_PREFS: DiagramPrefs = { grid: true, snap: false, legend: true };

// ── Storage ───────────────────────────────────────────────────────────────────
// Shapes get a fresh client id each time a diagram is opened, so anything about
// a shape is stored by its position in the diagram's shape list, which the
// server keeps in order.

const KEY_PREFIX = "pdp-mws-diagram-presentation:";
const PREFS_KEY = "pdp-mws-diagram-prefs";
const SHAPE_REF = "shape#";

type StoredPresentation = {
  nodes: Record<string, NodePresentation>;
  edges: Record<string, EdgePresentation>;
  shapeRotation: Record<string, number>;
  groups: DiagramGroup[];
  ungrouped: string[][];
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept for next time; the diagram still works for this visit.
  }
}

export function loadPrefs(): DiagramPrefs {
  const stored = read<Partial<DiagramPrefs>>(PREFS_KEY);
  const flag = (key: keyof DiagramPrefs) =>
    stored && typeof stored === 'object' && typeof stored[key] === 'boolean' ? (stored[key] as boolean) : DEFAULT_PREFS[key];
  return { grid: flag('grid'), snap: flag('snap'), legend: flag('legend') };
}

export function savePrefs(prefs: DiagramPrefs) {
  write(PREFS_KEY, prefs);
}

export function savePresentation(diagramId: string, presentation: DiagramPresentation, shapes: DiagramShape[]) {
  const empty =
    Object.keys(presentation.nodes).length === 0 &&
    Object.keys(presentation.edges).length === 0 &&
    Object.keys(presentation.shapeRotation).length === 0 &&
    presentation.groups.length === 0 &&
    presentation.ungrouped.length === 0;
  // Nothing set: leave no trace for this diagram.
  if (empty) {
    forgetPresentation(diagramId);
    return;
  }
  const indexOf = new Map(shapes.map((shape, index) => [shape.id, index]));
  const toRef = (id: string) => (indexOf.has(id) ? `${SHAPE_REF}${indexOf.get(id)}` : id);
  const stored: StoredPresentation = {
    nodes: presentation.nodes,
    edges: presentation.edges,
    shapeRotation: Object.fromEntries(
      Object.entries(presentation.shapeRotation)
        .filter(([id, deg]) => indexOf.has(id) && deg % 360 !== 0)
        .map(([id, deg]) => [String(indexOf.get(id)), deg]),
    ),
    groups: presentation.groups.map((group) => ({ id: group.id, members: group.members.map(toRef) })),
    ungrouped: presentation.ungrouped.map((members) => members.map(toRef)),
  };
  write(`${KEY_PREFIX}${diagramId}`, stored);
}

export function loadPresentation(diagramId: string, shapes: DiagramShape[]): DiagramPresentation {
  const stored = read<StoredPresentation>(`${KEY_PREFIX}${diagramId}`);
  if (!stored || typeof stored !== 'object') return EMPTY_PRESENTATION;
  const record = <T,>(value: unknown): Record<string, T> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const ids = (value: unknown): string[] => list(value).filter((v): v is string => typeof v === 'string');
  const fromRef = (ref: string) => (ref.startsWith(SHAPE_REF) ? shapes[Number(ref.slice(SHAPE_REF.length))]?.id : ref);
  const members = (refs: unknown) => ids(refs).map(fromRef).filter((id): id is string => Boolean(id));
  // Bends must be real points, or the line has nothing to draw through.
  const edges = Object.fromEntries(
    Object.entries(record<EdgePresentation>(stored.edges)).map(([key, look]) => {
      const safe = record<unknown>(look) as EdgePresentation;
      const bends = list(safe.bends).filter(
        (p): p is Point => Boolean(p) && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y),
      );
      return [key, { ...safe, bends }];
    }),
  );
  return {
    nodes: Object.fromEntries(Object.entries(record<NodePresentation>(stored.nodes)).map(([key, look]) => [key, record<unknown>(look) as NodePresentation])),
    edges,
    shapeRotation: Object.fromEntries(
      Object.entries(record<unknown>(stored.shapeRotation))
        .map(([index, deg]) => [shapes[Number(index)]?.id, deg] as const)
        .filter((entry): entry is readonly [string, number] => Boolean(entry[0]) && Number.isFinite(entry[1])),
    ),
    groups: list(stored.groups)
      .map((group) => record<unknown>(group))
      .map((group) => ({ id: typeof group.id === 'string' ? group.id : `group-${Math.random().toString(36).slice(2)}`, members: members(group.members) }))
      .filter((group) => group.members.length > 1),
    ungrouped: list(stored.ungrouped).map(members).filter((set) => set.length > 1),
  };
}

/** A duplicated diagram starts with the same look. */
export function copyPresentation(fromId: string, toId: string) {
  const stored = read<StoredPresentation>(`${KEY_PREFIX}${fromId}`);
  if (stored) write(`${KEY_PREFIX}${toId}`, stored);
}

export function forgetPresentation(diagramId: string) {
  try {
    localStorage.removeItem(`${KEY_PREFIX}${diagramId}`);
  } catch {
    // Nothing to tidy up.
  }
}

// ── Geometry ──────────────────────────────────────────────────────────────────

export type Rect = { id: string; x: number; y: number; width: number; height: number };

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** New top-left corners that line the boxes up along one edge or centre line. */
export function alignBoxes(boxes: Rect[], mode: AlignMode): Record<string, Point> {
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const centreX = (left + right) / 2;
  const centreY = (top + bottom) / 2;
  return Object.fromEntries(
    boxes.map((b) => {
      const p = { x: b.x, y: b.y };
      if (mode === "left") p.x = left;
      if (mode === "center") p.x = centreX - b.width / 2;
      if (mode === "right") p.x = right - b.width;
      if (mode === "top") p.y = top;
      if (mode === "middle") p.y = centreY - b.height / 2;
      if (mode === "bottom") p.y = bottom - b.height;
      return [b.id, p];
    }),
  );
}

/** Equal gaps between the boxes, the outermost two staying where they are. */
export function distributeBoxes(boxes: Rect[], axis: "horizontal" | "vertical"): Record<string, Point> {
  const horizontal = axis === "horizontal";
  const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const start = horizontal ? sorted[0].x : sorted[0].y;
  const last = sorted[sorted.length - 1];
  const end = horizontal ? last.x + last.width : last.y + last.height;
  const occupied = sorted.reduce((sum, b) => sum + (horizontal ? b.width : b.height), 0);
  const gap = (end - start - occupied) / (sorted.length - 1);
  let cursor = start;
  const result: Record<string, Point> = {};
  for (const b of sorted) {
    result[b.id] = horizontal ? { x: cursor, y: b.y } : { x: b.x, y: cursor };
    cursor += (horizontal ? b.width : b.height) + gap;
  }
  return result;
}

export type ArrangeOp = "front" | "forward" | "backward" | "back";

/**
 * Stacking after moving the selected objects. `layers` holds every object's
 * current z; the result is the new z of whatever changed, kept at or above zero
 * (a negative z drops an object behind the canvas itself).
 */
export function arrangeLayers(layers: Record<string, number>, selected: string[], op: ArrangeOp): Record<string, number> {
  const chosen = new Set(selected);
  const others = Object.entries(layers).filter(([id]) => !chosen.has(id)).map(([, z]) => z);
  const mine = selected.map((id) => layers[id]);
  const top = Math.max(...mine);
  const bottom = Math.min(...mine);
  let target: number;
  if (op === "front") target = Math.max(top, ...others) + 1;
  else if (op === "back") target = Math.min(bottom, ...others) - 1;
  else if (op === "forward") {
    const above = others.filter((z) => z > top);
    target = above.length ? Math.min(...above) + 1 : top + 1;
  } else {
    const below = others.filter((z) => z < bottom);
    target = below.length ? Math.max(...below) - 1 : bottom - 1;
  }
  // The selection moves as one, keeping its own internal order.
  const shift = op === "front" || op === "forward" ? target - bottom : target - top;
  const next: Record<string, number> = { ...layers };
  for (const id of selected) next[id] = layers[id] + shift;
  const lowest = Math.min(...Object.values(next));
  if (lowest < 0) for (const id of Object.keys(next)) next[id] -= lowest;
  return Object.fromEntries(Object.entries(next).filter(([id, z]) => layers[id] !== z));
}

/**
 * A layered layout: types with no incoming relationship start the first column,
 * each relationship moves its target one column to the right, and a column is
 * ordered by where its sources sit, so lines cross as little as a quick pass can
 * manage. Cycles are broken where they are met.
 */
export function layeredLayout(ids: string[], links: Array<{ sourceId: string; targetId: string }>, gapX = 300, gapY = 120): Record<string, Point> {
  const present = new Set(ids);
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    incoming.set(id, 0);
  }
  for (const l of links) {
    if (!present.has(l.sourceId) || !present.has(l.targetId) || l.sourceId === l.targetId) continue;
    outgoing.get(l.sourceId)!.push(l.targetId);
    incoming.set(l.targetId, (incoming.get(l.targetId) ?? 0) + 1);
  }
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (level.has(id)) return level.get(id)!;
    visiting.add(id);
    let best = 0;
    for (const [source, targets] of outgoing) {
      if (!targets.includes(id) || visiting.has(source)) continue;
      best = Math.max(best, depth(source) + 1);
    }
    visiting.delete(id);
    level.set(id, best);
    return best;
  };
  ids.forEach(depth);
  const columns = new Map<number, string[]>();
  for (const id of ids) columns.set(level.get(id)!, [...(columns.get(level.get(id)!) ?? []), id]);
  const rowOf = new Map<string, number>();
  const result: Record<string, Point> = {};
  for (const col of [...columns.keys()].sort((a, b) => a - b)) {
    const members = columns.get(col)!;
    const weight = (id: string) => {
      const parents = [...outgoing].filter(([, targets]) => targets.includes(id)).map(([source]) => rowOf.get(source)).filter((r): r is number => r !== undefined);
      return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Number.MAX_SAFE_INTEGER;
    };
    members.sort((a, b) => weight(a) - weight(b));
    members.forEach((id, row) => {
      rowOf.set(id, row);
      result[id] = { x: 80 + col * gapX, y: 60 + row * gapY };
    });
  }
  return result;
}

/** Where on a polyline a new bend goes: on the segment nearest the point. */
export function insertBend(points: Point[], bend: Point): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = distanceToSegment(bend, points[i], points[i + 1]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best; // index into the bend list (segment i sits before bend i)
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function nearestIndex(points: Point[], p: Point) {
  let best = -1;
  let bestDistance = Infinity;
  points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

export type { EdgeStyle };
