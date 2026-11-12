import type { ModelType } from '../../../shared/constants/ModelConfig';
import type { CrossModelRelationshipDeleteImpact } from '@/shared/contracts/crossModelImpact';

export type { ModelType } from '../../../shared/constants/ModelConfig';

export type ModelDomain = string;
export type LifecycleStatus = string;
export type RelationshipKind = string;
export type MetadataOption = { key: string; label: string; description?: string };
export type TabKey = 'hierarchyModel' | 'supportDomain';

export type BadgeContentType = 'text' | 'icon' | 'text_icon';
export type BadgeShape = 'circle' | 'rounded-square' | 'hexagon' | 'diamond' | 'square';

export type BadgeCustomization = {
  badgeStoreId: string | null;
  ownerEntityType: string;
  ownerEntityId: string;
  badgeText: string;
  badgeShape: BadgeShape;
  badgeColor: string;
  badgeTextColor: string;
  badgeIcon: string | null;
  badgeSize: number;
  badgeContentType: BadgeContentType;
};

export type BadgeOptions = {
  shapes: MetadataOption[];
  sizes: number[];
  icons: MetadataOption[];
  contentTypes: MetadataOption[];
  presetColors: string[];
  defaults: Omit<BadgeCustomization, 'badgeStoreId' | 'ownerEntityType' | 'ownerEntityId'>;
};

export type DisplayNamedItem = {
  name: string;
  displayName?: string | null;
};

export type HierarchyModelSummary = {
  id: string;
  name: string;
  purpose: string;
  owningDomain: ModelDomain;
  status: LifecycleStatus;
};

export type HierarchyNodeSummary = {
  id: string;
  modelId: string;
  parentNodeId: string | null;
  name: string;
  displayName: string;
  badge: BadgeCustomization;
  description: string;
  isRecursive: boolean;
  /**
   * A property node holds a value, not a level of the hierarchy. Nothing can
   * be placed beneath one — that is what makes it a property.
   */
  isProperty: boolean;
  sortOrder: number;
  status: LifecycleStatus;
};

export type HierarchyNodeTreeItem = HierarchyNodeSummary & {
  children: HierarchyNodeTreeItem[];
};

export type HierarchyRuleSummary = {
  id: string;
  modelId: string;
  parentNodeId: string;
  childNodeId: string;
  relationshipKind: RelationshipKind;
  notes: string;
  status: LifecycleStatus;
  parentName?: string;
  childName?: string;
};

export type HierarchyNodeTypePropertySummary = {
  id: string;
  nodeTypeId: string;
  name: string;
  description: string;
  inheritable: boolean;
  status: LifecycleStatus;
};

export type HierarchyNodePropertySummary = HierarchyNodeTypePropertySummary;

export type NodeDeleteImpactRule = {
  ruleId: string;
  parentName: string;
  childName: string;
  relationshipKind: string;
};

export type NodeDeleteImpact = {
  nodeId: string;
  descendantCount: number;
  childNodes: { nodeId: string; name: string }[];
  affectedRules: NodeDeleteImpactRule[];
  instanceCount: number;
  nodeInstances: HierarchyModelDeleteImpactInstance[];
  crossModelRelationships: CrossModelRelationshipDeleteImpact[];
};

export type PropertyDeleteImpactNodeType = {
  nodeTypeId: string;
  nodeTypeName: string;
  depth: number;
  instanceCount: number;
};

export type HierarchyPropertyDeleteImpact = {
  propertyId: string;
  propertyName: string;
  nodeTypeId: string;
  inheritable: boolean;
  affectedNodeTypeCount: number;
  affectedInstanceCount: number;
  affectedNodeTypes: PropertyDeleteImpactNodeType[];
  truncated: boolean;
};

export type SupportDomainPropertyDeleteImpact = {
  propertyId: string;
  propertyName: string;
  elementId: string;
  elementName: string | null;
  affectedInstanceCount: number;
};

export type RecursiveDisableImpact = {
  nodeId: string;
  nodeName: string | null;
  modelId: string | null;
  modelName: string | null;
  affectedRelationshipCount: number;
  affectedInstanceCount: number;
  affectedInstancePaths: string[];
};

export type ReparentCandidateParent = {
  instanceId: string;
  instanceName: string;
  instancePath: string;
};

