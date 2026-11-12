import AddOutlined from '@mui/icons-material/AddOutlined';
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import { Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { InlineEditTable } from '@/shared/workspace/InlineEditTable';
import { AuthoringPanel, WorkspaceBody, useStoredFlag } from '@/shared/workspace/WorkspacePanels';
import { SidePanel } from '@/shared/workspace/SidePanel';
import type { ProjectionView, WorkspaceModel } from '@/shared/workspace/workspaceModel';
import { useModelWorkspace } from '../../contexts/ModelWorkspaceContext';
import { useToast } from '@/shared/toast/ToastContext';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type {
  CrossModelRelationshipTypeDraft,
  CrossModelRelationshipTypeSummary,
  CrossModelTypeOptions,
  HierarchyRuleSummary,
  MetadataOption,
  SupportDomainRelationshipSummary,
} from '../../domain/types';
import { CreateEditCrossModelRelationshipTypeDialog } from '../dialogs/CreateEditCrossModelRelationshipTypeDialog';
import { DeleteCrossModelRelationshipTypeDialog } from '../dialogs/DeleteCrossModelRelationshipTypeDialog';
import { GovernanceTypesDiagramView } from '../governance/GovernanceTypesDiagramView';
import { GovernanceTypesMatrixView, MATRIX_CELL_FILTER_LABEL, type MatrixCellFilter } from '../governance/GovernanceTypesMatrixView';
import { useTypeDetailsSections } from './useTypeDetailsSections';
import { uniqueCopyName } from './HierarchyListView';

const EMPTY_TYPE_OPTIONS: CrossModelTypeOptions = { nodeTypes: [], elementTypes: [] };
const EMPTY_RULES: HierarchyRuleSummary[] = [];
const EMPTY_SD_RELATIONSHIPS: SupportDomainRelationshipSummary[] = [];

const MODEL_TYPE_LABEL: Record<string, string> = { HIERARCHY_MODEL: 'Hierarchy', SUPPORT_DOMAIN_MODEL: 'Support Domain' };

function endLabel(modelName: string | null, typeName: string | null, modelType: string) {
  if (!typeName) return `Any ${MODEL_TYPE_LABEL[modelType] ?? modelType} item`;
  return modelName ? `${modelName} › ${typeName}` : typeName;
}

/**
 * MWS › Relationship: the governed cross-model relationship types — what may
 * be related, within a model or across models. Matrix creates, edits and
 * deletes in the cells (no separate + Relationship there);
 * Diagram shows them with the relationships inside each model; List edits
 * them in place.
 */
export function MwsRelationshipWorkspace(props: {
  view: ProjectionView;
  /** Every model, with its status — the matrix selection lists and filters them. */
  models: WorkspaceModel[];
  rows: CrossModelRelationshipTypeSummary[];
  draft: CrossModelRelationshipTypeDraft;
  lifecycleStatuses: MetadataOption[];
  validation: Record<string, string>;
  saving: boolean;
  onChange: (patch: Partial<CrossModelRelationshipTypeDraft>) => void;
  onSave: () => void;
  onSelectType: (id: string | null) => void;
  onDeleteById: (id: string) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const { showToast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [constraintsLocked, setConstraintsLocked] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // The selection panel of the Matrix and Diagram views is drawn in the
  // workspace's left column, as Model Selection is on the Model tab.
  const [selectionSlot, setSelectionSlot] = useState<HTMLDivElement | null>(null);
  const [selectionCollapsed, setSelectionCollapsed] = useStoredFlag('pdp-mws-relationship-selection-collapsed', false);
  const showsSelection = props.view !== 'list';
  const [cellFilter, setCellFilter] = useState<MatrixCellFilter>('all');
  const { matrixTypeSelection, setMatrixSourceTypes, setMatrixTargetTypes, setDiagramCanvasItems } = useModelWorkspace();
  // Rows become columns and columns rows; the picked types are kept.
  const swapMatrix = () => {
    const { sourceTypes, targetTypes } = matrixTypeSelection;
    setMatrixSourceTypes(targetTypes);
    setMatrixTargetTypes(sourceTypes);
  };

  const typeOptionsQuery = useQuery({ queryKey: ['cross-model-type-options'], queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions() });
  const typeOptions = typeOptionsQuery.data ?? EMPTY_TYPE_OPTIONS;
  const hierarchyRulesQuery = useQuery({
    queryKey: ['all-hierarchy-rules'],
    queryFn: () => modelDefinitionsApi.listAllHierarchyRules(),
    enabled: props.view === 'diagram',
  });
  const sdRelationshipsQuery = useQuery({
    queryKey: ['all-support-domain-relationships'],
    queryFn: () => modelDefinitionsApi.listSupportDomainRelationshipsForMultipleModels(),
    enabled: props.view === 'diagram',
  });

  const allItems = useMemo(() => [...typeOptions.nodeTypes, ...typeOptions.elementTypes], [typeOptions]);
  const selectedItem = allItems.find((item) => item.id === selectedItemId) ?? null;
  // The standard Node Type / Element Type Details and Relationship Details panels.
  const details = useTypeDetailsSections({
    item: props.view === 'diagram' ? selectedItem : null,
    crossTypes: props.rows,
    onSelectType: setSelectedItemId,
    onCreated: (type) => {
      setDiagramCanvasItems((prev) =>
        prev.some((i) => i.id === type.id)
          ? prev
          : [...prev, { id: type.id, name: type.name, modelName: type.modelName, kind: type.kind === 'HIERARCHY_MODEL' ? 'HIERARCHY_NODE' : 'SUPPORT_DOMAIN_ELEMENT' }],
      );
      setSelectedItemId(type.id);
    },
    onDeleted: (id) => setDiagramCanvasItems((prev) => prev.filter((i) => i.id !== id)),
  });

  const openAdd = () => {
    props.onSelectType(null);
    setConstraintsLocked(false);
    setDialogOpen(true);
  };
  const openEdit = (id: string) => {
    props.onSelectType(id);
    setConstraintsLocked(false);
    setDialogOpen(true);
  };
  const openAddForPair = (sourceModelType: string, sourceModelItemTypeId: string | null, targetModelType: string, targetModelItemTypeId: string | null) => {
    props.onSelectType(null);
    props.onChange({
      sourceModelType: sourceModelType as CrossModelRelationshipTypeDraft['sourceModelType'],
      sourceModelItemTypeId,
      targetModelType: targetModelType as CrossModelRelationshipTypeDraft['targetModelType'],
      targetModelItemTypeId,
    });
    setConstraintsLocked(true);
    setDialogOpen(true);
  };
  const openDuplicate = (row: CrossModelRelationshipTypeSummary) => {
    props.onSelectType(null);
    props.onChange({
      name: uniqueCopyName(row.name, props.rows.map((item) => item.name)),
      description: row.description ?? '',
      sourceModelType: row.sourceModelType,
      sourceModelItemTypeId: row.sourceModelItemTypeId,
      targetModelType: row.targetModelType,
      targetModelItemTypeId: row.targetModelItemTypeId,
      status: row.status,
    });
    setConstraintsLocked(false);
    setDialogOpen(true);
  };

  const saveInline = async (row: CrossModelRelationshipTypeSummary, draft: Record<string, string>) => {
    if (!draft.name?.trim()) {
      showToast('A relationship type needs a name.', 'error');
      return false;
    }
    try {
      await modelDefinitionsApi.updateCrossModelRelationshipType(row.id, {
        id: row.id,
        name: draft.name.trim(),
        description: draft.description ?? '',
        sourceModelType: row.sourceModelType,
        sourceModelItemTypeId: row.sourceModelItemTypeId,
        targetModelType: row.targetModelType,
        targetModelItemTypeId: row.targetModelItemTypeId,
        status: draft.status || row.status,
      });
      await props.onRefresh();
      showToast('Relationship type updated.');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update relationship type.', 'error');
      return false;
    }
  };

  const addButton = (
    <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={openAdd}>
      Relationship
    </Button>
  );

  let authoring;
  if (props.view === 'matrix') {
    authoring = (
      <AuthoringPanel
        title="Relationship – Matrix Workspace"
        hint="Click a Source × Target cell to create, edit or delete the relationships between that pair."
        toolbar={
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select
              size="small"
              value={cellFilter}
              onChange={(event) => setCellFilter(event.target.value as MatrixCellFilter)}
              aria-label="Matrix cell filter"
              sx={{ minWidth: 220, '& .MuiInputBase-root': { fontSize: 13, height: 32 } }}
            >
              {(Object.keys(MATRIX_CELL_FILTER_LABEL) as MatrixCellFilter[]).map((key) => (
                <MenuItem key={key} value={key} sx={{ fontSize: 13 }}>
                  {MATRIX_CELL_FILTER_LABEL[key]}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SwapHorizOutlined />}
              onClick={swapMatrix}
              disabled={matrixTypeSelection.sourceTypes.length === 0 && matrixTypeSelection.targetTypes.length === 0}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Swap Source / Target
            </Button>
          </Stack>
        }
        flush
      >
        <Box sx={{ p: 1, flex: 1, minHeight: 0, overflow: 'auto' }}>
          {typeOptionsQuery.isLoading ? (
            <Typography color="text.disabled" sx={{ py: 4, textAlign: 'center' }}>Loading type options…</Typography>
          ) : (
            <GovernanceTypesMatrixView
              governedTypes={props.rows}
              typeOptions={typeOptions}
              models={props.models}
              cellFilter={cellFilter}
              onSwap={swapMatrix}
              onCreateForPair={openAddForPair}
              onEdit={openEdit}
              onDelete={setDeleteId}
              selectionSlot={showsSelection ? selectionSlot : undefined}
            />
          )}
        </Box>
      </AuthoringPanel>
    );
  } else if (props.view === 'diagram') {
    authoring = (
      <AuthoringPanel title="Relationship – Diagram Workspace" hint="Drag from a type's connector to another type to create a relationship; click a relationship to edit it." toolbar={addButton} flush>
        <Box sx={{ p: 1, flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <GovernanceTypesDiagramView
            onCreateForPair={openAddForPair}
            crossModelRelationships={props.rows}
            hierarchyRuleRelationships={hierarchyRulesQuery.data ?? EMPTY_RULES}
            supportDomainRelationships={sdRelationshipsQuery.data ?? EMPTY_SD_RELATIONSHIPS}
            typeOptions={typeOptions}
            onEdit={openEdit}
            onSelectItem={(id) => details.guard(() => setSelectedItemId(id))}
            selectionSlot={selectionSlot}
            models={props.models}
            onRefresh={() => void props.onRefresh()}
            loading={typeOptionsQuery.isLoading || hierarchyRulesQuery.isLoading || sdRelationshipsQuery.isLoading}
          />
        </Box>
      </AuthoringPanel>
    );
  } else {
    authoring = (
      <AuthoringPanel title="Relationship – List Workspace" hint="Every governed relationship type." toolbar={addButton} flush>
        <InlineEditTable
          rows={props.rows}
          getId={(row) => row.id}
          getLabel={(row) => row.name}
          draftOf={(row) => ({ name: row.name, description: row.description ?? '', status: row.status })}
          onSave={saveInline}
          onDuplicate={openDuplicate}
          onDelete={(row) => setDeleteId(row.id)}
          emptyText="No governed relationship types yet. Use + Relationship to add one."
          searchPlaceholder="Search relationship types…"
          columns={[
            { key: 'name', label: 'Relationship', render: (row) => <Typography variant="body2" fontWeight={600}>{row.name}</Typography>, editor: { field: 'name' } },
            { key: 'source', label: 'Source', render: (row) => endLabel(row.sourceModelName, row.sourceTypeName, row.sourceModelType), value: (row) => [row.sourceModelName, row.sourceTypeName].filter(Boolean).join(' › ') || row.sourceModelType },
            { key: 'target', label: 'Target', render: (row) => endLabel(row.targetModelName, row.targetTypeName, row.targetModelType), value: (row) => [row.targetModelName, row.targetTypeName].filter(Boolean).join(' › ') || row.targetModelType },
            { key: 'description', label: 'Description', render: (row) => row.description || '—', editor: { field: 'description' } },
            {
              key: 'status',
              label: 'Status',
              width: 120,
              filter: true,
              render: (row) => <Chip size="small" variant="outlined" label={lifecycleLabel(row.status)} sx={{ height: 20, fontSize: 11 }} />,
              editor: { field: 'status', type: 'select', options: props.lifecycleStatuses },
            },
          ]}
        />
      </AuthoringPanel>
    );
  }

  return (
    <>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 1 }}>
        {showsSelection && (
          <SidePanel title="Item Selection" collapsed={selectionCollapsed} onToggle={() => setSelectionCollapsed(!selectionCollapsed)} width={340}>
            <Box ref={setSelectionSlot} sx={{ display: 'flex', minHeight: 0, pb: 1, '& > *': { flex: 1, minHeight: 0 }, '& > .MuiPaper-root': { border: 'none', boxShadow: 'none' } }} />
          </SidePanel>
        )}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WorkspaceBody
        storageKey={`mws-relationship-${props.view}`}
        authoring={authoring}
        element={props.view === 'diagram' ? details.element : undefined}
        relationship={props.view === 'diagram' ? details.relationship : undefined}
      />
        </Box>
      </Box>
      {details.dialogs}
      <CreateEditCrossModelRelationshipTypeDialog
        open={dialogOpen}
        draft={props.draft}
        typeOptions={typeOptions}
        lifecycleStatuses={props.lifecycleStatuses}
        validation={props.validation}
        saving={props.saving}
        constraintsLocked={constraintsLocked}
        onChange={props.onChange}
        onSave={() => {
          props.onSave();
          setDialogOpen(false);
        }}
        onDelete={props.draft.id ? () => { setDeleteId(props.draft.id!); setDialogOpen(false); } : undefined}
        onClose={() => setDialogOpen(false)}
      />
      <DeleteCrossModelRelationshipTypeDialog
        relationshipTypeId={deleteId}
        deleting={props.saving}
        onConfirm={() => {
          if (deleteId) props.onDeleteById(deleteId);
          setDeleteId(null);
        }}
        onClose={() => setDeleteId(null)}
      />
    </>
  );
}
