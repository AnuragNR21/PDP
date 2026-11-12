import { apiClient } from "@/shared/http/apiClient";
import type { ModelItemKind, ModelKind } from "@/shared/constants/ModelConfig";
import { toEdgeStyle, type DiagramShapeKind, type SavedDiagram, type SavedDiagramSummary, type SaveDiagramInput } from "@/features/cross-model";
import {
  type CrossModelRelationshipImpact,
} from "@/shared/contracts/crossModelImpact";
import type {
  CanonicalNodeSummary,
  DiagramProjectionSummary,
  MatrixProjectionSummary,
  NodeDetail,
  RefreshRequest,
  RelationshipInstanceSummary,
  StructureTreeResponse
} from "@/shared/contracts";

export type CreateCanonicalNodeCommand = {
  model_id: string;
  node_type_id: string;
  name: string;
  parent_node_id?: string | null;
};

export type UpdateCanonicalNodeCommand = {
  name: string;
  /** draft | active | retired (shown as Archived); omitted leaves it unchanged. */
  status?: string;
};

export type ReparentNodeCommand = {
  node_id: string;
  new_parent_node_id?: string | null;
  requested_position?: number | null;
};

export type CreateRelationshipCommand = {
  semantic_key: string;
  source_node_id: string;
  target_node_id: string;
};

