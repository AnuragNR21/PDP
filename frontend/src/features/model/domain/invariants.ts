import type {
  HierarchyModelDraft,
  HierarchyNodeTypePropertyFormData,
  HierarchyNodeDraft,
  SupportDomainElementDraft,
  SupportDomainModelDraft,
  SupportDomainRelationshipDraft,
  ValidationErrors,
  SupportDomainElementPropertyData,
  CrossModelRelationshipTypeDraft,
} from './types';

export function validateHierarchyModelDraft(draft: HierarchyModelDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.name.trim()) errors.name = 'Name is required.';
  if (!draft.purpose.trim()) errors.purpose = 'Purpose is required.';
  if (!draft.owningDomain) errors.owningDomain = 'Owning domain is required.';
  if (!draft.status) errors.status = 'Status is required.';
  return errors;
}

export function validateHierarchyNodeDraft(draft: HierarchyNodeDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.modelId) errors.modelId = 'Hierarchy Model is required.';
  if (!draft.name.trim()) errors.name = 'Node name is required.';
  if (!draft.status) errors.status = 'Status is required.';
  return errors;
}

export function validateHierarchyNodePropertyFormData(formData: HierarchyNodeTypePropertyFormData): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!formData.nodeTypeId) errors.nodeTypeId = 'Node type is required.';
  if (!formData.name.trim()) errors.name = 'Property name is required.';
  if (!formData.status) errors.status = 'Status is required.';
  return errors;
}

export function validateSupportDomainModelDraft(draft: SupportDomainModelDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.name.trim()) errors.name = 'Name is required.';
  if (!draft.purpose.trim()) errors.purpose = 'Purpose is required.';
  if (!draft.status) errors.status = 'Status is required.';
  return errors;
}

export function validateSupportDomainElementDraft(draft: SupportDomainElementDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.modelId) errors.modelId = 'Support Domain Model is required.';
  if (!draft.name.trim()) errors.name = 'Element name is required.';
  if (!draft.status) errors.status = 'Status is required.';
  return errors;
}

export function validateSupportDomainElementPropertyData(data: SupportDomainElementPropertyData): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!data.elementId) errors.elementId = 'Element is required.';
  if (!data.name.trim()) errors.name = 'Property name is required.';
  if (!data.status) errors.status = 'Status is required.';
  return errors;
}
export function validateSupportDomainRelationshipDraft(draft: SupportDomainRelationshipDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.modelId) errors.modelId = 'Support Domain Model is required.';
  if (!draft.sourceElementId) errors.sourceElementId = 'Source element is required.';
  if (!draft.targetElementId) errors.targetElementId = 'Target element is required.';
  if (draft.sourceElementId && draft.targetElementId && draft.sourceElementId === draft.targetElementId) {
    errors.targetElementId = 'Target element must differ from source element.';
  }
  if (!draft.relationshipKind.trim()) errors.relationshipKind = 'Relationship name is required.';
  if (!draft.status) errors.status = 'Status is required.';
  return errors;
}

export const validateHierarchyModelFormData = validateHierarchyModelDraft;
export const validateHierarchyNodeFormData = validateHierarchyNodeDraft;

export function validateCrossModelRelationshipTypeDraft(draft: CrossModelRelationshipTypeDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.name.trim()) errors.name = 'Name is required.';
  if (!draft.status) errors.status = 'Status is required.';
  return errors;
}
