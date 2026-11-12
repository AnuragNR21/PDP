import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  structureGovernanceGraphApi,
  type GovernanceGraphReport,
} from "@/features/structure/api/structureGovernanceGraphApi";
import {
  impactDiagramApi,
  type ImpactDiagramRecord,
  type SaveImpactDiagramPayload,
} from "@/features/impact/api/impactDiagramApi";
import {
  absorbNeighbourhood,
  addItems,
  canvasItemIds,
  degreeIndex,
  EMPTY_CANVAS,
  forgetReveals,
  freePlacements,
  gridPlacements,
  lowestEdge,
  moveItem,
  popUndo,
  pushUndo,
  recordReveal,
  removeItems,
  restoreCanvas,
  revealedUnder,
  toSavedNodes,
  type CanvasState,
  type Placement,
  type RevealLedger,
} from "@/features/impact/domain/impactGraph";
import {
  canvasSignature,
  childrenOf,
  collapsedHidden,
  connectedModels,
  DIRECTION,
  directionalPlacements,
  edgesOfKinds,
  filterByDirection,
  hasUnsavedChanges,
  modelCategoryOf,
  nearestPaths,
  observedPath,
  OBSERVED_ID_PREFIX,
  primaryFocus,
  refreshReveals,
  relayoutVisible,
  type Direction,
  type LayoutEdge,
  type LayoutItem,
} from "@/features/impact/domain/impactLayout";
import { impactQualityResultsApi } from "@/features/impact/api/impactQualityResultsApi";
import {
  hubPathsTo,
  resultEntries,
  type ResultEntry,
} from "@/features/impact/domain/impactQualityResults";
import type {
  GovernanceEdge,
  GovernanceItem,
} from "@/features/structure/domain/structureGovernanceGraph";

/** How far an expansion reaches by default. */
export const DEFAULT_DEPTH = 1;

export const IMPACT_DIAGRAMS_KEY = ["impact", "diagrams"] as const;

/** One step Undo can go back to: the canvas and which cards were open. */
type UndoStep = { canvas: CanvasState; revealed: RevealLedger };

/** Equally near paths into a model, waiting for the reader to choose. */
export type PathChoice = {
  modelId: string;
  modelName: string;
  /** Per hub, the tying paths; a hub with one path has nothing to choose. */
  options: { hubId: string; paths: string[][] }[];
};

function toLayoutItem(item: GovernanceItem): LayoutItem {
  return {
    item_id: item.item_id,
    name: item.name,
    model_id: item.model_id,
    model_name: item.model_name,
    // The panel says what kind of *model* an instance belongs to.
    model_kind: modelCategoryOf(item.item_kind),
    type_name: item.type_name,
  };
}

const isObserved = (id: string) => id.startsWith(OBSERVED_ID_PREFIX);

/** Each step of each path, as "place this card beside the one before it". */
function stepsAlong(paths: readonly string[][]): { anchorId: string; ids: string[] }[] {
  return paths.flatMap((path) =>
    path.slice(1).map((id, index) => ({ anchorId: path[index], ids: [id] })),
  );
}

/**
 * Everything the Impact canvas needs, and nothing it does not.
 *
 * The canvas is held as one immutable value so a render never sees half an
 * update — a node present with its edges not yet filtered, say. Every mutation
 * is a pure function from `domain/`, which is where the rules are tested; this
 * hook only decides when to call them and what to fetch.
 */
