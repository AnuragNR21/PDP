import type { WorkspaceModel } from "@/shared/workspace/workspaceModel";
import { TypeSelectionPanel } from "./TypeSelectionPanel";
import { renderSelection, type SelectionSlot } from "@/shared/workspace/SelectionSlot";
import {
  Background,
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  Handle,
  type InternalNode,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useInternalNode,
  useNodes,
  useNodesState,
  useReactFlow,
  useStore,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import AutoFixHighOutlined from "@mui/icons-material/AutoFixHighOutlined";
import CenterFocusStrongOutlined from "@mui/icons-material/CenterFocusStrongOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ControlPointOutlined from "@mui/icons-material/ControlPointOutlined";
import CropFreeOutlined from "@mui/icons-material/CropFreeOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import FlipToBackOutlined from "@mui/icons-material/FlipToBackOutlined";
import FlipToFrontOutlined from "@mui/icons-material/FlipToFrontOutlined";
import FormatPaintOutlined from "@mui/icons-material/FormatPaintOutlined";
import GridGoldenratioOutlined from "@mui/icons-material/GridGoldenratioOutlined";
import GridOnOutlined from "@mui/icons-material/GridOnOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import LabelOffOutlined from "@mui/icons-material/LabelOffOutlined";
import LabelOutlined from "@mui/icons-material/LabelOutlined";
import LegendToggleOutlined from "@mui/icons-material/LegendToggleOutlined";
import LineStyleOutlined from "@mui/icons-material/LineStyleOutlined";
import LineWeightOutlined from "@mui/icons-material/LineWeightOutlined";
import LockOpenOutlined from "@mui/icons-material/LockOpenOutlined";
import LockOutlined from "@mui/icons-material/LockOutlined";
import MoreVert from "@mui/icons-material/MoreVert";
import PaletteOutlined from "@mui/icons-material/PaletteOutlined";
import PhotoSizeSelectSmallOutlined from "@mui/icons-material/PhotoSizeSelectSmallOutlined";
import RefreshOutlined from "@mui/icons-material/RefreshOutlined";
import RemoveCircleOutlineOutlined from "@mui/icons-material/RemoveCircleOutlineOutlined";
import RestartAltOutlined from "@mui/icons-material/RestartAltOutlined";
import RouteOutlined from "@mui/icons-material/RouteOutlined";
import SelectAllOutlined from "@mui/icons-material/SelectAllOutlined";
import ViewQuiltOutlined from "@mui/icons-material/ViewQuiltOutlined";
import VisibilityOffOutlined from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import ZoomInOutlined from "@mui/icons-material/ZoomInOutlined";
import ZoomOutOutlined from "@mui/icons-material/ZoomOutOutlined";
import ManageSearchOutlined from "@mui/icons-material/ManageSearchOutlined";
import { Alert, Box, Chip, CircularProgress, IconButton, Paper, Snackbar, Stack, Tooltip, Typography } from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DIAGRAM_PARAM, FOCUS_PARAM, findInModelHref } from "./diagram/findInDiagrams";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import {
  createDiagramShape,
  DIAGRAM_CARD_Z_INDEX,
  DIAGRAM_SHAPE_DEFAULT_Z_INDEX,
  bringShapeToFront,
  sendShapeToBack,
  restoreDiagramShape,
  DEFAULT_EDGE_STYLE,
  EDGE_STYLES,
  EDGE_STYLE_LABELS,
  SHAPE_NODE_TYPE,
  ShapeNode,
  edgeKeyForPair,
  getEdgeStylePath,
  getLinkBg,
  getLinkColor,
  getLinkCategoryLabel,
  LEGEND_COLLAPSED_LIMIT,
  LINK_CATEGORIES,
  RELATIONSHIP_FALLBACK_COLOR,
  relationshipKindLabel,
  SavedDiagramSyncStatusLabel,
  useSavedDiagramSync,
  type DiagramShape,
  type DiagramShapeKind,
  type ShapeStylePatch,
  type EdgeStyle,
  type ShapeNodeData,
  type SaveDiagramInput,
  type SavedDiagram,
  type SavedDiagramApi,
  type SavedDiagramEdge,
  type SavedDiagramNode,
} from "@/features/cross-model";
import type { ModelItemKind, ModelKind } from "@/shared/constants/ModelConfig";
import { HIERARCHY_LINK_LABEL, type RelationshipLinkCategory } from "@/shared/constants/RelationshipConfig";
import { modelDefinitionsApi } from "../../api/modelDefinitionsApi";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import { useModelWorkspace, type DiagramTypeItem } from "../../contexts/ModelWorkspaceContext";
import { CONNECTION_LINE_STYLE, ConnectHandles, ConnectRuleContext, DiagramConnectStyles, connectTargetSx, useConnectTarget } from "@/shared/workspace/DiagramConnect";
import type {
  BadgeCustomization,
  CrossModelRelationshipTypeSummary,
  CrossModelTypeOption,
  CrossModelTypeOptions,
  HierarchyRuleSummary,
  SupportDomainRelationshipSummary,
} from "../../domain/types";
import { ContextMenu, type MenuEntry } from "./diagram/ContextMenu";
import { DiagramPicker } from "./diagram/DiagramPicker";
import { DiagramToolbar, type InteractionMode } from "./diagram/DiagramToolbar";
import {
  alignBoxes,
  arrangeLayers,
  DEFAULT_LINE_WEIGHT,
  distributeBoxes,
  EMPTY_PRESENTATION,
  forgetPresentation,
  insertBend,
  layeredLayout,
  LINE_COLOURS,
  LINE_WEIGHT_LABEL,
  LINE_WEIGHTS,
  loadPrefs,
  loadPresentation,
  nearestIndex,
  NODE_SIZE_LABEL,
  NODE_SIZES,
  NODE_STYLE_LABEL,
  NODE_STYLES,
  savePrefs,
  savePresentation,
  type AlignMode,
  type ArrangeOp,
  type DiagramPrefs,
  type DiagramPresentation,
  type EdgePresentation,
  type NodePresentation,
  type NodeSize,
  type NodeStyle,
  type Point,
  type Rect,
} from "./diagram/presentation";

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COL_X = 80;
const ELEM_COL_X = 580;
const ROW_START_Y = 60;
const ROW_SPACING = 110;
const FIT_PADDING = 0.2;
const FIT_DURATION = 300;
const FIT_DELAY = 60;
const CANVAS_MIN_HEIGHT = 600;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const GRID_GAP = 16;
const KIND_COLOR = { HIERARCHY_NODE: "#1565C0", SUPPORT_DOMAIN_ELEMENT: "#2E7D32" } as const;

// Relationship colours come from the shared recommended catalogue; a governed
// type named outside that set renders in the fallback colour (black).

// ── Floating edge geometry ────────────────────────────────────────────────────

function getNodeDims(node: InternalNode) {
  return { w: node.measured?.width ?? 1, h: node.measured?.height ?? 1 };
}

function getCenter(node: InternalNode) {
  const { w, h } = getNodeDims(node);
  return {
    x: node.internals.positionAbsolute.x + w / 2,
    y: node.internals.positionAbsolute.y + h / 2,
  };
}

/** Where the line from a node's centre towards a point leaves the node's box. */
function intersectToward(node: InternalNode, toward: Point) {
  const { w, h } = getNodeDims(node);
  const ac = getCenter(node);
  const hw = w / 2, hh = h / 2;
  const dx = (toward.x - ac.x) / (2 * hw);
  const dy = (toward.y - ac.y) / (2 * hh);
  const nh = dx - dy, nv = dx + dy;
  const s = 1 / (Math.abs(nh) + Math.abs(nv) || 1);
  return { x: hw * (s * nh + s * nv) + ac.x, y: hh * (-s * nh + s * nv) + ac.y };
}

function edgeSide(node: InternalNode, pt: { x: number; y: number }): Position {
  const { w, h } = getNodeDims(node);
  const tl = node.internals.positionAbsolute;
  const dl = Math.abs(pt.x - tl.x);
  const dr = Math.abs(pt.x - (tl.x + w));
  const dt = Math.abs(pt.y - tl.y);
  const db = Math.abs(pt.y - (tl.y + h));
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return Position.Left;
  if (m === dr) return Position.Right;
  if (m === dt) return Position.Top;
  return Position.Bottom;
}

function floatingParams(src: InternalNode, tgt: InternalNode) {
  const sp = intersectToward(src, getCenter(tgt));
  const tp = intersectToward(tgt, getCenter(src));
  return {
    sourceX: sp.x, sourceY: sp.y,
    targetX: tp.x, targetY: tp.y,
    sourcePosition: edgeSide(src, sp),
    targetPosition: edgeSide(tgt, tp),
  };
}

// ── Custom edge ───────────────────────────────────────────────────────────────

/** One relationship drawn on (or merged into) an edge. */
export type EdgeRelationship = { id: string; name: string };

interface RelEdgeData extends Record<string, unknown> {
  color: string;
  label: string;
  edgeStyle: EdgeStyle;
  weight: number;
  labelHidden: boolean;
  bends: Point[];
  dimmed: boolean;
  highlighted: boolean;
  /** Which of the three sources this edge came from. */
  category: RelationshipLinkCategory;
  /** The relationship on this line, for the right-click menu. */
  relationships: EdgeRelationship[];
  /** Sideways offset of this line from the straight one, when several join the same two types. */
  curve: number;
  onClick?: (event: ReactMouseEvent) => void;
  onBendsChange: (bends: Point[]) => void;
}

