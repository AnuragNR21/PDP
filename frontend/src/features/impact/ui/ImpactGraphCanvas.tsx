import { OverflowText } from "@/shared/workspace/OverflowText";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BaseEdge,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useStoreApi,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import CloseIcon from "@mui/icons-material/Close";
import HubIcon from "@mui/icons-material/Hub";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AutoAwesomeMosaicOutlinedIcon from "@mui/icons-material/AutoAwesomeMosaicOutlined";
import CenterFocusStrongOutlinedIcon from "@mui/icons-material/CenterFocusStrongOutlined";
import ZoomInOutlinedIcon from "@mui/icons-material/ZoomInOutlined";
import ZoomOutOutlinedIcon from "@mui/icons-material/ZoomOutOutlined";
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import {
  IMPACT_DRAG_TYPE,
  NODE_HEIGHT,
  NODE_WIDTH,
  type CanvasState,
} from "@/features/impact/domain/impactGraph";
import {
  GOVERNANCE_EDGE_KIND,
  GOVERNANCE_ITEM_KIND,
  type GovernanceEdge,
  type GovernanceEdgeKind,
} from "@/features/structure/domain/structureGovernanceGraph";
import {
  OBSERVED_EDGE_KIND,
  OBSERVED_ITEM_KIND,
} from "@/features/impact/domain/impactLayout";
import { gapLanes, labelPlacement, pathThrough, routeConnector, type Rect } from "@/features/impact/domain/impactRouting";

/**
 * The Impact canvas.
 *
 * View-only by construction, not by convention: handles are not connectable,
 * `nodesConnectable` is off, and there is no code path here that creates a node
 * or a relationship. The only things a reader changes are which items are on
 * screen and where they sit.
 *
 * Built for several hundred nodes at once, which drives three choices:
 * `onlyRenderVisibleElements` so off-screen cards cost nothing, memoised node
 * components so one drag does not re-render the other 499, and node data that
 * is a flat object of primitives so React's shallow compare actually bites.
 */

const HIDDEN_HANDLE = {
  opacity: 0,
  width: 6,
  height: 6,
  background: "transparent",
  border: "none",
} as const;

/**
 * One palette for both the cards and the legend, so they cannot drift.
 *
 * Keyed by `GovernanceEdgeKind` rather than `string`: a kind added to the graph
 * then fails to compile here instead of quietly drawing in the fallback grey.
 */
/**
 * Every kind of line the diagram can draw: the three governance kinds plus
 * observed results, which the diagram adds and nothing stores.
 */
export type DiagramEdgeKind = GovernanceEdgeKind | typeof OBSERVED_EDGE_KIND;

export const EDGE_COLOR: Record<DiagramEdgeKind, string> = {
  [GOVERNANCE_EDGE_KIND.HIERARCHY]: "#64748B",
  [GOVERNANCE_EDGE_KIND.CROSS_MODEL]: "#1565C0",
  [GOVERNANCE_EDGE_KIND.SUPPORT_DOMAIN]: "#8E24AA",
  [OBSERVED_EDGE_KIND]: "#B26A00",
};

export const EDGE_LABEL: Record<DiagramEdgeKind, string> = {
  [GOVERNANCE_EDGE_KIND.HIERARCHY]: "Contains",
  [GOVERNANCE_EDGE_KIND.CROSS_MODEL]: "Governed by",
  [GOVERNANCE_EDGE_KIND.SUPPORT_DOMAIN]: "Related (projected)",
  [OBSERVED_EDGE_KIND]: "Found in the data",
};

/** Broken, because neither kind is a fact governance stated. */
export const EDGE_DASHED: Record<DiagramEdgeKind, boolean> = {
  [GOVERNANCE_EDGE_KIND.HIERARCHY]: false,
  [GOVERNANCE_EDGE_KIND.CROSS_MODEL]: false,
  [GOVERNANCE_EDGE_KIND.SUPPORT_DOMAIN]: true,
  [OBSERVED_EDGE_KIND]: true,
};

