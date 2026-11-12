import { DiagramToolButton } from "@/shared/workspace/DiagramToolButton";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  type Connection,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AccountTreeOutlined,
  CloseRounded,
  CropFreeOutlined,
  ExpandLessRounded,
  ExpandMoreRounded,
  LayersOutlined,
  LockOutlined,
  NearMeOutlined,
  PanToolOutlined,
  SearchRounded,
  SortByAlphaRounded,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@mui/icons-material";
import { Box, IconButton, InputBase, Stack, Tooltip, Typography } from "@mui/material";
import type { ElementInstance, ElementRelationshipInstance } from "@/features/structure/api/structureApi";
import type { BadgeCustomization, SupportDomainRelationshipSummary } from "@/features/model/domain/types";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import { linkableRelationships, linkKeys, relationshipKindLabel, validTargetIds } from "./workspace/sdInstanceLinks";

/**
 * SWS › Support Domain Diagram: one card per element type, listing its
 * instances. Links can be drawn here — drag from the dot beside an instance
 * onto another instance. Drawn links are diagram-only: the relationships
 * themselves are inherited from the model and are not changed by drawing. Only the instances the model lets
 * it relate to (by the relationships the Model Workspace defines between
 * element types, in that direction) are highlighted and accept the drop; when
 * the model relates the two types in more than one way, the relationship is
 * chosen. The model's own relationships can be shown behind, greyed and read
 * only.
 *
 * Large types stay readable: each card can be searched, sorted and collapsed,
 * shows its first rows only until asked for all, and always says how many of
 * its instances are hidden. A link to a hidden instance is drawn to the card's
 * "hidden" row and counted there, rather than dropped.
 */

const FIT_VIEW_PADDING = 0.2;
const FIT_VIEW_DELAY_MS = 50;
const VIEWPORT_DURATION_MS = 300;
const ROW_LIMIT = 10;
/** Below this many instances a card needs no search or sort. */
const TOOLS_FROM = 6;
const MODEL_LAYER_KEY = "pdp-sws-sd-diagram-model-layer";
const HIDDEN_HANDLE = { opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0, background: "transparent", border: "none" };
const TOOLBAR_ITEMS = [
  { key: "select", label: "Select", icon: NearMeOutlined },
  { key: "pan", label: "Pan", icon: PanToolOutlined },
  { key: "zoomIn", label: "Zoom In", icon: ZoomInOutlined },
  { key: "zoomOut", label: "Zoom Out", icon: ZoomOutOutlined },
  { key: "fit", label: "Fit", icon: CropFreeOutlined },
  { key: "autoLayout", label: "Auto Layout", icon: AccountTreeOutlined },
  { key: "lockDiagram", label: "Lock Diagram", icon: LockOutlined },
  { key: "modelLayer", label: "Model Relationships", icon: LayersOutlined },
] as const;

type ToolbarAction = (typeof TOOLBAR_ITEMS)[number]["key"];
type InteractionMode = "select" | "pan";
type ElementTypeSummary = {
  id: string;
  name: string;
  badge?: BadgeCustomization;
  description?: string;
  position?: { x: number | null; y: number | null };
};

type CardView = { query: string; sort: "az" | "za"; collapsed: boolean; showAll: boolean };
const DEFAULT_VIEW: CardView = { query: "", sort: "az", collapsed: false, showAll: false };

/** The instances a card shows, in order, and how many it hides. */
function visibleInstances(instances: ElementInstance[], view: CardView) {
  if (view.collapsed) return { shown: [] as ElementInstance[], matching: instances.length, hidden: instances.length };
  const query = view.query.trim().toLowerCase();
  const matching = (query ? instances.filter((instance) => instance.name.toLowerCase().includes(query)) : instances.slice()).sort((a, b) =>
    view.sort === "az" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
  );
  const shown = view.showAll ? matching : matching.slice(0, ROW_LIMIT);
  return { shown, matching: matching.length, hidden: instances.length - shown.length };
}

type Linking = { sourceId: string; valid: Set<string> };
type CardData = {
  typeName: string;
  badge?: BadgeCustomization;
  instances: ElementInstance[];
  view: CardView;
  onView: (patch: Partial<CardView>) => void;
  onSelectInstance: (instance: ElementInstance) => void;
  selectedInstanceId: string | null;
  /** This type is the source of a relationship the model defines, so its instances can start a link. */
  canStart: boolean;
  locked: boolean;
  linking: Linking | null;
};

