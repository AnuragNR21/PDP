import { PropertyList } from '@/shared/workspace/PropertyList';
import {
  AddOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type {
  BadgeCustomization,
  BadgeOptions,
  MetadataOption,
  SupportDomainPropertyDeleteImpact,
  SupportDomainElementPropertyData,
  SupportDomainElementPropertySummary,
  SupportDomainElementDraft,
  SupportDomainElementSummary,
} from '../../domain/types';
import { displayLabel, supportDomainBadgeFallbackText } from '../../domain/utils';
import { CreateEditSupportDomainElementTypePropertyDialog } from '../dialogs/CreateEditSupportDomainElementTypePropertyDialog';
import { BadgeCustomizationPanel } from '../shared/BadgeCustomizationPanel';
import { ReadOnlyIdField } from '../shared/ReadOnlyIdField';

const emptyPropertyData = (elementId: string, status: string): SupportDomainElementPropertyData => ({
  elementId,
  name: '',
  description: '',
  status,
});

export function SupportDomainElementDetailsPanel(props: {
  selectedElement: SupportDomainElementSummary | null;
  elementDraft: SupportDomainElementDraft;
  supportDomainElementProperties: SupportDomainElementPropertySummary[];
  lifecycleStatuses: MetadataOption[];
  badge: BadgeCustomization | null;
  badgeOptions: BadgeOptions | null;
  badgeSaving: boolean;
  /** The badge has unsaved changes (saved with the panel's Save). */
  badgeDirty?: boolean;
  validation: {
    supportDomainElement: Record<string, string>;
    supportDomainElementProperty: Record<string, string>;
  };
  saving: boolean;
  onChangeElement: (patch: Partial<SupportDomainElementDraft>) => void;
  onSaveElement: () => void;
  onDeleteElementById: (id: string) => void;
  updateSupportDomainElementPropertyData: (patch: Partial<SupportDomainElementPropertyData>) => void;
  saveSupportDomainElementProperty: (data?: SupportDomainElementPropertyData) => Promise<boolean>;
  deleteSupportDomainElementProperty: (id: string) => void;
  onBadgeChange: (patch: Partial<BadgeCustomization>) => void;
  onBadgeReset: () => void;
  /** Inside a workspace details section, which already carries the title. */
  embedded?: boolean;
}) {
  const [tab, setTab] = useState(0);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false);
  const [confirmPropertyDeleteOpen, setConfirmPropertyDeleteOpen] = useState(false);
  const [propertyDeleteImpactLoading, setPropertyDeleteImpactLoading] = useState(false);
  const [propertyDeleteImpactError, setPropertyDeleteImpactError] = useState<string | null>(null);
  const [propertyDeleteImpact, setPropertyDeleteImpact] = useState<SupportDomainPropertyDeleteImpact | null>(null);
  const [propertyData, setPropertyData] = useState<SupportDomainElementPropertyData>(
    emptyPropertyData('', props.lifecycleStatuses[0]?.key ?? 'draft'),
  );

  const defaultStatus = props.lifecycleStatuses[0]?.key ?? 'draft';
  const selectedProperty = useMemo(
    () => props.supportDomainElementProperties.find((item) => item.id === selectedPropertyId) ?? null,
    [props.supportDomainElementProperties, selectedPropertyId],
  );

  useEffect(() => {
    setTab(0);
    setSelectedPropertyId(null);
  }, [props.selectedElement?.id]);

  useEffect(() => {
    if (!confirmPropertyDeleteOpen || !selectedProperty || !props.selectedElement) return;

    setPropertyDeleteImpactLoading(true);
    setPropertyDeleteImpactError(null);
    setPropertyDeleteImpact(null);

    void modelDefinitionsApi
      .getSupportDomainElementPropertyDeleteImpact(
        props.selectedElement.modelId,
        props.selectedElement.id,
        selectedProperty.id,
      )
      .then((impact) => setPropertyDeleteImpact(impact))
      .catch(() => setPropertyDeleteImpactError('Could not load property delete impact. Please try again.'))
      .finally(() => setPropertyDeleteImpactLoading(false));
  }, [confirmPropertyDeleteOpen, props.selectedElement, selectedProperty]);

  const openAddProperty = () => {
    const data = emptyPropertyData(props.selectedElement?.id ?? '', defaultStatus);
    setPropertyData(data);
    props.updateSupportDomainElementPropertyData(data);
    setPropertyDialogOpen(true);
  };

  const openEditProperty = (id?: string) => {
    const target = id ? props.supportDomainElementProperties.find((item) => item.id === id) ?? null : selectedProperty;
    if (!target) return;
    const data = {
      id: target.id,
      elementId: target.elementId,
      name: target.name,
      description: target.description,
      status: target.status,
    };
    setPropertyData(data);
    props.updateSupportDomainElementPropertyData(data);
    setPropertyDialogOpen(true);
  };

  const changePropertyData = (patch: Partial<SupportDomainElementPropertyData>) => {
    setPropertyData((current) => {
      const next = { ...current, ...patch };
      props.updateSupportDomainElementPropertyData(next);
      return next;
    });
  };

  const saveProperty = async () => {
    props.updateSupportDomainElementPropertyData(propertyData);
    const saved = await props.saveSupportDomainElementProperty(propertyData);
    if (saved) {
      setPropertyDialogOpen(false);
    }
  };

  const confirmDeleteProperty = () => {
    if (!selectedProperty) return;
    props.deleteSupportDomainElementProperty(selectedProperty.id);
    setSelectedPropertyId(null);
    setConfirmPropertyDeleteOpen(false);
  };

  const statusLabel = (status: string) =>
    props.lifecycleStatuses.find((item) => item.key === status)?.label ?? status;

  return (
    <Card variant="outlined" sx={{ height: props.embedded ? '100%' : 550, display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', pb: '16px !important', ...(props.embedded ? { pt: 1 } : {}) }}>
        {!props.embedded && <Typography variant="h6" gutterBottom>Element Type Details</Typography>}
        {!props.selectedElement ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">Select an element from the list to view details.</Typography>
          </Box>
        ) : (
          <>
            <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 0, px: 1, textTransform: 'none', fontWeight: 600 } }}>
              <Tab label="General" value={0} />
              <Tab label="Properties" value={1} />
              <Tab label="Badge" value={2} />
            </Tabs>

            {tab === 0 && (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <TextField
                  fullWidth
                  label="Element type name"
                  value={props.elementDraft.name}
                  onChange={(event) => props.onChangeElement({ name: event.target.value })}
                  error={!!props.validation.supportDomainElement.name}
                  helperText={props.validation.supportDomainElement.name}
                />
                <TextField
                  fullWidth
                  label="Display Name"
                  value={props.elementDraft.displayName}
                  onChange={(event) => props.onChangeElement({ displayName: event.target.value })}
                />
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label="Description"
                  value={props.elementDraft.description}
                  onChange={(event) => props.onChangeElement({ description: event.target.value })}
                />
                <TextField
                  select
                  label="Status"
                  value={props.elementDraft.status}
                  onChange={(event) => props.onChangeElement({ status: event.target.value })}
                  error={!!props.validation.supportDomainElement.status}
                  helperText={props.validation.supportDomainElement.status}
                  sx={{ maxWidth: 280 }}
                >
                  {props.lifecycleStatuses.map((item) => (
                    <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
                  ))}
                </TextField>
                <ReadOnlyIdField label="Element Type ID" value={props.selectedElement.id} helperText="System identifier — the element_type_id used in import / export files." />
                {/* Embedded, Save / Cancel and Delete are the panel's toolbar actions. */}
                {!props.embedded && (
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={props.onSaveElement} disabled={props.saving}>Save Changes</Button>
                  <Button color="error" startIcon={<DeleteOutlined />} onClick={() => props.onDeleteElementById(props.selectedElement!.id)}>Delete</Button>
                </Stack>
                )}
              </Stack>
            )}

            {tab === 1 && (
              <Box sx={{ mt: 1.5, overflow: 'auto' }}>
                <PropertyList
                  items={props.supportDomainElementProperties.map((property) => ({
                    id: property.id,
                    name: property.name,
                    description: property.description,
                    chips: [{ label: statusLabel(property.status), color: property.status === 'active' ? 'success' as const : 'default' as const }],
                  }))}
                  onAdd={openAddProperty}
                  onEdit={(id) => { setSelectedPropertyId(id); openEditProperty(id); }}
                  onDelete={(id) => { setSelectedPropertyId(id); setConfirmPropertyDeleteOpen(true); }}
                  disabled={props.saving}
                  emptyText="No properties yet. Use + Property to add one."
                />
              </Box>
            )}
            {tab === 2 && (
              <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', mt: 2 }}>
                {!props.selectedElement ? (
                  <Typography variant="body2" color="text.secondary">
                    Select an element first.
                  </Typography>
                ) : props.badge && props.badgeOptions ? (
                  <BadgeCustomizationPanel
                    badge={props.badge}
                    options={props.badgeOptions}
                    saving={props.badgeSaving}
                    onChange={props.onBadgeChange}
                    dirty={props.badgeDirty}
                    onReset={props.onBadgeReset}
                    fallbackText={supportDomainBadgeFallbackText(displayLabel(props.elementDraft))}
                    docked
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">Loading badge options...</Typography>
                )}
              </Box>
            )}
          </>
        )}
      </CardContent>

      <CreateEditSupportDomainElementTypePropertyDialog
        open={propertyDialogOpen}
        propertyData={propertyData}
        lifecycleStatuses={props.lifecycleStatuses}
        validation={props.validation.supportDomainElementProperty}
        saving={props.saving}
        onChange={changePropertyData}
        onSave={saveProperty}
        onClose={() => setPropertyDialogOpen(false)}
      />

      <Dialog open={confirmPropertyDeleteOpen} onClose={() => setConfirmPropertyDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Property?</DialogTitle>
        <DialogContent>
          {propertyDeleteImpactLoading && (
            <Typography variant="body2" color="text.secondary">Loading impact preview...</Typography>
          )}
          {propertyDeleteImpactError && (
            <Alert severity="error">{propertyDeleteImpactError}</Alert>
          )}
          {!propertyDeleteImpactLoading && !propertyDeleteImpactError && propertyDeleteImpact && (
            <Alert severity="warning">
              Deleting "{propertyDeleteImpact.propertyName}" affects {propertyDeleteImpact.affectedInstanceCount} structure instance(s)
              for element type "{propertyDeleteImpact.elementName ?? props.selectedElement?.name ?? 'Unknown'}".
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmPropertyDeleteOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDeleteProperty} disabled={props.saving || propertyDeleteImpactLoading || !!propertyDeleteImpactError}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