export type ElementInstance = {
  instance_id: string;
  support_domain_model_id: string;
  support_domain_model_name: string;
  element_type_id: string;
  element_type_name: string;
  name: string;
  description: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CreateElementInstanceCommand = {
  support_domain_model_id: string;
  element_type_id: string;
  name: string;
  description?: string | null;
};

export type UpdateElementInstanceCommand = {
  name: string;
  description?: string | null;
  /** draft | active | retired (shown as Archived); omitted leaves it unchanged. */
  status?: string;
};

/**
 * A governed link between two element instances of one Support Domain model —
 * an instance of one of the model's relationships between element types.
 */
export type ElementRelationshipInstance = {
  /** The edge's id on the model's diagram. */
  relationship_instance_id: string;
  diagram_id: string;
  support_domain_relationship_id: string;
  support_domain_model_id: string;
  relationship_type: string;
  source_instance_id: string;
  source_instance_name: string;
  source_element_type_id: string;
  target_instance_id: string;
  target_instance_name: string;
  target_element_type_id: string;
  external_id?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Where an element type card sits on a Support Domain model's diagram. */
export type SdDiagramNode = { item_id: string; item_kind: string; pos_x: number; pos_y: number; sort_order?: number };

/** A Support Domain model's diagram, without its edges (served as diagram links). */
export type SdDiagramLayout = {
  diagram_id: string | null;
  support_domain_model_id: string;
  nodes: SdDiagramNode[];
  shapes: unknown[];
};

export type CreateElementRelationshipInstanceCommand = {
  support_domain_relationship_id: string;
  source_instance_id: string;
  target_instance_id: string;
};

export type CrossModelInstance = {
  cross_model_instance_id: string;
  relationship_rule_id: string;
  source_instance_id: string;
  source_instance_type: ModelKind;
  source_instance_name: string;
  source_model_id: string;
  source_model_name: string;
  source_type_name: string;
  target_instance_id: string;
  target_instance_type: ModelKind;
  target_instance_name: string;
  target_model_id: string;
  target_model_name: string;
  target_type_name: string;
  sort_order: number;
  created_at: string;
};

export type CreateCrossModelInstanceCommand = {
  relationship_rule_id: string;
  source_instance_id: string;
  source_instance_type: ModelKind;
  target_instance_id: string;
  target_instance_type: ModelKind;
};

/** An instance only ever re-points at another governed type. */
export type UpdateCrossModelInstanceCommand = {
  relationship_rule_id: string;
};

export type EffectiveProperty = {
  property_id: string;
  property_name: string;
  property_description: string | null;
  property_status: string;
  origin: 'defined' | 'inherited';
  inherited_from?: string | null;
  source_node_type_id?: string;
  source_node_type_name?: string;
  source_element_type_id?: string;
  source_element_type_name?: string;
  inheritance_distance?: number;
  /** Node instances only: whether the property passes to child node types. */
  inheritable?: boolean;
  /** Node instances only: this instance's value (SWS); null when none is set. */
  value?: string | null;
  value_updated_at?: string | null;
};

export type HierarchyModelGovernedDeleteImpactNode = {
  node_id: string;
  parent_node_id: string | null;
  name: string;
  display_name: string;
  node_path: string;
};

export type HierarchyModelGovernedDeleteImpactInstance = {
  instance_id: string;
  node_id: string;
  parent_node_id: string | null;
  instance_name: string;
  node_name: string;
  instance_path: string;
};

export type HierarchyModelGovernedDeleteImpact = {
  node_instance_id: string;
  is_root: boolean;
  model_id: string;
  model_name: string;
  node_count: number;
  instance_count: number;
  relationship_count: number;
  diagram_node_count: number;
  diagram_edge_count: number;
  nodes: HierarchyModelGovernedDeleteImpactNode[];
  node_instances: HierarchyModelGovernedDeleteImpactInstance[];
  cross_model_relationship_impact: CrossModelRelationshipImpact;
};

export type SupportDomainModelGovernedDeleteImpact = {
  model_id: string;
  model_name: string;
  element_count: number;
  instance_count: number;
  elements: {
    element_id: string;
    name: string;
    display_name: string;
  }[];
  element_instances: {
    instance_id: string;
    element_type_id: string;
    instance_name: string;
    element_type_name: string;
    instance_path: string;
  }[];
  cross_model_relationship_impact: CrossModelRelationshipImpact;
};

export type SupportDomainElementInstanceGovernedDeleteImpact = {
  instance_id: string;
  model_id: string;
  model_name: string;
  instance_count: number;
  elements: SupportDomainModelGovernedDeleteImpact["elements"];
  element_instances: SupportDomainModelGovernedDeleteImpact["element_instances"];
  cross_model_relationship_impact: CrossModelRelationshipImpact;
};

export type StructureImportPayload = {
  template_metadata?: Record<string, unknown>;
  load_hierarchy_node_instances?: Record<string, unknown>[];
  load_support_domain_elements?: Record<string, unknown>[];
  load_support_domain_element_relationships?: Record<string, unknown>[];
  load_support_domain_relationships?: Record<string, unknown>[];
  /** Links between SD element instances (object_type support_domain_model_element_instance_relationship). */
  load_support_domain_element_instance_relationships?: Record<string, unknown>[];
};

export type StructureImportValidationRow = {
  row_number: number;
  object_type:
  | "hierarchy_model_node_instance"
  | "support_domain_model_element_instance"
  | "support_domain_model_element_instance_relationship"
  | "support_domain_relationship_instance";
  action: "CREATE" | "UPSERT";
  status: "accepted" | "rejected";
  code: string;
  message: string;
  warnings: string[];
  key: string | null;
};

export type StructureImportValidateResponse = {
  stage_id: string;
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    warnings: number;
  };
  rows: StructureImportValidationRow[];
};

export type StructureImportCommitResponse = {
  stage_id: string;
  committed: number;
  failed: number;
  rows: StructureImportValidationRow[];
};

type SavedDiagramNodeDto = { item_id: string; item_kind: ModelItemKind; pos_x: number; pos_y: number };
type SavedDiagramEdgeDto = { edge_key: string; edge_style: string };
type SavedDiagramShapeDto = {
  shape_kind: DiagramShapeKind;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  text: string;
  stroke_color?: string | null;
  text_color?: string | null;
  font_size?: number | null;
  z_index?: number | null;
};
type SavedDiagramDto = {
  diagram_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  nodes: SavedDiagramNodeDto[];
  edges?: SavedDiagramEdgeDto[];
  shapes?: SavedDiagramShapeDto[];
};
type SavedDiagramSummaryDto = { diagram_id: string; name: string; created_at: string; updated_at: string; node_count: number };

const mapSavedDiagram = (dto: SavedDiagramDto): SavedDiagram => ({
  id: dto.diagram_id,
  name: dto.name,
  createdAt: dto.created_at,
  updatedAt: dto.updated_at,
  nodeCount: dto.nodes.length,
  nodes: dto.nodes.map((n) => ({ itemId: n.item_id, itemKind: n.item_kind, posX: n.pos_x, posY: n.pos_y })),
  // `edges` is absent on diagrams saved before per-connection line styles existed.
  edges: (dto.edges ?? []).map((e) => ({ edgeKey: e.edge_key, edgeStyle: toEdgeStyle(e.edge_style) })),
  // `shapes` is absent on diagrams saved before annotations existed.
  shapes: (dto.shapes ?? []).map((shape) => ({
    kind: shape.shape_kind,
    x: shape.pos_x,
    y: shape.pos_y,
    width: shape.width,
    height: shape.height,
    text: shape.text ?? "",
    strokeColor: shape.stroke_color ?? null,
    textColor: shape.text_color ?? null,
    fontSize: shape.font_size ?? null,
    zIndex: shape.z_index ?? null,
  })),
});

const toSaveDiagramBody = (input: SaveDiagramInput) => ({
  name: input.name,
  nodes: input.nodes.map((n) => ({ item_id: n.itemId, item_kind: n.itemKind, pos_x: n.posX, pos_y: n.posY })),
  edges: input.edges.map((e) => ({ edge_key: e.edgeKey, edge_style: e.edgeStyle })),
  shapes: (input.shapes ?? []).map((shape) => ({
    shape_kind: shape.kind,
    pos_x: shape.x,
    pos_y: shape.y,
    width: shape.width,
    height: shape.height,
    text: shape.text,
    stroke_color: shape.strokeColor ?? null,
    text_color: shape.textColor ?? null,
    font_size: shape.fontSize ?? null,
    z_index: shape.zIndex ?? null,
  })),
});

export const structureApi = {
  listNodes: (parentNodeId?: string | null) =>
    apiClient.get<StructureTreeResponse>(
      parentNodeId ? `/api/structure/node-instances?parent_node_id=${encodeURIComponent(parentNodeId)}` : "/api/structure/node-instances"
    ),
  listNodesForModel: (modelId: string) =>
    apiClient.get<StructureTreeResponse>(`/api/structure/node-instances?model_id=${encodeURIComponent(modelId)}`),
  getNodeDetail: (nodeId: string) => apiClient.get<NodeDetail>(`/api/structure/node-instances/${nodeId}`),
  createNode: (payload: CreateCanonicalNodeCommand) =>
    apiClient.post<{ node: CanonicalNodeSummary; refresh: RefreshRequest }>("/api/structure/node-instances", payload),
  updateNode: (nodeId: string, payload: UpdateCanonicalNodeCommand) =>
    apiClient.patch<{ node: CanonicalNodeSummary; refresh: RefreshRequest }>(`/api/structure/node-instances/${nodeId}`, payload),
  deleteNode: (nodeId: string) =>
    apiClient.delete<void>(`/api/structure/node-instances/${nodeId}`),
  getGovernedDeleteImpact: (nodeId: string) =>
    apiClient.get<HierarchyModelGovernedDeleteImpact>(`/api/structure/node-instances/${nodeId}/impacts/delete`),
  ensureRootInstance: (modelId: string) =>
    apiClient.post<CanonicalNodeSummary>(`/api/structure/node-instances/ensure-root?model_id=${encodeURIComponent(modelId)}`),
  reorderNodes: (payload: { parent_node_id: string; ordered_child_node_ids: string[] }) =>
    apiClient.post<unknown>("/api/structure/hierarchy/reorder", payload),
  reparentNode: (payload: ReparentNodeCommand) =>
    apiClient.post<{ node: CanonicalNodeSummary; refresh: RefreshRequest }>("/api/structure/hierarchy/reparent", payload),
  getDiagramProjection: (modelId: string) =>
    apiClient.get<{ projection: DiagramProjectionSummary }>(
      `/api/structure/projections/diagram?model_id=${encodeURIComponent(modelId)}`
    ),
  getMatrixProjection: (modelId: string) =>
    apiClient.get<{ projection: MatrixProjectionSummary }>(
      `/api/structure/projections/matrix?model_id=${encodeURIComponent(modelId)}`
    ),
  createRelationship: (payload: CreateRelationshipCommand) =>
    apiClient.post<{ relationship: RelationshipInstanceSummary; refresh: RefreshRequest }>(
      "/structure/relationships",
      payload
    ),
  deleteRelationship: (relationshipId: string) =>
    apiClient.delete<{ relationship_id: string; refresh: RefreshRequest }>(
      `/structure/relationships/${relationshipId}`
    ),
  listElementInstances: (modelId?: string | null) =>
    apiClient.get<ElementInstance[]>(
      modelId
        ? `/api/structure/element-instances?model_id=${encodeURIComponent(modelId)}`
        : '/api/structure/element-instances'
    ),
  createElementInstance: (payload: CreateElementInstanceCommand) =>
    apiClient.post<ElementInstance>('/api/structure/element-instances', payload),
  updateElementInstance: (instanceId: string, payload: UpdateElementInstanceCommand) =>
    apiClient.patch<ElementInstance>(`/api/structure/element-instances/${instanceId}`, payload),
  deleteElementInstance: (instanceId: string) =>
    apiClient.delete<void>(`/api/structure/element-instances/${instanceId}`),
  getElementInstanceDeleteImpact: (instanceId: string) =>
    apiClient.get<SupportDomainElementInstanceGovernedDeleteImpact>(
      `/api/structure/element-instances/${encodeURIComponent(instanceId)}/impacts/delete`
    ),
  getSupportDomainModelDeleteImpact: (modelId: string) =>
    apiClient.get<SupportDomainModelGovernedDeleteImpact>(
      `/api/structure/element-instances/models/${encodeURIComponent(modelId)}/impacts/delete`
    ),
  deleteSupportDomainModel: (modelId: string) =>
    apiClient.delete<void>(`/api/structure/element-instances/models/${encodeURIComponent(modelId)}`),
  listElementRelationshipInstances: (modelId: string) =>
    apiClient.get<ElementRelationshipInstance[]>(
      `/api/structure/sd-diagram-links?model_id=${encodeURIComponent(modelId)}`
    ),
  listAllElementRelationshipInstances: () =>
    apiClient.get<ElementRelationshipInstance[]>('/api/structure/sd-diagram-links'),
  createElementRelationshipInstance: (payload: CreateElementRelationshipInstanceCommand) =>
    apiClient.post<ElementRelationshipInstance>('/api/structure/sd-diagram-links', payload),
  getSdDiagram: (modelId: string) =>
    apiClient.get<SdDiagramLayout>(`/api/structure/sd-diagram?model_id=${encodeURIComponent(modelId)}`),
  replaceSdDiagramNodes: (modelId: string, nodes: Array<Pick<SdDiagramNode, "item_id" | "pos_x" | "pos_y"> & { item_kind?: string }>) =>
    apiClient.put<SdDiagramLayout>("/api/structure/sd-diagram/nodes", { support_domain_model_id: modelId, nodes }),
  deleteElementRelationshipInstance: (relationshipInstanceId: string) =>
    apiClient.delete<void>(`/api/structure/sd-diagram-links/${encodeURIComponent(relationshipInstanceId)}`),
  listCrossModelInstances: (params: { source_instance_id?: string; target_instance_id?: string }) => {
    const parts: string[] = [];
    if (params.source_instance_id) parts.push(`source_instance_id=${encodeURIComponent(params.source_instance_id)}`);
    if (params.target_instance_id) parts.push(`target_instance_id=${encodeURIComponent(params.target_instance_id)}`);
    const qs = parts.length > 0 ? `?${parts.join("&")}` : "";
    return apiClient.get<CrossModelInstance[]>(`/api/structure/cross-model-instances${qs}`);
  },
  createCrossModelInstance: (payload: CreateCrossModelInstanceCommand) =>
    apiClient.post<CrossModelInstance>('/api/structure/cross-model-instances', payload),
  updateCrossModelInstance: (crossModelInstanceId: string, payload: UpdateCrossModelInstanceCommand) =>
    apiClient.patch<CrossModelInstance>(`/api/structure/cross-model-instances/${crossModelInstanceId}`, payload),
  deleteCrossModelInstance: (crossModelInstanceId: string) =>
    apiClient.delete<void>(`/api/structure/cross-model-instances/${crossModelInstanceId}`),

  // Saved cross-model relationship diagrams (instance level)
  listCrossModelInstanceDiagrams: async (): Promise<SavedDiagramSummary[]> =>
    (await apiClient.get<SavedDiagramSummaryDto[]>(`/api/structure/cross-model-instance-diagrams`)).map((d) => ({
      id: d.diagram_id,
      name: d.name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      nodeCount: Number(d.node_count),
    })),
  getCrossModelInstanceDiagram: async (id: string): Promise<SavedDiagram> =>
    mapSavedDiagram(await apiClient.get<SavedDiagramDto>(`/api/structure/cross-model-instance-diagrams/${id}`)),
  createCrossModelInstanceDiagram: async (input: SaveDiagramInput): Promise<SavedDiagram> =>
    mapSavedDiagram(await apiClient.post<SavedDiagramDto>(`/api/structure/cross-model-instance-diagrams`, toSaveDiagramBody(input))),
  updateCrossModelInstanceDiagram: async (id: string, input: SaveDiagramInput): Promise<SavedDiagram> =>
    mapSavedDiagram(await apiClient.put<SavedDiagramDto>(`/api/structure/cross-model-instance-diagrams/${id}`, toSaveDiagramBody(input))),
  deleteCrossModelInstanceDiagram: (id: string) =>
    apiClient.delete<void>(`/api/structure/cross-model-instance-diagrams/${id}`),

  // Node instance properties
  listNodeInstanceProperties: (nodeInstanceId: string) =>
    apiClient.get<EffectiveProperty[]>(`/api/structure/node-instances/${nodeInstanceId}/properties`),

  /** The instance's value for a Node Type Property (only the value — the definition is MWS's). Empty clears it. */
  setNodeInstancePropertyValue: (nodeInstanceId: string, propertyId: string, value: string) =>
    apiClient.put<EffectiveProperty>(
      `/api/structure/node-instances/${encodeURIComponent(nodeInstanceId)}/properties/${encodeURIComponent(propertyId)}/value`,
      { value },
    ),

  // Element instance properties
  listElementInstanceProperties: (instanceId: string) =>
    apiClient.get<EffectiveProperty[]>(`/api/structure/element-instances/${instanceId}/properties`),

  validateImport: (payload: StructureImportPayload) =>
    apiClient.post<StructureImportValidateResponse>("/api/structure/imports/validate", { payload }),
  commitImport: (stageId: string, selectedRowNumbers?: number[]) =>
    apiClient.post<StructureImportCommitResponse>("/api/structure/imports/commit", {
      stage_id: stageId,
      selected_row_numbers: selectedRowNumbers,
    }),
  validateHierarchyImport: (payload: StructureImportPayload) =>
    apiClient.post<StructureImportValidateResponse>("/api/structure/imports/hierarchy/validate", {
      template_metadata: payload.template_metadata ?? {},
      load_hierarchy_node_instances: payload.load_hierarchy_node_instances ?? [],
    }),
  validateSupportDomainImport: (payload: StructureImportPayload) =>
    apiClient.post<StructureImportValidateResponse>("/api/structure/imports/support-domain/validate", {
      template_metadata: payload.template_metadata ?? {},
      load_support_domain_elements: payload.load_support_domain_elements ?? [],
      load_support_domain_element_instance_relationships: payload.load_support_domain_element_instance_relationships ?? [],
    }),
  validateSupportDomainRelationshipImport: (payload: StructureImportPayload) =>
    apiClient.post<StructureImportValidateResponse>("/api/structure/imports/support-domain-relationships/validate", {
      template_metadata: payload.template_metadata ?? {},
      load_support_domain_element_relationships: payload.load_support_domain_element_relationships ?? [],
    }),
  commitHierarchyImport: (stageId: string, selectedRowNumbers?: number[]) =>
    apiClient.post<StructureImportCommitResponse>("/api/structure/imports/hierarchy/commit", {
      stage_id: stageId,
      selected_row_numbers: selectedRowNumbers,
    }),
  commitSupportDomainImport: (stageId: string, selectedRowNumbers?: number[]) =>
    apiClient.post<StructureImportCommitResponse>("/api/structure/imports/support-domain/commit", {
      stage_id: stageId,
      selected_row_numbers: selectedRowNumbers,
    }),
  commitSupportDomainRelationshipImport: (stageId: string, selectedRowNumbers?: number[]) =>
    apiClient.post<StructureImportCommitResponse>("/api/structure/imports/support-domain-relationships/commit", {
      stage_id: stageId,
      selected_row_numbers: selectedRowNumbers,
    }),
  // Omit modelIds to export every model; pass a list to export only those models.
  exportStructureData: (
    templateType: "all" | "hierarchy" | "support-domain" = "all",
    modelIds?: string[],
  ) => {
    const params = new URLSearchParams({ template_type: templateType });
    modelIds?.forEach((modelId) => params.append("model_ids", modelId));
    return apiClient.get<Record<string, unknown>>(`/api/structure/exports?${params.toString()}`);
  },
};
