import { buildHierarchyTree } from '../domain/mappers';
import type { ModelDefinitionsState } from '../domain/types';

export const selectHierarchyTree = (state: ModelDefinitionsState) => buildHierarchyTree(state.hierarchyNodes);
export const selectSelectedHierarchyModel = (state: ModelDefinitionsState) =>
  state.hierarchyModels.find((item) => item.id === state.selectedHierarchyModelId) ?? null;
export const selectSelectedSupportDomainModel = (state: ModelDefinitionsState) =>
  state.supportDomainModels.find((item) => item.id === state.selectedSupportDomainModelId) ?? null;
export const selectSelectedHierarchyNode = (state: ModelDefinitionsState) =>
  state.hierarchyNodes.find((item) => item.id === state.selectedHierarchyNodeId) ?? null;
export const selectSelectedSupportDomainElement = (state: ModelDefinitionsState) =>
  state.supportDomainElements.find((item) => item.id === state.selectedSupportDomainElementId) ?? null;
