import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  structureApi,
  type CreateCanonicalNodeCommand,
  type CreateCrossModelInstanceCommand,
  type CreateElementInstanceCommand,
  type CreateElementRelationshipInstanceCommand,
  type ElementInstance,
  type UpdateCanonicalNodeCommand,
  type UpdateCrossModelInstanceCommand,
  type UpdateElementInstanceCommand,
} from "../api/structureApi";
import { modelDefinitionsApi } from "@/features/model/api/modelDefinitionsApi";
import type { CanonicalNodeSummary } from "@/shared/contracts";
import {
  CROSS_MODEL_SELECTION_LEVEL,
  type CrossModelSelectableItem,
  type CrossModelSelectionModel,
} from "@/features/cross-model";
import type { ModelKind } from "@/shared/constants/ModelConfig";

export type NodeTreeItem = CanonicalNodeSummary & {
  node_type_name: string;
  children: NodeTreeItem[];
};

export function buildNodeTree(nodes: CanonicalNodeSummary[], nodeTypes: { id: string, name: string }[]): NodeTreeItem[] {
  const typeMap = new Map(nodeTypes.map(t => [t.id, t.name]));
  const map = new Map<string, NodeTreeItem>();
  nodes.forEach((n) => map.set(n.node_id, { ...n, node_type_name: typeMap.get(n.node_type_id) ?? '', children: [] }));
  const roots: NodeTreeItem[] = [];
  nodes.forEach((n) => {
    const item = map.get(n.node_id)!;
    if (n.parent_node_id && map.has(n.parent_node_id)) {
      map.get(n.parent_node_id)!.children.push(item);
    } else {
      roots.push(item);
    }
  });
  return roots;
}

export function useHierarchyModels() {
  return useQuery({
    queryKey: ["hierarchy-models-list"],
    queryFn: () => modelDefinitionsApi.listHierarchyModels(),
  });
}

export function useSupportDomainModels() {
  return useQuery({
    queryKey: ["support-domain-models-list"],
    queryFn: () => modelDefinitionsApi.listSupportDomainModels(),
  });
}

/**
 * Lifecycle for relationship authoring: an instance may take a new
 * relationship only if it is not Archived and its model and type are Active.
 * (The type options list only Active types, so a missing type is not Active.)
 */
function lifecycleOf(status: string, model: { name: string; status: string }, typeProblem: string | null) {
  const label = (s: string) => (s === "retired" ? "Archived" : s.charAt(0).toUpperCase() + s.slice(1));
  let lifecycleReason: string | undefined;
  if (status === "retired") lifecycleReason = "Archived — it stays in the relationships it has, but takes no new ones";
  else if (model.status !== "active") lifecycleReason = `Model “${model.name}” is ${label(model.status)} in the Model Workspace`;
  else if (typeProblem) lifecycleReason = `${typeProblem} in the Model Workspace`;
  return { lifecycle: status, authorable: !lifecycleReason, lifecycleReason };
}

