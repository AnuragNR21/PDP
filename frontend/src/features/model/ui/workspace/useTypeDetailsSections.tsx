import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useToast } from '@/shared/toast/ToastContext';
import { RelationshipDetailsList } from '@/shared/workspace/RelationshipDetailsList';
import { CancelAction, DeleteAction, DuplicateAction, SaveAction } from '@/shared/workspace/WorkspaceIcons';
import type { DetailsSectionConfig } from '@/shared/workspace/WorkspacePanels';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type { CrossModelRelationshipTypeSummary, CrossModelTypeOption } from '../../domain/types';
import { displayLabel } from '../../domain/utils';
import { useBadgeCustomization } from '../../state/useBadgeCustomization';
import { useModelDefinitionsController } from '../../state/useModelDefinitionsController';
import { DeleteNodeTypeDialog } from '../dialogs/DeleteNodeTypeDialog';
import { DeleteSupportDomainDialog } from '../dialogs/DeleteSupportDomainDialog';
import { SelectedNodeTypeEditor } from '../editor/SelectedNodeTypeEditor';
import { SupportDomainElementDetailsPanel } from '../tabs/SupportDomainElementDetailsPanel';
import { uniqueCopyName } from './HierarchyListView';
import { elementTypeRelationshipGroups, nodeTypeRelationshipGroups } from './mwsRelationshipGroups';

/** A type created from the details panel (Duplicate), ready to go on a canvas. */
export type CreatedType = { id: string; name: string; modelName: string; kind: CrossModelTypeOption['kind'] };

const loading = (
  <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
    <CircularProgress size={22} />
  </Box>
);

/**
 * The standard MWS details panels for any node type or element type, wherever
 * it is picked — the Node Type Details / Element Type Details panel and the
 * Relationship Details panel of the Model tab, with the same fields and the
 * same Save, Cancel, Duplicate and Delete.
 *
 * It runs its own copy of the Model workspace controller, opened on the
 * picked type's model, so editing here never moves the Model tab's selection.
 */
