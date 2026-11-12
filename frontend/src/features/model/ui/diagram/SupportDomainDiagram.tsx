import { DiagramToolButton } from '@/shared/workspace/DiagramToolButton';
import { CONNECTION_LINE_STYLE, ConnectHandles, DiagramConnectStyles, connectTargetSx, useConnectTarget } from '@/shared/workspace/DiagramConnect';
import {
  Background,
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  Handle,
  getBezierPath,
  type InternalNode,
  MarkerType,
  type Connection,
  type Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './SupportDomainDiagram.css';
import {
  AccountTreeOutlined,
  CropFreeOutlined,
  LockOutlined,
  NearMeOutlined,
  PanToolOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@mui/icons-material';
import { Box, ButtonBase, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Stack, Typography } from '@mui/material';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BadgeCustomization,
  SupportDomainElementSummary,
  SupportDomainRelationshipSummary,
} from '../../domain/types';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import { BadgeIcon } from '../shared/BadgeIcon';
import { displayLabel } from '../../domain/utils';
import { relationshipKindLabel } from '@/features/cross-model';
import { INHERITED_COLOR } from '../workspace/InheritedModelContent';

/**
 * What an extending Support Domain model inherits, drawn beside its own
 * element types: the common model's element types and relationships (read
 * only — never moved, never saved from here), and the governed relationships
 * that join an inherited element type to one of this model's.
 */
export type InheritedSupportDomain = {
  modelName: string;
  elements: SupportDomainElementSummary[];
  relationships: SupportDomainRelationshipSummary[];
  /** Cross-model relationship types between an inherited element type and one of this model's. */
  links: Array<{ id: string; name: string; sourceId: string; targetId: string }>;
};

const INHERITED_GAP_Y = 160;

const FIT_VIEW_PADDING = 0.2;
const FOCUS_FIT_VIEW_PADDING = 0.5;
const FIT_VIEW_DELAY_MS = 50;
const FOCUS_FIT_VIEW_DURATION_MS = 300;
const HANDLE_COLOR = '#aaa';
const HANDLE_SIZE = 6;
const HIDDEN_HANDLE_STYLE = {
  opacity: 0,
  width: HANDLE_SIZE,
  height: HANDLE_SIZE,
  background: 'transparent',
  border: 'none',
};
const BACKGROUND_GAP = 16;
const BACKGROUND_SIZE = 1;
const BACKGROUND_COLOR = '#e0e0e0';
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const DIAGRAM_BORDER_RADIUS = 8;
const DEFAULT_LAYOUT_START_X = 80;
const DEFAULT_LAYOUT_START_Y = 80;
const DEFAULT_LAYOUT_COLUMNS = 4;
const DEFAULT_LAYOUT_COLUMN_SPACING = 240;
const DEFAULT_LAYOUT_ROW_SPACING = 140;
const TOOLBAR_ITEMS = [
  // Pan leads and starts active: reading a diagram comes before rearranging it.
  { key: 'pan', label: 'Pan', icon: PanToolOutlined },
  { key: 'select', label: 'Select', icon: NearMeOutlined },
  { key: 'zoomIn', label: 'Zoom In', icon: ZoomInOutlined },
  { key: 'zoomOut', label: 'Zoom Out', icon: ZoomOutOutlined },
  { key: 'fit', label: 'Fit', icon: CropFreeOutlined },
  { key: 'autoLayout', label: 'Auto Layout', icon: AccountTreeOutlined },
  { key: 'lockDiagram', label: 'Lock Diagram', icon: LockOutlined },
] as const;

type ToolbarAction = (typeof TOOLBAR_ITEMS)[number]['key'];
type InteractionMode = 'select' | 'pan';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function ElementNode({ id, data }: { id: string; data: { label: string; badge: BadgeCustomization; abbr: string; connectable?: boolean; inherited?: boolean; inheritedFrom?: string } }) {
  const text = data.badge.badgeText.trim() || data.abbr;
  const inherited = Boolean(data.inherited);
  // In the Model Workspace every element type is a valid target.
  const connect = useConnectTarget(id);
  return (
    <>
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} isConnectable={false} />
      <Box
        sx={{
          ...connectTargetSx(connect),
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderRadius: 1.5,
          border: inherited ? '1px dashed' : '1px solid',
          borderColor: inherited ? `${INHERITED_COLOR}99` : 'divider',
          bgcolor: inherited ? '#faf5fc' : 'background.paper',
          boxShadow: inherited ? 0 : 1,
          minWidth: 120,
          cursor: 'default',
          userSelect: 'none',
        }}
        title={inherited ? `Inherited from ${data.inheritedFrom ?? 'the common model'} — read only. Drag to one of this model's element types to relate them.` : undefined}
      >
        <BadgeIcon
          badgeText={text}
          badgeShape={data.badge.badgeShape}
          badgeColor={data.badge.badgeColor}
          badgeTextColor={data.badge.badgeTextColor}
          badgeIcon={data.badge.badgeIcon ?? undefined}
          badgeSize={data.badge.badgeSize}
          badgeContentType={data.badge.badgeContentType}
        />
        <Typography variant="caption" fontWeight={500} noWrap sx={inherited ? { fontStyle: 'italic', color: INHERITED_COLOR } : undefined}>
          {data.label}
        </Typography>
        {inherited && <LockOutlined sx={{ fontSize: 12, color: 'text.disabled' }} />}
      </Box>
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} isConnectable={false} />
      <ConnectHandles nodeId={id} disabled={data.connectable === false} />
    </>
  );
}