export function useCrossModelSelectionModels(): CrossModelSelectionModel[] {
  const hierarchyModels = useHierarchyModels();
  const supportDomainModels = useSupportDomainModels();
  const typeOptionsQuery = useQuery({
    queryKey: ["cross-model-type-options"],
    queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions(),
  });
  const hierarchy = hierarchyModels.data ?? [];
  const supportDomains = supportDomainModels.data ?? [];

  const nodeQueries = useQueries({
    queries: hierarchy.map((model) => ({
      queryKey: ["structure-nodes-for-model", model.id],
      queryFn: () => structureApi.listNodesForModel(model.id),
    })),
  });
  const elementQueries = useQueries({
    queries: supportDomains.map((model) => ({
      queryKey: ["element-instances", model.id],
      queryFn: () => structureApi.listElementInstances(model.id),
    })),
  });

  const nodeTypeById = new Map(
    (typeOptionsQuery.data?.nodeTypes ?? []).map((type) => [type.id, type]),
  );
  const elementTypeById = new Map(
    (typeOptionsQuery.data?.elementTypes ?? []).map((type) => [type.id, type]),
  );

  function toHierarchySelectableItem(
    model: (typeof hierarchy)[number],
    node: CanonicalNodeSummary,
  ): CrossModelSelectableItem {
    const type = nodeTypeById.get(node.node_type_id);
    return {
      id: node.node_id,
      name: node.name,
      level: CROSS_MODEL_SELECTION_LEVEL.INSTANCE,
      modelKind: "HIERARCHY_MODEL" as ModelKind,
      modelId: model.id,
      modelName: model.name,
      typeId: node.node_type_id,
      typeName: type?.name ?? "",
      parentId: node.parent_node_id,
      badge: type?.badge,
      ...lifecycleOf(node.status, model, type ? null : "Its node type is not Active"),
    };
  }

  function toSupportDomainSelectableItem(
    model: (typeof supportDomains)[number],
    element: ElementInstance,
  ): CrossModelSelectableItem {
    const type = elementTypeById.get(element.element_type_id);
    return {
      id: element.instance_id,
      name: element.name,
      level: CROSS_MODEL_SELECTION_LEVEL.INSTANCE,
      modelKind: "SUPPORT_DOMAIN_MODEL" as ModelKind,
      modelId: model.id,
      modelName: model.name,
      typeId: element.element_type_id,
      typeName: type?.name ?? element.element_type_name,
      badge: type?.badge,
      ...lifecycleOf(element.status, model, type ? null : `Element type “${element.element_type_name}” is not Active`),
    };
  }

  const hierarchySelectionModels = hierarchy.map((model, index): CrossModelSelectionModel => {
    const nodesQuery = nodeQueries[index];
    return {
      id: model.id,
      name: model.name,
      modelKind: "HIERARCHY_MODEL" as ModelKind,
      loading: typeOptionsQuery.isLoading || nodesQuery.isLoading,
      error: typeOptionsQuery.error instanceof Error
        ? typeOptionsQuery.error.message
        : nodesQuery.error instanceof Error ? nodesQuery.error.message : null,
      items: (nodesQuery.data?.items ?? []).map((node) => toHierarchySelectableItem(model, node)),
    };
  });

  const supportDomainSelectionModels = supportDomains.map((model, index): CrossModelSelectionModel => {
    const elementsQuery = elementQueries[index];
    return {
      id: model.id,
      name: model.name,
      modelKind: "SUPPORT_DOMAIN_MODEL" as ModelKind,
      supportDomainElementTypes: [...elementTypeById.values()]
        .filter((type) => type.modelId === model.id)
        .map((type) => ({ typeId: type.id, typeName: type.name })),
      loading: typeOptionsQuery.isLoading || elementsQuery.isLoading,
      error: typeOptionsQuery.error instanceof Error
        ? typeOptionsQuery.error.message
        : elementsQuery.error instanceof Error ? elementsQuery.error.message : null,
      items: (elementsQuery.data ?? []).map((element) => toSupportDomainSelectableItem(model, element)),
    };
  });

  return [...hierarchySelectionModels, ...supportDomainSelectionModels];
}

export function useSupportDomainElementTypes(modelId: string | null) {
  return useQuery({
    queryKey: ["support-domain-element-types", modelId],
    queryFn: () => modelDefinitionsApi.listSupportDomainElements(modelId!),
    enabled: Boolean(modelId),
  });
}

export function useModelNodeInstances(modelId: string | null) {
  const nodeTypesQuery = useModelNodeTypes(modelId);

  return useQuery({
    queryKey: ["structure-nodes-for-model", modelId],
    queryFn: () => structureApi.listNodesForModel(modelId!),
    enabled: Boolean(modelId) && nodeTypesQuery.isSuccess,
    select: (data) => buildNodeTree(data.items, nodeTypesQuery.data ?? []),
  });
}

export function useModelNodeTypes(modelId: string | null) {
  return useQuery({
    queryKey: ["hierarchy-node-types-for-model", modelId],
    queryFn: () => modelDefinitionsApi.listHierarchyNodeTypes(modelId!),
    enabled: Boolean(modelId),
  });
}

export function useModelHierarchyRules(modelId: string | null) {
  return useQuery({
    queryKey: ["hierarchy-rules-for-model", modelId],
    queryFn: () => modelDefinitionsApi.listHierarchyRules(modelId!),
    enabled: Boolean(modelId),
  });
}

export function useCreateNodeInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCanonicalNodeCommand) => structureApi.createNode(payload),
    onSuccess: (_result, payload) => {
      queryClient.invalidateQueries({ queryKey: ["structure-nodes-for-model", payload.model_id] });
    },
  });
}

/** Puts one parent's children in the given order (the Re Order arrows). */
export function useReorderNodeInstances() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentNodeId, orderedChildIds }: { modelId: string; parentNodeId: string; orderedChildIds: string[] }) =>
      structureApi.reorderNodes({ parent_node_id: parentNodeId, ordered_child_node_ids: orderedChildIds }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["structure-nodes-for-model", variables.modelId] });
    },
  });
}

