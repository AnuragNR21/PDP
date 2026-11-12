import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HubOutlined from "@mui/icons-material/HubOutlined";
import SearchIcon from "@mui/icons-material/Search";
import SwapHorizOutlined from "@mui/icons-material/SwapHorizOutlined";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useState, type DragEvent } from "react";
import type { CrossModelSelectableItem, CrossModelSelectionModel } from "@/features/cross-model";
import type { CrossModelTypeOption } from "@/features/model/domain/types";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import { OverflowText } from "@/shared/workspace/OverflowText";
import { MODEL_KIND_COLOR, ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import type { ModelKind as WorkspaceKind } from "@/shared/workspace/workspaceModel";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import { LifecycleChip } from "./lifecycle";
import { instanceContexts, uniqueById } from "@/features/structure/domain/instanceContext";
import { extendsOf, isCommon, orderedPackages, packageIdOf, usePackageState } from "@/shared/workspace/modelPackages";
import { groupByPackage } from "@/shared/workspace/packageGrouping";
import {
  CommonModelChip,
  GroupByPackageToggle,
  ModelExtendsCaption,
  PackageGroupHeader,
  useFoldedPackages,
  useGroupByPackage,
} from "@/shared/workspace/PackageGroupParts";

export type MatrixSide = "source" | "target";
type KindFilter = WorkspaceKind | "all";

const kindOf = (modelKind: string): WorkspaceKind => (modelKind === "HIERARCHY_MODEL" ? "hierarchy" : "support");

type TypeEntry = { id: string; name: string; depth: number; badge?: CrossModelTypeOption["badge"]; instances: CrossModelSelectableItem[] };
type ModelEntry = { id: string; name: string; kind: WorkspaceKind; status: string; loading: boolean; types: TypeEntry[]; instances: CrossModelSelectableItem[] };

/** Hierarchy node types in tree order, with their depth; element types as they come. */
function orderTypes(kind: WorkspaceKind, types: CrossModelTypeOption[]) {
  if (kind !== "hierarchy") return types.map((type) => ({ type, depth: 0 }));
  const ids = new Set(types.map((type) => type.id));
  const children = new Map<string | null, CrossModelTypeOption[]>();
  for (const type of types) {
    const parent = type.parentId && ids.has(type.parentId) ? type.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), type]);
  }
  const ordered: Array<{ type: CrossModelTypeOption; depth: number }> = [];
  const visit = (parent: string | null, depth: number) => {
    for (const type of children.get(parent) ?? []) {
      ordered.push({ type, depth });
      visit(type.id, depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box component="mark" sx={{ bgcolor: "warning.light", color: "inherit", px: 0 }}>{text.slice(at, at + query.length)}</Box>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * Item Selection for the SWS Relationship Matrix — the MWS Relationship
 * Matrix's Type Selection panel one level deeper: Model → Node Type / Element
 * Type → Instance. The same Source / Target toggle and Swap, kind toggles,
 * Active filter, one search over every model, type and instance name, and the
 * picked items as chips. A whole model or a whole type can be taken at once
 * with its checkbox, which is also how a large population is cut down to the
 * types that matter.
 */
type MatrixProps = {
  mode?: "matrix";
  source: CrossModelSelectableItem[];
  target: CrossModelSelectableItem[];
  onSourceChange: (items: CrossModelSelectableItem[]) => void;
  onTargetChange: (items: CrossModelSelectableItem[]) => void;
  onSwap: () => void;
};
/** Diagram: a checked instance is on the canvas. Adding or removing one changes the projection only. */
type DiagramProps = {
  mode: "diagram";
  onCanvas: Set<string>;
  onAdd: (items: CrossModelSelectableItem[]) => void;
  onRemove: (items: CrossModelSelectableItem[]) => void;
  /** A row (or a whole type) is dragged towards the canvas. */
  onDragStart: (items: CrossModelSelectableItem[], event: DragEvent<HTMLElement>) => void;
};

export function InstanceSelectionPanel(props: {
  models: CrossModelSelectionModel[];
  typeOptions: CrossModelTypeOption[];
  modelStatus: Map<string, string>;
} & (MatrixProps | DiagramProps)) {
  const isDiagram = props.mode === "diagram";
  const [side, setSide] = useState<MatrixSide>("source");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Models under their Packages, as in Model Selection (on unless turned off).
  const packageState = usePackageState();
  const [grouped, setGrouped] = useGroupByPackage("sws-relationship");
  const [foldedPackages, togglePackage] = useFoldedPackages();

  const selected = props.mode === "diagram" ? [] : side === "source" ? props.source : props.target;
  const matrixChosen = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);
  const chosen = props.mode === "diagram" ? props.onCanvas : matrixChosen;
  const setSelected = (items: CrossModelSelectableItem[]) => {
    if (props.mode === "diagram") return;
    (side === "source" ? props.onSourceChange : props.onTargetChange)(items);
  };

  // Instances sharing a name (a property under several assets) carry their owner: "Manufacturer · Pole".
  const contexts = useMemo(() => instanceContexts(props.models.flatMap((model) => model.items)), [props.models]);
  const labelOf = (item: CrossModelSelectableItem) => {
    const context = contexts.get(item.id);
    return context ? `${item.name} · ${context}` : item.name;
  };

  const entries = useMemo<ModelEntry[]>(() => {
    const typesByModel = new Map<string, CrossModelTypeOption[]>();
    for (const type of props.typeOptions) typesByModel.set(type.modelId, [...(typesByModel.get(type.modelId) ?? []), type]);
    return props.models.map((model) => {
      const kind = kindOf(model.modelKind);
      const byType = new Map<string, CrossModelSelectableItem[]>();
      // Each instance once, even if a source lists it twice.
      for (const item of uniqueById(model.items)) byType.set(item.typeId, [...(byType.get(item.typeId) ?? []), item]);
      for (const list of byType.values()) {
        list.sort((a, b) => a.name.localeCompare(b.name) || (contexts.get(a.id) ?? "").localeCompare(contexts.get(b.id) ?? ""));
      }
      const known = orderTypes(kind, typesByModel.get(model.id) ?? []);
      const knownIds = new Set(known.map(({ type }) => type.id));
      const types: TypeEntry[] = known.map(({ type, depth }) => ({ id: type.id, name: type.name, depth, badge: type.badge, instances: byType.get(type.id) ?? [] }));
      // An instance whose type the options do not list yet still gets a home.
      for (const [typeId, instances] of byType) {
        if (!knownIds.has(typeId)) types.push({ id: typeId, name: instances[0].typeName || "Other", depth: 0, badge: instances[0].badge, instances });
      }
      return {
        id: model.id,
        name: model.name,
        kind,
        status: props.modelStatus.get(model.id) ?? "",
        loading: Boolean(model.loading),
        types,
        instances: types.flatMap((type) => type.instances),
      };
    });
  }, [props.models, props.typeOptions, props.modelStatus, contexts]);

  const query = search.trim().toLocaleLowerCase();
  const matches = (text: string) => text.toLocaleLowerCase().includes(query);
  const passing = entries.filter((entry) => (kindFilter === "all" || entry.kind === kindFilter) && (!activeOnly || entry.status === "active"));
  const visible = passing
    .map((entry) => {
      if (!query) return { entry, types: entry.types, modelMatch: false };
      const modelMatch = matches(entry.name);
      const types = entry.types
        .map((type) => (matches(type.name) ? type : { ...type, instances: type.instances.filter((item) => matches(labelOf(item))) }))
        .filter((type) => matches(type.name) || type.instances.length > 0);
      return { entry, types: modelMatch && types.length === 0 ? entry.types : types, modelMatch };
    })
    .filter(({ types, modelMatch }) => !query || modelMatch || types.length > 0);

  type Shown = (typeof visible)[number];
  const shownById = new Map(visible.map((item) => [item.entry.id, item]));
  // A model shown because its package's name matched the search lists all its types.
  const shownOf = (entry: ModelEntry): Shown => shownById.get(entry.id) ?? { entry, types: entry.types, modelMatch: true };
  const modelKeyOf = (entry: ModelEntry) => `${entry.kind}:${entry.id}`;
  const filtersOn = kindFilter !== "all" || activeOnly;
  const groups = grouped
    ? groupByPackage(orderedPackages(packageState), (entry: ModelEntry) => packageIdOf(packageState, modelKeyOf(entry)), {
        all: entries,
        passing,
        shown: visible.map(({ entry }) => entry),
        query,
        filtered: filtersOn,
      })
    : [];
  const packageOpen = (id: string) => Boolean(query) || !foldedPackages.has(id);

  const toggleExpanded = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Add or remove a group of instances on the active side. */
  const toggleGroup = (items: CrossModelSelectableItem[]) => {
    const ids = new Set(items.map((item) => item.id));
    const all = items.length > 0 && items.every((item) => chosen.has(item.id));
    if (props.mode === "diagram") {
      if (all) props.onRemove(items);
      else props.onAdd(items.filter((item) => !chosen.has(item.id)));
      return;
    }
    const rest = selected.filter((item) => !ids.has(item.id));
    setSelected(all ? rest : [...rest, ...items]);
  };
  const toggleOne = (item: CrossModelSelectableItem) => {
    if (props.mode === "diagram") {
      if (chosen.has(item.id)) props.onRemove([item]);
      else props.onAdd([item]);
      return;
    }
    setSelected(chosen.has(item.id) ? selected.filter((other) => other.id !== item.id) : [...selected, item]);
  };
  const dragProps = (items: CrossModelSelectableItem[]) =>
    props.mode === "diagram" && items.length > 0
      ? { draggable: true, onDragStart: (event: DragEvent<HTMLElement>) => props.onDragStart(items, event) }
      : {};

  const groupCheckbox = (items: CrossModelSelectableItem[], label: string, what: string) => {
    const count = items.filter((item) => chosen.has(item.id)).length;
    const all = items.length > 0 && count === items.length;
    const sideName = isDiagram ? "the diagram" : side === "source" ? "Source" : "Target";
    return (
      <Tooltip title={items.length === 0 ? `${what} has no instances` : all ? `Remove ${label} from ${sideName}` : `Add ${label} (${items.length} instance${items.length === 1 ? "" : "s"}) to ${sideName}`}>
        <span>
          <Checkbox
            size="small"
            disabled={items.length === 0}
            checked={all}
            indeterminate={count > 0 && count < items.length}
            onChange={() => toggleGroup(items)}
            inputProps={{ "aria-label": `Whole ${what.toLowerCase()} ${label}` }}
            sx={{ p: 0.5 }}
          />
        </span>
      </Tooltip>
    );
  };

  // Chips grouped by type, so a whole type taken at once reads as one group.
  const selectedGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; kind: WorkspaceKind; items: CrossModelSelectableItem[] }>();
    for (const item of selected) {
      const key = `${item.modelId}:${item.typeId}`;
      const group = groups.get(key) ?? { key, label: `${item.modelName} › ${item.typeName}`, kind: kindOf(item.modelKind), items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [selected]);

  const renderModel = ({ entry, types }: Shown, nested: boolean) => {
    const open = expanded.has(entry.id) || Boolean(query);
    const count = entry.instances.filter((item) => chosen.has(item.id)).length;
    const base = extendsOf(packageState, modelKeyOf(entry));
    const baseName = base ? entries.find((other) => modelKeyOf(other) === base)?.name ?? null : null;
    return (
      <Box key={entry.id} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" alignItems="center" sx={{ pr: 1 }}>
          <ListItemButton dense onClick={() => toggleExpanded(entry.id)} sx={{ flex: 1, minWidth: 0, gap: 1, py: 0.75, pl: nested ? 2.5 : 1 }}>
            {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            <ModelKindIcon kind={entry.kind} size={22} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <OverflowText variant="body2" fontWeight={700} tooltip={entry.name}>
                <Highlighted text={entry.name} query={query} />
              </OverflowText>
              {baseName && <ModelExtendsCaption baseName={baseName} />}
            </Box>
            {isCommon(packageState, modelKeyOf(entry)) && <CommonModelChip />}
            {entry.status && entry.status !== "active" && <Chip size="small" label={lifecycleLabel(entry.status)} variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
            {entry.loading && <CircularProgress size={12} />}
            {count > 0 && (
              <Typography variant="caption" color="primary" fontWeight={700} sx={{ flexShrink: 0 }}>
                {count}/{entry.instances.length}
              </Typography>
            )}
          </ListItemButton>
          {groupCheckbox(entry.instances, entry.name, "Model")}
        </Stack>
        {open && (
          <Box sx={{ pb: 0.5 }}>
            {types.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 5, py: 0.5 }}>No types defined.</Typography>
            )}
            {types.map((type) => {
              const typeKey = `${entry.id}:${type.id}`;
              const typeOpen = expanded.has(typeKey) || (Boolean(query) && type.instances.length > 0 && !matches(type.name));
              const typeCount = type.instances.filter((item) => chosen.has(item.id)).length;
              const indent = 3 + (nested ? 1.5 : 0) + (query ? 0 : type.depth) * 2;
              return (
                <Box key={type.id}>
                  <Stack direction="row" alignItems="center" sx={{ pr: 1 }}>
                    <ListItemButton dense onClick={() => toggleExpanded(typeKey)} {...dragProps(type.instances)} sx={{ flex: 1, minWidth: 0, gap: 1, py: 0.25, pl: indent }}>
                      {type.instances.length > 0 ? (
                        typeOpen ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <Box sx={{ width: 16 }} />
                      )}
                      <CanonicalBadge badge={type.badge ?? undefined} fallbackText={type.name} fallbackColor={MODEL_KIND_COLOR[entry.kind]} size={20} />
                      <OverflowText variant="body2" tooltip={type.name} sx={{ flex: 1, minWidth: 0 }}>
                        <Highlighted text={type.name} query={query} />
                      </OverflowText>
                      <Typography variant="caption" color={typeCount > 0 ? "primary" : "text.secondary"} fontWeight={typeCount > 0 ? 700 : 400} sx={{ flexShrink: 0 }}>
                        {typeCount > 0 ? `${typeCount}/${type.instances.length}` : type.instances.length}
                      </Typography>
                    </ListItemButton>
                    {groupCheckbox(type.instances, type.name, "Type")}
                  </Stack>
                  {typeOpen &&
                    type.instances.map((item) => {
                      const isChosen = chosen.has(item.id);
                      return (
                        <ListItemButton
                          key={item.id}
                          dense
                          selected={isChosen}
                          onClick={() => toggleOne(item)}
                          {...dragProps([item])}
                          aria-label={`${isChosen ? "Remove" : "Add"} ${labelOf(item)}`}
                          sx={{ pl: indent + 4.5, pr: 1, py: 0.1, gap: 1 }}
                        >
                          <Checkbox size="small" checked={isChosen} tabIndex={-1} disableRipple sx={{ p: 0.25 }} />
                          <OverflowText variant="body2" tooltip={labelOf(item)} sx={{ flex: 1, minWidth: 0, fontSize: 13, color: item.lifecycle === "retired" ? "text.secondary" : undefined }}>
                            <Highlighted text={item.name} query={query} />
                            {contexts.has(item.id) && (
                              <Box component="span" sx={{ color: "text.secondary", fontSize: 12 }}>
                                {" · "}
                                <Highlighted text={contexts.get(item.id)!} query={query} />
                              </Box>
                            )}
                          </OverflowText>
                          {/* Lifecycle: shown, never hidden — Draft and Archived stay visible for review. */}
                          <LifecycleChip status={item.lifecycle} />
                          {item.authorable === false && item.lifecycle !== "retired" && (
                            <Tooltip title={`${item.lifecycleReason ?? "Not available for authoring"} — it can be viewed, but not used in a new relationship.`}>
                              <WarningAmberRounded sx={{ fontSize: 15, color: "warning.main", flexShrink: 0 }} />
                            </Tooltip>
                          )}
                        </ListItemButton>
                      );
                    })}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Paper variant="outlined" sx={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", height: "100%" }}>
      <Stack spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
        {props.mode !== "diagram" && (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <ToggleButtonGroup
            value={side}
            exclusive
            fullWidth
            size="small"
            onChange={(_event, value: MatrixSide | null) => value && setSide(value)}
            sx={{ flex: 1, "& .MuiToggleButton-root": { fontSize: 11, py: 0.75, lineHeight: 1.3 } }}
          >
            <ToggleButton value="source">Source ({props.source.length})</ToggleButton>
            <ToggleButton value="target">Target ({props.target.length})</ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title="Swap Source / Target">
            <span>
              <IconButton size="small" aria-label="Swap Source / Target" onClick={props.onSwap} disabled={props.source.length === 0 && props.target.length === 0}>
                <SwapHorizOutlined fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        )}

        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <ToggleButtonGroup size="small" exclusive value={kindFilter} onChange={(_event, value: KindFilter | null) => value && setKindFilter(value)} aria-label="Filter models by kind">
            <ToggleButton value="hierarchy" aria-label="Hierarchy models" sx={{ px: 1 }}>
              <Tooltip title="Hierarchy models">
                <AccountTreeOutlined sx={{ fontSize: 18, color: MODEL_KIND_COLOR.hierarchy }} />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="support" aria-label="Support domain models" sx={{ px: 1 }}>
              <Tooltip title="Support domain models">
                <HubOutlined sx={{ fontSize: 18, color: MODEL_KIND_COLOR.support }} />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="all" sx={{ px: 1.25, fontSize: 12, fontWeight: 700 }}>All</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" alignItems="center" spacing={1}>
            <GroupByPackageToggle value={grouped} onChange={setGrouped} />
            <FormControlLabel
              control={<Checkbox size="small" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} />}
              label={<Typography variant="caption">Active</Typography>}
              sx={{ mr: 0 }}
            />
          </Stack>
        </Stack>

        <TextField
          size="small"
          fullWidth
          value={search}
          placeholder={grouped ? "Search packages, models, types, instances" : "Search models, types, instances"}
          onChange={(event) => setSearch(event.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" aria-label="Clear search" onClick={() => setSearch("")}><CloseIcon fontSize="small" /></IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />

        {props.mode === "diagram" && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
            {props.onCanvas.size > 0 ? `${props.onCanvas.size} on the diagram. ` : ""}
            Tick an instance, a type or a model to put it on the diagram, or drag it there. Untick to take it off — the instance itself is not changed.
          </Typography>
        )}

        {selected.length > 0 && (
          <Box sx={{ maxHeight: 148, overflowY: "auto" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>
                {side === "source" ? "Source rows" : "Target columns"}
              </Typography>
              <Button size="small" onClick={() => setSelected([])} sx={{ minWidth: 0, py: 0, fontSize: 11 }}>Clear</Button>
            </Stack>
            <Stack spacing={0.5}>
              {selectedGroups.map((group) => (
                <Stack key={group.key} direction="row" gap={0.5} flexWrap="wrap" alignItems="center">
                  <Tooltip title={group.label}>
                    <Box sx={{ display: "inline-flex" }}><ModelKindIcon kind={group.kind} size={18} /></Box>
                  </Tooltip>
                  {group.items.map((item) => (
                    <Chip
                      key={item.id}
                      size="small"
                      variant="outlined"
                      label={labelOf(item)}
                      title={`${labelOf(item)} · ${group.label}`}
                      onDelete={() => setSelected(selected.filter((other) => other.id !== item.id))}
                      sx={{ height: 22, fontSize: 11, maxWidth: 180 }}
                    />
                  ))}
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>

      <Box sx={{ flex: 1, minHeight: 180, overflowY: "auto" }}>
        {(grouped ? groups.length === 0 : visible.length === 0) && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {query ? "No packages, models, types or instances match." : "No models match these filters."}
          </Typography>
        )}
        {grouped
          ? groups.map((group) => {
              const open = packageOpen(group.pkg.id);
              return (
                <Box key={group.pkg.id} sx={{ borderBottom: 1, borderColor: "divider" }}>
                  <PackageGroupHeader
                    pkg={group.pkg}
                    open={open}
                    onToggle={() => togglePackage(group.pkg.id)}
                    shown={group.entries.length}
                    total={group.total}
                    filtered={filtersOn || Boolean(query)}
                  />
                  {open &&
                    (group.entries.length === 0 ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 4.5, py: 0.75 }}>
                        {group.total === 0 ? "No models in this package yet." : "No models match these filters."}
                      </Typography>
                    ) : (
                      group.entries.map((entry) => renderModel(shownOf(entry), true))
                    ))}
                </Box>
              );
            })
          : visible.map((item) => renderModel(item, false))}
      </Box>
    </Paper>
  );
}