export function useImpactGraph() {
  const queryClient = useQueryClient();
  const [canvas, setCanvasState] = useState<CanvasState>(EMPTY_CANVAS);
  /*
   * The latest canvas, readable from async work.
   *
   * An expansion awaits the server and then places its cards. Reading the
   * canvas from the closure that started it would place them against a canvas
   * that may since have changed — a card dragged, another branch opened.
   */
  const canvasRef = useRef(canvas);
  const setCanvas = useCallback((next: CanvasState | ((current: CanvasState) => CanvasState)) => {
    setCanvasState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      canvasRef.current = value;
      return value;
    });
  }, []);

  /*
   * What the diagram looked like when it was last saved or opened.
   *
   * Held as a signature rather than a flag so moving a card and putting it
   * back is not reported as unsaved work, and so a save that lands while the
   * reader is still dragging marks exactly what was sent, not what is on
   * screen a moment later.
   */
  const [savedSignature, setSavedSignature] = useState(() => canvasSignature(EMPTY_CANVAS));
  const sentSignature = useRef(savedSignature);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [selectedIds, setSelectedIdsState] = useState<string[]>([]);
  /*
   * Report a selection only when it is a different one.
   *
   * The canvas reports its selection as a fresh array, so storing it
   * unconditionally re-renders everything downstream for a selection that has
   * not changed — and, if the canvas reports on render, forever.
   */
  const setSelectedIds = useCallback((ids: string[] | ((current: string[]) => string[])) => {
    setSelectedIdsState((current) => {
      const next = typeof ids === "function" ? ids(current) : ids;
      return current.length === next.length && current.every((id, index) => id === next[index])
        ? current
        : next;
    });
  }, []);
  /*
   * The cards on a path the reader asked to be shown — to a model, or to a
   * quality result. Kept apart from the selection: the canvas owns that, and
   * it reports it back on every click, so a path written into it is wiped by
   * the next thing the reader touches.
   */
  const [pathIds, setPathIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Which cards each open hub brought in.
   *
   * A card's hub icon is a toggle: on, it shows what the card is related to
   * and makes the card one of the *active hubs* whose connected context is
   * read; off, it takes back exactly what it brought. The keys are the active
   * hubs, in the order they were opened.
   */
  const [revealed, setRevealedState] = useState<RevealLedger>({});
  const revealedRef = useRef(revealed);
  const setRevealed = useCallback((next: RevealLedger | ((current: RevealLedger) => RevealLedger)) => {
    setRevealedState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      revealedRef.current = value;
      return value;
    });
  }, []);

  /** Which side of the focus to show. A view; the graph is never edited. */
  const [direction, setDirection] = useState<Direction>(DIRECTION.BOTH);

  /**
   * Cards whose children are folded away. A view, like the filters: the
   * children stay on the canvas and come back exactly where they were.
   */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());

  /** Relationship kinds switched off in the view. Empty shows every kind. */
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(() => new Set());

  /** The focus the reader chose. Without one, the first active hub leads. */
  const [chosenFocus, setChosenFocus] = useState<string | null>(null);

  /** Whether an entry has to reach one selected hub or all of them. */
  const [hubMatch, setHubMatch] = useState<"any" | "every">("any");

  /** Which Discover run the results are read from. Empty: each dataset's newest. */
  const [runId, setRunId] = useState("");

  /** Paths into a model that tie, while the reader picks one. */
  const [pathChoice, setPathChoice] = useState<PathChoice | null>(null);

  /** Bulk changes, newest last. */
  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);

  /**
   * The cards the canvas should bring into view next. The counter changes on
   * every request so the canvas moves even when the same ids are asked for
   * twice.
   */
  const [focus, setFocus] = useState<{ key: number; ids: string[] }>({ key: 0, ids: [] });
  const bringIntoView = useCallback((ids: string[]) => {
    if (ids.length > 0) setFocus((current) => ({ key: current.key + 1, ids }));
  }, []);

  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [diagramName, setDiagramName] = useState<string | null>(null);

  const diagrams = useQuery({
    queryKey: IMPACT_DIAGRAMS_KEY,
    queryFn: () => impactDiagramApi.listDiagrams(),
  });

  const busy = useRef(false);

  const canvasIds = useMemo(() => canvasItemIds(canvas), [canvas]);
  const canvasEdges = useMemo(() => Object.values(canvas.edges), [canvas.edges]);
  const degrees = useMemo(() => degreeIndex(canvasEdges), [canvasEdges]);

  /** Remember the canvas before a change that touches several cards. */
  const remember = useCallback(() => {
    const step = { canvas: canvasRef.current, revealed: revealedRef.current };
    setUndoStack((stack) => pushUndo(stack, step));
  }, []);

  // ── the active hubs and the focus ─────────────────────────────────────────

  const hubIds = useMemo(() => {
    const present = new Set(canvasIds);
    return Object.keys(revealed).filter((id) => present.has(id) && !isObserved(id));
  }, [revealed, canvasIds]);

  const focusId = primaryFocus({ chosen: chosenFocus, hubIds, selectedIds, canvasIds });

  // ── what the view shows ───────────────────────────────────────────────────

  const shownEdges = useMemo(() => edgesOfKinds(canvasEdges, hiddenKinds), [canvasEdges, hiddenKinds]);

  /**
   * The canvas as the filters leave it.
   *
   * A view over the canvas, never an edit of it: switching a filter back
   * restores everything, because nothing was removed in the first place.
   */
  const view = useMemo<CanvasState>(() => {
    // Folded children first: whatever a collapsed card leads to leaves the
    // picture (the focus never does), then the direction filter reads what is
    // left.
    const hidden = collapsedHidden(
      [...collapsedIds].filter((id) => canvas.items[id]),
      shownEdges,
      new Set(focusId ? [focusId] : []),
    );
    const edgeIds = new Set(
      shownEdges
        .filter((edge) => !hidden.has(edge.source_id) && !hidden.has(edge.target_id))
        .map((edge) => edge.edge_id),
    );
    const base: CanvasState = {
      placements: canvas.placements.filter((p) => !hidden.has(p.itemId)),
      items: Object.fromEntries(Object.entries(canvas.items).filter(([id]) => !hidden.has(id))),
      edges: Object.fromEntries(Object.entries(canvas.edges).filter(([id]) => edgeIds.has(id))),
    };
    if (!focusId || direction === DIRECTION.BOTH) return base;
    const kept = filterByDirection(
      focusId,
      Object.values(base.items).map(toLayoutItem),
      Object.values(base.edges),
      direction,
    );
    const keptItems = new Set(kept.itemIds);
    const keptEdges = new Set(kept.edgeIds);
    return {
      placements: base.placements.filter((p) => keptItems.has(p.itemId)),
      items: Object.fromEntries(Object.entries(base.items).filter(([id]) => keptItems.has(id))),
      edges: Object.fromEntries(Object.entries(base.edges).filter(([id]) => keptEdges.has(id))),
    };
  }, [canvas, shownEdges, focusId, direction, collapsedIds]);

  /** How many children each card has on the canvas, for its fold control. */
  const childCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of Object.keys(canvas.items)) {
      const n = childrenOf(id, shownEdges).filter((child) => canvas.items[child]).length;
      if (n > 0) counts[id] = n;
    }
    return counts;
  }, [canvas.items, shownEdges]);

  // ── placing what arrives ──────────────────────────────────────────────────

  /**
   * Fold governance items into the canvas, each new card placed beside the
   * card it was reached from — upstream to its left, downstream to its right.
   *
   * `anchors` say which card each new one hangs off. Walking a path from its
   * start, every card not yet on the canvas is placed against the one before
   * it, so a path arrives as a line running the right way rather than a heap.
   */
  const absorbAlong = useCallback(
    (
      current: CanvasState,
      graph: { items: GovernanceItem[]; edges: GovernanceEdge[] },
      anchors: { anchorId: string; ids: string[] }[],
    ): CanvasState => {
      const allEdges: LayoutEdge[] = [...Object.values(current.edges), ...graph.edges];
      const placed: Placement[] = [...current.placements];
      const placedIds = new Set(placed.map((p) => p.itemId));
      const at = new Map<string, Placement>();
      for (const anchor of anchors) {
        const fresh = anchor.ids.filter((id) => !placedIds.has(id) && !current.items[id]);
        if (fresh.length === 0) continue;
        for (const placement of directionalPlacements(anchor.anchorId, fresh, allEdges, placed)) {
          placed.push(placement);
          placedIds.add(placement.itemId);
          at.set(placement.itemId, placement);
        }
      }
      const startY = lowestEdge(placed) + 48;
      return absorbNeighbourhood(current, graph, (ids) => {
        const leftovers = ids.filter((id) => !at.has(id));
        const extra = gridPlacements(leftovers, { startY });
        const byId = new Map<string, Placement>([...at.entries(), ...extra.map((p) => [p.itemId, p] as const)]);
        return ids.map((id) => byId.get(id)).filter((p): p is Placement => Boolean(p));
      });
    },
    [],
  );

  /** Put chosen items on the canvas, then close the lines between them. */
  const addToCanvas = useCallback(
    async (items: GovernanceItem[], at?: { x: number; y: number }) => {
      const current = canvasRef.current;
      const fresh = items.filter((item) => item?.item_id && !current.items[item.item_id]);
      if (fresh.length === 0) return;
      remember();
      const freshIds = fresh.map((item) => item.item_id);
      // Dropped cards land where they were dropped and spread from there; the
      // tick-and-add path puts them below what is already on the canvas.
      const placements = at
        ? freePlacements(at, freshIds, current.placements)
        : gridPlacements(freshIds, { startY: lowestEdge(current.placements) + 48 });
      const report = await structureGovernanceGraphApi.getItems(
        [...canvasItemIds(current).filter((id) => !isObserved(id)), ...freshIds],
      );
      // The server's view of these items wins over whatever the picker had:
      // the panel speaks Structure's language and only this answer is the
      // graph's own.
      setCanvas((latest) => {
        const byId = new Map(placements.map((p) => [p.itemId, p]));
        const merged = addItems(latest, fresh, (ids) =>
          ids.map((id) => byId.get(id)).filter((p): p is Placement => Boolean(p)),
        );
        return absorbNeighbourhood(merged, { items: report.items, edges: report.edges }, () => []);
      });
      bringIntoView(freshIds);
      setNotice(null);
    },
    [remember, setCanvas, bringIntoView],
  );

  /**
   * A card's hub icon: show what it is related to and make it an active hub,
   * or — pressed again — take back exactly what it brought and stand it down.
   */
  const toggleHub = useCallback(
    async (itemId: string) => {
      if (busy.current) return;

      if (revealedRef.current[itemId]) {
        remember();
        const doomed = revealedUnder(revealedRef.current, itemId);
        setCanvas((current) => removeItems(current, doomed));
        setSelectedIds((current) => current.filter((id) => !doomed.includes(id)));
        setPathIds((current) => current.filter((id) => !doomed.includes(id)));
        setRevealed((current) => {
          const { [itemId]: _dropped, ...rest } = current;
          return forgetReveals(rest, doomed);
        });
        setChosenFocus((current) => (current && doomed.includes(current) ? null : current));
        setNotice(null);
        return;
      }

      busy.current = true;
      try {
        const report = await structureGovernanceGraphApi.neighbourhood([itemId], depth);
        remember();
        const before = new Set(Object.keys(canvasRef.current.items));
        const brought = report.items.map((i) => i.item_id).filter((id) => !before.has(id));
        setCanvas((current) => absorbAlong(current, report, [{ anchorId: itemId, ids: brought }]));
        setRevealed((current) => recordReveal(current, itemId, brought));
        if (brought.length > 0) bringIntoView([itemId, ...brought]);
        setNotice(
          report.truncated
            ? report.message ?? "Not everything related could be shown."
            : report.items.length <= 1
              ? "Nothing else is related to that item."
              : null,
        );
      } finally {
        busy.current = false;
      }
    },
    [depth, remember, setCanvas, setSelectedIds, setRevealed, absorbAlong, bringIntoView],
  );

  /**
   * Bring every open branch to the new depth when the setting changes.
   *
   * Growing and shrinking: from three steps to one, the outer rings go; from
   * one to three, they arrive — placed by direction like any expansion. Cards
   * the reader added themselves are never touched.
   */
  const depthRef = useRef(depth);
  useEffect(() => {
    if (depthRef.current === depth) return;
    depthRef.current = depth;

    const anchors = Object.keys(revealedRef.current);
    if (anchors.length === 0) return;

    let cancelled = false;
    void (async () => {
      const reports = await Promise.all(
        anchors.map((anchor) => structureGovernanceGraphApi.neighbourhood([anchor], depth)),
      );
      if (cancelled) return;
      const reachable: Record<string, string[]> = {};
      anchors.forEach((anchor, index) => {
        reachable[anchor] = reports[index].items
          .map((item) => item.item_id)
          .filter((id) => id !== anchor);
      });
      const plan = refreshReveals(revealedRef.current, reachable, canvasItemIds(canvasRef.current));
      const wanted = new Set(Object.values(plan.addIds).flat());
      const graph = {
        items: reports.flatMap((r) => r.items),
        edges: reports.flatMap((r) => r.edges),
      };
      setCanvas((current) => {
        const trimmed = removeItems(current, plan.removeIds);
        return absorbAlong(
          trimmed,
          {
            items: graph.items.filter((item) => wanted.has(item.item_id) || trimmed.items[item.item_id]),
            edges: graph.edges,
          },
          anchors.map((anchor) => ({ anchorId: anchor, ids: plan.addIds[anchor] ?? [] })),
        );
      });
      setRevealed(plan.ledger);
      const gone = new Set(plan.removeIds);
      setPathIds((current) => current.filter((id) => !gone.has(id)));
      setSelectedIds((current) => current.filter((id) => !gone.has(id)));
      setChosenFocus((current) => (current && gone.has(current) ? null : current));
      const truncated = reports.find((r) => r.truncated);
      setNotice(truncated ? truncated.message ?? "Not everything related could be shown." : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [depth, setCanvas, setRevealed, setSelectedIds, absorbAlong]);

  // ── connected context: models ─────────────────────────────────────────────

  /**
   * The graph around the active hubs, read from the server at the current
   * depth — not from the canvas, because "what is connected" must include
   * what nobody has drawn yet.
   */
  const hubKey = useMemo(() => [...hubIds].sort().join("|"), [hubIds]);
  const hubGraphQuery = useQuery({
    queryKey: ["impact", "hub-graph", hubKey, depth],
    queryFn: () => structureGovernanceGraphApi.neighbourhood(hubIds, depth),
    enabled: hubIds.length > 0,
    staleTime: 30_000,
  });

  /** The server's graph around the hubs, with what is on the canvas folded in. */
  const hubGraph = useMemo(() => {
    const items = new Map<string, GovernanceItem>();
    const edges = new Map<string, GovernanceEdge>();
    const report: GovernanceGraphReport | undefined = hubGraphQuery.data;
    for (const item of report?.items ?? []) items.set(item.item_id, item);
    for (const edge of report?.edges ?? []) edges.set(edge.edge_id, edge);
    for (const item of Object.values(canvas.items)) {
      if (!isObserved(item.item_id)) items.set(item.item_id, item);
    }
    for (const edge of Object.values(canvas.edges)) {
      if (!isObserved(edge.edge_id)) edges.set(edge.edge_id, edge);
    }
    return { items, edges: edgesOfKinds([...edges.values()], hiddenKinds) };
  }, [hubGraphQuery.data, canvas.items, canvas.edges, hiddenKinds]);

  const hubGraphItems = useMemo(() => [...hubGraph.items.values()].map(toLayoutItem), [hubGraph]);

  /**
   * Which models the active hubs reach — at the depth, in the direction and
   * over the relationship kinds currently in force.
   */
  const connected = useMemo(
    () =>
      connectedModels(hubIds, hubGraphItems, hubGraph.edges, {
        depth,
        direction,
        match: hubMatch,
      }),
    [hubIds, hubGraphItems, hubGraph.edges, depth, direction, hubMatch],
  );

  /**
   * Put paths on the canvas: every card along each one, placed in the
   * direction it runs, reusing whatever is already drawn.
   */
  const addPaths = useCallback(
    (paths: string[][], message: string | null) => {
      const ids = [...new Set(paths.flat())];
      const items = ids
        .map((id) => hubGraph.items.get(id) ?? canvasRef.current.items[id])
        .filter((item): item is GovernanceItem => Boolean(item));
      const onPath = new Set(ids);
      const edges = hubGraph.edges.filter(
        (edge) => onPath.has(edge.source_id) && onPath.has(edge.target_id),
      );
      remember();
      setCanvas((current) => absorbAlong(current, { items, edges }, stepsAlong(paths)));
      setPathIds(ids);
      bringIntoView(ids);
      setNotice(message);
    },
    [hubGraph, remember, setCanvas, absorbAlong, bringIntoView],
  );

  /**
   * The nearest path from each connected hub into a model.
   *
   * "Nearest" is fewest relationship steps. Where paths tie, nothing is
   * chosen for the reader: the choice is put to them.
   */
  const addPathToModel = useCallback(
    (modelId: string) => {
      const options: { hubId: string; paths: string[][] }[] = [];
      for (const hubId of hubIds) {
        const found = nearestPaths(hubId, modelId, hubGraphItems, hubGraph.edges, { depth, direction });
        if (found.paths.length > 0) options.push({ hubId, paths: found.paths });
      }
      if (options.length === 0) {
        setPathIds([]);
        setNotice("No path reaches that model from the active hubs at this depth and direction.");
        return;
      }
      if (options.some((option) => option.paths.length > 1)) {
        const model = connected.find((m) => m.model_id === modelId);
        setPathChoice({ modelId, modelName: model?.model_name ?? modelId, options });
        return;
      }
      addPaths(
        options.map((option) => option.paths[0]),
        options.length < hubIds.length
          ? `Paths added from ${options.length} of ${hubIds.length} active hubs; the others do not reach that model.`
          : null,
      );
    },
    [hubIds, hubGraphItems, hubGraph.edges, depth, direction, connected, addPaths],
  );

  /** The reader's pick among tying paths: one path per hub. */
  const choosePaths = useCallback(
    (picked: string[][]) => {
      setPathChoice(null);
      if (picked.length > 0) addPaths(picked, null);
    },
    [addPaths],
  );

  // ── connected context: data quality results ───────────────────────────────

  /** What Discover found about the data behind the active hubs. */
  const qualityResultsQuery = useQuery({
    queryKey: ["impact", "quality-results", hubKey, runId],
    queryFn: () => impactQualityResultsApi.qualityResultsFor(hubIds, runId),
    enabled: hubIds.length > 0,
    staleTime: 30_000,
  });

  const results = useMemo<ResultEntry[]>(
    () => (qualityResultsQuery.data ? resultEntries(qualityResultsQuery.data, hubIds, hubMatch) : []),
    [qualityResultsQuery.data, hubIds, hubMatch],
  );

  /**
   * Put a result on the canvas with the chain that explains it.
   *
   * From each active hub that reaches it: hub → (what it contains) → the
   * property, the source column mapped onto the property, and the result that
   * assessed it. The Discover links are drawn as observations, never as
   * relationships Structure asserts, and the whole chain is ringed.
   */
  const addResultPath = useCallback(
    async (entryKey: string) => {
      const report = qualityResultsQuery.data;
      const entry = results.find((r) => r.key === entryKey);
      if (!report || !entry) return;

      const hubPaths = hubPathsTo(entry.target_node_id, entry.hub_ids, report.links ?? []);
      const governanceIds = [...new Set([...hubPaths.flatMap((p) => p.path), entry.target_node_id])];
      const graph = await structureGovernanceGraphApi.getItems(governanceIds);

      const observed = observedPath({
        hubId: entry.target_node_id,
        mapping: entry.mapping
          ? {
              mapping_id: entry.mapping.mapping_id,
              column_id: entry.mapping.column_id,
              column_name: entry.mapping.column_name,
              target_node_id: entry.mapping.target_node_id,
              target_name: entry.mapping.target_name,
              session_name: entry.mapping.session_name,
              file_name: entry.mapping.file_name,
            }
          : null,
        check: entry.check
          ? {
              quality_check_id: entry.check.quality_check_id,
              rule_name: entry.check.configuration_name ?? entry.check.rule_name,
              rule_code: entry.check.configuration_code ?? entry.check.rule_code,
              outcome: entry.check.status,
              observed_count: entry.check.observed_count,
              total_count: entry.check.total_count,
            }
          : null,
      });
      const observedEdges = observed.edges as unknown as GovernanceEdge[];
      const observedItems = observed.items as unknown as GovernanceItem[];

      remember();
      setCanvas((current) => {
        const withGovernance = absorbAlong(
          current,
          graph,
          stepsAlong(hubPaths.map((p) => p.path)),
        );
        // The column leads into the property and the result is read from it,
        // so the column lands on the property's left and the result on its
        // right — the same rule as every other card.
        const withObserved = absorbAlong(
          withGovernance,
          { items: observedItems, edges: observedEdges },
          [{ anchorId: entry.target_node_id, ids: observedItems.map((card) => card.item_id) }],
        );
        const edges = { ...withObserved.edges };
        for (const link of observedEdges) {
          if (withObserved.items[link.source_id] && withObserved.items[link.target_id]) {
            edges[link.edge_id] = link;
          }
        }
        return { ...withObserved, edges };
      });
      const ids = [...governanceIds, ...observedItems.map((card) => card.item_id)];
      setPathIds(ids);
      bringIntoView(ids);
      setNotice(
        hubIds.length > 1 && hubPaths.length < hubIds.length
          ? `Traced from ${hubPaths.length} of ${hubIds.length} active hubs; the others do not reach this result.`
          : null,
      );
    },
    [qualityResultsQuery.data, results, hubIds.length, remember, setCanvas, absorbAlong, bringIntoView],
  );

  // ── layout ────────────────────────────────────────────────────────────────

  /**
   * Lay the visible cards out around the focus: upstream left, downstream
   * right. Replaces the positions a reader dragged by hand — which is why it
   * is something they ask for — and leaves hidden cards where they were.
   */
  const relayout = useCallback(() => {
    const current = canvasRef.current;
    const centre = focusId ?? current.placements[0]?.itemId;
    if (!centre) return;
    remember();
    const visibleIds = new Set(view.placements.map((p) => p.itemId));
    setCanvas({
      ...current,
      placements: relayoutVisible(
        centre,
        Object.values(current.items).map(toLayoutItem),
        Object.values(view.edges),
        current.placements,
        visibleIds,
      ),
    });
    bringIntoView([...visibleIds]);
  }, [focusId, view, remember, setCanvas, bringIntoView]);

  const removeFromCanvas = useCallback(
    (itemIds: string[]) => {
      if (itemIds.length === 0) return;
      remember();
      setCanvas((current) => removeItems(current, itemIds));
      setSelectedIds((current) => current.filter((id) => !itemIds.includes(id)));
      setPathIds((current) => current.filter((id) => !itemIds.includes(id)));
      setRevealed((current) => forgetReveals(current, itemIds));
      setChosenFocus((current) => (current && itemIds.includes(current) ? null : current));
    },
    [remember, setCanvas, setSelectedIds, setRevealed],
  );

  const place = useCallback(
    (itemId: string, x: number, y: number) => {
      setCanvas((current) => moveItem(current, itemId, x, y));
    },
    [setCanvas],
  );

  const resetView = useCallback(() => {
    setPathIds([]);
    setSelectedIds([]);
    setRevealed({});
    setChosenFocus(null);
    setNotice(null);
  }, [setSelectedIds, setRevealed]);

  const clearCanvas = useCallback(() => {
    if (canvasRef.current.placements.length === 0) return;
    remember();
    setCanvas(EMPTY_CANVAS);
    resetView();
  }, [remember, setCanvas, resetView]);

  /**
   * A card's fold control.
   *
   * Collapsed: show its children again. Open with children on the canvas:
   * fold them (and everything beneath them) away. No children on the canvas
   * yet: fetch the cards it leads to directly and place them in the tier to
   * its right.
   */
  const toggleChildren = useCallback(
    async (itemId: string) => {
      if (collapsedIds.has(itemId)) {
        setCollapsedIds((current) => {
          const next = new Set(current);
          next.delete(itemId);
          return next;
        });
        return;
      }
      if ((childCounts[itemId] ?? 0) > 0) {
        setCollapsedIds((current) => new Set(current).add(itemId));
        return;
      }
      if (busy.current) return;
      busy.current = true;
      try {
        const report = await structureGovernanceGraphApi.neighbourhood([itemId], 1);
        const kids = childrenOf(itemId, report.edges);
        const fresh = kids.filter((id) => !canvasRef.current.items[id]);
        if (kids.length === 0) {
          setNotice("This card leads to nothing — it has no children.");
          return;
        }
        if (fresh.length === 0) {
          setNotice("Its children are already on the diagram.");
          return;
        }
        remember();
        const wanted = new Set([itemId, ...kids]);
        setCanvas((current) =>
          absorbAlong(
            current,
            {
              items: report.items.filter((item) => wanted.has(item.item_id)),
              edges: report.edges,
            },
            [{ anchorId: itemId, ids: fresh }],
          ),
        );
        bringIntoView([itemId, ...fresh]);
        setNotice(null);
      } finally {
        busy.current = false;
      }
    },
    [collapsedIds, childCounts, remember, setCanvas, absorbAlong, bringIntoView],
  );

  const undo = useCallback(() => {
    const { canvas: step, stack: rest } = popUndo(undoStack);
    if (!step) return;
    setUndoStack(rest);
    setCanvas(step.canvas);
    setRevealed(step.revealed);
    const present = new Set(canvasItemIds(step.canvas));
    setPathIds((current) => current.filter((id) => present.has(id)));
    setSelectedIds((current) => current.filter((id) => present.has(id)));
    setChosenFocus((current) => (current && present.has(current) ? current : null));
  }, [undoStack, setCanvas, setRevealed, setSelectedIds]);

  // ── saved diagrams ─────────────────────────────────────────────────────────

  const savePayload = useCallback(
    (name: string): SaveImpactDiagramPayload => ({
      name,
      nodes: toSavedNodes(canvasRef.current),
      edges: Object.values(canvasRef.current.edges)
        .filter((edge) => !isObserved(edge.edge_id))
        .map((edge) => ({ edge_key: edge.edge_id, edge_style: "routed" })),
    }),
    [],
  );

  const adopt = useCallback((record: ImpactDiagramRecord) => {
    setDiagramId(record.diagram_id);
    setDiagramName(record.name);
  }, []);

  const openDiagram = useCallback(
    async (id: string) => {
      const record = await impactDiagramApi.getDiagram(id);
      const report = await structureGovernanceGraphApi.getItems(record.nodes.map((n) => n.item_id));
      const { canvas: restored, missingIds } = restoreCanvas(
        record.nodes,
        report.items,
        report.edges,
      );
      setCanvas(restored);
      setSavedSignature(canvasSignature(restored));
      adopt(record);
      resetView();
      setUndoStack([]);
      setNotice(
        missingIds.length > 0
          ? `${missingIds.length} item${missingIds.length === 1 ? "" : "s"} in this diagram no longer exist and were left out.`
          : null,
      );
    },
    [adopt, setCanvas, resetView],
  );

  const saveMutation = useMutation({
    mutationFn: async (name: string) => {
      const payload = savePayload(name);
      sentSignature.current = canvasSignature(canvasRef.current);
      return diagramId
        ? impactDiagramApi.updateDiagram(diagramId, payload)
        : impactDiagramApi.createDiagram(payload);
    },
    onSuccess: async (record) => {
      setSavedSignature(sentSignature.current);
      adopt(record);
      await queryClient.invalidateQueries({ queryKey: IMPACT_DIAGRAMS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => impactDiagramApi.removeDiagram(id),
    onSuccess: async (_result, id) => {
      if (id === diagramId) {
        setDiagramId(null);
        setDiagramName(null);
      }
      await queryClient.invalidateQueries({ queryKey: IMPACT_DIAGRAMS_KEY });
    },
  });

  const newDiagram = useCallback(() => {
    setDiagramId(null);
    setDiagramName(null);
    setSavedSignature(canvasSignature(EMPTY_CANVAS));
    setCanvas(EMPTY_CANVAS);
    resetView();
    setUndoStack([]);
  }, [setCanvas, resetView]);

  const unsaved =
    hasUnsavedChanges(canvas, savedSignature) &&
    (canvasIds.some((id) => !isObserved(id)) || Boolean(diagramId));

  /** A card's name, whether it is drawn yet or only known from the hub graph. */
  const nameOf = useCallback(
    (id: string) => canvas.items[id]?.name ?? hubGraph.items.get(id)?.name ?? id,
    [canvas.items, hubGraph],
  );

  const toggleKind = useCallback((kind: string) => {
    setHiddenKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  return {
    canvas,
    view,
    canvasIds,
    canvasEdges,
    degrees,
    depth,
    setDepth,
    direction,
    setDirection,
    hiddenKinds,
    toggleKind,
    collapsedIds,
    childCounts,
    toggleChildren,
    nameOf,
    hubMatch,
    setHubMatch,
    hubIds,
    connectedModels: connected,
    hubGraphLoading: hubGraphQuery.isFetching,
    hubGraphTruncated: Boolean(hubGraphQuery.data?.truncated),
    addPathToModel,
    pathChoice,
    choosePaths,
    cancelPathChoice: () => setPathChoice(null),
    qualityResultsQuery,
    results,
    runId,
    setRunId,
    addResultPath,
    focusId,
    chosenFocus,
    setChosenFocus,
    relayout,
    selectedIds,
    setSelectedIds,
    notice,
    setNotice,
    diagrams,
    diagramId,
    unsaved,
    pathIds,
    clearPath: () => setPathIds([]),
    diagramName,
    addToCanvas,
    focus,
    toggleHub,
    expandedIds: revealed,
    removeFromCanvas,
    place,
    clearCanvas,
    undo,
    canUndo: undoStack.length > 0,
    openDiagram,
    newDiagram,
    saveMutation,
    deleteMutation,
  };
}