const ROW_HEIGHT = 26;

const ElementTypeCard = memo(function ElementTypeCard({ id, data, selected }: NodeProps) {
  const d = data as CardData;
  const updateNodeInternals = useUpdateNodeInternals();
  const badgeColor = d.badge?.badgeColor ?? "#757575";
  const { shown, matching, hidden } = visibleInstances(d.instances, d.view);
  const signature = `${d.view.collapsed}|${shown.map((instance) => instance.instance_id).join(",")}|${hidden}`;
  useEffect(() => updateNodeInternals(id), [id, signature, updateNodeInternals]);

  const linking = d.linking;
  const cardHasTarget = linking ? d.instances.some((instance) => linking.valid.has(instance.instance_id)) : true;
  const filtered = d.view.query.trim() !== "" && !d.view.collapsed;

  return (
    <Box
      sx={{
        background: "#fff",
        border: "1.5px solid",
        borderColor: selected ? "primary.main" : linking && cardHasTarget ? "success.main" : "#e0e0e0",
        borderRadius: 2,
        width: 240,
        boxShadow: selected ? "0 0 0 3px rgba(25,118,210,0.18), 0 2px 8px rgba(0,0,0,0.08)" : "0 2px 8px rgba(0,0,0,0.08)",
        opacity: linking && !cardHasTarget && !d.instances.some((instance) => instance.instance_id === linking.sourceId) ? 0.45 : 1,
        transition: "opacity 120ms, border-color 120ms",
        fontFamily: "inherit",
        position: "relative",
      }}
    >
      {/* The model's own relationships attach to the header. */}
      <Handle type="target" id="type-t" position={Position.Left} style={{ ...HIDDEN_HANDLE, top: 20 }} isConnectable={false} />
      <Handle type="source" id="type-s" position={Position.Right} style={{ ...HIDDEN_HANDLE, top: 20 }} isConnectable={false} />
      <Box sx={{ bgcolor: badgeColor, px: 1.25, py: 0.75, display: "flex", alignItems: "center", gap: 1, borderRadius: "6px 6px 0 0" }}>
        <Box sx={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CanonicalBadge badge={d.badge} fallbackText={d.typeName} size={22} />
        </Box>
        <Typography variant="caption" fontWeight={700} color="#fff" noWrap sx={{ flex: 1, minWidth: 0 }}>{d.typeName}</Typography>
        <Typography variant="caption" color="rgba(255,255,255,0.85)" sx={{ flexShrink: 0 }}>{d.instances.length}</Typography>
        {d.instances.length > 0 && (
          <Tooltip title={d.view.collapsed ? "Expand" : "Collapse"}>
            <IconButton
              size="small"
              className="nodrag"
              aria-label={d.view.collapsed ? `Expand ${d.typeName}` : `Collapse ${d.typeName}`}
              onClick={(event) => { event.stopPropagation(); d.onView({ collapsed: !d.view.collapsed }); }}
              sx={{ color: "#fff", p: 0.25 }}
            >
              {d.view.collapsed ? <ExpandMoreRounded fontSize="small" /> : <ExpandLessRounded fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {!d.view.collapsed && d.instances.length >= TOOLS_FROM && (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1, pt: 0.75 }}>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", gap: 0.5, border: 1, borderColor: "divider", borderRadius: 1, px: 0.75, height: 26 }}>
            <SearchRounded sx={{ fontSize: 15, color: "text.secondary" }} />
            <InputBase
              className="nodrag nopan nowheel"
              value={d.view.query}
              placeholder={`Search ${d.typeName}…`}
              onChange={(event) => d.onView({ query: event.target.value })}
              onKeyDown={(event) => event.stopPropagation()}
              inputProps={{ "aria-label": `Search ${d.typeName}` }}
              sx={{ fontSize: 12, flex: 1 }}
            />
            {d.view.query && (
              <IconButton size="small" className="nodrag" aria-label="Clear search" onClick={() => d.onView({ query: "" })} sx={{ p: 0.25 }}>
                <CloseRounded sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
          <Tooltip title={d.view.sort === "az" ? "Sorted A–Z — click for Z–A" : "Sorted Z–A — click for A–Z"}>
            <IconButton
              size="small"
              className="nodrag"
              aria-label="Sort instances"
              onClick={() => d.onView({ sort: d.view.sort === "az" ? "za" : "az" })}
              sx={{ p: 0.5, transform: d.view.sort === "za" ? "scaleY(-1)" : undefined }}
            >
              <SortByAlphaRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
      <Box sx={{ px: 1, py: d.view.collapsed ? 0 : 0.75 }}>
        {d.instances.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ fontStyle: "italic", px: 0.5 }}>No instances</Typography>
        ) : filtered && matching === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic", px: 0.5 }}>No instance matches “{d.view.query}”</Typography>
        ) : (
          shown.map((instance) => {
            const isSource = linking?.sourceId === instance.instance_id;
            const isValid = linking ? linking.valid.has(instance.instance_id) : false;
            const isSelected = d.selectedInstanceId === instance.instance_id;
            return (
              <Box
                key={instance.instance_id}
                onClick={() => d.onSelectInstance(instance)}
                sx={{
                  position: "relative",
                  height: ROW_HEIGHT,
                  px: 0.75,
                  borderRadius: 1,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  bgcolor: isSource ? "rgba(25,118,210,0.12)" : isValid ? "rgba(46,125,50,0.12)" : isSelected ? "action.selected" : "transparent",
                  outline: isValid ? "1px solid" : "none",
                  outlineColor: "success.main",
                  opacity: linking && !isSource && !isValid ? 0.35 : 1,
                  "&:hover": { bgcolor: isValid ? "rgba(46,125,50,0.2)" : "action.hover" },
                  "&:hover .sd-link-start": { opacity: 1 },
                }}
              >
                {/* Drop zone: the whole row while a link is being drawn. */}
                <Handle
                  type="target"
                  id={`t:${instance.instance_id}`}
                  position={Position.Left}
                  isConnectable={isValid}
                  style={
                    linking
                      ? { ...HIDDEN_HANDLE, left: 0, top: 0, width: "100%", height: "100%", transform: "none", borderRadius: 4, pointerEvents: isValid ? "all" : "none" }
                      : { ...HIDDEN_HANDLE, left: -9 }
                  }
                />
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: badgeColor, flexShrink: 0 }} />
                <Typography variant="caption" color="text.primary" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: isSelected || isSource ? 700 : 400 }}>{instance.name}</Typography>
                <Handle
                  type="source"
                  id={`s:${instance.instance_id}`}
                  position={Position.Right}
                  isConnectable={d.canStart && !d.locked && !linking}
                  className={d.canStart && !d.locked ? "sd-link-start" : undefined}
                  title={d.canStart && !d.locked ? `Drag to relate ${instance.name} to another instance` : undefined}
                  style={
                    d.canStart && !d.locked
                      ? { width: 10, height: 10, right: -6, background: "#fff", border: `2px solid ${badgeColor}`, opacity: isSource ? 1 : 0.35, cursor: "crosshair", transition: "opacity 120ms" }
                      : { ...HIDDEN_HANDLE, right: -9 }
                  }
                />
              </Box>
            );
          })
        )}
      </Box>
      {hidden > 0 && (
        <Box sx={{ position: "relative", px: 1.75, pb: 0.75, pt: d.view.collapsed ? 0.75 : 0, display: "flex", alignItems: "center", gap: 1 }}>
          {/* Links to instances this card hides are drawn to this row. */}
          <Handle type="target" id="more-t" position={Position.Left} style={{ ...HIDDEN_HANDLE, left: -1 }} isConnectable={false} />
          <Handle type="source" id="more-s" position={Position.Right} style={{ ...HIDDEN_HANDLE, right: -1 }} isConnectable={false} />
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {d.view.collapsed
              ? `${hidden} instance${hidden === 1 ? "" : "s"} hidden`
              : filtered
                ? `${hidden} hidden by search`
                : `${hidden} more hidden`}
          </Typography>
          {!d.view.collapsed && !filtered && (
            <Typography
              component="button"
              variant="caption"
              className="nodrag"
              onClick={() => d.onView({ showAll: true })}
              sx={{ border: 0, background: "none", color: "primary.main", cursor: "pointer", p: 0, fontWeight: 600 }}
            >
              Show all
            </Typography>
          )}
        </Box>
      )}
      {!d.view.collapsed && d.view.showAll && matching > ROW_LIMIT && (
        <Box sx={{ px: 1.75, pb: 0.75 }}>
          <Typography
            component="button"
            variant="caption"
            className="nodrag"
            onClick={() => d.onView({ showAll: false })}
            sx={{ border: 0, background: "none", color: "primary.main", cursor: "pointer", p: 0, fontWeight: 600 }}
          >
            Show fewer
          </Typography>
        </Box>
      )}
    </Box>
  );
});

