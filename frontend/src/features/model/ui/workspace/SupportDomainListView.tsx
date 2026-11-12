import { Box, Chip, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';
import { InlineEditTable, type InlineColumn } from '@/shared/workspace/InlineEditTable';
import { useToast } from '@/shared/toast/ToastContext';
import { CanonicalBadge } from '@/features/structure/ui/shared/CanonicalBadge';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type { MetadataOption, SupportDomainElementSummary, SupportDomainRelationshipSummary } from '../../domain/types';
import { displayLabel } from '../../domain/utils';
import { uniqueCopyName } from './HierarchyListView';

/**
 * Support Domain List: every element type and relationship of the model,
 * edited where they stand. A relationship's duplicate opens Add Relationship
 * with its source and kind filled in, since the copy needs a different end.
 */
export function SupportDomainListView(props: {
  modelId: string;
  elements: SupportDomainElementSummary[];
  relationships: SupportDomainRelationshipSummary[];
  lifecycleStatuses: MetadataOption[];
  relationshipKinds: MetadataOption[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  /** Right-click on an element type row. */
  onTypeContextMenu?: (id: string, name: string, event: React.MouseEvent) => void;
  onDeleteElement: (id: string) => void;
  onDeleteRelationship: (id: string) => void;
  onDuplicateRelationship: (relationship: SupportDomainRelationshipSummary) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const { showToast } = useToast();
  const byId = useMemo(() => new Map(props.elements.map((element) => [element.id, element])), [props.elements]);
  const statusLabel = (key: string) => props.lifecycleStatuses.find((s) => s.key === key)?.label ?? key;
  // The kinds a Support Domain relationship may take, then the names of the model's own it already uses.
  const standardKinds = props.relationshipKinds.filter((kind) => kind.key !== 'parent_child' && kind.key !== 'recursive');
  const ownNames = [...new Set(props.relationships.map((r) => r.relationshipKind).filter((key) => !props.relationshipKinds.some((kind) => kind.key === key)))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ key: name, label: name }));
  const kindOptions = [...ownNames, ...standardKinds];
  const kindLabel = (key: string) => props.relationshipKinds.find((kind) => kind.key === key)?.label ?? key;
  const elementOptions = props.elements.map((element) => ({ key: element.id, label: displayLabel(element) }));

  const elementColumns: InlineColumn<SupportDomainElementSummary>[] = [
    {
      key: 'name',
      label: 'Element Type',
      render: (row) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <CanonicalBadge badge={row.badge} fallbackText={row.name} size={22} />
          <Typography variant="body2" fontWeight={600}>
            {row.name}
          </Typography>
        </Stack>
      ),
      editor: { field: 'name' },
      value: (row) => row.name,
    },
    { key: 'displayName', label: 'Display Name', render: (row) => row.displayName || '—', editor: { field: 'displayName' } },
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }} noWrap>
          {row.description || '—'}
        </Typography>
      ),
      editor: { field: 'description' },
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

  const saveElement = async (row: SupportDomainElementSummary, draft: Record<string, string>) => {
    const name = (draft.name ?? '').trim();
    if (!name) {
      showToast('An element type needs a name.', 'error');
      return false;
    }
    if (props.elements.some((element) => element.id !== row.id && element.name.trim().toLowerCase() === name.toLowerCase())) {
      showToast('Element name must be unique in this model.', 'error');
      return false;
    }
    try {
      await modelDefinitionsApi.updateSupportDomainElement(row.id, {
        id: row.id,
        // The model on screen when a row arrives without it.
        modelId: row.modelId || props.modelId,
        name,
        displayName: (draft.displayName ?? '').trim(),
        badge: row.badge.badgeText,
        description: draft.description ?? '',
        status: draft.status || row.status,
      });
      await props.onRefresh();
      showToast('Element type updated.');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update element type.', 'error');
      return false;
    }
  };

  const duplicateElement = async (row: SupportDomainElementSummary) => {
    try {
      const created = await modelDefinitionsApi.createSupportDomainElement({
        // The model on screen when a row arrives without it.
        modelId: row.modelId || props.modelId,
        name: uniqueCopyName(row.name, props.elements.map((element) => element.name)),
        displayName: row.displayName ? uniqueCopyName(row.displayName, props.elements.map((element) => element.displayName)) : '',
        badge: row.badge.badgeText,
        description: row.description,
        status: row.status,
      });
      await props.onRefresh();
      props.onSelectElement(created.id);
      showToast(`Duplicated as “${created.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to duplicate element type.', 'error');
    }
  };

  const saveRelationship = async (row: SupportDomainRelationshipSummary, draft: Record<string, string>) => {
    if (!draft.sourceElementId || !draft.targetElementId) {
      showToast('Choose a source and a target element type.', 'error');
      return false;
    }
    if (draft.sourceElementId === draft.targetElementId) {
      showToast('An element type cannot be related to itself.', 'error');
      return false;
    }
    try {
      await modelDefinitionsApi.updateSupportDomainRelationship(row.id, {
        id: row.id,
        // The model on screen when a row arrives without it.
        modelId: row.modelId || props.modelId,
        sourceElementId: draft.sourceElementId,
        targetElementId: draft.targetElementId,
        relationshipKind: draft.relationshipKind || row.relationshipKind,
        notes: draft.notes ?? '',
        status: draft.status || row.status,
      });
      await props.onRefresh();
      showToast('Relationship updated.');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update relationship.', 'error');
      return false;
    }
  };

  const name = (id: string) => {
    const element = byId.get(id);
    return element ? displayLabel(element) : id;
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Element Types ({props.elements.length})
        </Typography>
        <InlineEditTable
          rows={props.elements}
          columns={elementColumns}
          getId={(row) => row.id}
          getLabel={(row) => displayLabel(row)}
          draftOf={(row) => ({ name: row.name, displayName: row.displayName, description: row.description, status: row.status })}
          onSave={saveElement}
          onDuplicate={(row) => void duplicateElement(row)}
          onDelete={(row) => props.onDeleteElement(row.id)}
          selectedId={props.selectedElementId}
          onRowClick={(row) => props.onSelectElement(row.id)}
          onRowContextMenu={props.onTypeContextMenu ? (row, event) => props.onTypeContextMenu!(row.id, displayLabel(row), event) : undefined}
          emptyText="This model has no element types yet. Use + Element to add one."
          searchPlaceholder="Search element types…"
        />
      </Box>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Relationships ({props.relationships.length})
        </Typography>
        <InlineEditTable
          rows={props.relationships}
          getId={(row) => row.id}
          getLabel={(row) => `${name(row.sourceElementId)} → ${name(row.targetElementId)}`}
          draftOf={(row) => ({
            sourceElementId: row.sourceElementId,
            targetElementId: row.targetElementId,
            relationshipKind: row.relationshipKind,
            notes: row.notes,
            status: row.status,
          })}
          onSave={saveRelationship}
          onDuplicate={props.onDuplicateRelationship}
          onDelete={(row) => props.onDeleteRelationship(row.id)}
          onRowClick={(row) => props.onSelectElement(row.sourceElementId)}
          columns={[
            { key: 'source', label: 'Source', render: (row) => name(row.sourceElementId), editor: { field: 'sourceElementId', type: 'select', options: elementOptions } },
            {
              key: 'kind',
              label: 'Relationship',
              width: 170,
              filter: true,
              render: (row) => <Chip size="small" label={kindLabel(row.relationshipKind)} sx={{ height: 20, fontSize: 11 }} />,
              editor: { field: 'relationshipKind', type: 'select', options: kindOptions },
            },
            { key: 'target', label: 'Target', render: (row) => name(row.targetElementId), editor: { field: 'targetElementId', type: 'select', options: elementOptions } },
            { key: 'notes', label: 'Notes', render: (row) => row.notes || '—', editor: { field: 'notes' } },
            {
              key: 'status',
              label: 'Status',
              width: 120,
              filter: true,
              render: (row) => <Chip size="small" variant="outlined" label={statusLabel(row.status)} sx={{ height: 20, fontSize: 11 }} />,
              editor: { field: 'status', type: 'select', options: props.lifecycleStatuses },
            },
          ]}
          emptyText="No relationships yet. Use + Relationship to add one."
          searchPlaceholder="Search relationships…"
        />
      </Box>
    </Stack>
  );
}