/** The card palette, named for the legend so the two cannot drift apart. */
export const CARD_LEGEND = [
  { label: "Hierarchy model", accent: "#6A1B9A", tint: "#F8F0FC" },
  { label: "Node or property", accent: "#1565C0", tint: "#EEF6FF" },
  { label: "Governed value", accent: "#2E7D32", tint: "#F3FFF3" },
  { label: "Found by Discover", accent: "#B26A00", tint: "#FFF8EC" },
] as const;

type ImpactNodeData = {
  label: string;
  typeName: string;
  modelName: string;
  isElement: boolean;
  isModel: boolean;
  isObserved: boolean;
  isSeed: boolean;
  isOnPath: boolean;
  isFocus: boolean;
  expanded: boolean;
  related: number;
  /** Children on the canvas; 0 means the fold control fetches them. */
  children: number;
  collapsed: boolean;
  onRemove: (id: string) => void;
  onExpand: (id: string) => void;
  onToggleChildren: (id: string) => void;
};

/**
 * A card's colour says what kind of thing it is.
 *
 * Three kinds, three colours, and the same three in the legend. A reader
 * scanning a hundred cards should be able to tell a whole model from one node
 * inside it without reading a word.
 */
const CARD_ACCENT = {
  model: "#6A1B9A",
  element: "#2E7D32",
  node: "#1565C0",
  observed: "#B26A00",
} as const;

const CARD_TINT = {
  model: "#F8F0FC",
  element: "#F3FFF3",
  node: "#EEF6FF",
  observed: "#FFF8EC",
} as const;