const nodeTypes = { elementTypeGroup: ElementTypeCard };

type LinkEdgeData = {
  label: string;
  links: ElementRelationshipInstance[];
  emphasis: "normal" | "strong" | "faint";
  onDelete?: (link: ElementRelationshipInstance) => void;
};

/** A stored instance link (or several, to instances the card hides). */
function InstanceLinkEdge(props: EdgeProps) {
  const d = props.data as LinkEdgeData;
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getBezierPath(props);
  const single = d.links.length === 1;
  const strong = props.selected || hover || d.emphasis === "strong";
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={16}
        style={{ stroke: strong ? "#1565c0" : "#5c6bc0", strokeWidth: strong ? 2.25 : 1.5, opacity: d.emphasis === "faint" ? 0.25 : 1 }}
      />
      <EdgeLabelRenderer>
        <Box
          className="nodrag nopan"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          sx={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            fontSize: 10,
            fontWeight: 600,
            color: strong ? "#0d47a1" : "#3949ab",
            bgcolor: "rgba(255,255,255,0.94)",
            border: "1px solid",
            borderColor: strong ? "#1565c0" : "rgba(92,107,192,0.4)",
            borderRadius: 1,
            px: 0.5,
            py: 0.1,
            opacity: d.emphasis === "faint" ? 0.35 : 1,
            whiteSpace: "nowrap",
          }}
          title={
            single
              ? `${d.links[0].source_instance_name} ${d.label} ${d.links[0].target_instance_name}`
              : d.links.map((link) => `${link.source_instance_name} → ${link.target_instance_name}`).join("\n")
          }
        >
          {d.label}
          {!single && <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>×{d.links.length}</Box>}
          {single && d.onDelete && (hover || props.selected) && (
            <IconButton
              size="small"
              aria-label="Remove relationship"
              onClick={(event) => { event.stopPropagation(); d.onDelete?.(d.links[0]); }}
              sx={{ p: 0, ml: 0.25, color: "error.main" }}
            >
              <CloseRounded sx={{ fontSize: 13 }} />
            </IconButton>
          )}
        </Box>
      </EdgeLabelRenderer>
    </>
  );
}

