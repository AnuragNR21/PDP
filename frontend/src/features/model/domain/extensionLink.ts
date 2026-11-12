/**
 * The structural link between a common Hierarchy Model and a model that
 * extends it in another Package: the extending model's root node type is the
 * child of one inherited node type. It is kept as a governed cross-model
 * relationship type named "Parent of" — the same name every hierarchy
 * parent-child relationship carries — so it shows on the Relationship
 * diagram and matrix, and SWS can relate instances along it.
 *
 * Pure: no React, no API, so the rules can be tested on their own.
 */

export const EXTENSION_LINK_NAME = 'Parent of';

export type ExtensionNode = { id: string; parentNodeId: string | null; isProperty?: boolean; sortOrder?: number; name?: string };

export type ExtensionLinkType = {
  id: string;
  name: string;
  status?: string;
  sourceModelType: string;
  sourceModelItemTypeId: string | null;
  targetModelType: string;
  targetModelItemTypeId: string | null;
};

/** Node types in tree order with their depth (siblings by sort order). */
export function inTreeOrder<T extends ExtensionNode>(nodes: T[]): Array<{ node: T; depth: number }> {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    const parent = node.parentNodeId && ids.has(node.parentNodeId) ? node.parentNodeId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  for (const list of children.values()) list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out: Array<{ node: T; depth: number }> = [];
  const visit = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      out.push({ node, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** Inherited node types the extending model can hang under: a property node takes no children. */
export function anchorCandidates<T extends ExtensionNode>(nodes: T[]): Array<{ node: T; depth: number }> {
  return inTreeOrder(nodes).filter(({ node }) => !node.isProperty);
}

/**
 * Where the extending model goes when nobody chose: the deepest inherited node
 * type (Information System › Platform › Application → Application); among
 * equally deep ones, the first in tree order.
 */
export function defaultAnchor<T extends ExtensionNode>(nodes: T[]): T | null {
  let best: { node: T; depth: number } | null = null;
  for (const candidate of anchorCandidates(nodes)) {
    if (!best || candidate.depth > best.depth) best = candidate;
  }
  return best?.node ?? null;
}

/** The model's root node type: the one without a parent in the model. */
export function rootOf<T extends ExtensionNode>(nodes: T[]): T | null {
  const ids = new Set(nodes.map((node) => node.id));
  return nodes.find((node) => !node.parentNodeId || !ids.has(node.parentNodeId)) ?? null;
}

/** The link(s) from an inherited node type to this root — at most one is expected. */
export function findExtensionLinks<T extends ExtensionLinkType>(types: T[], inheritedNodeIds: ReadonlySet<string>, rootId: string): T[] {
  return types.filter(
    (type) =>
      type.name === EXTENSION_LINK_NAME &&
      type.sourceModelType === 'HIERARCHY_MODEL' &&
      type.targetModelType === 'HIERARCHY_MODEL' &&
      type.targetModelItemTypeId === rootId &&
      Boolean(type.sourceModelItemTypeId && inheritedNodeIds.has(type.sourceModelItemTypeId)),
  );
}

/** The live link, if any: an active one first, then any. */
export function currentExtensionLink<T extends ExtensionLinkType>(types: T[], inheritedNodeIds: ReadonlySet<string>, rootId: string): T | null {
  const links = findExtensionLinks(types, inheritedNodeIds, rootId);
  return links.find((link) => link.status !== 'retired') ?? null;
}
