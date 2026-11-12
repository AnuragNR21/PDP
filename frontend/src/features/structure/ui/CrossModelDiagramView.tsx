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
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useInternalNode,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CloseIcon from "@mui/icons-material/Close";
import NearMeOutlinedIcon from "@mui/icons-material/NearMeOutlined";
import PanToolOutlinedIcon from "@mui/icons-material/PanToolOutlined";
import ZoomInOutlinedIcon from "@mui/icons-material/ZoomInOutlined";
import ZoomOutOutlinedIcon from "@mui/icons-material/ZoomOutOutlined";
import CropFreeOutlinedIcon from "@mui/icons-material/CropFreeOutlined";
import CheckBoxOutlineBlankOutlinedIcon from "@mui/icons-material/CheckBoxOutlineBlankOutlined";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import TextFieldsOutlinedIcon from "@mui/icons-material/TextFields";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from "react";
import {
  useActiveCrossModelRelationshipTypes,
  useAllCrossModelLinks,
  useAllSupportDomainRelationships,
  useCrossModelSelectionModels,
} from "@/features/structure/state/useStructureWorkspace";
import { CONNECTION_LINE_STYLE, ConnectHandles, ConnectRuleContext, DiagramConnectStyles, connectTargetSx, useConnectTarget } from "@/shared/workspace/DiagramConnect";
import type { LinkEnd } from "./workspace/CrossModelLinkDialog";
import {
  bringShapeToFront,
  createDiagramShape,
  DIAGRAM_CARD_Z_INDEX,
  DIAGRAM_SHAPE_DEFAULT_Z_INDEX,
  sendShapeToBack,
  CROSS_MODEL_SELECTION_LEVEL,
  CrossModelSelectionPanel,
  DEFAULT_EDGE_STYLE,
  DIAGRAM_SHAPE_LABELS,
  restoreDiagramShape,
  SHAPE_NODE_TYPE,
  ShapeNode,
  edgeKeyForPair,
  EdgeContextMenu,
  getEdgeStylePath,
  getLinkBg,
  getLinkCategoryLabel,
  getLinkColor,
  LEGEND_COLLAPSED_LIMIT,
  LINK_CATEGORIES,
  RELATIONSHIP_FALLBACK_COLOR,
  relationshipKindLabel,
  SavedDiagramsBar,
  SavedDiagramSyncStatusLabel,
  useSavedDiagramSync,
  type CrossModelSelectableItem,
  type CrossModelSelectableStatus,
  type DiagramShape,
  type DiagramShapeKind,
  type EdgeStyle,
  type ShapeNodeData,
  type ShapeStylePatch,
  type SavedDiagram,
  type SavedDiagramApi,
  type SavedDiagramEdge,
  type SavedDiagramNode,
} from "@/features/cross-model";
import type { BadgeCustomization } from "@/features/model/domain/types";
import type { ModelItemKind, ModelKind } from "@/shared/constants/ModelConfig";
import { HIERARCHY_LINK_LABEL, type RelationshipLinkCategory } from "@/shared/constants/RelationshipConfig";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import { structureApi } from "@/features/structure/api/structureApi";
import { useStructureWorkspace, type DiagramItem } from "../contexts/StructureWorkspaceContext";

const SAVED_DIAGRAMS_QUERY_KEY = ["cross-model-instance-diagrams"] as const;

const savedDiagramApi: SavedDiagramApi = {
  list: structureApi.listCrossModelInstanceDiagrams,
  get: structureApi.getCrossModelInstanceDiagram,
  create: structureApi.createCrossModelInstanceDiagram,
  update: structureApi.updateCrossModelInstanceDiagram,
  remove: structureApi.deleteCrossModelInstanceDiagram,
};

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COL_X = 80;
const ELEM_COL_X = 580;
const ROW_START_Y = 60;
const ROW_SPACING = 110;
const FIT_PADDING = 0.2;
const FIT_DURATION = 300;
const FIT_DELAY = 60;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;


function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function modelAbbreviation(name: string): string {
  const parts = slugPart(name).split("_").filter(Boolean);
  if (parts.length === 0) return "model";
  if (parts.length === 1) return parts[0].slice(0, 2) || "model";
  return parts.slice(0, 2).map((part) => part[0]).join("");
}

function formatHierarchyNodeSublabel(modelName: string | undefined, nodeName: string, fallbackId: string): string {
  if (!modelName) return fallbackId;
  const suffix = slugPart(nodeName);
  if (!suffix) return fallbackId;
  return `ni_${modelAbbreviation(modelName)}_${suffix}`;
}

// ── Badge color ───────────────────────────────────────────────────────────────

// ── Floating edge geometry ────────────────────────────────────────────────────

function getNodeDims(node: InternalNode) {
  return {
    w: node.measured?.width ?? 1,
    h: node.measured?.height ?? 1,
  };
}

function getCenter(node: InternalNode) {
  const { w, h } = getNodeDims(node);
  return {
    x: node.internals.positionAbsolute.x + w / 2,
    y: node.internals.positionAbsolute.y + h / 2,
  };
}

function getIntersection(a: InternalNode, b: InternalNode) {
  const { w, h } = getNodeDims(a);
  const ac = getCenter(a);
  const bc = getCenter(b);
  const hw = w / 2, hh = h / 2;
  const dx = (bc.x - ac.x) / (2 * hw);
  const dy = (bc.y - ac.y) / (2 * hh);
  const nh = dx - dy, nv = dx + dy;
  const s = 1 / (Math.abs(nh) + Math.abs(nv));
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
  const sp = getIntersection(src, tgt);
  const tp = getIntersection(tgt, src);
  return {
    sourceX: sp.x, sourceY: sp.y,
    targetX: tp.x, targetY: tp.y,
    sourcePosition: edgeSide(src, sp),
    targetPosition: edgeSide(tgt, tp),
  };
}

// ── Custom edge ───────────────────────────────────────────────────────────────

/** One relationship drawn on (or merged into) an edge. */
type EdgeRelationship = { id: string; name: string };

interface RelEdgeData extends Record<string, unknown> {
  color: string;
  label: string;
  edgeStyle: EdgeStyle;
  /** Which of the three sources this edge came from. */
  category: RelationshipLinkCategory;
  /** Every relationship merged into this edge, for the right-click menu. */
  relationships: EdgeRelationship[];
  /** The label sits in its own layer, so it needs its own click into the menu. */
  onClick?: (event: ReactMouseEvent) => void;
}

