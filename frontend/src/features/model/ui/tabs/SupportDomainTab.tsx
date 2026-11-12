import { Box, Button, Card, CardContent, Chip, Grid, IconButton, Stack, Tab, Tabs, Typography } from '@mui/material';
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import { AccountTreeOutlined, DeleteOutlined, EditOutlined, ViewListOutlined } from '@mui/icons-material';
import { useEffect, useState } from 'react';
import { HorizontalResizablePanels } from '../../../../shared/components/HorizontalResizablePanels';
import { ResizablePanelsStorageKey } from '../../../../shared/constants/ResizablePanelsStorageKeys';
import { CreateEditSupportDomainElementDialog } from '../dialogs/CreateEditSupportDomainElementDialog';
import { CreateEditSupportDomainRelationshipDialog } from '../dialogs/CreateEditSupportDomainRelationshipDialog';
import { DeleteSupportDomainDialog } from '../dialogs/DeleteSupportDomainDialog';
import { SupportDomainElementDetailsPanel } from './SupportDomainElementDetailsPanel';
import { SupportDomainDiagram } from '../diagram/SupportDomainDiagram';
import { useBadgeCustomization } from '../../state/useBadgeCustomization';
import type {
  MetadataOption,
  SupportDomainElementPropertyData,
  SupportDomainElementPropertySummary,
  SupportDomainElementDraft,
  SupportDomainElementSummary,
  SupportDomainRelationshipDraft,
  SupportDomainRelationshipSummary,
} from '../../domain/types';
import { displayLabel } from '../../domain/utils';