export function useTypeDetailsSections(args: {
  item: CrossModelTypeOption | null;
  /** The governed relationships, for the "other models" group. */
  crossTypes: CrossModelRelationshipTypeSummary[];
  /** Open another type's details (a related type was clicked, or the open one was deleted). */
  onSelectType: (id: string | null) => void;
  onCreated?: (type: CreatedType) => void;
  onDeleted?: (id: string) => void;
}): { element: DetailsSectionConfig; relationship: DetailsSectionConfig; dialogs: ReactNode; guard: (action: () => void) => void } {
  const controller = useModelDefinitionsController();
  const { state } = controller;
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const nodeSaveRef = useRef<(() => Promise<void>) | null>(null);
  const [deleteNodeId, setDeleteNodeId] = useState<string | null>(null);
  const [deleteElementId, setDeleteElementId] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const requestedRef = useRef<string | null>(null);

  const { item } = args;
  const isNode = item?.kind === 'HIERARCHY_MODEL';

  // Open the type's model first, then the type, once its model's types are in.
  useEffect(() => {
    if (!item || state.loading) return;
    if (isNode && state.selectedHierarchyModelId !== item.modelId) void controller.selectHierarchyModel(item.modelId);
    if (!isNode && state.selectedSupportDomainModelId !== item.modelId) void controller.selectSupportDomainModel(item.modelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.modelId, isNode, state.loading, state.selectedHierarchyModelId, state.selectedSupportDomainModelId]);

  useEffect(() => {
    if (!item || state.loading) {
      requestedRef.current = null;
      return;
    }
    if (isNode) {
      if (state.selectedHierarchyModelId !== item.modelId || state.hierarchyNodeDraft.id === item.id) return;
      if (!state.hierarchyNodes.some((node) => node.id === item.id) || requestedRef.current === item.id) return;
      requestedRef.current = item.id;
      void controller.selectHierarchyNode(item.id);
    } else {
      if (state.selectedSupportDomainModelId !== item.modelId || state.selectedSupportDomainElementId === item.id) return;
      if (!state.supportDomainElements.some((element) => element.id === item.id) || requestedRef.current === item.id) return;
      requestedRef.current = item.id;
      void controller.selectSupportDomainElement(item.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, isNode, state.loading, state.selectedHierarchyModelId, state.selectedSupportDomainModelId, state.hierarchyNodes, state.supportDomainElements, state.hierarchyNodeDraft.id, state.selectedSupportDomainElementId]);

  // Names and badges also show on the diagram cards and in the selection panel.
  const refreshTypeOptions = () => queryClient.invalidateQueries({ queryKey: ['cross-model-type-options'] });

  const selectedNode = isNode && item && state.hierarchyNodeDraft.id === item.id ? state.hierarchyNodes.find((node) => node.id === item.id) ?? null : null;
  const selectedElement =
    !isNode && item && state.selectedSupportDomainElementId === item.id ? state.supportDomainElements.find((element) => element.id === item.id) ?? null : null;

  const hierarchyBadge = useBadgeCustomization('hierarchy-node', selectedNode?.id ?? null, {
    onSaved: () => {
      void controller.refreshHierarchyNodes();
      void refreshTypeOptions();
    },
  });
  const elementBadge = useBadgeCustomization('support-element', selectedElement?.id ?? null, {
    onSaved: () => {
      void controller.refreshSupportDomainElements();
      void refreshTypeOptions();
    },
  });

  // ── Save / Cancel: enabled only for a real, valid change (as on the Model tab) ──
  const nodeDraft = state.hierarchyNodeDraft;
  const nodeFieldsChanged = Boolean(
    selectedNode &&
      (nodeDraft.name !== selectedNode.name ||
        nodeDraft.displayName !== selectedNode.displayName ||
        nodeDraft.description !== selectedNode.description ||
        nodeDraft.status !== selectedNode.status ||
        nodeDraft.isRecursive !== selectedNode.isRecursive ||
        nodeDraft.isProperty !== selectedNode.isProperty),
  );
  // Badge edits are part of the panel's changes: Save saves them, Cancel puts them back.
  const nodeChanged = nodeFieldsChanged || hierarchyBadge.dirty;
  const nodeCanSave = nodeChanged && nodeDraft.name.trim().length > 0 && !state.saving && !hierarchyBadge.saving;
  const saveNode = async () => {
    if (!nodeCanSave) return;
    if (nodeFieldsChanged) await nodeSaveRef.current?.();
    if (hierarchyBadge.dirty) await hierarchyBadge.onSave();
  };
  const resetNodeDraft = () => {
    hierarchyBadge.onCancel();
    if (!selectedNode) return;
    controller.updateHierarchyNodeDraft({
      name: selectedNode.name,
      displayName: selectedNode.displayName,
      description: selectedNode.description,
      status: selectedNode.status,
      isRecursive: selectedNode.isRecursive,
      isProperty: selectedNode.isProperty,
    });
  };

  const elementDraft = state.supportDomainElementDraft;
  const elementFieldsChanged = Boolean(
    selectedElement &&
      elementDraft.id === selectedElement.id &&
      (elementDraft.name !== selectedElement.name ||
        elementDraft.displayName !== selectedElement.displayName ||
        elementDraft.description !== selectedElement.description ||
        elementDraft.status !== selectedElement.status),
  );
  const elementChanged = elementFieldsChanged || elementBadge.dirty;
  const elementCanSave = elementChanged && elementDraft.name.trim().length > 0 && !state.saving && !elementBadge.saving;
  const cancelElementEdit = () => {
    elementBadge.onCancel();
    if (!selectedElement) return;
    controller.updateSupportDomainElementDraft({
      name: selectedElement.name,
      displayName: selectedElement.displayName,
      description: selectedElement.description,
      status: selectedElement.status,
    });
  };

  const hasUnsaved = nodeChanged || elementChanged;
  const guard = (action: () => void) => {
    if (hasUnsaved) setPendingDiscard(() => action);
    else action();
  };

  const saveElement = async () => {
    if (elementFieldsChanged) {
      await controller.saveSupportDomainElement();
      await refreshTypeOptions();
    }
    if (elementBadge.dirty) await elementBadge.onSave();
  };

  const duplicateNode = async () => {
    if (!selectedNode?.parentNodeId) return;
    try {
      const created = await modelDefinitionsApi.createHierarchyNodeType({
        modelId: selectedNode.modelId,
        parentNodeId: selectedNode.parentNodeId,
        name: uniqueCopyName(selectedNode.name, state.hierarchyNodes.map((node) => node.name)),
        displayName: selectedNode.displayName ? uniqueCopyName(selectedNode.displayName, state.hierarchyNodes.map((node) => node.displayName)) : '',
        badge: selectedNode.badge.badgeText,
        description: selectedNode.description,
        isRecursive: selectedNode.isRecursive,
        isProperty: selectedNode.isProperty,
        status: selectedNode.status,
      });
      await controller.refreshHierarchySelection();
      await refreshTypeOptions();
      args.onCreated?.({ id: created.id, name: created.name, modelName: item?.modelName ?? '', kind: 'HIERARCHY_MODEL' });
      showToast(`Duplicated as “${created.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to duplicate node type.', 'error');
    }
  };

  const duplicateElement = async () => {
    if (!selectedElement) return;
    try {
      const created = await modelDefinitionsApi.createSupportDomainElement({
        modelId: selectedElement.modelId,
        name: uniqueCopyName(selectedElement.name, state.supportDomainElements.map((element) => element.name)),
        displayName: selectedElement.displayName ? uniqueCopyName(selectedElement.displayName, state.supportDomainElements.map((element) => element.displayName)) : '',
        badge: selectedElement.badge.badgeText,
        description: selectedElement.description,
        status: selectedElement.status,
      });
      await controller.refreshSupportDomainSelection();
      await refreshTypeOptions();
      args.onCreated?.({ id: created.id, name: created.name, modelName: item?.modelName ?? '', kind: 'SUPPORT_DOMAIN_MODEL' });
      showToast(`Duplicated as “${created.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to duplicate element type.', 'error');
    }
  };

  const selectRelated = (id: string) => guard(() => args.onSelectType(id));

  let element: DetailsSectionConfig;
  let relationship: DetailsSectionConfig;
  if (!item || isNode) {
    const label = selectedNode ? displayLabel(selectedNode) : 'node type';
    element = {
      title: 'Node Type Details',
      isEmpty: !item,
      empty: 'Click a node type or element type on the diagram.',
      flush: true,
      actions: selectedNode ? (
        <Stack direction="row">
          <SaveAction label={label} disabled={!nodeCanSave} onClick={() => void saveNode()} />
          {nodeChanged && <CancelAction label={label} onClick={resetNodeDraft} />}
          {selectedNode.parentNodeId && <DuplicateAction label={label} onClick={() => guard(() => void duplicateNode())} />}
          {selectedNode.parentNodeId && <DeleteAction label={label} onClick={() => setDeleteNodeId(selectedNode.id)} />}
        </Stack>
      ) : undefined,
      content: !selectedNode ? (
        loading
      ) : (
        <SelectedNodeTypeEditor
          key={selectedNode.id}
          embedded
          saveRef={nodeSaveRef}
          draft={state.hierarchyNodeDraft}
          properties={state.hierarchyNodeProperties}
          propertyFormData={state.hierarchyNodePropertyFormData}
          persistedIsRecursive={selectedNode.isRecursive}
          hasChildren={state.hierarchyNodes.some((node) => node.parentNodeId === selectedNode.id)}
          lifecycleStatuses={state.metadata.lifecycleStatuses}
          badge={hierarchyBadge.badge}
          badgeOptions={hierarchyBadge.options}
          badgeSaving={hierarchyBadge.saving}
          badgeDirty={hierarchyBadge.dirty}
          validation={{ hierarchyNode: state.validation.hierarchyNode, hierarchyNodeProperty: state.validation.hierarchyNodeProperty }}
          saving={state.saving}
          onChange={controller.updateHierarchyNodeDraft}
          onChangeProperty={controller.updateHierarchyNodePropertyFormData}
          onSave={async (options) => {
            await controller.saveHierarchyNode(options);
            await refreshTypeOptions();
          }}
          onSaveProperty={controller.saveHierarchyModelNodeTypeProperty}
          onDeleteProperty={(id) => void controller.deleteHierarchyNodeProperty(id)}
          onDelete={() => setDeleteNodeId(selectedNode.id)}
          onBadgeChange={hierarchyBadge.onChange}
          onBadgeReset={() => void hierarchyBadge.onReset()}
        />
      ),
    };
    relationship = {
      title: 'Relationship Details',
      isEmpty: !item,
      empty: 'Select a node type or element type to see its immediate relationships.',
      content: !selectedNode ? (
        loading
      ) : (
        <RelationshipDetailsList
          groups={nodeTypeRelationshipGroups({
            nodeId: selectedNode.id,
            nodes: state.hierarchyNodes,
            rules: state.hierarchyRules,
            crossTypes: args.crossTypes,
            relationshipKinds: state.metadata.relationshipKinds,
            onSelectNode: selectRelated,
          })}
        />
      ),
    };
  } else {
    const label = selectedElement ? displayLabel(selectedElement) : 'element type';
    element = {
      title: 'Element Type Details',
      flush: true,
      actions: selectedElement ? (
        <Stack direction="row">
          <SaveAction label={label} disabled={!elementCanSave} onClick={() => void saveElement()} />
          {elementChanged && <CancelAction label={label} onClick={cancelElementEdit} />}
          <DuplicateAction label={label} onClick={() => guard(() => void duplicateElement())} />
          <DeleteAction label={label} onClick={() => setDeleteElementId(selectedElement.id)} />
        </Stack>
      ) : undefined,
      content: !selectedElement ? (
        loading
      ) : (
        <SupportDomainElementDetailsPanel
          embedded
          selectedElement={selectedElement}
          elementDraft={state.supportDomainElementDraft}
          supportDomainElementProperties={state.supportDomainElementProperties}
          lifecycleStatuses={state.metadata.lifecycleStatuses}
          badge={elementBadge.badge}
          badgeOptions={elementBadge.options}
          badgeSaving={elementBadge.saving}
          badgeDirty={elementBadge.dirty}
          validation={{ supportDomainElement: state.validation.supportDomainElement, supportDomainElementProperty: state.validation.supportDomainElementProperty }}
          saving={state.saving}
          onChangeElement={controller.updateSupportDomainElementDraft}
          onSaveElement={() => void saveElement()}
          onDeleteElementById={setDeleteElementId}
          updateSupportDomainElementPropertyData={controller.updateSupportDomainElementPropertyData}
          saveSupportDomainElementProperty={controller.saveSupportDomainElementProperty}
          deleteSupportDomainElementProperty={(id) => void controller.deleteSupportDomainElementProperty(id)}
          onBadgeChange={elementBadge.onChange}
          onBadgeReset={() => void elementBadge.onReset()}
        />
      ),
    };
    relationship = {
      title: 'Relationship Details',
      content: !selectedElement ? (
        loading
      ) : (
        <RelationshipDetailsList
          groups={elementTypeRelationshipGroups({
            elementId: selectedElement.id,
            elements: state.supportDomainElements,
            relationships: state.supportDomainRelationships,
            crossTypes: args.crossTypes,
            relationshipKinds: state.metadata.relationshipKinds,
            onSelectElement: selectRelated,
          })}
        />
      ),
    };
  }

  const deleteNode = deleteNodeId ? state.hierarchyNodes.find((node) => node.id === deleteNodeId) : undefined;
  const deleteElement = deleteElementId ? state.supportDomainElements.find((el) => el.id === deleteElementId) : undefined;

  const dialogs = (
    <>
      <DeleteNodeTypeDialog
        nodeId={deleteNodeId}
        nodeName={deleteNode ? displayLabel(deleteNode) : 'Node type'}
        onConfirm={async () => {
          const id = deleteNodeId;
          if (id) {
            await controller.deleteHierarchyNode(id);
            args.onDeleted?.(id);
            args.onSelectType(null);
          }
          setDeleteNodeId(null);
        }}
        onClose={() => setDeleteNodeId(null)}
      />
      <DeleteSupportDomainDialog
        kind="element"
        targetId={deleteElementId}
        targetName={deleteElement ? displayLabel(deleteElement) : 'Support Domain Element Type'}
        deleting={state.saving}
        onConfirm={() => {
          const id = deleteElementId;
          setDeleteElementId(null);
          if (!id) return;
          void controller.deleteSupportDomainElement(id).then(() => {
            args.onDeleted?.(id);
            args.onSelectType(null);
          });
        }}
        onClose={() => setDeleteElementId(null)}
      />
      <Dialog open={pendingDiscard !== null} onClose={() => setPendingDiscard(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>The changes in the details panel have not been saved. Leave without saving them?</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDiscard(null)}>Keep editing</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const action = pendingDiscard;
              setPendingDiscard(null);
              if (nodeChanged) resetNodeDraft();
              if (elementChanged) cancelElementEdit();
              action?.();
            }}
          >
            Discard
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  return { element, relationship, dialogs, guard };
}
