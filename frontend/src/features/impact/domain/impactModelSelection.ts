/**
 * Impact's Model Selection: the Structure Workspace Model Selection panel —
 * Package → Model — one level deeper, so the items a reader puts on the
 * diagram sit under their model: a hierarchy model as its node tree, a support
 * domain model as element types holding their instances.
 *
 * The same conventions as the SWS panel: packages in its order (Shared Models
 * first), models in the panel's order inside a package, the Hierarchy /
 * Support Domain / All toggle, the Active filter, and one search. Search here
 * also reaches the items: a package found by name shows all its models, a
 * model found by name shows all its items, and otherwise a model shows only
 * the items that match (with their parents, so a hierarchy keeps its shape).
 *
 * Pure on purpose — no React, no `@/` runtime imports — so it runs as tests.
 */

import type { CrossModelSelectableItem } from "../../cross-model/domain/crossModelSelection";

export type PickerKind = "hierarchy" | "support";
export type PickerKindFilter = PickerKind | "all";

export type PickerPackage = { id: string; name: string };

export type PickerModel = {
  /** `kind:id`, the key the package state uses. */
  key: string;
  id: string;
  name: string;
  kind: PickerKind;
  status: string;
  packageId: string;
  /**
   * For a hierarchy model, the row standing for the model itself (it can go
   * on the diagram); its children are the model's root nodes.
   */
  modelItem?: CrossModelSelectableItem;
  /** Every item but the model row. */
  items: CrossModelSelectableItem[];
  /** Support domain only: the element types, in the model's order. */
  elementTypes?: Array<{ typeId: string; typeName: string }>;
  loading?: boolean;
};

export type ShownModel = {
  model: PickerModel;
  /** Null: every item is shown. Otherwise the ids shown (matches and their parents). */
  visibleIds: Set<string> | null;
  /** Items that match the search (highlighted, and their branch opens). */
  matchedIds: Set<string>;
};

export type ShownPackage = { pkg: PickerPackage; total: number; models: ShownModel[] };

export type PickerFilter = { kind: PickerKindFilter; activeOnly: boolean; query: string };

const norm = (text: string) => text.trim().toLocaleLowerCase();

/** Split a hierarchy model's catalogue into the model row and its items. */
export function splitModelRow(items: CrossModelSelectableItem[], modelRowTypeId: string) {
  const modelItem = items.find((item) => item.typeId === modelRowTypeId);
  return { modelItem, items: items.filter((item) => item !== modelItem) };
}

/** The items matching the query, and the ids to show for them (with every ancestor). */
export function matchItems(model: PickerModel, query: string) {
  const q = norm(query);
  const matchedIds = new Set<string>();
  if (!q) return { matchedIds, visibleIds: new Set<string>() };
  const byId = new Map(model.items.map((item) => [item.id, item]));
  const visibleIds = new Set<string>();
  for (const item of model.items) {
    if (!item.name.toLocaleLowerCase().includes(q)) continue;
    matchedIds.add(item.id);
    let current: CrossModelSelectableItem | undefined = item;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      visibleIds.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return { matchedIds, visibleIds };
}

/**
 * What the panel shows: packages in order, each with its models after the
 * type toggle, the Active filter and the search. Packages with nothing to
 * show are left out while a filter or search is on.
 */
export function shownPackages(packages: PickerPackage[], models: PickerModel[], filter: PickerFilter): ShownPackage[] {
  const q = norm(filter.query);
  const filtering = filter.kind !== "all" || filter.activeOnly || Boolean(q);
  return packages
    .map((pkg) => {
      const all = models.filter((model) => model.packageId === pkg.id);
      const passing = all.filter(
        (model) => (filter.kind === "all" || model.kind === filter.kind) && (!filter.activeOnly || model.status === "active"),
      );
      const packageMatch = Boolean(q) && pkg.name.toLocaleLowerCase().includes(q);
      const shown: ShownModel[] = [];
      for (const model of passing) {
        if (!q || packageMatch) {
          shown.push({ model, visibleIds: null, matchedIds: new Set() });
          continue;
        }
        const { matchedIds, visibleIds } = matchItems(model, q);
        if (model.name.toLocaleLowerCase().includes(q)) shown.push({ model, visibleIds: null, matchedIds });
        else if (matchedIds.size > 0) shown.push({ model, visibleIds, matchedIds });
      }
      return { pkg, total: all.length, models: shown };
    })
    .filter((group) => !filtering || group.models.length > 0);
}

/** The next picker selection after a click: a plain click picks one, Ctrl/⌘ adds or removes. */
export function nextSelection(
  selection: CrossModelSelectableItem[],
  item: CrossModelSelectableItem,
  additive: boolean,
): CrossModelSelectableItem[] {
  const has = selection.some((selected) => selected.id === item.id);
  if (!additive) return has && selection.length === 1 ? [] : [item];
  return has ? selection.filter((selected) => selected.id !== item.id) : [...selection, item];
}

/** Support domain items grouped under the model's element types (types without instances included). */
export function elementTypeGroups(model: PickerModel) {
  const byType = new Map<string, CrossModelSelectableItem[]>();
  for (const item of model.items) byType.set(item.typeId, [...(byType.get(item.typeId) ?? []), item]);
  for (const list of byType.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const declared = model.elementTypes ?? [];
  const groups = declared.map((type) => ({ typeId: type.typeId, typeName: type.typeName, items: byType.get(type.typeId) ?? [] }));
  const known = new Set(declared.map((type) => type.typeId));
  for (const [typeId, items] of byType) {
    if (!known.has(typeId)) groups.push({ typeId, typeName: items[0].typeName || "Other", items });
  }
  return groups;
}
