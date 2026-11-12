import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import ChevronRightOutlined from "@mui/icons-material/ChevronRightOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import FolderSpecialOutlined from "@mui/icons-material/FolderSpecialOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import SearchIcon from "@mui/icons-material/Search";
import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemButton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useState, type Dispatch, type DragEvent, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import type { CrossModelSelectableItem, CrossModelSelectionModel } from "@/features/cross-model";
import { MODEL_ROW_TYPE_ID } from "@/features/impact/state/useImpactSelectionModels";
import {
  elementTypeGroups,
  nextSelection,
  shownPackages,
  splitModelRow,
  type PickerKindFilter,
  type PickerModel,
  type ShownModel,
} from "@/features/impact/domain/impactModelSelection";
import { useHierarchyModels, useSupportDomainModels } from "@/features/structure/state/useStructureWorkspace";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import { LifecycleChip } from "@/features/structure/ui/workspace/lifecycle";
import { MODEL_KIND_COLOR, ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import { OverflowText } from "@/shared/workspace/OverflowText";
import { modelKey, orderedPackages, packageIdOf, SHARED_PACKAGE_ID, usePackageState } from "@/shared/workspace/modelPackages";
import { MODEL_KIND_LABEL } from "@/shared/workspace/workspaceModel";

type ItemStatus = CrossModelSelectableItem["status"];

function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLocaleLowerCase();
  const at = q ? text.toLocaleLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box component="mark" sx={{ bgcolor: "warning.light", color: "inherit", px: 0 }}>{text.slice(at, at + q.length)}</Box>
      {text.slice(at + q.length)}
    </>
  );
}

/**
 * Impact · Model Selection — the Structure Workspace Model Selection panel
 * (Package → Model, the Hierarchy / Support Domain / All toggle, Active, one
 * search) with each model opening onto the items a reader can put on the
 * diagram: a hierarchy model as its node tree (the model itself is a row too),
 * a support domain model as element types holding their instances.
 *
 * The diagram actions are the ones Impact had: a click picks a row, Ctrl/⌘
 * click picks several, a double-click adds one, dragging carries the picked
 * rows, and anything already on the diagram is shown as such and cannot be
 * picked again. Nothing here changes a model, a package or an instance.
 */
