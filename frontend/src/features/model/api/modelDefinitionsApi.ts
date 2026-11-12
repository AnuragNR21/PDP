import { apiClient } from '@/shared/http/apiClient';
import {
  mapCrossModelRelationshipDeleteImpacts,
  type CrossModelRelationshipTypeDeleteImpactDto,
  type CrossModelRelationshipDeleteImpactDto,
} from '@/shared/contracts/crossModelImpact';
import type {
  MetadataDto,
  HierarchyNodeTypePropertyDto,
  HierarchyModelDto,
  HierarchyNodeDto,
  HierarchyRuleDto,
  SupportDomainElementDto,
  SupportDomainModelDto,
  SupportDomainRelationshipDto,
  SupportDomainElementPropertyDto,
  BadgeDto,
  BadgeMetadataDto,
  CrossModelRelationshipTypeDto,
  CrossModelTypeOptionsDto,
} from './dto';
import {
  mapMetadata,
  mapHierarchyNodeTypeProperty,
  mapHierarchyModel,
  mapHierarchyNode,
  mapHierarchyRule,
  mapSupportDomainElement,
  mapSupportDomainModel,
  mapSupportDomainRelationship,
  mapSupportDomainElementProperty,
  mapBadge,
  mapBadgeMetadata,
  mapBadgeStore,
  mapCrossModelRelationshipType,
} from '../domain/mappers';
import type {
  HierarchyModelDraft,
  HierarchyNodeTypePropertyFormData,
  HierarchyNodeDraft,
  HierarchyModelDeleteImpact,
  NodeDeleteImpact,
  HierarchyPropertyDeleteImpact,
  RecursiveDisableImpact,
  ReparentImpact,
  InstanceParentAssignment,
  SupportDomainPropertyDeleteImpact,
  SupportDomainElementDeleteImpact,
  SupportDomainElementDraft,
  SupportDomainModelDraft,
  SupportDomainModelDeleteImpact,
  SupportDomainRelationshipDraft,
  SupportDomainElementPropertyData,
  BadgeCustomization,
  BadgeOptions,
  CrossModelRelationshipTypeDraft,
  CrossModelRelationshipTypeDeleteImpact,
  CrossModelTypeOptions,
} from '../domain/types';
import type { ModelItemKind } from '@/shared/constants/ModelConfig';
import { toEdgeStyle, type DiagramShapeKind, type SavedDiagram, type SavedDiagramSummary, type SaveDiagramInput } from '@/features/cross-model';

type SavedDiagramNodeDto = { item_type_id: string; item_kind: ModelItemKind; pos_x: number; pos_y: number };
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

