import { OverflowText } from "@/shared/workspace/OverflowText";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CenterFocusStrongOutlinedIcon from "@mui/icons-material/CenterFocusStrongOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { RelationshipDetailsList } from "@/shared/workspace/RelationshipDetailsList";
import { SidePanel } from "@/shared/workspace/SidePanel";
import { DeleteAction } from "@/shared/workspace/WorkspaceIcons";
import { AuthoringPanel, WorkspaceBody, useStoredFlag } from "@/shared/workspace/WorkspacePanels";
import AddIcon from "@mui/icons-material/Add";
import AddchartOutlinedIcon from "@mui/icons-material/AddchartOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import UndoIcon from "@mui/icons-material/Undo";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import FilterListIcon from "@mui/icons-material/FilterList";
import AutoAwesomeMosaicOutlinedIcon from "@mui/icons-material/AutoAwesomeMosaicOutlined";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useImpactGraph } from "@/features/impact/state/useImpactGraph";
import {
  CARD_LEGEND,
  EDGE_COLOR,
  EDGE_DASHED,
  EDGE_LABEL,
  type DiagramEdgeKind,
  ImpactGraphCanvas,
} from "@/features/impact/ui/ImpactGraphCanvas";
import { ImpactConnectedContext } from "@/features/impact/ui/ImpactConnectedContext";
import { type CrossModelSelectableItem } from "@/features/cross-model";
import {
  toImpactItem,
  useImpactSelectionModels,
} from "@/features/impact/state/useImpactSelectionModels";
import { ImpactModelSelectionPanel } from "@/features/impact/ui/ImpactModelSelectionPanel";
import { DIRECTION, dragSelection, type Direction } from "@/features/impact/domain/impactLayout";
import { IMPACT_DRAG_TYPE } from "@/features/impact/domain/impactGraph";
import {
  GOVERNANCE_ITEM_KIND,
  type GovernanceItem,
} from "@/features/structure/domain/structureGovernanceGraph";

const DEPTHS = [
  { value: 1, label: "Directly related" },
  { value: 2, label: "Two steps out" },
  { value: 3, label: "Three steps out" },
];

/** Something the reader asked for that would throw away unsaved work. */
type PendingSwitch = { kind: "open"; diagramId: string } | { kind: "new" };

/**
 * Impact · Knowledge Graph.
 *
 * A reading surface over governance that already exists. Someone puts the
 * things they care about on a diagram, opens up what each one touches, keeps
 * the view if it was worth keeping, and that is the whole feature. No node, no
 * relationship and no rule is created here — the canvas can only add, remove,
 * move and save.
 *
 * Laid out so no control can be scrolled away from:
 *
 * - **Workspace header** — saved view, name, Save, New diagram.
 * - **Left column** — model, filters and search above the tree; the tree
 *   scrolls inside its own panel; **Add to diagram** sits in a footer under
 *   it that never moves.
 * - **Above the diagram** — expansion depth, direction, relationships, focus
 *   and the diagram actions.
 * - **Canvas toolbar** — zoom, fit and re-layout, on the canvas itself.
 * - **Connected context** — beside the diagram on a wide screen, above it on
 *   a narrow one.
 */
