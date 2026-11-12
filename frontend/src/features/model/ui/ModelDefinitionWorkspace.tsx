import AddOutlined from '@mui/icons-material/AddOutlined';
import CallSplitOutlined from '@mui/icons-material/CallSplitOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useToast } from '../../../shared/toast/ToastContext';
import { CreateModelButton, CreatePackageButton, ModelSelectionPanel } from '../../../shared/workspace/ModelSelectionPanel';
import { ModelPackageDialog } from '../../../shared/workspace/ModelPackageDialog';
import { extendsOf, isCommon, modelKey, onExtensionChange, packageIdOf, packageNameOf, placeNewModel, usePackageState } from '../../../shared/workspace/modelPackages';
import { linkExtension, unlinkExtension } from '../state/extensionLinks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { validateCrossModelRelationshipTypeDraft } from '../domain/invariants';
import { CreateEditCrossModelRelationshipTypeDialog } from './dialogs/CreateEditCrossModelRelationshipTypeDialog';
import type { InheritedSupportDomain } from './diagram/SupportDomainDiagram';
import { InheritedModelContent, PackageSpecificLabel } from './workspace/InheritedModelContent';
import { RelationshipDetailsList } from '../../../shared/workspace/RelationshipDetailsList';
import { ModelHeaderCard, ModelNav, ProjectionNav } from '../../../shared/workspace/WorkspaceChrome';
import { CancelAction, DeleteAction, DuplicateAction, ModelKindIcon, SaveAction } from '../../../shared/workspace/WorkspaceIcons';
import { WorkspaceLanding } from '../../../shared/workspace/WorkspaceLanding';
import { AuthoringPanel, WorkspaceBody, useStoredFlag } from '../../../shared/workspace/WorkspacePanels';
import { useRecentModels } from '../../../shared/workspace/useRecentModels';
import { useWorkspaceParams } from '../../../shared/workspace/useWorkspaceParams';
import { MODEL_KIND_LABEL, WORKSPACE_TABS, projectionsFor, type ModelKind, type WorkspaceModel } from '../../../shared/workspace/workspaceModel';
import { modelDefinitionsApi } from '../api/modelDefinitionsApi';
import { displayLabel } from '../domain/utils';
import type { CrossModelRelationshipTypeDraft, SupportDomainRelationshipSummary } from '../domain/types';
import { useBadgeCustomization } from '../state/useBadgeCustomization';
import { useModelDefinitionsController } from '../state/useModelDefinitionsController';
import { CreateEditSupportDomainElementDialog } from './dialogs/CreateEditSupportDomainElementDialog';
import { CreateEditSupportDomainRelationshipDialog } from './dialogs/CreateEditSupportDomainRelationshipDialog';
import { DeleteHierarchyModelDialog } from './dialogs/DeleteHierarchyModelDialog';
import { DeleteNodeTypeDialog } from './dialogs/DeleteNodeTypeDialog';
import { DeleteSupportDomainDialog } from './dialogs/DeleteSupportDomainDialog';
import { SupportDomainDiagram } from './diagram/SupportDomainDiagram';
import { SelectedNodeTypeEditor } from './editor/SelectedNodeTypeEditor';
import { EditModelDialog } from './modals/EditModelDialog';
import { CreateModelDialog, type CreateModelForm } from './modals/CreateModelDialog';
import { SupportDomainElementDetailsPanel } from './tabs/SupportDomainElementDetailsPanel';
import { NodeTypeTreePanel } from './tree/NodeTypeTreePanel';
import { FOCUS_PARAM, useFindInDiagrams } from './governance/diagram/findInDiagrams';
import { HierarchyListView, uniqueCopyName } from './workspace/HierarchyListView';
import { MwsRelationshipWorkspace } from './workspace/MwsRelationshipWorkspace';
import { SupportDomainListView } from './workspace/SupportDomainListView';
import { elementTypeRelationshipGroups, nodeTypeRelationshipGroups } from './workspace/mwsRelationshipGroups';

/** Marks a controller change the workspace made itself, so it is not mirrored into the address. */
const SUPPRESS = '__suppress__';

/**
 * MWS — the Model Workspace, on the layout it shares with SWS (PDP-UIUX-001):
 * Model Navigation (Model | Relationship | Data Exchange); on Model, the Model
 * Selection panel, the open model's header and its projections (Hierarchy |
 * List for a hierarchy model, Diagram | List for a support domain model), each
 * an Authoring Workspace beside Element Details and Relationship Details.
 *
 * The address holds which model and view are open; the controller holds the
 * model's data. The two are kept in step here — the address leads when the
 * person navigates, the controller leads when a model is created or deleted.
 */
