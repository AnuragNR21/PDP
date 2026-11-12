import { getBezierPath, getSmoothStepPath, getStraightPath } from "@xyflow/react";
import type { Position } from "@xyflow/react";

/** Connection-line shapes a saved diagram can use, per edge. */
export const EDGE_STYLES = ["curved", "straight", "elbow"] as const;

export type EdgeStyle = (typeof EDGE_STYLES)[number];

export const DEFAULT_EDGE_STYLE: EdgeStyle = "curved";

export const EDGE_STYLE_LABELS: Record<EdgeStyle, string> = {
  curved: "Curved",
  straight: "Straight",
  elbow: "Elbow",
};

/** Corner rounding for elbow edges; 0 would give hard right angles. */
const ELBOW_BORDER_RADIUS = 8;

export function isEdgeStyle(value: unknown): value is EdgeStyle {
  return typeof value === "string" && (EDGE_STYLES as readonly string[]).includes(value);
}

/** Coerce anything (DTO field, stale saved value) into a usable style. */
export function toEdgeStyle(value: unknown, fallback: EdgeStyle = DEFAULT_EDGE_STYLE): EdgeStyle {
  return isEdgeStyle(value) ? value : fallback;
}

export type EdgePathParams = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
};

/**
 * Build the SVG path for an edge in the requested style.
 * Returns the ReactFlow path tuple: [path, labelX, labelY].
 */
export function getEdgeStylePath(style: EdgeStyle, params: EdgePathParams): [string, number, number] {
  if (style === "straight") {
    // getStraightPath ignores the handle sides — it only needs the two endpoints.
    const [path, labelX, labelY] = getStraightPath({
      sourceX: params.sourceX,
      sourceY: params.sourceY,
      targetX: params.targetX,
      targetY: params.targetY,
    });
    return [path, labelX, labelY];
  }
  if (style === "elbow") {
    const [path, labelX, labelY] = getSmoothStepPath({ ...params, borderRadius: ELBOW_BORDER_RADIUS });
    return [path, labelX, labelY];
  }
  const [path, labelX, labelY] = getBezierPath(params);
  return [path, labelX, labelY];
}
