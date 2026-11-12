import { HIERARCHY_LINK_LABEL } from '@/shared/constants/RelationshipConfig';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { InlineEditTable, type InlineColumn } from '@/shared/workspace/InlineEditTable';
import { useToast } from '@/shared/toast/ToastContext';
import { CanonicalBadge } from '@/features/structure/ui/shared/CanonicalBadge';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type { HierarchyNodeDraft, HierarchyNodeSummary, HierarchyRuleSummary, MetadataOption } from '../../domain/types';
import { displayLabel } from '../../domain/utils';
import { DeleteNodeTypeDialog } from '../dialogs/DeleteNodeTypeDialog';

type Row = HierarchyNodeSummary & { depth: number };

function orderedRows(nodes: HierarchyNodeSummary[]): Row[] {
  const children = new Map<string | null, HierarchyNodeSummary[]>();
  for (const node of nodes) {
    const key = node.parentNodeId && nodes.some((n) => n.id === node.parentNodeId) ? node.parentNodeId : null;
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  const out: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const node of (children.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
      out.push({ ...node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function uniqueCopyName(name: string, taken: string[]) {
  const used = new Set(taken.map((value) => value.trim().toLowerCase()));
  let candidate = `${name} (copy)`;
  let n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${name} (copy ${n++})`;
  return candidate;
}

function toDraft(node: HierarchyNodeSummary): HierarchyNodeDraft {
  return {
    id: node.id,
    modelId: node.modelId,
    parentNodeId: node.parentNodeId,
    name: node.name,
    displayName: node.displayName,
    badge: node.badge.badgeText,
    description: node.description,
    isRecursive: node.isRecursive,
    isProperty: node.isProperty,
    status: node.status,
  };
}

/**
 * Hierarchy List: every node type of the model, in tree order, edited where
 * it stands, and the relationships between them. Parent-child relationships
 * are made by the hierarchy itself, so they are listed rather than edited.
 */
export function HierarchyListView(props: {
  modelId: string;
  nodes: HierarchyNodeSummary[];
  rules: HierarchyRuleSummary[];
  lifecycleStatuses: MetadataOption[];
  relationshipKinds: MetadataOption[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  /** Right-click on a node type row. */
  onTypeContextMenu?: (id: string, name: string, event: React.MouseEvent) => void;
  onRefresh: () => Promise<void> | void;
  onDeleted: (id: string) => Promise<void> | void;
}) {
  const { showToast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rows = useMemo(() => orderedRows(props.nodes), [props.nodes]);
  const byId = useMemo(() => new Map(props.nodes.map((node) => [node.id, node])), [props.nodes]);
  const statusLabel = (key: string) => props.lifecycleStatuses.find((s) => s.key === key)?.label ?? key;

  const columns: InlineColumn<Row>[] = [
    {
      key: 'name',
      label: 'Node Type',
      render: (row) => (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: row.depth * 2.5 }}>
          <CanonicalBadge badge={row.badge} fallbackText={row.name} size={22} />
          <Typography variant="body2" fontWeight={600}>
            {row.name}
          </Typography>
          {!row.parentNodeId && <Chip size="small" label="Root" color="primary" sx={{ height: 18, fontSize: 10 }} />}
        </Stack>
      ),
      // The root node type carries the model's name; rename the model instead.
      editor: (row) => ({ field: 'name', disabled: !row.parentNodeId }),
      value: (row) => row.name,
    },
    { key: 'displayName', label: 'Display Name', render: (row) => row.displayName || '—', editor: { field: 'displayName' } },
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }} noWrap>
          {row.description || '—'}
        </Typography>
      ),
      editor: { field: 'description' },
    },
    {
      key: 'flags',
      label: 'Kind',
      width: 130,
      value: (row) => (row.isProperty ? 'Property' : row.isRecursive ? 'Recursive' : 'Level'),
      filter: true,
      render: (row) => (
        <Stack direction="row" spacing={0.5}>
          {row.isProperty && <Chip size="small" variant="outlined" label="Property" sx={{ height: 20, fontSize: 11 }} />}
          {row.isRecursive && <Chip size="small" variant="outlined" label="Recursive" sx={{ height: 20, fontSize: 11 }} />}
          {!row.isProperty && !row.isRecursive && <Typography variant="body2" color="text.secondary">Level</Typography>}
        </Stack>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: 130,
      render: (row) => <Chip size="small" variant="outlined" label={statusLabel(row.status)} sx={{ height: 20, fontSize: 11 }} />,
      editor: { field: 'status', type: 'select', options: props.lifecycleStatuses },
      filter: true,
    },
  ];

  const save = async (row: Row, draft: Record<string, string>) => {
    const name = (draft.name ?? '').trim();
    if (!name) {
      showToast('A node type needs a name.', 'error');
      return false;
    }
    const clash = props.nodes.some((node) => node.id !== row.id && node.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) {
      showToast('Node name must be unique.', 'error');
      return false;
    }
    try {
      await modelDefinitionsApi.updateHierarchyNodeType(row.id, {
        ...toDraft(row),
        name,
        displayName: (draft.displayName ?? '').trim(),
        description: draft.description ?? '',
        status: draft.status || row.status,
      });
      await props.onRefresh();
      showToast('Node type updated.');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update node type.', 'error');
      return false;
    }
  };

  const duplicate = async (row: Row) => {
    try {
      const created = await modelDefinitionsApi.createHierarchyNodeType({
        ...toDraft(row),
        id: undefined,
        name: uniqueCopyName(row.name, props.nodes.map((node) => node.name)),
        displayName: row.displayName ? uniqueCopyName(row.displayName, props.nodes.map((node) => node.displayName)) : '',
      });
      await props.onRefresh();
      props.onSelectNode(created.id);
      showToast(`Duplicated as “${created.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to duplicate node type.', 'error');
    }
  };

  const relationshipRows = useMemo(() => {
    const derived = props.nodes
      .filter((node) => node.parentNodeId && byId.has(node.parentNodeId))
      .map((node) => ({ id: `pc:${node.id}`, parent: byId.get(node.parentNodeId!)!, child: node, kind: HIERARCHY_LINK_LABEL, origin: 'Hierarchy' }));
    const recursive = props.nodes
      .filter((node) => node.isRecursive)
      .map((node) => ({ id: `rec:${node.id}`, parent: node, child: node, kind: 'Recursive', origin: 'Hierarchy' }));
    // The hierarchy already shows each parent-child edge and each recursive node
    // type once; the rules the backend keeps for those same edges are the same
    // relationship, so they are not listed a second time.
    const seen = new Set([...derived, ...recursive].map((row) => `${row.parent.id}>${row.child.id}`));
    const rules = props.rules
      .filter((rule) => {
        const key = `${rule.parentNodeId}>${rule.childNodeId}`;
        if (seen.has(key) || !byId.has(rule.parentNodeId) || !byId.has(rule.childNodeId)) return false;
        seen.add(key);
        return true;
      })
      .map((rule) => ({
        id: `rule:${rule.id}`,
        parent: byId.get(rule.parentNodeId)!,
        child: byId.get(rule.childNodeId)!,
        kind: props.relationshipKinds.find((k) => k.key === rule.relationshipKind)?.label ?? rule.relationshipKind,
        origin: 'Rule',
      }));
    return [...derived, ...recursive, ...rules];
  }, [props.nodes, props.rules, props.relationshipKinds, byId]);

  const deleteTarget = deleteId ? byId.get(deleteId) : undefined;

  return (
    <Stack spacing={2} sx={{ minHeight: 0 }}>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Node Types ({rows.length})
        </Typography>
        <InlineEditTable<Row>
          rows={rows}
          columns={columns}
          getId={(row) => row.id}
          getLabel={(row) => displayLabel(row)}
          draftOf={(row) => ({ name: row.name, displayName: row.displayName, description: row.description, status: row.status })}
          onSave={save}
          onDuplicate={(row) => void duplicate(row)}
          canDelete={(row) => Boolean(row.parentNodeId)}
          onDelete={(row) => setDeleteId(row.id)}
          selectedId={props.selectedNodeId}
          onRowClick={(row) => props.onSelectNode(row.id)}
          onRowContextMenu={props.onTypeContextMenu ? (row, event) => props.onTypeContextMenu!(row.id, displayLabel(row), event) : undefined}
          emptyText="This model has no node types yet."
          searchPlaceholder="Search node types…"
        />
      </Box>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Relationships ({relationshipRows.length})
        </Typography>
        <InlineEditTable
          rows={relationshipRows}
          getId={(row) => row.id}
          getLabel={(row) => `${row.parent.name} → ${row.child.name}`}
          draftOf={() => ({})}
          dense
          onRowClick={(row) => props.onSelectNode(row.child.id)}
          columns={[
            { key: 'parent', label: 'Parent Node Type', render: (row) => displayLabel(row.parent) },
            { key: 'kind', label: 'Relationship', width: 160, filter: true, render: (row) => <Chip size="small" label={row.kind} sx={{ height: 20, fontSize: 11 }} /> },
            { key: 'child', label: 'Child Node Type', render: (row) => displayLabel(row.child) },
          ]}
          emptyText="No relationships yet — add a child node type to create one."
          searchPlaceholder="Search relationships…"
        />
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', display: 'block', mt: 0.5 }}>
          “Parent of” relationships are created automatically from the hierarchy.
        </Typography>
      </Box>
      <DeleteNodeTypeDialog
        nodeId={deleteId}
        nodeName={deleteTarget ? displayLabel(deleteTarget) : 'Node type'}
        deleting={deleting}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          setDeleting(true);
          try {
            await props.onDeleted(deleteId);
          } finally {
            setDeleting(false);
            setDeleteId(null);
          }
        }}
      />
    </Stack>
  );
}
