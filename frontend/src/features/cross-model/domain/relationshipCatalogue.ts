/**
 * Colours for the recommended cross-model relationship types.
 *
 * The Model workspace can define a relationship type with ANY name, so this is a
 * presentation hint, never a whitelist: a name that isn't here simply renders in
 * the fallback colour. Names mirror the backend's RELATIONSHIP_TYPE_TEMPLATES in
 * `backend/shared/contracts/cross_model_relationship_type_options.py`, which is
 * what the "Quick select" chips offer — keep the two lists in step when adding a
 * template (a missed one is only a colour, not a break).
 */

export type RecommendedRelationship = {
  name: string;
  color: string;
  bg: string;
};

/** Anything the user names outside the recommended set renders black. */
export const RELATIONSHIP_FALLBACK_COLOR = "#000000";
export const RELATIONSHIP_FALLBACK_BG = "#F5F5F5";

export const RECOMMENDED_RELATIONSHIP_LIST: RecommendedRelationship[] = [
  { name: "Categorises",     color: "#00695C", bg: "#E0F2F1" },
  { name: "Classifies",      color: "#558B2F", bg: "#F1F8E9" },
  { name: "Governs",         color: "#6A1B9A", bg: "#F3E5F5" },
  { name: "Accountable for", color: "#00838F", bg: "#E0F7FA" },
  { name: "Responsible for", color: "#0277BD", bg: "#E1F5FE" },
  { name: "Owns",            color: "#1565C0", bg: "#E3F2FD" },
  { name: "Manages",         color: "#2E7D32", bg: "#E8F5E9" },
  { name: "Stewards",        color: "#E65100", bg: "#FFF3E0" },
  { name: "Produces",        color: "#4527A0", bg: "#EDE7F6" },
  { name: "Consumes",        color: "#283593", bg: "#E8EAF6" },
  { name: "Reports to",      color: "#C62828", bg: "#FFEBEE" },
  { name: "Delegates to",    color: "#F9A825", bg: "#FFFDE7" },
  { name: "Applies to",      color: "#455A64", bg: "#ECEFF1" },
  { name: "Has threshold",   color: "#D84315", bg: "#FBE9E7" },
  { name: "Defines",         color: "#5D4037", bg: "#EFEBE9" },
  { name: "Maps to",         color: "#827717", bg: "#F9FBE7" },
  { name: "Audits",          color: "#880E4F", bg: "#FCE4EC" },
  { name: "Monitors",        color: "#AD1457", bg: "#FCE4EC" },
  { name: "Depends on",      color: "#37474F", bg: "#ECEFF1" },
  { name: "Supports",        color: "#33691E", bg: "#F1F8E9" },
];

const BY_NAME = new Map(
  RECOMMENDED_RELATIONSHIP_LIST.map((entry) => [entry.name.trim().toLowerCase(), entry] as const),
);

/** Look up a recommended entry by a governed type's name; undefined when custom. */
export function getRecommendedRelationship(name: string | null | undefined) {
  if (!name) return undefined;
  return BY_NAME.get(name.trim().toLowerCase());
}

/** Line/label colour for a governed type name, black when it isn't recommended. */
export function getRelationshipColor(name: string | null | undefined): string {
  return getRecommendedRelationship(name)?.color ?? RELATIONSHIP_FALLBACK_COLOR;
}

/** Chip background for a governed type name. */
export function getRelationshipBg(name: string | null | undefined): string {
  return getRecommendedRelationship(name)?.bg ?? RELATIONSHIP_FALLBACK_BG;
}
