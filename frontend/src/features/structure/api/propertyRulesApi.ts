import { apiClient } from "@/shared/http/apiClient";

/**
 * How strongly governance expects a check to run on the property it is linked
 * to.
 *
 * Required is ticked for the analyst in Discover; the other two are offered.
 * The judgement belongs to the link rather than to the rule, so one shared
 * configuration can be required on one property and merely available on
 * another.
 */
export type RuleApplicability = "required" | "recommended" | "available";

export type ApplicabilityOption = {
  key: RuleApplicability;
  label: string;
  detail: string;
};

/** Whether an association can execute, or is waiting on its reference source. */
export type Readiness = "ready" | "configuration_incomplete";

/** What a configuration needs from governed reference data, if anything. */
export type ReferenceRequirement = "none" | "approved_values";

/** One value this property accepts. */
export type ApprovedValue = {
  reference_link_id: string;
  node_instance_id: string;
  element_instance_id: string;
  value_name: string;
  element_type_id: string;
  element_type_name: string;
  model_name: string;
  status: string;
  value_status: string;
};

/** One configuration an Asset Property is subject to. */
export type PropertyRule = {
  property_rule_id: string;
  node_instance_id: string;
  rule_configuration_id: string;
  applicability: RuleApplicability;
  notes: string;
  status: string;

  /** What a screen reads it by. */
  name: string;
  code: string;
  description: string;
  severity: string;
  effective_severity: string;

  /** The configuration — what is actually checked. */
  configuration_name: string;
  configuration_code: string;
  configuration_description: string;
  configuration_severity: string;
  configuration_status: string;
  configuration_version: number;

  /** The definition it configures — what kind of check it is. */
  rule_definition_id: string;
  definition_name: string;
  definition_code: string;
  check_type: string;
  definition_kind: string;
  dimension: string;
  data_type: string;
  definition_severity: string;
  definition_version: number;

  parameters: Record<string, unknown>;

  /**
   * The reference source, and whether this property satisfies it.
   *
   * A configuration declares the vocabulary it checks against; the property
   * declares which of those values it approves. Where they do not meet, the
   * association is incomplete — saved, explained, and not run.
   */
  reference_requirement: ReferenceRequirement;
  expected_reference_type_id: string;
  expected_reference_type_name: string;
  approved_values: string[];
  approved_value_ids: string[];
  readiness: Readiness;
  readiness_reason: string;
  selected_by_default: boolean;

  property_name: string;
  model_id: string;
  model_name: string;
};

/** Where a property sits in the governed hierarchy, root first. */
export type PropertyPathStep = {
  node_instance_id: string;
  name: string;
  node_type_id: string;
  node_type_name: string;
};

export type PropertyRulesReport = {
  node_instance_id: string;
  property_name: string;
  node_type_name: string;
  model_id: string;
  model_name: string;
  path: PropertyPathStep[];
  items: PropertyRule[];
  total: number;
  required: number;
  /** How many of them cannot run yet. */
  incomplete: number;
  approved_values: ApprovedValue[];
  applicability_options: ApplicabilityOption[];
};

/** A configuration in the Rule Workspace, offered for linking. */
export type LinkableConfiguration = {
  rule_configuration_id: string;
  rule_definition_id: string;
  code: string;
  name: string;
  description: string;
  definition_name: string;
  check_type: string;
  definition_kind: string;
  dimension: string;
  data_type: string;
  status: string;
  version: number;
  effective_severity: string;
  statement: string;
  parameters: Record<string, unknown>;
  resolved_from_vocabulary: string[];
  values_source: "vocabulary" | "fixed";
  reference_element_type_name: string | null;
  /** How many properties are already subject to it. */
  linked_to: number;
  /** Whether *this* property already is. */
  is_linked: boolean;
  /**
   * What the row is. The library holds far more definitions than
   * configurations, and most need no configuring, so a definition nobody has
   * configured yet is offered as itself: linking it creates its default
   * configuration and links that. Such a row has an empty
   * `rule_configuration_id` — send `rule_definition_id` instead.
   */
  kind: "configuration" | "definition";
};

