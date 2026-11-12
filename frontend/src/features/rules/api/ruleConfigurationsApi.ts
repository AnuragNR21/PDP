import { apiClient } from "@/shared/http/apiClient";
import type { RuleParameters } from "@/features/rules/api/rulesApi";

/**
 * A named, parameterised use of a rule definition.
 *
 * The definition says what the check does; this says what it checks against.
 * One "value is one of an approved list" definition carries Valid Voltage,
 * Valid Manufacturer and as many more as the governance needs — which is what
 * stops the library filling with near-identical definitions.
 */
export type RuleConfiguration = {
  rule_configuration_id: string;
  rule_definition_id: string;
  code: string;
  name: string;
  description: string;
  parameters: RuleParameters;
  /** Empty means "whatever the definition says". */
  severity: string;
  status: string;
  owner: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;

  /** Carried from the definition, so a configuration is readable on its own. */
  definition_name: string;
  check_type: string;
  definition_kind: string;
  scope: string;
  execution_scope: string;
  dimension: string;
  data_type: string;
  definition_severity: string;
  definition_version: number;

  /** The governed vocabulary its values come from, if any. */
  reference_element_type_id: string;
  reference_element_type_name: string | null;
  reference_model_name: string | null;
  /** Values the vocabulary currently holds. Resolved on read, never stored. */
  resolved_from_vocabulary: string[];
  values_source: "vocabulary" | "fixed";

  severity_label?: string;
  effective_severity: string;
  statement: string;
  /** How many governed vocabularies carry it. */
  linked_to: number;
};

export type RuleConfigurationReport = {
  items: RuleConfiguration[];
  total: number;
  active: number;
};

export type RuleConfigurationVersion = RuleConfiguration & {
  version: number;
  recorded_by: string;
  recorded_at: string;
  is_current: boolean;
};

export type RuleConfigurationHistory = {
  rule_configuration_id: string;
  name: string;
  current_version: number;
  items: RuleConfigurationVersion[];
  total: number;
};

/** A vocabulary a configuration can draw its accepted values from. */
export type Vocabulary = {
  element_id: string;
  name: string;
  display_name: string;
  status: string;
  support_domain_model_id: string;
  model_name: string;
  value_count: number;
};

/** One value of a governed vocabulary, as the rule author sees it. */
export type VocabularyValue = {
  element_instance_id: string;
  value_name: string;
  element_type_id: string;
  status: string;
};

export type VocabularyValueReport = {
  element_type_id: string;
  element_type_name: string;
  model_name: string;
  items: VocabularyValue[];
  total: number;
};

export type SaveRuleConfigurationPayload = {
  rule_definition_id: string;
  name: string;
  description: string;
  parameters: RuleParameters;
  severity: string;
  status: string;
  reference_element_type_id: string;
  owner: string;
};

export const ruleConfigurationsApi = {
  list: (filters: { ruleDefinitionId?: string; search?: string; status?: string } = {}) => {
    const search = new URLSearchParams(
      Object.entries({
        rule_definition_id: filters.ruleDefinitionId ?? "",
        search: filters.search ?? "",
        status: filters.status ?? "",
      }).filter(([, value]) => value.length > 0),
    ).toString();
    return apiClient.get<RuleConfigurationReport>(
      `/api/rules/configurations${search ? `?${search}` : ""}`,
    );
  },

  get: (id: string) => apiClient.get<RuleConfiguration>(`/api/rules/configurations/${id}`),

  getVersions: (id: string) =>
    apiClient.get<RuleConfigurationHistory>(`/api/rules/configurations/${id}/versions`),

  /** The values one vocabulary holds, for the rule author to tick. */
  listVocabularyValues: (elementTypeId: string) =>
    apiClient.get<VocabularyValueReport>(
      `/api/rules/configurations/vocabularies/${elementTypeId}/values`,
    ),

  /** The governed vocabularies a configuration can take its values from. */
  listVocabularies: () =>
    apiClient.get<{ items: Vocabulary[]; total: number }>(
      "/api/rules/configurations/vocabularies",
    ),

  create: (payload: SaveRuleConfigurationPayload) =>
    apiClient.post<RuleConfiguration>("/api/rules/configurations", payload),

  update: (id: string, payload: SaveRuleConfigurationPayload) =>
    apiClient.put<RuleConfiguration>(`/api/rules/configurations/${id}`, payload),

  remove: (id: string) => apiClient.delete<void>(`/api/rules/configurations/${id}`),
};
