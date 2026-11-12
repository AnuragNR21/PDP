export type MetadataOptionDto = {
  key: string;
  label: string;
  description?: string;
};

export type MetadataDto = {
  tabs: MetadataOptionDto[];
  owning_domains: MetadataOptionDto[];
  lifecycle_statuses: MetadataOptionDto[];
  relationship_kinds: MetadataOptionDto[];
};

export type BadgeDto = {
  badge_store_id: string | null;
  owner_entity_type: string;
  owner_entity_id: string;
  badge_text: string;
  badge_shape: string;
  badge_color: string;
  badge_text_color: string;
  badge_icon: string | null;
  badge_size: number;
  badge_content_type: string;
};

export type BadgeMetadataDto = {
  shapes: MetadataOptionDto[];
  sizes: number[];
  icons: MetadataOptionDto[];
  content_types: MetadataOptionDto[];
  preset_colors: string[];
  defaults: {
    badge_text: string;
    badge_shape: string;
    badge_color: string;
    badge_text_color: string;
    badge_icon: string | null;
    badge_size: number;
    badge_content_type: string;
  };
};

export type HierarchyModelDto = {
  model_id: string;
  name: string;
  purpose: string;
  owning_domain: string;
  status: string;
};

export type BadgeStoreDto = {
  badge_store_id: string | null;
  badge_text: string;
  badge_shape: string;
  badge_color: string;
  badge_text_color: string;
  badge_icon: string | null;
  badge_size: number;
  badge_content_type: string;
};

export type HierarchyNodeDto = {
  node_id: string;
  model_id: string;
  parent_node_id: string | null;
  name: string;
  display_name: string;
  badge: BadgeStoreDto;
  description: string;
  is_recursive: boolean;
  is_property?: boolean;
  sort_order: number;
  status: string;
};

export type HierarchyNodeTypePropertyDto = {
  property_id: string;
  node_type_id: string;
  name: string;
  description: string;
  inheritable: boolean;
  status: string;
};

export type HierarchyRuleDto = {
  rule_id: string;
  model_id: string;
  parent_node_type_id: string;
  child_node_type_id: string;
  relationship_kind: string;
  notes: string;
  status: string;
  parent_node_name?: string | null;
  child_node_name?: string | null;
};

export type SupportDomainModelDto = {
  support_domain_model_id: string;
  name: string;
  purpose: string;
  status: string;
};

export type SupportDomainElementDto = {
  element_id: string;
  support_domain_model_id: string;
  name: string;
  display_name: string;
  badge: BadgeStoreDto;
  description: string;
  status: string;
  x?: number | null;
  y?: number | null;
};

export type SupportDomainElementPropertyDto = {
  property_id: string;
  element_id: string;
  name: string;
  description: string;
  status: string;
};

export type SupportDomainRelationshipDto = {
  relationship_id: string;
  model_id: string;
  source_element_id: string;
  target_element_id: string;
  relationship_kind: string;
  notes: string;
  status: string;
};

export type CrossModelTypeOptionDto = {
  id: string;
  name: string;
  model_id: string;
  model_name: string;
  kind: 'HIERARCHY_MODEL' | 'SUPPORT_DOMAIN_MODEL';
  parent_id?: string | null;
  badge: BadgeStoreDto | null;
};

export type CrossModelTypeOptionsDto = {
  node_types: CrossModelTypeOptionDto[];
  element_types: CrossModelTypeOptionDto[];
};

export type CrossModelRelationshipTypeDto = {
  relationship_type_id: string;
  name: string;
  description: string | null;
  source_model_type: string;
  source_model_item_type_id: string | null;
  source_type_name: string | null;
  source_model_id: string | null;
  source_model_name: string | null;
  target_model_type: string;
  target_model_item_type_id: string | null;
  target_type_name: string | null;
  target_model_id: string | null;
  target_model_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