export function ImpactKnowledgeGraphWorkspace() {
  const vm = useImpactGraph();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [renaming, setRenaming] = useState("");
  const [nameDialog, setNameDialog] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<CrossModelSelectableItem[]>([]);
  const [kindMenu, setKindMenu] = useState<HTMLElement | null>(null);
  const [pathPicks, setPathPicks] = useState<Record<string, number>>({});
  const selectionModels = useImpactSelectionModels();
  const [busy, setBusy] = useState(false);
  // Folds only when the person folds it.
  const [selectionCollapsed, setSelectionCollapsed] = useStoredFlag("pdp-impact-item-selection-collapsed", false);

  const onCanvas = useMemo(() => new Set(vm.canvasIds), [vm.canvasIds]);
  const diagrams = vm.diagrams.data?.items ?? [];

  const kindCounts = useMemo(() => {
    let models = 0;
    let nodes = 0;
    let elements = 0;
    for (const id of vm.canvasIds) {
      const item = vm.canvas.items[id];
      if (!item || id.startsWith("observed:")) continue;
      if (item.item_kind === GOVERNANCE_ITEM_KIND.SUPPORT_DOMAIN_ELEMENT) elements += 1;
      else if (item.item_kind === GOVERNANCE_ITEM_KIND.HIERARCHY_MODEL) models += 1;
      else nodes += 1;
    }
    return { models, nodes, elements };
  }, [vm.canvasIds, vm.canvas.items]);

  const expandedIds = useMemo(() => new Set(Object.keys(vm.expandedIds)), [vm.expandedIds]);

  const edgeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of vm.canvasEdges) counts[edge.edge_kind] = (counts[edge.edge_kind] ?? 0) + 1;
    return counts;
  }, [vm.canvasEdges]);

  const hubNames = useMemo(
    () => Object.fromEntries(vm.hubIds.map((id) => [id, vm.nameOf(id)])),
    [vm.hubIds, vm],
  );

  /** Every card on the diagram can be the focus; hubs are listed first. */
  const focusCandidates = useMemo(() => {
    const real = vm.canvasIds.filter((id) => vm.canvas.items[id] && !id.startsWith("observed:"));
    const hubs = real.filter((id) => vm.hubIds.includes(id));
    const rest = real.filter((id) => !vm.hubIds.includes(id)).sort((a, b) => vm.nameOf(a).localeCompare(vm.nameOf(b)));
    return [...hubs, ...rest];
  }, [vm.canvasIds, vm.canvas.items, vm.hubIds, vm]);


  const run = async (work: Promise<unknown> | unknown) => {
    setBusy(true);
    try {
      await work;
    } finally {
      setBusy(false);
    }
  };

  // Ctrl/⌘-Z undoes the last bulk change, unless the reader is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (!vm.canUndo) return;
      event.preventDefault();
      vm.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm]);

  // Leaving the page with unsaved work asks first, as opening another view does.
  useEffect(() => {
    if (!vm.unsaved) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [vm.unsaved]);

  /**
   * A card dropped out of the picker. The payload is the item — or the whole
   * selection — the picker was showing, so nothing has to be fetched before
   * the cards can be placed.
   */
  const dropItem = useCallback(
    (raw: string, at: { x: number; y: number }) => {
      let dropped: GovernanceItem[];
      try {
        const parsed = JSON.parse(raw);
        dropped = Array.isArray(parsed) ? (parsed as GovernanceItem[]) : [parsed as GovernanceItem];
      } catch {
        return;
      }
      const fresh = dropped.filter((item) => item?.item_id && !onCanvas.has(item.item_id));
      if (fresh.length === 0) return;
      setPickerSelection([]);
      void run(vm.addToCanvas(fresh, at));
    },
    // `run` only flips a busy flag; depending on it would rebuild this handler
    // on every render for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onCanvas, vm],
  );

  const save = (then?: () => void) => {
    const name = (renaming.trim() || vm.diagramName || "Impact view").slice(0, 200);
    void run(
      vm.saveMutation.mutateAsync(name).then(() => {
        setRenaming("");
        then?.();
      }),
    );
  };

  /** Open another view or start a new one — asking first if work would be lost. */
  const switchTo = (next: PendingSwitch) => {
    if (vm.unsaved) {
      setPending(next);
      return;
    }
    proceed(next);
  };
  const proceed = (next: PendingSwitch) => {
    setPending(null);
    if (next.kind === "new") vm.newDiagram();
    else void run(vm.openDiagram(next.diagramId));
  };

  const kindsShown = (Object.keys(EDGE_LABEL) as DiagramEdgeKind[]).filter((k) => !vm.hiddenKinds.has(k));

  // Element Details follows the selection, else the focus.
  const selectedId = vm.selectedIds[0] ?? vm.focusId ?? null;
  const selectedItem = selectedId && !selectedId.startsWith("observed:") ? vm.canvas.items[selectedId] : undefined;
  const immediate = selectedItem ? vm.canvasEdges.filter((edge) => edge.source_id === selectedId || edge.target_id === selectedId) : [];
  const kindLabel = (item: GovernanceItem) =>
    item.item_kind === GOVERNANCE_ITEM_KIND.HIERARCHY_MODEL
      ? "Hierarchy model"
      : item.item_kind === GOVERNANCE_ITEM_KIND.SUPPORT_DOMAIN_ELEMENT
        ? "Governed value"
        : item.is_property
          ? "Property node"
          : "Hierarchy node";

  const diagramToolbar = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {vm.selectedIds.length > 0 && (
        <Button size="small" color="error" onClick={() => vm.removeFromCanvas(vm.selectedIds)} sx={{ textTransform: "none" }}>
          Take {vm.selectedIds.length} off
        </Button>
      )}
      <Tooltip title="Undo the last change to the diagram (Ctrl/⌘-Z)">
        <span>
          <IconButton size="small" disabled={!vm.canUndo} onClick={vm.undo} aria-label="Undo">
            <UndoIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Auto re-layout: arrange every visible card around the focus — upstream left, downstream right. Replaces positions you dragged by hand; hidden cards keep theirs.">
        <span>
          <IconButton size="small" disabled={vm.canvasIds.length === 0} onClick={vm.relayout} aria-label="Auto re-layout">
            <AutoAwesomeMosaicOutlinedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Take everything off the diagram (Undo brings it back)">
        <span>
          <IconButton size="small" disabled={vm.canvasIds.length === 0} onClick={vm.clearCanvas} aria-label="Clear the diagram">
            <ClearAllIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );

  const authoring = (
    <AuthoringPanel
      title="Impact Diagram Workspace"
      hint="Drag rows onto the canvas · double-click a card to focus it · its hub icon opens what it touches"
      toolbar={diagramToolbar}
      flush
    >
      {/* What the diagram shows: depth, direction, relationship kinds, focus. */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <TextField select size="small" label="Expand shows" value={vm.depth} onChange={(event) => vm.setDepth(Number(event.target.value))} sx={{ width: 150 }}>
          {DEPTHS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        {/* Direction is read from the recorded relationship, so this narrows what is drawn and never what the graph says. */}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={vm.direction}
          onChange={(_, value: Direction | null) => value && vm.setDirection(value)}
          aria-label="Which side of the focus to show"
          sx={{ "& .MuiToggleButton-root": { textTransform: "none", px: 1.25, py: 0.6 } }}
        >
          <ToggleButton value={DIRECTION.BOTH}>Both</ToggleButton>
          <ToggleButton value={DIRECTION.UPSTREAM}>Upstream</ToggleButton>
          <ToggleButton value={DIRECTION.DOWNSTREAM}>Downstream</ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Which relationship kinds are drawn">
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<FilterListIcon />}
            onClick={(event) => setKindMenu(event.currentTarget)}
            sx={{ textTransform: "none", borderColor: "divider", whiteSpace: "nowrap" }}
          >
            {kindsShown.length === Object.keys(EDGE_LABEL).length ? "All kinds" : `${kindsShown.length}/${Object.keys(EDGE_LABEL).length} kinds`}
          </Button>
        </Tooltip>
        <Menu anchorEl={kindMenu} open={Boolean(kindMenu)} onClose={() => setKindMenu(null)}>
          {(Object.keys(EDGE_LABEL) as DiagramEdgeKind[]).map((kind) => (
            <MenuItem key={kind} dense onClick={() => vm.toggleKind(kind)}>
              <ListItemIcon>
                <Checkbox size="small" edge="start" checked={!vm.hiddenKinds.has(kind)} disableRipple />
              </ListItemIcon>
              <ListItemText primary={EDGE_LABEL[kind]} secondary={`${edgeCounts[kind] ?? 0} on the diagram`} />
            </MenuItem>
          ))}
        </Menu>
        {/* Focus is one card, so it is a single, searchable pick — not a list
            of options to tick. The explanation sits on an info icon beside
            it, never over the open list. */}
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Autocomplete
            size="small"
            options={focusCandidates}
            value={vm.focusId && focusCandidates.includes(vm.focusId) ? vm.focusId : null}
            onChange={(_event, value) => vm.setChosenFocus(value ?? null)}
            getOptionLabel={(id) => vm.nameOf(id)}
            groupBy={(id) => (vm.hubIds.includes(id) ? "Hubs" : "On the diagram")}
            disabled={focusCandidates.length === 0}
            noOptionsText="No cards on the diagram"
            sx={{ width: 220 }}
            slotProps={{ popper: { sx: { minWidth: 280 } } }}
            renderOption={(optionProps, id) => {
              const { key, ...rest } = optionProps as typeof optionProps & { key: string };
              const item = vm.canvas.items[id];
              return (
                <li key={key} {...rest}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
                    {vm.hubIds.includes(id) ? <HubOutlinedIcon fontSize="small" color="secondary" /> : <CenterFocusStrongOutlinedIcon fontSize="small" sx={{ color: "text.disabled" }} />}
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap title={vm.nameOf(id)}>{vm.nameOf(id)}</Typography>
                      {item && (
                        <Typography variant="caption" color="text.secondary" noWrap display="block" title={item.model_name}>
                          {item.type_name ?? ""}{item.type_name ? " · " : ""}{item.model_name}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Focus"
                placeholder="Pick a card"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: <CenterFocusStrongOutlinedIcon fontSize="small" sx={{ color: "text.disabled", ml: 0.5 }} />,
                }}
              />
            )}
          />
          <Tooltip title="The card the diagram is arranged around: upstream to its left, downstream to its right. Double-click a card on the canvas to make it the focus.">
            <InfoOutlinedIcon fontSize="small" sx={{ color: "text.disabled", cursor: "help" }} aria-label="About focus" />
          </Tooltip>
        </Stack>
      </Stack>

      {/* ── the canvas ── */}
      <Box sx={{ flex: 1, minHeight: 360, position: "relative", overflow: "hidden" }}>
        {/* ReactFlow lays its renderer out absolutely, so the flow fills this box by inset. */}
        <Box sx={{ position: "absolute", inset: 0 }}>
          {/* Always mounted, even empty: the empty canvas is the one a reader most wants to drag their first card onto. */}
          <ImpactGraphCanvas
            canvas={vm.view}
            fitKey={vm.diagramId ?? "new"}
            focus={vm.focus}
            expandedIds={expandedIds}
            onDropItem={dropItem}
            onRelayout={vm.relayout}
            degrees={vm.degrees}
            seedIds={vm.selectedIds}
            highlightIds={vm.pathIds}
            focusId={vm.focusId}
            onFocus={vm.setChosenFocus}
            onMove={vm.place}
            onRemove={(id) => vm.removeFromCanvas([id])}
            onExpand={(id) => void run(vm.toggleHub(id))}
            childCounts={vm.childCounts}
            collapsedIds={vm.collapsedIds}
            onToggleChildren={(id) => void run(vm.toggleChildren(id))}
            onSelectionChange={vm.setSelectedIds}
          />
          {vm.canvasIds.length === 0 && (
            <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ position: "absolute", inset: 0, px: 4, textAlign: "center", pointerEvents: "none" }}>
              <Typography variant="subtitle1" fontWeight={600}>
                Nothing on the diagram yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Drag rows from Model Selection onto this canvas, or pick them and add them. Press a card's hub icon to see what it is related to.
              </Typography>
            </Stack>
          )}
        </Box>
        {vm.pathIds.length > 0 && (
          <Chip
            size="small"
            label={`Path highlighted · ${vm.pathIds.length} card${vm.pathIds.length === 1 ? "" : "s"}`}
            onDelete={vm.clearPath}
            sx={{ position: "absolute", left: 12, top: 12, bgcolor: "background.paper", boxShadow: 1 }}
          />
        )}
      </Box>

      {/* ── legend ── */}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flexShrink: 0, px: 1.5, py: 0.75, borderTop: 1, borderColor: "divider" }}>
        {CARD_LEGEND.map((entry) => (
          <Stack key={entry.label} direction="row" spacing={0.5} alignItems="center">
            <Box
              sx={{
                width: 16,
                height: 10,
                borderRadius: 0.5,
                border: 1,
                bgcolor: entry.tint,
                borderColor: entry.accent,
                borderStyle: entry.label === "Found by Discover" ? "dashed" : "solid",
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {entry.label}
            </Typography>
          </Stack>
        ))}
        {(Object.keys(EDGE_LABEL) as DiagramEdgeKind[]).map((kind) => (
          <Stack key={kind} direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 18, height: 0, borderTop: EDGE_DASHED[kind] ? "2px dashed" : "2px solid", borderColor: EDGE_COLOR[kind] }} />
            <Typography variant="caption" color="text.secondary">
              {EDGE_LABEL[kind]} ({edgeCounts[kind] ?? 0})
            </Typography>
          </Stack>
        ))}
        <Typography variant="caption" color="text.disabled">
          Broken lines were not asserted by governance.
        </Typography>
      </Stack>
    </AuthoringPanel>
  );

  return (
    <>
      <Stack spacing={1} sx={{ flex: 1, minHeight: 520, display: "flex" }}>
        {/* Navigation, as in MWS and SWS. Impact has one view: the knowledge graph. */}
        <Stack direction="row" alignItems="center" sx={{ borderBottom: 1, borderColor: "divider", minHeight: 40 }}>
          <Tabs value="graph" sx={{ minHeight: 40, flex: 1, "& .MuiTab-root": { minHeight: 40, py: 0.5, textTransform: "none", fontSize: 15, fontWeight: 700 } }}>
            <Tab value="graph" label="Knowledge Graph" />
          </Tabs>
        </Stack>

        <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
          {/* ── left: what can go on the diagram ── */}
          <SidePanel
            title="Model Selection"
            collapsed={selectionCollapsed}
            onToggle={() => setSelectionCollapsed(!selectionCollapsed)}
            width={320}
            footer={
              <Stack spacing={0.5}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  disabled={pickerSelection.length === 0 || busy}
                  onClick={() => {
                    void run(vm.addToCanvas(pickerSelection.map(toImpactItem)));
                    setPickerSelection([]);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  {pickerSelection.length === 0 ? "Add to diagram" : `Add ${pickerSelection.length} to diagram`}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Drag a row onto the canvas or double-click it. Ctrl-click (⌘-click) picks several; dragging any of them brings them all.
                </Typography>
              </Stack>
            }
          >
            <ImpactModelSelectionPanel
              models={selectionModels}
              selection={pickerSelection}
              onSelectionChange={setPickerSelection}
              onItemDoubleClick={(item) => void run(vm.addToCanvas([toImpactItem(item)]))}
              onItemDragStart={(item, event) => {
                // Dragging one of several selected rows carries all of them; a
                // row outside the selection carries only itself.
                const carried = dragSelection(item.id, pickerSelection.map((selected) => selected.id));
                const byId = new Map(pickerSelection.map((s) => [s.id, s]));
                const payload = carried.map((id) => toImpactItem(id === item.id ? item : (byId.get(id) ?? item)));
                event.dataTransfer.setData(IMPACT_DRAG_TYPE, JSON.stringify(payload));
                event.dataTransfer.setData("text/plain", payload.length === 1 ? item.name : `${payload.length} instances`);
                event.dataTransfer.effectAllowed = "copy";
              }}
              getItemStatus={(item) =>
                onCanvas.has(item.id) ? { disabled: true, label: "On the diagram", reason: "Already on this diagram." } : undefined
              }
            />
          </SidePanel>

          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {/* ── header: the saved view, laid out as an open model's header in MWS/SWS ── */}
            <Paper variant="outlined" sx={{ px: 2, py: 1.25, flexShrink: 0 }}>
              <Stack direction={{ xs: "column", lg: "row" }} spacing={{ xs: 1.25, lg: 2 }} alignItems={{ lg: "center" }}>
                <Stack direction="row" spacing={1.75} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                  <Avatar variant="rounded" sx={{ width: 38, height: 38, bgcolor: "#6a1b9a" }}>
                    <HubOutlinedIcon />
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <OverflowText variant="subtitle1" fontWeight={700} >
                        {vm.diagramName ?? "New diagram"}
                      </OverflowText>
                      <Chip size="small" variant="outlined" label="View only" sx={{ height: 20, fontSize: 11, flexShrink: 0 }} />
                      {vm.unsaved && (
                        <Tooltip title="What is on screen is not what is saved.">
                          <Chip size="small" variant="outlined" color="warning" label="Unsaved" sx={{ height: 20, fontSize: 11, flexShrink: 0 }} />
                        </Tooltip>
                      )}
                    </Stack>
                    <OverflowText variant="body2" color="text.secondary" >
                      Read what a node is related to, and what changing it would reach.
                    </OverflowText>
                  </Box>
                  <Stack direction="row" spacing={2.5} sx={{ display: { xs: "none", md: "flex" }, flexShrink: 0 }}>
                    {[
                      ...(kindCounts.models > 0 ? [{ label: "Models", value: kindCounts.models }] : []),
                      { label: "Nodes", value: kindCounts.nodes },
                      { label: "Values", value: kindCounts.elements, hint: "Governed values" },
                      { label: "Relationships", value: vm.canvasEdges.length },
                    ].map((count) => (
                      <Tooltip key={count.label} title={count.hint ?? ""}>
                        <Box sx={{ textAlign: "right" }}>
                          <Typography variant="subtitle2" fontWeight={700} lineHeight={1.2}>
                            {count.value}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                            {count.label}
                          </Typography>
                        </Box>
                      </Tooltip>
                    ))}
                  </Stack>
                </Stack>

                {/* Saved views: open one, save, start a new one. */}
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                  <TextField
                    select
                    size="small"
                    value={vm.diagramId ?? ""}
                    onChange={(event) => {
                      const id = event.target.value;
                      switchTo(id ? { kind: "open", diagramId: id } : { kind: "new" });
                    }}
                    SelectProps={{ displayEmpty: true, renderValue: (value) => (value ? vm.diagramName ?? "Saved view" : "Open saved view…") }}
                    sx={{ width: 220 }}
                    InputProps={{ startAdornment: <FolderOpenOutlinedIcon fontSize="small" sx={{ mr: 1, color: "text.disabled" }} /> }}
                    inputProps={{ "aria-label": "Saved view" }}
                  >
                    <MenuItem value="">New diagram…</MenuItem>
                    {diagrams.map((diagram) => (
                      <MenuItem key={diagram.diagram_id} value={diagram.diagram_id}>
                        {diagram.name} · {diagram.node_count} item{diagram.node_count === 1 ? "" : "s"}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SaveOutlinedIcon />}
                    disabled={vm.canvasIds.length === 0 || vm.saveMutation.isPending}
                    onClick={() => (vm.diagramId ? save() : setNameDialog(true))}
                    sx={{ textTransform: "none", whiteSpace: "nowrap" }}
                  >
                    {vm.saveMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Tooltip title="Start a new diagram">
                    <IconButton size="small" onClick={() => switchTo({ kind: "new" })} aria-label="New diagram" sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                      <AddchartOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {vm.diagramId && (
                    <Tooltip title="Rename this saved view">
                      <IconButton size="small" onClick={() => setNameDialog(true)} aria-label="Rename saved view" sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {vm.diagramId && (
                    <DeleteAction label="this saved view" disabled={vm.deleteMutation.isPending} onClick={() => setConfirmDelete(true)} />
                  )}
                </Stack>
              </Stack>
            </Paper>

            <Dialog open={nameDialog} onClose={() => setNameDialog(false)} maxWidth="xs" fullWidth>
              <DialogTitle>{vm.diagramId ? "Rename saved view" : "Save view"}</DialogTitle>
              <DialogContent>
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  label="Name"
                  placeholder={vm.diagramName ?? "Impact view"}
                  value={renaming}
                  onChange={(event) => setRenaming(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setNameDialog(false);
                      save();
                    }
                  }}
                  sx={{ mt: 1 }}
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setNameDialog(false)} sx={{ textTransform: "none" }}>
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={() => {
                    setNameDialog(false);
                    save();
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Save
                </Button>
              </DialogActions>
            </Dialog>

            {vm.notice && (
              <Alert severity="info" onClose={() => vm.setNotice(null)} sx={{ py: 0.25, flexShrink: 0 }}>
                {vm.notice}
              </Alert>
            )}

            <WorkspaceBody
              storageKey="impact-graph"
              authoring={authoring}
              element={{
                title: "Element Details",
                isEmpty: !selectedItem,
                empty: "Select a card on the diagram.",
                actions: selectedItem ? (
                  <Stack direction="row">
                    <Tooltip title="Make it the focus">
                      <IconButton size="small" onClick={() => vm.setChosenFocus(selectedItem.item_id)} aria-label="Make it the focus">
                        <CenterFocusStrongOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={vm.hubIds.includes(selectedItem.item_id) ? "Hide what it touches" : "Show what it touches"}>
                      <IconButton size="small" onClick={() => void run(vm.toggleHub(selectedItem.item_id))} aria-label="Show what it touches">
                        <HubOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Take it off the diagram (governance is untouched)">
                      <IconButton size="small" color="error" onClick={() => vm.removeFromCanvas([selectedItem.item_id])} aria-label="Take it off the diagram">
                        <RemoveCircleOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ) : undefined,
                content: selectedItem && (
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {selectedItem.name}
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={kindLabel(selectedItem)} sx={{ height: 20, fontSize: 11 }} />
                      <Chip size="small" variant="outlined" label={selectedItem.status} sx={{ height: 20, fontSize: 11 }} />
                      {selectedItem.item_id === vm.focusId && <Chip size="small" color="primary" label="Focus" sx={{ height: 20, fontSize: 11 }} />}
                      {vm.hubIds.includes(selectedItem.item_id) && <Chip size="small" color="secondary" label="Hub" sx={{ height: 20, fontSize: 11 }} />}
                    </Stack>
                    {[
                      ["Model", selectedItem.model_name],
                      ["Type", selectedItem.type_name ?? "—"],
                      ["On the diagram", `${vm.degrees[selectedItem.item_id] ?? 0} relationship${(vm.degrees[selectedItem.item_id] ?? 0) === 1 ? "" : "s"}`],
                    ].map(([label, value]) => (
                      <Stack key={label} direction="row" spacing={1}>
                        <Typography variant="body2" color="text.secondary" sx={{ width: 110, flexShrink: 0 }}>
                          {label}
                        </Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {value}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                ),
              }}
              relationship={{
                title: "Relationship Details",
                isEmpty: !selectedItem,
                empty: "Select a card to see its immediate relationships on the diagram.",
                content: (
                  <RelationshipDetailsList
                    groups={[
                      {
                        title: "On the diagram",
                        items: immediate.map((edge) => {
                          const outgoing = edge.source_id === selectedId;
                          const otherId = outgoing ? edge.target_id : edge.source_id;
                          return {
                            key: edge.edge_id,
                            label: vm.nameOf(otherId),
                            relation: EDGE_LABEL[edge.edge_kind as DiagramEdgeKind] ?? edge.label,
                            direction: outgoing ? ("out" as const) : ("in" as const),
                            secondary: edge.asserted ? edge.label || undefined : "Not asserted by governance",
                            onClick: () => vm.setSelectedIds([otherId]),
                          };
                        }),
                      },
                    ]}
                  />
                ),
              }}
              extra={{
                title: "Connected Context",
                flush: true,
                content: (
                  <ImpactConnectedContext
                    hubIds={vm.hubIds}
                    hubNames={hubNames}
                    focusId={vm.focusId}
                    onToggleHub={(id) => void run(vm.toggleHub(id))}
                    models={vm.connectedModels}
                    modelsLoading={vm.hubGraphLoading}
                    modelsTruncated={vm.hubGraphTruncated}
                    match={vm.hubMatch}
                    onMatchChange={vm.setHubMatch}
                    onPickModel={vm.addPathToModel}
                    results={vm.results}
                    report={vm.qualityResultsQuery.data}
                    resultsLoading={vm.qualityResultsQuery.isFetching}
                    runId={vm.runId}
                    onRunChange={vm.setRunId}
                    onPickResult={(key) => void run(vm.addResultPath(key))}
                  />
                ),
              }}
            />
          </Stack>
        </Box>
      </Stack>

      {/* ── ties: the reader chooses ─────────────────────────────────────── */}
      <Dialog
        open={Boolean(vm.pathChoice)}
        onClose={vm.cancelPathChoice}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Choose a path into {vm.pathChoice?.modelName}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1.5 }}>
            More than one instance in this model is equally near. Pick the path to add for each hub.
          </DialogContentText>
          {vm.pathChoice?.options.map((option) => (
            <Box key={option.hubId} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2">From {vm.nameOf(option.hubId)}</Typography>
              <RadioGroup
                value={String(pathPicks[option.hubId] ?? 0)}
                onChange={(event) =>
                  setPathPicks((current) => ({ ...current, [option.hubId]: Number(event.target.value) }))
                }
              >
                {option.paths.map((path, index) => (
                  <FormControlLabel
                    key={path.join(">")}
                    value={String(index)}
                    control={<Radio size="small" />}
                    label={
                      <Typography variant="body2">
                        {path.map((id) => vm.nameOf(id)).join(" → ")}
                      </Typography>
                    }
                  />
                ))}
              </RadioGroup>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={vm.cancelPathChoice} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const picked =
                vm.pathChoice?.options.map((option) => option.paths[pathPicks[option.hubId] ?? 0]) ?? [];
              setPathPicks({});
              vm.choosePaths(picked.filter(Boolean));
            }}
            sx={{ textTransform: "none" }}
          >
            Add {vm.pathChoice && vm.pathChoice.options.length > 1 ? "these paths" : "this path"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── unsaved work ─────────────────────────────────────────────────── */}
      <Dialog open={Boolean(pending)} onClose={() => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Save changes first?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This diagram has changes that are not saved. They will be lost if you{" "}
            {pending?.kind === "new" ? "start a new diagram" : "open another view"}.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button color="error" onClick={() => pending && proceed(pending)} sx={{ textTransform: "none" }}>
            Discard changes
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const next = pending;
              setPending(null);
              if (next) save(() => proceed(next));
            }}
            sx={{ textTransform: "none" }}
          >
            Save and continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deleting a saved view cannot be undone, so it asks first. */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this saved view?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <strong>&ldquo;{vm.diagramName ?? "Untitled"}&rdquo;</strong> will be removed. The nodes
            and relationships it showed are governance and stay exactly as they are — only this
            reading of them goes.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} sx={{ textTransform: "none" }}>
            Keep it
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={vm.deleteMutation.isPending}
            onClick={() => {
              setConfirmDelete(false);
              void run(vm.deleteMutation.mutateAsync(vm.diagramId!));
            }}
            sx={{ textTransform: "none" }}
          >
            Delete the view
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