export function useEnsureRootInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => structureApi.ensureRootInstance(modelId),
    onSuccess: (_result, modelId) => {
      queryClient.invalidateQueries({ queryKey: ["structure-nodes-for-model", modelId] });
    },
  });
}

export function useUpdateNodeInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, modelId, payload }: { nodeId: string; modelId: string; payload: UpdateCanonicalNodeCommand }) =>
      structureApi.updateNode(nodeId, payload),
    onSuccess: (_result, { modelId }) => {
      queryClient.invalidateQueries({ queryKey: ["structure-nodes-for-model", modelId] });
    },
  });
}

export function useDeleteNodeInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId }: { nodeId: string; modelId: string }) => structureApi.deleteNode(nodeId),
    onSuccess: (_result, { modelId }) => {
      queryClient.invalidateQueries({ queryKey: ["structure-nodes-for-model", modelId] });
      queryClient.invalidateQueries({ queryKey: ["structure", "diagramProjection", modelId] });
      queryClient.invalidateQueries({ queryKey: ["structure", "matrixProjection", modelId] });
      queryClient.invalidateQueries({ queryKey: ["hierarchy-node-types-for-model", modelId] });
      queryClient.invalidateQueries({ queryKey: ["hierarchy-models-list"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-all"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-source"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-relationship-types"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-type-options"] });
    },
  });
}

export function useSupportDomainRelationships(modelId: string | null) {
  return useQuery({
    queryKey: ["support-domain-relationships", modelId],
    queryFn: () => modelDefinitionsApi.listSupportDomainRelationships(modelId!),
    enabled: Boolean(modelId),
  });
}

/** Every support domain model's element-type relationships, for the shared diagram. */
export function useAllSupportDomainRelationships() {
  return useQuery({
    queryKey: ["all-support-domain-relationships"],
    queryFn: () => modelDefinitionsApi.listSupportDomainRelationshipsForMultipleModels(),
  });
}

export function useElementInstances(modelId?: string | null) {
  return useQuery({
    queryKey: ["element-instances", modelId ?? null],
    queryFn: () => structureApi.listElementInstances(modelId),
    // Every caller passes null to mean "no Support Domain model here". Without
    // this, null fetched every element instance of every model (1,570 rows,
    // 1.3 MB, several seconds on prod) on pages that never read them.
    enabled: !!modelId,
  });
}

export function useCreateElementInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateElementInstanceCommand) => structureApi.createElementInstance(payload),
    onSuccess: (_result, payload) => {
      queryClient.invalidateQueries({ queryKey: ["element-instances", payload.support_domain_model_id] });
      queryClient.invalidateQueries({ queryKey: ["element-instances", null] });
    },
  });
}

export function useUpdateElementInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      instanceId,
      payload,
    }: {
      instanceId: string;
      payload: UpdateElementInstanceCommand;
    }) => structureApi.updateElementInstance(instanceId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["element-instances"] });
    },
  });
}

export function useDeleteElementInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId }: { instanceId: string }) =>
      structureApi.deleteElementInstance(instanceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["element-instances"] });
      queryClient.invalidateQueries({ queryKey: ["element-relationship-instances"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-all"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-source"] });
    },
  });
}

export function useDeleteSupportDomainModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => structureApi.deleteSupportDomainModel(modelId),
    onSuccess: (_result, modelId) => {
      queryClient.invalidateQueries({ queryKey: ["support-domain-models-list"] });
      queryClient.invalidateQueries({ queryKey: ["support-domain-element-types", modelId] });
      queryClient.invalidateQueries({ queryKey: ["support-domain-relationships", modelId] });
      queryClient.invalidateQueries({ queryKey: ["element-instances", modelId] });
      queryClient.invalidateQueries({ queryKey: ["element-instances", null] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-all"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-source"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-relationship-types"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-type-options"] });
    },
  });
}

export function useCrossModelLinks(sourceInstanceId: string | null) {
  return useQuery({
    queryKey: ["cross-model-links-source", sourceInstanceId],
    queryFn: () => structureApi.listCrossModelInstances({ source_instance_id: sourceInstanceId! }),
    enabled: Boolean(sourceInstanceId),
  });
}

/** The governed links between element instances of one Support Domain model. */
export function useElementRelationshipInstances(modelId?: string | null) {
  return useQuery({
    queryKey: ["element-relationship-instances", modelId ?? null],
    queryFn: () => structureApi.listElementRelationshipInstances(modelId!),
    enabled: Boolean(modelId),
  });
}