/** One of the model's relationships between element types — background, read only. */
function ModelRelationshipEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} interactionWidth={0} style={{ stroke: "#bdbdbd", strokeDasharray: "6 5", strokeWidth: 1.25 }} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            fontSize: 10,
            color: "#9e9e9e",
            background: "rgba(250,250,250,0.9)",
            padding: "1px 4px",
            borderRadius: 4,
            pointerEvents: "none",
            fontStyle: "italic",
            whiteSpace: "nowrap",
          }}
        >
          {String(props.label ?? "")} →
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes: EdgeTypes = { instanceLink: InstanceLinkEdge, modelRelationship: ModelRelationshipEdge };

const NODE_WIDTH = 240;
const NODE_GAP_X = 160;
const NODE_GAP_Y = 40;
function cardHeight(count: number) {
  return 40 + (count >= TOOLS_FROM ? 34 : 0) + 12 + Math.max(1, Math.min(count, ROW_LIMIT)) * ROW_HEIGHT + (count > ROW_LIMIT ? 28 : 0);
}

function assignColumns(typeIds: string[], relationships: SupportDomainRelationshipSummary[]) {
  const columns = new Map<string, number>();
  const incoming = new Map(typeIds.map((id) => [id, 0]));
  const children = new Map(typeIds.map((id) => [id, [] as string[]]));
  relationships.forEach((relationship) => {
    if (incoming.has(relationship.sourceElementId) && incoming.has(relationship.targetElementId)) {
      incoming.set(relationship.targetElementId, (incoming.get(relationship.targetElementId) ?? 0) + 1);
      children.get(relationship.sourceElementId)?.push(relationship.targetElementId);
    }
  });
  const queue = typeIds.filter((id) => incoming.get(id) === 0);
  queue.forEach((id) => columns.set(id, 0));
  let guard = typeIds.length * typeIds.length + 10;
  while (queue.length && guard-- > 0) {
    const current = queue.shift()!;
    const column = columns.get(current) ?? 0;
    children.get(current)?.forEach((child) => {
      if ((columns.get(child) ?? -1) < column + 1 && column + 1 < typeIds.length) {
        columns.set(child, column + 1);
        queue.push(child);
      }
    });
  }
  typeIds.forEach((id) => { if (!columns.has(id)) columns.set(id, 0); });
  return columns;
}

