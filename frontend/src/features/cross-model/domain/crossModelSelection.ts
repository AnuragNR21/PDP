import type { BadgeCustomization } from "@/features/model/domain/types";
import type { ModelKind } from "@/shared/constants/ModelConfig";

/**
 * Which workspace is doing the picking.
 *
 * It only names the panel's own chip, but the name has to be true: Impact
 * reuses this control exactly as Structure uses it, and a chip reading
 * "structure" on the Impact page would be the one place the two screens lie
 * about being the same thing.
 */
export type CrossModelWorkspace = "model" | "structure" | "impact";
export type CrossModelView = "matrix" | "diagram";
export const CROSS_MODEL_SELECTION_LEVEL = {
  TYPE: "type",
  INSTANCE: "instance",
} as const;
export type CrossModelSelectionLevel =
  typeof CROSS_MODEL_SELECTION_LEVEL[keyof typeof CROSS_MODEL_SELECTION_LEVEL];
export type CrossModelSelectionMode = "source" | "target";
export type CrossModelModelKindFilter = ModelKind | "ALL";
export type CrossModelSelectableStatus = {
  disabled?: boolean;
  reason?: string;
  label?: string;
  tone?: "default" | "info" | "warning" | "success";
};

export type CrossModelSelectableItem = {
  id: string;
  name: string;
  level: CrossModelSelectionLevel;
  modelKind: ModelKind;
  modelId: string;
  modelName: string;
  typeId: string;
  typeName: string;
  parentId?: string | null;
  badge?: BadgeCustomization | null;
  status?: CrossModelSelectableStatus;
  /** The instance's own lifecycle status: draft | active | retired (Archived). */
  lifecycle?: string;
  /**
   * Whether new relationships may use it: not Archived, and its model and type
   * are Active. When false, `lifecycleReason` says why.
   */
  authorable?: boolean;
  lifecycleReason?: string;
};

export type CrossModelSelectionModel = {
  id: string;
  name: string;
  modelKind: ModelKind;
  items: CrossModelSelectableItem[];
  supportDomainElementTypes?: Array<{ typeId: string; typeName: string }>;
  loading?: boolean;
  error?: string | null;
};

export function getCrossModelSelectionKey(item: Pick<CrossModelSelectableItem, "id" | "level" | "modelKind">) {
  return `${item.level}:${item.modelKind}:${item.id}`;
}

export function filterCrossModelItemsByName(items: CrossModelSelectableItem[], search: string) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return items;
  return items.filter((item) => item.name.toLocaleLowerCase().includes(query));
}

export function getHierarchySearchState(
  items: CrossModelSelectableItem[],
  search: string,
  typeId = "",
) {
  const matches = filterCrossModelItemsByName(items, search).filter(
    (item) => !typeId || item.typeId === typeId,
  );
  if (!search.trim() && !typeId) {
    return { visibleIds: new Set(items.map((item) => item.id)), expandedIds: new Set<string>() };
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const visibleIds = new Set<string>();
  const expandedIds = new Set<string>();

  for (const match of matches) {
    visibleIds.add(match.id);
    let parentId = match.parentId;
    while (parentId) {
      visibleIds.add(parentId);
      expandedIds.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }

  return { visibleIds, expandedIds };
}

export function groupCrossModelItemsByType(items: CrossModelSelectableItem[]) {
  const groups = new Map<string, { typeId: string; typeName: string; items: CrossModelSelectableItem[] }>();
  for (const item of items) {
    const key = item.typeId || item.typeName;
    const group = groups.get(key) ?? { typeId: item.typeId, typeName: item.typeName, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