function RelationshipEdge({ id, source, target, markerEnd, data }: EdgeProps & { data?: RelEdgeData }) {
  const srcNode = useInternalNode(source);
  const tgtNode = useInternalNode(target);
  if (!srcNode || !tgtNode) return null;
  const style = (data as RelEdgeData | undefined)?.edgeStyle ?? DEFAULT_EDGE_STYLE;
  const [path, lx, ly] = getEdgeStylePath(style, floatingParams(srcNode, tgtNode));
  const color = (data as RelEdgeData | undefined)?.color ?? "#607D8B";
  const label = (data as RelEdgeData | undefined)?.label;
  const clickable = Boolean(data?.onClick);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: color, strokeWidth: 1.6, opacity: 0.8 }} />
      {label && (
        <EdgeLabelRenderer>
          <Box
            onClick={data?.onClick}
            onContextMenu={data?.onClick}
            sx={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`,
              fontSize: 10, fontWeight: 700, color,
              bgcolor: "rgba(255,255,255,0.9)",
              px: "5px", py: "1px",
              borderRadius: "4px",
              border: `1px solid ${color}50`,
              pointerEvents: clickable ? "all" : "none",
              cursor: clickable ? "pointer" : "default",
              whiteSpace: "nowrap",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              "&:hover": clickable ? { bgcolor: `${color}10`, boxShadow: 2 } : undefined,
            }}
          >
            {label}
          </Box>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes: EdgeTypes = { rel: RelationshipEdge };

// ── Custom ReactFlow node cards ───────────────────────────────────────────────

const HIDDEN_HANDLE = { opacity: 0, width: 6, height: 6, background: "transparent", border: "none" };

type HierNodeData = { label: string; typeName: string; badge?: BadgeCustomization; onRemove: () => void };
type SDElemData   = { label: string; typeName: string; modelName: string; badge?: BadgeCustomization; onRemove: () => void };

function HierarchyNodeCard({ id, data }: { id: string; data: HierNodeData }) {
  const connect = useConnectTarget(id);
  return (
    <>
      <ConnectHandles nodeId={id} />
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle type="target" position={Position.Left}  style={HIDDEN_HANDLE} isConnectable={false} />
      <Paper variant="outlined" sx={{
        display: "flex", alignItems: "center", gap: 1,
        px: 1.25, py: 0.75, borderRadius: 2,
        bgcolor: "#EEF6FF", borderColor: "#1565C040",
        minWidth: 160, maxWidth: 230,
        ...connectTargetSx(connect),
        cursor: "grab", userSelect: "none",
        "&:hover": { boxShadow: 2 },
      }}>
        <Box sx={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CanonicalBadge badge={data.badge} fallbackText={data.label} fallbackColor="#1976D2" size={26} />
        </Box>
        <Box flex={1} minWidth={0}>
          <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: 12 }}>{data.label}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: 10 }}>{data.typeName}</Typography>
        </Box>
        <Box component="span" onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          sx={{ cursor: "pointer", color: "text.disabled", display: "flex", "&:hover": { color: "error.main" } }}>
          <CloseIcon sx={{ fontSize: 13 }} />
        </Box>
      </Paper>
    </>
  );
}

function SDElementCard({ id, data }: { id: string; data: SDElemData }) {
  const connect = useConnectTarget(id);
  return (
    <>
      <ConnectHandles nodeId={id} />
      <Handle type="target" position={Position.Left}  style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
      <Paper variant="outlined" sx={{
        display: "flex", alignItems: "center", gap: 1,
        px: 1.25, py: 0.75, borderRadius: 2,
        bgcolor: "#F3FFF3", borderColor: "#2E7D3240",
        minWidth: 160, maxWidth: 230,
        ...connectTargetSx(connect),
        cursor: "grab", userSelect: "none",
        "&:hover": { boxShadow: 2 },
      }}>
        <Box sx={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CanonicalBadge badge={data.badge} fallbackText={data.label} fallbackColor="#1976D2" size={26} />
        </Box>
        <Box flex={1} minWidth={0}>
          <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: 12 }}>{data.label}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: 10 }}>{data.typeName}</Typography>
        </Box>
        <Box component="span" onClick={(e) => { e.stopPropagation(); data.onRemove(); }}
          sx={{ cursor: "pointer", color: "text.disabled", display: "flex", "&:hover": { color: "error.main" } }}>
          <CloseIcon sx={{ fontSize: 13 }} />
        </Box>
      </Paper>
    </>
  );
}

const nodeTypes: NodeTypes = {
  hierarchyNode: HierarchyNodeCard as unknown as NodeTypes[string],
  sdElement:     SDElementCard     as unknown as NodeTypes[string],
  [SHAPE_NODE_TYPE]: ShapeNode as unknown as NodeTypes[string],
};

/** Cards sit on the shared card layer; a shape carries its own stacking order. */
const INSTANCE_NODE_Z_INDEX = DIAGRAM_CARD_Z_INDEX;

const SHAPE_TOOLBAR: { kind: DiagramShapeKind; Icon: typeof CheckBoxOutlineBlankOutlinedIcon }[] = [
  { kind: "RECTANGLE", Icon: CheckBoxOutlineBlankOutlinedIcon },
  { kind: "ELLIPSE", Icon: CircleOutlinedIcon },
  { kind: "TEXT", Icon: TextFieldsOutlinedIcon },
  { kind: "NOTE", Icon: StickyNote2OutlinedIcon },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type SidebarDragData = {
  kind: ModelItemKind;
  id: string;
  name: string;
  typeName: string;
  modelName?: string;
};

/**
 * One connection to draw, normalised from whichever source it came from: a
 * governed cross-model instance, a hierarchy parent → child, or a support domain
 * relationship between the two instances' element types.
 */
interface DiagramEdgeLink {
  /** Identifies the relationship itself — the cross-model instance id, where there is one. */
  id: string;
  /** Groups connections onto one line, and keys its saved style. */
  edgeKey: string;
  sourceId: string;
  targetId: string;
  name: string;
  category: RelationshipLinkCategory;
}

// ── Build ReactFlow nodes/edges ───────────────────────────────────────────────

function buildNodes(
  items: DiagramItem[],
  onRemove: (id: string) => void,
  badgeByInstanceId: Map<string, BadgeCustomization>,
): Node[] {
  const nodeItems = items.filter((i) => i.kind === "HIERARCHY_NODE");
  const elemItems = items.filter((i) => i.kind === "SUPPORT_DOMAIN_ELEMENT");
  const positionFor = (item: DiagramItem, idx: number, colX: number) =>
    item.x != null && item.y != null
      ? { x: item.x, y: item.y }
      : { x: colX, y: ROW_START_Y + idx * ROW_SPACING };
  return [
    ...nodeItems.map((item, idx) => ({
      id: item.id,
      type: "hierarchyNode" as const,
      zIndex: INSTANCE_NODE_Z_INDEX,
      // Only annotations are removable with the keyboard; a card leaves via its ×.
      deletable: false,
      position: positionFor(item, idx, NODE_COL_X),
      data: {
        label: item.name,
        typeName: formatHierarchyNodeSublabel(item.modelName, item.name, item.id),
        badge: badgeByInstanceId.get(item.id),
        onRemove: () => onRemove(item.id),
      } as HierNodeData,
    })),
    ...elemItems.map((item, idx) => ({
      id: item.id,
      type: "sdElement" as const,
      zIndex: INSTANCE_NODE_Z_INDEX,
      deletable: false,
      position: positionFor(item, idx, ELEM_COL_X),
      data: { label: item.name, typeName: item.typeName, modelName: item.modelName ?? "", badge: badgeByInstanceId.get(item.id), onRemove: () => onRemove(item.id) } as SDElemData,
    })),
  ];
}

/**
 * Drawn annotations, as ReactFlow nodes. They are not connectable and carry no
 * business data — they only ever move, resize, take text, or go away.
 */
function buildShapeNodes(
  shapes: DiagramShape[],
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
    // renderer re-enables pointer events on its outline and text.
    style: { width: shape.width, height: shape.height, pointerEvents: "none" as const },
    data: {
      kind: shape.kind,
      text: shape.text,
      strokeColor: shape.strokeColor,
      textColor: shape.textColor,
      fontSize: shape.fontSize,
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
  links: DiagramEdgeLink[],
  canvasIds: Set<string>,
  edgeStyles: Record<string, EdgeStyle>,
  onLabelClick?: (
    edgeKey: string,
    category: RelationshipLinkCategory,
    relationships: EdgeRelationship[],
    event: ReactMouseEvent,
  ) => void,
): Edge[] {
  // Connections sharing a line collapse into one edge, but only within their own
  // source — a hierarchy link and a governed instance over the same pair stay
  // separate lines so each keeps its own colour and line style. A cross-model
  // edge key is its own instance id, so those never merge.
  const groups = new Map<string, {
    sourceId: string;
    targetId: string;
    category: RelationshipLinkCategory;
    links: DiagramEdgeLink[];
  }>();
  for (const link of links) {
    if (!canvasIds.has(link.sourceId) || !canvasIds.has(link.targetId)) continue;
    // An instance linked to itself has no two points to draw between; the floating
    // geometry would divide by zero and strand the label on an invisible path.
    if (link.sourceId === link.targetId) continue;
    const existing = groups.get(link.edgeKey);
    if (existing) existing.links.push(link);
    else groups.set(link.edgeKey, {
      sourceId: link.sourceId, targetId: link.targetId, category: link.category, links: [link],
    });
  }

  const edges: Edge[] = [];
  for (const [edgeKey, group] of groups) {
    const relationships: EdgeRelationship[] = group.links.map((l) => ({ id: l.id, name: l.name }));
    const names = [...new Set(relationships.map((r) => r.name).filter(Boolean))];
    // Only claim a colour when the whole group agrees on one; a merged edge of
    // differently-coloured relationships would otherwise borrow the first's.
    const colors = new Set(names.map((n) => getLinkColor(group.category, n)));
    const color = colors.size === 1 ? [...colors][0] : RELATIONSHIP_FALLBACK_COLOR;
    // Up to two names fit comfortably on the line; past that, name the first two
    // and count the rest — the click-through menu lists them all anyway.
    const label = names.length <= 2
      ? names.join(", ")
      : `${names.slice(0, 2).join(", ")}, +${names.length - 2}`;
    edges.push({
      id: edgeKey,
      source: group.sourceId,
      target: group.targetId,
      type: "rel",
      data: {
        color,
        label,
        edgeStyle: edgeStyles[edgeKey] ?? DEFAULT_EDGE_STYLE,
        category: group.category,
        relationships,
        onClick: onLabelClick
          ? (event: ReactMouseEvent) => onLabelClick(edgeKey, group.category, relationships, event)
          : undefined,
      } as RelEdgeData,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    });
  }
  return edges;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

type InteractionMode = "select" | "pan";

const TOOLBAR = [
  // Pan leads and starts active: reading a diagram comes before rearranging it.
  { key: "pan"    as const, label: "Pan",          Icon: PanToolOutlinedIcon },
  { key: "select" as const, label: "Select",      Icon: NearMeOutlinedIcon  },
  { key: "zoomIn" as const, label: "Zoom In",      Icon: ZoomInOutlinedIcon  },
  { key: "zoomOut"as const, label: "Zoom Out",     Icon: ZoomOutOutlinedIcon },
  { key: "fit"    as const, label: "Fit",          Icon: CropFreeOutlinedIcon},
  { key: "layout" as const, label: "Auto Layout",  Icon: AutoFixHighIcon     },
];

// ── Inner diagram (inside ReactFlowProvider) ──────────────────────────────────

function CrossModelDiagramInner({
  items,
  links,
  shapes,
  badgeByInstanceId,
  onRemove,
  onDrop,
  onNodeMoved,
  onAutoLayout,
  positionsRef,
  edgeStyles,
  onEdgeStyleChange,
  onSelectItem,
  onShapeAdd,
  onShapeMoved,
  onShapeResized,
  onShapeTextChange,
  onShapeRemove,
  onShapeStyleChange,
  onShapeBringToFront,
  onShapeSendToBack,
  canConnect,
  onConnectItems,
}: {
  items: DiagramItem[];
  links: DiagramEdgeLink[];
  shapes: DiagramShape[];
  badgeByInstanceId: Map<string, BadgeCustomization>;
  onRemove: (id: string) => void;
  onDrop: (data: SidebarDragData) => void;
  onNodeMoved: (id: string, x: number, y: number) => void;
  onAutoLayout: () => void;
  positionsRef: MutableRefObject<(() => Record<string, { x: number; y: number }>) | null>;
  edgeStyles: Record<string, EdgeStyle>;
  onEdgeStyleChange: (edgeId: string, style: EdgeStyle) => void;
  onSelectItem?: (id: string) => void;
  onShapeAdd: (kind: DiagramShapeKind, x: number, y: number) => void;
  onShapeMoved: (id: string, x: number, y: number) => void;
  onShapeResized: (id: string, width: number, height: number, x: number, y: number) => void;
  onShapeTextChange: (id: string, text: string) => void;
  onShapeRemove: (id: string) => void;
  onShapeStyleChange: (id: string, patch: ShapeStylePatch) => void;
  onShapeBringToFront: (id: string) => void;
  onShapeSendToBack: (id: string) => void;
  /** Which instance may be dragged onto which: only where the Model Workspace allows a relationship. */
  canConnect?: (fromId: string, toId: string) => boolean;
  onConnectItems?: (fromId: string, toId: string) => void;
}) {
  const { fitView, zoomIn, zoomOut, getNodes, screenToFlowPosition } = useReactFlow();
  const [mode, setMode] = useState<InteractionMode>("pan");
  // The armed annotation tool, if any: the next canvas click places one of these.
  const [pendingShape, setPendingShape] = useState<DiagramShapeKind | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<
    {
      edgeId: string;
      category: RelationshipLinkCategory;
      relationships: EdgeRelationship[];
      top: number;
      left: number;
    } | null
  >(null);

  // Either click on a connection — line or label — opens its actions (update the
  // relationship, line shape); the edge carries no other interaction, so a plain
  // click shouldn't be a dead spot.
  const openEdgeMenu = useCallback((
    edgeKey: string,
    category: RelationshipLinkCategory,
    relationships: EdgeRelationship[],
    event: ReactMouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setEdgeMenu({ edgeId: edgeKey, category, relationships, top: event.clientY, left: event.clientX });
  }, []);

  const handleEdgeMouse = useCallback((event: ReactMouseEvent, edge: Edge) => {
    const data = edge.data as RelEdgeData | undefined;
    openEdgeMenu(edge.id, data?.category ?? "CROSS_MODEL", data?.relationships ?? [], event);
  }, [openEdgeMenu]);

  const canvasIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  const handleRemove = useCallback((id: string) => {
    onRemove(id);
  }, [onRemove]);

  const shapeNodes = useMemo(
    () => buildShapeNodes(
      shapes, onShapeTextChange, onShapeResized, onShapeRemove, onShapeStyleChange,
      onShapeBringToFront, onShapeSendToBack,
    ),
    [shapes, onShapeTextChange, onShapeResized, onShapeRemove, onShapeStyleChange,
     onShapeBringToFront, onShapeSendToBack],
  );

  const initialNodes = useMemo(
    () => [...buildShapeNodes(
      shapes, onShapeTextChange, onShapeResized, onShapeRemove, onShapeStyleChange,
      onShapeBringToFront, onShapeSendToBack,
    ),
           ...buildNodes(items, handleRemove, badgeByInstanceId)],
    [],
  );
  const initialEdges = useMemo(() => buildEdges(links, canvasIds, edgeStyles, openEdgeMenu), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Expose current live node positions so the parent can capture them when saving.
  useEffect(() => {
    positionsRef.current = () =>
      Object.fromEntries(getNodes().map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    return () => { positionsRef.current = null; };
  }, [getNodes, positionsRef]);

  // Rebuild edges when links, visible items, or line styles change
  useEffect(() => {
    setEdges(buildEdges(links, canvasIds, edgeStyles, openEdgeMenu));
  }, [links, canvasIds, edgeStyles, openEdgeMenu, setEdges]);

  // What the last rebuild put each node at. A rebuild triggered by something
  // other than a real move — a re-render while auto-save runs, say — must not
  // yank a node back to its stored position out from under an in-flight drag.
  const builtPositions = useRef(new Map<string, { x: number; y: number }>());

  // Positions are driven by the items themselves (persisted on drag / cleared on auto layout).
  useEffect(() => {
    setNodes((previous) => {
      // Rebuilding must not drop the selection, or resize handles vanish mid-edit.
      const onScreen = new Map(previous.map((node) => [node.id, node]));
      const next = new Map<string, { x: number; y: number }>();
      const rebuilt = [...shapeNodes, ...buildNodes(items, handleRemove, badgeByInstanceId)].map((node) => {
        const lastBuilt = builtPositions.current.get(node.id);
        const live = onScreen.get(node.id);
        const moved = !lastBuilt || lastBuilt.x !== node.position.x || lastBuilt.y !== node.position.y;
        next.set(node.id, node.position);
        return {
          ...node,
          position: moved || !live ? node.position : live.position,
          selected: live?.selected ?? node.selected,
        };
      });
      builtPositions.current = next;
      return rebuilt;
    });
  }, [items, handleRemove, setNodes, badgeByInstanceId, shapeNodes]);

  const shapeIds = useMemo(() => new Set(shapes.map((shape) => shape.id)), [shapes]);

  const commitNodePosition = useCallback((id: string, x: number, y: number) => {
    if (shapeIds.has(id)) onShapeMoved(id, x, y);
    else onNodeMoved(id, x, y);
  }, [onNodeMoved, onShapeMoved, shapeIds]);

  const onNodeDragStop = useCallback((_: unknown, node: Node, draggedNodes: Node[]) => {
    // ReactFlow drags every selected node but reports one; persist them all, or
    // the rest snap back the moment the canvas rebuilds from state.
    const moved = draggedNodes?.length ? draggedNodes : [node];
    moved.forEach((dragged) => commitNodePosition(dragged.id, dragged.position.x, dragged.position.y));
  }, [commitNodePosition]);

  // Placing an annotation: arm a tool, then click where it goes. Esc disarms.
  const handlePaneClick = useCallback((event: ReactMouseEvent) => {
    if (!pendingShape) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onShapeAdd(pendingShape, point.x, point.y);
    setPendingShape(null);
  }, [pendingShape, onShapeAdd, screenToFlowPosition]);

  useEffect(() => {
    if (!pendingShape) return;
    const cancel = (keyEvent: KeyboardEvent) => { if (keyEvent.key === "Escape") setPendingShape(null); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [pendingShape]);

  const handleAutoLayout = useCallback(() => {
    onAutoLayout();
    setTimeout(() => void fitView({ padding: FIT_PADDING, duration: FIT_DURATION }), FIT_DELAY);
  }, [onAutoLayout, fitView]);

  const handleToolbar = (key: typeof TOOLBAR[number]["key"]) => {
    if (key === "select") { setMode("select"); return; }
    if (key === "pan")    { setMode("pan");    return; }
    if (key === "zoomIn") { void zoomIn({ duration: FIT_DURATION }); return; }
    if (key === "zoomOut"){ void zoomOut({ duration: FIT_DURATION }); return; }
    if (key === "fit")    { void fitView({ padding: FIT_PADDING, duration: FIT_DURATION }); return; }
    if (key === "layout") { handleAutoLayout(); return; }
  };

  return (
    <Box display="flex" flexDirection="column" flex={1} minHeight={0} gap={1}>
      {/* Toolbar */}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" rowGap={0.75} flexShrink={0} alignItems="center">
        {TOOLBAR.map(({ key, label, Icon }) => {
          const active = key === mode;
          return (
            <ButtonBase key={key} onClick={() => handleToolbar(key)} sx={{
              px: 1.25, py: 0.5, borderRadius: 1, gap: 0.5,
              border: "1px solid",
              borderColor: active ? "primary.main" : "divider",
              color: active ? "primary.main" : "text.secondary",
              bgcolor: "background.paper",
              display: "flex", alignItems: "center",
              "&:hover": { bgcolor: "action.hover", borderColor: active ? "primary.main" : "text.secondary" },
            }}>
              <Icon sx={{ fontSize: 16 }} />
              <Typography variant="caption" fontWeight={active ? 700 : 500} sx={{ fontSize: 11 }}>
                {label}
              </Typography>
            </ButtonBase>
          );
        })}

        {/* Insert — drawn annotations, which carry no business data. */}
        <Box sx={{ width: "1px", height: 20, bgcolor: "divider", mx: 0.5 }} />
        {SHAPE_TOOLBAR.map(({ kind, Icon }) => {
          const armed = pendingShape === kind;
          return (
            <Tooltip key={kind} title={`${DIAGRAM_SHAPE_LABELS[kind]} — click the canvas to place`} arrow>
              <ButtonBase
                onClick={() => setPendingShape(armed ? null : kind)}
                sx={{
                  px: 1.25, py: 0.5, borderRadius: 1, gap: 0.5,
                  border: "1px solid",
                  borderColor: armed ? "primary.main" : "divider",
                  color: armed ? "primary.main" : "text.secondary",
                  bgcolor: "background.paper",
                  display: "flex", alignItems: "center",
                  "&:hover": { bgcolor: "action.hover", borderColor: armed ? "primary.main" : "text.secondary" },
                }}
              >
                <Icon sx={{ fontSize: 16 }} />
                <Typography variant="caption" fontWeight={armed ? 700 : 500} sx={{ fontSize: 11 }}>
                  {DIAGRAM_SHAPE_LABELS[kind]}
                </Typography>
              </ButtonBase>
            </Tooltip>
          );
        })}
        {pendingShape && (
          <Typography variant="caption" color="primary.main" sx={{ fontSize: 11 }}>
            Click the canvas to place — Esc to cancel
          </Typography>
        )}
      </Stack>

      {/* Canvas */}
      <Box
        flex={1} minHeight={0}
        // The class wins over ReactFlow's own pane/node cursors (see shapeNode.css).
        className={pendingShape ? "pdp-shape-placing" : undefined}
        sx={{ borderRadius: 2, overflow: "hidden", border: "1px solid", borderColor: "divider" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const raw = e.dataTransfer.getData("application/pdp-diagram");
          if (!raw) return;
          try { onDrop(JSON.parse(raw) as SidebarDragData); } catch { /* ignore bad drag data */ }
        }}
      >
        <ConnectRuleContext.Provider value={canConnect ?? null}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={handlePaneClick}
          onNodeClick={(_event, node) => { if (!shapeIds.has(node.id)) onSelectItem?.(node.id); }}
          onNodesDelete={(deleted) => deleted.forEach((node) => {
            if (shapeIds.has(node.id)) onShapeRemove(node.id);
          })}
          deleteKeyCode={["Delete", "Backspace"]}
          onEdgeClick={handleEdgeMouse}
          onEdgeContextMenu={handleEdgeMouse}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          panOnDrag={mode === "pan"}
          selectionOnDrag={mode === "select"}
          nodesDraggable
          nodesFocusable
          nodesConnectable={Boolean(onConnectItems)}
          onConnect={(connection) => {
            if (!connection.source || !connection.target || connection.source === connection.target) return;
            if (canConnect && !canConnect(connection.source, connection.target)) return;
            onConnectItems?.(connection.source, connection.target);
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
          <Background gap={16} size={1} color="#e0e0e0" />

          {items.length === 0 && shapes.length === 0 && (
            <Box sx={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              flexDirection: "column", gap: 1, pointerEvents: "none", zIndex: 1,
            }}>
              <Typography variant="body2" color="text.disabled" textAlign="center" maxWidth={340}>
                Drag hierarchy nodes and SD element instances from the left panel onto this canvas.
                Hierarchy, support domain and between-model relationships between them will be drawn
                automatically.
              </Typography>
            </Box>
          )}
        </ReactFlow>
        </ConnectRuleContext.Provider>
        <DiagramConnectStyles />
      </Box>

      <EdgeContextMenu
        anchorPosition={edgeMenu ? { top: edgeMenu.top, left: edgeMenu.left } : null}
        onClose={() => setEdgeMenu(null)}
        currentStyle={edgeMenu ? edgeStyles[edgeMenu.edgeId] ?? DEFAULT_EDGE_STYLE : DEFAULT_EDGE_STYLE}
        onSelectStyle={(style) => { if (edgeMenu) onEdgeStyleChange(edgeMenu.edgeId, style); }}
        relationships={edgeMenu?.relationships.map((rel) => ({
          id: rel.id,
          name: rel.name,
          color: getLinkColor(edgeMenu.category, rel.name),
        }))}
        // No relationship is rewritten here. Hierarchy parent/child and support
        // domain relationships follow their model; a cross-model link is one of
        // the options the model offers — it is added or removed, never retyped.
      />
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function CrossModelDiagramView({ onSelectItem, selectionSlot, onConnectInstances }: {
  selectionSlot?: SelectionSlot;
  /** An instance card on the canvas was clicked: its node or element instance id. */
  onSelectItem?: (id: string) => void;
  /** A relationship was dragged from one instance to another: open the Relationship Editor for them. */
  onConnectInstances?: (source: LinkEnd, target: LinkEnd) => void;
} = {}) {
  const {
    crossModelRelationship: {
      diagramViewSelection: { canvasItems, edgeStyles, shapes, currentDiagramId, currentDiagramName },
    },
    setMatrixSourceSelection,
    setMatrixTargetSelection,
    setDiagramCanvasItems,
    setDiagramEdgeStyles,
    setDiagramShapes,
    setCurrentDiagramId,
    setCurrentDiagramName,
  } = useStructureWorkspace();
  const [paletteSelection, setPaletteSelection] = useState<CrossModelSelectableItem[]>([]);
  const syncedMatrixLinkIds = useRef(new Set<string>());
  const matrixSyncSignature = useRef("");
  const selectionModels = useCrossModelSelectionModels();
  const allLinks        = useAllCrossModelLinks();
  const governedTypes   = useActiveCrossModelRelationshipTypes();

  // Drag-to-create: an instance may be dropped on another only where an
  // active relationship type in the Model Workspace takes both of their types.
  const endById = useMemo(
    () => new Map(selectionModels.flatMap((model) => model.items).map((item) => [item.id, { kind: item.modelKind, modelId: item.modelId, typeId: item.typeId }])),
    [selectionModels],
  );
  const canConnectInstances = useCallback(
    (fromId: string, toId: string) => {
      const from = endById.get(fromId);
      const to = endById.get(toId);
      if (!from || !to) return false;
      return (governedTypes.data ?? []).some(
        (type) =>
          type.sourceModelType === from.kind &&
          (!type.sourceModelId || type.sourceModelId === from.modelId) &&
          (!type.sourceModelItemTypeId || type.sourceModelItemTypeId === from.typeId) &&
          type.targetModelType === to.kind &&
          (!type.targetModelId || type.targetModelId === to.modelId) &&
          (!type.targetModelItemTypeId || type.targetModelItemTypeId === to.typeId),
      );
    },
    [endById, governedTypes.data],
  );
  const connectInstances = useCallback(
    (fromId: string, toId: string) => {
      const from = endById.get(fromId);
      const to = endById.get(toId);
      if (!from || !to) return;
      onConnectInstances?.(
        { kind: from.kind, modelId: from.modelId, instanceId: fromId },
        { kind: to.kind, modelId: to.modelId, instanceId: toId },
      );
    },
    [endById, onConnectInstances],
  );
  // Element relationships are defined between element TYPES, so the instance
  // diagram projects them onto the instances of those types (see canvasLinks).
  const supportDomainRelationships = useAllSupportDomainRelationships();
  // Three sources on one canvas gets busy; each can be switched off while reading.
  const [hiddenCategories, setHiddenCategories] = useState<Set<RelationshipLinkCategory>>(new Set());
  const [showAllLegend, setShowAllLegend] = useState(false);
  // Instances reference a governed type by id; the diagram needs its name for the
  // edge label, the same lookup the Matrix view does.
  const relNameById = useMemo(
    () => new Map((governedTypes.data ?? []).map((type) => [type.id, type.name])),
    [governedTypes.data],
  );
  const badgeByInstanceId = useMemo(() => {
    const map = new Map<string, BadgeCustomization>();
    for (const model of selectionModels) {
      for (const item of model.items) {
        if (item.badge) map.set(item.id, item.badge);
      }
    }
    return map;
  }, [selectionModels]);

  const canvasIds = useMemo(() => new Set(canvasItems.map((i) => i.id)), [canvasItems]);

  // The palette knows each instance's parent and type; the canvas items don't.
  const instanceMetaById = useMemo(
    () => new Map(
      selectionModels.flatMap((model) => model.items).map((item) => [
        item.id,
        { parentId: item.parentId ?? null, typeId: item.typeId ?? null },
      ]),
    ),
    [selectionModels],
  );

  const visibleLinks = useMemo(
    () => (allLinks.data ?? []).filter(
      (l) => canvasIds.has(l.source_instance_id) && canvasIds.has(l.target_instance_id),
    ),
    [allLinks.data, canvasIds],
  );

  useEffect(() => {
    const itemById = new Map(
      selectionModels.flatMap((model) => model.items).map((item) => [item.id, item]),
    );
    const linkedCanvasItems = visibleLinks.length > 0
      ? visibleLinks
      : (allLinks.data ?? []).filter((link) => syncedMatrixLinkIds.current.has(link.cross_model_instance_id));

    if (linkedCanvasItems.length > 0) {
      const sourceItems = new Map<string, CrossModelSelectableItem>();
      const targetItems = new Map<string, CrossModelSelectableItem>();
      linkedCanvasItems.forEach((link) => {
        const source = itemById.get(link.source_instance_id);
        const target = itemById.get(link.target_instance_id);
        if (source) sourceItems.set(source.id, source);
        if (target) targetItems.set(target.id, target);
      });
      if (
        sourceItems.size > 0 &&
        targetItems.size > 0 &&
        linkedCanvasItems.every((link) => itemById.has(link.source_instance_id) && itemById.has(link.target_instance_id))
      ) {
        const nextSignature = linkedCanvasItems
          .map((link) => link.cross_model_instance_id)
          .sort()
          .join("|");
        if (matrixSyncSignature.current === nextSignature) return;

        syncedMatrixLinkIds.current = new Set(linkedCanvasItems.map((link) => link.cross_model_instance_id));
        matrixSyncSignature.current = nextSignature;
        setMatrixSourceSelection({
          instances: [...sourceItems.values()].map((item) => ({
            id: item.id,
            name: item.name,
            modelId: item.modelId,
            modelName: item.modelName,
            kind: item.modelKind,
          })),
        });
        setMatrixTargetSelection({
          instances: [...targetItems.values()].map((item) => ({
            id: item.id,
            name: item.name,
            modelId: item.modelId,
            modelName: item.modelName,
            kind: item.modelKind,
          })),
        });
      }
      return;
    }

    if (syncedMatrixLinkIds.current.size > 0) {
      syncedMatrixLinkIds.current = new Set();
      matrixSyncSignature.current = "";
      setMatrixSourceSelection(null);
      setMatrixTargetSelection(null);
    }
  }, [
    allLinks.data,
    selectionModels,
    setMatrixSourceSelection,
    setMatrixTargetSelection,
    visibleLinks,
  ]);

  // The diagram is shared: governed cross-model instances, the hierarchy parent →
  // child links between the node instances on the canvas, and the support domain
  // relationships their element types carry all draw onto the same canvas.
  const canvasLinks = useMemo<DiagramEdgeLink[]>(() => {
    const links: DiagramEdgeLink[] = [];

    for (const link of visibleLinks) {
      links.push({
        id: link.cross_model_instance_id,
        // One governed instance is exactly one connection, so it keys its own line
        // — the key saved diagrams already store.
        edgeKey: link.cross_model_instance_id,
        sourceId: link.source_instance_id,
        targetId: link.target_instance_id,
        name: relNameById.get(link.relationship_rule_id) ?? "",
        category: "CROSS_MODEL",
      });
    }

    for (const item of canvasItems) {
      const parentId = instanceMetaById.get(item.id)?.parentId;
      if (!parentId || !canvasIds.has(parentId)) continue;
      links.push({
        id: `${parentId}__${item.id}`,
        edgeKey: edgeKeyForPair("HIERARCHY", parentId, item.id),
        sourceId: parentId,
        targetId: item.id,
        name: HIERARCHY_LINK_LABEL,
        category: "HIERARCHY",
      });
    }

    // Element instances on the canvas, grouped by the element type they instantiate.
    const canvasIdsByTypeId = new Map<string, string[]>();
    for (const item of canvasItems) {
      if (item.kind !== "SUPPORT_DOMAIN_ELEMENT") continue;
      const typeId = instanceMetaById.get(item.id)?.typeId;
      if (!typeId) continue;
      const bucket = canvasIdsByTypeId.get(typeId);
      if (bucket) bucket.push(item.id);
      else canvasIdsByTypeId.set(typeId, [item.id]);
    }
    for (const relationship of supportDomainRelationships.data ?? []) {
      const sources = canvasIdsByTypeId.get(relationship.sourceElementId) ?? [];
      const targets = canvasIdsByTypeId.get(relationship.targetElementId) ?? [];
      for (const sourceId of sources) {
        for (const targetId of targets) {
          if (sourceId === targetId) continue;
          links.push({
            id: relationship.id,
            edgeKey: edgeKeyForPair("SUPPORT_DOMAIN", sourceId, targetId),
            sourceId,
            targetId,
            name: relationshipKindLabel(relationship.relationshipKind),
            category: "SUPPORT_DOMAIN",
          });
        }
      }
    }

    return links.filter((l) => l.sourceId !== l.targetId);
  }, [
    canvasIds,
    canvasItems,
    instanceMetaById,
    relNameById,
    supportDomainRelationships.data,
    visibleLinks,
  ]);

  const drawnLinks = useMemo(
    () => canvasLinks.filter((l) => !hiddenCategories.has(l.category)),
    [canvasLinks, hiddenCategories],
  );

  function toggleCategory(category: RelationshipLinkCategory) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const nodeCount = canvasItems.filter((i) => i.kind === "HIERARCHY_NODE").length;
  const elemCount = canvasItems.filter((i) => i.kind === "SUPPORT_DOMAIN_ELEMENT").length;

  // Legend entries are derived from what's drawn, not a fixed list — the Model
  // workspace can name a type anything, and unknown names render black.
  const legendTypes = useMemo(() => {
    const seen = new Map<string, { name: string; category: RelationshipLinkCategory }>();
    for (const link of drawnLinks) {
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
  }, [drawnLinks]);

  // Bridge to read the live canvas node positions (set by the inner ReactFlow component).
  const positionsRef = useRef<(() => Record<string, { x: number; y: number }>) | null>(null);
  // Handlers below run before the sync hook is set up; reach its callback through a ref.
  const markSyncedRef = useRef<(() => void) | null>(null);

  function toDragData(item: CrossModelSelectableItem): SidebarDragData {
    return {
      kind: item.modelKind === ("HIERARCHY_MODEL" as ModelKind) ? "HIERARCHY_NODE" : "SUPPORT_DOMAIN_ELEMENT",
      id: item.id,
      name: item.name,
      typeName: item.typeName,
      modelName: item.modelName,
    };
  }

  function handleAddItem(item: CrossModelSelectableItem) {
    handleDrop(toDragData(item));
  }

  function handleDrop(data: SidebarDragData) {
    if (canvasIds.has(data.id)) return;
    setDiagramCanvasItems((prev) => [...prev, {
      id: data.id, name: data.name, typeName: data.typeName,
      modelName: data.modelName, kind: data.kind,
    }]);
  }

  // Stable identity: this feeds the canvas rebuild effect, which must not run
  // just because the view re-rendered (auto-save status, a refreshed list, …).
  const handleRemove = useCallback((id: string) => {
    setDiagramCanvasItems((prev) => prev.filter((i) => i.id !== id));
  }, [setDiagramCanvasItems]);

  function handleNodeMoved(id: string, x: number, y: number) {
    setDiagramCanvasItems((prev) => prev.map((i) => (i.id === id ? { ...i, x, y } : i)));
  }

  function handleAutoLayoutPositions() {
    setDiagramCanvasItems((prev) => prev.map((i) => ({ ...i, x: undefined, y: undefined })));
  }

  // ── Drawn annotations ───────────────────────────────────────────────────────
  // They live beside the canvas items in workspace state, so leaving the tab and
  // coming back keeps them; they only reach the database when the diagram is saved.

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

  const handleShapeBringToFront = useCallback((id: string) => {
    setDiagramShapes((prev) => bringShapeToFront(prev, id));
  }, [setDiagramShapes]);

  const handleShapeSendToBack = useCallback((id: string) => {
    setDiagramShapes((prev) => sendShapeToBack(prev, id));
  }, [setDiagramShapes]);

  function getSaveShapes() {
    return shapes.map(({ id: _id, ...shape }) => shape);
  }

  function handleEdgeStyleChange(edgeId: string, style: EdgeStyle) {
    setDiagramEdgeStyles((prev) => (prev[edgeId] === style ? prev : { ...prev, [edgeId]: style }));
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
    // Persist a row for every connection the canvas can draw — including ones a
    // category filter is currently hiding, and including the default style — so a
    // saved diagram fully describes how it renders.
    const canvasEdgeKeys = new Set(canvasLinks.map((link) => link.edgeKey));
    return [...canvasEdgeKeys].map((edgeKey) => ({
      edgeKey,
      edgeStyle: edgeStyles[edgeKey] ?? DEFAULT_EDGE_STYLE,
    }));
  }

  function handleLoadDiagram(diagram: SavedDiagram) {
    const itemById = new Map(selectionModels.flatMap((model) => model.items).map((item) => [item.id, item]));
    // Only restore items whose instances still exist; kind is derived from the resolved item.
    const restored: DiagramItem[] = diagram.nodes.flatMap((node) => {
      const item = itemById.get(node.itemId);
      if (!item) return [];
      return [{
        id: item.id,
        name: item.name,
        typeName: item.typeName,
        modelName: item.modelName,
        kind: item.modelKind === ("HIERARCHY_MODEL" as ModelKind) ? "HIERARCHY_NODE" : "SUPPORT_DOMAIN_ELEMENT",
        x: node.posX,
        y: node.posY,
      }];
    });
    setDiagramCanvasItems(restored);
    setDiagramEdgeStyles(Object.fromEntries(diagram.edges.map((e) => [e.edgeKey, e.edgeStyle])));
    setDiagramShapes(diagram.shapes.map(restoreDiagramShape));
    setCurrentDiagramId(diagram.id);
    setCurrentDiagramName(diagram.name);
    markSyncedRef.current?.();
  }

  function handleClearCanvas() {
    setDiagramCanvasItems([]);
    setDiagramEdgeStyles({});
    setDiagramShapes([]);
    setCurrentDiagramId(null);
    setCurrentDiagramName(null);
    markSyncedRef.current?.();
  }

  function handleSaved(diagram: SavedDiagram) {
    setCurrentDiagramId(diagram.id);
    setCurrentDiagramName(diagram.name);
  }

  function handleDeleted(id: string) {
    // Deleting the open diagram empties the canvas too, so auto-save doesn't
    // immediately recreate its contents under a new "Untitled diagram".
    if (id === currentDiagramId) handleClearCanvas();
  }

  // Opens the most recently updated diagram on arrival and writes every later
  // change back on its own. The Save button is unchanged — it still names and
  // saves a diagram, or overwrites the open one.
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
    // The palette resolves what a saved diagram's item ids refer to; opening one
    // before it has loaded would drop every item as "no longer exists".
    enabled: selectionModels.some((model) => model.items.length > 0),
  });

  markSyncedRef.current = markSynced;

  function getDiagramStatus(item: CrossModelSelectableItem): CrossModelSelectableStatus | undefined {
    if (!canvasIds.has(item.id)) return undefined;
    return {
      disabled: true,
      label: "Already added",
      reason: "Already added to this diagram.",
    };
  }

  return (
    <Box display="flex" flex={1} minHeight={0} width="100%">
      {/* No gap between the two: each carries its own border, so the space
          between them was only costing the diagram width. */}
      {renderSelection(selectionSlot, (
        <CrossModelSelectionPanel
          workspace="structure"
          view="diagram"
          selectionLevel={CROSS_MODEL_SELECTION_LEVEL.INSTANCE}
          models={selectionModels}
          diagramSelection={paletteSelection}
          onDiagramSelectionChange={setPaletteSelection}
          onItemDoubleClick={handleAddItem}
          onItemDragStart={(item, event) => {
            event.dataTransfer.setData("application/pdp-diagram", JSON.stringify(toDragData(item)));
            event.dataTransfer.effectAllowed = "copy";
          }}
          getItemStatus={getDiagramStatus}
          emptyMessage="No node or element instances found."
        />
      ), 360)}

      {/* ── Right: diagram ─────────────────────────────────────────────────── */}
      <Box display="flex" flexDirection="column" flex={1} minHeight={0} gap={1}>
        {/* Saved-diagrams bar + stats */}
        <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} flexShrink={0}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <SavedDiagramsBar
              api={savedDiagramApi}
              queryKey={SAVED_DIAGRAMS_QUERY_KEY}
              canvasItemCount={canvasItems.length}
              getSaveNodes={getSaveNodes}
              getSaveEdges={getSaveEdges}
              getSaveShapes={getSaveShapes}
              currentDiagramId={currentDiagramId}
              currentDiagramName={currentDiagramName}
              onLoad={handleLoadDiagram}
              onSaved={handleSaved}
              onClear={handleClearCanvas}
              onDeleted={handleDeleted}
            />
            {currentDiagramName && (
              <Typography variant="caption" color="text.secondary" noWrap>
                Editing: {currentDiagramName}
              </Typography>
            )}
            <SavedDiagramSyncStatusLabel status={syncStatus} />
          </Stack>
          {canvasItems.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {nodeCount} node{nodeCount !== 1 ? "s" : ""},{" "}
              {elemCount} element{elemCount !== 1 ? "s" : ""},{" "}
              {drawnLinks.length} connection{drawnLinks.length !== 1 ? "s" : ""}
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
        {legendTypes.length > 0 && (
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

        {allLinks.isError && (
          <Alert severity="warning" sx={{ flexShrink: 0 }}>
            Could not load relationships — connections won't be shown.
          </Alert>
        )}

        <ReactFlowProvider>
          <CrossModelDiagramInner
            items={canvasItems}
            links={drawnLinks}
            shapes={shapes}
            badgeByInstanceId={badgeByInstanceId}
            onRemove={handleRemove}
            onDrop={handleDrop}
            onNodeMoved={handleNodeMoved}
            onAutoLayout={handleAutoLayoutPositions}
            positionsRef={positionsRef}
            edgeStyles={edgeStyles}
            onEdgeStyleChange={handleEdgeStyleChange}
            onSelectItem={onSelectItem}
            canConnect={canConnectInstances}
            onConnectItems={onConnectInstances ? connectInstances : undefined}
            onShapeAdd={handleShapeAdd}
            onShapeMoved={handleShapeMoved}
            onShapeResized={handleShapeResized}
            onShapeTextChange={handleShapeTextChange}
            onShapeRemove={handleShapeRemove}
            onShapeStyleChange={handleShapeStyleChange}
            onShapeBringToFront={handleShapeBringToFront}
            onShapeSendToBack={handleShapeSendToBack}
          />
        </ReactFlowProvider>

      </Box>
    </Box>
  );
}
