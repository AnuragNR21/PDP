import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  SaveDiagramInput,
  SavedDiagram,
  SavedDiagramApi,
  SavedDiagramEdge,
  SavedDiagramNode,
  SavedDiagramShape,
} from "../domain/savedDiagram";

/** How often the canvas is checked for changes worth writing back. */
const AUTO_SAVE_INTERVAL_MS = 8_000;

/**
 * How long "Saving…" stays on screen at minimum. A save against a local server
 * finishes in milliseconds, and a status that flickers past is worse than none —
 * the user is left unsure whether their work was written at all.
 */
const MIN_SAVING_VISIBLE_MS = 1000;

/** Name given to the diagram created on a first-time user's first change. */
export const UNTITLED_DIAGRAM_NAME = "Untitled diagram";

export type SavedDiagramSyncStatus = "idle" | "opening" | "saving" | "saved" | "error";

export type SavedDiagramSyncOptions = {
  api: SavedDiagramApi;
  /** react-query cache key for the saved-diagram list (keep distinct per workspace). */
  queryKey: readonly unknown[];
  /** The diagram currently open, or null when the canvas belongs to no diagram yet. */
  currentDiagramId: string | null;
  currentDiagramName: string | null;
  getSaveNodes: () => SavedDiagramNode[];
  getSaveEdges: () => SavedDiagramEdge[];
  getSaveShapes?: () => SavedDiagramShape[];
  /** Adopt the diagram opened on arrival — same handler the "load" menu uses. */
  onOpened: (diagram: SavedDiagram) => void;
  /** Adopt the id and name after a save, so later changes update rather than duplicate. */
  onSaved: (diagram: SavedDiagram) => void;
  /**
   * False while the workspace is still loading what the canvas refers to. Opening
   * a diagram before then would drop every item it names as "no longer exists".
   */
  enabled?: boolean;
};

/**
 * Keeps a diagram canvas and its saved record in step, without the user pressing
 * Save.
 *
 * On arrival it opens the most recently updated diagram, so the workspace always
 * shows real work rather than a blank canvas. From then on every change is
 * written back on a short debounce: to the open diagram, or — for someone who has
 * never saved anything — to a new "Untitled diagram" created the moment they put
 * something on the canvas. Nothing is written for merely visiting the tab.
 *
 * The canvas, not the record, is the source of truth: each save replaces the
 * diagram's nodes, edge styles and shapes wholesale.
 */