const ImpactCard = memo(function ImpactCard({ id, data }: { id: string; data: ImpactNodeData }) {
  const tone = data.isObserved
    ? "observed"
    : data.isModel
      ? "model"
      : data.isElement
        ? "element"
        : "node";
  const accent = CARD_ACCENT[tone];
  const tint = CARD_TINT[tone];
  return (
    <>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderRadius: 2,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          bgcolor: tint,
          borderColor: data.isFocus || data.isSeed || data.isOnPath ? accent : `${accent}40`,
          // The focus is the one card the picture is arranged around, so it
          // carries the heaviest border on the canvas and a tag that says so.
          borderWidth: data.isFocus ? 3 : data.isSeed ? 2 : 1,
          // A ring rather than a heavier border: the path is something the
          // reader asked to be shown, not something they picked.
          boxShadow: data.isFocus
            ? `0 0 0 4px ${accent}26, 0 2px 8px ${accent}33`
            : data.isOnPath
              ? `0 0 0 3px ${accent}40`
              : undefined,
          // A reading of the data, not a governed thing: drawn broken, the same
          // way its connectors are.
          borderStyle: data.isObserved ? "dashed" : "solid",
          cursor: "grab",
          userSelect: "none",
          "&:hover": { boxShadow: 2 },
        }}
      >
        {data.isFocus && (
          <Box
            sx={{
              position: "absolute",
              top: -9,
              left: 10,
              px: 0.75,
              borderRadius: 1,
              bgcolor: accent,
              color: "#fff",
              fontSize: 9,
              lineHeight: "16px",
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            FOCUS
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <OverflowText variant="body2" fontWeight={600}  sx={{ fontSize: 12.5 }}>
            {data.label}
          </OverflowText>
          <OverflowText variant="caption" color="text.secondary"  display="block" sx={{ fontSize: 10 }}>
            {data.typeName}
          </OverflowText>
          <OverflowText variant="caption" color="text.disabled"  display="block" sx={{ fontSize: 9.5 }}>
            {data.modelName}
          </OverflowText>
        </Box>
        <Stack spacing={0} alignItems="center">
          {/* A card Discover put there is a reading of one run, not a node of
              the governance graph: it has no relationships to open and no
              connected context of its own, so it carries no hub icon. */}
          {!data.isObserved && (
          <Tooltip
            title={
              data.expanded
                ? "Hub on — click to hide what this brought in and stand it down"
                : "Hub: show what this is related to, and read its connected models and data quality"
            }
          >
            {/* `nodrag` so pressing the control works the card's buttons
                rather than starting to drag the card underneath them. */}
            <IconButton
              className="nodrag"
              size="small"
              aria-label={
                data.expanded ? "Hide what this is related to" : "Show what this is related to"
              }
              aria-pressed={data.expanded}
              onClick={(event) => {
                event.stopPropagation();
                data.onExpand(id);
              }}
              sx={{
                p: 0.25,
                color: data.expanded ? accent : "text.disabled",
                "&:hover": { color: accent },
              }}
            >
              {data.expanded ? (
                <HubIcon sx={{ fontSize: 15 }} />
              ) : (
                <HubOutlinedIcon sx={{ fontSize: 15 }} />
              )}
            </IconButton>
          </Tooltip>
          )}
          {!data.isObserved && (
            <Tooltip
              title={
                data.collapsed
                  ? `Show its ${data.children} hidden child${data.children === 1 ? "" : "ren"}`
                  : data.children > 0
                    ? "Collapse its children"
                    : "Show its children"
              }
            >
              <IconButton
                className="nodrag"
                size="small"
                aria-label={
                  data.collapsed
                    ? "Expand children"
                    : data.children > 0
                      ? "Collapse children"
                      : "Load children"
                }
                aria-expanded={data.children > 0 ? !data.collapsed : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onToggleChildren(id);
                }}
                sx={{
                  p: 0.1,
                  color: data.collapsed ? accent : "text.disabled",
                  "&:hover": { color: accent },
                }}
              >
                {data.collapsed ? (
                  <ChevronRightIcon sx={{ fontSize: 15 }} />
                ) : data.children > 0 ? (
                  <ExpandMoreIcon sx={{ fontSize: 15 }} />
                ) : (
                  <AccountTreeOutlinedIcon sx={{ fontSize: 13 }} />
                )}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Take off the diagram">
            <IconButton
              className="nodrag"
              size="small"
              aria-label="Take off the diagram"
              onClick={(event) => {
                event.stopPropagation();
                data.onRemove(id);
              }}
              sx={{ p: 0.25, color: "text.disabled", "&:hover": { color: "error.main" } }}
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Stack>
        {data.collapsed && data.children > 0 && (
          <Box
            sx={{
              position: "absolute",
              bottom: -8,
              right: 14,
              px: 0.6,
              borderRadius: 5,
              border: 1,
              borderColor: accent,
              bgcolor: "background.paper",
              color: accent,
              fontSize: 9.5,
              lineHeight: "14px",
              fontWeight: 700,
            }}
          >
            +{data.children} hidden
          </Box>
        )}
        {data.related > 0 && (
          <Box
            sx={{
              position: "absolute",
              top: -7,
              right: -7,
              px: 0.6,
              borderRadius: 5,
              bgcolor: accent,
              color: "#fff",
              fontSize: 9.5,
              lineHeight: "16px",
              fontWeight: 700,
            }}
          >
            {data.related}
          </Box>
        )}
      </Paper>
    </>
  );
});

const nodeTypes: NodeTypes = { impact: ImpactCard as unknown as NodeTypes[string] };

/**
 * The cards a connector has to go around, shared with every edge at once.
 *
 * Built from the committed positions rather than from the live drag: while a
 * card is being dragged only its own connectors move, so the rest of the
 * diagram is not re-routed sixty times a second, and everything settles the
 * moment the drag ends.
 */
type Obstacles = { byId: Map<string, Rect>; grid: Map<string, Rect[]> };
const OBSTACLE_CELL = 400;
const ObstacleContext = createContext<Obstacles>({ byId: new Map(), grid: new Map() });

function obstaclesOf(placements: CanvasState["placements"]): Obstacles {
  const byId = new Map<string, Rect>();
  const grid = new Map<string, Rect[]>();
  for (const placement of placements) {
    const rect = { id: placement.itemId, x: placement.x, y: placement.y, width: NODE_WIDTH, height: NODE_HEIGHT };
    byId.set(rect.id, rect);
    const x0 = Math.floor(rect.x / OBSTACLE_CELL);
    const x1 = Math.floor((rect.x + rect.width) / OBSTACLE_CELL);
    const y0 = Math.floor(rect.y / OBSTACLE_CELL);
    const y1 = Math.floor((rect.y + rect.height) / OBSTACLE_CELL);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const key = `${gx}:${gy}`;
        const cell = grid.get(key);
        if (cell) cell.push(rect);
        else grid.set(key, [rect]);
      }
    }
  }
  return { byId, grid };
}

/** The cards near a connector — the only ones that can be in its way. */
function near(obstacles: Obstacles, a: { x: number; y: number }, b: { x: number; y: number }): Rect[] {
  const pad = NODE_HEIGHT * 3;
  const x0 = Math.floor((Math.min(a.x, b.x) - NODE_WIDTH) / OBSTACLE_CELL);
  const x1 = Math.floor((Math.max(a.x, b.x) + NODE_WIDTH) / OBSTACLE_CELL);
  const y0 = Math.floor((Math.min(a.y, b.y) - pad) / OBSTACLE_CELL);
  const y1 = Math.floor((Math.max(a.y, b.y) + pad) / OBSTACLE_CELL);
  const found = new Map<string, Rect>();
  for (let gx = x0; gx <= x1; gx += 1) {
    for (let gy = y0; gy <= y1; gy += 1) {
      for (const rect of obstacles.grid.get(`${gx}:${gy}`) ?? []) found.set(rect.id, rect);
    }
  }
  return [...found.values()];
}

type RoutedEdgeData = { color: string; dashed: boolean; onPath: boolean; laneX?: number; labelOn?: "end" | "leg" };

/**
 * One connector: out of the right of its source, into the left of its target,
 * arrowhead at the target, routed around the cards in between.
 */
const RoutedEdge = memo(function RoutedEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  markerEnd,
  data,
}: EdgeProps) {
  const obstacles = useContext(ObstacleContext);
  const edgeData = (data ?? {}) as RoutedEdgeData;
  const route = useMemo(() => {
    const from = { x: sourceX, y: sourceY };
    const to = { x: targetX, y: targetY };
    return routeConnector(
      from,
      to,
      near(obstacles, from, to),
      { source: obstacles.byId.get(source), target: obstacles.byId.get(target) },
      { laneX: edgeData.laneX, labelOn: edgeData.labelOn },
    );
  }, [obstacles, source, target, sourceX, sourceY, targetX, targetY, edgeData.laneX, edgeData.labelOn]);
  const color = edgeData.color ?? "#90A4AE";
  return (
    <BaseEdge
      id={id}
      path={pathThrough(route.points)}
      markerEnd={markerEnd}
      label={label}
      labelX={route.label.x}
      labelY={route.label.y}
      labelStyle={{ fontSize: 10, fill: color, fontWeight: edgeData.onPath ? 700 : 400 }}
      labelShowBg
      labelBgStyle={{ fill: "#fff", fillOpacity: 0.92 }}
      labelBgPadding={[3, 1]}
      labelBgBorderRadius={3}
      interactionWidth={12}
      style={{
        stroke: color,
        strokeWidth: edgeData.onPath ? 2.6 : 1.4,
        // A projected or observed connection is drawn broken, because it is
        // not a fact governance stated.
        strokeDasharray: edgeData.dashed ? "5 4" : undefined,
      }}
    />
  );
});