const nodeTypes = { element: ElementNode };

function getNodeDimensions(node: InternalNode) {
  return {
    width: node.measured.width ?? node.width ?? 1,
    height: node.measured.height ?? node.height ?? 1,
  };
}

function getNodeCenter(node: InternalNode) {
  const { width, height } = getNodeDimensions(node);

  return {
    x: node.internals.positionAbsolute.x + width / 2,
    y: node.internals.positionAbsolute.y + height / 2,
  };
}

function getNodeIntersection(intersectionNode: InternalNode, targetNode: InternalNode) {
  const { width, height } = getNodeDimensions(intersectionNode);
  const intersectionCenter = getNodeCenter(intersectionNode);
  const targetCenter = getNodeCenter(targetNode);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const horizontalDistance = (targetCenter.x - intersectionCenter.x) / (2 * halfWidth);
  const verticalDistance = (targetCenter.y - intersectionCenter.y) / (2 * halfHeight);
  const normalizedHorizontal = horizontalDistance - verticalDistance;
  const normalizedVertical = horizontalDistance + verticalDistance;
  const scale = 1 / (Math.abs(normalizedHorizontal) + Math.abs(normalizedVertical));
  const scaledHorizontal = scale * normalizedHorizontal;
  const scaledVertical = scale * normalizedVertical;

  return {
    x: halfWidth * (scaledHorizontal + scaledVertical) + intersectionCenter.x,
    y: halfHeight * (-scaledHorizontal + scaledVertical) + intersectionCenter.y,
  };
}

function getEdgePosition(node: InternalNode, intersectionPoint: { x: number; y: number }) {
  const { width, height } = getNodeDimensions(node);
  const nodeTopLeft = node.internals.positionAbsolute;
  const distanceLeft = Math.abs(intersectionPoint.x - nodeTopLeft.x);
  const distanceRight = Math.abs(intersectionPoint.x - (nodeTopLeft.x + width));
  const distanceTop = Math.abs(intersectionPoint.y - nodeTopLeft.y);
  const distanceBottom = Math.abs(intersectionPoint.y - (nodeTopLeft.y + height));
  const closestSideDistance = Math.min(distanceLeft, distanceRight, distanceTop, distanceBottom);

  if (closestSideDistance === distanceLeft) return Position.Left;
  if (closestSideDistance === distanceRight) return Position.Right;
  if (closestSideDistance === distanceTop) return Position.Top;
  return Position.Bottom;
}

function getFloatingEdgeParams(sourceNode: InternalNode, targetNode: InternalNode) {
  const sourceIntersectionPoint = getNodeIntersection(sourceNode, targetNode);
  const targetIntersectionPoint = getNodeIntersection(targetNode, sourceNode);

  return {
    sourceX: sourceIntersectionPoint.x,
    sourceY: sourceIntersectionPoint.y,
    targetX: targetIntersectionPoint.x,
    targetY: targetIntersectionPoint.y,
    sourcePosition: getEdgePosition(sourceNode, sourceIntersectionPoint),
    targetPosition: getEdgePosition(targetNode, targetIntersectionPoint),
  };
}

type FloatingEdgeData = {
  /** Sideways bend in px, so relationships between the same two element types do not overlap. */
  offset?: number;
  /** Clicking the label acts as clicking the line. */
  onLabelClick?: (event: React.MouseEvent) => void;
};

