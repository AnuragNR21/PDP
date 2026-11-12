import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { modelDefinitionsApi } from '../api/modelDefinitionsApi';
import { useToast } from '@/shared/toast/ToastContext';
import type {
  ModelDefinitionsState,
  HierarchyModelDraft,
  HierarchyNodeTypePropertyFormData,
  HierarchyNodeDraft,
  SupportDomainElementDraft,
  SupportDomainModelDraft,
  SupportDomainElementPropertyData,
  SupportDomainRelationshipDraft,
  CrossModelRelationshipTypeDraft,
  InstanceParentAssignment,
} from '../domain/types';
import {
  validateHierarchyModelDraft,
  validateHierarchyNodePropertyFormData,
  validateHierarchyNodeDraft,
  validateSupportDomainElementDraft,
  validateSupportDomainModelDraft,
  validateSupportDomainElementPropertyData,
  validateSupportDomainRelationshipDraft,
  validateCrossModelRelationshipTypeDraft,
} from '../domain/invariants';
import { buildHierarchyTree } from '../domain/mappers';

const emptyMetadata = { tabs: [], owningDomains: [], lifecycleStatuses: [], relationshipKinds: [] };
const pickFirst = (items: { key: string }[], fallback = '') => items[0]?.key ?? fallback;
const uniqueKey = (value: string) => value.trim().toLocaleLowerCase();
const nodeDisplayNameKey = (node: { name: string; displayName: string }) => uniqueKey(node.displayName || node.name);

type LoadAllPreserve = Pick<
  ModelDefinitionsState,
  | 'activeTab'
  | 'selectedHierarchyModelId'
  | 'selectedSupportDomainModelId'
  | 'selectedHierarchyNodeId'
  | 'selectedSupportDomainElementId'
>;

