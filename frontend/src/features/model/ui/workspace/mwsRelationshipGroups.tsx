import type { RelationshipDetailsGroup } from '@/shared/workspace/RelationshipDetailsList';
import type {
  CrossModelRelationshipTypeSummary,
  HierarchyNodeSummary,
  HierarchyRuleSummary,
  MetadataOption,
  SupportDomainElementSummary,
  SupportDomainRelationshipSummary,
} from '../../domain/types';
import { displayLabel } from '../../domain/utils';

function kindLabel(kinds: MetadataOption[], key: string) {
  return kinds.find((kind) => kind.key === key)?.label ?? key;
}

function crossModelGroup(itemId: string, crossTypes: CrossModelRelationshipTypeSummary[]): RelationshipDetailsGroup {
  const items = crossTypes
    .filter((type) => type.sourceModelItemTypeId === itemId || type.targetModelItemTypeId === itemId)
    .map((type) => {
      const outgoing = type.sourceModelItemTypeId === itemId;
      const otherName = outgoing ? type.targetTypeName : type.sourceTypeName;
      const otherModel = outgoing ? type.targetModelName : type.sourceModelName;
      const otherKind = outgoing ? type.targetModelType : type.sourceModelType;
      return {
        key: `cm:${type.id}`,
        label: otherName ? `${otherModel ?? ''}${otherModel ? ' › ' : ''}${otherName}` : `Any ${otherKind === 'HIERARCHY_MODEL' ? 'hierarchy' : 'support domain'} item`,
        relation: type.name,
        direction: outgoing ? ('out' as const) : ('in' as const),
        secondary: type.status !== 'active' ? type.status : undefined,
      };
    });
  return { title: 'Relationships — other models', items };
}

/**
 * The immediate relationships of one node type: its parent and children (the
 * parent-child relationships the hierarchy creates), itself when it is
 * recursive, the hierarchy rules naming it, and the governed cross-model
 * relationship types it takes part in.
 */
export function nodeTypeRelationshipGroups(args: {
  nodeId: string;
  nodes: HierarchyNodeSummary[];
  rules: HierarchyRuleSummary[];
  crossTypes: CrossModelRelationshipTypeSummary[];
  relationshipKinds: MetadataOption[];
  onSelectNode: (id: string) => void;
}): RelationshipDetailsGroup[] {
  const node = args.nodes.find((item) => item.id === args.nodeId);
  if (!node) return [];
  const byId = new Map(args.nodes.map((item) => [item.id, item]));
  const parent = node.parentNodeId ? byId.get(node.parentNodeId) : undefined;
  const children = args.nodes.filter((item) => item.parentNodeId === node.id).sort((a, b) => a.sortOrder - b.sortOrder);

  const hierarchy: RelationshipDetailsGroup = {
    title: 'Hierarchy',
    items: [
      ...(parent
        ? [{ key: `p:${parent.id}`, label: displayLabel(parent), relation: 'parent', direction: 'in' as const, onClick: () => args.onSelectNode(parent.id) }]
        : []),
      ...children.map((child) => ({
        key: `c:${child.id}`,
        label: displayLabel(child),
        relation: child.isProperty ? 'property' : 'child',
        direction: 'out' as const,
        onClick: () => args.onSelectNode(child.id),
      })),
      ...(node.isRecursive ? [{ key: 'recursive', label: displayLabel(node), relation: 'recursive', direction: 'out' as const }] : []),
    ],
  };

  const rules: RelationshipDetailsGroup = {
    title: 'Hierarchy Rules',
    items: args.rules
      .filter((rule) => rule.parentNodeId === node.id || rule.childNodeId === node.id)
      // Edges already listed under Hierarchy (parent, children, recursive) are not repeated.
      .filter((rule) => {
        if (rule.parentNodeId === rule.childNodeId) return !node.isRecursive;
        if (rule.childNodeId === node.id && rule.parentNodeId === node.parentNodeId) return false;
        if (rule.parentNodeId === node.id && children.some((child) => child.id === rule.childNodeId)) return false;
        return true;
      })
      .map((rule) => {
        const outgoing = rule.parentNodeId === node.id;
        const otherId = outgoing ? rule.childNodeId : rule.parentNodeId;
        const other = byId.get(otherId);
        return {
          key: `r:${rule.id}`,
          label: other ? displayLabel(other) : (outgoing ? rule.childName : rule.parentName) ?? otherId,
          relation: kindLabel(args.relationshipKinds, rule.relationshipKind),
          direction: outgoing ? ('out' as const) : ('in' as const),
          onClick: other ? () => args.onSelectNode(other.id) : undefined,
        };
      }),
  };

  return [hierarchy, rules, crossModelGroup(node.id, args.crossTypes)];
}

/** The immediate relationships of one element type, inside its model and across models. */
export function elementTypeRelationshipGroups(args: {
  elementId: string;
  elements: SupportDomainElementSummary[];
  relationships: SupportDomainRelationshipSummary[];
  crossTypes: CrossModelRelationshipTypeSummary[];
  relationshipKinds: MetadataOption[];
  onSelectElement: (id: string) => void;
}): RelationshipDetailsGroup[] {
  const byId = new Map(args.elements.map((item) => [item.id, item]));
  const inModel: RelationshipDetailsGroup = {
    title: 'Element Relationships',
    items: args.relationships
      .filter((rel) => rel.sourceElementId === args.elementId || rel.targetElementId === args.elementId)
      .map((rel) => {
        const outgoing = rel.sourceElementId === args.elementId;
        const otherId = outgoing ? rel.targetElementId : rel.sourceElementId;
        const other = byId.get(otherId);
        return {
          key: `sd:${rel.id}`,
          label: other ? displayLabel(other) : otherId,
          relation: kindLabel(args.relationshipKinds, rel.relationshipKind),
          direction: outgoing ? ('out' as const) : ('in' as const),
          secondary: rel.notes || undefined,
          onClick: other ? () => args.onSelectElement(other.id) : undefined,
        };
      }),
  };
  return [inModel, crossModelGroup(args.elementId, args.crossTypes)];
}

/** Relationship Details on the cross-model diagram: the governed types one item type takes part in. */
export function crossModelItemGroups(itemId: string, crossTypes: CrossModelRelationshipTypeSummary[], onSelectType: (id: string) => void): RelationshipDetailsGroup[] {
  const group = crossModelGroup(itemId, crossTypes);
  return [
    {
      ...group,
      items: group.items.map((item) => ({ ...item, onClick: () => onSelectType(item.key.slice(3)) })),
    },
  ];
}