export function SupportDomainTab(props: {
  modelId: string;
  modelName: string;
  elementDraft: SupportDomainElementDraft;
  relationshipDraft: SupportDomainRelationshipDraft;
  elements: SupportDomainElementSummary[];
  relationships: SupportDomainRelationshipSummary[];
  supportDomainElementProperties: SupportDomainElementPropertySummary[];
  lifecycleStatuses: MetadataOption[];
  relationshipKinds: MetadataOption[];
  selectedElementId: string | null;
  selectedRelationshipId: string | null;
  validation: {
    supportDomainElement: Record<string, string>;
    supportDomainElementProperty: Record<string, string>;
    supportDomainRelationship: Record<string, string>;
  };
  saving: boolean;
  onChangeElement: (patch: Partial<SupportDomainElementDraft>) => void;
  onSaveElement: () => void;
  onDeleteElementById: (id: string) => void;
  onSelectElement: (id: string | null) => void;
  updateSupportDomainElementPropertyData: (patch: Partial<SupportDomainElementPropertyData>) => void;
  saveSupportDomainElementProperty: (data?: SupportDomainElementPropertyData) => Promise<boolean>;
  deleteSupportDomainElementProperty: (id: string) => void;
  onChangeRelationship: (patch: Partial<SupportDomainRelationshipDraft>) => void;
  onSaveRelationship: () => void;
  onDeleteRelationshipById: (id: string) => void;
  onSelectRelationship: (id: string | null) => void;
  onRefreshElements: () => void;
}) {
  const [elementModalOpen, setElementModalOpen] = useState(false);
  const [relationshipModalOpen, setRelationshipModalOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [pendingRelSave, setPendingRelSave] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [deleteElementId, setDeleteElementId] = useState<string | null>(null);
  const deleteElement = props.elements.find((element) => element.id === deleteElementId) ?? null;

  const badge = useBadgeCustomization('support-element', props.selectedElementId, { onSaved: props.onRefreshElements });

  useEffect(() => {
    if (!pendingSave) return;
    if (!props.saving) {
      if (Object.keys(props.validation.supportDomainElement).length === 0) {
        setElementModalOpen(false);
      }
      setPendingSave(false);
    }
  }, [props.saving, props.validation.supportDomainElement, pendingSave]);

  useEffect(() => {
    if (!pendingRelSave) return;
    if (!props.saving) {
      if (Object.keys(props.validation.supportDomainRelationship).length === 0) {
        setRelationshipModalOpen(false);
      }
      setPendingRelSave(false);
    }
  }, [props.saving, props.validation.supportDomainRelationship, pendingRelSave]);

  const openAddModal = () => {
    props.onSelectElement(null);
    setElementModalOpen(true);
  };

  const handleSaveElement = () => {
    props.onSaveElement();
    setPendingSave(true);
  };

  const openEditRelModal = (id: string) => {
    props.onSelectRelationship(id);
    setRelationshipModalOpen(true);
  };

  const openAddRelModal = () => {
    props.onSelectRelationship(null);
    setRelationshipModalOpen(true);
  };

  const handleSaveRelationship = () => {
    props.onSaveRelationship();
    setPendingRelSave(true);
  };

  return (
    <>
      <CreateEditSupportDomainElementDialog
        open={elementModalOpen}
        draft={props.elementDraft}
        lifecycleStatuses={props.lifecycleStatuses}
        validation={props.validation.supportDomainElement}
        saving={props.saving}
        onChange={props.onChangeElement}
        onSave={handleSaveElement}
        onDelete={props.elementDraft.id ? () => { setDeleteElementId(props.elementDraft.id!); setElementModalOpen(false); } : undefined}
        onClose={() => setElementModalOpen(false)}
      />
      <DeleteSupportDomainDialog
        kind="element"
        targetId={deleteElementId}
        targetName={deleteElement?.name ?? 'Support Domain Element Type'}
        deleting={props.saving}
        onConfirm={() => { if (deleteElementId) props.onDeleteElementById(deleteElementId); setDeleteElementId(null); }}
        onClose={() => setDeleteElementId(null)}
      />
      <CreateEditSupportDomainRelationshipDialog
        open={relationshipModalOpen}
        draft={props.relationshipDraft}
        elements={props.elements}
        relationshipKinds={props.relationshipKinds}
        lifecycleStatuses={props.lifecycleStatuses}
        validation={props.validation.supportDomainRelationship}
        saving={props.saving}
        onChange={props.onChangeRelationship}
        onSave={handleSaveRelationship}
        onDelete={props.relationshipDraft.id ? () => { props.onDeleteRelationshipById(props.relationshipDraft.id!); setRelationshipModalOpen(false); } : undefined}
        onClose={() => setRelationshipModalOpen(false)}
      />
      <Grid container spacing={2}>
        {/* Top row: Diagram/List tabs (left) + Element Details panel (right) */}
        <Grid size={{ xs: 12 }}>
          <HorizontalResizablePanels
            left={{
              storageKey: ResizablePanelsStorageKey.ModelWorkspaceSupportDomainElementPanel,
              minWidth: '20%',
              maxWidth: '80%',
              defaultWidth: '75%',
              component: (
                <Card variant="outlined">
                  <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
                    <Tabs value={activeTab} onChange={(_e, v: number) => setActiveTab(v)} sx={{ minHeight: 48 }}>
                      <Tab icon={<AccountTreeOutlined fontSize="small" />} iconPosition="start" label="Diagram View" sx={{ minHeight: 48, gap: 0.5 }} />
                      <Tab icon={<ViewListOutlined fontSize="small" />} iconPosition="start" label={`List View (${props.elements.length})`} sx={{ minHeight: 48, gap: 0.5 }} />
                    </Tabs>
                  </Box>

                  {/* Diagram tab */}
                  {activeTab === 0 && (
                    <Box sx={{ height: 500, mt: 1, px: 1, pb: 1 }}>
                      <SupportDomainDiagram
                        modelId={props.modelId}
                        elements={props.elements}
                        relationships={props.relationships}
                        focusedElementId={props.selectedElementId}
                        onConnectElements={() => openAddRelModal()}
                        onSelectElement={props.onSelectElement}
                      />
                    </Box>
                  )}

                  {/* Elements list tab */}
                  {activeTab === 1 && (
                    <Box sx={{ height: 500, display: 'flex', flexDirection: 'column', px: 2, pt: 2, pb: 1 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexShrink: 0, mb: 1.5 }}>
                        <Typography variant="h6">List Element Types</Typography>
                        <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={openAddModal}>Add Element</Button>
                      </Stack>
                      <Box sx={{ flex: 1, overflowY: 'auto' }}>
                        <Stack spacing={0.5}>
                          {props.elements.map((item) => (
                            <Box key={item.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.75, px: 1.5, borderRadius: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}>
                              <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Typography variant="caption" color="text.disabled" sx={{ width: 80, flexShrink: 0 }}>Name</Typography>
                                  <Typography variant="body2" fontWeight={500} noWrap>{displayLabel(item)}</Typography>
                                </Stack>
                                {item.description && (
                                  <Stack direction="row" spacing={1} alignItems="flex-start">
                                    <Typography variant="caption" color="text.disabled" sx={{ width: 80, flexShrink: 0 }}>Description</Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap>{item.description}</Typography>
                                  </Stack>
                                )}
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Typography variant="caption" color="text.disabled" sx={{ width: 80, flexShrink: 0 }}>Status</Typography>
                                  <Chip label={lifecycleLabel(item.status)} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                </Stack>
                              </Stack>
                              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                                <IconButton size="small" onClick={() => props.onSelectElement(item.id)}><EditOutlined fontSize="small" /></IconButton>
                                <IconButton size="small" color="error" onClick={() => setDeleteElementId(item.id)}><DeleteOutlined fontSize="small" /></IconButton>
                              </Stack>
                            </Box>
                          ))}
                          {props.elements.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>No elements yet.</Typography>}
                        </Stack>
                      </Box>
                    </Box>
                  )}
                </Card>
              ),
            }}
            right={{
              component: (
                <SupportDomainElementDetailsPanel
                  selectedElement={props.elements.find((element) => element.id === props.selectedElementId) ?? null}
                  elementDraft={props.elementDraft}
                  supportDomainElementProperties={props.supportDomainElementProperties}
                  lifecycleStatuses={props.lifecycleStatuses}
                  badge={badge.badge}
                  badgeOptions={badge.options}
                  badgeSaving={badge.saving}
                  validation={props.validation}
                  saving={props.saving}
                  onChangeElement={props.onChangeElement}
                  onSaveElement={() => {
                    props.onSaveElement();
                    void badge.onSave();
                  }}
                  onDeleteElementById={(id) => {
                    setDeleteElementId(id);
                  }}
                  updateSupportDomainElementPropertyData={props.updateSupportDomainElementPropertyData}
                  saveSupportDomainElementProperty={props.saveSupportDomainElementProperty}
                  deleteSupportDomainElementProperty={props.deleteSupportDomainElementProperty}
                  onBadgeChange={badge.onChange}
                  badgeDirty={badge.dirty}
                  onBadgeReset={() => void badge.onReset()}
                />
              ),
            }}
          />
        </Grid>

        {/* Bottom panel: Relationships — full width */}
        <Grid size={{ xs: 12 }}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="h6">{props.modelName} Relationships</Typography>
                  <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={openAddRelModal}>Add Relationship</Button>
                </Stack>
                <Typography variant="subtitle2" color="text.secondary">Relationships ({props.relationships.length})</Typography>
                <Stack spacing={0.5}>
                  {props.relationships.map((item) => {
                    const source = props.elements.find((e) => e.id === item.sourceElementId);
                    const target = props.elements.find((e) => e.id === item.targetElementId);
                    const sourceName = source ? displayLabel(source) : item.sourceElementId;
                    const targetName = target ? displayLabel(target) : item.targetElementId;
                    return (
                      <Box key={item.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.75, px: 1.5, borderRadius: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}>
                        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="caption" color="text.disabled" sx={{ width: 80, flexShrink: 0 }}>Source</Typography>
                            <Typography variant="body2" fontWeight={500} noWrap>{sourceName}</Typography>
                          </Stack>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="caption" color="text.disabled" sx={{ width: 80, flexShrink: 0 }}>Relationship</Typography>
                            <Chip label={item.relationshipKind} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                          </Stack>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="caption" color="text.disabled" sx={{ width: 80, flexShrink: 0 }}>Target</Typography>
                            <Typography variant="body2" fontWeight={500} noWrap>{targetName}</Typography>
                          </Stack>
                        </Stack>
                        <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                          <IconButton size="small" onClick={() => openEditRelModal(item.id)}><EditOutlined fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={() => props.onDeleteRelationshipById(item.id)}><DeleteOutlined fontSize="small" /></IconButton>
                        </Stack>
                      </Box>
                    );
                  })}
                  {props.relationships.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>No relationships yet.</Typography>}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