// Note: at the model (type) level, `item_type_id` is actually a NodeTypeId or an
// ElementTypeId (depending on item_kind). It maps to the level-agnostic `itemId`
// on the shared SavedDiagram type. (The structure/instance level uses `item_id`.)
const mapSavedDiagram = (dto: SavedDiagramDto): SavedDiagram => ({
  id: dto.diagram_id,
  name: dto.name,
  createdAt: dto.created_at,
  updatedAt: dto.updated_at,
  nodeCount: dto.nodes.length,
  nodes: dto.nodes.map((n) => ({ itemId: n.item_type_id, itemKind: n.item_kind, posX: n.pos_x, posY: n.pos_y })),
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
  // itemId here is a NodeTypeId / ElementTypeId → persisted as item_type_id.
  nodes: input.nodes.map((n) => ({ item_type_id: n.itemId, item_kind: n.itemKind, pos_x: n.posX, pos_y: n.posY })),
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

const qs = (params: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

export const modelDefinitionsApi = {
  getMetadata: async () => mapMetadata(await apiClient.get<MetadataDto>('/api/model/metadata')),

  listHierarchyModels: async () => (await apiClient.get<HierarchyModelDto[]>('/api/model/hierarchy-models')).map(mapHierarchyModel),
  createHierarchyModel: async (draft: HierarchyModelDraft) =>
    mapHierarchyModel(await apiClient.post<HierarchyModelDto>('/api/model/hierarchy-models', {
      name: draft.name,
      purpose: draft.purpose,
      owning_domain: draft.owningDomain,
      status: draft.status,
    })),
  updateHierarchyModel: async (id: string, draft: HierarchyModelDraft) =>
    mapHierarchyModel(await apiClient.put<HierarchyModelDto>(`/api/model/hierarchy-models/${id}`, {
      name: draft.name,
      purpose: draft.purpose,
      owning_domain: draft.owningDomain,
      status: draft.status,
    })),
  getHierarchyModelDeleteImpact: async (id: string): Promise<HierarchyModelDeleteImpact> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/hierarchy-models/${id}/delete-impact`);
    return {
      modelId: data.model_id,
      modelName: data.model_name,
      nodeCount: data.node_count,
      instanceCount: data.instance_count,
      nodes: data.nodes.map((node: {
        node_id: string;
        parent_node_id: string | null;
        name: string;
        display_name: string;
        node_path: string;
      }) => ({
        nodeId: node.node_id,
        parentNodeId: node.parent_node_id,
        name: node.name,
        displayName: node.display_name,
        nodePath: node.node_path,
      })),
      nodeInstances: data.node_instances.map((instance: {
        instance_id: string;
        node_id: string;
        parent_node_id: string | null;
        instance_name: string;
        node_name: string;
        instance_path: string;
      }) => ({
        instanceId: instance.instance_id,
        nodeId: instance.node_id,
        parentNodeId: instance.parent_node_id,
        instanceName: instance.instance_name,
        nodeName: instance.node_name,
        instancePath: instance.instance_path,
      })),
      crossModelRelationships: mapCrossModelRelationshipDeleteImpacts(
        data.cross_model_relationships,
      ),
    };
  },
  deleteHierarchyModel: async (id: string) => apiClient.delete(`/api/model/hierarchy-models/${id}`),

  listHierarchyNodeTypes: async (modelId: string) =>
    (await apiClient.get<HierarchyNodeDto[]>(`/api/model/hierarchy-nodes${qs({ model_id: modelId })}`)).map(mapHierarchyNode),
  createHierarchyNodeType: async (draft: HierarchyNodeDraft) =>
    mapHierarchyNode(await apiClient.post<HierarchyNodeDto>('/api/model/hierarchy-nodes', {
      model_id: draft.modelId,
      parent_node_id: draft.parentNodeId,
      name: draft.name,
      display_name: draft.displayName,
      badge: draft.badge,
      description: draft.description,
      is_recursive: draft.isRecursive,
      is_property: draft.isProperty,
      status: draft.status,
    })),
  updateHierarchyNodeType: async (id: string, draft: HierarchyNodeDraft, options?: { confirmRecursiveRemoval?: boolean }) =>
    mapHierarchyNode(await apiClient.put<HierarchyNodeDto>(`/api/model/hierarchy-nodes/${id}`, {
      model_id: draft.modelId,
      parent_node_id: draft.parentNodeId,
      name: draft.name,
      display_name: draft.displayName,
      badge: draft.badge,
      description: draft.description,
      is_recursive: draft.isRecursive,
      is_property: draft.isProperty,
      confirm_recursive_removal: options?.confirmRecursiveRemoval ?? false,
      status: draft.status,
    })),
  deleteHierarchyNodeType: async (id: string) => apiClient.delete(`/api/model/hierarchy-nodes/${id}`),
  listHierarchyModelNodeTypeProperties: async (modelId: string, nodeId: string) =>
    (await apiClient.get<HierarchyNodeTypePropertyDto[]>(`/api/model/hierarchy-models/${modelId}/node-types/${nodeId}/properties`)).map(mapHierarchyNodeTypeProperty),
  createHierarchyNodeTypeProperty: async (modelId: string, nodeId: string, formData: HierarchyNodeTypePropertyFormData) =>
    mapHierarchyNodeTypeProperty(await apiClient.post<HierarchyNodeTypePropertyDto>(`/api/model/hierarchy-models/${modelId}/node-types/${nodeId}/properties`, {
      node_type_id: formData.nodeTypeId,
      name: formData.name,
      description: formData.description,
      inheritable: formData.inheritable,
      status: formData.status,
    })),
  updateHierarchyNodeTypeProperty: async (modelId: string, nodeId: string, id: string, formData: HierarchyNodeTypePropertyFormData) =>
    mapHierarchyNodeTypeProperty(await apiClient.put<HierarchyNodeTypePropertyDto>(`/api/model/hierarchy-models/${modelId}/node-types/${nodeId}/properties/${id}`, {
      node_type_id: formData.nodeTypeId,
      name: formData.name,
      description: formData.description,
      inheritable: formData.inheritable,
      status: formData.status,
    })),
  deleteHierarchyNodeTypeProperty: async (modelId: string, nodeId: string, id: string) => apiClient.delete(`/api/model/hierarchy-models/${modelId}/node-types/${nodeId}/properties/${id}`),
  getHierarchyNodeTypePropertyDeleteImpact: async (
    modelId: string,
    nodeId: string,
    propertyId: string,
  ): Promise<HierarchyPropertyDeleteImpact> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/hierarchy-models/${modelId}/node-types/${nodeId}/properties/${propertyId}/delete-impact`);
    return {
      propertyId: data.property_id,
      propertyName: data.property_name,
      nodeTypeId: data.node_type_id,
      inheritable: data.inheritable ?? false,
      affectedNodeTypeCount: data.affected_node_type_count ?? 0,
      affectedInstanceCount: data.affected_instance_count ?? 0,
      affectedNodeTypes: (data.affected_node_types ?? []).map((item: { node_type_id: string; node_type_name: string; depth: number; instance_count: number }) => ({
        nodeTypeId: item.node_type_id,
        nodeTypeName: item.node_type_name,
        depth: item.depth,
        instanceCount: item.instance_count,
      })),
      truncated: data.truncated ?? false,
    };
  },
  reorderHierarchyNodeType: async (
    id: string,
    newParentNodeId: string | null,
    position: number,
    confirmInstanceReparent = false,
    instanceParentAssignments: InstanceParentAssignment[] = [],
  ): Promise<void> => {
    await apiClient.patch(`/api/model/hierarchy-nodes/${id}/reorder`, {
      new_parent_node_id: newParentNodeId,
      position,
      confirm_instance_reparent: confirmInstanceReparent,
      instance_parent_assignments: instanceParentAssignments.map((a) => ({
        instance_id: a.instanceId,
        new_parent_instance_id: a.newParentInstanceId,
      })),
    });
  },
  getHierarchyNodeTypeReparentImpact: async (id: string, newParentNodeId: string | null): Promise<ReparentImpact> => {
    const qsuffix = qs({ new_parent_node_id: newParentNodeId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/hierarchy-nodes/${id}/reparent-impact${qsuffix}`);
    const summary = data.impact_summary ?? {};
    return {
      nodeId: summary.node_id,
      nodeName: summary.node_name,
      newParentIsRoot: Boolean(summary.new_parent_is_root),
      affectedInstanceCount: summary.affected_instance_count ?? 0,
      descendantInstanceCount: summary.descendant_instance_count ?? 0,
      affectedEdgeCount: summary.affected_edge_count ?? 0,
      affectedCrossModelRelationshipCount: summary.affected_cross_model_relationship_count ?? 0,
      resolvable: Boolean(summary.resolvable),
      autoResolvable: Boolean(summary.auto_resolvable),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      planItems: (data.impact_reparent_plan_items ?? []).map((m: any) => ({
        instanceId: m.instance_id,
        instanceName: m.instance_name,
        instancePath: m.instance_path,
        oldParentInstanceId: m.old_parent_instance_id ?? null,
        oldParentInstanceName: m.old_parent_instance_name ?? null,
        oldParentTypeName: m.old_parent_type_name ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        candidateParents: (m.candidate_parents ?? []).map((c: any) => ({
          instanceId: c.instance_id,
          instanceName: c.instance_name,
          instancePath: c.instance_path,
        })),
        defaultParentInstanceId: m.default_parent_instance_id ?? null,
        resolvable: Boolean(m.resolvable),
      })),
    };
  },
  getHierarchyNodeTypeDeleteImpact: async (id: string): Promise<NodeDeleteImpact> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/hierarchy-nodes/${id}/delete-impact`);
    return {
      nodeId: data.node_id,
      descendantCount: data.descendant_count,
      childNodes: data.child_nodes.map((n: { node_id: string; name: string }) => ({ nodeId: n.node_id, name: n.name })),
      affectedRules: data.affected_rules.map((r: { rule_id: string; parent_name: string; child_name: string; relationship_kind: string }) => ({
        ruleId: r.rule_id,
        parentName: r.parent_name,
        childName: r.child_name,
        relationshipKind: r.relationship_kind,
      })),
      instanceCount: data.instance_count,
      nodeInstances: data.node_instances.map((instance: {
        instance_id: string;
        node_id: string;
        parent_node_id: string | null;
        instance_name: string;
        node_name: string;
        instance_path: string;
      }) => ({
        instanceId: instance.instance_id,
        nodeId: instance.node_id,
        parentNodeId: instance.parent_node_id,
        instanceName: instance.instance_name,
        nodeName: instance.node_name,
        instancePath: instance.instance_path,
      })),
      crossModelRelationships: mapCrossModelRelationshipDeleteImpacts(
        data.cross_model_relationships,
      ),
    };
  },
  getHierarchyNodeTypeRecursiveDisableImpact: async (id: string): Promise<RecursiveDisableImpact> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/hierarchy-nodes/${id}/recursive-disable-impact`);
    return {
      nodeId: data.node_id,
      nodeName: data.node_name ?? null,
      modelId: data.model_id ?? null,
      modelName: data.model_name ?? null,
      affectedRelationshipCount: data.affected_relationship_count ?? 0,
      affectedInstanceCount: data.affected_instance_count ?? 0,
      affectedInstancePaths: (data.affected_instance_paths ?? []).map((path: string) => String(path)),
    };
  },

  listHierarchyRules: async (modelId: string) =>
    (await apiClient.get<HierarchyRuleDto[]>(`/api/model/hierarchy-rules${qs({ model_id: modelId })}`)).map(mapHierarchyRule),

  /** Every hierarchy model's rules in one read — the shared cross-model diagram spans models. */
  listAllHierarchyRules: async () =>
    (await apiClient.get<HierarchyRuleDto[]>('/api/model/hierarchy-rules')).map(mapHierarchyRule),

  listSupportDomainModels: async () => (await apiClient.get<SupportDomainModelDto[]>('/api/model/support-domain-models')).map(mapSupportDomainModel),
  createSupportDomainModel: async (draft: SupportDomainModelDraft) =>
    mapSupportDomainModel(await apiClient.post<SupportDomainModelDto>('/api/model/support-domain-models', {
      name: draft.name,
      purpose: draft.purpose,
      status: draft.status,
    })),
  updateSupportDomainModel: async (id: string, draft: SupportDomainModelDraft) =>
    mapSupportDomainModel(await apiClient.put<SupportDomainModelDto>(`/api/model/support-domain-models/${id}`, {
      name: draft.name,
      purpose: draft.purpose,
      status: draft.status,
    })),
  getSupportDomainModelDeleteImpact: async (id: string): Promise<SupportDomainModelDeleteImpact> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/support-domain-models/${id}/delete-impact`);
    return {
      modelId: data.model_id,
      modelName: data.model_name,
      elementCount: data.element_count,
      instanceCount: data.instance_count,
      elements: data.elements.map((element: { element_id: string; name: string; display_name: string }) => ({
        elementId: element.element_id,
        name: element.name,
        displayName: element.display_name,
      })),
      elementInstances: data.element_instances.map((instance: {
        instance_id: string;
        element_type_id: string;
        instance_name: string;
        element_type_name: string;
        instance_path: string;
      }) => ({
        instanceId: instance.instance_id,
        elementTypeId: instance.element_type_id,
        instanceName: instance.instance_name,
        elementTypeName: instance.element_type_name,
        instancePath: instance.instance_path,
      })),
      crossModelRelationships: mapCrossModelRelationshipDeleteImpacts(
        data.cross_model_relationships,
      ),
    };
  },
  deleteSupportDomainModel: async (id: string) => apiClient.delete(`/api/model/support-domain-models/${id}`),

  listSupportDomainElements: async (modelId: string) =>
    (await apiClient.get<SupportDomainElementDto[]>(`/api/model/support-domain-elements${qs({ model_id: modelId })}`)).map(mapSupportDomainElement),
  createSupportDomainElement: async (draft: SupportDomainElementDraft) =>
    mapSupportDomainElement(await apiClient.post<SupportDomainElementDto>('/api/model/support-domain-elements', {
      model_id: draft.modelId,
      name: draft.name,
      display_name: draft.displayName,
      badge: draft.badge,
      description: draft.description,
      status: draft.status,
    })),
    
  listSupportDomainElementProperties: async (modelId: string, elementId: string) =>
    (await apiClient.get<SupportDomainElementPropertyDto[]>(
      `/api/model/support-domain-model/${modelId}/elements/${elementId}/properties`,
    )).map(mapSupportDomainElementProperty),

  createSupportDomainElementProperty: async (modelId: string, data: SupportDomainElementPropertyData) =>
    mapSupportDomainElementProperty(await apiClient.post<SupportDomainElementPropertyDto>(
      `/api/model/support-domain-model/${modelId}/elements/${data.elementId}/properties`,
      {
        element_id: data.elementId,
        name: data.name,
        description: data.description,
        status: data.status,
      },
    )),

  updateSupportDomainElementProperty: async (
    modelId: string,
    id: string,
    data: SupportDomainElementPropertyData,
  ) =>
    mapSupportDomainElementProperty(await apiClient.put<SupportDomainElementPropertyDto>(
      `/api/model/support-domain-model/${modelId}/elements/${data.elementId}/properties/${id}`,
      {
        element_id: data.elementId,
        name: data.name,
        description: data.description,
        status: data.status,
      },
    )),

  deleteSupportDomainElementProperty: async (modelId: string, elementId: string, id: string) =>
    apiClient.delete(
      `/api/model/support-domain-model/${modelId}/elements/${elementId}/properties/${id}`,
    ),
  getSupportDomainElementPropertyDeleteImpact: async (
    modelId: string,
    elementId: string,
    propertyId: string,
  ): Promise<SupportDomainPropertyDeleteImpact> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/support-domain-model/${modelId}/elements/${elementId}/properties/${propertyId}/delete-impact`);
    return {
      propertyId: data.property_id,
      propertyName: data.property_name,
      elementId: data.element_id,
      elementName: data.element_name ?? null,
      affectedInstanceCount: data.affected_instance_count ?? 0,
    };
  },

  updateSupportDomainElement: async (id: string, draft: SupportDomainElementDraft) =>
    mapSupportDomainElement(await apiClient.put<SupportDomainElementDto>(`/api/model/support-domain-elements/${id}`, {
      model_id: draft.modelId,
      name: draft.name,
      display_name: draft.displayName,
      badge: draft.badge,
      description: draft.description,
      status: draft.status,
    })),
  updateSupportDomainElementPosition: async (elementId: string, payload: { x: number; y: number }) =>
    mapSupportDomainElement(await apiClient.patch<SupportDomainElementDto>(
      `/api/model/support-domain-elements/${elementId}/position`,
      payload,
    )),
  getSupportDomainElementDeleteImpact: async (id: string): Promise<SupportDomainElementDeleteImpact> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await apiClient.get<any>(`/api/model/support-domain-elements/${id}/delete-impact`);
    return {
      elementId: data.element_id,
      modelId: data.model_id,
      elementName: data.element_name,
      affectedRelationships: data.affected_relationships.map((relationship: {
        relationship_id: string;
        source_name: string;
        target_name: string;
        relationship_type: string;
      }) => ({
        relationshipId: relationship.relationship_id,
        sourceName: relationship.source_name,
        targetName: relationship.target_name,
        relationshipType: relationship.relationship_type,
      })),
      affectedRules: data.affected_rules.map((rule: {
        rule_id: string;
        source_name: string;
        target_name: string;
        relationship_type: string;
        rule_kind: string;
      }) => ({
        ruleId: rule.rule_id,
        sourceName: rule.source_name,
        targetName: rule.target_name,
        relationshipType: rule.relationship_type,
        ruleKind: rule.rule_kind,
      })),
      instanceCount: data.instance_count,
      elementInstances: data.element_instances.map((instance: {
        instance_id: string;
        element_type_id: string;
        instance_name: string;
        element_type_name: string;
        instance_path: string;
      }) => ({
        instanceId: instance.instance_id,
        elementTypeId: instance.element_type_id,
        instanceName: instance.instance_name,
        elementTypeName: instance.element_type_name,
        instancePath: instance.instance_path,
      })),
      crossModelRelationships: mapCrossModelRelationshipDeleteImpacts(
        data.cross_model_relationships,
      ),
    };
  },
  deleteSupportDomainElement: async (id: string) => apiClient.delete(`/api/model/support-domain-elements/${id}`),
  

  listSupportDomainRelationships: async (modelId: string) =>
    (await apiClient.get<SupportDomainRelationshipDto[]>(`/api/model/support-domain-relationships${qs({ model_id: modelId })}`)).map(mapSupportDomainRelationship),

  /** Relationships across several support domain models; every model when no ids given. */
  listSupportDomainRelationshipsForMultipleModels: async (modelIds?: string[]) => {
    const search = new URLSearchParams();
    (modelIds ?? []).forEach((id) => search.append('model_ids', id));
    const query = search.toString();
    return (await apiClient.get<SupportDomainRelationshipDto[]>(
      `/api/model/support-domain-relationships/all${query ? `?${query}` : ''}`,
    )).map(mapSupportDomainRelationship);
  },
  createSupportDomainRelationship: async (draft: SupportDomainRelationshipDraft) =>
    mapSupportDomainRelationship(await apiClient.post<SupportDomainRelationshipDto>('/api/model/support-domain-relationships', {
      model_id: draft.modelId,
      source_element_id: draft.sourceElementId,
      target_element_id: draft.targetElementId,
      relationship_kind: draft.relationshipKind,
      notes: draft.notes,
      status: draft.status,
    })),
    
  updateSupportDomainRelationship: async (id: string, draft: SupportDomainRelationshipDraft) =>
    mapSupportDomainRelationship(await apiClient.put<SupportDomainRelationshipDto>(`/api/model/support-domain-relationships/${id}`, {
      model_id: draft.modelId,
      source_element_id: draft.sourceElementId,
      target_element_id: draft.targetElementId,
      relationship_kind: draft.relationshipKind,
      notes: draft.notes,
      status: draft.status,
    })),
  deleteSupportDomainRelationship: async (id: string) => apiClient.delete(`/api/model/support-domain-relationships/${id}`),

  // ── Badge customisation ────────────────────────────────────────────────────

  getBadgeMetadata: async (): Promise<BadgeOptions> =>
    mapBadgeMetadata(await apiClient.get<BadgeMetadataDto>('/api/model/badge-metadata')),

  getHierarchyNodeBadge: async (nodeId: string): Promise<BadgeCustomization> =>
    mapBadge(await apiClient.get<BadgeDto>(`/api/model/hierarchy-nodes/${nodeId}/badge`)),

  saveHierarchyNodeBadge: async (nodeId: string, badge: BadgeCustomization): Promise<BadgeCustomization> =>
    mapBadge(await apiClient.put<BadgeDto>(`/api/model/hierarchy-nodes/${nodeId}/badge`, {
      badge_text: badge.badgeText,
      badge_shape: badge.badgeShape,
      badge_color: badge.badgeColor,
      badge_text_color: badge.badgeTextColor,
      badge_icon: badge.badgeIcon,
      badge_size: badge.badgeSize,
      badge_content_type: badge.badgeContentType,
    })),

  getSupportDomainElementBadge: async (elementId: string): Promise<BadgeCustomization> =>
    mapBadge(await apiClient.get<BadgeDto>(`/api/model/support-domain-elements/${elementId}/badge`)),

  saveSupportDomainElementBadge: async (elementId: string, badge: BadgeCustomization): Promise<BadgeCustomization> =>
    mapBadge(await apiClient.put<BadgeDto>(`/api/model/support-domain-elements/${elementId}/badge`, {
      badge_text: badge.badgeText,
      badge_shape: badge.badgeShape,
      badge_color: badge.badgeColor,
      badge_text_color: badge.badgeTextColor,
      badge_icon: badge.badgeIcon,
      badge_size: badge.badgeSize,
      badge_content_type: badge.badgeContentType,
    })),

  // ── Cross-model relationship types (governance layer) ───────────────────

  getCrossModelRelationshipTypeTemplates: async (): Promise<Array<{ name: string; description: string }>> =>
    apiClient.get<Array<{ name: string; description: string }>>('/api/model/cross-model-relationship-type-templates'),

  getCrossModelTypeOptions: async (): Promise<CrossModelTypeOptions> => {
    const dto = await apiClient.get<CrossModelTypeOptionsDto>('/api/model/cross-model-type-options');
    return {
      nodeTypes: dto.node_types.map((t) => ({
        id: t.id,
        name: t.name,
        modelId: t.model_id,
        modelName: t.model_name,
        kind: t.kind,
        parentId: t.parent_id ?? null,
        badge: t.badge ? mapBadgeStore(t.badge, 'hierarchy_model_node_type', t.id) : null,
      })),
      elementTypes: dto.element_types.map((t) => ({
        id: t.id,
        name: t.name,
        modelId: t.model_id,
        modelName: t.model_name,
        kind: t.kind,
        parentId: null,
        badge: t.badge ? mapBadgeStore(t.badge, 'support_domain_element_type', t.id) : null,
      })),
    };
  },

  listCrossModelRelationshipTypes: async (status?: string) =>
    (await apiClient.get<CrossModelRelationshipTypeDto[]>(`/api/model/cross-model-relationship-types${qs({ status: status ?? null })}`)).map(mapCrossModelRelationshipType),

  getCrossModelRelationshipType: async (id: string) =>
    mapCrossModelRelationshipType(await apiClient.get<CrossModelRelationshipTypeDto>(`/api/model/cross-model-relationship-types/${id}`)),

  getCrossModelRelationshipTypeDeleteImpact: async (id: string): Promise<CrossModelRelationshipTypeDeleteImpact> => {
    const data = await apiClient.get<CrossModelRelationshipTypeDeleteImpactDto>(
      `/api/model/cross-model-relationship-types/${id}/delete-impact`
    );
    return {
      relationshipTypeId: data.impact_summary.relationship_type_id,
      relationshipTypeName: data.impact_summary.relationship_type_name,
      relationshipCount: data.impact_summary.relationship_count,
      relationships: mapCrossModelRelationshipDeleteImpacts(data.impact_list_items),
    };
  },

  createCrossModelRelationshipType: async (draft: CrossModelRelationshipTypeDraft) =>
    mapCrossModelRelationshipType(await apiClient.post<CrossModelRelationshipTypeDto>('/api/model/cross-model-relationship-types', {
      name: draft.name,
      description: draft.description || null,
      source_model_type: draft.sourceModelType,
      source_model_item_type_id: draft.sourceModelItemTypeId || null,
      target_model_type: draft.targetModelType,
      target_model_item_type_id: draft.targetModelItemTypeId || null,
      status: draft.status,
    })),

  updateCrossModelRelationshipType: async (id: string, draft: CrossModelRelationshipTypeDraft) =>
    mapCrossModelRelationshipType(await apiClient.put<CrossModelRelationshipTypeDto>(`/api/model/cross-model-relationship-types/${id}`, {
      name: draft.name,
      description: draft.description || null,
      source_model_type: draft.sourceModelType,
      source_model_item_type_id: draft.sourceModelItemTypeId || null,
      target_model_type: draft.targetModelType,
      target_model_item_type_id: draft.targetModelItemTypeId || null,
      status: draft.status,
    })),

  deleteCrossModelRelationshipType: async (id: string) =>
    apiClient.delete(`/api/model/cross-model-relationship-types/${id}`),

  listCrossModelRelationshipTypeDiagrams: async (): Promise<SavedDiagramSummary[]> =>
    (await apiClient.get<SavedDiagramSummaryDto[]>('/api/model/cross-model-relationship-type-diagrams')).map((d) => ({
      id: d.diagram_id,
      name: d.name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      nodeCount: Number(d.node_count),
    })),

  getCrossModelRelationshipTypeDiagram: async (id: string): Promise<SavedDiagram> =>
    mapSavedDiagram(await apiClient.get<SavedDiagramDto>(`/api/model/cross-model-relationship-type-diagrams/${id}`)),

  createCrossModelRelationshipTypeDiagram: async (input: SaveDiagramInput): Promise<SavedDiagram> =>
    mapSavedDiagram(await apiClient.post<SavedDiagramDto>('/api/model/cross-model-relationship-type-diagrams', toSaveDiagramBody(input))),

  updateCrossModelRelationshipTypeDiagram: async (id: string, input: SaveDiagramInput): Promise<SavedDiagram> =>
    mapSavedDiagram(await apiClient.put<SavedDiagramDto>(`/api/model/cross-model-relationship-type-diagrams/${id}`, toSaveDiagramBody(input))),

  deleteCrossModelRelationshipTypeDiagram: async (id: string) =>
    apiClient.delete(`/api/model/cross-model-relationship-type-diagrams/${id}`),
};
