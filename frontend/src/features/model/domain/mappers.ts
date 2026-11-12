import type {
  HierarchyModelDto,
  HierarchyNodeTypePropertyDto,
  HierarchyNodeDto,
  HierarchyRuleDto,
  SupportDomainElementDto,
  SupportDomainModelDto,
  SupportDomainRelationshipDto,
  MetadataDto,
  SupportDomainElementPropertyDto,
  BadgeDto,
  BadgeMetadataDto,
  BadgeStoreDto,
  CrossModelRelationshipTypeDto,
} from '../api/dto';
import type {
  MetadataOption,
  HierarchyModelSummary,
  HierarchyNodeTypePropertySummary,
  HierarchyNodeSummary,
  HierarchyNodeTreeItem,
  HierarchyRuleSummary,
  SupportDomainElementSummary,
  SupportDomainModelSummary,
  SupportDomainRelationshipSummary,
  SupportDomainElementPropertySummary,
  BadgeCustomization,
  BadgeOptions,
  CrossModelRelationshipTypeSummary,
LifecycleStatus,
} from './types';
import type { ModelType } from '../../../shared/constants/ModelConfig';

const normalizeOption = (item: { key: string; label: string; description?: string }): MetadataOption => ({
  key: item.key,
  label: item.label,
  description: item.description,
});

export const mapMetadata = (dto: MetadataDto) => ({
  tabs: dto.tabs.map(normalizeOption),
  owningDomains: dto.owning_domains.map(normalizeOption),
  lifecycleStatuses: dto.lifecycle_statuses.map(normalizeOption),
  relationshipKinds: dto.relationship_kinds.map(normalizeOption),
});

export const mapHierarchyModel = (dto: HierarchyModelDto): HierarchyModelSummary => ({
  id: dto.model_id,
  name: dto.name,
  purpose: dto.purpose,
  owningDomain: dto.owning_domain,
  status: dto.status,
});

export const mapBadgeStore = (dto: BadgeStoreDto, ownerEntityType: string, ownerEntityId: string): BadgeCustomization => ({
  badgeStoreId: dto.badge_store_id,
  ownerEntityType,
  ownerEntityId,
  badgeText: dto.badge_text,
  badgeShape: dto.badge_shape as BadgeCustomization['badgeShape'],
  badgeColor: dto.badge_color,
  badgeTextColor: dto.badge_text_color,
  badgeIcon: dto.badge_icon,
  badgeSize: dto.badge_size,
  badgeContentType: dto.badge_content_type as BadgeCustomization['badgeContentType'],
});

export const mapHierarchyNode = (dto: HierarchyNodeDto): HierarchyNodeSummary => ({
  id: dto.node_id,
  modelId: dto.model_id,
  parentNodeId: dto.parent_node_id,
  name: dto.name,
  displayName: dto.display_name ?? '',
  badge: mapBadgeStore(dto.badge, 'hierarchy_model_node_type', dto.node_id),
  description: dto.description,
  isRecursive: dto.is_recursive ?? false,
  isProperty: dto.is_property ?? false,
  sortOrder: dto.sort_order,
  status: dto.status,
});

export const mapHierarchyNodeTypeProperty = (dto: HierarchyNodeTypePropertyDto): HierarchyNodeTypePropertySummary => ({
  id: dto.property_id,
  nodeTypeId: dto.node_type_id,
  name: dto.name,
  description: dto.description,
  inheritable: dto.inheritable ?? false,
  status: dto.status,
});

export const mapHierarchyRule = (dto: HierarchyRuleDto): HierarchyRuleSummary => ({
  id: dto.rule_id,
  modelId: dto.model_id,
  parentNodeId: dto.parent_node_type_id,
  childNodeId: dto.child_node_type_id,
  relationshipKind: dto.relationship_kind,
  notes: dto.notes,
  status: dto.status,
  parentName: dto.parent_node_name ?? undefined,
  childName: dto.child_node_name ?? undefined,
});

export const mapSupportDomainModel = (dto: SupportDomainModelDto): SupportDomainModelSummary => ({
  id: dto.support_domain_model_id,
  name: dto.name,
  purpose: dto.purpose,
  status: dto.status,
});