export function useSavedDiagramSync({
  api,
  queryKey,
  currentDiagramId,
  currentDiagramName,
  getSaveNodes,
  getSaveEdges,
  getSaveShapes,
  onOpened,
  onSaved,
  enabled = true,
}: SavedDiagramSyncOptions) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SavedDiagramSyncStatus>("idle");

  // What the canvas looked like when it was last in step with the server. Auto-save
  // compares against this, so loading a diagram doesn't immediately save it back.
  const syncedSignatureRef = useRef<string | null>(null);
  // Auto-open runs once per mounted canvas, and only before anything is on it.
  const openAttemptedRef = useRef(false);
  const savingRef = useRef(false);
  // Pending "Saving…" hold, cleared if the component goes away mid-save.
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the canvas is about to be replaced wholesale (load, clear, delete).
  // The state behind those changes has not flushed yet, so the new signature is
  // adopted on the next render rather than measured here.
  const resyncPendingRef = useRef(false);

  // Latest values, for callbacks that must not re-run on every render.
  const latest = useRef({ api, currentDiagramId, currentDiagramName, getSaveNodes, getSaveEdges, getSaveShapes, onOpened, onSaved });
  latest.current = { api, currentDiagramId, currentDiagramName, getSaveNodes, getSaveEdges, getSaveShapes, onOpened, onSaved };

  const buildInput = useCallback((name: string): SaveDiagramInput => ({
    name,
    nodes: latest.current.getSaveNodes(),
    edges: latest.current.getSaveEdges(),
    shapes: latest.current.getSaveShapes?.() ?? [],
  }), []);

  const signatureOf = useCallback((input: SaveDiagramInput) => JSON.stringify({
    nodes: input.nodes,
    edges: input.edges,
    shapes: input.shapes,
  }), []);

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  /** Treat the canvas as already in step — after loading, clearing, or deleting. */
  const markSynced = useCallback(() => {
    resyncPendingRef.current = true;
    setStatus("idle");
  }, []);

  const hasContent = getSaveNodes().length > 0 || (getSaveShapes?.().length ?? 0) > 0;
  const signature = signatureOf(buildInput(""));

  // ── Open the latest diagram on arrival ──────────────────────────────────────
  useEffect(() => {
    if (!enabled || openAttemptedRef.current) return;
    // Canvas state outlives this component (it lives in workspace state), so a
    // canvas that already holds work — or already knows its diagram — is left alone.
    if (currentDiagramId || hasContent) {
      openAttemptedRef.current = true;
      syncedSignatureRef.current = signature;
      return;
    }

    openAttemptedRef.current = true;
    let cancelled = false;
    setStatus("opening");
    void (async () => {
      try {
        const summaries = await latest.current.api.list();
        // The list arrives newest-first; fall back to comparing timestamps.
        const newest = [...summaries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (!newest) {
          // First time here, or everything has been deleted: nothing to open, and
          // nothing is written until the user actually puts something down.
          if (!cancelled) { syncedSignatureRef.current = signature; setStatus("idle"); }
          return;
        }
        const diagram = await latest.current.api.get(newest.id);
        if (cancelled) return;
        latest.current.onOpened(diagram);
        syncedSignatureRef.current = signatureOf({
          name: diagram.name, nodes: diagram.nodes, edges: diagram.edges, shapes: diagram.shapes,
        });
        setStatus("idle");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, currentDiagramId, hasContent, signature, signatureOf]);

  // ── Write changes back ──────────────────────────────────────────────────────
  // Latest canvas state, read by the timer rather than by an effect that would
  // restart on every keystroke and drag.
  const pending = useRef({ signature, hasContent, enabled });
  pending.current = { signature, hasContent, enabled };

  // The canvas was just replaced from the server (or emptied): adopt what it now
  // holds instead of writing it straight back. Runs on the render after the
  // replacing state has flushed, which is why markSynced only sets a flag.
  useEffect(() => {
    if (!resyncPendingRef.current) return;
    resyncPendingRef.current = false;
    syncedSignatureRef.current = signature;
  });

  const flush = useCallback(() => {
    const { signature: current, hasContent: filled, enabled: on } = pending.current;
    if (!on || !openAttemptedRef.current || savingRef.current) return;
    if (syncedSignatureRef.current === null || current === syncedSignatureRef.current) return;
    // An empty canvas that belongs to no diagram is someone looking around.
    if (!latest.current.currentDiagramId && !filled) return;

    savingRef.current = true;
    setStatus("saving");
    const startedAt = Date.now();
    // Hold "Saving…" for its minimum before reporting the outcome.
    const settle = (next: SavedDiagramSyncStatus) => {
      const remaining = MIN_SAVING_VISIBLE_MS - (Date.now() - startedAt);
      if (remaining <= 0) { setStatus(next); return; }
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setStatus(next), remaining);
    };

    const name = latest.current.currentDiagramName?.trim() || UNTITLED_DIAGRAM_NAME;
    const input = buildInput(name);
    const attempted = signatureOf(input);
    const request = latest.current.currentDiagramId
      ? latest.current.api.update(latest.current.currentDiagramId, input)
      : latest.current.api.create(input);
    void request
      .then((diagram) => {
        syncedSignatureRef.current = attempted;
        latest.current.onSaved(diagram);
        void queryClient.invalidateQueries({ queryKey });
        settle("saved");
      })
      .catch(() => settle("error"))
      .finally(() => { savingRef.current = false; });
  }, [buildInput, queryClient, queryKey, signatureOf]);

  useEffect(() => {
    if (!enabled) return;
    const ticker = setInterval(flush, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(ticker);
  }, [enabled, flush]);

  // Leaving the workspace shouldn't cost up to a full interval of work. Only an
  // already-open diagram is flushed on the way out: writing it again is harmless,
  // whereas creating one here would double up under StrictMode's remount.
  useEffect(() => () => {
    if (latest.current.currentDiagramId) flush();
  }, [flush]);

  return { status, markSynced };
}