/**
 * Where each card sits: a column by relationship depth, with room between
 * columns for the links, or where it was last put on the model's diagram. The Model
 * Workspace's layout is not used: its cards are short and set side by side, so
 * here the links between instances would be hidden under them.
 */
function computePositions(elementTypes: ElementTypeSummary[], counts: Map<string, number>, relationships: SupportDomainRelationshipSummary[], saved: CardLayout) {
  const columns = assignColumns(elementTypes.map((type) => type.id), relationships);
  const nextY = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const type of elementTypes) {
    const column = columns.get(type.id) ?? 0;
    const y = nextY.get(column) ?? 60;
    nextY.set(column, y + cardHeight(counts.get(type.id) ?? 0) + NODE_GAP_Y);
    positions.set(
      type.id,
      saved[type.id] ?? { x: 60 + column * (NODE_WIDTH + NODE_GAP_X), y },
    );
  }
  if (Object.keys(saved).length > 0) separateOverlaps(positions, counts);
  return positions;
}

/**
 * A saved position was chosen when the card listed fewer instances; a card that
 * has grown since could cover the one below it. Move a card down, never sideways, until it
 * clears the cards above it, so nothing is hidden underneath another card.
 */
function separateOverlaps(positions: Map<string, { x: number; y: number }>, counts: Map<string, number>) {
  const placed: Array<{ x: number; y: number; h: number }> = [];
  const order = Array.from(positions.entries()).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x);
  for (const [id, position] of order) {
    const h = cardHeight(counts.get(id) ?? 0);
    let y = position.y;
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of placed) {
        const overlapX = position.x < other.x + NODE_WIDTH && other.x < position.x + NODE_WIDTH;
        const overlapY = y < other.y + other.h + NODE_GAP_Y / 2 && other.y < y + h;
        if (overlapX && overlapY) {
          y = other.y + other.h + NODE_GAP_Y / 2;
          moved = true;
        }
      }
    }
    positions.set(id, { x: position.x, y });
    placed.push({ x: position.x, y, h });
  }
}

function readModelLayer() {
  try {
    return window.localStorage.getItem(MODEL_LAYER_KEY) !== "off";
  } catch {
    return true;
  }
}

export type CardLayout = Record<string, { x: number; y: number }>;

type Props = {
  /**
   * Where the cards sit, as saved on the model's diagram (its nodes). Empty
   * means the automatic layout.
   */
  savedLayout: CardLayout;
  /** A card was moved (the whole layout), or the layout was reset (null). */
  onLayoutChange: (layout: CardLayout | null) => void;
  elementTypes: ElementTypeSummary[];
  instances: ElementInstance[];
  relationships: SupportDomainRelationshipSummary[];
  links: ElementRelationshipInstance[];
  selectedInstanceId: string | null;
  onSelectInstance: (instance: ElementInstance) => void;
  onSelectElementType: (elementTypeId: string | null) => void;
  selectedElementTypeId: string | null;
  onLink: (source: ElementInstance, target: ElementInstance) => void;
  onRemoveLink: (link: ElementRelationshipInstance) => void;
};