function RelationshipEdge({ id, source, target, markerEnd, data, selected }: EdgeProps & { data?: RelEdgeData }) {
  const srcNode = useInternalNode(source);
  const tgtNode = useInternalNode(target);
  const { screenToFlowPosition } = useReactFlow();
  const { hovered, hover } = useContext(HoveredEdgeContext);
  // A bend being dragged: the points follow the pointer, and are kept on release.
  const [dragBends, setDragBends] = useState<Point[] | null>(null);
  if (!srcNode || !tgtNode || !data) return null;
  const bends = dragBends ?? data.bends;
  // Bend points are editing handles: shown while the line is hovered, selected or being dragged,
  // so they never sit on top of a label otherwise.
  const showBends = bends.length > 0 && (hovered === id || selected || dragBends !== null);

  let path: string;
  let lx: number;
  let ly: number;
  if (bends.length > 0) {
    const start = intersectToward(srcNode, bends[0]);
    const end = intersectToward(tgtNode, bends[bends.length - 1]);
    const points = [start, ...bends, end];
    path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    // The label sits mid-way along a segment, never on a bend point.
    const segment = Math.floor((points.length - 1) / 2);
    lx = (points[segment].x + points[segment + 1].x) / 2;
    ly = (points[segment].y + points[segment + 1].y) / 2;
  } else if (data.curve) {
    // One of several lines between the same two types: a gentle curve to its own side.
    // The side is measured on the pair (not on this line's direction), so A→B and B→A part too.
    const [a, b] = source < target ? [srcNode, tgtNode] : [tgtNode, srcNode];
    const ca = getCenter(a);
    const cb = getCenter(b);
    const length = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const normal = { x: -(cb.y - ca.y) / length, y: (cb.x - ca.x) / length };
    const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
    const control = { x: mid.x + normal.x * data.curve * 2, y: mid.y + normal.y * data.curve * 2 };
    const start = intersectToward(srcNode, control);
    const end = intersectToward(tgtNode, control);
    path = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
    lx = (start.x + 2 * control.x + end.x) / 4;
    ly = (start.y + 2 * control.y + end.y) / 4;
  } else {
    [path, lx, ly] = getEdgeStylePath(data.edgeStyle ?? DEFAULT_EDGE_STYLE, floatingParams(srcNode, tgtNode));
  }

  const color = data.color ?? RELATIONSHIP_FALLBACK_COLOR;
  const label = data.labelHidden ? "" : data.label;
  const clickable = Boolean(data.onClick);
  const emphasised = data.highlighted || selected;

  const startDrag = (index: number) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    let current = [...data.bends];
    const move = (e: PointerEvent) => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      current = current.map((b, i) => (i === index ? p : b));
      setDragBends(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragBends(null);
      data.onBendsChange(current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: color,
          strokeWidth: emphasised ? data.weight + 1.2 : data.weight,
          opacity: data.dimmed ? 0.12 : emphasised ? 1 : 0.85,
          filter: data.highlighted ? `drop-shadow(0 0 3px ${color}88)` : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {label && (
          <Box
            onClick={data.onClick}
            onContextMenu={data.onClick}
            sx={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`,
              fontSize: 10, fontWeight: 700, color,
              bgcolor: "rgba(255,255,255,0.92)",
              px: "5px", py: "1px",
              borderRadius: "4px",
              border: `1px solid ${color}50`,
              pointerEvents: clickable ? "all" : "none",
              cursor: clickable ? "pointer" : "default",
              whiteSpace: "nowrap",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              opacity: data.dimmed ? 0.2 : 1,
              "&:hover": clickable ? { bgcolor: `${color}10`, boxShadow: 2 } : undefined,
            }}
          >
            {label}
          </Box>
        )}
        {showBends && bends.map((b, index) => (
          <Tooltip key={index} title="Drag to move · double-click to remove" placement="top">
            <Box
              className="nodrag nopan"
              onPointerEnter={() => hover(id)}
              onPointerLeave={() => hover(null)}
              onPointerDown={startDrag(index)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                data.onBendsChange(data.bends.filter((_, i) => i !== index));
              }}
              sx={{
                position: "absolute",
                transform: `translate(-50%,-50%) translate(${b.x}px,${b.y}px)`,
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: "#fff",
                border: `2px solid ${color}`,
                cursor: "move",
                pointerEvents: "all",
                opacity: data.dimmed ? 0.2 : 1,
              }}
            />
          </Tooltip>
        ))}
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * A reference line: an allowable relationship the model defines, drawn behind
 * the real ones — grey, dashed, read only and out of the pointer's way — so it
 * explains the diagram without ever being taken for a relationship on it.
 */
function ReferenceEdge({ id, source, target, markerEnd, data }: EdgeProps & { data?: { label: string; curve: number } }) {
  const srcNode = useInternalNode(source);
  const tgtNode = useInternalNode(target);
  if (!srcNode || !tgtNode || !data) return null;
  let path: string;
  let lx: number;
  let ly: number;
  if (data.curve) {
    const [a, b] = source < target ? [srcNode, tgtNode] : [tgtNode, srcNode];
    const ca = getCenter(a);
    const cb = getCenter(b);
    const length = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const normal = { x: -(cb.y - ca.y) / length, y: (cb.x - ca.x) / length };
    const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
    const control = { x: mid.x + normal.x * data.curve * 2, y: mid.y + normal.y * data.curve * 2 };
    const start = intersectToward(srcNode, control);
    const end = intersectToward(tgtNode, control);
    path = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
    lx = (start.x + 2 * control.x + end.x) / 4;
    ly = (start.y + 2 * control.y + end.y) / 4;
  } else {
    [path, lx, ly] = getEdgeStylePath(DEFAULT_EDGE_STYLE, floatingParams(srcNode, tgtNode));
  }
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={0} style={{ stroke: "#B0BEC5", strokeWidth: 1.25, strokeDasharray: "6 5", pointerEvents: "none" }} />
      <EdgeLabelRenderer>
        <Box
          sx={{
            position: "absolute",
            transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`,
            fontSize: 9.5, fontStyle: "italic", color: "#90A4AE",
            bgcolor: "rgba(248,250,252,0.9)", px: "4px", borderRadius: "4px",
            pointerEvents: "none", whiteSpace: "nowrap",
          }}
        >
          {data.label} →
        </Box>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes: EdgeTypes = { rel: RelationshipEdge, ref: ReferenceEdge };

// ── Custom ReactFlow node card ────────────────────────────────────────────────

const HIDDEN_HANDLE = { opacity: 0, width: 6, height: 6, background: "transparent", border: "none" };

type TypeNodeData = {
  label: string;
  kind: ModelItemKind;
  modelName: string;
  badge?: BadgeCustomization;
  size: NodeSize;
  look: NodeStyle;
  locked: boolean;
  labelHidden: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onMenu: (event: ReactMouseEvent) => void;
};

const SIZE_SPEC: Record<NodeSize, { minWidth: number; maxWidth: number; font: number; caption: number; badge: number; py: number }> = {
  small: { minWidth: 120, maxWidth: 160, font: 11, caption: 9, badge: 20, py: 0.5 },
  medium: { minWidth: 160, maxWidth: 230, font: 12, caption: 10, badge: 26, py: 0.75 },
  large: { minWidth: 220, maxWidth: 300, font: 14, caption: 11.5, badge: 34, py: 1.25 },
};

function lookSx(look: NodeStyle, kind: ModelItemKind) {
  const color = KIND_COLOR[kind as keyof typeof KIND_COLOR] ?? "#1565C0";
  const isNode = kind === "HIERARCHY_NODE";
  if (look === "outlined") return { bgcolor: "#fff", border: `2px solid ${color}` };
  if (look === "filled") return { bgcolor: color, border: `1px solid ${color}`, color: "#fff" };
  if (look === "minimal") return { bgcolor: "transparent", border: "1px dashed transparent", boxShadow: "none" };
  return { bgcolor: isNode ? "#EEF6FF" : "#F3FFF3", border: `1px solid ${isNode ? "#1565C040" : "#2E7D3240"}` };
}

function TypeNodeCard({ id, data, selected }: NodeProps & { data: TypeNodeData }) {
  const connect = useConnectTarget(id);
  const spec = SIZE_SPEC[data.size];
  const filled = data.look === "filled";
  return (
    <>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
      <ConnectHandles nodeId={id} />
      <Paper
        variant="outlined"
        onContextMenu={data.onMenu}
        sx={{
          ...connectTargetSx(connect),
          display: "flex", alignItems: "flex-start", gap: 1,
          px: 1.25, py: spec.py, borderRadius: 2,
          ...lookSx(data.look, data.kind),
          minWidth: spec.minWidth, maxWidth: spec.maxWidth,
          cursor: data.locked ? "default" : "grab", userSelect: "none",
          opacity: data.dimmed ? 0.25 : 1,
          outline: selected ? "2px solid #1976D2" : undefined,
          outlineOffset: 2,
          boxShadow: data.highlighted ? "0 0 0 3px rgba(25,118,210,0.35)" : undefined,
          transition: "opacity .15s",
          "&:hover": { boxShadow: data.highlighted ? "0 0 0 3px rgba(25,118,210,0.35)" : 2 },
          "&:hover .pdp-node-menu": { opacity: 1 },
        }}
      >
        <Box sx={{ width: spec.badge, height: spec.badge, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CanonicalBadge badge={data.badge} fallbackText={data.label} fallbackColor="#1976D2" size={spec.badge} />
        </Box>
        <Box flex={1} minWidth={0}>
          <Typography variant="body2" fontWeight={600} sx={{ fontSize: spec.font, whiteSpace: "normal", wordBreak: "break-word", color: filled ? "inherit" : undefined }}>
            {data.label}
          </Typography>
          {!data.labelHidden && data.modelName && (
            <Typography variant="caption" sx={{ fontSize: spec.caption, display: "block", whiteSpace: "normal", wordBreak: "break-word", color: filled ? "rgba(255,255,255,0.85)" : "text.secondary" }}>
              {data.modelName}
            </Typography>
          )}
        </Box>
        <Stack alignItems="center" spacing={0.25} sx={{ mt: "-2px", mr: "-6px" }}>
          <IconButton
            className="nodrag pdp-node-menu"
            size="small"
            aria-label={`Diagram options for ${data.label}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onMenu(event);
            }}
            sx={{ p: 0.25, color: filled ? "rgba(255,255,255,0.9)" : "text.secondary", opacity: selected ? 1 : 0.55 }}
          >
            <MoreVert sx={{ fontSize: 16 }} />
          </IconButton>
          {data.locked && (
            <Tooltip title="Position locked">
              <LockOutlined sx={{ fontSize: 12, color: filled ? "#fff" : "text.disabled" }} />
            </Tooltip>
          )}
        </Stack>
      </Paper>
    </>
  );
}

/** An annotation turned by the Rotate tools; the shared renderer draws it upright. */
function RotatableShapeNode(props: NodeProps & { data: ShapeNodeData & { rotation?: number } }) {
  return (
    <Box sx={{ width: "100%", height: "100%", transform: `rotate(${props.data.rotation ?? 0}deg)`, pointerEvents: "none" }}>
      <ShapeNode {...props} />
    </Box>
  );
}

const nodeTypes: NodeTypes = {
  typeNode: TypeNodeCard as unknown as NodeTypes[string],
  [SHAPE_NODE_TYPE]: RotatableShapeNode as unknown as NodeTypes[string],
};

/** Cards sit on the shared card layer; a shape carries its own stacking order. */
const TYPE_NODE_Z_INDEX = DIAGRAM_CARD_Z_INDEX;

const SAVED_DIAGRAMS_QUERY_KEY = ["cross-model-relationship-type-diagrams"] as const;

const savedDiagramApi: SavedDiagramApi = {
  list: modelDefinitionsApi.listCrossModelRelationshipTypeDiagrams,
  get: modelDefinitionsApi.getCrossModelRelationshipTypeDiagram,
  create: modelDefinitionsApi.createCrossModelRelationshipTypeDiagram,
  update: modelDefinitionsApi.updateCrossModelRelationshipTypeDiagram,
  remove: modelDefinitionsApi.deleteCrossModelRelationshipTypeDiagram,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiagramTypeLink {
  id: string;
  sourceId: string;
  targetId: string;
  name: string;
  category: RelationshipLinkCategory;
}

// ── One line per relationship ─────────────────────────────────────────────────
// Every relationship is drawn as its own line, keyed by its source pair and its
// own id. Diagrams saved when relationships on one pair shared a line keep their
// looks: a line without its own falls back to its pair's (bend points only when
// the pair has a single relationship — several lines cannot share one route).
const REL_KEY_SEP = "::";
function relEdgeKey(link: Pick<DiagramTypeLink, "id" | "category" | "sourceId" | "targetId">) {
  return `${edgeKeyForPair(link.category, link.sourceId, link.targetId)}${REL_KEY_SEP}${link.id}`;
}
function pairKeyOf(key: string) {
  const at = key.indexOf(REL_KEY_SEP);
  return at < 0 ? key : key.slice(0, at);
}
function lookOf(edges: Record<string, EdgePresentation>, key: string, singleOnPair: boolean): EdgePresentation {
  const own = edges[key];
  if (own) return own;
  const pair = edges[pairKeyOf(key)];
  if (!pair) return {};
  if (singleOnPair) return pair;
  const { bends: _bends, ...rest } = pair;
  return rest;
}
function styleOf(styles: Record<string, EdgeStyle>, key: string): EdgeStyle {
  return styles[key] ?? styles[pairKeyOf(key)] ?? DEFAULT_EDGE_STYLE;
}
/** Parallel lines between the same two types fan out this far apart (flow px). */
const PARALLEL_SPACING = 36;

/** Which line is under the pointer — its bend points show only then (or while selected). */
const HoveredEdgeContext = createContext<{ hovered: string | null; hover: (key: string | null) => void }>({ hovered: null, hover: () => undefined });

export type SidebarDragData = {
  kind: ModelItemKind;
  id: string;
  name: string;
  modelName?: string;
};

type Highlight = { kind: "node" | "edge"; id: string } | null;

const NO_MODELS: WorkspaceModel[] = [];

// ── Group frames ──────────────────────────────────────────────────────────────

/** A dashed frame around each group, drawn in canvas space behind the cards. */
function GroupFrames({ groups }: { groups: DiagramPresentation["groups"] }) {
  const nodes = useNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <ViewportPortal>
      {groups.map((group) => {
        const members = group.members.map((id) => byId.get(id)).filter((n): n is Node => Boolean(n && !n.hidden));
        if (members.length < 2) return null;
        const left = Math.min(...members.map((n) => n.position.x)) - 12;
        const top = Math.min(...members.map((n) => n.position.y)) - 12;
        const right = Math.max(...members.map((n) => n.position.x + (n.measured?.width ?? n.width ?? 0))) + 12;
        const bottom = Math.max(...members.map((n) => n.position.y + (n.measured?.height ?? n.height ?? 0))) + 12;
        const active = members.some((n) => n.selected);
        return (
          <Box
            key={group.id}
            sx={{
              position: "absolute",
              transform: `translate(${left}px, ${top}px)`,
              width: right - left,
              height: bottom - top,
              border: "1.5px dashed",
              borderColor: active ? "primary.main" : "#90A4AE",
              borderRadius: 2.5,
              pointerEvents: "none",
              bgcolor: active ? "rgba(25,118,210,0.03)" : "transparent",
            }}
          >
            <Typography sx={{ position: "absolute", top: -9, left: 10, px: 0.5, fontSize: 10, fontWeight: 700, color: active ? "primary.main" : "#78909C", bgcolor: "#F8FAFC" }}>
              Group
            </Typography>
          </Box>
        );
      })}
    </ViewportPortal>
  );
}

// ── Build ReactFlow nodes/edges ───────────────────────────────────────────────

function buildNodes(
  items: DiagramTypeItem[],
  badgeByTypeId: Map<string, BadgeCustomization>,
  presentation: DiagramPresentation,
  focus: { nodes: Set<string> } | null,
  onMenu: (id: string, event: ReactMouseEvent) => void,
): Node[] {
  const nodeItems = items.filter((i) => i.kind === "HIERARCHY_NODE");
  const elemItems = items.filter((i) => i.kind === "SUPPORT_DOMAIN_ELEMENT");
  const toNode = (item: DiagramTypeItem, idx: number, colX: number): Node => {
    const look: NodePresentation = presentation.nodes[item.id] ?? {};
    return {
      id: item.id,
      type: "typeNode" as const,
      zIndex: look.z ?? TYPE_NODE_Z_INDEX,
      hidden: Boolean(look.hidden),
      draggable: !look.locked,
      // Only annotations are removable with the keyboard; a type card leaves via its menu.
      deletable: false,
      // Persisted position wins; otherwise auto-layout into the source/target column.
      position: item.x != null && item.y != null
        ? { x: item.x, y: item.y }
        : { x: colX, y: ROW_START_Y + idx * ROW_SPACING },
      data: {
        label: item.name,
        kind: item.kind,
        modelName: item.modelName ?? "",
        badge: badgeByTypeId.get(item.id),
        size: look.size ?? "medium",
        look: look.style ?? "default",
        locked: Boolean(look.locked),
        labelHidden: Boolean(look.labelHidden),
        dimmed: Boolean(focus && !focus.nodes.has(item.id)),
        highlighted: Boolean(focus?.nodes.has(item.id)),
        onMenu: (event: ReactMouseEvent) => onMenu(item.id, event),
      } satisfies TypeNodeData,
    };
  };
  return [
    ...nodeItems.map((item, idx) => toNode(item, idx, NODE_COL_X)),
    ...elemItems.map((item, idx) => toNode(item, idx, ELEM_COL_X)),
  ];
}

/**
 * Drawn annotations, as ReactFlow nodes. They are not connectable and carry no
 * business data — they only ever move, resize, take text, turn, or go away.
 */
function buildShapeNodes(
  shapes: DiagramShape[],
  rotation: Record<string, number>,
  onTextChange: (id: string, text: string) => void,
  onResizeEnd: (id: string, width: number, height: number, x: number, y: number) => void,
  onRemove: (id: string) => void,
  onStyleChange: (id: string, patch: ShapeStylePatch) => void,
  onBringToFront: (id: string) => void,
  onSendToBack: (id: string) => void,
): Node[] {
  return shapes.map((shape) => ({
    id: shape.id,
    type: SHAPE_NODE_TYPE,
    position: { x: shape.x, y: shape.y },
    width: shape.width,
    height: shape.height,
    zIndex: shape.zIndex ?? DIAGRAM_SHAPE_DEFAULT_Z_INDEX,
    // A frame with a transparent middle must not swallow canvas drags; the
    // renderer re-enables pointer events on its border and text.
    style: { width: shape.width, height: shape.height, pointerEvents: "none" as const },
    data: {
      kind: shape.kind,
      text: shape.text,
      strokeColor: shape.strokeColor,
      textColor: shape.textColor,
      fontSize: shape.fontSize,
      rotation: rotation[shape.id] ?? 0,
      onTextChange: (text: string) => onTextChange(shape.id, text),
      onStyleChange: (patch: ShapeStylePatch) => onStyleChange(shape.id, patch),
      onBringToFront: () => onBringToFront(shape.id),
      onSendToBack: () => onSendToBack(shape.id),
      onResizeEnd: (width: number, height: number, x: number, y: number) =>
        onResizeEnd(shape.id, width, height, x, y),
      onRemove: () => onRemove(shape.id),
    } as ShapeNodeData,
  }));
}

function buildEdges(
  links: DiagramTypeLink[],
  canvasIds: Set<string>,
  hiddenIds: Set<string>,
  edgeStyles: Record<string, EdgeStyle>,
  presentation: DiagramPresentation,
  focus: { nodes: Set<string>; edges: Set<string> } | null,
  onLabelClick: (edgeKey: string, category: RelationshipLinkCategory, relationships: EdgeRelationship[], event: ReactMouseEvent) => void,
  onBendsChange: (edgeKey: string, bends: Point[]) => void,
  referenceLinks: DiagramTypeLink[] = [],
): Edge[] {
  // Every relationship is its own line. Lines joining the same two types — any
  // source, either direction — fan out side by side so each keeps its own label.
  const drawn = links.filter(
    (link) => canvasIds.has(link.sourceId) && canvasIds.has(link.targetId) && link.sourceId !== link.targetId,
  );
  const byPair = new Map<string, number>();
  const byNodes = new Map<string, DiagramTypeLink[]>();
  for (const link of drawn) {
    const pair = edgeKeyForPair(link.category, link.sourceId, link.targetId);
    byPair.set(pair, (byPair.get(pair) ?? 0) + 1);
    const nodesKey = [link.sourceId, link.targetId].sort().join("|");
    byNodes.set(nodesKey, [...(byNodes.get(nodesKey) ?? []), link]);
  }
  const curveOf = new Map<string, number>();
  for (const group of byNodes.values()) {
    const ordered = [...group].sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
    ordered.forEach((link, index) => curveOf.set(relEdgeKey(link), (index - (ordered.length - 1) / 2) * PARALLEL_SPACING));
  }

  const edges: Edge[] = [];
  for (const link of drawn) {
    const key = relEdgeKey(link);
    const relationships: EdgeRelationship[] = [{ id: link.id, name: link.name }];
    const single = (byPair.get(edgeKeyForPair(link.category, link.sourceId, link.targetId)) ?? 0) === 1;
    const look: EdgePresentation = lookOf(presentation.edges, key, single);
    const color = look.color ?? getLinkColor(link.category, link.name);
    edges.push({
      id: key,
      source: link.sourceId,
      target: link.targetId,
      type: "rel",
      hidden: hiddenIds.has(link.sourceId) || hiddenIds.has(link.targetId),
      zIndex: focus?.edges.has(key) ? 1 : 0,
      data: {
        color,
        label: link.name,
        edgeStyle: styleOf(edgeStyles, key),
        weight: look.weight ?? DEFAULT_LINE_WEIGHT,
        labelHidden: Boolean(look.labelHidden),
        bends: look.bends ?? [],
        dimmed: Boolean(focus && !focus.edges.has(key)),
        highlighted: Boolean(focus?.edges.has(key)),
        category: link.category,
        relationships,
        curve: curveOf.get(key) ?? 0,
        onClick: (event: ReactMouseEvent) => onLabelClick(key, link.category, relationships, event),
        onBendsChange: (bends: Point[]) => onBendsChange(key, bends),
      } satisfies RelEdgeData,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    });
  }
  // Reference lines: behind everything, never selected, fanned out on their own.
  const refDrawn = referenceLinks.filter(
    (link) => canvasIds.has(link.sourceId) && canvasIds.has(link.targetId) && link.sourceId !== link.targetId,
  );
  const refByNodes = new Map<string, DiagramTypeLink[]>();
  for (const link of refDrawn) {
    const nodesKey = [link.sourceId, link.targetId].sort().join("|");
    refByNodes.set(nodesKey, [...(refByNodes.get(nodesKey) ?? []), link]);
  }
  for (const group of refByNodes.values()) {
    const realOnPair = byNodes.get([group[0].sourceId, group[0].targetId].sort().join("|"))?.length ?? 0;
    group.forEach((link, index) => {
      // Clear of any real lines on the same pair, which fan out around the middle.
      const offset = (realOnPair > 0 ? (realOnPair + 1) / 2 : 0) + index - (realOnPair > 0 ? 0 : (group.length - 1) / 2);
      edges.push({
        id: `ref:${link.id}:${link.sourceId}>${link.targetId}`,
        source: link.sourceId,
        target: link.targetId,
        type: "ref",
        hidden: hiddenIds.has(link.sourceId) || hiddenIds.has(link.targetId),
        selectable: false,
        focusable: false,
        deletable: false,
        zIndex: -1,
        data: { label: link.name, curve: offset * PARALLEL_SPACING },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#B0BEC5", width: 12, height: 12 },
      });
    });
  }
  return edges;
}

// ── Inner diagram (inside ReactFlowProvider) ──────────────────────────────────

type MenuState = { top: number; left: number; flow: Point };

export function GovernanceTypesDiagramInner({
  items,
  links,
  shapes,
  badgeByTypeId,
  presentation,
  setPresentation,
  prefs,
  setPrefs,
  onRemove,
  onDrop,
  onEdit,
  onSelectItem,
  onNodesMoved,
  onResetLayout,
  onRefresh,
  positionsRef,
  edgeStyles,
  onEdgeStylesChange,
  onShapeAdd,
  onShapeMoved,
  onShapeResized,
  onShapeTextChange,
  onShapeRemove,
  onShapeStyleChange,
  onShapeLayers,
  canConnect,
  onConnectTypes,
  onFindInModel,
  focusRequest,
  referenceLinks,
  relationshipMenu,
  emptyText,
}: {
  items: DiagramTypeItem[];
  links: DiagramTypeLink[];
  shapes: DiagramShape[];
  badgeByTypeId: Map<string, BadgeCustomization>;
  presentation: DiagramPresentation;
  setPresentation: (update: (previous: DiagramPresentation) => DiagramPresentation) => void;
  prefs: DiagramPrefs;
  setPrefs: (update: (previous: DiagramPrefs) => DiagramPrefs) => void;
  onRemove: (id: string) => void;
  onDrop: (data: SidebarDragData[]) => void;
  onEdit?: (id: string) => void;
  onSelectItem?: (id: string) => void;
  onNodesMoved: (positions: Record<string, Point>) => void;
  onResetLayout: () => void;
  onRefresh: () => void;
  positionsRef: MutableRefObject<(() => Record<string, { x: number; y: number }>) | null>;
  edgeStyles: Record<string, EdgeStyle>;
  onEdgeStylesChange: (styles: Record<string, EdgeStyle>) => void;
  onShapeAdd: (kind: DiagramShapeKind, x: number, y: number) => void;
  onShapeMoved: (id: string, x: number, y: number) => void;
  onShapeResized: (id: string, width: number, height: number, x: number, y: number) => void;
  onShapeTextChange: (id: string, text: string) => void;
  onShapeRemove: (id: string) => void;
  onShapeStyleChange: (id: string, patch: ShapeStylePatch) => void;
  onShapeLayers: (layers: Record<string, number>) => void;
  /** Which type may be dragged onto which. */
  canConnect?: (fromId: string, toId: string) => boolean;
  /** A relationship was dragged from one type to another. */
  onConnectTypes?: (fromId: string, toId: string) => void;
  /** Find in Model: open the type in its own model, selected. */
  onFindInModel?: (id: string) => void;
  /** Select, highlight and centre this type (Find in Diagram). A new object each time. */
  focusRequest?: { id: string } | null;
  /** Read-only background lines (SWS: the allowable type relationships behind the instances). */
  referenceLinks?: DiagramTypeLink[];
  /** The relationship's own actions at the top of its menu, in place of the Model Workspace's. */
  relationshipMenu?: (category: RelationshipLinkCategory, relationships: EdgeRelationship[]) => MenuEntry[];
  /** What an empty canvas says. */
  emptyText?: string;
}) {
  const { fitView, zoomIn, zoomOut, zoomTo, getNodes, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const flowDom = useStore((state) => state.domNode);
  const [mode, setMode] = useState<InteractionMode>("pan");
  // The armed annotation tool, if any: the next canvas click places one of these.
  const [pendingShape, setPendingShape] = useState<DiagramShapeKind | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(null);
  // The line under the pointer. Leaving waits a moment, so the pointer can travel to a bend point.
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverEdge = useCallback((key: string | null) => {
    window.clearTimeout(hoverTimer.current);
    if (key) setHoveredEdge(key);
    else hoverTimer.current = window.setTimeout(() => setHoveredEdge(null), 450);
  }, []);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const hoverContext = useMemo(() => ({ hovered: hoveredEdge, hover: hoverEdge }), [hoveredEdge, hoverEdge]);
  const [edgeMenu, setEdgeMenu] = useState<(MenuState & { edgeId: string; category: RelationshipLinkCategory; relationships: EdgeRelationship[] }) | null>(null);
  const [nodeMenu, setNodeMenu] = useState<(MenuState & { id: string }) | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<MenuState | null>(null);

  const menuAt = useCallback((event: ReactMouseEvent | MouseEvent): MenuState => ({
    top: event.clientY,
    left: event.clientX,
    flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
  }), [screenToFlowPosition]);

  // Either click on a connection — line or label — opens its actions.
  const openEdgeMenu = useCallback((edgeKey: string, category: RelationshipLinkCategory, relationships: EdgeRelationship[], event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setEdgeMenu({ ...menuAt(event), edgeId: edgeKey, category, relationships });
  }, [menuAt]);

  const openNodeMenu = useCallback((id: string, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setNodeMenu({ ...menuAt(event), id });
  }, [menuAt]);

  // How many relationships share each source pair — decides whether a line may borrow its pair's bend points.
  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of links) {
      if (link.sourceId === link.targetId) continue;
      const pair = edgeKeyForPair(link.category, link.sourceId, link.targetId);
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    return counts;
  }, [links]);
  const edgeLook = useCallback(
    (edgesLook: Record<string, EdgePresentation>, key: string) => lookOf(edgesLook, key, (pairCounts.get(pairKeyOf(key)) ?? 0) <= 1),
    [pairCounts],
  );
  const updateEdgeLook = useCallback((keys: string[], patch: (look: EdgePresentation) => EdgePresentation) => {
    setPresentation((p) => ({ ...p, edges: { ...p.edges, ...Object.fromEntries(keys.map((key) => [key, patch(edgeLook(p.edges, key))])) } }));
  }, [setPresentation, edgeLook]);
  const updateNodeLook = useCallback((ids: string[], patch: (look: NodePresentation) => NodePresentation) => {
    setPresentation((p) => ({ ...p, nodes: { ...p.nodes, ...Object.fromEntries(ids.map((id) => [id, patch(p.nodes[id] ?? {})])) } }));
  }, [setPresentation]);
  const setBends = useCallback((key: string, bends: Point[]) => updateEdgeLook([key], (look) => ({ ...look, bends })), [updateEdgeLook]);

  const canvasIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const hiddenIds = useMemo(() => new Set(items.filter((i) => presentation.nodes[i.id]?.hidden).map((i) => i.id)), [items, presentation.nodes]);

  // The pairs of every edge the canvas draws — needed for Highlight connected.
  const edgeEnds = useMemo(() => {
    const map = new Map<string, { source: string; target: string }>();
    for (const link of links) {
      if (!canvasIds.has(link.sourceId) || !canvasIds.has(link.targetId) || link.sourceId === link.targetId) continue;
      map.set(relEdgeKey(link), { source: link.sourceId, target: link.targetId });
    }
    return map;
  }, [links, canvasIds]);

  const focus = useMemo(() => {
    if (!highlight) return null;
    const nodes = new Set<string>();
    const edges = new Set<string>();
    if (highlight.kind === "node") {
      nodes.add(highlight.id);
      for (const [key, ends] of edgeEnds) {
        if (ends.source !== highlight.id && ends.target !== highlight.id) continue;
        edges.add(key);
        nodes.add(ends.source);
        nodes.add(ends.target);
      }
    } else {
      const ends = edgeEnds.get(highlight.id);
      if (!ends) return null;
      edges.add(highlight.id);
      nodes.add(ends.source);
      nodes.add(ends.target);
    }
    return { nodes, edges };
  }, [highlight, edgeEnds]);

  const shapeNodes = useMemo(
    () => buildShapeNodes(shapes, presentation.shapeRotation, onShapeTextChange, onShapeResized, onShapeRemove, onShapeStyleChange,
      (id) => onShapeLayers(Object.fromEntries(bringShapeToFront(shapes, id).filter((s) => s.id === id).map((s) => [s.id, s.zIndex ?? 0]))),
      (id) => onShapeLayers(Object.fromEntries(sendShapeToBack(shapes, id).map((s) => [s.id, s.zIndex ?? 0])))),
    [shapes, presentation.shapeRotation, onShapeTextChange, onShapeResized, onShapeRemove, onShapeStyleChange, onShapeLayers],
  );

  const initialNodes = useMemo(() => [...shapeNodes, ...buildNodes(items, badgeByTypeId, presentation, focus, openNodeMenu)], []);
  const initialEdges = useMemo(() => buildEdges(links, canvasIds, hiddenIds, edgeStyles, presentation, focus, openEdgeMenu, setBends, referenceLinks), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Expose current live node positions so the parent can capture them when saving.
  useEffect(() => {
    positionsRef.current = () =>
      Object.fromEntries(getNodes().map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    return () => { positionsRef.current = null; };
  }, [getNodes, positionsRef]);

  // Rebuild edges when links, visible items, line styles or their look change.
  useEffect(() => {
    setEdges((previous) => {
      const wasSelected = new Set(previous.filter((e) => e.selected).map((e) => e.id));
      return buildEdges(links, canvasIds, hiddenIds, edgeStyles, presentation, focus, openEdgeMenu, setBends, referenceLinks)
        .map((edge) => (wasSelected.has(edge.id) ? { ...edge, selected: true } : edge));
    });
  }, [links, canvasIds, hiddenIds, edgeStyles, presentation, focus, openEdgeMenu, setBends, setEdges, referenceLinks]);

  // What the last rebuild put each node at. A rebuild triggered by something
  // other than a real move — a re-render while auto-save runs, say — must not
  // yank a node back to its stored position out from under an in-flight drag.
  const builtPositions = useRef(new Map<string, { x: number; y: number }>());

  // Positions are driven by the items themselves (persisted on drag / cleared on reset layout).
  // The updater stays pure — React may run it twice — so what was built last
  // time is read before it, not inside it.
  useEffect(() => {
    const lastBuilt = builtPositions.current;
    const built = [...shapeNodes, ...buildNodes(items, badgeByTypeId, presentation, focus, openNodeMenu)];
    builtPositions.current = new Map(built.map((node) => [node.id, node.position]));
    setNodes((previous) => {
      const onScreen = new Map(previous.map((node) => [node.id, node]));
      return built.map((node) => {
        const before = lastBuilt.get(node.id);
        const live = onScreen.get(node.id);
        const moved = !before || before.x !== node.position.x || before.y !== node.position.y;
        return {
          ...node,
          position: moved || !live ? node.position : live.position,
          selected: !node.hidden && (live?.selected ?? node.selected),
        };
      });
    });
  }, [items, setNodes, badgeByTypeId, shapeNodes, presentation, focus, openNodeMenu]);

  const shapeIds = useMemo(() => new Set(shapes.map((s) => s.id)), [shapes]);
  const groups = presentation.groups;
  const groupOf = useMemo(() => {
    const map = new Map<string, DiagramPresentation["groups"][number]>();
    for (const group of groups) for (const id of group.members) map.set(id, group);
    return map;
  }, [groups]);

  const commitPositions = useCallback((positions: Record<string, Point>) => {
    const cards: Record<string, Point> = {};
    for (const [id, p] of Object.entries(positions)) {
      if (shapeIds.has(id)) onShapeMoved(id, p.x, p.y);
      else cards[id] = p;
    }
    if (Object.keys(cards).length) onNodesMoved(cards);
  }, [onNodesMoved, onShapeMoved, shapeIds]);

  const onNodeDragStop = useCallback((_: unknown, node: Node, draggedNodes: Node[]) => {
    // ReactFlow drags every selected node but reports one; persist them all, or
    // the rest snap back the moment the canvas rebuilds from state.
    const moved = draggedNodes?.length ? draggedNodes : [node];
    commitPositions(Object.fromEntries(moved.map((n) => [n.id, { x: n.position.x, y: n.position.y }])));
  }, [commitPositions]);

  // Placing an annotation: arm a tool, then click where it goes. Esc disarms.
  const handlePaneClick = useCallback((event: ReactMouseEvent) => {
    if (!pendingShape) {
      setHighlight(null);
      return;
    }
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onShapeAdd(pendingShape, point.x, point.y);
    setPendingShape(null);
  }, [pendingShape, onShapeAdd, screenToFlowPosition]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPendingShape(null);
      setHighlight(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Selection-based tools ───────────────────────────────────────────────────
  const selected = nodes.filter((n) => n.selected && !n.hidden);
  const selectedIds = selected.map((n) => n.id);
  const selectedShapeIds = selectedIds.filter((id) => shapeIds.has(id));
  const isLocked = (id: string) => Boolean(presentation.nodes[id]?.locked);

  const rectOf = (n: Node): Rect => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? n.width ?? 0,
    height: n.measured?.height ?? n.height ?? 0,
  });

  const moveTo = (positions: Record<string, Point>) => {
    const movable = Object.fromEntries(Object.entries(positions).filter(([id]) => !isLocked(id)));
    setNodes((ns) => ns.map((n) => (movable[n.id] ? { ...n, position: movable[n.id] } : n)));
    commitPositions(movable);
  };

  const align = (alignMode: AlignMode) => moveTo(alignBoxes(selected.map(rectOf), alignMode));
  const distribute = (axis: "horizontal" | "vertical") => moveTo(distributeBoxes(selected.map(rectOf), axis));

  const arrange = (ids: string[], op: ArrangeOp) => {
    if (ids.length === 0) return;
    const layers: Record<string, number> = {};
    for (const s of shapes) layers[s.id] = s.zIndex ?? DIAGRAM_SHAPE_DEFAULT_Z_INDEX;
    for (const item of items) layers[item.id] = presentation.nodes[item.id]?.z ?? TYPE_NODE_Z_INDEX;
    const changed = arrangeLayers(layers, ids, op);
    const shapeChanges = Object.fromEntries(Object.entries(changed).filter(([id]) => shapeIds.has(id)));
    const cardChanges = Object.entries(changed).filter(([id]) => !shapeIds.has(id));
    if (Object.keys(shapeChanges).length) onShapeLayers(shapeChanges);
    if (cardChanges.length) {
      setPresentation((p) => ({
        ...p,
        nodes: { ...p.nodes, ...Object.fromEntries(cardChanges.map(([id, z]) => [id, { ...(p.nodes[id] ?? {}), z }])) },
      }));
    }
  };

  const rotate = (degrees: number) => {
    setPresentation((p) => ({
      ...p,
      shapeRotation: {
        ...p.shapeRotation,
        ...Object.fromEntries(selectedShapeIds.map((id) => [id, (((p.shapeRotation[id] ?? 0) + degrees) % 360 + 360) % 360])),
      },
    }));
  };

  const selectIds = (ids: Set<string>) => setNodes((ns) => ns.map((n) => ({ ...n, selected: ids.has(n.id) && !n.hidden })));

  // Find in Diagram: bring the type back if it was hidden, then select, highlight and centre it.
  useEffect(() => {
    if (!focusRequest) return;
    const id = focusRequest.id;
    if (presentation.nodes[id]?.hidden) updateNodeLook([id], (look) => ({ ...look, hidden: false }));
    setHighlight({ kind: "node", id });
    // A diagram just opened is still being laid out (and a fresh canvas fits
    // everything once on arrival): wait until the card has a size and that has
    // settled, centre it, then check — and centre again if it was moved.
    let tries = 0;
    let timer = 0;
    const centred = () => {
      const node = getNodes().find((n) => n.id === id);
      const box = flowDom?.getBoundingClientRect();
      if (!node?.measured?.width || !box) return true;
      const at = flowToScreenPosition({ x: node.position.x + node.measured.width / 2, y: node.position.y + (node.measured.height ?? 0) / 2 });
      return Math.abs(at.x - (box.left + box.width / 2)) < box.width * 0.15 && Math.abs(at.y - (box.top + box.height / 2)) < box.height * 0.15;
    };
    const centre = (animate: boolean) => void fitView({ nodes: [{ id }], padding: 1.2, duration: animate ? FIT_DURATION : 0, maxZoom: 1.4 });
    const attempt = () => {
      tries += 1;
      const node = getNodes().find((n) => n.id === id);
      if (!node?.measured?.width && tries < 30) {
        timer = window.setTimeout(attempt, 100);
        return;
      }
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
      centre(true);
      // A canvas that has just opened may still fit everything once after this;
      // check a few times and centre again — unless the person has started to move it.
      let checks = 0;
      const verify = () => {
        if (touched) return;
        checks += 1;
        if (!centred()) centre(false);
        if (checks === 1) {
          // The canvas can sit partly below the fold of its panel: bring the card into view.
          flowDom?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        }
        if (checks < 4) timer = window.setTimeout(verify, 700);
      };
      timer = window.setTimeout(verify, FIT_DURATION + 400);
    };
    let touched = false;
    const stop = () => {
      touched = true;
    };
    flowDom?.addEventListener("pointerdown", stop);
    flowDom?.addEventListener("wheel", stop, { passive: true });
    timer = window.setTimeout(attempt, 250);
    return () => {
      window.clearTimeout(timer);
      flowDom?.removeEventListener("pointerdown", stop);
      flowDom?.removeEventListener("wheel", stop);
    };
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const sameAsGroup = groups.some((g) => g.members.length === selectedIds.length && selectedIds.every((id) => g.members.includes(id)));
  const canGroup = selectedIds.length >= 2 && !sameAsGroup;
  const canUngroup = selectedIds.some((id) => groupOf.has(id));
  const canRegroup = presentation.ungrouped.some((set) => set.filter((id) => canvasIds.has(id) || shapeIds.has(id)).length > 1);

  const group = () => {
    const members = [...selectedIds];
    setPresentation((p) => ({
      ...p,
      groups: [
        ...p.groups.map((g) => ({ ...g, members: g.members.filter((id) => !members.includes(id)) })).filter((g) => g.members.length > 1),
        { id: `group-${Date.now()}`, members },
      ],
    }));
  };
  const ungroup = () => {
    const taken = groups.filter((g) => g.members.some((id) => selectedIds.includes(id)));
    setPresentation((p) => ({
      ...p,
      groups: p.groups.filter((g) => !taken.some((t) => t.id === g.id)),
      ungrouped: [...p.ungrouped, ...taken.map((g) => g.members)].slice(-10),
    }));
  };
  const regroup = () => {
    const last = [...presentation.ungrouped].reverse().find((set) => set.filter((id) => canvasIds.has(id) || shapeIds.has(id)).length > 1);
    if (!last) return;
    const members = last.filter((id) => canvasIds.has(id) || shapeIds.has(id));
    setPresentation((p) => ({
      ...p,
      groups: [
        ...p.groups.map((g) => ({ ...g, members: g.members.filter((id) => !members.includes(id)) })).filter((g) => g.members.length > 1),
        { id: `group-${Date.now()}`, members },
      ],
      ungrouped: p.ungrouped.filter((set) => set !== last),
    }));
    selectIds(new Set(members));
  };

  const fit = useCallback(() => void fitView({ padding: FIT_PADDING, duration: FIT_DURATION }), [fitView]);

  const autoLayout = () => {
    const visible = items.filter((i) => !hiddenIds.has(i.id)).map((i) => i.id);
    const positions = layeredLayout(visible, links);
    setPresentation((p) => ({ ...p, edges: Object.fromEntries(Object.entries(p.edges).map(([key, look]) => [key, { ...look, bends: [] }])) }));
    onNodesMoved(positions);
    setTimeout(fit, FIT_DELAY);
  };
  const resetLayout = () => {
    setPresentation((p) => ({ ...p, edges: Object.fromEntries(Object.entries(p.edges).map(([key, look]) => [key, { ...look, bends: [] }])) }));
    onResetLayout();
    setTimeout(fit, FIT_DELAY);
  };

  // A node's line actions apply to every connection it has.
  const edgesOf = (id: string) => [...edgeEnds].filter(([, ends]) => ends.source === id || ends.target === id).map(([key]) => key);

  const lineStyleEntries = (keys: string[], current?: EdgeStyle): MenuEntry[] =>
    EDGE_STYLES.map((style) => ({
      kind: "item",
      key: style,
      label: EDGE_STYLE_LABELS[style],
      checked: current === style,
      onClick: () => {
        onEdgeStylesChange(Object.fromEntries(keys.map((key) => [key, style])));
        // A routed line is a polyline; picking a shape means following that shape.
        updateEdgeLook(keys, (look) => ({ ...look, bends: [] }));
      },
    }));
  const colourEntries = (keys: string[], current?: string): MenuEntry[] => [
    { kind: "swatches", key: "swatches", options: LINE_COLOURS, current, onPick: (value) => updateEdgeLook(keys, (look) => ({ ...look, color: value })) },
    { kind: "item", key: "default", label: "Relationship colour (default)", checked: !current, onClick: () => updateEdgeLook(keys, (look) => ({ ...look, color: undefined })) },
  ];
  const weightEntries = (keys: string[], current?: number): MenuEntry[] =>
    LINE_WEIGHTS.map((weight) => ({
      kind: "item",
      key: String(weight),
      label: LINE_WEIGHT_LABEL[weight],
      checked: (current ?? DEFAULT_LINE_WEIGHT) === weight,
      onClick: () => updateEdgeLook(keys, (look) => ({ ...look, weight })),
    }));

  // ── Node menu ──
  const nodeMenuItems = (id: string): MenuEntry[] => {
    const look = presentation.nodes[id] ?? {};
    const keys = edgesOf(id);
    const firstEdge = keys[0] ? edgeLook(presentation.edges, keys[0]) : undefined;
    const noLines = keys.length === 0;
    return [
      ...(onFindInModel
        ? ([
            { kind: "item", key: "find-model", label: "Find in Model", icon: <ManageSearchOutlined />, onClick: () => onFindInModel(id) },
            { kind: "divider", key: "d-find" },
          ] as MenuEntry[])
        : []),
      { kind: "item", key: "focus", label: "Focus node", icon: <CenterFocusStrongOutlined />, onClick: () => {
        selectIds(new Set([id]));
        void fitView({ nodes: [{ id }], padding: 1.2, duration: FIT_DURATION, maxZoom: 1.4 });
      } },
      { kind: "item", key: "highlight", label: "Highlight connected", icon: <HubOutlined />, checked: highlight?.kind === "node" && highlight.id === id, onClick: () => setHighlight(highlight?.kind === "node" && highlight.id === id ? null : { kind: "node", id }) },
      { kind: "sub", key: "size", label: "Resize node", icon: <PhotoSizeSelectSmallOutlined />, items: NODE_SIZES.map((size) => ({ kind: "item", key: size, label: NODE_SIZE_LABEL[size], checked: (look.size ?? "medium") === size, onClick: () => updateNodeLook([id], (l) => ({ ...l, size })) })) },
      { kind: "divider", key: "d1" },
      { kind: "sub", key: "style", label: "Change node style", icon: <FormatPaintOutlined />, items: NODE_STYLES.map((style) => ({ kind: "item", key: style, label: NODE_STYLE_LABEL[style], checked: (look.style ?? "default") === style, onClick: () => updateNodeLook([id], (l) => ({ ...l, style })) })) },
      { kind: "sub", key: "line", label: "Change line style", icon: <LineStyleOutlined />, disabled: noLines, items: lineStyleEntries(keys, keys.length ? styleOf(edgeStyles, keys[0]) : undefined) },
      { kind: "sub", key: "colour", label: "Change line colour", icon: <PaletteOutlined />, disabled: noLines, items: colourEntries(keys, firstEdge?.color) },
      { kind: "sub", key: "weight", label: "Change line weight", icon: <LineWeightOutlined />, disabled: noLines, items: weightEntries(keys, firstEdge?.weight) },
      { kind: "divider", key: "d2" },
      { kind: "item", key: "label", label: look.labelHidden ? "Show label" : "Hide label", icon: look.labelHidden ? <LabelOutlined /> : <LabelOffOutlined />, onClick: () => updateNodeLook([id], (l) => ({ ...l, labelHidden: !l.labelHidden })) },
      { kind: "divider", key: "d3" },
      { kind: "item", key: "front", label: "Bring to front", icon: <FlipToFrontOutlined />, onClick: () => arrange([id], "front") },
      { kind: "item", key: "back", label: "Send to back", icon: <FlipToBackOutlined />, onClick: () => arrange([id], "back") },
      { kind: "divider", key: "d4" },
      { kind: "item", key: "lock", label: look.locked ? "Unlock position" : "Lock position", icon: look.locked ? <LockOpenOutlined /> : <LockOutlined />, onClick: () => updateNodeLook([id], (l) => ({ ...l, locked: !l.locked })) },
      { kind: "item", key: "hide", label: "Hide from diagram", icon: <VisibilityOffOutlined />, onClick: () => {
        updateNodeLook([id], (l) => ({ ...l, hidden: true }));
        if (highlight?.id === id) setHighlight(null);
      } },
      { kind: "item", key: "remove", label: "Remove from diagram", icon: <RemoveCircleOutlineOutlined />, danger: true, onClick: () => onRemove(id) },
    ];
  };

  // ── Relationship menu ──
  const edgeMenuItems = (menu: NonNullable<typeof edgeMenu>): MenuEntry[] => {
    const key = menu.edgeId;
    const look = edgeLook(presentation.edges, key);
    const bends = look.bends ?? [];
    const relationshipItems: MenuEntry[] = relationshipMenu
      ? relationshipMenu(menu.category, menu.relationships)
      : menu.category === "CROSS_MODEL" && onEdit
      ? menu.relationships.map((rel) => ({ kind: "item", key: `edit-${rel.id}`, label: `Edit ${rel.name}`, icon: <EditOutlined />, onClick: () => onEdit(rel.id) }))
      : [{ kind: "header", key: "where", label: menu.category === "HIERARCHY" ? "Edited in Model › Hierarchy" : "Edited in Model › Support Domain" }];
    return [
      ...relationshipItems,
      { kind: "divider", key: "d0" },
      { kind: "item", key: "highlight", label: "Highlight path", icon: <RouteOutlined />, checked: highlight?.kind === "edge" && highlight.id === key, onClick: () => setHighlight(highlight?.kind === "edge" && highlight.id === key ? null : { kind: "edge", id: key }) },
      { kind: "sub", key: "line", label: "Change line style", icon: <LineStyleOutlined />, items: lineStyleEntries([key], bends.length ? undefined : styleOf(edgeStyles, key)) },
      { kind: "sub", key: "colour", label: "Change line colour", icon: <PaletteOutlined />, items: colourEntries([key], look.color) },
      { kind: "sub", key: "weight", label: "Change line weight", icon: <LineWeightOutlined />, items: weightEntries([key], look.weight) },
      { kind: "divider", key: "d1" },
      { kind: "item", key: "add-bend", label: "Add bend point here", icon: <ControlPointOutlined />, onClick: () => {
        const ends = edgeEnds.get(key);
        const nodeById = new Map(getNodes().map((n) => [n.id, n]));
        const centre = (id?: string) => {
          const n = id ? nodeById.get(id) : undefined;
          return n ? { x: n.position.x + (n.measured?.width ?? 0) / 2, y: n.position.y + (n.measured?.height ?? 0) / 2 } : menu.flow;
        };
        const points = [centre(ends?.source), ...bends, centre(ends?.target)];
        const at = insertBend(points, menu.flow);
        setBends(key, [...bends.slice(0, at), menu.flow, ...bends.slice(at)]);
      } },
      { kind: "item", key: "del-bend", label: "Delete bend point", icon: <RemoveCircleOutlineOutlined />, disabled: bends.length === 0, onClick: () => {
        const at = nearestIndex(bends, menu.flow);
        setBends(key, bends.filter((_, i) => i !== at));
      } },
      { kind: "item", key: "reset-bends", label: "Reset bend points", icon: <RestartAltOutlined />, disabled: bends.length === 0, onClick: () => setBends(key, []) },
      { kind: "divider", key: "d2" },
      { kind: "item", key: "label", label: look.labelHidden ? "Show label" : "Hide label", icon: look.labelHidden ? <LabelOutlined /> : <LabelOffOutlined />, onClick: () => updateEdgeLook([key], (l) => ({ ...l, labelHidden: !l.labelHidden })) },
      { kind: "divider", key: "d3" },
      { kind: "item", key: "reset", label: "Reset relationship style", icon: <RestartAltOutlined />, onClick: () => {
        setPresentation((p) => {
          const next = { ...p.edges };
          delete next[key];
          return { ...p, edges: next };
        });
        onEdgeStylesChange({ [key]: DEFAULT_EDGE_STYLE });
      } },
    ];
  };

  // ── Canvas menu ──
  const canvasMenuItems = (): MenuEntry[] => [
    { kind: "item", key: "all", label: "Select all", icon: <SelectAllOutlined />, onClick: () => {
      setMode("select");
      selectIds(new Set(nodes.filter((n) => !n.hidden).map((n) => n.id)));
    } },
    { kind: "divider", key: "d1" },
    { kind: "item", key: "fit", label: "Fit to view", icon: <CropFreeOutlined />, onClick: fit },
    { kind: "item", key: "in", label: "Zoom in", icon: <ZoomInOutlined />, onClick: () => void zoomIn({ duration: FIT_DURATION }) },
    { kind: "item", key: "out", label: "Zoom out", icon: <ZoomOutOutlined />, onClick: () => void zoomOut({ duration: FIT_DURATION }) },
    { kind: "divider", key: "d2" },
    { kind: "item", key: "grid", label: "Show grid", icon: <GridOnOutlined />, checked: prefs.grid, onClick: () => setPrefs((p) => ({ ...p, grid: !p.grid })) },
    { kind: "item", key: "snap", label: "Snap to grid", icon: <GridGoldenratioOutlined />, checked: prefs.snap, onClick: () => setPrefs((p) => ({ ...p, snap: !p.snap })) },
    { kind: "divider", key: "d3" },
    { kind: "item", key: "auto", label: "Auto layout", icon: <AutoFixHighOutlined />, onClick: autoLayout },
    { kind: "item", key: "reset", label: "Reset layout", icon: <ViewQuiltOutlined />, onClick: resetLayout },
    { kind: "divider", key: "d4" },
    { kind: "item", key: "legend", label: "Show legend", icon: <LegendToggleOutlined />, checked: prefs.legend, onClick: () => setPrefs((p) => ({ ...p, legend: !p.legend })) },
    ...(hiddenIds.size > 0
      ? [{ kind: "item", key: "unhide", label: `Show hidden nodes (${hiddenIds.size})`, icon: <VisibilityOutlined />, onClick: () => updateNodeLook([...hiddenIds], (l) => ({ ...l, hidden: false })) } satisfies MenuEntry]
      : []),
    { kind: "item", key: "refresh", label: "Refresh diagram", icon: <RefreshOutlined />, onClick: onRefresh },
  ];

  const highlightLabel = highlight
    ? highlight.kind === "node"
      ? items.find((i) => i.id === highlight.id)?.name ?? "node"
      : "relationship path"
    : null;

  return (
    <Box display="flex" flexDirection="column" flex={1} minHeight={0} gap={1}>
      <DiagramToolbar
        mode={mode}
        onMode={setMode}
        zoomPercent={Math.round(zoom * 100)}
        onZoomIn={() => void zoomIn({ duration: FIT_DURATION })}
        onZoomOut={() => void zoomOut({ duration: FIT_DURATION })}
        onZoomReset={() => void zoomTo(1, { duration: FIT_DURATION })}
        onFit={fit}
        grid={prefs.grid}
        snap={prefs.snap}
        onToggleGrid={() => setPrefs((p) => ({ ...p, grid: !p.grid }))}
        onToggleSnap={() => setPrefs((p) => ({ ...p, snap: !p.snap }))}
        selectedCount={selectedIds.length}
        selectedShapeCount={selectedShapeIds.length}
        onAlign={align}
        onDistribute={distribute}
        onArrange={(op) => arrange(selectedIds, op)}
        onRotate={rotate}
        canGroup={canGroup}
        canUngroup={canUngroup}
        canRegroup={canRegroup}
        onGroup={group}
        onUngroup={ungroup}
        onRegroup={regroup}
        onAutoLayout={autoLayout}
        pendingShape={pendingShape}
        onPendingShape={setPendingShape}
      />

      {/* Canvas */}
      <Box
        flex={1}
        // The class wins over ReactFlow's own pane/node cursors (see shapeNode.css).
        className={pendingShape ? "pdp-shape-placing" : undefined}
        sx={{
          minHeight: CANVAS_MIN_HEIGHT, borderRadius: 2, overflow: "hidden",
          border: "1px solid", borderColor: "divider",
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const raw = e.dataTransfer.getData("application/pdp-diagram");
          if (!raw) return;
          try {
            const data = JSON.parse(raw) as SidebarDragData | SidebarDragData[];
            onDrop(Array.isArray(data) ? data : [data]);
          } catch { /* ignore bad drag data */ }
        }}
      >
        <ConnectRuleContext.Provider value={canConnect ?? null}>
        <HoveredEdgeContext.Provider value={hoverContext}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onEdgeMouseEnter={(_event, edge) => hoverEdge(edge.id)}
          onEdgeMouseLeave={() => hoverEdge(null)}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            setCanvasMenu(menuAt(event));
          }}
          onSelectionContextMenu={(event) => {
            event.preventDefault();
            setCanvasMenu(menuAt(event));
          }}
          onNodeContextMenu={(event, node) => {
            if (shapeIds.has(node.id)) return;
            openNodeMenu(node.id, event);
          }}
          onNodeClick={(event, node) => {
            // A grouped object brings its whole group along.
            const g = groupOf.get(node.id);
            if (g) {
              const additive = event.shiftKey || event.metaKey || event.ctrlKey;
              setNodes((ns) => ns.map((n) => ({ ...n, selected: g.members.includes(n.id) || (additive && Boolean(n.selected)) })));
            }
            if (!shapeIds.has(node.id)) onSelectItem?.(node.id);
          }}
          onNodesDelete={(deleted) => deleted.forEach((node) => {
            if (shapeIds.has(node.id)) onShapeRemove(node.id);
          })}
          deleteKeyCode={["Delete", "Backspace"]}
          onEdgeClick={(event, edge) => {
            if (edge.type === "ref") return;
            const data = edge.data as RelEdgeData | undefined;
            openEdgeMenu(edge.id, data?.category ?? "CROSS_MODEL", data?.relationships ?? [], event);
          }}
          onEdgeContextMenu={(event, edge) => {
            if (edge.type === "ref") return;
            const data = edge.data as RelEdgeData | undefined;
            openEdgeMenu(edge.id, data?.category ?? "CROSS_MODEL", data?.relationships ?? [], event);
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          panOnDrag={mode === "pan"}
          selectionOnDrag={mode === "select"}
          snapToGrid={prefs.snap}
          snapGrid={[GRID_GAP, GRID_GAP]}
          nodesDraggable
          nodesFocusable
          nodesConnectable={Boolean(onConnectTypes)}
          onConnect={(connection) => {
            if (!connection.source || !connection.target || connection.source === connection.target) return;
            if (canConnect && !canConnect(connection.source, connection.target)) return;
            onConnectTypes?.(connection.source, connection.target);
          }}
          connectionLineStyle={CONNECTION_LINE_STYLE}
          // Selection must not change stacking: ReactFlow otherwise lifts the
          // selected node 1000 above everything, hiding what "send to back" did.
          elevateNodesOnSelect={false}
          zoomOnScroll
          fitView
          fitViewOptions={{ padding: FIT_PADDING }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          style={{ background: "#F8FAFC" }}
        >
          {prefs.grid && <Background gap={GRID_GAP} size={1} color="#d5dbe1" />}
          <GroupFrames groups={groups} />

          {(highlightLabel || hiddenIds.size > 0) && (
            <Panel position="top-left">
              <Stack direction="row" spacing={0.75}>
                {highlightLabel && (
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`Highlighting: ${highlightLabel}`}
                    onDelete={() => setHighlight(null)}
                    deleteIcon={<CloseIcon />}
                    sx={{ bgcolor: "#fff", fontSize: 11 }}
                  />
                )}
                {hiddenIds.size > 0 && (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<VisibilityOffOutlined sx={{ fontSize: 14 }} />}
                    label={`${hiddenIds.size} hidden — show`}
                    onClick={() => updateNodeLook([...hiddenIds], (l) => ({ ...l, hidden: false }))}
                    sx={{ bgcolor: "#fff", fontSize: 11 }}
                  />
                )}
              </Stack>
            </Panel>
          )}

          {items.length === 0 && shapes.length === 0 && (
            <Box sx={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              flexDirection: "column", gap: 1, pointerEvents: "none", zIndex: 1,
            }}>
              <Typography variant="body2" color="text.disabled" textAlign="center" maxWidth={340}>
                {emptyText ?? "Drag hierarchy node types and SD element types from the left panel onto this canvas. Hierarchy, support domain and between-model relationships between them will be drawn automatically."}
              </Typography>
            </Box>
          )}
        </ReactFlow>
        </HoveredEdgeContext.Provider>
        </ConnectRuleContext.Provider>
        <DiagramConnectStyles />
      </Box>

      <ContextMenu
        position={nodeMenu}
        title={nodeMenu ? items.find((i) => i.id === nodeMenu.id)?.name : undefined}
        items={nodeMenu ? nodeMenuItems(nodeMenu.id) : []}
        onClose={() => setNodeMenu(null)}
      />
      <ContextMenu
        position={edgeMenu}
        title={edgeMenu ? [...new Set(edgeMenu.relationships.map((r) => r.name))].join(", ") || "Relationship" : undefined}
        items={edgeMenu ? edgeMenuItems(edgeMenu) : []}
        onClose={() => setEdgeMenu(null)}
      />
      <ContextMenu position={canvasMenu} items={canvasMenu ? canvasMenuItems() : []} onClose={() => setCanvasMenu(null)} />
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function GovernanceTypesDiagramView({
  crossModelRelationships,
  hierarchyRuleRelationships,
  supportDomainRelationships,
  typeOptions,
  onEdit,
  onSelectItem,
  onCreateForPair,
  onRefresh,
  loading,
  selectionSlot,
  models = NO_MODELS,
}: {
  selectionSlot?: SelectionSlot;
  /** Every model with its status, for the selection panel's filters and icons. */
  models?: WorkspaceModel[];
  crossModelRelationships: CrossModelRelationshipTypeSummary[];
  /** Every hierarchy model's structural rules — the parent → child links. */
  hierarchyRuleRelationships: HierarchyRuleSummary[];
  /** Every support domain model's element-type relationships. */
  supportDomainRelationships: SupportDomainRelationshipSummary[];
  typeOptions: CrossModelTypeOptions;
  onEdit?: (id: string) => void;
  /** A type card on the canvas was clicked: its node type or element type id. */
  onSelectItem?: (id: string) => void;
  /**
   * A relationship was dragged from one type card to another: open the
   * Relationship Editor for that pair (kinds and type ids).
   */
  onCreateForPair?: (sourceKind: string, sourceTypeId: string, targetKind: string, targetTypeId: string) => void;
  /** Reload the governed relationships behind the diagram. */
  onRefresh?: () => void;
  loading?: boolean;
}) {
  const {
    diagramCanvasItems: canvasItems,
    setDiagramCanvasItems,
    diagramEdgeStyles: edgeStyles,
    setDiagramEdgeStyles,
    diagramShapes: shapes,
    setDiagramShapes,
    currentDiagramId,
    setCurrentDiagramId,
    currentDiagramName,
    setCurrentDiagramName,
  } = useModelWorkspace();
  const queryClient = useQueryClient();
  // Three sources on one canvas gets busy; each can be switched off while reading.
  const [hiddenCategories, setHiddenCategories] = useState<Set<RelationshipLinkCategory>>(new Set());
  const [showAllLegend, setShowAllLegend] = useState(false);
  // Bridge to read the live canvas node positions (set by the inner ReactFlow component).
  const positionsRef = useRef<(() => Record<string, { x: number; y: number }>) | null>(null);

  // How this diagram looks (sizes, colours, groups, …) — kept per diagram in this
  // browser — and the canvas preferences shared by every diagram.
  const [presentation, setPresentationState] = useState<DiagramPresentation>(() =>
    currentDiagramId ? loadPresentation(currentDiagramId, shapes) : EMPTY_PRESENTATION,
  );
  const setPresentation = useCallback((update: (previous: DiagramPresentation) => DiagramPresentation) => setPresentationState(update), []);
  const [prefs, setPrefsState] = useState<DiagramPrefs>(loadPrefs);
  const setPrefs = useCallback((update: (previous: DiagramPrefs) => DiagramPrefs) => setPrefsState(update), []);
  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => {
    if (currentDiagramId) savePresentation(currentDiagramId, presentation, shapes);
  }, [currentDiagramId, presentation, shapes]);

  // Drag-to-create: in MWS every type is a valid target — a relationship may
  // link two types of one model or of different models.
  const typeById = useMemo(
    () => new Map([...typeOptions.nodeTypes, ...typeOptions.elementTypes].map((type) => [type.id, type])),
    [typeOptions],
  );
  const canConnectTypes = useCallback(
    (fromId: string, toId: string) => {
      const from = typeById.get(fromId);
      const to = typeById.get(toId);
      return Boolean(from && to);
    },
    [typeById],
  );
  const connectTypes = useCallback(
    (fromId: string, toId: string) => {
      const from = typeById.get(fromId);
      const to = typeById.get(toId);
      if (from && to) onCreateForPair?.(from.kind, from.id, to.kind, to.id);
    },
    [typeById, onCreateForPair],
  );
  // Handlers below run before the sync hook is set up; reach its callback through a ref.
  const markSyncedRef = useRef<(() => void) | null>(null);

  const allTypes = useMemo<CrossModelTypeOption[]>(
    () => [...typeOptions.nodeTypes, ...typeOptions.elementTypes],
    [typeOptions.nodeTypes, typeOptions.elementTypes],
  );

  const badgeByTypeId = useMemo(() => {
    const map = new Map<string, BadgeCustomization>();
    for (const type of allTypes) {
      if (type.badge) map.set(type.id, type.badge);
    }
    return map;
  }, [allTypes]);

  const canvasIds = useMemo(() => new Set(canvasItems.map((i) => i.id)), [canvasItems]);

  // The diagram is shared: governed cross-model types, the hierarchy rules already
  // set up between node types, and the support domain models' own element
  // relationships all draw onto the same canvas.
  const allLinks = useMemo<DiagramTypeLink[]>(() => [
    ...crossModelRelationships
      .filter((t) => t.sourceModelItemTypeId && t.targetModelItemTypeId)
      .map((t) => ({
        id: t.id,
        sourceId: t.sourceModelItemTypeId as string,
        targetId: t.targetModelItemTypeId as string,
        name: t.name,
        category: "CROSS_MODEL" as const,
      })),
    ...hierarchyRuleRelationships.map((rule) => ({
      id: rule.id,
      sourceId: rule.parentNodeId,
      targetId: rule.childNodeId,
      name: HIERARCHY_LINK_LABEL,
      category: "HIERARCHY" as const,
    })),
    ...supportDomainRelationships.map((rel) => ({
      id: rel.id,
      sourceId: rel.sourceElementId,
      targetId: rel.targetElementId,
      name: relationshipKindLabel(rel.relationshipKind),
      category: "SUPPORT_DOMAIN" as const,
    })),
  ], [crossModelRelationships, hierarchyRuleRelationships, supportDomainRelationships]);

  // Links the canvas can actually draw, whatever the source filter says. Self-links
  // (a recursive hierarchy rule, a type governed against itself) are dropped here
  // as well as in buildEdges, so the counts match what is on screen.
  const canvasLinks = useMemo(
    () => allLinks.filter(
      (l) => l.sourceId !== l.targetId && canvasIds.has(l.sourceId) && canvasIds.has(l.targetId),
    ),
    [allLinks, canvasIds],
  );

  const visibleLinks = useMemo(
    () => canvasLinks.filter((l) => !hiddenCategories.has(l.category)),
    [canvasLinks, hiddenCategories],
  );

  // Legend entries are derived from what's drawn, not a fixed list — the Model
  // workspace can name a type anything, and unknown names render black.
  const legendTypes = useMemo(() => {
    const seen = new Map<string, { name: string; category: RelationshipLinkCategory }>();
    for (const link of visibleLinks) {
      if (!link.name) continue;
      const key = `${link.category}|${link.name}`;
      if (!seen.has(key)) seen.set(key, { name: link.name, category: link.category });
    }
    return [...seen.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, category }) => ({
        key: `${category}|${name}`,
        name,
        // Two sources can name a relationship the same way, so each chip says
        // which one it came from on hover.
        source: getLinkCategoryLabel(category),
        color: getLinkColor(category, name),
        bg: getLinkBg(category, name),
      }));
  }, [visibleLinks]);

  const nodeCount = canvasItems.filter((i) => i.kind === "HIERARCHY_NODE").length;
  const elemCount = canvasItems.filter((i) => i.kind === "SUPPORT_DOMAIN_ELEMENT").length;

  function toDragData(type: CrossModelTypeOption): SidebarDragData {
    return {
      kind: type.kind === "HIERARCHY_MODEL" ? "HIERARCHY_NODE" : "SUPPORT_DOMAIN_ELEMENT",
      id: type.id,
      name: type.name,
      modelName: type.modelName,
    };
  }

  function handleDrop(data: SidebarDragData[]) {
    setDiagramCanvasItems((prev) => {
      const present = new Set(prev.map((i) => i.id));
      const added = data.filter((d) => !present.has(d.id) && present.add(d.id));
      return added.length === 0 ? prev : [...prev, ...added.map((d) => ({ id: d.id, name: d.name, modelName: d.modelName, kind: d.kind }))];
    });
    // A type put back on the diagram shows again even if it was hidden before.
    setPresentation((p) => {
      const ids = data.map((d) => d.id).filter((id) => p.nodes[id]?.hidden);
      if (ids.length === 0) return p;
      return { ...p, nodes: { ...p.nodes, ...Object.fromEntries(ids.map((id) => [id, { ...p.nodes[id], hidden: false }])) } };
    });
  }

  function handleAddTypes(types: CrossModelTypeOption[]) {
    handleDrop(types.map(toDragData));
  }

  function handleRemoveTypes(types: CrossModelTypeOption[]) {
    const ids = new Set(types.map((t) => t.id));
    setDiagramCanvasItems((prev) => prev.filter((i) => !ids.has(i.id)));
  }

  // A type renamed (or moved) since it was put on the canvas shows its current name.
  useEffect(() => {
    const byId = new Map(allTypes.map((t) => [t.id, t]));
    setDiagramCanvasItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        const type = byId.get(item.id);
        if (!type || (type.name === item.name && type.modelName === item.modelName)) return item;
        changed = true;
        return { ...item, name: type.name, modelName: type.modelName };
      });
      return changed ? next : prev;
    });
  }, [allTypes, setDiagramCanvasItems]);

  // Stable identity: this feeds the canvas rebuild effect, which must not run
  // just because the view re-rendered (auto-save status, a refreshed list, …).
  const handleRemove = useCallback((id: string) => {
    setDiagramCanvasItems((prev) => prev.filter((i) => i.id !== id));
  }, [setDiagramCanvasItems]);

  const handleNodesMoved = useCallback((positions: Record<string, Point>) => {
    setDiagramCanvasItems((prev) => prev.map((i) => (positions[i.id] ? { ...i, x: positions[i.id].x, y: positions[i.id].y } : i)));
  }, [setDiagramCanvasItems]);

  const handleResetLayout = useCallback(() => {
    setDiagramCanvasItems((prev) => prev.map((i) => ({ ...i, x: undefined, y: undefined })));
  }, [setDiagramCanvasItems]);

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["cross-model-type-options"] });
    void queryClient.invalidateQueries({ queryKey: ["all-hierarchy-rules"] });
    void queryClient.invalidateQueries({ queryKey: ["all-support-domain-relationships"] });
    void queryClient.invalidateQueries({ queryKey: SAVED_DIAGRAMS_QUERY_KEY });
    onRefresh?.();
  }, [queryClient, onRefresh]);

  function toggleCategory(category: RelationshipLinkCategory) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  // ── Drawn annotations ───────────────────────────────────────────────────────
  // They live beside the canvas items in workspace state, so leaving the tab and
  // coming back keeps them; they reach the database with the diagram.

  const handleShapeAdd = useCallback((kind: DiagramShapeKind, x: number, y: number) => {
    setDiagramShapes((prev) => [...prev, createDiagramShape(kind, x, y)]);
  }, [setDiagramShapes]);

  const handleShapeMoved = useCallback((id: string, x: number, y: number) => {
    setDiagramShapes((prev) => prev.map((shape) => (shape.id === id ? { ...shape, x, y } : shape)));
  }, [setDiagramShapes]);

  const handleShapeResized = useCallback((id: string, width: number, height: number, x: number, y: number) => {
    setDiagramShapes((prev) => prev.map((shape) => (
      shape.id === id ? { ...shape, width, height, x, y } : shape
    )));
  }, [setDiagramShapes]);

  const handleShapeTextChange = useCallback((id: string, text: string) => {
    setDiagramShapes((prev) => prev.map((shape) => (shape.id === id ? { ...shape, text } : shape)));
  }, [setDiagramShapes]);

  const handleShapeRemove = useCallback((id: string) => {
    setDiagramShapes((prev) => prev.filter((shape) => shape.id !== id));
  }, [setDiagramShapes]);

  const handleShapeStyleChange = useCallback((id: string, patch: ShapeStylePatch) => {
    setDiagramShapes((prev) => prev.map((shape) => (shape.id === id ? { ...shape, ...patch } : shape)));
  }, [setDiagramShapes]);

  const handleShapeLayers = useCallback((layers: Record<string, number>) => {
    setDiagramShapes((prev) => prev.map((shape) => (shape.id in layers ? { ...shape, zIndex: layers[shape.id] } : shape)));
  }, [setDiagramShapes]);

  const handleEdgeStylesChange = useCallback((styles: Record<string, EdgeStyle>) => {
    setDiagramEdgeStyles((prev) => ({ ...prev, ...styles }));
  }, [setDiagramEdgeStyles]);

  function getSaveShapes() {
    return shapes.map(({ id: _id, ...shape }) => shape);
  }

  function getSaveNodes(): SavedDiagramNode[] {
    const livePositions = positionsRef.current?.() ?? {};
    return canvasItems.map((item) => {
      const pos = livePositions[item.id];
      return {
        itemId: item.id,
        itemKind: item.kind,
        posX: pos?.x ?? item.x ?? 0,
        posY: pos?.y ?? item.y ?? 0,
      };
    });
  }

  function getSaveEdges(): SavedDiagramEdge[] {
    // Edge keys mirror buildEdges' per-source source→target grouping, so several
    // relationships on the same pair collapse to one row. Persist every edge the
    // canvas can draw — including ones a category filter is currently hiding, and
    // including the default style — so a saved diagram fully describes how it renders.
    const canvasEdgeKeys = new Set(canvasLinks.map((l) => relEdgeKey(l)));
    return [...canvasEdgeKeys].map((edgeKey) => ({
      edgeKey,
      edgeStyle: styleOf(edgeStyles, edgeKey),
    }));
  }

  function buildSaveInput(name: string): SaveDiagramInput {
    return { name, nodes: getSaveNodes(), edges: getSaveEdges(), shapes: getSaveShapes() };
  }

  function handleLoadDiagram(diagram: SavedDiagram) {
    const typeById = new Map(allTypes.map((t) => [t.id, t]));
    // Only restore nodes whose types still exist; drop any that were deleted since saving.
    // The kind is derived from the resolved type, not the stored item_kind.
    const restored: DiagramTypeItem[] = diagram.nodes.flatMap((node) => {
      const type = typeById.get(node.itemId);
      if (!type) return [];
      return [{
        id: type.id,
        name: type.name,
        modelName: type.modelName,
        kind: type.kind === ("HIERARCHY_MODEL" as ModelKind) ? "HIERARCHY_NODE" : "SUPPORT_DOMAIN_ELEMENT",
        x: node.posX,
        y: node.posY,
      }];
    });
    const restoredShapes = diagram.shapes.map(restoreDiagramShape);
    setDiagramCanvasItems(restored);
    setDiagramEdgeStyles(Object.fromEntries(diagram.edges.map((e) => [e.edgeKey, e.edgeStyle])));
    setDiagramShapes(restoredShapes);
    setPresentationState(loadPresentation(diagram.id, restoredShapes));
    setCurrentDiagramId(diagram.id);
    setCurrentDiagramName(diagram.name);
    markSyncedRef.current?.();
  }

  function handleClearCanvas() {
    setDiagramCanvasItems([]);
    setDiagramEdgeStyles({});
    setDiagramShapes([]);
    setPresentationState(EMPTY_PRESENTATION);
    setCurrentDiagramId(null);
    setCurrentDiagramName(null);
    markSyncedRef.current?.();
  }

  function handleSaved(diagram: SavedDiagram) {
    setCurrentDiagramId(diagram.id);
    setCurrentDiagramName(diagram.name);
  }

  function handleDuplicated(diagram: SavedDiagram) {
    // The copy starts with the same look, then opens.
    savePresentation(diagram.id, presentation, shapes);
    handleLoadDiagram(diagram);
  }

  function handleDeleted(id: string) {
    forgetPresentation(id);
    // Deleting the open diagram empties the canvas too, so auto-save doesn't
    // immediately recreate its contents under a new "Untitled diagram".
    if (id === currentDiagramId) handleClearCanvas();
  }

  // Opens the most recently updated diagram on arrival and writes every later
  // change back on its own.
  const { status: syncStatus, markSynced } = useSavedDiagramSync({
    api: savedDiagramApi,
    queryKey: SAVED_DIAGRAMS_QUERY_KEY,
    currentDiagramId,
    currentDiagramName,
    getSaveNodes,
    getSaveEdges,
    getSaveShapes,
    onOpened: handleLoadDiagram,
    onSaved: handleSaved,
    // The palette resolves what a saved diagram's node ids refer to; opening one
    // before it has loaded would drop every item as "no longer exists".
    enabled: !loading && allTypes.length > 0,
  });

  markSyncedRef.current = markSynced;

  // ── Find in Diagram / Find in Model ─────────────────────────────────────────
  // An address carrying ?diagram=…&focus=… opens that diagram and centres the type;
  // both parameters are removed once handled.
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const diagramParam = searchParams.get(DIAGRAM_PARAM);
  const focusParam = searchParams.get(FOCUS_PARAM);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const [findNotice, setFindNotice] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const clearFindParams = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(DIAGRAM_PARAM);
      next.delete(FOCUS_PARAM);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  useEffect(() => {
    if (!diagramParam && !focusParam) return;
    // Wait for the types, and for the diagram opened on arrival, so neither replaces this one.
    if (loading || allTypes.length === 0 || syncStatus === "opening") return;
    if (diagramParam && diagramParam !== currentDiagramId) {
      if (openingRef.current === diagramParam) return;
      openingRef.current = diagramParam;
      savedDiagramApi
        .get(diagramParam)
        .then((diagram) => handleLoadDiagram(diagram))
        .catch(() => {
          setFindNotice("That diagram could not be opened — it may have been deleted.");
          clearFindParams();
        })
        .finally(() => {
          openingRef.current = null;
        });
      return;
    }
    if (focusParam) {
      if (canvasItems.some((item) => item.id === focusParam)) setFocusRequest({ id: focusParam });
      else {
        const name = allTypes.find((t) => t.id === focusParam)?.name ?? "That type";
        setFindNotice(`${name} is no longer on this diagram.`);
      }
    }
    clearFindParams();
  }, [diagramParam, focusParam, loading, allTypes.length, syncStatus, currentDiagramId, canvasItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const findInModel = (id: string) => {
    const type = allTypes.find((t) => t.id === id);
    if (!type) return;
    navigate(findInModelHref(type.kind === "SUPPORT_DOMAIN_MODEL" ? "support" : "hierarchy", type.modelId, id));
  };

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box display="flex" flex={1} minHeight={0} width="100%">
      {/* No gap between the two: each carries its own border, so the space
          between them was only costing the diagram width. */}
      {renderSelection(selectionSlot, (
        <TypeSelectionPanel
          mode="diagram"
          models={models}
          types={allTypes}
          onCanvas={canvasIds}
          onAdd={handleAddTypes}
          onRemove={handleRemoveTypes}
          onDragStart={(types, event) => {
            event.dataTransfer.setData("application/pdp-diagram", JSON.stringify(types.map(toDragData)));
            event.dataTransfer.effectAllowed = "copy";
          }}
        />
      ), 360)}

      {/* ── Right: diagram ─────────────────────────────────────────────────── */}
      <Box display="flex" flexDirection="column" flex={1} minHeight={0} minWidth={0} gap={1}>
        {/* Diagram management */}
        <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} flexShrink={0}>
          <DiagramPicker
            api={savedDiagramApi}
            queryKey={SAVED_DIAGRAMS_QUERY_KEY}
            currentDiagramId={currentDiagramId}
            currentDiagramName={currentDiagramName}
            buildInput={buildSaveInput}
            canvasItemCount={canvasItems.length}
            onLoad={handleLoadDiagram}
            onNew={handleClearCanvas}
            onSaved={handleSaved}
            onDuplicated={(_from, diagram) => handleDuplicated(diagram)}
            onDeleted={handleDeleted}
            status={<SavedDiagramSyncStatusLabel status={syncStatus} />}
          />
          {canvasItems.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {nodeCount} node type{nodeCount !== 1 ? "s" : ""},{" "}
              {elemCount} element type{elemCount !== 1 ? "s" : ""},{" "}
              {visibleLinks.length} relationship{visibleLinks.length !== 1 ? "s" : ""}
            </Typography>
          )}
        </Box>

        {/* Source filter — three sources on one canvas, each switchable while reading. */}
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" rowGap={0.5} flexShrink={0}>
          <Typography variant="caption" color="text.secondary" mr={0.5}>
            Show:
          </Typography>
          {LINK_CATEGORIES.map((category) => {
            const shown = !hiddenCategories.has(category.key);
            const count = canvasLinks.filter((l) => l.category === category.key).length;
            const color = category.color ?? RELATIONSHIP_FALLBACK_COLOR;
            return (
              <Chip
                key={category.key}
                size="small"
                label={`${category.label} (${count})`}
                onClick={() => toggleCategory(category.key)}
                variant={shown ? "filled" : "outlined"}
                sx={{
                  fontSize: 10, height: 20, fontWeight: 600, cursor: "pointer",
                  bgcolor: shown ? `${color}18` : "transparent",
                  color: shown ? color : "text.disabled",
                  borderColor: shown ? `${color}55` : "divider",
                  borderStyle: "solid", borderWidth: 1,
                }}
              />
            );
          })}
        </Stack>

        {/* Legend — the types actually drawn, since the catalogue is open-ended.
            A busy canvas can name dozens, so it folds after the first few. */}
        {prefs.legend && legendTypes.length > 0 && (
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" rowGap={0.5} flexShrink={0}>
            <Typography variant="caption" color="text.secondary" mr={0.5}>
              Legends:
            </Typography>
            {(showAllLegend ? legendTypes : legendTypes.slice(0, LEGEND_COLLAPSED_LIMIT)).map((rt) => (
              <Tooltip key={rt.key} title={`${rt.source} relationship`} arrow placement="top">
                <Chip label={rt.name} size="small"
                  sx={{ fontSize: 10, height: 20, bgcolor: rt.bg, color: rt.color, fontWeight: 600 }}
                />
              </Tooltip>
            ))}
            {legendTypes.length > LEGEND_COLLAPSED_LIMIT && (
              <Chip
                size="small"
                variant="outlined"
                label={showAllLegend ? "Show less" : `Show all (${legendTypes.length})`}
                onClick={() => setShowAllLegend((prev) => !prev)}
                sx={{
                  fontSize: 10, height: 20, fontWeight: 600, cursor: "pointer",
                  color: "text.secondary", borderColor: "divider",
                }}
              />
            )}
          </Stack>
        )}

        <ReactFlowProvider>
          <GovernanceTypesDiagramInner
            items={canvasItems}
            links={visibleLinks}
            shapes={shapes}
            badgeByTypeId={badgeByTypeId}
            presentation={presentation}
            setPresentation={setPresentation}
            prefs={prefs}
            setPrefs={setPrefs}
            onRemove={handleRemove}
            onDrop={handleDrop}
            onEdit={onEdit}
            onSelectItem={onSelectItem}
            onNodesMoved={handleNodesMoved}
            onResetLayout={handleResetLayout}
            onRefresh={handleRefresh}
            positionsRef={positionsRef}
            edgeStyles={edgeStyles}
            onEdgeStylesChange={handleEdgeStylesChange}
            onShapeAdd={handleShapeAdd}
            onShapeMoved={handleShapeMoved}
            onShapeResized={handleShapeResized}
            onShapeTextChange={handleShapeTextChange}
            onShapeRemove={handleShapeRemove}
            onShapeStyleChange={handleShapeStyleChange}
            onShapeLayers={handleShapeLayers}
            canConnect={canConnectTypes}
            onConnectTypes={onCreateForPair ? connectTypes : undefined}
            onFindInModel={findInModel}
            focusRequest={focusRequest}
          />
        </ReactFlowProvider>
        <Snackbar open={Boolean(findNotice)} autoHideDuration={6000} onClose={() => setFindNotice(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
          <Alert severity="info" variant="filled" onClose={() => setFindNotice(null)}>
            {findNotice}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}