export type ReparentImpactPlanItem = {
  instanceId: string;
  instanceName: string;
  instancePath: string;
  oldParentInstanceId: string | null;
  oldParentInstanceName: string | null;
  oldParentTypeName: string | null;
  candidateParents: ReparentCandidateParent[];
  defaultParentInstanceId: string | null;
  resolvable: boolean;
};

export type ReparentImpact = {
  nodeId: string;
  nodeName: string;
  newParentIsRoot: boolean;
  affectedInstanceCount: number;
  descendantInstanceCount: number;
  affectedEdgeCount: number;
  affectedCrossModelRelationshipCount: number;
  resolvable: boolean;
  autoResolvable: boolean;
  planItems: ReparentImpactPlanItem[];
};

export type InstanceParentAssignment = {
  instanceId: string;
  newParentInstanceId: string | null;
};

export type HierarchyModelDeleteImpactNode = {
  nodeId: string;
  parentNodeId: string | null;
  name: string;
  displayName: string;
  nodePath: string;
};

export type HierarchyModelDeleteImpactInstance = {
  instanceId: string;
  nodeId: string;
  parentNodeId: string | null;
  instanceName: string;
  nodeName: string;
  instancePath: string;
};

export type HierarchyModelDeleteImpact = {
  modelId: string;
  modelName: string;
  nodeCount: number;
  instanceCount: number;
  nodes: HierarchyModelDeleteImpactNode[];
  nodeInstances: HierarchyModelDeleteImpactInstance[];
  crossModelRelationships: CrossModelRelationshipDeleteImpact[];
};

export type SupportDomainDeleteImpactInstance = {
  instanceId: string;
  elementTypeId: string;
  instanceName: string;
  elementTypeName: string;
  instancePath: string;
};

export type SupportDomainModelDeleteImpact = {
  modelId: string;
  modelName: string;
  elementCount: number;
  instanceCount: number;
  elements: { elementId: string; name: string; displayName: string }[];
  elementInstances: SupportDomainDeleteImpactInstance[];
  crossModelRelationships: CrossModelRelationshipDeleteImpact[];
};

export type SupportDomainElementDeleteImpact = {
  elementId: string;
  modelId: string;
  elementName: string;
  affectedRelationships: {
    relationshipId: string;
    sourceName: string;
    targetName: string;
    relationshipType: string;
  }[];
  affectedRules: {
    ruleId: string;
    sourceName: string;
    targetName: string;
    relationshipType: string;
    ruleKind: string;
  }[];
  instanceCount: number;
  elementInstances: SupportDomainDeleteImpactInstance[];
  crossModelRelationships: CrossModelRelationshipDeleteImpact[];
};

export type SupportDomainModelSummary = {
  id: string;
  name: string;
  purpose: string;
  status: LifecycleStatus;
};

export type SupportDomainElementSummary = {
  id: string;
  modelId: string;
  name: string;
  displayName: string;
  badge: BadgeCustomization;
  description: string;
  status: LifecycleStatus;
  position: {
    x: number | null;
    y: number | null;
  };
};

export type SupportDomainRelationshipSummary = {
  id: string;
  modelId: string;
  sourceElementId: string;
  targetElementId: string;
  relationshipKind: RelationshipKind;
  notes: string;
  status: LifecycleStatus;
};
export type SupportDomainElementPropertySummary = {
  id: string;
  elementId: string;
  name: string;
  description: string;
  status: LifecycleStatus;
};

export type SupportDomainElementPropertyData = {
  id?: string;
  elementId: string;
  name: string;
  description: string;
  status: string;
};

export type HierarchyModelDraft = {
  id?: string;
  name: string;
  purpose: string;
  owningDomain: string;
  status: string;
};

export type HierarchyNodeDraft = {
  id?: string;
  modelId: string;
  parentNodeId: string | null;
  name: string;
  displayName: string;
  badge: string;
  description: string;
  isRecursive: boolean;
  isProperty: boolean;
  status: string;
};

export type HierarchyNodeTypePropertyFormData = {
  id?: string;
  nodeTypeId: string;
  name: string;
  description: string;
  inheritable: boolean;
  status: string;
};

export type HierarchyModelFormData = HierarchyModelDraft;
export type HierarchyNodeFormData = HierarchyNodeDraft;

export type HierarchyNodePropertyFormData = HierarchyNodeTypePropertyFormData;

export type SupportDomainModelDraft = {
  id?: string;
  name: string;
  purpose: string;
  status: string;
};

export type SupportDomainElementDraft = {
  id?: string;
  modelId: string;
  name: string;
  displayName: string;
  badge: string;
  description: string;
  status: string;
};

