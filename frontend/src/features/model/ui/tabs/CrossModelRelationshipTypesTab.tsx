import { Box, Button, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AddIcon from '@mui/icons-material/Add';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import ListOutlinedIcon from '@mui/icons-material/ListOutlined';
import SchemaOutlinedIcon from '@mui/icons-material/SchemaOutlined';
import type {
  CrossModelRelationshipTypeDraft,
  CrossModelRelationshipTypeSummary,
  CrossModelTypeOptions,
  HierarchyRuleSummary,
  MetadataOption,
  SupportDomainRelationshipSummary,
} from '../../domain/types';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import { CreateEditCrossModelRelationshipTypeDialog } from '../dialogs/CreateEditCrossModelRelationshipTypeDialog';
import { DeleteCrossModelRelationshipTypeDialog } from '../dialogs/DeleteCrossModelRelationshipTypeDialog';
import { CrossModelRelationshipTypesTable } from '../tables/CrossModelRelationshipTypesTable';
import { GovernanceTypesMatrixView } from '../governance/GovernanceTypesMatrixView';
import { GovernanceTypesDiagramView } from '../governance/GovernanceTypesDiagramView';

const EMPTY_TYPE_OPTIONS: CrossModelTypeOptions = { nodeTypes: [], elementTypes: [] };
const EMPTY_HIERARCHY_RULES: HierarchyRuleSummary[] = [];
const EMPTY_SUPPORT_DOMAIN_RELATIONSHIPS: SupportDomainRelationshipSummary[] = [];
type InnerTab = 'matrix' | 'diagram' | 'list';

export function CrossModelRelationshipTypesTab(props: {
  rows: CrossModelRelationshipTypeSummary[];
  draft: CrossModelRelationshipTypeDraft;
  lifecycleStatuses: MetadataOption[];
  validation: Record<string, string>;
  saving: boolean;
  onChange: (patch: Partial<CrossModelRelationshipTypeDraft>) => void;
  onSave: () => void;
  onSelectType: (id: string | null) => void;
  onDeleteById: (id: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [innerTab, setInnerTab] = useState<InnerTab>('matrix');
  const [constraintsLocked, setConstraintsLocked] = useState(false);
  const [deleteRelationshipTypeId, setDeleteRelationshipTypeId] = useState<string | null>(null);

  const typeOptionsQuery = useQuery({
    queryKey: ['cross-model-type-options'],
    queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions(),
  });
  const typeOptions = typeOptionsQuery.data ?? EMPTY_TYPE_OPTIONS;

  // The diagram is shared across all three relationship sources, so it needs the
  // relationships already set up inside the hierarchy and support domain models
  // alongside the governed cross-model types this tab manages. Only the diagram
  // draws them — the matrix and list views stay cross-model only.
  const hierarchyRulesQuery = useQuery({
    queryKey: ['all-hierarchy-rules'],
    queryFn: () => modelDefinitionsApi.listAllHierarchyRules(),
    enabled: innerTab === 'diagram',
  });
  const supportDomainRelationshipsQuery = useQuery({
    queryKey: ['all-support-domain-relationships'],
    queryFn: () => modelDefinitionsApi.listSupportDomainRelationshipsForMultipleModels(),
    enabled: innerTab === 'diagram',
  });

  const openAdd = () => {
    props.onSelectType(null);
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

  const openEdit = (id: string) => {
    props.onSelectType(id);
    setConstraintsLocked(false);
    setDialogOpen(true);
  };

  const handleSave = () => {
    props.onSave();
    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    setDeleteRelationshipTypeId(id);
    setDialogOpen(false);
  };

  return (
    <Box display="flex" flexDirection="column" flex={1} minHeight={0}>
      <CreateEditCrossModelRelationshipTypeDialog
        open={dialogOpen}
        draft={props.draft}
        typeOptions={typeOptions}
        lifecycleStatuses={props.lifecycleStatuses}
        validation={props.validation}
        saving={props.saving}
        constraintsLocked={constraintsLocked}
        onChange={props.onChange}
        onSave={handleSave}
        onDelete={props.draft.id ? () => handleDelete(props.draft.id!) : undefined}
        onClose={() => setDialogOpen(false)}
      />
      <DeleteCrossModelRelationshipTypeDialog
        relationshipTypeId={deleteRelationshipTypeId}
        deleting={props.saving}
        onConfirm={() => {
          if (deleteRelationshipTypeId) props.onDeleteById(deleteRelationshipTypeId);
          setDeleteRelationshipTypeId(null);
        }}
        onClose={() => setDeleteRelationshipTypeId(null)}
      />

      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ borderBottom: 1, borderColor: 'divider', mb: 1.5 }}>
        <Tabs value={innerTab} onChange={(_, v: InnerTab) => setInnerTab(v)} sx={{ minHeight: 36 }}>
          <Tab value="matrix"  label="Matrix View"  icon={<GridViewOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 36, py: 0.5, fontSize: 13 }} />
          <Tab value="diagram" label="Diagram View" icon={<SchemaOutlinedIcon sx={{ fontSize: 16 }} />}  iconPosition="start" sx={{ minHeight: 36, py: 0.5, fontSize: 13 }} />
          <Tab value="list"    label="List View"    icon={<ListOutlinedIcon sx={{ fontSize: 16 }} />}    iconPosition="start" sx={{ minHeight: 36, py: 0.5, fontSize: 13 }} />
        </Tabs>
      </Stack>

      {/* ── Matrix View ─────────────────────────────────────────────── */}
      {innerTab === 'matrix' && (
        <Box flex={1} minHeight={0} overflow="auto" px={0.5} pb={2}>
          {typeOptionsQuery.isLoading ? (
            <Typography color="text.disabled" sx={{ py: 4, textAlign: 'center' }}>Loading type options…</Typography>
          ) : (
            <GovernanceTypesMatrixView
              governedTypes={props.rows}
              typeOptions={typeOptions}
              models={[]}
              cellFilter="all"
              onSwap={() => undefined}
              onCreateForPair={openAddForPair}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          )}
        </Box>
      )}

      {/* ── Diagram View ────────────────────────────────────────────── */}
      {innerTab === 'diagram' && (
        <Box flex={1} minHeight={0} overflow="auto" px={0.5} pb={1}>
          <GovernanceTypesDiagramView
            crossModelRelationships={props.rows}
            hierarchyRuleRelationships={hierarchyRulesQuery.data ?? EMPTY_HIERARCHY_RULES}
            supportDomainRelationships={supportDomainRelationshipsQuery.data ?? EMPTY_SUPPORT_DOMAIN_RELATIONSHIPS}
            typeOptions={typeOptions}
            onEdit={openEdit}
            loading={
              typeOptionsQuery.isLoading
              || hierarchyRulesQuery.isLoading
              || supportDomainRelationshipsQuery.isLoading
            }
          />
        </Box>
      )}

      {/* ── List View ───────────────────────────────────────────────── */}
      {innerTab === 'list' && (
        <CrossModelRelationshipTypesTable
          rows={props.rows}
          onAdd={openAdd}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      )}
    </Box>
  );
}