const edgeTypes: EdgeTypes = { routed: RoutedEdge as unknown as EdgeTypes[string] };

function edgeOf(
  edge: GovernanceEdge,
  onPath: boolean,
  laneX?: number,
  labelOn?: "end" | "leg",
): Edge {
  const color = EDGE_COLOR[edge.edge_kind as DiagramEdgeKind] ?? "#90A4AE";
  return {
    id: edge.edge_id,
    type: "routed",
    source: edge.source_id,
    target: edge.target_id,
    label: edge.label,
    animated: false,
    data: { color, dashed: !edge.asserted, onPath, laneX, labelOn } satisfies RoutedEdgeData,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
  };
}

export type ImpactGraphCanvasProps = {
  canvas: CanvasState;
  /**
   * Changes when a different reading is opened.
   *
   * The canvas is one long-lived component, so opening a saved view does not
   * remount it and `fitView` — which only runs on init — never fires again.
   * Open a five-node view after a five-hundred-node one and the viewport is
   * still parked where the big diagram left it: the cards are on screen in
   * the data and nowhere on screen in fact.
   */
  fitKey?: string;
  /** Cards to bring into view, with a counter that changes on each request. */
  focus?: { key: number; ids: string[] };
  /** The ids whose "show what this is related to" is currently on. */
  expandedIds: Set<string>;
  /** An item dragged out of the picker and dropped at a point on the canvas. */
  onDropItem: (raw: string, at: { x: number; y: number }) => void;
  /** Arrange the visible cards around the focus. Absent hides the control. */
  onRelayout?: () => void;
  degrees: Record<string, number>;
  seedIds: string[];
  /** Cards on the path to a model the reader asked about; drawn ringed. */
  highlightIds?: string[];
  /** Children each card has on the canvas, for its fold control. */
  childCounts?: Record<string, number>;
  /** Cards whose children are folded away. */
  collapsedIds?: ReadonlySet<string>;
  onToggleChildren?: (itemId: string) => void;
  /** The card the diagram is arranged around; drawn with the heaviest border. */
  focusId?: string | null;
  /** Double-clicking a card makes it the focus. */
  onFocus?: (itemId: string) => void;
  onMove: (itemId: string, x: number, y: number) => void;
  onRemove: (itemId: string) => void;
  onExpand: (itemId: string) => void;
  onSelectionChange: (itemIds: string[]) => void;
};

