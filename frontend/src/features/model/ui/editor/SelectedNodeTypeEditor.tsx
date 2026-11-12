import { PropertyList } from '@/shared/workspace/PropertyList';
import { AddOutlined, DeleteOutlined, EditOutlined, HelpOutlineOutlined } from '@mui/icons-material';
import { Alert, Box, Button, Card, CardContent, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, List, ListItem, ListItemText, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type { BadgeCustomization, BadgeOptions, MetadataOption, HierarchyNodeDraft, HierarchyNodeTypePropertyFormData, HierarchyNodeTypePropertySummary, HierarchyPropertyDeleteImpact, RecursiveDisableImpact } from '../../domain/types';
import { displayLabel, hierarchyBadgeFallbackText } from '../../domain/utils';
import { CreateEditNodeTypePropertyDialog } from '../dialogs/CreateEditNodeTypePropertyDialog';
import { DeleteNodeTypeDialog } from '../dialogs/DeleteNodeTypeDialog';
import { BadgeCustomizationPanel } from '../shared/BadgeCustomizationPanel';
import { ReadOnlyIdField } from '../shared/ReadOnlyIdField';

const pickFirst = (items: { key: string }[], fallback = '') => items[0]?.key ?? fallback;

export function SelectedNodeTypeEditor(props: {
  draft: HierarchyNodeDraft;
  properties: HierarchyNodeTypePropertySummary[];
  propertyFormData: HierarchyNodeTypePropertyFormData;
  lifecycleStatuses: MetadataOption[];
  badge: BadgeCustomization | null;
  badgeOptions: BadgeOptions | null;
  badgeSaving: boolean;
  /** The badge has unsaved changes (saved with the panel's Save). */
  badgeDirty?: boolean;
  validation: {
    hierarchyNode: Record<string, string>;
    hierarchyNodeProperty: Record<string, string>;
  };
  saving: boolean;
  onChange: (patch: Partial<HierarchyNodeDraft>) => void;
  onChangeProperty: (patch: Partial<HierarchyNodeTypePropertyFormData>) => void;
  onSave: (options?: { confirmRecursiveRemoval?: boolean }) => Promise<void>;
  onSaveProperty: (formData?: HierarchyNodeTypePropertyFormData) => Promise<boolean>;
  onDeleteProperty: (id: string) => void;
  onDelete?: () => void;
  persistedIsRecursive?: boolean;
  /**
   * Whether this node type already has child types.
   *
   * Passed in rather than derived here: the editor is given one node type,
   * and the parent is the only thing holding the tree.
   */
  hasChildren?: boolean;
  onBadgeChange: (patch: Partial<BadgeCustomization>) => void;
  onBadgeReset: () => void;
  /** Inside a workspace details section, which already carries the title. */
  embedded?: boolean;
  /**
   * Embedded in the workspace, Save lives in the panel's toolbar. The toolbar
   * calls this, so a save from there still goes through the recursive-removal
   * impact check below.
   */
   saveRef?: { current: (() => Promise<void>) | null };
}) {
  const {
    draft,
    properties,
    propertyFormData,
    lifecycleStatuses,
    badge,
    badgeOptions,
    badgeSaving,
    badgeDirty,
    validation,
    saving,
    onChange,
    onChangeProperty,
    onSave,
    onSaveProperty,
    onDeleteProperty,
    onDelete,
    onBadgeChange,
    onBadgeReset,
  } = props;
  const isRoot = draft.id !== undefined && draft.parentNodeId === null;
  // A type that already has children cannot become a property: a property
  // holds a value, not a level. The backend refuses it too — this only says
  // so before the save has to.
  const hasChildren = props.hasChildren ?? false;
  const nodeNameRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState('general');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [localPropertyFormData, setLocalPropertyFormData] = useState<HierarchyNodeTypePropertyFormData>(propertyFormData);
  const [confirmPropertyDeleteOpen, setConfirmPropertyDeleteOpen] = useState(false);
  const [propertyDeleteImpactLoading, setPropertyDeleteImpactLoading] = useState(false);
  const [propertyDeleteImpactError, setPropertyDeleteImpactError] = useState<string | null>(null);
  const [propertyDeleteImpact, setPropertyDeleteImpact] = useState<HierarchyPropertyDeleteImpact | null>(null);
  const [recursiveImpactDialogOpen, setRecursiveImpactDialogOpen] = useState(false);
  const [recursiveImpactLoading, setRecursiveImpactLoading] = useState(false);
  const [recursiveImpactError, setRecursiveImpactError] = useState<string | null>(null);
  const [recursiveImpact, setRecursiveImpact] = useState<RecursiveDisableImpact | null>(null);

  useEffect(() => {
    if (!draft.id) {
      nodeNameRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    setActiveTab('general');
    setSelectedPropertyId(null);
    setRecursiveImpactDialogOpen(false);
    setRecursiveImpactError(null);
    setRecursiveImpact(null);
  }, [draft.id]);

  useEffect(() => {
    setSelectedPropertyId((current) => (current && properties.some((row) => row.id === current) ? current : null));
  }, [properties]);

  useEffect(() => {
    if (!confirmPropertyDeleteOpen || !draft.id || !selectedPropertyId) return;

    setPropertyDeleteImpactLoading(true);
    setPropertyDeleteImpactError(null);
    setPropertyDeleteImpact(null);

    void modelDefinitionsApi
      .getHierarchyNodeTypePropertyDeleteImpact(draft.modelId, draft.id, selectedPropertyId)
      .then((impact) => setPropertyDeleteImpact(impact))
      .catch(() => setPropertyDeleteImpactError('Could not load property delete impact. Please try again.'))
      .finally(() => setPropertyDeleteImpactLoading(false));
  }, [confirmPropertyDeleteOpen, draft.id, draft.modelId, selectedPropertyId]);

  useEffect(() => {
    setLocalPropertyFormData(propertyFormData);
  }, [propertyFormData]);

  const handleDeleteConfirm = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const openAddProperty = () => {
    if (!draft.id) return;
    const next = {
      nodeTypeId: draft.id,
      name: '',
      description: '',
      inheritable: false,
      status: pickFirst(lifecycleStatuses, 'draft'),
    };
    setLocalPropertyFormData(next);
    onChangeProperty(next);
    setPropertyDialogOpen(true);
  };

  const openEditProperty = (id: string | null = selectedPropertyId) => {
    const property = properties.find((item) => item.id === id);
    if (!property) return;
    const next = {
      id: property.id,
      nodeTypeId: property.nodeTypeId,
      name: property.name,
      description: property.description,
      inheritable: property.inheritable,
      status: property.status,
    };
    setLocalPropertyFormData(next);
    onChangeProperty(next);
    setPropertyDialogOpen(true);
  };

  const handleSaveProperty = async () => {
    onChangeProperty(localPropertyFormData);
    const saved = await onSaveProperty(localPropertyFormData);
    if (saved) {
      setSelectedPropertyId(localPropertyFormData.id ?? null);
      setPropertyDialogOpen(false);
    }
  };

  const handleDeleteProperty = async (propertyId = selectedPropertyId) => {
    if (!propertyId) return;
    onDeleteProperty(propertyId);
    setSelectedPropertyId(null);
    setConfirmPropertyDeleteOpen(false);
  };

  const saveNodeType = async () => {
    const isRecursiveDisable = !!draft.id && props.persistedIsRecursive === true && draft.isRecursive === false;
    if (!isRecursiveDisable || !draft.id) {
      await onSave();
      return;
    }

    setRecursiveImpactLoading(true);
    setRecursiveImpactError(null);
    try {
      const impact = await modelDefinitionsApi.getHierarchyNodeTypeRecursiveDisableImpact(draft.id);
      setRecursiveImpact(impact);
      if (impact.affectedInstanceCount > 0) {
        setRecursiveImpactDialogOpen(true);
        return;
      }
      await onSave();
    } catch {
      setRecursiveImpactError('Failed to evaluate recursive impact. Please try again.');
      setRecursiveImpactDialogOpen(true);
    } finally {
      setRecursiveImpactLoading(false);
    }
  };

  if (props.saveRef) props.saveRef.current = saveNodeType;

  const confirmRecursiveDisable = async () => {
    await onSave({ confirmRecursiveRemoval: true });
    setRecursiveImpactDialogOpen(false);
  };

  const cancelRecursiveDisable = () => {
    setRecursiveImpactDialogOpen(false);
    if (props.persistedIsRecursive === true && draft.isRecursive === false) {
      onChange({ isRecursive: true });
    }
  };

  return (
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column', ...(props.embedded ? { height: '100%' } : {}) }}>
      <CardContent sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', pb: '16px !important', ...(props.embedded ? { pt: 1 } : {}) }}>
        <Stack spacing={2} sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={props.embedded && !isRoot ? { display: 'none' } : undefined}>
            {!props.embedded && <Typography variant="h6">Node Type Details</Typography>}
            {isRoot && (
              <Tooltip title="This is the root node type. Its name is synced with the model name.">
                <Box
                  component="span"
                  sx={{
                    px: 1,
                    py: 0.2,
                    borderRadius: 1,
                    fontSize: 11,
                    fontWeight: 700,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                  }}
                >
                  ROOT
                </Box>
              </Tooltip>
            )}
          </Stack>
          <Tabs value={activeTab} onChange={(_event, value) => setActiveTab(value)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 0, px: 1, textTransform: 'none', fontWeight: 600 } }}>
            <Tab label="General" value="general" />
            <Tab label="Properties" value="properties" />
            <Tab label="Badge" value="badge" />
          </Tabs>

          {activeTab === 'general' && (
            <>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12 }}>
                  <Tooltip title={isRoot ? 'The root node name is always kept in sync with the model name. Rename the model to change it.' : ''} placement="top-start">
                    <TextField fullWidth label="Node name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} error={!!validation.hierarchyNode.name} helperText={validation.hierarchyNode.name} inputRef={nodeNameRef} disabled={isRoot} />
                  </Tooltip>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Tooltip title={isRoot ? 'The root node display name is always kept in sync with the model name. Rename the model to change it.' : ''} placement="top-start">
                    <TextField fullWidth label="Display Name" value={draft.displayName} onChange={(e) => onChange({ displayName: e.target.value })} error={!!validation.hierarchyNode.displayName} helperText={validation.hierarchyNode.displayName} disabled={isRoot} />
                  </Tooltip>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField fullWidth multiline minRows={3} label="Description" value={draft.description} onChange={(e) => onChange({ description: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField fullWidth select label="Status" value={draft.status} onChange={(e) => onChange({ status: e.target.value })} error={!!validation.hierarchyNode.status} helperText={validation.hierarchyNode.status}>
                    {lifecycleStatuses.map((item) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={draft.isRecursive}
                          onChange={(e) => onChange({ isRecursive: e.target.checked })}
                          disabled={isRoot || draft.isProperty}
                        />
                      }
                      label="Is recursive"
                    />
                    {/* A property is a leaf by definition, so it cannot also
                        nest inside itself. Both boxes ticked is not a state
                        worth allowing, and disabling says so before the save
                        has to. */}
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={draft.isProperty}
                            onChange={(e) =>
                              onChange(
                                e.target.checked
                                  ? { isProperty: true, isRecursive: false }
                                  : { isProperty: false },
                              )
                            }
                            disabled={isRoot || hasChildren}
                          />
                        }
                        label="Is property node"
                        sx={{ mr: 0 }}
                      />
                      <Tooltip
                        title={
                          isRoot
                            ? "The root node type is the top of the hierarchy, so it cannot be a property."
                            : hasChildren
                              ? "This node type already has child types. Remove or re-parent them first — a property holds a value rather than a level."
                              : "A property node holds a value rather than a level of the hierarchy: Material with Steel, Wood and Concrete beneath it is a level; Install Date is a property. Nothing can be added under a property node, so + Child disappears for it here and in the Structure Workspace."
                        }
                      >
                        <HelpOutlineOutlined sx={{ fontSize: 17, color: "text.disabled", cursor: "help" }} />
                      </Tooltip>
                    </Stack>
                  </Stack>
                  {draft.isProperty && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      Nothing can be placed beneath this type. + Child is hidden for it
                      in the tree, and instances of it cannot take child nodes.
                    </Typography>
                  )}
                </Grid>
                {draft.id && (
                  <Grid size={{ xs: 12 }}>
                    <ReadOnlyIdField label="Node Type ID" value={draft.id} helperText="System identifier — the node_type_id used in import / export files." />
                  </Grid>
                )}
              </Grid>
              {/* Embedded, Save / Cancel and Delete are the panel's toolbar actions. */}
              {!props.embedded && (
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => void saveNodeType()} disabled={saving || recursiveImpactLoading}>Save Changes</Button>
                {onDelete && draft.id && !isRoot ? (
                  <Button color="error" onClick={() => setDeleteDialogOpen(true)}>Delete Node Type</Button>
                ) : null}
                {isRoot && (
                  <Tooltip title="The root node type cannot be deleted.">
                    <span>
                      <Button color="error" disabled>Delete Node Type</Button>
                    </span>
                  </Tooltip>
                )}
              </Stack>
              )}
            </>
          )}

          {activeTab === 'properties' && (
            <PropertyList
              items={properties.map((property) => ({
                id: property.id,
                name: property.name,
                description: property.description,
                chips: [
                  { label: lifecycleStatuses.find((item) => item.key === property.status)?.label ?? property.status, color: property.status === 'active' ? 'success' as const : 'default' as const },
                  ...(property.inheritable ? [{ label: 'Inheritable', color: 'info' as const }] : []),
                ],
              }))}
              onAdd={openAddProperty}
              onEdit={(id) => { setSelectedPropertyId(id); openEditProperty(id); }}
              onDelete={(id) => { setSelectedPropertyId(id); setConfirmPropertyDeleteOpen(true); }}
              addDisabled={!draft.id}
              disabled={saving}
              emptyText={draft.id ? 'No properties yet. Use + Property to add one.' : 'Save the node type before adding properties.'}
            />
          )}
          {activeTab === 'badge' && (
            <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', mt: 2 }}>
              {!draft.id ? (
                <Typography variant="body2" color="text.secondary">
                  Save the node type first before customising its badge.
                </Typography>
              ) : badge && badgeOptions ? (
                <BadgeCustomizationPanel
                  badge={badge}
                  options={badgeOptions}
                  saving={badgeSaving}
                  onChange={onBadgeChange}
                  dirty={badgeDirty}
                  onReset={onBadgeReset}
                  fallbackText={hierarchyBadgeFallbackText(displayLabel(draft))}
                  docked
                />
              ) : (
                <Typography variant="body2" color="text.secondary">Loading badge options...</Typography>
              )}
            </Box>
          )}
        </Stack>
      </CardContent>

      <CreateEditNodeTypePropertyDialog
        open={propertyDialogOpen}
        formData={localPropertyFormData}
        lifecycleStatuses={lifecycleStatuses}
        validation={validation.hierarchyNodeProperty}
        saving={saving}
        onChange={(patch) => {
          setLocalPropertyFormData((current) => {
            const next = { ...current, ...patch };
            onChangeProperty(next);
            return next;
          });
        }}
        onSave={handleSaveProperty}
        onDelete={localPropertyFormData.id ? () => handleDeleteProperty(localPropertyFormData.id) : undefined}
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
            <Stack spacing={1}>
              <Alert severity="warning">
                Deleting "{propertyDeleteImpact.propertyName}" affects {propertyDeleteImpact.affectedNodeTypeCount} node type(s)
                and {propertyDeleteImpact.affectedInstanceCount} structure instance(s).
              </Alert>
              <Typography variant="body2" color="text.secondary">
                Inheritance: {propertyDeleteImpact.inheritable ? 'Enabled (all descendants)' : 'Disabled'}
              </Typography>
              {propertyDeleteImpact.affectedNodeTypes.length > 0 && (
                <List dense disablePadding>
                  {propertyDeleteImpact.affectedNodeTypes.map((row) => (
                    <ListItem key={row.nodeTypeId} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText
                        primary={`${row.nodeTypeName} (${row.depth === 0 ? 'direct' : `depth ${row.depth}`})`}
                        secondary={`${row.instanceCount} instance(s)`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmPropertyDeleteOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void handleDeleteProperty()} disabled={saving || propertyDeleteImpactLoading || !!propertyDeleteImpactError}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={recursiveImpactDialogOpen} onClose={cancelRecursiveDisable} maxWidth="md" fullWidth>
        <DialogTitle>Remove Recursive Relationship?</DialogTitle>
        <DialogContent>
          {recursiveImpactError ? (
            <Alert severity="error">{recursiveImpactError}</Alert>
          ) : (
            <Stack spacing={2}>
              <Alert severity="warning">
                Removing recursion from Node Type "{recursiveImpact?.nodeName ?? draft.name}" in model "{recursiveImpact?.modelName ?? 'Unknown model'}"
                will remove existing recursive Structure Workspace instances and relationships.
              </Alert>
              <Typography variant="body2" color="text.secondary">
                Affected recursive relationships: {recursiveImpact?.affectedRelationshipCount ?? 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Affected recursive instances: {recursiveImpact?.affectedInstanceCount ?? 0}
              </Typography>
              {(recursiveImpact?.affectedInstancePaths?.length ?? 0) > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Affected instance paths
                  </Typography>
                  <List dense disablePadding>
                    {recursiveImpact?.affectedInstancePaths.map((path) => (
                      <ListItem key={path} disableGutters sx={{ py: 0.25 }}>
                        <ListItemText primary={path} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelRecursiveDisable} disabled={saving}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!!recursiveImpactError || saving}
            onClick={() => void confirmRecursiveDisable()}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Confirm Removal
          </Button>
        </DialogActions>
      </Dialog>

      {draft.id && (
        <DeleteNodeTypeDialog
          nodeId={deleteDialogOpen ? draft.id : null}
          nodeName={draft.name}
          deleting={deleting}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteDialogOpen(false)}
        />
      )}
    </Card>
  );
}
