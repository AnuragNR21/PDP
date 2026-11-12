/**
 * Drawn annotations on a diagram canvas — a box, a circle, a text label, a note.
 *
 * These carry no business data: they never take part in relationships, never
 * appear in the legend or the counts, and nothing outside the diagram they were
 * drawn on refers to them. They exist so a reader can frame a group of types,
 * label a region, or leave a remark next to the model.
 */

export const DIAGRAM_SHAPE_KINDS = ["RECTANGLE", "ELLIPSE", "TEXT", "NOTE"] as const;

export type DiagramShapeKind = (typeof DIAGRAM_SHAPE_KINDS)[number];

/** Colours offered for a shape's outline and for text. */
export const DIAGRAM_SHAPE_PALETTE = [
  "#455A64", // slate
  "#1976D2", // blue
  "#2E7D32", // green
  "#F9A825", // amber
  "#C62828", // red
  "#6A1B9A", // purple
  "#00838F", // teal
  "#B0BEC5", // light grey
] as const;

/** Font sizes offered for a text annotation. */
export const DIAGRAM_SHAPE_FONT_SIZES = [12, 14, 16, 20, 24, 32] as const;

export type DiagramShape = {
  /**
   * Client-side identity only. A shape has no server-side id: saving replaces a
   * diagram's whole shape set, since there is nothing to reconcile against.
   */
  id: string;
  kind: DiagramShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** Outline colour; unset falls back to the kind's default. */
  strokeColor?: string | null;
  /** Text colour; unset falls back to the kind's default. */
  textColor?: string | null;
  /** Text size in px; unset falls back to the kind's default. */
  fontSize?: number | null;
  /** Stacking order; unset sits on the default shape layer, behind the cards. */
  zIndex?: number | null;
};

/**
 * The layer the type/element cards occupy. Shapes start well below it — a frame
 * is drawn around cards, not over them — leaving room for many annotation layers
 * underneath, while "bring to front" lifts one above, which is what a callout
 * note pinned over a card needs.
 */
export const DIAGRAM_CARD_Z_INDEX = 100;
export const DIAGRAM_SHAPE_DEFAULT_Z_INDEX = 0;

const zIndexOf = (shape: DiagramShape) => shape.zIndex ?? DIAGRAM_SHAPE_DEFAULT_Z_INDEX;

/**
 * Keep the whole set at or above zero. A negative z-index would drop a shape out
 * of the node layer altogether — behind the canvas itself — so sending one to the
 * back lifts the others instead of pushing it under.
 */
function rebaseAboveZero(shapes: DiagramShape[]): DiagramShape[] {
  const lowest = Math.min(0, ...shapes.map(zIndexOf));
  if (lowest >= 0) return shapes;
  return shapes.map((shape) => ({ ...shape, zIndex: zIndexOf(shape) - lowest }));
}

/** Lift one shape above every other shape and above the cards. */
export function bringShapeToFront(shapes: DiagramShape[], id: string): DiagramShape[] {
  const front = Math.max(DIAGRAM_CARD_Z_INDEX, ...shapes.map(zIndexOf));
  return shapes.map((shape) => (shape.id === id ? { ...shape, zIndex: front + 1 } : shape));
}

/** Drop one shape below every other shape. */
export function sendShapeToBack(shapes: DiagramShape[], id: string): DiagramShape[] {
  const back = Math.min(DIAGRAM_SHAPE_DEFAULT_Z_INDEX, ...shapes.map(zIndexOf)) - 1;
  return rebaseAboveZero(shapes.map((shape) => (shape.id === id ? { ...shape, zIndex: back } : shape)));
}

/** Size a freshly placed shape starts at, before it is resized. */
export const DIAGRAM_SHAPE_DEFAULT_SIZE: Record<DiagramShapeKind, { width: number; height: number }> = {
  RECTANGLE: { width: 260, height: 160 },
  ELLIPSE: { width: 220, height: 160 },
  TEXT: { width: 180, height: 32 },
  NOTE: { width: 200, height: 120 },
};

/** Smallest a shape can be dragged down to, so it never vanishes. */
export const DIAGRAM_SHAPE_MIN_SIZE = { width: 60, height: 28 };

/**
 * Which kinds can act as a frame — a box or circle drawn around a group, as
 * opposed to a text label or sticky note, which are remarks.
 *
 * Nothing acts on this yet: dragging a frame used to carry whatever sat inside
 * it, and that was removed because it grouped by accident. Kept, with
 * `isPointInsideShape`, for a grouping the user asks for explicitly.
 */
export const DIAGRAM_SHAPE_IS_FRAME: Record<DiagramShapeKind, boolean> = {
  RECTANGLE: true,
  ELLIPSE: true,
  TEXT: false,
  NOTE: false,
};

export const DIAGRAM_SHAPE_LABELS: Record<DiagramShapeKind, string> = {
  RECTANGLE: "Box",
  ELLIPSE: "Circle",
  TEXT: "Text",
  NOTE: "Note",
};

/**
 * Placeholder for an empty TEXT shape only — it has nothing else to show, so
 * without one there would be nothing on the canvas to click. A box, circle or
 * note is visible on its own and stays clean until someone writes in it.
 */
export const DIAGRAM_SHAPE_TEXT_PLACEHOLDER = "Text";

function newShapeId(): string {
  // randomUUID needs a secure context; the fallback keeps a plain-http dev server working.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `shape-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/**
 * Is a node of this size and position inside the shape? Measured on the node's
 * centre, which is far more forgiving than requiring full containment when
 * someone draws a frame snugly around a row of cards. Circles test the ellipse
 * itself, not its bounding box.
 */
export function isPointInsideShape(
  shape: Pick<DiagramShape, "kind" | "x" | "y" | "width" | "height">,
  point: { x: number; y: number },
): boolean {
  if (!DIAGRAM_SHAPE_IS_FRAME[shape.kind]) return false;
  if (shape.kind === "ELLIPSE") {
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (point.x - (shape.x + rx)) / rx;
    const ny = (point.y - (shape.y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  return (
    point.x >= shape.x
    && point.x <= shape.x + shape.width
    && point.y >= shape.y
    && point.y <= shape.y + shape.height
  );
}

/** A saved shape brought back onto the canvas, given a fresh client-side id. */
export function restoreDiagramShape(saved: Omit<DiagramShape, "id">): DiagramShape {
  return { ...saved, id: newShapeId() };
}

/** A new shape centred on the point that was clicked. */
export function createDiagramShape(kind: DiagramShapeKind, x: number, y: number): DiagramShape {
  const { width, height } = DIAGRAM_SHAPE_DEFAULT_SIZE[kind];
  return {
    id: newShapeId(),
    kind,
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    text: "",
  };
}