function FloatingEdge({ id, source, target, markerEnd, style, label, labelStyle, selected, data }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { offset = 0, onLabelClick } = (data ?? {}) as FloatingEdgeData;
  const params = getFloatingEdgeParams(sourceNode, targetNode);
  let path: string;
  let labelX: number;
  let labelY: number;
  if (offset) {
    // A gentle arc to one side: control point pushed off the straight line's midpoint.
    const dx = params.targetX - params.sourceX;
    const dy = params.targetY - params.sourceY;
    const length = Math.hypot(dx, dy) || 1;
    const cx = (params.sourceX + params.targetX) / 2 - (dy / length) * offset * 2;
    const cy = (params.sourceY + params.targetY) / 2 + (dx / length) * offset * 2;
    path = `M ${params.sourceX},${params.sourceY} Q ${cx},${cy} ${params.targetX},${params.targetY}`;
    labelX = (params.sourceX + 2 * cx + params.targetX) / 4;
    labelY = (params.sourceY + 2 * cy + params.targetY) / 4;
  } else {
    [path, labelX, labelY] = getBezierPath(params);
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#1976d2' : '#999',
          strokeDasharray: '5 4',
          ...style,
        }}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 10,
              color: '#555',
              background: 'rgba(255,255,255,0.82)',
              padding: '2px 4px',
              borderRadius: 4,
              pointerEvents: 'all',
              cursor: onLabelClick ? 'pointer' : undefined,
              ...labelStyle,
            }}
            className="nodrag nopan"
            onClick={onLabelClick}
            onContextMenu={onLabelClick}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes: EdgeTypes = { floating: FloatingEdge };

function defaultCreatedPosition(index: number) {
  return {
    x: DEFAULT_LAYOUT_START_X + (index % DEFAULT_LAYOUT_COLUMNS) * DEFAULT_LAYOUT_COLUMN_SPACING,
    y: DEFAULT_LAYOUT_START_Y + Math.floor(index / DEFAULT_LAYOUT_COLUMNS) * DEFAULT_LAYOUT_ROW_SPACING,
  };
}

function computeLayout(
  elements: SupportDomainElementSummary[],
  relationships: SupportDomainRelationshipSummary[],
  inherited?: InheritedSupportDomain | null,
): { nodes: Node[]; edges: Edge[] } {
  const own = computeOwnLayout(elements, relationships);
  const layout = !inherited || inherited.elements.length === 0 ? own : withInherited(own, inherited);
  return { nodes: layout.nodes, edges: spreadParallelEdges(layout.edges) };
}

/**
 * The inherited element types sit above this model's own, in the common
 * model's arrangement, so the two never overlap and the relationships between
 * them read top to bottom.
 */
