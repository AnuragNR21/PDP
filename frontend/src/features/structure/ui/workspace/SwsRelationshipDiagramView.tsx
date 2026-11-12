import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderSelection, type SelectionSlot } from "@/shared/workspace/SelectionSlot";
import { useToast } from "@/shared/toast/ToastContext";
import type { ModelItemKind } from "@/shared/constants/ModelConfig";
import { HIERARCHY_LINK_LABEL, type RelationshipLinkCategory } from "@/shared/constants/RelationshipConfig";
import {
  createDiagramShape,
  getLinkBg,
  getLinkCategoryLabel,
  getLinkColor,
  LEGEND_COLLAPSED_LIMIT,
  LINK_CATEGORIES,
  RELATIONSHIP_FALLBACK_COLOR,
  relationshipKindLabel,
  restoreDiagramShape,
  SavedDiagramSyncStatusLabel,
  useSavedDiagramSync,
  type CrossModelSelectableItem,
  type DiagramShapeKind,
  type EdgeStyle,
  type SaveDiagramInput,
  type SavedDiagram,
  type SavedDiagramApi,
  type SavedDiagramEdge,
  type SavedDiagramNode,
  type ShapeStylePatch,
} from "@/features/cross-model";
import type { BadgeCustomization, CrossModelRelationshipTypeSummary } from "@/features/model/domain/types";
import { modelDefinitionsApi } from "@/features/model/api/modelDefinitionsApi";
import type { DiagramTypeItem } from "@/features/model/contexts/ModelWorkspaceContext";
import {
  GovernanceTypesDiagramInner,
  type DiagramTypeLink,
  type EdgeRelationship,
  type SidebarDragData,
} from "@/features/model/ui/governance/GovernanceTypesDiagramView";
import { DiagramPicker } from "@/features/model/ui/governance/diagram/DiagramPicker";
import type { MenuEntry } from "@/features/model/ui/governance/diagram/ContextMenu";
import {
  EMPTY_PRESENTATION,
  forgetPresentation,
  loadPrefs,
  loadPresentation,
  savePrefs,
  savePresentation,
  type DiagramPrefs,
  type DiagramPresentation,
  type Point,
} from "@/features/model/ui/governance/diagram/presentation";
import { structureApi, type CrossModelInstance, type ElementRelationshipInstance } from "@/features/structure/api/structureApi";
import {
  useActiveCrossModelRelationshipTypes,
  useAllCrossModelLinks,
  useAllElementRelationshipInstances,
  useAllSupportDomainRelationships,
  useCreateCrossModelLink,
  useCreateElementRelationshipInstance,
  useCrossModelSelectionModels,
  useDeleteCrossModelLink,
  useDeleteElementRelationshipInstance,
  useHierarchyModels,
  useSupportDomainModels,
} from "@/features/structure/state/useStructureWorkspace";
import { useStructureWorkspace, type DiagramItem } from "../../contexts/StructureWorkspaceContext";
import { InstanceSelectionPanel } from "./InstanceSelectionPanel";
import { instanceContexts, uniqueById } from "@/features/structure/domain/instanceContext";

const SAVED_DIAGRAMS_QUERY_KEY = ["cross-model-instance-diagrams"] as const;
const savedDiagramApi: SavedDiagramApi = {
  list: structureApi.listCrossModelInstanceDiagrams,
  get: structureApi.getCrossModelInstanceDiagram,
  create: structureApi.createCrossModelInstanceDiagram,
  update: structureApi.updateCrossModelInstanceDiagram,
  remove: structureApi.deleteCrossModelInstanceDiagram,
};
const REFERENCE_LAYER_KEY = "pdp-sws-relationship-diagram-reference-layer";

type End = { id: string; name: string; kind: CrossModelSelectableItem["modelKind"]; modelId: string; modelName: string; typeId: string; typeName: string; parentId: string | null; badge?: BadgeCustomization | null; lifecycle?: string; authorable?: boolean; context?: string };

/** A relationship the model allows from one instance to another, and that is not there yet. */
type Option =
  | { source: "cross"; id: string; name: string; description: string }
  | { source: "sd"; id: string; name: string; description: string };

