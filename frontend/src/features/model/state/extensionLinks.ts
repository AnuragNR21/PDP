import { modelDefinitionsApi } from '../api/modelDefinitionsApi';
import type { CrossModelRelationshipTypeDraft, CrossModelRelationshipTypeSummary } from '../domain/types';
import { defaultAnchor, EXTENSION_LINK_NAME, findExtensionLinks, rootOf } from '../domain/extensionLink';

/**
 * Keeping the "Parent of" link between a common Hierarchy Model and a model
 * that extends it. Created when the extension is made (with the deepest
 * inherited node type, or the one chosen), moved when another is chosen, and
 * retired — not deleted, so instance relationships along it stay readable —
 * when the model stops extending.
 */

async function loadEnds(baseModelId: string, extendingModelId: string) {
  const [baseNodes, ownNodes, types] = await Promise.all([
    modelDefinitionsApi.listHierarchyNodeTypes(baseModelId),
    modelDefinitionsApi.listHierarchyNodeTypes(extendingModelId),
    modelDefinitionsApi.listCrossModelRelationshipTypes(),
  ]);
  const root = rootOf(ownNodes);
  const links = root ? findExtensionLinks(types, new Set(baseNodes.map((node) => node.id)), root.id) : [];
  return { baseNodes, root, links };
}

function draft(anchorId: string, rootId: string, rootName: string, anchorName: string, status: 'active' | 'retired' = 'active'): CrossModelRelationshipTypeDraft {
  return {
    name: EXTENSION_LINK_NAME,
    description: `${anchorName} is parent of ${rootName}: the extending model's hierarchy continues the common model's.`,
    sourceModelType: 'HIERARCHY_MODEL',
    sourceModelItemTypeId: anchorId,
    targetModelType: 'HIERARCHY_MODEL',
    targetModelItemTypeId: rootId,
    status,
  };
}

/** Attach the extending model's root under `anchorId` (default: the deepest inherited node type). */
export async function linkExtension(baseModelId: string, extendingModelId: string, anchorId?: string): Promise<CrossModelRelationshipTypeSummary | null> {
  const { baseNodes, root, links } = await loadEnds(baseModelId, extendingModelId);
  const anchor = anchorId ? baseNodes.find((node) => node.id === anchorId) ?? null : defaultAnchor(baseNodes);
  if (!root || !anchor) return null;
  const body = draft(anchor.id, root.id, root.displayName || root.name, anchor.displayName || anchor.name);
  // One link per extension: reuse (and re-activate) an existing one, retire any extra.
  const [keep, ...extra] = [...links].sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired'));
  for (const link of extra) {
    if (link.status !== 'retired') await modelDefinitionsApi.updateCrossModelRelationshipType(link.id, { ...toDraft(link), status: 'retired' });
  }
  return keep
    ? modelDefinitionsApi.updateCrossModelRelationshipType(keep.id, body)
    : modelDefinitionsApi.createCrossModelRelationshipType(body);
}

/** The model no longer extends `baseModelId`: retire its link(s). */
export async function unlinkExtension(baseModelId: string, extendingModelId: string): Promise<void> {
  const { links } = await loadEnds(baseModelId, extendingModelId);
  for (const link of links) {
    if (link.status !== 'retired') await modelDefinitionsApi.updateCrossModelRelationshipType(link.id, { ...toDraft(link), status: 'retired' });
  }
}

function toDraft(type: CrossModelRelationshipTypeSummary): CrossModelRelationshipTypeDraft {
  return {
    name: type.name,
    description: type.description ?? '',
    sourceModelType: type.sourceModelType,
    sourceModelItemTypeId: type.sourceModelItemTypeId,
    targetModelType: type.targetModelType,
    targetModelItemTypeId: type.targetModelItemTypeId,
    status: type.status,
  };
}
