import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Box, InputBase } from "@mui/material";
import "./shapeNode.css";
import {
  DIAGRAM_SHAPE_MIN_SIZE,
  DIAGRAM_SHAPE_TEXT_PLACEHOLDER,
  type DiagramShapeKind,
} from "../domain/diagramShape";
import { ShapeFormatToolbar, type ShapeStylePatch } from "./ShapeFormatToolbar";

/** ReactFlow node type name to register this renderer under. */
export const SHAPE_NODE_TYPE = "annotationShape";

/**
 * Width of the invisible band along a frame's outline that takes clicks. The
 * painted line is 1.5px — far too thin to hit — so an unpainted stroke of this
 * width rides on top of it and answers for the whole edge, corners included.
 */
const OUTLINE_HIT_WIDTH = 16;
const OUTLINE_WIDTH = 1.5;
const OUTLINE_COLOR = "#78909C";
const OUTLINE_COLOR_HOVER = "#455A64";
const OUTLINE_COLOR_SELECTED = "#1976D2";

/**
 * The frame outline of an unfilled shape, drawn as SVG so the hit area can follow
 * the line itself — `pointer-events: stroke` means clicks land on the edge and
 * nowhere else, leaving the middle of the frame click-through.
 */
function ShapeOutline({ kind, selected, color: chosen }: {
  kind: DiagramShapeKind;
  selected: boolean;
  /** The shape's own outline colour; the default when it has none of its own. */
  color: string;
}) {
  const [hovered, setHovered] = useState(false);
  // Selection always reads blue, so the handles and the outline agree.
  const color = selected
    ? OUTLINE_COLOR_SELECTED
    : hovered && chosen === OUTLINE_COLOR ? OUTLINE_COLOR_HOVER : chosen;
  const painted = { fill: "none", stroke: color, strokeWidth: OUTLINE_WIDTH } as const;
  // Transparent, wide, and the only part of the outline that answers to a pointer.
  const hitArea = {
    fill: "none",
    stroke: "transparent",
    strokeWidth: OUTLINE_HIT_WIDTH,
    style: { pointerEvents: "stroke", cursor: "grab" } as CSSProperties,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
    >
      {kind === "ELLIPSE" ? (
        <>
          <ellipse cx="50%" cy="50%" rx="50%" ry="50%" {...painted} />
          <ellipse cx="50%" cy="50%" rx="50%" ry="50%" {...hitArea} />
        </>
      ) : (
        <>
          <rect width="100%" height="100%" rx="8" ry="8" {...painted} />
          <rect width="100%" height="100%" rx="8" ry="8" {...hitArea} />
        </>
      )}
    </svg>
  );
}

export type ShapeNodeData = {
  kind: DiagramShapeKind;
  text: string;
  /** Style overrides; each unset field falls back to the kind's default. */
  strokeColor?: string | null;
  textColor?: string | null;
  fontSize?: number | null;
  onTextChange: (text: string) => void;
  onStyleChange: (patch: ShapeStylePatch) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onResizeEnd: (width: number, height: number, x: number, y: number) => void;
  onRemove: () => void;
};

type ShapeStyle = {
  /** Painted area; transparent means clicks fall through to the canvas. */
  filled: boolean;
  border: string;
  radius: string;
  background: string;
  textColor: string;
  fontSize: number;
  fontWeight: number;
  /** Where the text sits inside the shape. */
  align: CSSProperties["alignItems"];
  justify: CSSProperties["justifyContent"];
};

const SHAPE_STYLES: Record<DiagramShapeKind, ShapeStyle> = {
  RECTANGLE: {
    filled: false,
    border: "1.5px solid #78909C",
    radius: "8px",
    background: "transparent",
    textColor: "#455A64",
    fontSize: 12,
    fontWeight: 700,
    align: "flex-start",
    justify: "center",
  },
  ELLIPSE: {
    filled: false,
    border: "1.5px solid #78909C",
    radius: "50%",
    background: "transparent",
    textColor: "#455A64",
    fontSize: 12,
    fontWeight: 700,
    align: "center",
    justify: "center",
  },
  TEXT: {
    filled: true,
    border: "1px solid transparent",
    radius: "4px",
    background: "transparent",
    textColor: "#37474F",
    fontSize: 14,
    fontWeight: 600,
    align: "center",
    justify: "flex-start",
  },
  NOTE: {
    filled: true,
    border: "1px solid #FFCA28",
    radius: "4px",
    background: "#FFF8E1",
    textColor: "#5D4037",
    fontSize: 12,
    fontWeight: 500,
    align: "flex-start",
    justify: "flex-start",
  },
};

