/**
 * PDP global search — the shapes the server returns, and where each result
 * opens. Pure on purpose (no React, no `@/` runtime imports) so it runs as tests.
 */

export type SearchGroupId = "models" | "types" | "instances" | "properties" | "relationships" | "rules" | "discover" | "quality";
export type SearchStatus = "draft" | "active" | "retired";
export type SearchMatch = "exact" | "prefix" | "name" | "description" | "property";

export type SearchResult = {
  id: string;
  type: string;
  type_label: string;
  workspace: "MWS" | "SWS" | "Rules" | "Discover";
  name: string;
  description: string | null;
  status: string | null;
  model_id: string | null;
  model_name: string | null;
  model_kind: "hierarchy" | "support" | null;
  package: string | null;
  parent: string | null;
  detail: string | null;
  focus_id: string | null;
  session_id: string | null;
  file_id: string | null;
  snippet: string | null;
  rank: number;
  match: SearchMatch;
};

export type SearchGroup = { group: SearchGroupId; label: string; total: number; items: SearchResult[] };

export type SearchResponse = {
  query: string;
  total: number;
  groups: SearchGroup[];
  counts: Record<SearchGroupId, number>;
};

export const SEARCH_GROUPS: Array<{ id: SearchGroupId; label: string }> = [
  { id: "models", label: "Models" },
  { id: "types", label: "Types" },
  { id: "instances", label: "Instances" },
  { id: "properties", label: "Properties" },
  { id: "relationships", label: "Relationships" },
  { id: "rules", label: "Rules" },
  { id: "discover", label: "Discover" },
  { id: "quality", label: "Quality Findings" },
];

const MWS = "/model/tree-models";
const SWS = "/structure-workspace";

const query = (params: Record<string, string | null | undefined>) => {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
};

/**
 * Where a result opens — the object itself, not just its workspace:
 * a model opens; a type, property or relationship opens its model with that
 * type selected (MWS `focus`); an instance opens SWS with it selected
 * (`instance`); a rule opens the Rule Workspace on it (`rule`); Discover
 * content opens its session on the right table, step and column.
 */
export function resultHref(result: SearchResult): string | null {
  const kind = result.model_kind;
  const model = result.model_id;
  switch (result.type) {
    case "hierarchy_model":
    case "support_model":
      return kind && model ? `${MWS}${query({ kind, model })}` : null;
    case "node_type":
    case "element_type":
    case "asset_property":
    case "node_type_property":
    case "element_type_property":
    case "sd_relationship":
      return kind && model ? `${MWS}${query({ kind, model, focus: result.focus_id })}` : null;
    case "cross_model_relationship":
      return `${MWS}${query({ tab: "relationship" })}`;
    case "node_instance":
    case "element_instance":
    case "property_value":
      return kind && model ? `${SWS}${query({ kind, model, instance: result.focus_id })}` : null;
    case "node_property_value":
      return kind && model ? `${SWS}${query({ kind, model, instance: result.focus_id, tab: null, panel: "properties" })}` : null;
    case "rule_definition":
    case "rule_configuration":
      return `/rules${query({ rule: result.focus_id })}`;
    case "dq_category":
      return `/rules${query({ category: result.focus_id ?? result.name })}`;
    case "discover_session":
      return result.session_id ? `/discover/mapping/${encodeURIComponent(result.session_id)}` : null;
    case "source_table":
      return result.session_id ? `/discover/mapping/${encodeURIComponent(result.session_id)}${query({ file: result.file_id, step: "import" })}` : null;
    case "source_column":
      return result.session_id
        ? `/discover/mapping/${encodeURIComponent(result.session_id)}${query({ file: result.file_id, step: "profile", column: result.focus_id })}`
        : null;
    case "mapping":
      return result.session_id
        ? `/discover/mapping/${encodeURIComponent(result.session_id)}${query({ file: result.file_id, step: "mapping", column: result.focus_id })}`
        : null;
    case "quality_finding":
      return result.session_id
        ? `/discover/mapping/${encodeURIComponent(result.session_id)}${query({ file: result.file_id, step: "quality", column: result.focus_id })}`
        : null;
    default:
      return null;
  }
}

/**
 * The context line under a result: type · parent / detail · model · package · workspace,
 * leaving out what is missing or repeats the name.
 */
export function resultContext(result: SearchResult): string {
  const parts = [
    result.type_label,
    result.detail,
    result.parent && result.parent !== result.detail ? result.parent : null,
    result.model_name && result.model_name !== result.name ? result.model_name : null,
    result.package,
    result.workspace,
  ];
  const seen = new Set<string>();
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .filter((part) => (seen.has(part) ? false : (seen.add(part), true)))
    .join(" · ");
}

/** "Draft" | "Active" | "Archived" — the words PDP uses for lifecycle. */
export function statusLabel(status: string | null): string | null {
  if (status === "draft") return "Draft";
  if (status === "active") return "Active";
  if (status === "retired") return "Archived";
  return null;
}