function Canvas({
  canvas,
  fitKey,
  focus,
  expandedIds,
  onDropItem,
  onRelayout,
  degrees,
  seedIds,
  highlightIds,
  focusId,
  onFocus,
  childCounts,
  collapsedIds,
  onToggleChildren,
  onMove,
  onRemove,
  onExpand,
  onSelectionChange,
}: ImpactGraphCanvasProps) {
  const seeds = useMemo(() => new Set(seedIds), [seedIds]);
  const onPath = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);

  /**
   * Hold the callbacks still.
   *
   * They arrive as fresh closures on every parent render, and they live inside
   * each node's `data`. Left alone, that makes every node object new on every
   * render: the memoised cards all re-render, and — worse — ReactFlow throws
   * away the measurements it had just taken and starts again, so with
   * `onlyRenderVisibleElements` on it never settles long enough to place a
   * single edge. The canvas draws its cards and not one of the lines between
   * them, which looks like a data problem and is not.
   *
   * A ref keeps the identity stable while still calling through to whatever
   * the latest render passed in.
   */
  const handlers = useRef({ onRemove, onExpand, onSelectionChange, onFocus, onToggleChildren });
  handlers.current = { onRemove, onExpand, onSelectionChange, onFocus, onToggleChildren };
  const toggleChildrenOf = useCallback((id: string) => handlers.current.onToggleChildren?.(id), []);
  const focusItem = useCallback((_event: unknown, node: Node) => handlers.current.onFocus?.(node.id), []);
  const removeItem = useCallback((id: string) => handlers.current.onRemove(id), []);
  const expandItem = useCallback((id: string) => handlers.current.onExpand(id), []);
  /*
   * The selection handler is held still for a second reason.
   *
   * ReactFlow re-subscribes whenever this prop's identity changes and reports
   * the selection again as it does. Passed inline, that is once per render,
   * and each report hands the parent a brand-new array: the parent stores it,
   * re-renders, and the whole thing goes round again — a render loop that
   * never settles and, because nothing ever settles, a canvas with no lines
   * drawn on it.
   */
  const selectionChanged = useCallback(
    ({ nodes: selected }: { nodes: Node[] }) =>
      handlers.current.onSelectionChange(selected.map((node) => node.id)),
    [],
  );

  const { fitView, zoomIn, zoomOut, screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    // One frame's grace so the newly built nodes are in the store before the
    // viewport is fitted around them.
    const timer = window.setTimeout(() => void fitView({ padding: 0.2, maxZoom: 1, duration: 200 }), 80);
    return () => window.clearTimeout(timer);
  }, [fitKey, fitView]);

  const focusKey = focus?.key ?? 0;
  const focusIds = focus?.ids;
  useEffect(() => {
    if (!focusKey || !focusIds || focusIds.length === 0) return;
    // Fit *these* cards, not the whole canvas: a reader who has zoomed into a
    // corner wants to be shown what they just added, not zoomed back out to
    // everything they were already ignoring.
    const timer = window.setTimeout(
      () =>
        void fitView({
          nodes: focusIds.map((id) => ({ id })),
          padding: 0.3,
          maxZoom: 1,
          duration: 250,
        }),
      80,
    );
    return () => window.clearTimeout(timer);
  }, [focusKey, focusIds, fitView]);

  /**
   * Keep each card's node object alive between rebuilds.
   *
   * Every canvas change — adding one node, taking one off, expanding one —
   * rebuilds this list. Build a fresh object for each card and `memo` on the
   * card can never skip: one removal re-renders all five hundred. The cache
   * rebuilds a node only when something that card actually shows has changed,
   * so a removal costs one re-render and not the whole canvas.
   */
  const flowStore = useStoreApi();
  const nodeCache = useRef(new Map<string, { key: string; node: Node }>());

  const builtNodes = useMemo<Node[]>(() => {
    const next = new Map<string, { key: string; node: Node }>();
    const out: Node[] = [];

    for (const placement of canvas.placements) {
      const item = canvas.items[placement.itemId];
      if (!item) continue;

      const isElement = item.item_kind === GOVERNANCE_ITEM_KIND.SUPPORT_DOMAIN_ELEMENT;
      const isModel = item.item_kind === GOVERNANCE_ITEM_KIND.HIERARCHY_MODEL;
      // Observed cards travel in the same map as governance items — the canvas
      // holds a reading, and a reading mixes the two — but they are not one of
      // the backend's three kinds, so the comparison is widened rather than
      // the contract.
      const isObserved = (item.item_kind as string) === OBSERVED_ITEM_KIND;
      const isSeed = seeds.has(placement.itemId);
      const isOnPath = onPath.has(placement.itemId);
      const isFocus = placement.itemId === focusId;
      const expanded = expandedIds.has(placement.itemId);
      const related = degrees[placement.itemId] ?? 0;
      const children = childCounts?.[placement.itemId] ?? 0;
      const collapsed = collapsedIds?.has(placement.itemId) ?? false;
      const typeName = item.type_name ?? "";
      const key = [
        placement.x,
        placement.y,
        item.name,
        typeName,
        item.model_name,
        isElement,
        isModel,
        isObserved,
        isSeed,
        isOnPath,
        isFocus,
        expanded,
        related,
        children,
        collapsed,
      ].join("\u0000");

      const cached = nodeCache.current.get(placement.itemId);
      if (cached && cached.key === key) {
        next.set(placement.itemId, cached);
        out.push(cached.node);
        continue;
      }

      const node: Node = {
        id: placement.itemId,
        type: "impact",
        position: { x: placement.x, y: placement.y },
        // Stated, not measured: every card is the same fixed size, so
        // ReactFlow is spared measuring several hundred of them.
        //
        // Stating `measured` also skips the pass that records where each
        // handle sits, and a node with no handle positions has no line drawn
        // to it. That is what the `updateNodeInternals` pass below puts back —
        // the cheap half of the work, without the expensive half.
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
        data: {
          label: item.name,
          typeName,
          modelName: item.model_name,
          isElement,
          isModel,
          isObserved,
          isSeed,
          isOnPath,
          isFocus,
          expanded,
          related,
          children,
          collapsed,
          onRemove: removeItem,
          onExpand: expandItem,
          onToggleChildren: toggleChildrenOf,
        } satisfies ImpactNodeData,
      };

      next.set(placement.itemId, { key, node });
      out.push(node);
    }

    nodeCache.current = next;
    return out;
  }, [canvas.placements, canvas.items, degrees, seeds, onPath, focusId, expandedIds, childCounts, collapsedIds, removeItem, expandItem, toggleChildrenOf]);

  const obstacles = useMemo(() => obstaclesOf(canvas.placements), [canvas.placements]);
  const lanes = useMemo(
    () => gapLanes(Object.values(canvas.edges), obstacles.byId),
    [canvas.edges, obstacles],
  );
  const labels = useMemo(
    () => labelPlacement(Object.values(canvas.edges), obstacles.byId),
    [canvas.edges, obstacles],
  );

  const edges = useMemo<Edge[]>(
    () =>
      Object.values(canvas.edges).map((edge) =>
        edgeOf(
          edge,
          onPath.has(edge.source_id) && onPath.has(edge.target_id),
          lanes.get(edge.edge_id),
          labels.get(edge.edge_id),
        ),
      ),
    [canvas.edges, onPath, lanes, labels],
  );

  /**
   * ReactFlow owns the live node array; the canvas owns the saved one.
   *
   * This separation is not ceremony. In a controlled flow every change —
   * including the *measurement* of each card once it has been laid out — is
   * dispatched through `onNodesChange`, and a handler that only watches for
   * drags silently drops those measurements. Unmeasured nodes have no
   * geometry, so `onlyRenderVisibleElements` cannot place a single edge, and
   * the canvas draws its cards with none of the lines between them. That bug
   * is invisible in the data and total on screen, which is why the measured
   * state lives here and the committed positions live in the canvas.
   */
  const [flowNodes, setFlowNodes, applyNodeChanges] = useNodesState<Node>(builtNodes);

  useEffect(() => {
    /*
     * Fold the rebuild into the nodes ReactFlow is already holding.
     *
     * Two things live on a node that the rebuild knows nothing about: the
     * reader's selection, and the measurements ReactFlow took when the card
     * first appeared — its size and, crucially, where its handles sit. Handing
     * it a freshly built array threw both away. The selection came back a
     * frame later as "my click did nothing"; the measurements never came back
     * at all, because nothing had remounted to measure, and a node with no
     * handle positions has no line drawn to it. The diagram kept every
     * relationship in its data and showed none of them.
     *
     * So each card is updated in place — new position, new data — and
     * everything ReactFlow learned about it is carried forward. A card that
     * is genuinely new has nothing to carry and is taken as built.
     */
    setFlowNodes((current) => {
      const live = new Map(current.map((node) => [node.id, node]));
      return builtNodes.map((node) => {
        const existing = live.get(node.id);
        return existing
          ? { ...existing, position: node.position, data: node.data }
          : node;
      });
    });
  }, [builtNodes, setFlowNodes]);

  /**
   * Keep every card's handle positions up to date, for as long as the canvas
   * is open.
   *
   * Stating a card's size spares ReactFlow measuring it, but it also skips the
   * pass that records where its handles are — and an edge whose ends have no
   * handle positions is held in the store and drawn nowhere. A diagram that
   * keeps every relationship in its data and shows none of them is the one
   * bug a reader cannot work around.
   *
   * So the positions are read off the elements themselves, with `force`, since
   * without it the request is dropped for any card ReactFlow believes it has
   * already measured — which is every card here. Doing that once per rebuild
   * was not enough: a card can be handed back with its internals cleared by
   * work that does not change the array this effect would watch. Instead the
   * store is watched, and any card that has lost its handle positions gets
   * them back on the next frame.
   *
   * A card gets a handful of attempts and no more: the first can land while
   * the card is still being laid out and come back with nothing, and without
   * a second there would be no line; without a limit, a card that can never
   * be measured would be asked forever.
   */
  useEffect(() => {
    const attempts = new Map<string, { element: HTMLDivElement; tries: number }>();
    const MAX_TRIES = 5;
    let timer = 0;

    const measureWhatIsMissing = () => {
      timer = 0;
      const { nodeLookup, updateNodeInternals } = flowStore.getState();
      const updates = new Map<
        string,
        { id: string; nodeElement: HTMLDivElement; force: boolean }
      >();

      for (const node of nodeLookup.values()) {
        if (node.internals?.handleBounds) continue;
        const element = document.querySelector<HTMLDivElement>(
          `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
        );
        // Off-screen cards are not in the DOM at all — `onlyRenderVisibleElements`
        // — and are measured when they scroll in.
        if (!element) continue;
        const sofar = attempts.get(node.id);
        const tries = sofar && sofar.element === element ? sofar.tries : 0;
        if (tries >= MAX_TRIES) continue;
        attempts.set(node.id, { element, tries: tries + 1 });
        updates.set(node.id, { id: node.id, nodeElement: element, force: true });
      }

      if (updates.size > 0) updateNodeInternals(updates);
    };

    /*
     * A timer, not an animation frame.
     *
     * `requestAnimationFrame` does not fire while the tab is in the
     * background, so a diagram opened in a window the reader is not looking
     * at would never be measured — and would still have no lines in it when
     * they came back. A timer runs either way; the short delay is there to
     * let a card that has only just mounted lay itself out first.
     */
    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(measureWhatIsMissing, 16);
    };

    schedule();
    const unsubscribe = flowStore.subscribe(schedule);
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [flowStore]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      applyNodeChanges(changes);
      for (const change of changes) {
        // Committed at the end of a drag, not during it: writing every
        // intermediate position back would rebuild the whole canvas on each
        // mouse move.
        if (change.type === "position" && change.position && change.dragging === false) {
          onMove(change.id, change.position.x, change.position.y);
        }
      }
    },
    [applyNodeChanges, onMove],
  );

  return (
    <ObstacleContext.Provider value={obstacles}>
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onNodeDoubleClick={focusItem}
      zoomOnDoubleClick={false}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(IMPACT_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const raw = event.dataTransfer.getData(IMPACT_DRAG_TYPE);
        if (!raw) return;
        event.preventDefault();
        // Flow coordinates, not screen ones: the canvas is panned and zoomed,
        // and a card dropped at the pointer has to land under the pointer.
        const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        // The pointer should end up on the middle of the card, not its corner.
        onDropItem(raw, { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 });
      }}
      onSelectionChange={selectionChanged}
      // Nothing on this canvas creates governance. These are the switches that
      // make that true rather than merely intended.
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      nodesDraggable
      // At several hundred cards, drawing the ones nobody can see is the single
      // largest avoidable cost.
      onlyRenderVisibleElements
      minZoom={0.1}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      style={{ background: "#FAFBFC" }}
    >
      <Background gap={18} size={1} color="#E3E8EF" />
      {/* The same three controls, in the same order, as the Structure diagram. */}
      <Panel position="top-right">
        <Paper variant="outlined" sx={{ display: "flex", flexDirection: "column", p: 0.25 }}>
          <Tooltip title="Zoom in" placement="left">
            <IconButton size="small" aria-label="Zoom in" onClick={() => void zoomIn({ duration: 200 })}>
              <ZoomInOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Zoom out" placement="left">
            <IconButton size="small" aria-label="Zoom out" onClick={() => void zoomOut({ duration: 200 })}>
              <ZoomOutOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {onRelayout && (
            <Tooltip title="Re-layout: upstream left, downstream right" placement="left">
              <IconButton size="small" aria-label="Re-layout the diagram" onClick={onRelayout}>
                <AutoAwesomeMosaicOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Fit the diagram on screen" placement="left">
            <IconButton
              size="small"
              aria-label="Fit the diagram on screen"
              onClick={() => void fitView({ padding: 0.2, maxZoom: 1, duration: 200 })}
            >
              <CenterFocusStrongOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Paper>
      </Panel>
    </ReactFlow>
    </ObstacleContext.Provider>
  );
}

export function ImpactGraphCanvas(props: ImpactGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