function SupportDomainInstanceDiagramInner(props: Props) {
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("select");
  const [diagramLocked, setDiagramLocked] = useState(false);
  const [showModel, setShowModel] = useState(readModelLayer);
  const [views, setViews] = useState<Record<string, CardView>>({});
  const [linking, setLinking] = useState<Linking | null>(null);
  const { fitView, zoomIn, zoomOut, getNodes, getInternalNode } = useReactFlow();

  const instancesByType = useMemo(() => {
    const map = new Map<string, ElementInstance[]>(props.elementTypes.map((type) => [type.id, []]));
    for (const instance of props.instances) map.get(instance.element_type_id)?.push(instance);
    return map;
  }, [props.elementTypes, props.instances]);
  const instanceById = useMemo(() => new Map(props.instances.map((instance) => [instance.instance_id, instance])), [props.instances]);
  const linkable = useMemo(() => linkableRelationships(props.relationships), [props.relationships]);
  const sourceTypes = useMemo(() => new Set(linkable.map((rel) => rel.sourceElementId)), [linkable]);
  const existing = useMemo(() => linkKeys(props.links), [props.links]);
  const kindOf = useMemo(() => new Map(props.relationships.map((rel) => [rel.id, relationshipKindLabel(rel.relationshipKind)])), [props.relationships]);

  const viewOf = useCallback((typeId: string) => views[typeId] ?? DEFAULT_VIEW, [views]);
  const setView = useCallback((typeId: string, patch: Partial<CardView>) => {
    setViews((current) => {
      const next = { ...(current[typeId] ?? DEFAULT_VIEW), ...patch };
      if (patch.query !== undefined) next.showAll = false;
      return { ...current, [typeId]: next };
    });
  }, []);
  const onViewHandlers = useMemo(
    () => new Map(props.elementTypes.map((type) => [type.id, (patch: Partial<CardView>) => setView(type.id, patch)])),
    [props.elementTypes, setView],
  );

  const counts = useMemo(() => new Map(props.elementTypes.map((type) => [type.id, instancesByType.get(type.id)?.length ?? 0])), [props.elementTypes, instancesByType]);
  const initialPositions = useMemo(
    () => computePositions(props.elementTypes, counts, props.relationships, props.savedLayout),
    [props.elementTypes, counts, props.relationships, props.savedLayout],
  );

  const builtNodes = useMemo<Node[]>(
    () =>
      props.elementTypes.map((type) => ({
        id: type.id,
        type: "elementTypeGroup",
        position: initialPositions.get(type.id) ?? { x: 0, y: 0 },
        selected: type.id === props.selectedElementTypeId,
        data: {
          typeName: type.name,
          badge: type.badge,
          instances: instancesByType.get(type.id) ?? [],
          view: viewOf(type.id),
          onView: onViewHandlers.get(type.id)!,
          onSelectInstance: props.onSelectInstance,
          selectedInstanceId: props.selectedInstanceId,
          canStart: sourceTypes.has(type.id),
          locked: diagramLocked,
          linking,
        } satisfies CardData,
      })),
    [props.elementTypes, props.selectedElementTypeId, props.onSelectInstance, props.selectedInstanceId, initialPositions, instancesByType, viewOf, onViewHandlers, sourceTypes, diagramLocked, linking],
  );

  const builtEdges = useMemo<Edge[]>(() => {
    const edges: Edge[] = [];
    if (showModel) {
      for (const rel of props.relationships) {
        if (!counts.has(rel.sourceElementId) || !counts.has(rel.targetElementId)) continue;
        edges.push({
          id: `model:${rel.id}`,
          type: "modelRelationship",
          source: rel.sourceElementId,
          target: rel.targetElementId,
          sourceHandle: "type-s",
          targetHandle: "type-t",
          label: relationshipKindLabel(rel.relationshipKind),
          selectable: false,
          focusable: false,
          deletable: false,
          zIndex: 0,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#bdbdbd", width: 14, height: 14 },
        });
      }
    }
    // Which instance rows are on screen, per card.
    const shownIds = new Map<string, Set<string>>();
    for (const type of props.elementTypes) {
      shownIds.set(type.id, new Set(visibleInstances(instancesByType.get(type.id) ?? [], viewOf(type.id)).shown.map((instance) => instance.instance_id)));
    }
    const grouped = new Map<string, { edge: Edge; links: ElementRelationshipInstance[] }>();
    for (const link of props.links) {
      const source = instanceById.get(link.source_instance_id);
      const target = instanceById.get(link.target_instance_id);
      if (!source || !target) continue;
      const sourceHandle = shownIds.get(source.element_type_id)?.has(source.instance_id) ? `s:${source.instance_id}` : "more-s";
      const targetHandle = shownIds.get(target.element_type_id)?.has(target.instance_id) ? `t:${target.instance_id}` : "more-t";
      const key = `${link.support_domain_relationship_id}|${source.element_type_id}|${sourceHandle}|${target.element_type_id}|${targetHandle}`;
      const entry = grouped.get(key);
      if (entry) {
        entry.links.push(link);
        continue;
      }
      grouped.set(key, {
        links: [link],
        edge: {
          id: `link:${key}`,
          type: "instanceLink",
          source: source.element_type_id,
          target: target.element_type_id,
          sourceHandle,
          targetHandle,
          // Above the cards: a link joins two rows, and crossing a card is
          // better than vanishing under it.
          zIndex: 1001,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#5c6bc0", width: 14, height: 14 },
        },
      });
    }
    const focus = props.selectedInstanceId;
    for (const { edge, links } of grouped.values()) {
      const touches = focus ? links.some((link) => link.source_instance_id === focus || link.target_instance_id === focus) : false;
      edges.push({
        ...edge,
        data: {
          label: kindOf.get(links[0].support_domain_relationship_id) ?? relationshipKindLabel(links[0].relationship_type),
          links,
          emphasis: focus ? (touches ? "strong" : "faint") : "normal",
          onDelete: diagramLocked ? undefined : props.onRemoveLink,
        } satisfies LinkEdgeData,
      });
    }
    return edges;
  }, [showModel, props.relationships, props.elementTypes, props.links, props.selectedInstanceId, props.onRemoveLink, counts, instancesByType, instanceById, viewOf, kindOf, diagramLocked]);

  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(builtEdges);

  // Keep where the user has moved the cards; take everything else from the data.
  useEffect(() => {
    // Spread the current node first so React Flow keeps its measurements: a node
    // without them is left out of Fit and of edge routing until re-measured.
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return builtNodes.map((node) => {
        const existingNode = byId.get(node.id);
        return existingNode ? { ...existingNode, ...node, position: existingNode.position } : node;
      });
    });
  }, [builtNodes, setNodes]);
  useEffect(() => setEdges(builtEdges), [builtEdges, setEdges]);

  // Fit only when the set of cards changes (a model is opened), not on every
  // edit — and only once React Flow has measured the cards.
  const cardSignature = props.elementTypes.map((type) => type.id).join(",");
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (fittedFor.current === cardSignature) return;
    // Wait until every card has its size, then fit; React Flow's own first fit
    // can run while only some cards are measured and zoom onto those alone.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const all = getNodes();
      // Marked only once it has fitted: a cancelled attempt (an effect re-run)
      // must leave the next one free to try.
      if ((all.length > 0 && all.every((node) => getInternalNode(node.id)?.measured?.width)) || tries++ >= 60) {
        fittedFor.current = cardSignature;
        void fitView({ padding: FIT_VIEW_PADDING });
        return;
      }
      timer = setTimeout(attempt, 100);
    };
    timer = setTimeout(attempt, FIT_VIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cardSignature, fitView, getNodes, getInternalNode]);

  const applyAutoLayout = useCallback(() => {
    props.onLayoutChange(null);
    const positions = computePositions(props.elementTypes, counts, props.relationships, {});
    setNodes((current) => current.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })));
    setTimeout(() => fitView({ padding: FIT_VIEW_PADDING, duration: VIEWPORT_DURATION_MS }), FIT_VIEW_DELAY_MS);
  }, [counts, fitView, props, setNodes]);

  const onNodeDragStop = useCallback(() => {
    props.onLayoutChange(Object.fromEntries(getNodes().map((node) => [node.id, { x: node.position.x, y: node.position.y }])));
  }, [getNodes, props]);

  const startLink = useCallback(
    (handleId: string | null | undefined) => {
      if (!handleId?.startsWith("s:")) return;
      const source = instanceById.get(handleId.slice(2));
      if (!source) return;
      setLinking({ sourceId: source.instance_id, valid: validTargetIds(linkable, existing, props.instances, source) });
    },
    [existing, instanceById, linkable, props.instances],
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!linking || !connection.targetHandle?.startsWith("t:")) return false;
      return linking.valid.has(connection.targetHandle.slice(2));
    },
    [linking],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = connection.sourceHandle?.startsWith("s:") ? instanceById.get(connection.sourceHandle.slice(2)) : undefined;
      const target = connection.targetHandle?.startsWith("t:") ? instanceById.get(connection.targetHandle.slice(2)) : undefined;
      if (source && target) props.onLink(source, target);
    },
    [instanceById, props],
  );

  const handleToolbarAction = (action: ToolbarAction) => {
    if (action === "select" || action === "pan") { setInteractionMode(action); return; }
    if (action === "zoomIn") { void zoomIn({ duration: VIEWPORT_DURATION_MS }); return; }
    if (action === "zoomOut") { void zoomOut({ duration: VIEWPORT_DURATION_MS }); return; }
    if (action === "fit") { void fitView({ padding: FIT_VIEW_PADDING, duration: VIEWPORT_DURATION_MS }); return; }
    if (action === "autoLayout") { applyAutoLayout(); return; }
    if (action === "modelLayer") {
      setShowModel((shown) => {
        try { window.localStorage.setItem(MODEL_LAYER_KEY, shown ? "off" : "on"); } catch { /* per-viewer convenience only */ }
        return !shown;
      });
      return;
    }
    setDiagramLocked((locked) => !locked);
  };

  const linkingSource = linking ? instanceById.get(linking.sourceId) : undefined;

  return (
    <Stack spacing={1} sx={{ width: "100%", height: "100%", minHeight: 0 }}>
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }} alignItems="center">
        {TOOLBAR_ITEMS.map((item) => (
          <DiagramToolButton
            key={item.key}
            label={item.label}
            icon={item.icon}
            active={item.key === interactionMode || (item.key === "lockDiagram" && diagramLocked) || (item.key === "modelLayer" && showModel)}
            onClick={() => handleToolbarAction(item.key)}
          />
        ))}
      </Stack>
      <Typography variant="caption" color={linking ? "success.dark" : "text.secondary"} sx={{ minHeight: 18 }}>
        {linkingSource
          ? linking!.valid.size > 0
            ? `Relate ${linkingSource.name} to one of the ${linking!.valid.size} highlighted instance${linking!.valid.size === 1 ? "" : "s"} — the model allows only these.`
            : `The model lets ${linkingSource.name} relate to no instance it is not already related to.`
          : diagramLocked
            ? "The diagram is locked."
            : "Drag from the dot beside an instance to another instance to relate them. Hover a relationship label to remove it."}
      </Typography>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_, node) => props.onSelectElementType(node.id)}
          onSelectionChange={(selection) => {
            props.onSelectElementType(selection.nodes.length === 1 ? selection.nodes[0].id : null);
          }}
          onPaneClick={() => props.onSelectElementType(null)}
          onConnectStart={(_, params) => startLink(params.handleId)}
          onConnectEnd={() => setLinking(null)}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          connectionLineStyle={{ stroke: "#2e7d32", strokeWidth: 2, strokeDasharray: "4 3" }}
          connectionRadius={24}
          deleteKeyCode={null}
          panOnDrag={!diagramLocked && interactionMode === "pan"}
          selectionOnDrag={!diagramLocked && interactionMode === "select"}
          nodesDraggable={!diagramLocked}
          nodesFocusable={!diagramLocked}
          nodesConnectable={!diagramLocked}
          elementsSelectable={!diagramLocked}
          zoomOnScroll={!diagramLocked}
          zoomOnPinch={!diagramLocked}
          panOnScroll={!diagramLocked}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          style={{ borderRadius: 8 }}
        >
          <Background gap={16} size={1} color="#e0e0e0" />
        </ReactFlow>
      </Box>
    </Stack>
  );
}

export function SupportDomainInstanceDiagram(props: Props) {
  if (props.elementTypes.length === 0) {
    return <Box sx={{ p: 3 }}><Typography variant="body2" color="text.secondary">No element types defined for this model.</Typography></Box>;
  }
  return <ReactFlowProvider><SupportDomainInstanceDiagramInner {...props} /></ReactFlowProvider>;
}