/** One vocabulary a property could draw approved values from. */
export type GovernedVocabulary = {
  element_id: string;
  name: string;
  display_name: string;
  status: string;
  support_domain_model_id: string;
  model_name: string;
  value_count: number;
};

/** One candidate value, with whether this property already approves it. */
export type CandidateValue = {
  element_instance_id: string;
  value_name: string;
  element_type_id: string;
  element_type_name: string;
  model_name: string;
  is_approved: boolean;
};

export const propertyRulesApi = {
  /** The configurations this property is subject to, required first. */
  list: (nodeInstanceId: string) =>
    apiClient.get<PropertyRulesReport>(
      `/api/structure/node-instances/${nodeInstanceId}/rules`,
    ),

  /** Configurations this property could be subject to, with linked ones marked. */
  listLinkable: (nodeInstanceId: string, search = "") =>
    apiClient.get<{
      items: LinkableConfiguration[];
      total: number;
      configurations: number;
      definitions: number;
      linked: number;
    }>(
      `/api/structure/node-instances/${nodeInstanceId}/rules/available` +
        (search ? `?search=${encodeURIComponent(search)}` : ""),
    ),

  /** How many configurations each property of a hierarchy model is subject to. */
  counts: (modelId: string) =>
    apiClient.get<{ counts: Record<string, number> }>(
      `/api/structure/hierarchy-models/${modelId}/property-rule-counts`,
    ),

  /** Pass a configuration id, or a definition id for a rule nobody has configured. */
  link: (
    nodeInstanceId: string,
    choice: { configurationId?: string; definitionId?: string },
    applicability: RuleApplicability = "recommended",
    notes = "",
  ) =>
    apiClient.post<PropertyRule>(
      `/api/structure/node-instances/${nodeInstanceId}/rules`,
      {
        rule_configuration_id: choice.configurationId ?? "",
        rule_definition_id: choice.definitionId ?? "",
        applicability,
        notes,
      },
    ),

  setApplicability: (propertyRuleId: string, applicability: RuleApplicability, notes = "") =>
    apiClient.patch<{ property_rule_id: string; applicability: RuleApplicability }>(
      `/api/structure/property-rules/${propertyRuleId}`,
      { applicability, notes },
    ),

  unlink: (propertyRuleId: string) =>
    apiClient.delete<void>(`/api/structure/property-rules/${propertyRuleId}`),
};

export const approvedValuesApi = {
  /** Every value this property accepts, across all vocabularies. */
  list: (nodeInstanceId: string) =>
    apiClient.get<{ node_instance_id: string; items: ApprovedValue[]; total: number }>(
      `/api/structure/node-instances/${nodeInstanceId}/approved-values`,
    ),

  /** Every vocabulary a property could draw from. */
  vocabularies: (supportDomainModelId = "") =>
    apiClient.get<{ items: GovernedVocabulary[] }>(
      `/api/structure/governed-vocabularies` +
        (supportDomainModelId
          ? `?support_domain_model_id=${encodeURIComponent(supportDomainModelId)}`
          : ""),
    ),

  /** One vocabulary's values, with the approved ones marked. */
  candidates: (nodeInstanceId: string, elementTypeId: string) =>
    apiClient.get<{
      element_type_id: string;
      element_type_name: string;
      model_name: string;
      items: CandidateValue[];
      total: number;
      approved: number;
    }>(
      `/api/structure/node-instances/${nodeInstanceId}/approved-values/candidates` +
        `?element_type_id=${encodeURIComponent(elementTypeId)}`,
    ),

  /** Replace this property's approved values with exactly these. */
  set: (nodeInstanceId: string, elementInstanceIds: string[]) =>
    apiClient.put<{
      node_instance_id: string;
      approved: number;
      added: number;
      removed: number;
    }>(`/api/structure/node-instances/${nodeInstanceId}/approved-values`, {
      element_instance_ids: elementInstanceIds,
    }),

  revoke: (referenceLinkId: string) =>
    apiClient.delete<void>(`/api/structure/property-reference-values/${referenceLinkId}`),
};