export function ModelDefinitionWorkspace() {
  const controller = useModelDefinitionsController();
  const { state } = controller;
  const { showToast } = useToast();
  const { params, update, selectModel, searchParams, setSearchParams } = useWorkspaceParams('mws');
  const { recent, remember } = useRecentModels('mws');

  // Folds only when the person folds it; opening a model leaves it as it was.
  const [selectionCollapsed, setSelectionCollapsed] = useStoredFlag('pdp-mws-model-selection-collapsed', false);
  const [modelDialog, setModelDialog] = useState<ModelKind | null>(null);
  const [createModelOpen, setCreateModelOpen] = useState(false);
  // The Package a new model starts in (+ Model inside a package), and where the
  // model just created goes once it has an id.
  const [createPackageId, setCreatePackageId] = useState<string | undefined>(undefined);
  const placementRef = useRef<{ packageId: string; extendsKey: string | null } | null>(null);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const packageState = usePackageState();
  const [deleteModelKind, setDeleteModelKind] = useState<ModelKind | null>(null);
  const [nodeEditorKey, setNodeEditorKey] = useState(0);
  const [creatingNode, setCreatingNode] = useState(false);
  const [deleteNodeId, setDeleteNodeId] = useState<string | null>(null);
  const [elementDialogOpen, setElementDialogOpen] = useState(false);
  const [relationshipDialogOpen, setRelationshipDialogOpen] = useState(false);
  const [pendingElementSave, setPendingElementSave] = useState(false);
  const [pendingRelationshipSave, setPendingRelationshipSave] = useState(false);
  const [deleteElementId, setDeleteElementId] = useState<string | null>(null);
  // Save in the Node Type Details toolbar runs the editor's own save, so the
  // recursive-removal impact check still happens.
  const nodeSaveRef = useRef<(() => Promise<void>) | null>(null);
  // Something to do once the person agrees to drop unsaved edits.
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);

  const ready = state.metadata.lifecycleStatuses.length > 0;

  const models = useMemo<WorkspaceModel[]>(
    () => [
      ...state.hierarchyModels.map((model) => ({ id: model.id, kind: 'hierarchy' as const, name: model.name, description: model.purpose, status: model.status })),
      ...state.supportDomainModels.map((model) => ({ id: model.id, kind: 'support' as const, name: model.name, description: model.purpose, status: model.status })),
    ],
    [state.hierarchyModels, state.supportDomainModels],
  );

  // ── Address ⇄ controller ─────────────────────────────────────────────────
  const controllerKey =
    state.activeTab === 'hierarchyModel'
      ? state.selectedHierarchyModelId && `hierarchy:${state.selectedHierarchyModelId}`
      : state.selectedSupportDomainModelId && `support:${state.selectedSupportDomainModelId}`;
  const addressKey = params.modelId && params.kind ? `${params.kind}:${params.modelId}` : null;
  const pendingRef = useRef<string | null | undefined>(undefined);
  // The node type / element type to select again once the model in the
  // address has loaded — how a return to the workspace lands on the same
  // object. `undefined` once that has been dealt with.
  // Starts from the address: on a fresh load the controller may already have
  // opened the model in the address, so the switch below never runs, and the
  // item (?item=, e.g. after a refresh) would otherwise be dropped.
  const itemRestoreRef = useRef<string | null | undefined>(params.item ?? undefined);
  const expectCreatedRef = useRef(false);

  // The Structure Workspace links to a node type as ?model_id=&node_type_id=.
  useEffect(() => {
    const legacyModelId = searchParams.get('model_id');
    if (!legacyModelId) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('model_id');
        next.delete('node_type_id');
        next.set('kind', 'hierarchy');
        next.set('model', legacyModelId);
        return next;
      },
      { replace: true },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Just created a model: the controller has it open, and the address follows it (below).
    if (!ready || !addressKey || addressKey === controllerKey || pendingRef.current === SUPPRESS || expectCreatedRef.current) return;
    const model = models.find((item) => item.id === params.modelId && item.kind === params.kind);
    if (!model) {
      // A link to a model that is not there (deleted, or never was): back to the landing page.
      selectModel(null, null, { replace: true });
      return;
    }
    pendingRef.current = addressKey;
    itemRestoreRef.current = params.item;
    void (model.kind === 'hierarchy' ? controller.selectHierarchyModel(model.id) : controller.selectSupportDomainModel(model.id));
  }, [ready, addressKey, models]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    if (pendingRef.current === SUPPRESS) return;
    if (pendingRef.current !== undefined) {
      if (pendingRef.current === controllerKey) pendingRef.current = undefined;
      return;
    }
    // A model just created becomes the open one, from the landing page or from another model.
    const justCreated = expectCreatedRef.current && controllerKey;
    if ((addressKey && controllerKey !== addressKey) || justCreated) {
      expectCreatedRef.current = false;
      if (justCreated && controllerKey && placementRef.current) {
        placeNewModel(controllerKey, placementRef.current.packageId, placementRef.current.extendsKey);
        placementRef.current = null;
      }
      const [kind, id] = controllerKey ? (controllerKey.split(':') as [ModelKind, string]) : [null, null];
      selectModel(kind, id, { replace: true });
    }
  }, [controllerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const openModel = addressKey && addressKey === controllerKey ? models.find((model) => `${model.kind}:${model.id}` === addressKey) ?? null : null;

  // Packages: where the open model lives, and the common model it extends.
  const openKey = openModel ? modelKey(openModel) : null;
  const baseKey = openKey ? extendsOf(packageState, openKey) : null;
  const baseModel = baseKey ? models.find((m) => modelKey(m) === baseKey) ?? null : null;
  const openPackageName = openKey ? packageNameOf(packageState, openKey) : '';
  // The structural link between a common Hierarchy Model and its extensions
  // follows the person's own changes made here (Package & extension, a new
  // model placed in a package) — never a state synced in from the server.
  const queryClient = useQueryClient();
  const refreshExtensionLinks = async () => {
    await controller.refreshCrossModelRelationshipTypes();
    await queryClient.invalidateQueries({ queryKey: ['extension-link'] });
    await queryClient.invalidateQueries({ queryKey: ['cross-model-type-options'] });
    await queryClient.invalidateQueries({ queryKey: ['cross-model-relationship-types'] });
  };
  const refreshExtensionLinksRef = useRef(refreshExtensionLinks);
  refreshExtensionLinksRef.current = refreshExtensionLinks;
  useEffect(
    () =>
      onExtensionChange(({ key, from, to }) => {
        const [kind, modelId] = key.split(':');
        if (kind !== 'hierarchy') return;
        void (async () => {
          try {
            if (from) await unlinkExtension(from.split(':')[1], modelId);
            if (to) await linkExtension(to.split(':')[1], modelId);
            await refreshExtensionLinksRef.current();
          } catch (error) {
            showToast(error instanceof Error ? `Could not link the extension: ${error.message}` : 'Could not link the extension.', 'error');
          }
        })();
      }),
    [showToast],
  );

  // Support Domain: the common model's element types and relationships, drawn
  // (read only) on the extending model's diagram, and the governed
  // relationships that join one of them to one of this model's own.
  const inheritsSupport = baseModel?.kind === 'support' && openModel?.kind === 'support';
  const inheritedSdElements = useQuery({
    queryKey: ['inherited-sd-elements', baseModel?.id ?? null],
    queryFn: () => modelDefinitionsApi.listSupportDomainElements(baseModel!.id),
    enabled: inheritsSupport,
  });
  const inheritedSdRelationships = useQuery({
    queryKey: ['inherited-sd-relationships', baseModel?.id ?? null],
    queryFn: () => modelDefinitionsApi.listSupportDomainRelationships(baseModel!.id),
    enabled: inheritsSupport,
  });
  const inheritedSupport = useMemo<InheritedSupportDomain | null>(() => {
    if (!inheritsSupport || !baseModel) return null;
    const elements = inheritedSdElements.data ?? [];
    const baseIds = new Set(elements.map((element) => element.id));
    const ownIds = new Set(state.supportDomainElements.map((element) => element.id));
    const joins = (a: string | null, b: string | null) => Boolean(a && b && ((baseIds.has(a) && ownIds.has(b)) || (ownIds.has(a) && baseIds.has(b))));
    return {
      modelName: baseModel.name,
      elements,
      relationships: inheritedSdRelationships.data ?? [],
      links: state.crossModelRelationshipTypes
        .filter((type) => type.status !== 'retired' && type.sourceModelType === 'SUPPORT_DOMAIN_MODEL' && type.targetModelType === 'SUPPORT_DOMAIN_MODEL')
        .filter((type) => joins(type.sourceModelItemTypeId, type.targetModelItemTypeId))
        .map((type) => ({ id: type.id, name: type.name, sourceId: type.sourceModelItemTypeId!, targetId: type.targetModelItemTypeId! })),
    };
  }, [inheritsSupport, baseModel, inheritedSdElements.data, inheritedSdRelationships.data, state.supportDomainElements, state.crossModelRelationshipTypes]);

  // A relationship dragged between an inherited element type and one of this model's.
  const [inheritedLinkDraft, setInheritedLinkDraft] = useState<CrossModelRelationshipTypeDraft | null>(null);
  const [inheritedLinkErrors, setInheritedLinkErrors] = useState<Record<string, string>>({});
  const [inheritedLinkSaving, setInheritedLinkSaving] = useState(false);
  const crossTypeOptions = useQuery({
    queryKey: ['cross-model-type-options'],
    queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions(),
    enabled: Boolean(inheritedLinkDraft),
  });
  const openInheritedLink = (sourceId: string, targetId: string) => {
    setInheritedLinkErrors({});
    setInheritedLinkDraft({
      name: '',
      description: '',
      sourceModelType: 'SUPPORT_DOMAIN_MODEL',
      sourceModelItemTypeId: sourceId,
      targetModelType: 'SUPPORT_DOMAIN_MODEL',
      targetModelItemTypeId: targetId,
      status: 'active',
    });
  };
  const saveInheritedLink = async () => {
    if (!inheritedLinkDraft) return;
    const errors = validateCrossModelRelationshipTypeDraft(inheritedLinkDraft);
    setInheritedLinkErrors(errors);
    if (Object.keys(errors).length) return;
    setInheritedLinkSaving(true);
    try {
      await modelDefinitionsApi.createCrossModelRelationshipType(inheritedLinkDraft);
      setInheritedLinkDraft(null);
      await refreshExtensionLinks();
      showToast(`Relationship “${inheritedLinkDraft.name}” created.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the relationship.', 'error');
    } finally {
      setInheritedLinkSaving(false);
    }
  };
  const inheritedLinkDialog = inheritedLinkDraft && crossTypeOptions.data && (
    <CreateEditCrossModelRelationshipTypeDialog
      open
      draft={inheritedLinkDraft}
      typeOptions={crossTypeOptions.data}
      lifecycleStatuses={state.metadata.lifecycleStatuses}
      validation={inheritedLinkErrors}
      saving={inheritedLinkSaving}
      constraintsLocked
      onChange={(patch) => setInheritedLinkDraft((current) => (current ? { ...current, ...patch } : current))}
      onSave={() => void saveInheritedLink()}
      onClose={() => setInheritedLinkDraft(null)}
    />
  );

  const inherited = baseModel ? (
    <>
      <InheritedModelContent
        base={baseModel}
        extending={openModel}
        onOpen={() => chooseModel(baseModel.kind, baseModel.id)}
        onLinkChanged={() => void refreshExtensionLinks()}
      />
      <PackageSpecificLabel packageName={openPackageName} />
    </>
  ) : null;

  useEffect(() => {
    if (openModel) remember(openModel.kind, openModel.id);
  }, [openModel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The selected object is part of the address, so it is remembered ─────
  const currentItem = openModel ? (openModel.kind === 'hierarchy' ? state.selectedHierarchyNodeId : state.selectedSupportDomainElementId) ?? null : null;
  useEffect(() => {
    if (!openModel) return;
    const wanted = itemRestoreRef.current;
    if (wanted !== undefined) {
      itemRestoreRef.current = undefined;
      if (wanted && wanted !== currentItem) {
        if (openModel.kind === 'hierarchy' && state.hierarchyNodes.some((node) => node.id === wanted)) {
          void controller.selectHierarchyNode(wanted);
          return;
        }
        if (openModel.kind === 'support' && state.supportDomainElements.some((element) => element.id === wanted)) {
          void controller.selectSupportDomainElement(wanted);
          return;
        }
      }
    }
    if ((params.item ?? null) !== currentItem) update({ item: currentItem }, { replace: true });
  }, [openModel?.id, currentItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseModel = (kind: ModelKind, id: string) => guardUnsaved(() => selectModel(kind, id));
  const goHome = () => guardUnsaved(() => selectModel(null, null));

  // ── Support domain dialog saves close only when the save went through ────
  useEffect(() => {
    if (!pendingElementSave || state.saving) return;
    if (Object.keys(state.validation.supportDomainElement).length === 0) setElementDialogOpen(false);
    setPendingElementSave(false);
  }, [state.saving, state.validation.supportDomainElement, pendingElementSave]);
  useEffect(() => {
    if (!pendingRelationshipSave || state.saving) return;
    if (Object.keys(state.validation.supportDomainRelationship).length === 0) setRelationshipDialogOpen(false);
    setPendingRelationshipSave(false);
  }, [state.saving, state.validation.supportDomainRelationship, pendingRelationshipSave]);

  const hierarchyBadge = useBadgeCustomization('hierarchy-node', state.hierarchyNodeDraft.id, { onSaved: () => void controller.refreshHierarchyNodes() });
  const elementBadge = useBadgeCustomization('support-element', state.selectedSupportDomainElementId, { onSaved: () => void controller.refreshSupportDomainElements() });

  // ── Find in Diagram(s): right-click a type in the model ───────────────────
  const finder = useFindInDiagrams({ guard: guardUnsaved });
  const typeMenu = (id: string, name: string, event: ReactMouseEvent) => finder.openMenu({ id, name }, event);

  // ── Find in Model: ?focus=<type id> selects the type and brings it into view ──
  // Navigation only — the parameter is removed once handled.
  const focusParam = params.tab === 'model' ? searchParams.get(FOCUS_PARAM) : null;
  const [revealRequest, setRevealRequest] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (!focusParam || !openModel) return;
    const isHierarchy = openModel.kind === 'hierarchy';
    const list: Array<{ id: string; modelId: string }> = isHierarchy ? state.hierarchyNodes : state.supportDomainElements;
    // Wait until the open model's types have loaded.
    if (!list.some((item) => item.modelId === openModel.id)) return;
    const clear = () =>
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete(FOCUS_PARAM);
        return next;
      }, { replace: true });
    if (!list.some((item) => item.id === focusParam)) {
      showToast('That type is no longer in this model.', 'warning');
      clear();
      return;
    }
    clear();
    guardUnsaved(() => {
      setCreatingNode(false);
      void (isHierarchy ? controller.selectHierarchyNode(focusParam) : controller.selectSupportDomainElement(focusParam));
      setRevealRequest({ id: focusParam });
      // List views: scroll the row into view (the tree and the diagram bring it into view themselves).
      window.setTimeout(() => {
        document.querySelector(`[data-reveal-id="${CSS.escape(focusParam)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 250);
    });
  }, [focusParam, openModel?.id, state.hierarchyNodes, state.supportDomainElements]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return state.error ? <Alert severity="error">{state.error}</Alert> : <CircularProgress />;
  }

  // ── Model create / edit / delete ─────────────────────────────────────────
  const startEdit = () => {
    if (!openModel) return;
    if (openModel.kind === 'hierarchy') {
      const model = state.hierarchyModels.find((item) => item.id === openModel.id)!;
      controller.updateHierarchyModelDraft({ id: model.id, name: model.name, purpose: model.purpose, owningDomain: model.owningDomain, status: model.status });
    } else {
      const model = state.supportDomainModels.find((item) => item.id === openModel.id)!;
      controller.updateSupportDomainModelDraft({ id: model.id, name: model.name, purpose: model.purpose, status: model.status });
    }
    setModelDialog(openModel.kind);
  };
  const deleteOpenModel = async () => {
    if (!openModel) return;
    pendingRef.current = SUPPRESS;
    try {
      if (openModel.kind === 'hierarchy') await controller.deleteHierarchyModel(openModel.id);
      else await controller.deleteSupportDomainModel(openModel.id);
    } finally {
      pendingRef.current = undefined;
      setDeleteModelKind(null);
      selectModel(null, null, { replace: true });
    }
  };

  // ── Node types ───────────────────────────────────────────────────────────
  const selectNode = (id: string) =>
    guardUnsaved(() => {
      setCreatingNode(false);
      void controller.selectHierarchyNode(id);
    });
  const addChild = (parentId: string) =>
    guardUnsaved(() => {
      controller.beginCreateChildNode(parentId);
      setCreatingNode(true);
      setNodeEditorKey((key) => key + 1);
      showToast('Enter the child node type, then Save.', 'info');
    });
  const addRoot = () => {
    controller.beginCreateRootNode();
    setCreatingNode(true);
    setNodeEditorKey((key) => key + 1);
  };
  const duplicateNode = async (id: string) => {
    const node = state.hierarchyNodes.find((item) => item.id === id);
    if (!node || !node.parentNodeId) return;
    try {
      const created = await modelDefinitionsApi.createHierarchyNodeType({
        modelId: node.modelId,
        parentNodeId: node.parentNodeId,
        name: uniqueCopyName(node.name, state.hierarchyNodes.map((item) => item.name)),
        displayName: node.displayName ? uniqueCopyName(node.displayName, state.hierarchyNodes.map((item) => item.displayName)) : '',
        badge: node.badge.badgeText,
        description: node.description,
        isRecursive: node.isRecursive,
        isProperty: node.isProperty,
        status: node.status,
      });
      await controller.refreshHierarchySelection();
      selectNode(created.id);
      showToast(`Duplicated as “${created.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to duplicate node type.', 'error');
    }
  };

  // ── Support domain elements and relationships ────────────────────────────
  const openAddElement = () => {
    controller.selectSupportDomainElement(null);
    setElementDialogOpen(true);
  };
  const openAddRelationship = () => {
    controller.selectSupportDomainRelationship(null);
    setRelationshipDialogOpen(true);
  };
  // Dragged on the diagram: source and target are already known.
  const openRelationshipBetween = (sourceElementId: string, targetElementId: string) => {
    controller.selectSupportDomainRelationship(null);
    controller.updateSupportDomainRelationshipDraft({ sourceElementId, targetElementId });
    setRelationshipDialogOpen(true);
  };
  // Chosen on the diagram: view and edit it in the same editor it was created in.
  const openEditRelationship = (relationshipId: string) => {
    controller.selectSupportDomainRelationship(relationshipId);
    setRelationshipDialogOpen(true);
  };
  const openDuplicateRelationship = (relationship: SupportDomainRelationshipSummary) => {
    controller.selectSupportDomainRelationship(null);
    controller.updateSupportDomainRelationshipDraft({
      sourceElementId: relationship.sourceElementId,
      targetElementId: '',
      relationshipKind: relationship.relationshipKind,
      notes: relationship.notes,
      status: relationship.status,
    });
    setRelationshipDialogOpen(true);
  };
  const duplicateElement = async (id: string) => {
    const element = state.supportDomainElements.find((item) => item.id === id);
    if (!element) return;
    try {
      const created = await modelDefinitionsApi.createSupportDomainElement({
        modelId: element.modelId,
        name: uniqueCopyName(element.name, state.supportDomainElements.map((item) => item.name)),
        displayName: element.displayName ? uniqueCopyName(element.displayName, state.supportDomainElements.map((item) => item.displayName)) : '',
        badge: element.badge.badgeText,
        description: element.description,
        status: element.status,
      });
      await controller.refreshSupportDomainSelection();
      controller.selectSupportDomainElement(created.id);
      showToast(`Duplicated as “${created.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to duplicate element type.', 'error');
    }
  };

  // ── Views ────────────────────────────────────────────────────────────────
  const views = projectionsFor('mws', params.tab, openModel?.kind ?? null);
  const view = params.view ?? views[0] ?? null;
  const setView = (next: typeof view) => update({ view: next }, { replace: true });

  const selectedNode = state.hierarchyNodes.find((node) => node.id === state.hierarchyNodeDraft.id) ?? null;
  const selectedElement = state.supportDomainElements.find((element) => element.id === state.selectedSupportDomainElementId) ?? null;

  // ── Save / Cancel: enabled only for a real, valid change ──────────────────
  const nodeDraft = state.hierarchyNodeDraft;
  const nodeFieldsChanged = creatingNode
    ? true
    : Boolean(
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
  // Put the saved values back, synchronously, so nothing can race a selection that follows.
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
  const cancelNodeEdit = () => {
    if (creatingNode) {
      setCreatingNode(false);
      void controller.selectHierarchyNode(nodeDraft.parentNodeId ?? null);
    } else {
      resetNodeDraft();
    }
  };
  const saveNode = async () => {
    if (!nodeCanSave) return;
    if (nodeFieldsChanged) await nodeSaveRef.current?.();
    if (hierarchyBadge.dirty) await hierarchyBadge.onSave();
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
  const saveElement = async () => {
    if (!elementCanSave) return;
    if (elementFieldsChanged) await controller.saveSupportDomainElement();
    if (elementBadge.dirty) await elementBadge.onSave();
  };
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

  /** Run `action` now, or — when there are unsaved edits — once the person agrees to drop them. */
  const hasUnsaved = (openModel?.kind === 'hierarchy' && nodeChanged) || (openModel?.kind === 'support' && elementChanged);
  function guardUnsaved(action: () => void) {
    if (hasUnsaved) setPendingDiscard(() => action);
    else action();
  }


  const hierarchyBody = () => {
    if (view === 'list') {
      return (
        <WorkspaceBody
          storageKey="mws-hierarchy-list"
          authoring={
            <AuthoringPanel title="Hierarchy List Workspace" hint="Every node type and relationship of the selected hierarchy model — edit, duplicate and delete in line.">
              {inherited}
              <HierarchyListView
                onTypeContextMenu={typeMenu}
                modelId={openModel!.id}
                nodes={state.hierarchyNodes}
                rules={state.hierarchyRules}
                lifecycleStatuses={state.metadata.lifecycleStatuses}
                relationshipKinds={state.metadata.relationshipKinds}
                selectedNodeId={state.selectedHierarchyNodeId}
                onSelectNode={selectNode}
                onRefresh={controller.refreshHierarchySelection}
                onDeleted={(id) => controller.deleteHierarchyNode(id)}
              />
            </AuthoringPanel>
          }
        />
      );
    }
    const nodeLabel = selectedNode ? displayLabel(selectedNode) : 'node type';
    return (
      <WorkspaceBody
        storageKey="mws-hierarchy"
        authoring={
          <AuthoringPanel
            title="Hierarchy Authoring Workspace"
            hint="Select a node type · + adds a child · ↑↓ reorders · “Parent of” relationships are created automatically"
            toolbar={
              controller.hierarchyTree.length === 0 ? (
                <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={addRoot}>
                  Root Node Type
                </Button>
              ) : undefined
            }
            flush
          >
            {inherited && <Box sx={{ px: 1, pt: 1 }}>{inherited}</Box>}
            <NodeTypeTreePanel
              items={controller.hierarchyTree}
              selectedNodeId={state.selectedHierarchyNodeId}
              onSelectNode={selectNode}
              onContextMenuNode={typeMenu}
              revealRequest={revealRequest}
              onAddChild={addChild}
              onReorderNode={(nodeId, parentId, position, confirm, assignments) => void controller.reorderHierarchyNode(nodeId, parentId, position, confirm, assignments)}
            />
          </AuthoringPanel>
        }
        element={{
          title: 'Node Type Details',
          isEmpty: !state.hierarchyNodeDraft.id && !creatingNode,
          empty: 'Select a node type in the hierarchy, or add a child to one.',
          flush: true,
          actions: selectedNode || creatingNode ? (
            <Stack direction="row">
              <SaveAction label={creatingNode ? 'new node type' : nodeLabel} disabled={!nodeCanSave} onClick={() => void saveNode()} />
              {nodeChanged && <CancelAction label={creatingNode ? 'new node type' : nodeLabel} onClick={cancelNodeEdit} />}
              {selectedNode?.parentNodeId && <DuplicateAction label={nodeLabel} onClick={() => guardUnsaved(() => void duplicateNode(selectedNode.id))} />}
              {selectedNode?.parentNodeId && <DeleteAction label={nodeLabel} onClick={() => setDeleteNodeId(selectedNode.id)} />}
            </Stack>
          ) : undefined,
          content: (
            <SelectedNodeTypeEditor
              key={state.hierarchyNodeDraft.id ?? `new-${nodeEditorKey}`}
              embedded
              saveRef={nodeSaveRef}
              draft={state.hierarchyNodeDraft}
              properties={state.hierarchyNodeProperties}
              propertyFormData={state.hierarchyNodePropertyFormData}
              persistedIsRecursive={selectedNode?.isRecursive ?? false}
              hasChildren={selectedNode ? state.hierarchyNodes.some((node) => node.parentNodeId === selectedNode.id) : false}
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
                setCreatingNode(false);
              }}
              onSaveProperty={controller.saveHierarchyModelNodeTypeProperty}
              onDeleteProperty={(id) => void controller.deleteHierarchyNodeProperty(id)}
              onDelete={state.hierarchyNodeDraft.id ? () => void controller.deleteHierarchyNode(state.hierarchyNodeDraft.id!) : undefined}
              onBadgeChange={hierarchyBadge.onChange}
              onBadgeReset={() => void hierarchyBadge.onReset()}
            />
          ),
        }}
        relationship={{
          title: 'Relationship Details',
          isEmpty: !selectedNode,
          empty: 'Select a node type to see its immediate relationships.',
          content: selectedNode && (
            <RelationshipDetailsList
              groups={nodeTypeRelationshipGroups({
                nodeId: selectedNode.id,
                nodes: state.hierarchyNodes,
                rules: state.hierarchyRules,
                crossTypes: state.crossModelRelationshipTypes,
                relationshipKinds: state.metadata.relationshipKinds,
                onSelectNode: selectNode,
              })}
            />
          ),
        }}
      />
    );
  };

  const supportBody = () => {
    const addButtons = (
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={openAddElement}>
          Element
        </Button>
        <Button size="small" variant="outlined" startIcon={<AddOutlined />} onClick={openAddRelationship} disabled={state.supportDomainElements.length < 2}>
          Relationship
        </Button>
      </Stack>
    );
    if (view === 'list') {
      return (
        <WorkspaceBody
          storageKey="mws-support-list"
          authoring={
            <AuthoringPanel title="Support Domain List Workspace" hint="Every element type and relationship of the selected support domain model — edit, duplicate and delete in line." toolbar={addButtons}>
              {inherited}
              <SupportDomainListView
                onTypeContextMenu={typeMenu}
                modelId={openModel!.id}
                elements={state.supportDomainElements}
                relationships={state.supportDomainRelationships}
                lifecycleStatuses={state.metadata.lifecycleStatuses}
                relationshipKinds={state.metadata.relationshipKinds}
                selectedElementId={state.selectedSupportDomainElementId}
                onSelectElement={(id) => guardUnsaved(() => void controller.selectSupportDomainElement(id))}
                onDeleteElement={setDeleteElementId}
                onDeleteRelationship={(id) => void controller.deleteSupportDomainRelationship(id)}
                onDuplicateRelationship={openDuplicateRelationship}
                onRefresh={controller.refreshSupportDomainSelection}
              />
            </AuthoringPanel>
          }
        />
      );
    }
    const elementLabel = selectedElement ? displayLabel(selectedElement) : 'element type';
    return (
      <WorkspaceBody
        storageKey="mws-support-diagram"
        authoring={
          <AuthoringPanel
            title="Support Domain Diagram Workspace"
            hint={
              inheritedSupport?.elements.length
                ? 'Select an element type to see its details · drag from an inherited element type to one of this model’s (or back) to relate them.'
                : 'Select an element type to see its details · drag between element types to relate them · click a connector to view or edit it.'
            }
            toolbar={addButtons}
            flush
          >
            {inherited && <Box sx={{ px: 1, pt: 1 }}>{inherited}</Box>}
            <Box sx={{ flex: 1, minHeight: 420, p: 1 }}>
              <SupportDomainDiagram
                onElementContextMenu={(id, event) => {
                  const element = state.supportDomainElements.find((item) => item.id === id);
                  if (element) typeMenu(id, displayLabel(element), event);
                }}
                modelId={openModel!.id}
                elements={state.supportDomainElements}
                relationships={state.supportDomainRelationships}
                focusedElementId={state.selectedSupportDomainElementId}
                onConnectElements={(sourceId, targetId) => guardUnsaved(() => openRelationshipBetween(sourceId, targetId))}
                onSelectElement={(id) => guardUnsaved(() => void controller.selectSupportDomainElement(id))}
                inherited={inheritedSupport}
                onConnectInherited={(sourceId, targetId) => guardUnsaved(() => openInheritedLink(sourceId, targetId))}
                onEditRelationship={(id) => guardUnsaved(() => openEditRelationship(id))}
                onDeleteRelationship={(id) => guardUnsaved(() => void controller.deleteSupportDomainRelationship(id))}
              />
              {inheritedLinkDialog}
            </Box>
          </AuthoringPanel>
        }
        element={{
          title: 'Element Type Details',
          isEmpty: !selectedElement,
          empty: 'Select an element type on the diagram.',
          flush: true,
          actions: selectedElement ? (
            <Stack direction="row">
              <SaveAction label={elementLabel} disabled={!elementCanSave} onClick={() => void saveElement()} />
              {elementChanged && <CancelAction label={elementLabel} onClick={cancelElementEdit} />}
              <DuplicateAction label={elementLabel} onClick={() => guardUnsaved(() => void duplicateElement(selectedElement.id))} />
              <DeleteAction label={elementLabel} onClick={() => setDeleteElementId(selectedElement.id)} />
            </Stack>
          ) : undefined,
          content: (
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
        }}
        relationship={{
          title: 'Relationship Details',
          isEmpty: !selectedElement,
          empty: 'Select an element type to see its immediate relationships.',
          content: selectedElement && (
            <RelationshipDetailsList
              groups={elementTypeRelationshipGroups({
                elementId: selectedElement.id,
                elements: state.supportDomainElements,
                relationships: state.supportDomainRelationships,
                crossTypes: state.crossModelRelationshipTypes,
                relationshipKinds: state.metadata.relationshipKinds,
                onSelectElement: (id) => guardUnsaved(() => void controller.selectSupportDomainElement(id)),
              })}
            />
          ),
        }}
      />
    );
  };

  const counts = !openModel
    ? []
    : openModel.kind === 'hierarchy'
      ? [
          { label: 'Node Types', value: state.hierarchyNodes.length },
          { label: 'Relationships', value: state.hierarchyNodes.filter((node) => node.parentNodeId).length + state.hierarchyNodes.filter((node) => node.isRecursive).length },
        ]
      : [
          { label: 'Element Types', value: state.supportDomainElements.length },
          { label: 'Relationships', value: state.supportDomainRelationships.length },
        ];

  const deleteNode = deleteNodeId ? state.hierarchyNodes.find((node) => node.id === deleteNodeId) : undefined;
  const deleteElement = deleteElementId ? state.supportDomainElements.find((element) => element.id === deleteElementId) : undefined;

  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 520, display: 'flex' }}>
      <ModelNav
        value={params.tab}
        tabs={WORKSPACE_TABS.mws}
        onChange={(tab) => guardUnsaved(() => update({ tab }))}
        trailing={
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <CreatePackageButton />
            <CreateModelButton
              onCreate={() =>
                guardUnsaved(() => {
                  setCreatePackageId(undefined);
                  setCreateModelOpen(true);
                })
              }
            />
          </Stack>
        }
      />
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}

      {params.tab === 'model' && (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 1 }}>
          <ModelSelectionPanel
            models={models}
            selected={openModel ? { kind: openModel.kind, id: openModel.id } : null}
            onSelect={chooseModel}
            onHome={goHome}
            collapsed={selectionCollapsed}
            onToggleCollapsed={() => setSelectionCollapsed(!selectionCollapsed)}
            loading={state.loading}
            manage={{
              onCreateInPackage: (packageId) =>
                guardUnsaved(() => {
                  setCreatePackageId(packageId);
                  setCreateModelOpen(true);
                }),
            }}
          />
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {!openModel ? (
              addressKey ? (
                <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>
              ) : (
                <WorkspaceLanding workspace="mws" models={models} recent={recent} onOpen={chooseModel} />
              )
            ) : (
              <>
                <ModelHeaderCard
                  model={openModel}
                  counts={counts}
                  onEdit={startEdit}
                  editTooltip="Edit or delete this model"
                  meta={
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.25} sx={{ mt: 0.25 }}>
                      <Tooltip title="Package · change it, or what this model extends">
                        <Chip
                          size="small"
                          icon={<FolderOutlined sx={{ fontSize: '14px !important' }} />}
                          label={`Package: ${openPackageName}`}
                          onClick={() => setPackageDialogOpen(true)}
                          variant="outlined"
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      </Tooltip>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <ModelKindIcon kind={openModel.kind} size={16} />
                        <Typography variant="caption" color="text.secondary">{MODEL_KIND_LABEL[openModel.kind]}</Typography>
                      </Stack>
                      {openKey && isCommon(packageState, openKey) && (
                        <Chip size="small" label="Common model" color="warning" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                      )}
                      {baseModel && (
                        <Tooltip title={`Open the common model ${baseModel.name}`}>
                          <Chip
                            size="small"
                            icon={<CallSplitOutlined sx={{ fontSize: '14px !important', transform: 'rotate(180deg)' }} />}
                            label={`Extends: ${baseModel.name}`}
                            onClick={() => chooseModel(baseModel.kind, baseModel.id)}
                            color="secondary"
                            variant="outlined"
                            sx={{ height: 20, fontSize: 11 }}
                          />
                        </Tooltip>
                      )}
                    </Stack>
                  }
                />
                <ProjectionNav views={views} value={view} onChange={setView} />
                {openModel.kind === 'hierarchy' ? hierarchyBody() : supportBody()}
              </>
            )}
          </Stack>
        </Box>
      )}

      {params.tab === 'relationship' && (
        <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
          <ProjectionNav views={views} value={view} onChange={setView} />
          <MwsRelationshipWorkspace
            view={view ?? 'matrix'}
            models={models}
            rows={state.crossModelRelationshipTypes}
            draft={state.crossModelRelationshipTypeDraft}
            lifecycleStatuses={state.metadata.lifecycleStatuses}
            validation={state.validation.crossModelRelationshipType}
            saving={state.saving}
            onChange={controller.updateCrossModelRelationshipTypeDraft}
            onSave={() => void controller.saveCrossModelRelationshipType()}
            onSelectType={controller.selectCrossModelRelationshipType}
            onDeleteById={(id) => void controller.deleteCrossModelRelationshipType(id)}
            onRefresh={controller.refreshCrossModelRelationshipTypes}
          />
        </Stack>
      )}


      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
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
              if (creatingNode) setCreatingNode(false);
              else if (nodeChanged) resetNodeDraft();
              if (elementChanged) cancelElementEdit();
              action?.();
            }}
          >
            Discard
          </Button>
        </DialogActions>
      </Dialog>
      {packageDialogOpen && <ModelPackageDialog model={openModel} models={models} onClose={() => setPackageDialogOpen(false)} />}
      <CreateModelDialog
        open={createModelOpen}
        models={models}
        initialPackageId={createPackageId ?? (openKey ? packageIdOf(packageState, openKey) : undefined)}
        lifecycleStatuses={state.metadata.lifecycleStatuses}
        saving={state.saving}
        onDraftChange={(form: CreateModelForm) => {
          if (form.kind === 'hierarchy') {
            controller.updateHierarchyModelDraft({
              id: undefined,
              name: form.name,
              purpose: form.purpose,
              status: form.status,
              // Not asked for in Create Model: the first owning domain, as before.
              owningDomain: state.metadata.owningDomains[0]?.key ?? '',
            });
          } else {
            controller.updateSupportDomainModelDraft({ id: undefined, name: form.name, purpose: form.purpose, status: form.status });
          }
        }}
        onCreate={async (kind, form) => {
          // The new model becomes the open one once it has been saved, in its Package.
          expectCreatedRef.current = true;
          placementRef.current = { packageId: form.packageId, extendsKey: form.extendsKey };
          try {
            if (kind === 'hierarchy') await controller.saveHierarchyModel();
            else await controller.saveSupportDomainModel();
          } catch (error) {
            expectCreatedRef.current = false;
            placementRef.current = null;
            throw error;
          }
        }}
        onClose={() => setCreateModelOpen(false)}
      />
      {/* Edit Model: the same fields as Create Model, for both model types. */}
      <EditModelDialog
        open={modelDialog === 'hierarchy'}
        kind="hierarchy"
        draft={state.hierarchyModelDraft}
        lifecycleStatuses={state.metadata.lifecycleStatuses}
        models={models}
        validation={state.validation.hierarchyModel}
        saving={state.saving}
        onChange={controller.updateHierarchyModelDraft}
        onSave={() => {
          void controller.saveHierarchyModel();
          setModelDialog(null);
        }}
        onDelete={state.hierarchyModelDraft.id ? () => { setModelDialog(null); setDeleteModelKind('hierarchy'); } : undefined}
        onClose={() => setModelDialog(null)}
      />
      <EditModelDialog
        open={modelDialog === 'support'}
        kind="support"
        draft={state.supportDomainModelDraft}
        lifecycleStatuses={state.metadata.lifecycleStatuses}
        models={models}
        validation={state.validation.supportDomainModel}
        saving={state.saving}
        onChange={controller.updateSupportDomainModelDraft}
        onSave={() => {
          void controller.saveSupportDomainModel();
          setModelDialog(null);
        }}
        onDelete={state.supportDomainModelDraft.id ? () => { setModelDialog(null); setDeleteModelKind('support'); } : undefined}
        onClose={() => setModelDialog(null)}
      />
      {finder.element}
      <DeleteHierarchyModelDialog
        modelId={deleteModelKind === 'hierarchy' && openModel ? openModel.id : null}
        modelName={openModel?.name ?? 'Hierarchy Model'}
        deleting={state.saving}
        onConfirm={() => void deleteOpenModel()}
        onClose={() => setDeleteModelKind(null)}
      />
      <DeleteSupportDomainDialog
        kind="model"
        targetId={deleteModelKind === 'support' && openModel ? openModel.id : null}
        targetName={openModel?.name ?? 'Support Domain Model'}
        deleting={state.saving}
        onConfirm={() => void deleteOpenModel()}
        onClose={() => setDeleteModelKind(null)}
      />
      <DeleteNodeTypeDialog
        nodeId={deleteNodeId}
        nodeName={deleteNode ? displayLabel(deleteNode) : 'Node type'}
        onConfirm={async () => {
          if (deleteNodeId) await controller.deleteHierarchyNode(deleteNodeId);
          setDeleteNodeId(null);
        }}
        onClose={() => setDeleteNodeId(null)}
      />
      <CreateEditSupportDomainElementDialog
        open={elementDialogOpen}
        draft={state.supportDomainElementDraft}
        lifecycleStatuses={state.metadata.lifecycleStatuses}
        validation={state.validation.supportDomainElement}
        saving={state.saving}
        onChange={controller.updateSupportDomainElementDraft}
        onSave={() => {
          void controller.saveSupportDomainElement();
          setPendingElementSave(true);
        }}
        onClose={() => setElementDialogOpen(false)}
      />
      <CreateEditSupportDomainRelationshipDialog
        open={relationshipDialogOpen}
        draft={state.supportDomainRelationshipDraft}
        elements={state.supportDomainElements}
        relationshipKinds={state.metadata.relationshipKinds}
        lifecycleStatuses={state.metadata.lifecycleStatuses}
        modelName={openModel?.kind === 'support' ? openModel.name : undefined}
        relationships={state.supportDomainRelationships}
        validation={state.validation.supportDomainRelationship}
        saving={state.saving}
        onChange={controller.updateSupportDomainRelationshipDraft}
        onSave={() => {
          void controller.saveSupportDomainRelationship();
          setPendingRelationshipSave(true);
        }}
        onDelete={
          state.supportDomainRelationshipDraft.id
            ? () => {
                void controller.deleteSupportDomainRelationship(state.supportDomainRelationshipDraft.id!);
                setRelationshipDialogOpen(false);
              }
            : undefined
        }
        onClose={() => setRelationshipDialogOpen(false)}
      />
      <DeleteSupportDomainDialog
        kind="element"
        targetId={deleteElementId}
        targetName={deleteElement ? displayLabel(deleteElement) : 'Support Domain Element Type'}
        deleting={state.saving}
        onConfirm={() => {
          if (deleteElementId) void controller.deleteSupportDomainElement(deleteElementId);
          setDeleteElementId(null);
        }}
        onClose={() => setDeleteElementId(null)}
      />
    </Stack>
  );
}