export type SupportDomainRelationshipDraft = {
  id?: string;
  modelId: string;
  sourceElementId: string;
  targetElementId: string;
  relationshipKind: string;
  notes: string;
  status: string;
};

/** A single selectable type option for governance (node type or element type). */
export type CrossModelTypeOption = {
  id: string;
  name: string;
  modelId: string;
  modelName: string;
  kind: 'HIERARCHY_MODEL' | 'SUPPORT_DOMAIN_MODEL';
  parentId?: string | null;
  badge?: BadgeCustomization | null;
};

export type CrossModelTypeOptions = {
  nodeTypes: CrossModelTypeOption[];
  elementTypes: CrossModelTypeOption[];
};

export type CrossModelRelationshipTypeSummary = {
  id: string;
  name: string;
  description: string | null;
  sourceModelType: ModelType;
  sourceModelItemTypeId: string | null;
  sourceTypeName: string | null;
  sourceModelId: string | null;
  sourceModelName: string | null;
  targetModelType: ModelType;
  targetModelItemTypeId: string | null;
  targetTypeName: string | null;
  targetModelId: string | null;
  targetModelName: string | null;
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type CrossModelRelationshipTypeDraft = {
  id?: string;
  name: string;
  description: string;
  sourceModelType: ModelType;
  sourceModelItemTypeId: string | null;
  targetModelType: ModelType;
  targetModelItemTypeId: string | null;
  status: LifecycleStatus;
};

export type CrossModelRelationshipTypeDeleteImpact = {
  relationshipTypeId: string;
  relationshipTypeName: string;
  relationshipCount: number;
  relationships: CrossModelRelationshipDeleteImpact[];
};

export type SavedCrossModelDiagramNode = {
  itemTypeId: string;
  itemKind: 'node' | 'element';
  posX: number;
  posY: number;
};

export type SavedCrossModelDiagramSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
};

export type SavedCrossModelDiagram = SavedCrossModelDiagramSummary & {
  nodes: SavedCrossModelDiagramNode[];
};

export type SaveCrossModelDiagramInput = {
  name: string;
  nodes: SavedCrossModelDiagramNode[];
};
export type ValidationErrors = Record<string, string>;

export type ModelDefinitionsState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  activeTab: TabKey;
  metadata: {
    tabs: MetadataOption[];
    owningDomains: MetadataOption[];
    lifecycleStatuses: MetadataOption[];
    relationshipKinds: MetadataOption[];
  };
  hierarchyModels: HierarchyModelSummary[];
  supportDomainModels: SupportDomainModelSummary[];
  selectedHierarchyModelId: string | null;
  selectedSupportDomainModelId: string | null;
  hierarchyNodes: HierarchyNodeSummary[];
  hierarchyNodeProperties: HierarchyNodeTypePropertySummary[];
  hierarchyRules: HierarchyRuleSummary[];
  selectedHierarchyNodeId: string | null;
  supportDomainElements: SupportDomainElementSummary[];
  supportDomainElementProperties: SupportDomainElementPropertySummary[];
  supportDomainRelationships: SupportDomainRelationshipSummary[];
  selectedSupportDomainElementId: string | null;
  selectedSupportDomainRelationshipId: string | null;
  crossModelRelationshipTypes: CrossModelRelationshipTypeSummary[];
  selectedCrossModelRelationshipTypeId: string | null;
  hierarchyModelDraft: HierarchyModelDraft;
  hierarchyNodeDraft: HierarchyNodeDraft;
  hierarchyNodePropertyFormData: HierarchyNodeTypePropertyFormData;
  supportDomainModelDraft: SupportDomainModelDraft;
  supportDomainElementDraft: SupportDomainElementDraft;
  supportDomainRelationshipDraft: SupportDomainRelationshipDraft;
  supportDomainElementPropertyData: SupportDomainElementPropertyData;
  crossModelRelationshipTypeDraft: CrossModelRelationshipTypeDraft;
  validation: {
    hierarchyModel: ValidationErrors;
    hierarchyNode: ValidationErrors;
    hierarchyNodeProperty: ValidationErrors;
    supportDomainModel: ValidationErrors;
    supportDomainElement: ValidationErrors;
    supportDomainElementProperty: ValidationErrors;
    supportDomainRelationship: ValidationErrors;
    crossModelRelationshipType: ValidationErrors;
  };
};