/**
 * A Support Domain model's diagram: where its element type cards sit (the
 * diagram's nodes). Its edges are the diagram links above.
 */
export function useSdDiagramLayout(modelId?: string | null) {
  return useQuery({
    queryKey: ["sd-diagram", modelId ?? null],
    queryFn: () => structureApi.getSdDiagram(modelId!),
    enabled: Boolean(modelId),
  });
}

/** Save where the cards sit; null forgets it (the automatic layout). */
export function useSaveSdDiagramLayout(modelId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: Record<string, { x: number; y: number }> | null) =>
      structureApi.replaceSdDiagramNodes(
        modelId!,
        Object.entries(layout ?? {}).map(([itemId, position]) => ({ item_id: itemId, item_kind: "element_type", pos_x: position.x, pos_y: position.y })),
      ),
    onSuccess: (layout) => queryClient.setQueryData(["sd-diagram", modelId ?? null], layout),
  });
}

/** Every model's governed element instance links, for the Relationship Diagram. */
export function useAllElementRelationshipInstances(enabled = true) {
  return useQuery({
    queryKey: ["element-relationship-instances", "all"],
    queryFn: () => structureApi.listAllElementRelationshipInstances(),
    enabled,
  });
}

export function useCreateElementRelationshipInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateElementRelationshipInstanceCommand) => structureApi.createElementRelationshipInstance(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["element-relationship-instances"] }),
  });
}

export function useDeleteElementRelationshipInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (relationshipInstanceId: string) => structureApi.deleteElementRelationshipInstance(relationshipInstanceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["element-relationship-instances"] }),
  });
}

export function useAllCrossModelLinks() {
  return useQuery({
    queryKey: ["cross-model-links-all"],
    queryFn: () => structureApi.listCrossModelInstances({}),
  });
}

export function useCreateCrossModelLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCrossModelInstanceCommand) =>
      structureApi.createCrossModelInstance(payload),
    onSuccess: (_result, payload) => {
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-source", payload.source_instance_id] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-all"] });
    },
  });
}

export function useUpdateCrossModelLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      crossModelInstanceId,
      payload,
    }: {
      crossModelInstanceId: string;
      payload: UpdateCrossModelInstanceCommand;
    }) => structureApi.updateCrossModelInstance(crossModelInstanceId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-all"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-source"] });
    },
  });
}

export function useDeleteCrossModelLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ crossModelInstanceId }: { crossModelInstanceId: string }) =>
      structureApi.deleteCrossModelInstance(crossModelInstanceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-all"] });
      queryClient.invalidateQueries({ queryKey: ["cross-model-links-source"] });
    },
  });
}

export function useActiveCrossModelRelationshipTypes() {
  return useQuery({
    queryKey: ["cross-model-relationship-types", "active"],
    queryFn: () => modelDefinitionsApi.listCrossModelRelationshipTypes("active"),
  });
}

// ── Effective property definition hooks (read-only) ─────────────────────────

export function useNodeInstanceProperties(nodeInstanceId: string | null) {
  return useQuery({
    queryKey: ["node-instance-properties", nodeInstanceId],
    queryFn: () => structureApi.listNodeInstanceProperties(nodeInstanceId!),
    enabled: Boolean(nodeInstanceId),
  });
}

/** Set (or clear) one instance's value for a Property its Node Type defines. */
export function useSetNodeInstancePropertyValue(nodeInstanceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, value }: { propertyId: string; value: string }) =>
      structureApi.setNodeInstancePropertyValue(nodeInstanceId!, propertyId, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["node-instance-properties", nodeInstanceId] }),
  });
}

// ── Property definitions (MWS) ───────────────────────────────────────────────
// A property is defined on a node TYPE (PDP-115), in the Model Workspace. SWS
// no longer adds definitions; it only fills in values (above).

export function useModelLifecycleStatuses() {
  return useQuery({
    queryKey: ["model-metadata"],
    queryFn: () => modelDefinitionsApi.getMetadata(),
    select: (metadata) => metadata.lifecycleStatuses,
    staleTime: 5 * 60_000,
  });
}

export function useElementInstanceProperties(instanceId: string | null) {
  return useQuery({
    queryKey: ["element-instance-properties", instanceId],
    queryFn: () => structureApi.listElementInstanceProperties(instanceId!),
    enabled: Boolean(instanceId),
  });
}