export function ImpactModelSelectionPanel(props: {
  models: CrossModelSelectionModel[];
  selection: CrossModelSelectableItem[];
  onSelectionChange: (items: CrossModelSelectableItem[]) => void;
  onItemDoubleClick: (item: CrossModelSelectableItem) => void;
  onItemDragStart: (item: CrossModelSelectableItem, event: DragEvent<HTMLElement>) => void;
  getItemStatus?: (item: CrossModelSelectableItem) => ItemStatus;
}) {
  const packageState = usePackageState();
  const hierarchyModels = useHierarchyModels();
  const supportModels = useSupportDomainModels();
  const [kindFilter, setKindFilter] = useState<PickerKindFilter>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsedPackages, setCollapsedPackages] = useState<Set<string>>(new Set());
  const [openModels, setOpenModels] = useState<Set<string>>(new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const statusOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of hierarchyModels.data ?? []) map.set(`hierarchy:${model.id}`, model.status);
    for (const model of supportModels.data ?? []) map.set(`support:${model.id}`, model.status);
    return map;
  }, [hierarchyModels.data, supportModels.data]);

  const pickerModels = useMemo<PickerModel[]>(
    () =>
      props.models.map((model) => {
        const kind = model.modelKind === "HIERARCHY_MODEL" ? "hierarchy" : "support";
        const key = modelKey({ kind, id: model.id });
        const { modelItem, items } = kind === "hierarchy" ? splitModelRow(model.items, MODEL_ROW_TYPE_ID) : { modelItem: undefined, items: model.items };
        return {
          key,
          id: model.id,
          name: model.name,
          kind,
          status: statusOf.get(key) ?? "",
          packageId: packageIdOf(packageState, key),
          modelItem,
          items,
          elementTypes: model.supportDomainElementTypes,
          loading: model.loading,
        };
      }),
    [props.models, statusOf, packageState],
  );

  const query = search.trim();
  const groups = useMemo(
    () => shownPackages(orderedPackages(packageState), pickerModels, { kind: kindFilter, activeOnly, query }),
    [packageState, pickerModels, kindFilter, activeOnly, query],
  );
  const selectedIds = useMemo(() => new Set(props.selection.map((item) => item.id)), [props.selection]);

  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) =>
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** A double-click adds the row straight away, so it is not also left picked. */
  const add = (item: CrossModelSelectableItem) => {
    props.onSelectionChange(props.selection.filter((selected) => selected.id !== item.id));
    props.onItemDoubleClick(item);
  };

  const pick = (item: CrossModelSelectableItem, event: MouseEvent<HTMLElement>) => {
    if (event.detail > 1) return; // the double-click adds; it does not also pick
    if (props.getItemStatus?.(item)?.disabled) return;
    props.onSelectionChange(nextSelection(props.selection, item, event.ctrlKey || event.metaKey));
  };

  const itemRow = (item: CrossModelSelectableItem, indent: number, chevron: ReactNode, opts?: { showType?: boolean }) => {
    const status = props.getItemStatus?.(item);
    const picked = selectedIds.has(item.id);
    const showType = (opts?.showType ?? true) && item.typeName.trim() && item.typeName.trim().toLocaleLowerCase() !== item.name.trim().toLocaleLowerCase();
    const row = (
      <ListItemButton
        dense
        selected={picked}
        disabled={status?.disabled}
        draggable={!status?.disabled}
        onDragStart={(event) => props.onItemDragStart(item, event)}
        onClick={(event) => pick(item, event)}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (!status?.disabled) add(item);
        }}
        aria-selected={picked}
        sx={{ flex: 1, minWidth: 0, gap: 1, py: 0.35, pl: 0.5, pr: 1 }}
      >
        <CanonicalBadge badge={item.badge} fallbackText={item.name} fallbackColor="#1976D2" size={22} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <OverflowText variant="body2"><Highlighted text={item.name} query={query} /></OverflowText>
          {showType && <Typography variant="caption" color="text.secondary" noWrap display="block">{item.typeName}</Typography>}
        </Box>
        {status?.label && <Chip size="small" label={status.label} sx={{ height: 18, fontSize: 10 }} />}
        {item.lifecycle && <LifecycleChip status={item.lifecycle} />}
      </ListItemButton>
    );
    return (
      <Stack key={item.id} direction="row" alignItems="center" sx={{ pl: indent }}>
        <Box sx={{ width: 24, flexShrink: 0, display: "flex", justifyContent: "center" }}>{chevron}</Box>
        {status?.reason ? <Tooltip title={status.reason} placement="right">{row}</Tooltip> : row}
      </Stack>
    );
  };

  const chevronFor = (id: string, open: boolean) => (
    <IconButton size="small" sx={{ p: 0.25 }} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={() => toggle(setOpenRows, id)}>
      {open ? <ExpandMoreOutlined sx={{ fontSize: 18 }} /> : <ChevronRightOutlined sx={{ fontSize: 18 }} />}
    </IconButton>
  );

  const renderHierarchy = ({ model, visibleIds }: ShownModel, indent: number) => {
    const children = new Map<string, CrossModelSelectableItem[]>();
    const ids = new Set(model.items.map((item) => item.id));
    const roots: CrossModelSelectableItem[] = [];
    for (const item of model.items) {
      const parent = item.parentId && ids.has(item.parentId) ? item.parentId : null;
      if (parent) children.set(parent, [...(children.get(parent) ?? []), item]);
      else roots.push(item);
    }
    const visible = (item: CrossModelSelectableItem) => !visibleIds || visibleIds.has(item.id);
    const node = (item: CrossModelSelectableItem, depth: number, seen: Set<string>): ReactNode => {
      if (!visible(item) || seen.has(item.id)) return null;
      const kids = (children.get(item.id) ?? []).filter(visible);
      // While searching, a branch holding a match opens by itself.
      const open = visibleIds ? kids.some((kid) => visibleIds.has(kid.id)) || openRows.has(item.id) : openRows.has(item.id);
      const nextSeen = new Set(seen).add(item.id);
      return (
        <Box key={item.id}>
          {itemRow(item, indent + depth * 1.5, kids.length > 0 ? chevronFor(item.id, open) : null)}
          {open && kids.map((kid) => node(kid, depth + 1, nextSeen))}
        </Box>
      );
    };
    return roots.map((root) => node(root, 0, new Set()));
  };

  const renderSupport = ({ model, visibleIds }: ShownModel, indent: number) =>
    elementTypeGroups(model)
      .map((group) => ({ ...group, items: visibleIds ? group.items.filter((item) => visibleIds.has(item.id)) : group.items }))
      .filter((group) => !visibleIds || group.items.length > 0)
      .map((group) => {
        const id = `${model.key}:type:${group.typeId}`;
        const open = Boolean(visibleIds) || openRows.has(id);
        return (
          <Box key={id}>
            <Stack direction="row" alignItems="center" sx={{ pl: indent }}>
              <Box sx={{ width: 24, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                {group.items.length > 0 && chevronFor(id, open)}
              </Box>
              <ListItemButton dense onClick={() => group.items.length > 0 && toggle(setOpenRows, id)} sx={{ flex: 1, minWidth: 0, gap: 1, py: 0.35, pl: 0.5 }}>
                <OverflowText variant="body2" fontWeight={700} sx={{ flex: 1, minWidth: 0 }}>{group.typeName}</OverflowText>
                <Chip size="small" label={group.items.length} sx={{ height: 18, fontSize: 10.5, fontWeight: 700 }} />
              </ListItemButton>
            </Stack>
            {open && group.items.map((item) => itemRow(item, indent + 1.5, null, { showType: false }))}
          </Box>
        );
      });

  /** Opening a model also opens its top level, so a hierarchy shows more than one row. */
  const toggleModel = (model: PickerModel) => {
    const opening = !openModels.has(model.key);
    toggle(setOpenModels, model.key);
    if (opening && model.kind === "hierarchy") {
      const ids = new Set(model.items.map((item) => item.id));
      const roots = model.items.filter((item) => !item.parentId || !ids.has(item.parentId));
      setOpenRows((previous) => new Set([...previous, ...roots.map((root) => root.id)]));
    }
  };

  const renderModel = (shown: ShownModel) => {
    const { model, visibleIds } = shown;
    const open = Boolean(visibleIds) || openModels.has(model.key);
    const modelStatus = model.modelItem ? props.getItemStatus?.(model.modelItem) : undefined;
    const modelPicked = model.modelItem ? selectedIds.has(model.modelItem.id) : false;
    const canPickModel = Boolean(model.modelItem) && !modelStatus?.disabled;
    const label = (
      <ListItemButton
        dense
        selected={modelPicked}
        draggable={canPickModel}
        onDragStart={(event) => model.modelItem && props.onItemDragStart(model.modelItem, event)}
        onClick={(event) => (model.modelItem ? pick(model.modelItem, event) : toggleModel(model))}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (model.modelItem && canPickModel) add(model.modelItem);
        }}
        aria-label={`Model ${model.name}`}
        sx={{ flex: 1, minWidth: 0, gap: 1.25, py: 0.6, pl: 0.5, pr: 1 }}
      >
        <Tooltip title={MODEL_KIND_LABEL[model.kind]}>
          <Box sx={{ display: "inline-flex" }}><ModelKindIcon kind={model.kind} size={24} /></Box>
        </Tooltip>
        <OverflowText variant="body2" fontWeight={modelPicked ? 700 : 500} sx={{ flex: 1, minWidth: 0 }}>
          <Highlighted text={model.name} query={query} />
        </OverflowText>
        {modelStatus?.label && <Chip size="small" label={modelStatus.label} sx={{ height: 18, fontSize: 10 }} />}
        {model.status !== "active" && <LifecycleChip status={model.status} />}
      </ListItemButton>
    );
    return (
      <Box key={model.key}>
        <Stack direction="row" alignItems="center" sx={{ pl: 1 }}>
          <Box sx={{ width: 24, flexShrink: 0, display: "flex", justifyContent: "center" }}>
            <IconButton
              size="small"
              sx={{ p: 0.25 }}
              aria-label={`${open ? "Collapse" : "Expand"} ${model.name}`}
              aria-expanded={open}
              onClick={() => toggleModel(model)}
            >
              {open ? <ExpandMoreOutlined sx={{ fontSize: 18 }} /> : <ChevronRightOutlined sx={{ fontSize: 18 }} />}
            </IconButton>
          </Box>
          {modelStatus?.reason ? <Tooltip title={modelStatus.reason} placement="right">{label}</Tooltip> : label}
        </Stack>
        {open && (
          <Box sx={{ pb: 0.5 }}>
            {model.loading ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 6, py: 0.75 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">Loading items…</Typography>
              </Stack>
            ) : model.items.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 6, py: 0.75 }}>
                {model.kind === "hierarchy" ? "No nodes in this model yet." : "No element instances in this model yet."}
              </Typography>
            ) : model.kind === "hierarchy" ? (
              renderHierarchy(shown, 3)
            ) : (
              renderSupport(shown, 3)
            )}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, pb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kindFilter}
          onChange={(_event, value: PickerKindFilter | null) => value && setKindFilter(value)}
          aria-label="Filter models by kind"
        >
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
        <FormControlLabel
          control={<Checkbox size="small" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} />}
          label={<Typography variant="caption">Active</Typography>}
          sx={{ mr: 0 }}
        />
      </Stack>

      <Box sx={{ px: 0.5, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search models and items"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" aria-label="Clear search" onClick={() => setSearch("")}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", borderTop: 1, borderColor: "divider" }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {hierarchyModels.isLoading || supportModels.isLoading
              ? "Loading models…"
              : query
                ? "No packages, models or items match."
                : "No models match these filters."}
          </Typography>
        ) : (
          groups.map(({ pkg, total, models }) => {
            const filtering = kindFilter !== "all" || activeOnly || Boolean(query);
            const open = Boolean(query) || !collapsedPackages.has(pkg.id);
            return (
              <Box key={pkg.id} sx={{ borderBottom: 1, borderColor: "divider" }}>
                <ListItemButton
                  dense
                  onClick={() => toggle(setCollapsedPackages, pkg.id)}
                  aria-expanded={open}
                  aria-label={`Package ${pkg.name}`}
                  sx={{ gap: 0.75, py: 0.6, pl: 1, bgcolor: "grey.50" }}
                >
                  {open ? <ExpandMoreOutlined sx={{ fontSize: 18 }} /> : <ChevronRightOutlined sx={{ fontSize: 18 }} />}
                  {pkg.id === SHARED_PACKAGE_ID ? (
                    <FolderSpecialOutlined sx={{ fontSize: 18, color: "#F9A825" }} />
                  ) : (
                    <FolderOutlined sx={{ fontSize: 18, color: "text.secondary" }} />
                  )}
                  <OverflowText variant="body2" fontWeight={700} sx={{ flex: 1, minWidth: 0 }}>
                    <Highlighted text={pkg.name} query={query} />
                  </OverflowText>
                  <Tooltip title={filtering ? `${models.length} shown of ${total} models` : `${total} model${total === 1 ? "" : "s"}`}>
                    <Chip size="small" label={filtering ? `${models.length}/${total}` : total} sx={{ height: 18, fontSize: 10.5, fontWeight: 700 }} />
                  </Tooltip>
                </ListItemButton>
                {open && (
                  <Box>
                    {models.length === 0 ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 4.5, py: 0.75 }}>
                        No models in this package yet.
                      </Typography>
                    ) : (
                      models.map(renderModel)
                    )}
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Stack>
  );
}