export function useModelDefinitionsController() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const invalidateCrossModelQueries = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['cross-model-links-all'] }),
    queryClient.invalidateQueries({ queryKey: ['cross-model-links-source'] }),
    queryClient.invalidateQueries({ queryKey: ['cross-model-relationship-types'] }),
    queryClient.invalidateQueries({ queryKey: ['cross-model-type-options'] }),
  ]);
  const [state, setState] = useState<ModelDefinitionsState>({
    loading: true,
    saving: false,
    error: null,
    activeTab: 'hierarchyModel',
    metadata: emptyMetadata,
    hierarchyModels: [],
    supportDomainModels: [],
    selectedHierarchyModelId: null,
    selectedSupportDomainModelId: null,
    hierarchyNodes: [],
    hierarchyNodeProperties: [],
    hierarchyRules: [],
    selectedHierarchyNodeId: null,
    supportDomainElements: [],
    supportDomainElementProperties: [],
    supportDomainRelationships: [],
    selectedSupportDomainElementId: null,
    selectedSupportDomainRelationshipId: null,
    crossModelRelationshipTypes: [],
    selectedCrossModelRelationshipTypeId: null,
    hierarchyModelDraft: { name: '', purpose: '', owningDomain: '', status: '' },
    hierarchyNodeDraft: { modelId: '', parentNodeId: null, name: '', displayName: '', badge: '', description: '', isRecursive: false, isProperty: false, status: '' },
    hierarchyNodePropertyFormData: { nodeTypeId: '', name: '', description: '', inheritable: false, status: '' },
    supportDomainModelDraft: { name: '', purpose: '', status: '' },
    supportDomainElementDraft: { modelId: '', name: '', displayName: '', badge: '', description: '', status: '' },
    supportDomainElementPropertyData: { elementId: '', name: '', description: '', status: '' },
    supportDomainRelationshipDraft: { modelId: '', sourceElementId: '', targetElementId: '', relationshipKind: '', notes: '', status: '' },
    crossModelRelationshipTypeDraft: { name: '', description: '', sourceModelType: 'HIERARCHY_MODEL', sourceModelItemTypeId: null, targetModelType: 'HIERARCHY_MODEL', targetModelItemTypeId: null, status: 'active' },
    validation: { hierarchyModel: {}, hierarchyNode: {}, hierarchyNodeProperty: {}, supportDomainModel: {}, supportDomainElement: {}, supportDomainElementProperty: {}, supportDomainRelationship: {}, crossModelRelationshipType: {} },
  });

  const loadAll = useCallback(async (preserve?: Partial<LoadAllPreserve>) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [metadata, hierarchyModels, supportDomainModels] = await Promise.all([
        modelDefinitionsApi.getMetadata(),
        modelDefinitionsApi.listHierarchyModels(),
        modelDefinitionsApi.listSupportDomainModels(),
      ]);

      const selectedHierarchyModelId = preserve?.selectedHierarchyModelId ?? hierarchyModels[0]?.id ?? null;
      const selectedSupportDomainModelId = preserve?.selectedSupportDomainModelId ?? supportDomainModels[0]?.id ?? null;

      const [hierarchyNodes, hierarchyRules, supportDomainElements, supportDomainRelationships, crossModelRelationshipTypes] = await Promise.all([
        selectedHierarchyModelId ? modelDefinitionsApi.listHierarchyNodeTypes(selectedHierarchyModelId) : Promise.resolve([]),
        selectedHierarchyModelId ? modelDefinitionsApi.listHierarchyRules(selectedHierarchyModelId) : Promise.resolve([]),
        selectedSupportDomainModelId ? modelDefinitionsApi.listSupportDomainElements(selectedSupportDomainModelId) : Promise.resolve([]),
        selectedSupportDomainModelId ? modelDefinitionsApi.listSupportDomainRelationships(selectedSupportDomainModelId) : Promise.resolve([]),
        modelDefinitionsApi.listCrossModelRelationshipTypes(),
      ]);
      const selectedHierarchyNodeId =
        preserve?.selectedHierarchyNodeId &&
        hierarchyNodes.some((item) => item.id === preserve.selectedHierarchyNodeId)
          ? preserve.selectedHierarchyNodeId
          : null;
      const hierarchyNodeProperties = selectedHierarchyNodeId
        ? await modelDefinitionsApi.listHierarchyModelNodeTypeProperties(selectedHierarchyModelId!, selectedHierarchyNodeId)
        : [];
      const selectedSupportDomainElementId =
        preserve?.selectedSupportDomainElementId &&
        supportDomainElements.some((item) => item.id === preserve.selectedSupportDomainElementId)
          ? preserve.selectedSupportDomainElementId
          : null;
      const supportDomainElementProperties = selectedSupportDomainElementId
        ? await modelDefinitionsApi.listSupportDomainElementProperties(selectedSupportDomainModelId!, selectedSupportDomainElementId)
        : [];

      const defaultDomain = pickFirst(metadata.owningDomains, 'information');
      const defaultStatus = pickFirst(metadata.lifecycleStatuses, 'draft');
      const defaultRelationshipKind = metadata.relationshipKinds.find((item) => item.key !== 'parent_child')?.key ?? pickFirst(metadata.relationshipKinds);
      const resolvedHierarchyNodeDraft: HierarchyNodeDraft = (() => {
        const preselectedNode = selectedHierarchyNodeId
          ? hierarchyNodes.find((n) => n.id === selectedHierarchyNodeId) ?? null
          : null;
        return preselectedNode
          ? {
              id: preselectedNode.id,
              modelId: preselectedNode.modelId,
              parentNodeId: preselectedNode.parentNodeId,
              name: preselectedNode.name,
              displayName: preselectedNode.displayName,
              badge: preselectedNode.badge.badgeText,
              description: preselectedNode.description,
              isRecursive: preselectedNode.isRecursive,
              isProperty: preselectedNode.isProperty,
              status: preselectedNode.status,
            }
          : {
              modelId: selectedHierarchyModelId ?? '',
              parentNodeId: null,
              name: '',
              displayName: '',
              badge: '',
              description: '',
              isRecursive: false,
              isProperty: false,
              status: defaultStatus,
            };
      })();

      setState((current): ModelDefinitionsState => {
        const nextState: ModelDefinitionsState = {
          ...current,
          ...preserve,
          loading: false,
          metadata,
          hierarchyModels,
          supportDomainModels,
          selectedHierarchyModelId,
          selectedSupportDomainModelId,
          hierarchyNodes,
          hierarchyNodeProperties,
          hierarchyRules,
          selectedHierarchyNodeId,
          supportDomainElements,
          supportDomainElementProperties,
          supportDomainRelationships,
          selectedSupportDomainElementId,
          crossModelRelationshipTypes,
          hierarchyModelDraft:
            selectedHierarchyModelId
              ? (() => {
                  const model = hierarchyModels.find((item) => item.id === selectedHierarchyModelId)!;
                  return { id: model.id, name: model.name, purpose: model.purpose, owningDomain: model.owningDomain, status: model.status };
                })()
              : { name: '', purpose: '', owningDomain: defaultDomain, status: defaultStatus },
          hierarchyNodeDraft: resolvedHierarchyNodeDraft,
          hierarchyNodePropertyFormData:
            { nodeTypeId: selectedHierarchyNodeId ?? '', name: '', description: '', inheritable: false, status: defaultStatus },
          supportDomainModelDraft:
            selectedSupportDomainModelId
              ? (() => {
                  const model = supportDomainModels.find((item) => item.id === selectedSupportDomainModelId)!;
                  return { id: model.id, name: model.name, purpose: model.purpose, status: model.status };
                })()
              : { name: '', purpose: '', status: defaultStatus },
          supportDomainElementDraft:
            selectedSupportDomainElementId
              ? (() => {
                  const element = supportDomainElements.find((item) => item.id === selectedSupportDomainElementId)!;
                  return { id: element.id, modelId: element.modelId, name: element.name, displayName: element.displayName, badge: element.badge.badgeText, description: element.description, status: element.status };
                })()
              : { modelId: selectedSupportDomainModelId ?? '', name: '', displayName: '', badge: '', description: '', status: defaultStatus },
          supportDomainElementPropertyData:
            { elementId: selectedSupportDomainElementId ?? '', name: '', description: '', status: defaultStatus },
          supportDomainRelationshipDraft:
            {
              modelId: selectedSupportDomainModelId ?? '',
              sourceElementId: '',
              targetElementId: '',
              relationshipKind: defaultRelationshipKind,
              notes: '',
              status: defaultStatus,
            },
          crossModelRelationshipTypeDraft:
            { name: '', description: '', sourceModelType: 'HIERARCHY_MODEL', sourceModelItemTypeId: null, targetModelType: 'HIERARCHY_MODEL', targetModelItemTypeId: null, status: 'active' },
          validation: { hierarchyModel: {}, hierarchyNode: {}, hierarchyNodeProperty: {}, supportDomainModel: {}, supportDomainElement: {}, supportDomainElementProperty: {}, supportDomainRelationship: {}, crossModelRelationshipType: {} },
        };
        return nextState;
      });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to load Model workspace.' }));
    }
  }, []);

  useEffect(() => {
    const initialModelId = searchParams.get('model_id');
    const initialNodeTypeId = searchParams.get('node_type_id');
    void loadAll({
      ...(initialModelId ? { selectedHierarchyModelId: initialModelId } : {}),
      ...(initialNodeTypeId ? { selectedHierarchyNodeId: initialNodeTypeId } : {}),
    });
  }, [loadAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadHierarchySelection = useCallback(async (modelId: string | null) => {
    const [hierarchyNodes, hierarchyRules] = await Promise.all([
      modelId ? modelDefinitionsApi.listHierarchyNodeTypes(modelId) : Promise.resolve([]),
      modelId ? modelDefinitionsApi.listHierarchyRules(modelId) : Promise.resolve([]),
    ]);
    setState((current) => ({
      ...current,
      selectedHierarchyModelId: modelId,
      hierarchyNodes,
      hierarchyNodeProperties: [],
      hierarchyRules,
      selectedHierarchyNodeId: null,
      // No node is selected any more, so the draft must not keep the previous
      // node's id: with that id and these blank fields, the panel compared a
      // saved node with an empty draft and reported unsaved changes (seen after
      // saving a model's package / extension, which reloads the same model).
      hierarchyNodeDraft: { ...current.hierarchyNodeDraft, id: undefined, modelId: modelId ?? '', parentNodeId: null, name: '', displayName: '', badge: '', description: '', isRecursive: false, isProperty: false },
      hierarchyNodePropertyFormData: { nodeTypeId: '', name: '', description: '', inheritable: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      hierarchyModelDraft: modelId
        ? (() => {
            const model = current.hierarchyModels.find((item) => item.id === modelId);
            return model ? { id: model.id, name: model.name, purpose: model.purpose, owningDomain: model.owningDomain, status: model.status } : current.hierarchyModelDraft;
          })()
        : { name: '', purpose: '', owningDomain: pickFirst(current.metadata.owningDomains, 'information'), status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
    }));
  }, []);

  const reloadSupportSelection = useCallback(async (modelId: string | null) => {
    const [supportDomainElements, supportDomainRelationships] = await Promise.all([
      modelId ? modelDefinitionsApi.listSupportDomainElements(modelId) : Promise.resolve([]),
      modelId ? modelDefinitionsApi.listSupportDomainRelationships(modelId) : Promise.resolve([]),
    ]);
    setState((current) => ({
      ...current,
      selectedSupportDomainModelId: modelId,
      supportDomainElements,
      supportDomainElementProperties: [],
      supportDomainRelationships,
      selectedSupportDomainElementId: null,
      selectedSupportDomainRelationshipId: null,
      supportDomainElementDraft: { ...current.supportDomainElementDraft, modelId: modelId ?? '', name: '', displayName: '', badge: '', description: '' },
      supportDomainElementPropertyData: { elementId: '', name: '', description: '', status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      supportDomainRelationshipDraft: {
        ...current.supportDomainRelationshipDraft,
        modelId: modelId ?? '',
        sourceElementId: '',
        targetElementId: '',
      },
      supportDomainModelDraft: modelId
        ? (() => {
            const model = current.supportDomainModels.find((item) => item.id === modelId);
            return model ? { id: model.id, name: model.name, purpose: model.purpose, status: model.status } : current.supportDomainModelDraft;
          })()
        : { name: '', purpose: '', status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
    }));
  }, []);

  const setActiveTab = (tab: 'hierarchyModel' | 'supportDomain') => setState((current) => ({ ...current, activeTab: tab }));

  const selectHierarchyModel = async (modelId: string | null) => {
    await reloadHierarchySelection(modelId);
    setState((current) => ({ ...current, activeTab: 'hierarchyModel', selectedSupportDomainModelId: null }));
  };

  const selectSupportDomainModel = async (modelId: string | null) => {
    await reloadSupportSelection(modelId);
    setState((current) => ({ ...current, activeTab: 'supportDomain', selectedHierarchyModelId: null }));
  };

  const updateHierarchyModelDraft = (patch: Partial<HierarchyModelDraft>) =>
    setState((current) => ({ ...current, hierarchyModelDraft: { ...current.hierarchyModelDraft, ...patch } }));
  const updateHierarchyNodeDraft = (patch: Partial<HierarchyNodeDraft>) =>
    setState((current) => {
      const hierarchyNodeValidation = { ...current.validation.hierarchyNode };
      if ('name' in patch) {
        delete hierarchyNodeValidation.name;
      }
      if ('displayName' in patch) {
        delete hierarchyNodeValidation.displayName;
      }
      return {
        ...current,
        hierarchyNodeDraft: { ...current.hierarchyNodeDraft, ...patch },
        validation: {
          ...current.validation,
          hierarchyNode: hierarchyNodeValidation,
        },
      };
    });
  const updateHierarchyNodePropertyFormData = (patch: Partial<HierarchyNodeTypePropertyFormData>) =>
    setState((current) => ({ ...current, hierarchyNodePropertyFormData: { ...current.hierarchyNodePropertyFormData, ...patch } }));
  const updateSupportDomainModelDraft = (patch: Partial<SupportDomainModelDraft>) =>
    setState((current) => ({ ...current, supportDomainModelDraft: { ...current.supportDomainModelDraft, ...patch } }));
  const updateSupportDomainElementDraft = (patch: Partial<SupportDomainElementDraft>) =>
    setState((current) => ({ ...current, supportDomainElementDraft: { ...current.supportDomainElementDraft, ...patch } }));
  const updateSupportDomainElementPropertyData = (patch: Partial<SupportDomainElementPropertyData>) =>
    setState((current) => ({ ...current, supportDomainElementPropertyData: { ...current.supportDomainElementPropertyData, ...patch } }));
  const updateSupportDomainRelationshipDraft = (patch: Partial<SupportDomainRelationshipDraft>) =>
    setState((current) => ({ ...current, supportDomainRelationshipDraft: { ...current.supportDomainRelationshipDraft, ...patch } }));

  const updateCrossModelRelationshipTypeDraft = (patch: Partial<CrossModelRelationshipTypeDraft>) =>
    setState((current) => ({ ...current, crossModelRelationshipTypeDraft: { ...current.crossModelRelationshipTypeDraft, ...patch } }));

  const selectCrossModelRelationshipType = (id: string | null) => {
    const found = state.crossModelRelationshipTypes.find((t) => t.id === id) ?? null;
    setState((current) => ({
      ...current,
      selectedCrossModelRelationshipTypeId: id,
      crossModelRelationshipTypeDraft: found
        ? { id: found.id, name: found.name, description: found.description ?? '', sourceModelType: found.sourceModelType, sourceModelItemTypeId: found.sourceModelItemTypeId, targetModelType: found.targetModelType, targetModelItemTypeId: found.targetModelItemTypeId, status: found.status }
        : { name: '', description: '', sourceModelType: 'HIERARCHY_MODEL', sourceModelItemTypeId: null, targetModelType: 'HIERARCHY_MODEL', targetModelItemTypeId: null, status: 'active' },
      validation: { ...current.validation, crossModelRelationshipType: {} },
    }));
  };

  const saveCrossModelRelationshipType = async () => {
    const draft = state.crossModelRelationshipTypeDraft;
    const errors = validateCrossModelRelationshipTypeDraft(draft);
    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, crossModelRelationshipType: errors } }));
      return;
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      const isEdit = !!draft.id;
      if (isEdit) {
        await modelDefinitionsApi.updateCrossModelRelationshipType(draft.id!, draft);
      } else {
        await modelDefinitionsApi.createCrossModelRelationshipType(draft);
      }
      const crossModelRelationshipTypes = await modelDefinitionsApi.listCrossModelRelationshipTypes();
      setState((current) => ({
        ...current,
        crossModelRelationshipTypes,
        selectedCrossModelRelationshipTypeId: null,
        crossModelRelationshipTypeDraft: { name: '', description: '', sourceModelType: 'HIERARCHY_MODEL', sourceModelItemTypeId: null, targetModelType: 'HIERARCHY_MODEL', targetModelItemTypeId: null, status: 'active' },
        validation: { ...current.validation, crossModelRelationshipType: {} },
      }));
      showToast(isEdit ? 'Relationship type updated.' : 'Relationship type created.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save relationship type.', 'error');
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteCrossModelRelationshipType = async (id: string) => {
    try {
      setState((current) => ({ ...current, saving: true }));
      await modelDefinitionsApi.deleteCrossModelRelationshipType(id);
      await invalidateCrossModelQueries();
      const crossModelRelationshipTypes = await modelDefinitionsApi.listCrossModelRelationshipTypes();
      setState((current) => ({
        ...current,
        crossModelRelationshipTypes,
        selectedCrossModelRelationshipTypeId: null,
        crossModelRelationshipTypeDraft: { name: '', description: '', sourceModelType: 'HIERARCHY_MODEL', sourceModelItemTypeId: null, targetModelType: 'HIERARCHY_MODEL', targetModelItemTypeId: null, status: 'active' },
      }));
      showToast('Relationship type deleted.');
    } catch {
      showToast('Failed to delete relationship type.', 'error');
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const saveHierarchyModel = async () => {
    const errors = validateHierarchyModelDraft(state.hierarchyModelDraft);
    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, hierarchyModel: errors } }));
      return;
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      const isEdit = !!state.hierarchyModelDraft.id;
      const saved = isEdit
        ? await modelDefinitionsApi.updateHierarchyModel(state.hierarchyModelDraft.id!, state.hierarchyModelDraft)
        : await modelDefinitionsApi.createHierarchyModel(state.hierarchyModelDraft);
      await loadAll({ selectedHierarchyModelId: saved.id, activeTab: 'hierarchyModel' });
      showToast(isEdit ? 'Hierarchy model updated.' : 'Hierarchy model created.');
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteHierarchyModel = async (id: string) => {
    setState((current) => ({ ...current, saving: true }));
    try {
      await modelDefinitionsApi.deleteHierarchyModel(id);
      await invalidateCrossModelQueries();
      await loadAll({ selectedHierarchyModelId: null, activeTab: 'hierarchyModel' });
      showToast('Hierarchy model deleted.');
    } catch {
      showToast('Failed to delete hierarchy model.', 'error');
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const saveHierarchyNode = async (options?: { confirmRecursiveRemoval?: boolean }) => {
    const draft = { ...state.hierarchyNodeDraft, modelId: state.selectedHierarchyModelId ?? state.hierarchyNodeDraft.modelId };
    const errors = validateHierarchyNodeDraft(draft);
    const comparableNodes = state.hierarchyNodes.filter((node) => node.modelId === draft.modelId && node.id !== draft.id);
    const hasDuplicateNodeName = comparableNodes.some((node) => uniqueKey(node.name) === uniqueKey(draft.name));
    const hasDuplicateDisplayName =
      uniqueKey(draft.displayName).length > 0 &&
      comparableNodes.some((node) => nodeDisplayNameKey(node) === uniqueKey(draft.displayName));

    if (hasDuplicateNodeName) {
      errors.name = 'Node name must be unique.';
    }
    if (hasDuplicateDisplayName) {
      errors.displayName = 'Display name must be unique.';
    }

    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, hierarchyNode: errors } }));
      if (hasDuplicateNodeName && hasDuplicateDisplayName) {
        showToast('Node name and display name must be unique.', 'error');
      } else if (hasDuplicateNodeName) {
        showToast('Node name must be unique.', 'error');
      } else if (hasDuplicateDisplayName) {
        showToast('Display name must be unique.', 'error');
      }
      return;
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      const modelId = state.selectedHierarchyModelId;
      let savedId: string;
      if (draft.id) {
        await modelDefinitionsApi.updateHierarchyNodeType(draft.id, draft, options);
        savedId = draft.id;
      } else {
        const created = await modelDefinitionsApi.createHierarchyNodeType(draft);
        savedId = created.id;
      }
      const [hierarchyNodes, hierarchyRules] = await Promise.all([
        modelId ? modelDefinitionsApi.listHierarchyNodeTypes(modelId) : Promise.resolve([]),
        modelId ? modelDefinitionsApi.listHierarchyRules(modelId) : Promise.resolve([]),
      ]);
      setState((current) => {
        const savedNode = hierarchyNodes.find((n) => n.id === savedId) ?? null;
        return {
          ...current,
          hierarchyNodes,
          hierarchyRules,
          selectedHierarchyNodeId: savedId,
          hierarchyNodeProperties: [],
          hierarchyNodeDraft: savedNode
            ? { id: savedNode.id, modelId: savedNode.modelId, parentNodeId: savedNode.parentNodeId, name: savedNode.name, displayName: savedNode.displayName, badge: savedNode.badge.badgeText, description: savedNode.description, isRecursive: savedNode.isRecursive, isProperty: savedNode.isProperty, status: savedNode.status }
            : current.hierarchyNodeDraft,
          hierarchyNodePropertyFormData: { nodeTypeId: savedId, name: '', description: '', inheritable: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
          validation: { ...current.validation, hierarchyNode: {} },
        };
      });
      showToast(draft.id ? 'Node type updated.' : 'Node type created.');
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'Failed to save node type.' }));
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteHierarchyNode = async (id: string) => {
    await modelDefinitionsApi.deleteHierarchyNodeType(id);
    await invalidateCrossModelQueries();
    await reloadHierarchySelection(state.selectedHierarchyModelId);
    showToast('Node type deleted.');
  };

  const reorderHierarchyNode = async (
    nodeId: string,
    newParentNodeId: string | null,
    position: number,
    confirmInstanceReparent = false,
    instanceParentAssignments: InstanceParentAssignment[] = [],
  ) => {
    try {
      await modelDefinitionsApi.reorderHierarchyNodeType(nodeId, newParentNodeId, position, confirmInstanceReparent, instanceParentAssignments);
      const modelId = state.selectedHierarchyModelId;
      const [hierarchyNodes, hierarchyRules] = await Promise.all([
        modelId ? modelDefinitionsApi.listHierarchyNodeTypes(modelId) : Promise.resolve([]),
        modelId ? modelDefinitionsApi.listHierarchyRules(modelId) : Promise.resolve([]),
      ]);
      setState((current) => ({ ...current, hierarchyNodes, hierarchyRules }));
      showToast('Node type order updated.');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast(detail ?? 'Failed to reorder node type.', 'error');
    }
  };

  const selectHierarchyNode = async (nodeId: string | null) => {
    const node = state.hierarchyNodes.find((item) => item.id === nodeId) ?? null;
    const modelId = node?.modelId ?? state.selectedHierarchyModelId ?? '';
    const hierarchyNodeProperties = nodeId && modelId
      ? await modelDefinitionsApi.listHierarchyModelNodeTypeProperties(modelId, nodeId)
      : [];
    setState((current) => ({
      ...current,
      selectedHierarchyNodeId: nodeId,
      hierarchyNodeProperties,
      hierarchyNodeDraft: node
        ? { id: node.id, modelId: node.modelId, parentNodeId: node.parentNodeId, name: node.name, displayName: node.displayName, badge: node.badge.badgeText, description: node.description, isRecursive: node.isRecursive, isProperty: node.isProperty, status: node.status }
        : { modelId: current.selectedHierarchyModelId ?? '', parentNodeId: null, name: '', displayName: '', badge: '', description: '', isRecursive: false, isProperty: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      hierarchyNodePropertyFormData: { nodeTypeId: nodeId ?? '', name: '', description: '', inheritable: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      validation: { ...current.validation, hierarchyNode: {}, hierarchyNodeProperty: {} },
    }));
  };

  const saveHierarchyModelNodeTypeProperty = async (formDataOverride?: HierarchyNodeTypePropertyFormData): Promise<boolean> => {
    const nodeTypeId = state.selectedHierarchyNodeId ?? formDataOverride?.nodeTypeId ?? '';
    const formData = {
      ...state.hierarchyNodePropertyFormData,
      ...formDataOverride,
      nodeTypeId,
    };
    const errors = validateHierarchyNodePropertyFormData(formData);
    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, hierarchyNodeProperty: errors } }));
      return false;
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      const isEdit = !!formData.id;
      const modelId = state.selectedHierarchyModelId ?? state.hierarchyNodeDraft.modelId;
      if (isEdit) {
        await modelDefinitionsApi.updateHierarchyNodeTypeProperty(modelId, formData.nodeTypeId, formData.id!, formData);
      } else {
        await modelDefinitionsApi.createHierarchyNodeTypeProperty(modelId, formData.nodeTypeId, formData);
      }
      const hierarchyNodeProperties = await modelDefinitionsApi.listHierarchyModelNodeTypeProperties(modelId, formData.nodeTypeId);
      setState((current) => ({
        ...current,
        hierarchyNodeProperties,
        hierarchyNodePropertyFormData: { nodeTypeId: formData.nodeTypeId, name: '', description: '', inheritable: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
        validation: { ...current.validation, hierarchyNodeProperty: {} },
      }));
      showToast(isEdit ? 'Property updated.' : 'Property created.');
      return true;
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'Failed to save property.' }));
      showToast('Failed to save property.', 'error');
      return false;
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteHierarchyNodeProperty = async (id: string) => {
    const nodeId = state.selectedHierarchyNodeId ?? state.hierarchyNodePropertyFormData.nodeTypeId;
    const modelId = state.selectedHierarchyModelId ?? state.hierarchyNodeDraft.modelId;
    if (nodeId) {
      await modelDefinitionsApi.deleteHierarchyNodeTypeProperty(modelId, nodeId, id);
    }
    const hierarchyNodeProperties = nodeId
      ? await modelDefinitionsApi.listHierarchyModelNodeTypeProperties(modelId, nodeId)
      : [];
    setState((current) => ({
      ...current,
      hierarchyNodeProperties,
      hierarchyNodePropertyFormData: { nodeTypeId: nodeId ?? '', name: '', description: '', inheritable: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      validation: { ...current.validation, hierarchyNodeProperty: {} },
    }));
    showToast('Property deleted.');
  };

  const beginCreateRootNode = () =>
    setState((current) => ({
      ...current,
      selectedHierarchyNodeId: null,
      hierarchyNodeProperties: [],
      hierarchyNodeDraft: { modelId: current.selectedHierarchyModelId ?? '', parentNodeId: null, name: '', displayName: '', badge: '', description: '', isRecursive: false, isProperty: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      hierarchyNodePropertyFormData: { nodeTypeId: '', name: '', description: '', inheritable: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      validation: { ...current.validation, hierarchyNode: {}, hierarchyNodeProperty: {} },
    }));

  const beginCreateChildNode = (parentNodeId: string | null) =>
    setState((current) => ({
      ...current,
      selectedHierarchyNodeId: null,
      hierarchyNodeProperties: [],
      hierarchyNodeDraft: { modelId: current.selectedHierarchyModelId ?? '', parentNodeId, name: '', displayName: '', badge: '', description: '', isRecursive: false, isProperty: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      hierarchyNodePropertyFormData: { nodeTypeId: '', name: '', description: '', inheritable: false, status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      validation: { ...current.validation, hierarchyNode: {}, hierarchyNodeProperty: {} },
    }));

  const saveSupportDomainModel = async () => {
    const errors = validateSupportDomainModelDraft(state.supportDomainModelDraft);
    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, supportDomainModel: errors } }));
      return;
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      const isEdit = !!state.supportDomainModelDraft.id;
      const saved = isEdit
        ? await modelDefinitionsApi.updateSupportDomainModel(state.supportDomainModelDraft.id!, state.supportDomainModelDraft)
        : await modelDefinitionsApi.createSupportDomainModel(state.supportDomainModelDraft);
      await loadAll({ selectedSupportDomainModelId: saved.id, activeTab: 'supportDomain' });
      showToast(isEdit ? 'Support domain model updated.' : 'Support domain model created.');
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteSupportDomainModel = async (id: string) => {
    await modelDefinitionsApi.deleteSupportDomainModel(id);
    await invalidateCrossModelQueries();
    await loadAll({ selectedSupportDomainModelId: null, activeTab: 'supportDomain' });
    showToast('Support domain model deleted.');
  };

  const saveSupportDomainElement = async () => {
    const draft = { ...state.supportDomainElementDraft, modelId: state.selectedSupportDomainModelId ?? state.supportDomainElementDraft.modelId };
    const errors = validateSupportDomainElementDraft(draft);
    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, supportDomainElement: errors } }));
      return;
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      const isEdit = !!draft.id;
      let savedId: string;
      if (isEdit) {
        await modelDefinitionsApi.updateSupportDomainElement(draft.id!, draft);
        savedId = draft.id!;
      } else {
        const created = await modelDefinitionsApi.createSupportDomainElement(draft);
        savedId = created.id;
      }
      await loadAll({
        selectedSupportDomainModelId: draft.modelId,
        selectedSupportDomainElementId: savedId,
        activeTab: 'supportDomain',
      });
      showToast(isEdit ? 'Element updated.' : 'Element created.');
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteSupportDomainElement = async (id: string) => {
    await modelDefinitionsApi.deleteSupportDomainElement(id);
    await invalidateCrossModelQueries();
    await reloadSupportSelection(state.selectedSupportDomainModelId);
    showToast('Element deleted.');
  };

  const selectSupportDomainElement = async (elementId: string | null) => {
    const element = state.supportDomainElements.find((item) => item.id === elementId) ?? null;
    const supportDomainElementProperties = elementId
      ? await modelDefinitionsApi.listSupportDomainElementProperties(element?.modelId ?? state.selectedSupportDomainModelId!, elementId)
      : [];
    setState((current) => ({
      ...current,
      selectedSupportDomainElementId: elementId,
      supportDomainElementProperties,
      supportDomainElementDraft: element
        ? { id: element.id, modelId: element.modelId, name: element.name, displayName: element.displayName, badge: element.badge.badgeText, description: element.description, status: element.status }
        : { modelId: current.selectedSupportDomainModelId ?? '', name: '', displayName: '', badge: '', description: '', status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      supportDomainElementPropertyData: { elementId: elementId ?? '', name: '', description: '', status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      validation: { ...current.validation, supportDomainElement: {}, supportDomainElementProperty: {} },
    }));
  };

  const saveSupportDomainElementProperty = async (dataOverride?: SupportDomainElementPropertyData): Promise<boolean> => {
    const data = {
      ...state.supportDomainElementPropertyData,
      ...dataOverride,
      elementId: state.selectedSupportDomainElementId ?? dataOverride?.elementId ?? state.supportDomainElementPropertyData.elementId,
    };
    const errors = validateSupportDomainElementPropertyData(data);
    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, supportDomainElementProperty: errors } }));
      return false;
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      const isEdit = !!data.id;
      const modelId = state.selectedSupportDomainModelId ?? state.supportDomainElementDraft.modelId;
      if (isEdit) {
        await modelDefinitionsApi.updateSupportDomainElementProperty(modelId, data.id!, data);
      } else {
        await modelDefinitionsApi.createSupportDomainElementProperty(modelId, data);
      }
      const supportDomainElementProperties = await modelDefinitionsApi.listSupportDomainElementProperties(modelId, data.elementId);
      setState((current) => ({
        ...current,
        supportDomainElementProperties,
        supportDomainElementPropertyData: { elementId: data.elementId, name: '', description: '', status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
        validation: { ...current.validation, supportDomainElementProperty: {} },
      }));
      showToast(isEdit ? 'Property updated.' : 'Property created.');
      return true;
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'Failed to save property.' }));
      showToast('Failed to save property.', 'error');
      return false;
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteSupportDomainElementProperty = async (id: string) => {
    const elementId = state.selectedSupportDomainElementId;
    const modelId = state.selectedSupportDomainModelId ?? state.supportDomainElementDraft.modelId;
    if (elementId) {
      await modelDefinitionsApi.deleteSupportDomainElementProperty(modelId, elementId, id);
    }
    const supportDomainElementProperties = elementId
      ? await modelDefinitionsApi.listSupportDomainElementProperties(modelId, elementId)
      : [];
    setState((current) => ({
      ...current,
      supportDomainElementProperties,
      supportDomainElementPropertyData: { elementId: elementId ?? '', name: '', description: '', status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      validation: { ...current.validation, supportDomainElementProperty: {} },
    }));
    showToast('Property deleted.');
  };

  const selectSupportDomainRelationship = (relationshipId: string | null) => {
    const relationship = state.supportDomainRelationships.find((item) => item.id === relationshipId) ?? null;
    setState((current) => ({
      ...current,
      selectedSupportDomainRelationshipId: relationshipId,
      supportDomainRelationshipDraft: relationship
        ? { id: relationship.id, modelId: relationship.modelId, sourceElementId: relationship.sourceElementId, targetElementId: relationship.targetElementId, relationshipKind: relationship.relationshipKind, notes: relationship.notes, status: relationship.status }
        : { modelId: current.selectedSupportDomainModelId ?? '', sourceElementId: '', targetElementId: '', relationshipKind: '', notes: '', status: pickFirst(current.metadata.lifecycleStatuses, 'draft') },
      validation: { ...current.validation, supportDomainRelationship: {} },
    }));
  };

  const saveSupportDomainRelationship = async () => {
    const draft = { ...state.supportDomainRelationshipDraft, modelId: state.selectedSupportDomainModelId ?? state.supportDomainRelationshipDraft.modelId };
    const errors = validateSupportDomainRelationshipDraft(draft);
    if (Object.keys(errors).length) {
      setState((current) => ({ ...current, validation: { ...current.validation, supportDomainRelationship: errors } }));
      return;
    }
    // A reason the server gave last time no longer stands once it is tried again.
    setState((current) => ({ ...current, saving: true, validation: { ...current.validation, supportDomainRelationship: {} } }));
    try {
      const isEdit = !!draft.id;
      if (isEdit) {
        await modelDefinitionsApi.updateSupportDomainRelationship(draft.id!, draft);
      } else {
        await modelDefinitionsApi.createSupportDomainRelationship(draft);
      }
      await reloadSupportSelection(state.selectedSupportDomainModelId);
      showToast(isEdit ? 'Relationship updated.' : 'Relationship created.');
    } catch (error) {
      // Refused by the server (a name used twice between the same types, a
      // hierarchy-only kind…): keep the editor open with the reason on the name.
      // The server's field prefix ("relationship_kind: Value error, ") means nothing to the person.
      const message = (error instanceof Error ? error.message : 'Failed to save relationship.').replace(/^[a-z_]+:\s*(Value error,\s*)?/, '');
      setState((current) => ({ ...current, validation: { ...current.validation, supportDomainRelationship: { relationshipKind: message } } }));
      showToast(message, 'error');
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  };

  const deleteSupportDomainRelationship = async (id: string) => {
    try {
      await modelDefinitionsApi.deleteSupportDomainRelationship(id);
      await reloadSupportSelection(state.selectedSupportDomainModelId);
      showToast('Relationship deleted.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to delete relationship.', 'error');
    }
  };

  const hierarchyTree = useMemo(() => buildHierarchyTree(state.hierarchyNodes), [state.hierarchyNodes]);
  const selectedHierarchyModel = useMemo(() => state.hierarchyModels.find((item) => item.id === state.selectedHierarchyModelId) ?? null, [state.hierarchyModels, state.selectedHierarchyModelId]);
  const selectedSupportDomainModel = useMemo(() => state.supportDomainModels.find((item) => item.id === state.selectedSupportDomainModelId) ?? null, [state.supportDomainModels, state.selectedSupportDomainModelId]);

  const refreshHierarchyNodes = useCallback(async () => {
    const modelId = state.selectedHierarchyModelId;
    if (!modelId) return;
    const hierarchyNodes = await modelDefinitionsApi.listHierarchyNodeTypes(modelId);
    setState((current) => ({ ...current, hierarchyNodes }));
  }, [state.selectedHierarchyModelId]);

  const refreshSupportDomainElements = useCallback(async () => {
    const modelId = state.selectedSupportDomainModelId;
    if (!modelId) return;
    const supportDomainElements = await modelDefinitionsApi.listSupportDomainElements(modelId);
    setState((current) => ({ ...current, supportDomainElements }));
  }, [state.selectedSupportDomainModelId]);

  // Re-read what an edit made outside the controller (an inline list edit, a
  // duplicate, an import) may have changed, keeping the current selection.
  const refreshHierarchySelection = useCallback(async () => {
    const modelId = state.selectedHierarchyModelId;
    if (!modelId) return;
    const [hierarchyNodes, hierarchyRules] = await Promise.all([
      modelDefinitionsApi.listHierarchyNodeTypes(modelId),
      modelDefinitionsApi.listHierarchyRules(modelId),
    ]);
    setState((current) => {
      const selected = hierarchyNodes.find((node) => node.id === current.selectedHierarchyNodeId) ?? null;
      return {
        ...current,
        hierarchyNodes,
        hierarchyRules,
        hierarchyNodeDraft: selected
          ? { id: selected.id, modelId: selected.modelId, parentNodeId: selected.parentNodeId, name: selected.name, displayName: selected.displayName, badge: selected.badge.badgeText, description: selected.description, isRecursive: selected.isRecursive, isProperty: selected.isProperty, status: selected.status }
          : current.hierarchyNodeDraft,
      };
    });
  }, [state.selectedHierarchyModelId]);

  const refreshSupportDomainSelection = useCallback(async () => {
    const modelId = state.selectedSupportDomainModelId;
    if (!modelId) return;
    const [supportDomainElements, supportDomainRelationships] = await Promise.all([
      modelDefinitionsApi.listSupportDomainElements(modelId),
      modelDefinitionsApi.listSupportDomainRelationships(modelId),
    ]);
    setState((current) => {
      const selected = supportDomainElements.find((element) => element.id === current.selectedSupportDomainElementId) ?? null;
      return {
        ...current,
        supportDomainElements,
        supportDomainRelationships,
        supportDomainElementDraft: selected
          ? { id: selected.id, modelId: selected.modelId, name: selected.name, displayName: selected.displayName, badge: selected.badge.badgeText, description: selected.description, status: selected.status }
          : current.supportDomainElementDraft,
      };
    });
  }, [state.selectedSupportDomainModelId]);

  const refreshCrossModelRelationshipTypes = useCallback(async () => {
    const crossModelRelationshipTypes = await modelDefinitionsApi.listCrossModelRelationshipTypes();
    setState((current) => ({ ...current, crossModelRelationshipTypes }));
    await invalidateCrossModelQueries();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAll = () =>
    loadAll({
      activeTab: state.activeTab,
      selectedHierarchyModelId: state.selectedHierarchyModelId,
      selectedSupportDomainModelId: state.selectedSupportDomainModelId,
      selectedHierarchyNodeId: state.selectedHierarchyNodeId,
      selectedSupportDomainElementId: state.selectedSupportDomainElementId,
    });

  return {
    state,
    hierarchyTree,
    selectedHierarchyModel,
    selectedSupportDomainModel,
    setActiveTab,
    selectHierarchyModel,
    selectSupportDomainModel,
    updateHierarchyModelDraft,
    updateHierarchyNodeDraft,
    updateHierarchyNodePropertyFormData,
    updateSupportDomainModelDraft,
    updateSupportDomainElementDraft,
    updateSupportDomainElementPropertyData,
    updateSupportDomainRelationshipDraft,
    saveHierarchyModel,
    deleteHierarchyModel,
    saveHierarchyNode,
    deleteHierarchyNode,
    reorderHierarchyNode,
    selectHierarchyNode,
    saveHierarchyModelNodeTypeProperty,
    deleteHierarchyNodeProperty,
    beginCreateRootNode,
    beginCreateChildNode,
    refreshHierarchyNodes,
    refreshSupportDomainElements,
    refreshHierarchySelection,
    refreshSupportDomainSelection,
    refreshCrossModelRelationshipTypes,
    reloadAll,
    saveSupportDomainModel,
    deleteSupportDomainModel,
    saveSupportDomainElement,
    deleteSupportDomainElement,
    selectSupportDomainElement,
    saveSupportDomainElementProperty,
    deleteSupportDomainElementProperty,
    selectSupportDomainRelationship,
    saveSupportDomainRelationship,
    deleteSupportDomainRelationship,
    updateCrossModelRelationshipTypeDraft,
    selectCrossModelRelationshipType,
    saveCrossModelRelationshipType,
    deleteCrossModelRelationshipType,
  };
}
