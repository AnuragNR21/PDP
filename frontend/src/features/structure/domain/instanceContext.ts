/**
 * Owner context for instances that share a name.
 *
 * Property instances (and any instance) repeat their names under different
 * owners: "Manufacturer" under Pole, Switch and Transformer. Listed by type
 * they look like one instance shown three times. This works out the shortest
 * run of ancestor names that tells such instances apart, so the UI can show
 * "Manufacturer · Pole" instead of three identical rows.
 */
export type ContextItem = {
  id: string;
  name: string;
  modelId: string;
  typeId: string;
  parentId?: string | null;
};

/** Separator between ancestor names, outermost first: "Device › Switch". */
export const CONTEXT_SEPARATOR = " › ";

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/** Ancestor names of an item, nearest first, stopping at a cycle or a missing parent. */
function ancestorNames(item: ContextItem, byId: Map<string, ContextItem>): string[] {
  const names: string[] = [];
  const seen = new Set<string>([item.id]);
  let parentId = item.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.push(parent.name);
    seen.add(parentId);
    parentId = parent.parentId ?? null;
  }
  return names;
}

/**
 * id → context, only for instances whose name repeats within their model and
 * type. Items with a unique name get no entry. The context uses as few
 * ancestors as tell the group apart (nearest first, written outermost first).
 */
export function instanceContexts(items: ContextItem[]): Map<string, string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const groups = new Map<string, ContextItem[]>();
  for (const item of byId.values()) {
    const key = `${item.modelId}\u0000${item.typeId}\u0000${nameKey(item.name)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const contexts = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const paths = group.map((item) => ({ item, ancestors: ancestorNames(item, byId) }));
    const deepest = Math.max(...paths.map((path) => path.ancestors.length));
    const labelAt = (ancestors: string[], depth: number) => ancestors.slice(0, depth).reverse().join(CONTEXT_SEPARATOR);
    let depth = 1;
    for (; depth < deepest; depth += 1) {
      const labels = paths.map((path) => nameKey(labelAt(path.ancestors, depth)));
      if (new Set(labels).size === labels.length) break;
    }
    for (const { item, ancestors } of paths) {
      const label = labelAt(ancestors, depth);
      if (label) contexts.set(item.id, label);
    }
  }
  return contexts;
}

/** The items once each, keeping the first of any repeated id. */
export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}