function withInherited(own: { nodes: Node[]; edges: Edge[] }, inherited: InheritedSupportDomain): { nodes: Node[]; edges: Edge[] } {
  const placed = inherited.elements.map((element, index) => ({
    element,
    position: element.position.x != null && element.position.y != null ? { x: element.position.x, y: element.position.y } : defaultCreatedPosition(index),
  }));
  const ownMinY = own.nodes.length ? Math.min(...own.nodes.map((node) => node.position.y)) : DEFAULT_LAYOUT_START_Y + INHERITED_GAP_Y;
  const ownMinX = own.nodes.length ? Math.min(...own.nodes.map((node) => node.position.x)) : DEFAULT_LAYOUT_START_X;
  const maxY = Math.max(...placed.map((item) => item.position.y));
  const minX = Math.min(...placed.map((item) => item.position.x));
  const dy = ownMinY - INHERITED_GAP_Y - maxY;
  const dx = ownMinX - minX;
  const ids = new Set(inherited.elements.map((element) => element.id));
  const nodes: Node[] = placed.map(({ element, position }) => {
    const label = displayLabel(element);
    return {
      id: element.id,
      type: 'element',
      position: { x: position.x + dx, y: position.y + dy },
      draggable: false,
      data: { label, abbr: initials(label), badge: element.badge, elementId: element.id, inherited: true, inheritedFrom: inherited.modelName },
    };
  });
  const inheritedEdges: Edge[] = inherited.relationships
    .filter((r) => ids.has(r.sourceElementId) && ids.has(r.targetElementId))
    .map((r) => ({
      id: `inherited:${r.id}`,
      source: r.sourceElementId,
      target: r.targetElementId,
      label: relationshipKindLabel(r.relationshipKind),
      type: 'floating',
      selectable: false,
      style: { strokeDasharray: '5 4', stroke: `${INHERITED_COLOR}99` },
      labelStyle: { color: INHERITED_COLOR, fontStyle: 'italic' },
      markerEnd: { type: MarkerType.ArrowClosed, color: `${INHERITED_COLOR}99`, width: 16, height: 16 },
    }));
  const ownIds = new Set(own.nodes.map((node) => node.id));
  const linkEdges: Edge[] = inherited.links
    .filter((link) => (ids.has(link.sourceId) || ownIds.has(link.sourceId)) && (ids.has(link.targetId) || ownIds.has(link.targetId)))
    .map((link) => ({
      id: `link:${link.id}`,
      source: link.sourceId,
      target: link.targetId,
      label: link.name,
      type: 'floating',
      selectable: false,
      style: { stroke: '#1565C0' },
      labelStyle: { color: '#1565C0', fontWeight: 600 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#1565C0', width: 16, height: 16 },
    }));
  return { nodes: [...nodes, ...own.nodes], edges: [...inheritedEdges, ...linkEdges, ...own.edges] };
}

/**
 * Relationships between the same two element types (either direction) are
 * fanned out to either side, so each line and label can be seen and clicked.
 */
function spreadParallelEdges(edges: Edge[]): Edge[] {
  const groups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join('\u0000');
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const SPACING = 26;
  return edges.map((edge) => {
    const group = groups.get([edge.source, edge.target].sort().join('\u0000'))!;
    if (group.length < 2) return edge;
    const index = group.indexOf(edge);
    // The perpendicular flips with direction, so measure every edge from the same end.
    const sign = edge.source <= edge.target ? 1 : -1;
    const offset = (index - (group.length - 1) / 2) * SPACING * sign;
    return offset ? { ...edge, data: { ...(edge.data ?? {}), offset } } : edge;
  });
}

function computeOwnLayout(
  elements: SupportDomainElementSummary[],
  relationships: SupportDomainRelationshipSummary[],
): { nodes: Node[]; edges: Edge[] } {
  if (elements.length === 0) return { nodes: [], edges: [] };

  const nodes: Node[] = elements.map((element, index) => {
    const defaultPosition = defaultCreatedPosition(index);
    const label = displayLabel(element);
    const abbr = initials(label);

    return {
      id: element.id,
      type: 'element',
      position:
        element.position.x != null && element.position.y != null
          ? {
              x: element.position.x,
              y: element.position.y,
            }
          : defaultPosition,
      data: {
        label,
        abbr,
        badge: element.badge,
        elementId: element.id,
      },
    };
  });

  const edges: Edge[] = relationships.map((r) => {
    return {
      id: r.id,
      source: r.sourceElementId,
      target: r.targetElementId,
      // The relationship's name: a kind's label, or the model's own name as typed.
      label: relationshipKindLabel(r.relationshipKind),
      type: 'floating',
      animated: false,
      selectable: true,
      interactionWidth: 18,
      data: { relationshipId: r.id },
      style: { strokeDasharray: '5 4', stroke: '#999' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#999', width: 16, height: 16 },
    };
  });

  return { nodes, edges };
}

function SupportDomainDiagramInner(props: {
  modelId: string;
  elements: SupportDomainElementSummary[];
  relationships: SupportDomainRelationshipSummary[];
  focusedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  /** A relationship was dragged from one element type to another. */
  onConnectElements: (sourceId: string, targetId: string) => void;
  /** Right-click on an element type. */
  onElementContextMenu?: (id: string, event: React.MouseEvent) => void;
  /** What the model inherits, when it extends a common model. */
  inherited?: InheritedSupportDomain | null;
  /** A relationship was dragged between an inherited element type and one of this model's. */
  onConnectInherited?: (sourceId: string, targetId: string) => void;
  /** A relationship of this model was chosen on the diagram, to view and edit it. */
  onEditRelationship?: (relationshipId: string) => void;
  onDeleteRelationship?: (relationshipId: string) => void;
}) {
  // Clicking a connector opens its menu, as on the MWS Relationship Diagram.
  const [edgeMenu, setEdgeMenu] = useState<{ top: number; left: number; id: string; name: string } | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // A save or delete redraws the relationships; the highlight has done its job.
  useEffect(() => setSelectedEdgeId(null), [props.relationships]);
  const openEdgeMenu = (event: React.MouseEvent, edge: Edge) => {
    // Inherited relationships belong to the common model; cross-model links to the Relationship tab.
    if (edge.id.startsWith('inherited:') || edge.id.startsWith('link:')) return;
    event.preventDefault();
    event.stopPropagation();
    const relationship = props.relationships.find((r) => r.id === edge.id);
    if (!relationship) return;
    setSelectedEdgeId(edge.id);
    setEdgeMenu({ top: event.clientY, left: event.clientX, id: edge.id, name: relationshipKindLabel(relationship.relationshipKind) });
  };
  const openEdgeMenuRef = useRef(openEdgeMenu);
  openEdgeMenuRef.current = openEdgeMenu;
  const inheritedIds = useMemo(() => new Set((props.inherited?.elements ?? []).map((element) => element.id)), [props.inherited]);
  const initial = useMemo(
    () => computeLayout(props.elements, props.relationships, props.inherited),
    [props.elements, props.relationships, props.inherited],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  // The chosen relationship stands out while its menu or dialog is open.
  const shownEdges = useMemo(
    () =>
      edges.map((edge) => {
        const own = !edge.id.startsWith('inherited:') && !edge.id.startsWith('link:');
        const withClick = own ? { ...edge, data: { ...(edge.data ?? {}), onLabelClick: (event: React.MouseEvent) => openEdgeMenuRef.current(event, edge) } } : edge;
        return edge.id === selectedEdgeId
          ? { ...withClick, style: { ...edge.style, stroke: '#1976D2', strokeWidth: 2.5, strokeDasharray: undefined }, labelStyle: { ...edge.labelStyle, color: '#1976D2', fontWeight: 700 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#1976D2', width: 16, height: 16 } }
          : withClick;
      }),
    [edges, selectedEdgeId],
  );
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('pan');
  const [diagramLocked, setDiagramLocked] = useState(false);
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  useEffect(() => {
    const layout = computeLayout(
      props.elements,
      props.relationships,
      props.inherited,
    );

    setNodes(layout.nodes);
    setEdges(layout.edges);

    setTimeout(() => fitView({ padding: FIT_VIEW_PADDING }), FIT_VIEW_DELAY_MS);
  }, [
    props.elements,
    props.relationships,
    props.inherited,
    setNodes,
    setEdges,
    fitView,
  ]);

  useEffect(() => {
    if (!props.focusedElementId) return;

    setTimeout(() => {
      fitView({
        nodes: [
          {
            id: props.focusedElementId!,
          },
        ],
        padding: FOCUS_FIT_VIEW_PADDING,
        duration: FOCUS_FIT_VIEW_DURATION_MS,
      });
    }, FIT_VIEW_DELAY_MS);

    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        style:
          n.id === props.focusedElementId
            ? { filter: 'drop-shadow(0 0 6px #1976d2)' }
            : {},
      }))
    );
  }, [
    props.focusedElementId,
    props.elements,
    fitView,
    setNodes,
  ]);

  const onNodeDragStop = useCallback(
    async (_: unknown, node: Node) => {
      // An inherited element type's place belongs to the common model: never saved from here.
      if (inheritedIds.has(node.id)) return;
      const nextPosition = {
        x: node.position.x,
        y: node.position.y,
      };

      try {
        await modelDefinitionsApi.updateSupportDomainElementPosition(
          node.id,
          nextPosition,
        );
      } catch (error) {
        console.error('Failed to persist node position', error);
      }
    },
    [inheritedIds],
  );

  const applyAutoLayout = useCallback(async () => {
    const layout = computeLayout(props.elements, props.relationships, props.inherited);

    setNodes(layout.nodes);
    setEdges(layout.edges);
    setTimeout(() => fitView({ padding: FIT_VIEW_PADDING, duration: FOCUS_FIT_VIEW_DURATION_MS }), FIT_VIEW_DELAY_MS);

    await Promise.all(
      layout.nodes.filter((node) => !inheritedIds.has(node.id)).map((node) =>
        modelDefinitionsApi.updateSupportDomainElementPosition(node.id, {
          x: node.position.x,
          y: node.position.y,
        }),
      ),
    );
  }, [fitView, props.elements, props.relationships, props.inherited, inheritedIds, setEdges, setNodes]);

  const handleToolbarAction = (action: ToolbarAction) => {
    if (action === 'select') {
      setInteractionMode('select');
      return;
    }
    if (action === 'pan') {
      setInteractionMode('pan');
      return;
    }
    if (action === 'zoomIn') {
      void zoomIn({ duration: FOCUS_FIT_VIEW_DURATION_MS });
      return;
    }
    if (action === 'zoomOut') {
      void zoomOut({ duration: FOCUS_FIT_VIEW_DURATION_MS });
      return;
    }
    if (action === 'fit') {
      void fitView({ padding: FIT_VIEW_PADDING, duration: FOCUS_FIT_VIEW_DURATION_MS });
      return;
    }
    if (action === 'autoLayout') {
      void applyAutoLayout();
      return;
    }
    if (action === 'lockDiagram') {
      setDiagramLocked((current) => !current);
    }
  };

  const onNodeClick = (_: unknown, node: Node) => {
    // Inherited element types are edited in the common model, not here.
    if (inheritedIds.has(node.id)) return;
    props.onSelectElement(node.id);
  };
  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
        {TOOLBAR_ITEMS.map((item) => (
          <DiagramToolButton
            key={item.key}
            label={item.label}
            icon={item.icon}
            active={item.key === interactionMode || (item.key === "lockDiagram" && diagramLocked)}
            onClick={() => handleToolbarAction(item.key)}
          />
        ))}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
  nodes={nodes}
  edges={shownEdges}
  onNodeClick={onNodeClick}
  onEdgeClick={openEdgeMenu}
  onEdgeContextMenu={openEdgeMenu}
  onNodeContextMenu={props.onElementContextMenu ? (event, node) => { if (!inheritedIds.has(node.id)) props.onElementContextMenu!(node.id, event); } : undefined}
   onPaneClick={() => { setSelectedEdgeId(null); props.onSelectElement(null); }}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
  onNodeDragStop={onNodeDragStop}
  nodeTypes={nodeTypes}
  edgeTypes={edgeTypes}
  panOnDrag={!diagramLocked && interactionMode === 'pan'}
  selectionOnDrag={!diagramLocked && interactionMode === 'select'}
  nodesDraggable={!diagramLocked}
  nodesFocusable={!diagramLocked}
  nodesConnectable={!diagramLocked}
  onConnect={(connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const fromInherited = inheritedIds.has(connection.source);
    const toInherited = inheritedIds.has(connection.target);
    // Two inherited element types are related in the common model, not here.
    if (fromInherited && toInherited) return;
    if (fromInherited || toInherited) props.onConnectInherited?.(connection.source, connection.target);
    else props.onConnectElements(connection.source, connection.target);
  }}
  connectionLineStyle={CONNECTION_LINE_STYLE}
  zoomOnScroll={!diagramLocked}
  zoomOnPinch={!diagramLocked}
  panOnScroll={!diagramLocked}
  fitView
  fitViewOptions={{ padding: FIT_VIEW_PADDING }}
  minZoom={MIN_ZOOM}
  maxZoom={MAX_ZOOM}
  style={{ borderRadius: DIAGRAM_BORDER_RADIUS }}
>
        <Background gap={BACKGROUND_GAP} size={BACKGROUND_SIZE} color={BACKGROUND_COLOR} />
      </ReactFlow>
      <DiagramConnectStyles />
      <Menu
        open={edgeMenu !== null}
        onClose={() => setEdgeMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={edgeMenu ? { top: edgeMenu.top, left: edgeMenu.left } : undefined}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        <ListSubheader sx={{ lineHeight: '32px', fontSize: 12, fontWeight: 700 }}>{edgeMenu?.name ?? 'Relationship'}</ListSubheader>
        <Divider sx={{ mb: 0.5 }} />
        <MenuItem
          disabled={!props.onEditRelationship}
          onClick={() => { if (edgeMenu) props.onEditRelationship?.(edgeMenu.id); setEdgeMenu(null); }}
        >
          <ListItemIcon><EditOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={`Edit ${edgeMenu?.name ?? ''}`} />
        </MenuItem>
        {props.onDeleteRelationship && (
          <MenuItem
            onClick={() => { if (edgeMenu) props.onDeleteRelationship?.(edgeMenu.id); setEdgeMenu(null); setSelectedEdgeId(null); }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon><DeleteOutline fontSize="small" color="error" /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={`Delete ${edgeMenu?.name ?? ''}`} />
          </MenuItem>
        )}
      </Menu>
      </Box>
    </Stack>
  );
}

export function SupportDomainDiagram(props: {
  modelId: string;
  elements: SupportDomainElementSummary[];
  relationships: SupportDomainRelationshipSummary[];
  focusedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onConnectElements: (sourceId: string, targetId: string) => void;
  onElementContextMenu?: (id: string, event: React.MouseEvent) => void;
  inherited?: InheritedSupportDomain | null;
  onConnectInherited?: (sourceId: string, targetId: string) => void;
  onEditRelationship?: (relationshipId: string) => void;
  onDeleteRelationship?: (relationshipId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <SupportDomainDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
