/**
 * Presentation for the three relationship sources a shared diagram draws.
 *
 * Both cross-model diagrams — the Model workspace's type level and the Structure
 * workspace's instance level — show the governed cross-model relationships
 * alongside the relationships already set up inside a hierarchy model and inside
 * a support domain model. Cross-model connections keep the catalogue colour of
 * their governed type name; the two intra-model sources take a fixed colour so
 * the three read apart at a glance.
 */

import type { RelationshipLinkCategory } from "@/shared/constants/RelationshipConfig";
import { getRelationshipBg, getRelationshipColor } from "./relationshipCatalogue";

export type LinkCategoryConfig = {
  key: RelationshipLinkCategory;
  label: string;
  /** null = colour by governed type name from the recommended catalogue. */
  color: string | null;
  /**
   * Prefix keeping each source's edge ids distinct on the same node pair.
   * Cross-model keeps the unprefixed key it always had, so line styles saved
   * before the other sources existed still resolve.
   */
  keyPrefix: string;
};

export const LINK_CATEGORIES: LinkCategoryConfig[] = [
  { key: "CROSS_MODEL", label: "Between models", color: null, keyPrefix: "" },
  { key: "HIERARCHY", label: "Hierarchy", color: "#1565C0", keyPrefix: "hier:" },
  { key: "SUPPORT_DOMAIN", label: "Support domain", color: "#2E7D32", keyPrefix: "sd:" },
];

export const LINK_CATEGORY_BY_KEY = new Map(
  LINK_CATEGORIES.map((category) => [category.key, category] as const),
);

/** Legend entries shown before the list folds behind "Show all". */
export const LEGEND_COLLAPSED_LIMIT = 10;

/** Line/label colour for one link: fixed per intra-model source, catalogue-driven otherwise. */
export function getLinkColor(category: RelationshipLinkCategory, name: string): string {
  return LINK_CATEGORY_BY_KEY.get(category)?.color ?? getRelationshipColor(name);
}

/** Chip background for a legend entry, mirroring getLinkColor. */
export function getLinkBg(category: RelationshipLinkCategory, name: string): string {
  const fixed = LINK_CATEGORY_BY_KEY.get(category)?.color;
  return fixed ? `${fixed}18` : getRelationshipBg(name);
}

/** Source name shown when hovering a legend entry. */
export function getLinkCategoryLabel(category: RelationshipLinkCategory): string {
  return LINK_CATEGORY_BY_KEY.get(category)?.label ?? category;
}

/**
 * Edge id (and saved line-style key) for a connection between two items. The
 * instance-level cross-model edge is keyed on its own relationship id instead,
 * since one instance is exactly one connection.
 */
export function edgeKeyForPair(
  category: RelationshipLinkCategory,
  sourceId: string,
  targetId: string,
): string {
  const prefix = LINK_CATEGORY_BY_KEY.get(category)?.keyPrefix ?? "";
  return `${prefix}${sourceId}__${targetId}`;
}

/**
 * Hierarchy rules and support domain relationships are stored as kind keys
 * (`has_threshold`, `categorises`, …). Humanising the key lands on the
 * catalogue's spelling for the shared names ("Categorises", "Has threshold", …),
 * so they colour like their cross-model counterparts.
 */
export function relationshipKindLabel(kind: string): string {
  const text = kind.trim();
  // A relationship name of the model's own ("zz 123") is shown as written;
  // only a kind key ("reports_to") is humanised. Same rule as the backend.
  if (!text || text.includes(" ") || text !== text.toLowerCase()) return text;
  const spaced = text.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
