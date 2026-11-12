/**
 * The vocabulary both workspaces share (PDP-UIUX-001).
 *
 * MWS (Model Workspace) and SWS (Structure Workspace) are laid out the same
 * way — Model / Relationship / Data Exchange, then a projection of the chosen
 * model — so they also share the words for those things. Keeping them here
 * stops the two workspaces drifting into different names for the same
 * control.
 */
export type WorkspaceKind = 'mws' | 'sws';

/** The two kinds of model a workspace can open. */
export type ModelKind = 'hierarchy' | 'support';

/** Model Navigation: the three things a workspace does. */
export type ModelNavTab = 'model' | 'relationship' | 'exchange';

/** Projection Navigation: the ways one model, or the relationships, can be shown. */
export type ProjectionView = 'hierarchy' | 'diagram' | 'matrix' | 'list';

export type WorkspaceModel = {
  id: string;
  kind: ModelKind;
  name: string;
  description: string;
  status: string;
};

/**
 * The Model Navigation tabs each workspace offers. Data Exchange is the
 * Structure Workspace's CSV import / export; the Model Workspace has none yet.
 */
export const WORKSPACE_TABS: Record<WorkspaceKind, ModelNavTab[]> = {
  mws: ['model', 'relationship'],
  sws: ['model', 'relationship', 'exchange'],
};

export const MODEL_NAV_LABEL: Record<ModelNavTab, string> = {
  model: 'Model',
  relationship: 'Relationship',
  exchange: 'Data Exchange',
};

export const PROJECTION_LABEL: Record<ProjectionView, string> = {
  hierarchy: 'Hierarchy',
  diagram: 'Diagram',
  matrix: 'Matrix',
  list: 'List',
};

export const MODEL_KIND_LABEL: Record<ModelKind, string> = {
  hierarchy: 'Hierarchy Model',
  support: 'Support Domain Model',
};

/**
 * Which projections each part of each workspace offers, first one is the
 * default. MWS defines a support domain model on a diagram; SWS also offers a
 * matrix, because there the cells are the allowed instance relationships.
 */
export function projectionsFor(workspace: WorkspaceKind, tab: ModelNavTab, kind: ModelKind | null): ProjectionView[] {
  if (tab === 'relationship') return ['matrix', 'diagram', 'list'];
  if (tab === 'exchange') return [];
  if (kind === 'hierarchy') return ['hierarchy', 'list'];
  if (kind === 'support') return workspace === 'sws' ? ['diagram', 'matrix', 'list'] : ['diagram', 'list'];
  return [];
}

export const WORKSPACE_ROUTE: Record<WorkspaceKind, string> = {
  mws: '/model/tree-models',
  sws: '/structure-workspace',
};