export const mapSupportDomainElement = (dto: SupportDomainElementDto): SupportDomainElementSummary => ({
  id: dto.element_id,
  modelId: dto.support_domain_model_id,
  name: dto.name,
  displayName: dto.display_name ?? '',
  badge: mapBadgeStore(dto.badge, 'support_domain_element_type', dto.element_id),
  description: dto.description,
  status: dto.status,
  position: {
    x: dto.x ?? null,
    y: dto.y ?? null,
  },
});

export const mapSupportDomainElementProperty = (
  dto: SupportDomainElementPropertyDto,
): SupportDomainElementPropertySummary => ({
  id: dto.property_id,
  elementId: dto.element_id,
  name: dto.name,
  description: dto.description ?? '',
  status: dto.status as LifecycleStatus,
});

export const mapSupportDomainRelationship = (dto: SupportDomainRelationshipDto): SupportDomainRelationshipSummary => ({
  id: dto.relationship_id,
  // The all-models read names it support_domain_model_id.
  modelId: dto.model_id ?? (dto as { support_domain_model_id?: string }).support_domain_model_id ?? '',
  sourceElementId: dto.source_element_id,
  targetElementId: dto.target_element_id,
  relationshipKind: dto.relationship_kind,
  notes: dto.notes,
  status: dto.status,
});

export const mapCrossModelRelationshipType = (dto: CrossModelRelationshipTypeDto): CrossModelRelationshipTypeSummary => ({
  id: dto.relationship_type_id,
  name: dto.name,
  description: dto.description,
  sourceModelType: dto.source_model_type as ModelType,
  sourceModelItemTypeId: dto.source_model_item_type_id,
  sourceTypeName: dto.source_type_name,
  sourceModelId: dto.source_model_id,
  sourceModelName: dto.source_model_name,
  targetModelType: dto.target_model_type as ModelType,
  targetModelItemTypeId: dto.target_model_item_type_id,
  targetTypeName: dto.target_type_name,
  targetModelId: dto.target_model_id,
  targetModelName: dto.target_model_name,
  status: dto.status,
  createdAt: dto.created_at,
  updatedAt: dto.updated_at,
});

export const mapBadge = (dto: BadgeDto): BadgeCustomization => ({
  badgeStoreId: dto.badge_store_id,
  ownerEntityType: dto.owner_entity_type,
  ownerEntityId: dto.owner_entity_id,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  badgeShape: dto.badge_shape as any,
  badgeText: dto.badge_text ?? '',
  badgeColor: dto.badge_color ?? '#1976D2',
  badgeTextColor: dto.badge_text_color ?? '#FFFFFF',
  badgeIcon: dto.badge_icon ?? null,
  badgeSize: dto.badge_size ?? 16,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  badgeContentType: dto.badge_content_type as any ?? 'text',
});

export const mapBadgeMetadata = (dto: BadgeMetadataDto): BadgeOptions => ({
  shapes: dto.shapes.map((s) => ({ key: s.key, label: s.label })),
  sizes: dto.sizes,
  icons: dto.icons.map((i) => ({ key: i.key, label: i.label })),
  contentTypes: dto.content_types.map((ct) => ({ key: ct.key, label: ct.label })),
  presetColors: dto.preset_colors,
  defaults: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    badgeShape: dto.defaults.badge_shape as any,
    badgeText: dto.defaults.badge_text,
    badgeColor: dto.defaults.badge_color,
    badgeTextColor: dto.defaults.badge_text_color,
    badgeIcon: dto.defaults.badge_icon,
    badgeSize: dto.defaults.badge_size,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    badgeContentType: dto.defaults.badge_content_type as any,
  },
});

export const buildHierarchyTree = (nodes: HierarchyNodeSummary[]): HierarchyNodeTreeItem[] => {
  const lookup = new Map<string, HierarchyNodeTreeItem>();
  const roots: HierarchyNodeTreeItem[] = [];

  nodes
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .forEach((node) => lookup.set(node.id, { ...node, children: [] }));

  lookup.forEach((node) => {
    if (node.parentNodeId && lookup.has(node.parentNodeId)) {
      lookup.get(node.parentNodeId)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
};