/**
 * A drawn annotation. Unfilled shapes (box, circle) only take pointer events on
 * their border and their text, so a frame drawn around a group of type cards
 * still lets you drag-select or pan through its empty middle.
 */
export function ShapeNode({ data, selected }: NodeProps & { data: ShapeNodeData }) {
  const style = SHAPE_STYLES[data.kind];
  const strokeColor = data.strokeColor ?? OUTLINE_COLOR;
  const textColor = data.textColor ?? style.textColor;
  const fontSize = data.fontSize ?? style.fontSize;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setDraft(data.text); }, [data.text]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== data.text) data.onTextChange(draft);
  }

  const interactive: CSSProperties = { pointerEvents: "auto" };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={DIAGRAM_SHAPE_MIN_SIZE.width}
        minHeight={DIAGRAM_SHAPE_MIN_SIZE.height}
        // Sizing, grab areas and stacking all live in shapeNode.css — the node
        // wrapper switches pointer events off so a frame's middle stays
        // click-through, so the handles switch them back on and sit above the
        // outline's own hit-stroke. The edge lines are hidden there: edges drag
        // the shape, corners resize it.
        handleClassName="pdp-shape-resize-handle"
        lineClassName="pdp-shape-resize-line"
        onResizeEnd={(_, params) => data.onResizeEnd(params.width, params.height, params.x, params.y)}
      />
      <ShapeFormatToolbar
        kind={data.kind}
        strokeColor={data.strokeColor}
        textColor={data.textColor}
        fontSize={data.fontSize}
        defaultStrokeColor={OUTLINE_COLOR}
        defaultTextColor={style.textColor}
        defaultFontSize={style.fontSize}
        visible={Boolean(selected) && !editing}
        onChange={data.onStyleChange}
        onBringToFront={data.onBringToFront}
        onSendToBack={data.onSendToBack}
        onRemove={data.onRemove}
      />
      <Box
        onDoubleClick={() => setEditing(true)}
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: style.align,
          justifyContent: style.justify,
          px: data.kind === "ELLIPSE" ? 2 : 1,
          py: 0.75,
          // A frame draws its own outline in SVG (see ShapeOutline) so the line
          // itself is clickable; only filled shapes carry a CSS border.
          border: style.filled ? style.border : undefined,
          borderColor: style.filled
            ? (selected ? OUTLINE_COLOR_SELECTED : data.strokeColor ?? undefined)
            : undefined,
          borderRadius: style.radius,
          bgcolor: style.background,
          boxSizing: "border-box",
          position: "relative",
          cursor: "grab",
          // The middle of a frame stays click-through; its outline, its text and
          // its toolbar each re-enable pointer events for themselves.
          pointerEvents: style.filled ? "auto" : "none",
          "&:hover": { borderColor: style.filled ? OUTLINE_COLOR_SELECTED : undefined },
        }}
      >
        {!style.filled && (
          <ShapeOutline kind={data.kind} selected={Boolean(selected)} color={strokeColor} />
        )}
        {editing ? (
          <InputBase
            inputRef={inputRef}
            className="nodrag nowheel"
            multiline
            fullWidth
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setDraft(data.text); setEditing(false); }
              // Enter commits on single-line shapes; notes and frames keep it for wrapping.
              if (event.key === "Enter" && (data.kind === "TEXT" || !event.shiftKey)) {
                event.preventDefault();
                commit();
              }
            }}
            sx={{
              ...interactive,
              fontSize,
              fontWeight: style.fontWeight,
              color: textColor,
              lineHeight: 1.35,
              p: 0,
              "& textarea": { textAlign: style.justify === "center" ? "center" : "left" },
            }}
          />
        ) : (
          <Box
            component="span"
            sx={{
              ...interactive,
              fontSize,
              fontWeight: style.fontWeight,
              color: data.text ? textColor : "#B0BEC5",
              lineHeight: 1.35,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              textAlign: style.justify === "center" ? "center" : "left",
              maxWidth: "100%",
              // A frame's caption sits on the border line rather than floating inside it.
              bgcolor: style.filled ? "transparent" : "rgba(255,255,255,0.85)",
              px: style.filled ? 0 : 0.5,
              borderRadius: "3px",
              mt: style.align === "flex-start" && !style.filled ? "-14px" : 0,
            }}
          >
            {data.text || (data.kind === "TEXT" ? DIAGRAM_SHAPE_TEXT_PLACEHOLDER : "")}
          </Box>
        )}

      </Box>
    </>
  );
}
