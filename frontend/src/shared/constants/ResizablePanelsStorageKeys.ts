/**
 * Storage keys for resizable panel widths
 * Convention: [Workspace][Feature][Panel][Component] = 'pdp-[workspace]-[feature]-[panel]-[component]'
 */
export enum ResizablePanelsStorageKey {
  ModelWorkspaceNavigationPanel = 'pdp-model-workspace-navigation-width',
  ModelWorkspaceHierarchyNodeTypePanels = 'pdp-model-workspace-hierarchy-node-type-tree-panel-width',
  ModelWorkspaceSupportDomainElementPanel = 'pdp-model-workspace-support-domain-element-panel-width',
  StructureWorkspaceHierarchyPanels = 'pdp-structure-workspace-hierarchy-panels-width',
  StructureWorkspaceSupportDomainPanels = 'pdp-structure-workspace-support-domain-panels-width',
}