const itemKindOf = (kind: End["kind"]): ModelItemKind => (kind === "HIERARCHY_MODEL" ? "HIERARCHY_NODE" : "SUPPORT_DOMAIN_ELEMENT");

/** Governed cross-model types that take `from` → `to`, in that direction. */
function crossTypesFor(types: CrossModelRelationshipTypeSummary[], from: End, to: End) {
  return types.filter(
    (type) =>
      type.sourceModelType === from.kind &&
      type.targetModelType === to.kind &&
      (type.sourceModelItemTypeId === null ? type.sourceModelId === null || type.sourceModelId === from.modelId : type.sourceModelItemTypeId === from.typeId) &&
      (type.targetModelItemTypeId === null ? type.targetModelId === null || type.targetModelId === to.modelId : type.targetModelItemTypeId === to.typeId),
  );
}

function readReferenceLayer() {
  try {
    return window.localStorage.getItem(REFERENCE_LAYER_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * SWS › Relationship › Diagram — the MWS Relationship Diagram (PDP-229 /
 * PDP-230) with instances on it instead of types: the same Item Selection,
 * Diagram picker with auto-save, toolbar, menus, legend and line presentation,
 * through the same canvas component.
 *
 * Lines are the governed SWS relationships between the instances shown —
 * between models, support domain links, and hierarchy parent → child. Dragging
 * from an instance rings the instances the model allows it to relate to (in that
 * direction) and fades the rest; dropping uses the one allowed relationship, or
 * asks which when there are several. An optional grey background layer shows the
 * allowable type relationships behind them, read only.
 *
 * Putting an instance on the diagram or taking it off changes this picture only;
 * deleting a relationship deletes the governed relationship, after confirmation.
 */
export function SwsRelationshipDiagramView(props: { selectionSlot?: SelectionSlot; onSelectItem?: (id: string) => void }) {
  const {
    crossModelRelationship: {
      diagramViewSelection: { canvasItems, edgeStyles, shapes, currentDiagramId, currentDiagramName },
    },
    setDiagramCanvasItems,
    setDiagramEdgeStyles,
    setDiagramShapes,
    setCurrentDiagramId,
    setCurrentDiagramName,
  } = useStructureWorkspace();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // ── Data ──────────────────────────────────────────────────────────────────
  const selectionModels = useCrossModelSelectionModels();
  const typeOptionsQuery = useQuery({ queryKey: ["cross-model-type-options"], queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions() });
  const typeOptions = useMemo(() => [...(typeOptionsQuery.data?.nodeTypes ?? []), ...(typeOptionsQuery.data?.elementTypes ?? [])], [typeOptionsQuery.data]);
  const hierarchyModels = useHierarchyModels();
  const supportModels = useSupportDomainModels();
  const modelStatus = useMemo(
    () => new Map([...(hierarchyModels.data ?? []), ...(supportModels.data ?? [])].map((model) => [model.id, model.status as string])),
    [hierarchyModels.data, supportModels.data],
  );
  const governedQuery = useActiveCrossModelRelationshipTypes();
  const governed = useMemo(() => governedQuery.data ?? [], [governedQuery.data]);
  const sdRelationshipsQuery = useAllSupportDomainRelationships();
  const sdRelationships = useMemo(() => (sdRelationshipsQuery.data ?? []).filter((rel) => rel.status !== "retired"), [sdRelationshipsQuery.data]);
  const hierarchyRulesQuery = useQuery({ queryKey: ["all-hierarchy-rules"], queryFn: () => modelDefinitionsApi.listAllHierarchyRules() });
  const crossLinksQuery = useAllCrossModelLinks();
  const sdLinksQuery = useAllElementRelationshipInstances();
  const crossLinks = useMemo(() => crossLinksQuery.data ?? [], [crossLinksQuery.data]);
  const sdLinks = useMemo(() => sdLinksQuery.data ?? [], [sdLinksQuery.data]);

  const createCross = useCreateCrossModelLink();
  const createSd = useCreateElementRelationshipInstance();
  const deleteCross = useDeleteCrossModelLink();
  const deleteSd = useDeleteElementRelationshipInstance();

  const endById = useMemo(() => {
    const map = new Map<string, End>();
    // Instances sharing a name (a property under several assets) are told apart by their owner.
    const contexts = instanceContexts(selectionModels.flatMap((model) => model.items));
    for (const model of selectionModels) {
      for (const item of model.items) {
        map.set(item.id, { id: item.id, name: item.name, kind: item.modelKind, modelId: item.modelId, modelName: item.modelName, typeId: item.typeId, typeName: item.typeName, parentId: item.parentId ?? null, badge: item.badge, lifecycle: item.lifecycle, authorable: item.authorable, context: contexts.get(item.id) });
      }
    }
    return map;
  }, [selectionModels]);
  const loading = typeOptionsQuery.isLoading || governedQuery.isLoading || crossLinksQuery.isLoading || sdLinksQuery.isLoading || selectionModels.some((model) => model.loading);

  // ── Look and feel, as in MWS ──────────────────────────────────────────────
  const [hiddenCategories, setHiddenCategories] = useState<Set<RelationshipLinkCategory>>(new Set());
  const [showAllLegend, setShowAllLegend] = useState(false);
  const [showReference, setShowReference] = useState(readReferenceLayer);
  const positionsRef = useRef<(() => Record<string, { x: number; y: number }>) | null>(null);
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
  useEffect(() => {
    try {
      window.localStorage.setItem(REFERENCE_LAYER_KEY, showReference ? "on" : "off");
    } catch {
      /* a per-viewer convenience only */
    }
  }, [showReference]);

  const canvasIds = useMemo(() => new Set(canvasItems.map((item) => item.id)), [canvasItems]);
  const items = useMemo<DiagramTypeItem[]>(
    () =>
      uniqueById(canvasItems).map((item) => {
        const end = endById.get(item.id);
        const lifecycle = end?.lifecycle;
        // Draft and Archived instances stay on the diagram, marked as such.
        const status = lifecycle === "retired" ? " · Archived" : lifecycle === "draft" ? " · Draft" : "";
        // "Asset Property of Pole · Asset Information" when the name alone is shared with other instances.
        const typeLabel = end?.context ? `${item.typeName} of ${end.context}` : item.typeName;
        return { id: item.id, name: item.name, modelName: `${typeLabel} · ${item.modelName ?? ""}${status}`, kind: item.kind, x: item.x, y: item.y };
      }),
    [canvasItems, endById],
  );
  const badgeById = useMemo(() => {
    const map = new Map<string, BadgeCustomization>();
    for (const item of canvasItems) {
      const badge = endById.get(item.id)?.badge;
      if (badge) map.set(item.id, badge);
    }
    return map;
  }, [canvasItems, endById]);

  // ── The governed relationships between the instances shown ────────────────
  const crossName = useCallback((typeId: string) => governed.find((type) => type.id === typeId)?.name ?? "Relationship", [governed]);
  const linkById = useMemo(() => {
    const map = new Map<string, { kind: "cross"; link: CrossModelInstance } | { kind: "sd"; link: ElementRelationshipInstance }>();
    for (const link of crossLinks) map.set(link.cross_model_instance_id, { kind: "cross", link });
    for (const link of sdLinks) map.set(link.relationship_instance_id, { kind: "sd", link });
    return map;
  }, [crossLinks, sdLinks]);

  const allLinks = useMemo<DiagramTypeLink[]>(() => {
    const links: DiagramTypeLink[] = [
      ...crossLinks.map((link) => ({ id: link.cross_model_instance_id, sourceId: link.source_instance_id, targetId: link.target_instance_id, name: crossName(link.relationship_rule_id), category: "CROSS_MODEL" as const })),
      ...sdLinks.map((link) => ({ id: link.relationship_instance_id, sourceId: link.source_instance_id, targetId: link.target_instance_id, name: relationshipKindLabel(link.relationship_type), category: "SUPPORT_DOMAIN" as const })),
    ];
    // Hierarchy containment: each node instance under its parent.
    for (const item of canvasItems) {
      const parent = endById.get(item.id)?.parentId;
      if (parent && canvasIds.has(parent)) links.push({ id: `parent:${item.id}`, sourceId: parent, targetId: item.id, name: HIERARCHY_LINK_LABEL, category: "HIERARCHY" });
    }
    return links;
  }, [crossLinks, sdLinks, crossName, canvasItems, canvasIds, endById]);
  const canvasLinks = useMemo(() => allLinks.filter((l) => l.sourceId !== l.targetId && canvasIds.has(l.sourceId) && canvasIds.has(l.targetId)), [allLinks, canvasIds]);
  const visibleLinks = useMemo(() => canvasLinks.filter((l) => !hiddenCategories.has(l.category)), [canvasLinks, hiddenCategories]);

  // ── What the model allows between two instances ──────────────────────────
  const optionsFor = useCallback(
    (fromId: string, toId: string): Option[] => {
      const from = endById.get(fromId);
      const to = endById.get(toId);
      if (!from || !to || fromId === toId) return [];
      // Lifecycle: Archived instances, and instances of a non-Active model or type, take no new relationships.
      if (from.authorable === false || to.authorable === false) return [];
      const options: Option[] = [];
      // Between models: one stored link per ordered pair, so none while one exists.
      if (!crossLinks.some((link) => link.source_instance_id === fromId && link.target_instance_id === toId)) {
        for (const type of crossTypesFor(governed, from, to)) {
          options.push({ source: "cross", id: type.id, name: type.name, description: `${type.sourceTypeName ?? from.typeName} → ${type.targetTypeName ?? to.typeName}` });
        }
      }
      // Within one support domain model: its own element-type relationships.
      if (from.kind === "SUPPORT_DOMAIN_MODEL" && to.kind === "SUPPORT_DOMAIN_MODEL" && from.modelId === to.modelId) {
        for (const rel of sdRelationships) {
          if (rel.sourceElementId !== from.typeId || rel.targetElementId !== to.typeId) continue;
          if (sdLinks.some((link) => link.support_domain_relationship_id === rel.id && link.source_instance_id === fromId && link.target_instance_id === toId)) continue;
          options.push({ source: "sd", id: rel.id, name: relationshipKindLabel(rel.relationshipKind), description: `${from.typeName} → ${to.typeName} (${from.modelName})` });
        }
      }
      return options;
    },
    [endById, crossLinks, governed, sdRelationships, sdLinks],
  );
  const canConnect = useCallback((fromId: string, toId: string) => optionsFor(fromId, toId).length > 0, [optionsFor]);

  // ── Reference layer: the allowable type relationships, projected on the instances shown ──
  const referenceLinks = useMemo<DiagramTypeLink[]>(() => {
    if (!showReference) return [];
    const actual = new Set(allLinks.map((link) => `${link.sourceId}>${link.targetId}|${link.name}`));
    const shown = canvasItems.map((item) => endById.get(item.id)).filter((end): end is End => Boolean(end));
    const refs: DiagramTypeLink[] = [];
    const add = (id: string, from: End, to: End, name: string) => {
      if (!actual.has(`${from.id}>${to.id}|${name}`)) refs.push({ id, sourceId: from.id, targetId: to.id, name, category: "CROSS_MODEL" });
    };
    const rules = hierarchyRulesQuery.data ?? [];
    for (const from of shown) {
      for (const to of shown) {
        if (from.id === to.id) continue;
        for (const type of crossTypesFor(governed, from, to)) add(type.id, from, to, type.name);
        if (from.kind === "SUPPORT_DOMAIN_MODEL" && to.kind === "SUPPORT_DOMAIN_MODEL" && from.modelId === to.modelId) {
          for (const rel of sdRelationships) if (rel.sourceElementId === from.typeId && rel.targetElementId === to.typeId) add(rel.id, from, to, relationshipKindLabel(rel.relationshipKind));
        }
        if (from.kind === "HIERARCHY_MODEL" && to.kind === "HIERARCHY_MODEL" && from.modelId === to.modelId && to.parentId !== from.id) {
          for (const rule of rules) if (rule.parentNodeId === from.typeId && rule.childNodeId === to.typeId) add(rule.id, from, to, HIERARCHY_LINK_LABEL);
        }
      }
    }
    return refs;
  }, [showReference, allLinks, canvasItems, endById, governed, sdRelationships, hierarchyRulesQuery.data]);

  // ── Create and delete governed relationships ──────────────────────────────
  const [choice, setChoice] = useState<{ from: End; to: End; options: Option[] } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; label: string; kind: "cross" | "sd" } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const create = async (from: End, to: End, option: Option) => {
    try {
      if (option.source === "cross") {
        await createCross.mutateAsync({ relationship_rule_id: option.id, source_instance_id: from.id, source_instance_type: from.kind, target_instance_id: to.id, target_instance_type: to.kind });
      } else {
        await createSd.mutateAsync({ support_domain_relationship_id: option.id, source_instance_id: from.id, target_instance_id: to.id });
      }
      showToast(`${from.name} → ${option.name} → ${to.name}.`);
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast(detail ?? (error instanceof Error ? error.message : "Could not create the relationship."), "error");
    }
  };
  const connect = useCallback(
    (fromId: string, toId: string) => {
      const from = endById.get(fromId);
      const to = endById.get(toId);
      if (!from || !to) return;
      const options = optionsFor(fromId, toId);
      if (options.length === 1) void create(from, to, options[0]);
      else if (options.length > 1) setChoice({ from, to, options });
    },
    [endById, optionsFor], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const relationshipMenu = useCallback(
    (category: RelationshipLinkCategory, relationships: EdgeRelationship[]): MenuEntry[] => {
      const rel = relationships[0];
      if (!rel) return [];
      if (category === "HIERARCHY") {
        return [{ kind: "header", key: "where", label: "Parent → child — changed in Structure › Hierarchy" }];
      }
      const found = linkById.get(rel.id);
      if (!found) return [];
      const sourceName = found.kind === "cross" ? found.link.source_instance_name : found.link.source_instance_name;
      const targetName = found.kind === "cross" ? found.link.target_instance_name : found.link.target_instance_name;
      const label = `${sourceName} → ${rel.name} → ${targetName}`;
      return [
        { kind: "header", key: "what", label },
        {
          kind: "item",
          key: "delete",
          label: "Delete relationship",
          icon: <DeleteOutlineIcon />,
          danger: true,
          onClick: () => {
            setDeleteError(null);
            setDeleting({ id: rel.id, label, kind: found.kind });
          },
        },
      ];
    },
    [linkById],
  );

  // ── Canvas items (a projection: never creates or deletes an instance) ─────
  const toDragData = (item: CrossModelSelectableItem): SidebarDragData => ({ kind: itemKindOf(item.modelKind), id: item.id, name: item.name, modelName: item.modelName });
  function handleDrop(data: SidebarDragData[]) {
    setDiagramCanvasItems((prev) => {
      const present = new Set(prev.map((i) => i.id));
      const added: DiagramItem[] = [];
      for (const d of data) {
        if (present.has(d.id)) continue;
        present.add(d.id);
        const end = endById.get(d.id);
        added.push({ id: d.id, name: d.name, typeName: end?.typeName ?? "", modelName: end?.modelName ?? d.modelName, kind: d.kind });
      }
      return added.length === 0 ? prev : [...prev, ...added];
    });
    setPresentation((p) => {
      const ids = data.map((d) => d.id).filter((id) => p.nodes[id]?.hidden);
      if (ids.length === 0) return p;
      return { ...p, nodes: { ...p.nodes, ...Object.fromEntries(ids.map((id) => [id, { ...p.nodes[id], hidden: false }])) } };
    });
  }
  const handleRemove = useCallback((id: string) => setDiagramCanvasItems((prev) => prev.filter((i) => i.id !== id)), [setDiagramCanvasItems]);
  const handleNodesMoved = useCallback((positions: Record<string, Point>) => {
    setDiagramCanvasItems((prev) => prev.map((i) => (positions[i.id] ? { ...i, x: positions[i.id].x, y: positions[i.id].y } : i)));
  }, [setDiagramCanvasItems]);
  const handleResetLayout = useCallback(() => setDiagramCanvasItems((prev) => prev.map((i) => ({ ...i, x: undefined, y: undefined }))), [setDiagramCanvasItems]);
  const handleRefresh = useCallback(() => {
    for (const key of [["cross-model-type-options"], ["all-hierarchy-rules"], ["all-support-domain-relationships"], ["cross-model-links-all"], ["element-relationship-instances"], SAVED_DIAGRAMS_QUERY_KEY]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient]);

  // An instance renamed since it was put on the canvas shows its current name.
  useEffect(() => {
    setDiagramCanvasItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        const end = endById.get(item.id);
        if (!end || (end.name === item.name && end.typeName === item.typeName && end.modelName === item.modelName)) return item;
        changed = true;
        return { ...item, name: end.name, typeName: end.typeName, modelName: end.modelName };
      });
      return changed ? next : prev;
    });
  }, [endById, setDiagramCanvasItems]);

  // ── Annotations ────────────────────────────────────────────────────────────
  const handleShapeAdd = useCallback((kind: DiagramShapeKind, x: number, y: number) => setDiagramShapes((prev) => [...prev, createDiagramShape(kind, x, y)]), [setDiagramShapes]);
  const handleShapeMoved = useCallback((id: string, x: number, y: number) => setDiagramShapes((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s))), [setDiagramShapes]);
  const handleShapeResized = useCallback((id: string, width: number, height: number, x: number, y: number) => setDiagramShapes((prev) => prev.map((s) => (s.id === id ? { ...s, width, height, x, y } : s))), [setDiagramShapes]);
  const handleShapeTextChange = useCallback((id: string, text: string) => setDiagramShapes((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s))), [setDiagramShapes]);
  const handleShapeRemove = useCallback((id: string) => setDiagramShapes((prev) => prev.filter((s) => s.id !== id)), [setDiagramShapes]);
  const handleShapeStyleChange = useCallback((id: string, patch: ShapeStylePatch) => setDiagramShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s))), [setDiagramShapes]);
  const handleShapeLayers = useCallback((layers: Record<string, number>) => setDiagramShapes((prev) => prev.map((s) => (s.id in layers ? { ...s, zIndex: layers[s.id] } : s))), [setDiagramShapes]);
  const handleEdgeStylesChange = useCallback((styles: Record<string, EdgeStyle>) => setDiagramEdgeStyles((prev) => ({ ...prev, ...styles })), [setDiagramEdgeStyles]);

  // ── Saved diagrams, with auto-save — as in MWS ────────────────────────────
  const markSyncedRef = useRef<(() => void) | null>(null);
  const getSaveShapes = () => shapes.map(({ id: _id, ...shape }) => shape);
  function getSaveNodes(): SavedDiagramNode[] {
    const live = positionsRef.current?.() ?? {};
    return canvasItems.map((item) => ({ itemId: item.id, itemKind: item.kind, posX: live[item.id]?.x ?? item.x ?? 0, posY: live[item.id]?.y ?? item.y ?? 0 }));
  }
  function getSaveEdges(): SavedDiagramEdge[] {
    return Object.entries(edgeStyles).map(([edgeKey, edgeStyle]) => ({ edgeKey, edgeStyle }));
  }
  const buildSaveInput = (name: string): SaveDiagramInput => ({ name, nodes: getSaveNodes(), edges: getSaveEdges(), shapes: getSaveShapes() });

  function handleLoadDiagram(diagram: SavedDiagram) {
    // Only the instances that still exist come back.
    // Each instance once, even if the saved diagram lists it twice.
    const restored: DiagramItem[] = uniqueById(diagram.nodes.map((node) => ({ ...node, id: node.itemId }))).flatMap((node) => {
      const end = endById.get(node.itemId);
      return end ? [{ id: end.id, name: end.name, typeName: end.typeName, modelName: end.modelName, kind: itemKindOf(end.kind), x: node.posX, y: node.posY }] : [];
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
  function handleDeleted(id: string) {
    forgetPresentation(id);
    if (id === currentDiagramId) handleClearCanvas();
  }
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
    // Saved node ids are resolved against the instances; wait for them.
    enabled: !loading && endById.size > 0,
  });
  markSyncedRef.current = markSynced;

  // ── Legend: the relationship names actually drawn ─────────────────────────
  const legendTypes = useMemo(() => {
    const seen = new Map<string, { name: string; category: RelationshipLinkCategory }>();
    for (const link of visibleLinks) if (link.name) seen.set(`${link.category}|${link.name}`, { name: link.name, category: link.category });
    return [...seen.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, category }) => ({ key: `${category}|${name}`, name, source: getLinkCategoryLabel(category), color: getLinkColor(category, name), bg: getLinkBg(category, name) }));
  }, [visibleLinks]);

  const nodeCount = canvasItems.filter((i) => i.kind === "HIERARCHY_NODE").length;
  const elemCount = canvasItems.length - nodeCount;

  if (loading && canvasItems.length === 0) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box display="flex" flex={1} minHeight={0} width="100%">
      {renderSelection(props.selectionSlot, (
        <InstanceSelectionPanel
          mode="diagram"
          models={selectionModels}
          typeOptions={typeOptions}
          modelStatus={modelStatus}
          onCanvas={canvasIds}
          onAdd={(added) => handleDrop(added.map(toDragData))}
          onRemove={(removed) => {
            const ids = new Set(removed.map((item) => item.id));
            setDiagramCanvasItems((prev) => prev.filter((i) => !ids.has(i.id)));
          }}
          onDragStart={(dragged, event) => {
            event.dataTransfer.setData("application/pdp-diagram", JSON.stringify(dragged.map(toDragData)));
            event.dataTransfer.effectAllowed = "copy";
          }}
        />
      ), 360)}

      <Box display="flex" flexDirection="column" flex={1} minHeight={0} minWidth={0} gap={1}>
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
            onDuplicated={(_from, diagram) => {
              savePresentation(diagram.id, presentation, shapes);
              handleLoadDiagram(diagram);
            }}
            onDeleted={handleDeleted}
            status={<SavedDiagramSyncStatusLabel status={syncStatus} />}
          />
          {canvasItems.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {nodeCount} node instance{nodeCount !== 1 ? "s" : ""}, {elemCount} element instance{elemCount !== 1 ? "s" : ""}, {visibleLinks.length} relationship{visibleLinks.length !== 1 ? "s" : ""}
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" rowGap={0.5} flexShrink={0}>
          <Typography variant="caption" color="text.secondary" mr={0.5}>Show:</Typography>
          {LINK_CATEGORIES.map((category) => {
            const shown = !hiddenCategories.has(category.key);
            const count = canvasLinks.filter((l) => l.category === category.key).length;
            const color = category.color ?? RELATIONSHIP_FALLBACK_COLOR;
            return (
              <Chip
                key={category.key}
                size="small"
                label={`${category.label} (${count})`}
                onClick={() =>
                  setHiddenCategories((prev) => {
                    const next = new Set(prev);
                    if (next.has(category.key)) next.delete(category.key);
                    else next.add(category.key);
                    return next;
                  })
                }
                variant={shown ? "filled" : "outlined"}
                sx={{ fontSize: 10, height: 20, fontWeight: 600, cursor: "pointer", bgcolor: shown ? `${color}18` : "transparent", color: shown ? color : "text.disabled", borderColor: shown ? `${color}55` : "divider", borderStyle: "solid", borderWidth: 1 }}
              />
            );
          })}
          <Tooltip title="The relationships the Model Workspace allows between these instances' types — grey, dashed and read only, behind the real relationships.">
            <Chip
              size="small"
              label={`Allowable (model)${showReference ? ` (${referenceLinks.length})` : ""}`}
              onClick={() => setShowReference((shown) => !shown)}
              variant={showReference ? "filled" : "outlined"}
              sx={{ fontSize: 10, height: 20, fontWeight: 600, cursor: "pointer", fontStyle: "italic", bgcolor: showReference ? "#ECEFF1" : "transparent", color: showReference ? "#607D8B" : "text.disabled", borderColor: showReference ? "#B0BEC5" : "divider", borderStyle: "dashed", borderWidth: 1 }}
            />
          </Tooltip>
        </Stack>

        {prefs.legend && legendTypes.length > 0 && (
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" rowGap={0.5} flexShrink={0}>
            <Typography variant="caption" color="text.secondary" mr={0.5}>Legends:</Typography>
            {(showAllLegend ? legendTypes : legendTypes.slice(0, LEGEND_COLLAPSED_LIMIT)).map((rt) => (
              <Tooltip key={rt.key} title={`${rt.source} relationship`} arrow placement="top">
                <Chip label={rt.name} size="small" sx={{ fontSize: 10, height: 20, bgcolor: rt.bg, color: rt.color, fontWeight: 600 }} />
              </Tooltip>
            ))}
            {legendTypes.length > LEGEND_COLLAPSED_LIMIT && (
              <Chip size="small" variant="outlined" label={showAllLegend ? "Show less" : `Show all (${legendTypes.length})`} onClick={() => setShowAllLegend((prev) => !prev)} sx={{ fontSize: 10, height: 20, fontWeight: 600, cursor: "pointer", color: "text.secondary", borderColor: "divider" }} />
            )}
          </Stack>
        )}

        <ReactFlowProvider>
          <GovernanceTypesDiagramInner
            items={items}
            links={visibleLinks}
            shapes={shapes}
            badgeByTypeId={badgeById}
            presentation={presentation}
            setPresentation={setPresentation}
            prefs={prefs}
            setPrefs={setPrefs}
            onRemove={handleRemove}
            onDrop={handleDrop}
            onSelectItem={props.onSelectItem}
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
            canConnect={canConnect}
            onConnectTypes={connect}
            referenceLinks={referenceLinks}
            relationshipMenu={relationshipMenu}
            emptyText="Tick or drag instances from Item Selection onto this canvas. The governed relationships between them are drawn automatically; drag from one instance to another to create one the Model Workspace allows."
          />
        </ReactFlowProvider>
      </Box>

      <Dialog open={Boolean(choice)} onClose={() => setChoice(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Choose the relationship</DialogTitle>
        <DialogContent>
          {choice && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                The Model Workspace allows {choice.options.length} relationships from {choice.from.typeName} to {choice.to.typeName}. Which one relates these two?
              </Typography>
              <List dense disablePadding sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                {choice.options.map((option) => (
                  <ListItemButton
                    key={`${option.source}:${option.id}`}
                    onClick={() => {
                      const { from, to } = choice;
                      setChoice(null);
                      void create(from, to, option);
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap>{choice.from.name}</Typography>
                          <ArrowForwardIcon sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }} />
                          <Typography variant="body2" fontWeight={700} sx={{ flexShrink: 0 }}>{option.name}</Typography>
                          <ArrowForwardIcon sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }} />
                          <Typography variant="body2" noWrap>{choice.to.name}</Typography>
                        </Stack>
                      }
                      secondary={`${option.source === "cross" ? "Between models" : "Support domain"} · ${option.description}`}
                    />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChoice(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Delete relationship</DialogTitle>
        <DialogContent>
          {deleteError && <Alert severity="error" sx={{ mb: 1.5 }}>{deleteError}</Alert>}
          <Typography variant="body2">
            Delete “{deleting?.label}”? The relationship itself is deleted — from this and every other diagram, the Matrix and the List. The instances are not changed.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteCross.isPending || deleteSd.isPending}
            onClick={async () => {
              if (!deleting) return;
              try {
                if (deleting.kind === "cross") await deleteCross.mutateAsync({ crossModelInstanceId: deleting.id });
                else await deleteSd.mutateAsync(deleting.id);
                showToast("Relationship deleted.");
                setDeleting(null);
              } catch (error) {
                setDeleteError(error instanceof Error ? error.message : "Could not delete the relationship.");
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
