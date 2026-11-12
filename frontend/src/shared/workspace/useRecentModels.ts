import { useCallback, useState } from 'react';
import type { ModelKind, WorkspaceKind } from './workspaceModel';

export type RecentModelRef = { kind: ModelKind; id: string; openedAt: string };

const LIMIT = 8;

function storageKey(workspace: WorkspaceKind) {
  return `pdp-${workspace}-recent-models`;
}

function read(workspace: WorkspaceKind): RecentModelRef[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(workspace)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The models this browser opened last in a workspace, newest first — what the
 * landing page offers. A convenience for one viewer, so it lives in local
 * storage and quietly starts empty when that is unavailable.
 */
export function useRecentModels(workspace: WorkspaceKind) {
  const [recent, setRecent] = useState<RecentModelRef[]>(() => read(workspace));

  const remember = useCallback(
    (kind: ModelKind, id: string) => {
      setRecent((current) => {
        const next = [{ kind, id, openedAt: new Date().toISOString() }, ...current.filter((item) => item.id !== id)].slice(0, LIMIT);
        try {
          localStorage.setItem(storageKey(workspace), JSON.stringify(next));
        } catch {
          // Storage refused (private window, quota): the list still works for this visit.
        }
        return next;
      });
    },
    [workspace],
  );

  return { recent, remember };
}
