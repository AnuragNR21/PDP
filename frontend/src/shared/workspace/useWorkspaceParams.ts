import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WORKSPACE_TABS, projectionsFor, type ModelKind, type ModelNavTab, type ProjectionView, type WorkspaceKind } from './workspaceModel';

export type WorkspaceParams = {
  tab: ModelNavTab;
  kind: ModelKind | null;
  modelId: string | null;
  view: ProjectionView | null;
  /** The node type / element type selected in the open model. */
  item: string | null;
};

/** Where a workspace was left, so returning to it continues from there. */
const storageKey = (workspace: WorkspaceKind) => `pdp-${workspace}-last-context`;
function readContext(workspace: WorkspaceKind): string {
  try {
    return localStorage.getItem(storageKey(workspace)) ?? '';
  } catch {
    return '';
  }
}
function writeContext(workspace: WorkspaceKind, value: string) {
  try {
    if (value) localStorage.setItem(storageKey(workspace), value);
    else localStorage.removeItem(storageKey(workspace));
  } catch {
    // Not remembered across visits, still works for this one.
  }
}

const KINDS: ModelKind[] = ['hierarchy', 'support'];

/**
 * Where the person is in a workspace, kept in the address.
 *
 * Model Navigation, the open model and the projection all live in the query
 * string, so a reload, a bookmark or a link from another workspace lands on
 * the same view, and Back steps through the models that were opened.
 */
export function useWorkspaceParams(workspace: WorkspaceKind) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Coming back to the workspace with a bare address (the side navigation, a
  // bookmark of the workspace itself) picks up the model, tab, view and
  // selection it was left on. An address that says where to go wins. After
  // that, every change is remembered — including going Home, which clears it.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;
      if (!searchParams.toString()) {
        const saved = readContext(workspace);
        if (saved) {
          setSearchParams(new URLSearchParams(saved), { replace: true });
          return;
        }
      }
    }
    writeContext(workspace, searchParams.toString());
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = useMemo<WorkspaceParams>(() => {
    const rawTab = searchParams.get('tab') as ModelNavTab | null;
    const tab = rawTab && WORKSPACE_TABS[workspace].includes(rawTab) ? rawTab : 'model';
    const rawKind = searchParams.get('kind') as ModelKind | null;
    const kind = rawKind && KINDS.includes(rawKind) ? rawKind : null;
    const modelId = searchParams.get('model') || null;
    const allowed = projectionsFor(workspace, tab, kind);
    const rawView = searchParams.get('view') as ProjectionView | null;
    const view = rawView && allowed.includes(rawView) ? rawView : allowed[0] ?? null;
    const item = modelId && kind ? searchParams.get('item') || null : null;
    return { tab, kind: modelId ? kind : null, modelId: kind ? modelId : null, view, item };
  }, [searchParams, workspace]);

  const update = useCallback(
    (patch: Partial<WorkspaceParams>, options?: { replace?: boolean }) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const write = (key: string, value: string | null | undefined) => {
            if (value) next.set(key, value);
            else next.delete(key);
          };
          if ('tab' in patch) write('tab', patch.tab === 'model' ? null : patch.tab);
          if ('kind' in patch) write('kind', patch.kind);
          if ('modelId' in patch) write('model', patch.modelId);
          if ('view' in patch) write('view', patch.view);
          if ('item' in patch) write('item', patch.item);
          // A different model or tab starts on its default projection unless
          // one was asked for.
          if (('modelId' in patch || 'tab' in patch || 'kind' in patch) && !('view' in patch)) next.delete('view');
          // …and with nothing selected in it.
          if (('modelId' in patch || 'kind' in patch) && !('item' in patch)) next.delete('item');
          return next;
        },
        { replace: options?.replace ?? false },
      );
    },
    [setSearchParams],
  );

  const selectModel = useCallback(
    (kind: ModelKind | null, modelId: string | null, options?: { replace?: boolean }) =>
      update({ kind: modelId ? kind : null, modelId, tab: 'model' }, options),
    [update],
  );

  return { params, update, selectModel, searchParams, setSearchParams };
}
