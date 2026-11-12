import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import AddOutlined from '@mui/icons-material/AddOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HubOutlined from '@mui/icons-material/HubOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import {
  Box,
  Button,
  Checkbox,
  Chip,
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
} from '@mui/material';
import { useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { CanonicalBadge } from '@/features/structure/ui/shared/CanonicalBadge';
import { OverflowText } from '@/shared/workspace/OverflowText';
import { MODEL_KIND_COLOR, ModelKindIcon } from '@/shared/workspace/WorkspaceIcons';
import type { ModelKind, WorkspaceModel } from '@/shared/workspace/workspaceModel';
import { extendsOf, isCommon, orderedPackages, packageIdOf, usePackageState } from '@/shared/workspace/modelPackages';
import { groupByPackage } from '@/shared/workspace/packageGrouping';
import {
  CommonModelChip,
  GroupByPackageToggle,
  ModelExtendsCaption,
  PackageGroupHeader,
  useFoldedPackages,
  useGroupByPackage,
} from '@/shared/workspace/PackageGroupParts';
import type { CrossModelTypeOption } from '../../domain/types';

export type MatrixSide = 'source' | 'target';
type KindFilter = ModelKind | 'all';

/** The workspace's model kind for a type option's model type. */
export function kindOfType(type: Pick<CrossModelTypeOption, 'kind'>): ModelKind {
  return type.kind === 'HIERARCHY_MODEL' ? 'hierarchy' : 'support';
}

/** Matrix: picks the Source rows and Target columns. */
type MatrixMode = {
  mode: 'matrix';
  source: CrossModelTypeOption[];
  target: CrossModelTypeOption[];
  onSourceChange: (types: CrossModelTypeOption[]) => void;
  onTargetChange: (types: CrossModelTypeOption[]) => void;
  onSwap: () => void;
};

/** Diagram: puts types on the canvas (and a whole model's types off it again). */
type DiagramMode = {
  mode: 'diagram';
  /** Ids of the types already on the canvas. */
  onCanvas: Set<string>;
  onAdd: (types: CrossModelTypeOption[]) => void;
  onRemove: (types: CrossModelTypeOption[]) => void;
  /** A row is dragged towards the canvas, carrying these types. */
  onDragStart: (types: CrossModelTypeOption[], event: DragEvent<HTMLElement>) => void;
};

type ModelEntry = {
  id: string;
  name: string;
  kind: ModelKind;
  status: string;
  /** In tree order for a hierarchy model, with each type's depth. */
  types: Array<{ type: CrossModelTypeOption; depth: number }>;
};

function treeOrder(types: CrossModelTypeOption[]) {
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
      <Box component="mark" sx={{ bgcolor: 'warning.light', color: 'inherit', px: 0 }}>{text.slice(at, at + query.length)}</Box>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * The model / type picker of the MWS Relationship views, laid out like Model
 * Selection — the same kind toggles, Active filter, model icons and status
 * chips — with one search over every model name, node type and element type.
 * A whole model can be taken at once with its checkbox.
 *
 * Matrix: types go to the Source rows or the Target columns, shown as chips.
 * Diagram: types go on the canvas — click to select (Ctrl/⌘ or Shift for
 * several), then double-click, drag or Add to diagram.
 */
export function TypeSelectionPanel(props: { models: WorkspaceModel[]; types: CrossModelTypeOption[] } & (MatrixMode | DiagramMode)) {
  const isMatrix = props.mode === 'matrix';
  const [side, setSide] = useState<MatrixSide>('source');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Models under their Packages, as in Model Selection (on unless turned off).
  const packageState = usePackageState();
  const [grouped, setGrouped] = useGroupByPackage('mws-relationship');
  const [foldedPackages, togglePackage] = useFoldedPackages();
  // Diagram: the rows picked for adding, and where a Shift-click range starts.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  const typeOrder = useMemo(() => new Map(props.types.map((type, index) => [type.id, index])), [props.types]);
  const typeById = useMemo(() => new Map(props.types.map((type) => [type.id, type])), [props.types]);

  // Matrix: the active side's types. Diagram: the types on the canvas.
  const matrixSelected = props.mode === 'matrix' ? (side === 'source' ? props.source : props.target) : [];
  const chosenIds: Set<string> = props.mode === 'matrix' ? new Set(matrixSelected.map((type) => type.id)) : props.onCanvas;

  const entries = useMemo<ModelEntry[]>(() => {
    const byModel = new Map<string, CrossModelTypeOption[]>();
    for (const type of props.types) byModel.set(type.modelId, [...(byModel.get(type.modelId) ?? []), type]);
    const known = new Set(props.models.map((model) => model.id));
    const order = (kind: ModelKind, types: CrossModelTypeOption[]) => (kind === 'hierarchy' ? treeOrder(types) : types.map((type) => ({ type, depth: 0 })));
    const list: ModelEntry[] = props.models.map((model) => ({ id: model.id, name: model.name, kind: model.kind, status: model.status, types: order(model.kind, byModel.get(model.id) ?? []) }));
    // A type whose model the list does not have yet still gets a home.
    for (const [modelId, types] of byModel) {
      if (known.has(modelId)) continue;
      const kind = kindOfType(types[0]);
      list.push({ id: modelId, name: types[0].modelName, kind, status: '', types: order(kind, types) });
    }
    return list;
  }, [props.models, props.types]);

  const query = search.trim().toLocaleLowerCase();
  const passing = useMemo(
    () => entries.filter((entry) => (kindFilter === 'all' || entry.kind === kindFilter) && (!activeOnly || entry.status === 'active')),
    [entries, kindFilter, activeOnly],
  );
  const visible = useMemo(
    () =>
      passing
        .map((entry) => {
          if (!query) return { entry, shown: entry.types, modelMatch: false };
          const modelMatch = entry.name.toLocaleLowerCase().includes(query);
          const shown = entry.types.filter(({ type }) => type.name.toLocaleLowerCase().includes(query));
          return { entry, shown, modelMatch };
        })
        .filter(({ shown, modelMatch }) => !query || modelMatch || shown.length > 0),
    [passing, query],
  );

  // What each model shows when drawn.
  type Layout = { entry: ModelEntry; open: boolean; rows: ModelEntry['types'] };
  const toLayout = ({ entry, shown, modelMatch }: { entry: ModelEntry; shown: ModelEntry['types']; modelMatch: boolean }): Layout => {
    const open = expanded.has(entry.id) || (Boolean(query) && shown.length > 0);
    // A model found by its name lists all its types when opened.
    const rows = query && modelMatch && expanded.has(entry.id) ? entry.types : shown;
    return { entry, open, rows };
  };
  const layout = visible.map(toLayout);
  const layoutById = new Map(layout.map((item) => [item.entry.id, item]));
  // A model shown because its package's name matched the search opens to all its types.
  const layoutOf = (entry: ModelEntry) => layoutById.get(entry.id) ?? toLayout({ entry, shown: [], modelMatch: true });

  const packageOf = (entry: ModelEntry) => packageIdOf(packageState, `${entry.kind}:${entry.id}`);
  const groups = grouped
    ? groupByPackage(orderedPackages(packageState), packageOf, {
        all: entries,
        passing,
        shown: visible.map(({ entry }) => entry),
        query,
        filtered: kindFilter !== 'all' || activeOnly,
      })
    : [];
  const packageOpen = (id: string) => Boolean(query) || !foldedPackages.has(id);
  // The models in the order they are drawn — also the order a Shift-click range runs in.
  const drawn = grouped ? groups.flatMap((group) => (packageOpen(group.pkg.id) ? group.entries.map(layoutOf) : [])) : layout;
  const flatOrder = drawn.flatMap(({ open, rows }) => (open ? rows.map(({ type }) => type.id) : []));

  const sortByOrder = (types: CrossModelTypeOption[]) => [...types].sort((a, b) => (typeOrder.get(a.id) ?? 0) - (typeOrder.get(b.id) ?? 0));

  // ── Matrix ──
  const setMatrixSide = (types: CrossModelTypeOption[]) => {
    if (props.mode !== 'matrix') return;
    (side === 'source' ? props.onSourceChange : props.onTargetChange)(types);
  };
  const toggleMatrixType = (type: CrossModelTypeOption) =>
    setMatrixSide(chosenIds.has(type.id) ? matrixSelected.filter((item) => item.id !== type.id) : sortByOrder([...matrixSelected, type]));

  // ── Diagram ──
  const addable = (ids: Iterable<string>) => [...ids].map((id) => typeById.get(id)).filter((type): type is CrossModelTypeOption => Boolean(type && !chosenIds.has(type.id)));
  const pickedTypes = sortByOrder(addable(picked));
  const addPicked = (types: CrossModelTypeOption[]) => {
    if (props.mode !== 'diagram' || types.length === 0) return;
    props.onAdd(types);
    setPicked(new Set());
  };
  const pickRow = (type: CrossModelTypeOption, event: MouseEvent) => {
    if (event.shiftKey && anchorRef.current && flatOrder.includes(anchorRef.current)) {
      const a = flatOrder.indexOf(anchorRef.current);
      const b = flatOrder.indexOf(type.id);
      const range = flatOrder.slice(Math.min(a, b), Math.max(a, b) + 1).filter((id) => !chosenIds.has(id));
      setPicked((previous) => new Set([...(event.ctrlKey || event.metaKey ? previous : []), ...range]));
      return;
    }
    anchorRef.current = type.id;
    if (event.ctrlKey || event.metaKey) {
      setPicked((previous) => {
        const next = new Set(previous);
        if (next.has(type.id)) next.delete(type.id);
        else next.add(type.id);
        return next;
      });
      return;
    }
    setPicked((previous) => (previous.size === 1 && previous.has(type.id) ? new Set() : new Set([type.id])));
  };
  /** The row plus the rest of the selection when the row is part of it. */
  const withSelection = (type: CrossModelTypeOption) => (picked.has(type.id) ? pickedTypes : [type]);

  // ── Whole model ──
  const toggleModel = (entry: ModelEntry) => {
    const types = entry.types.map(({ type }) => type);
    const ids = new Set(types.map((type) => type.id));
    const all = types.length > 0 && types.every((type) => chosenIds.has(type.id));
    if (props.mode === 'matrix') {
      if (all) setMatrixSide(matrixSelected.filter((item) => !ids.has(item.id)));
      else setMatrixSide(sortByOrder([...matrixSelected.filter((item) => !ids.has(item.id)), ...types]));
      return;
    }
    if (all) props.onRemove(types);
    else props.onAdd(types.filter((type) => !chosenIds.has(type.id)));
    setPicked((previous) => new Set([...previous].filter((id) => !ids.has(id))));
  };

  const toggleExpanded = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Matrix chips, grouped by model, so a whole model added at once reads as one group.
  const selectedGroups = useMemo(() => {
    const groups = new Map<string, { modelId: string; modelName: string; kind: ModelKind; types: CrossModelTypeOption[] }>();
    for (const type of matrixSelected) {
      const group = groups.get(type.modelId) ?? { modelId: type.modelId, modelName: type.modelName, kind: kindOfType(type), types: [] };
      group.types.push(type);
      groups.set(type.modelId, group);
    }
    return [...groups.values()];
  }, [matrixSelected]);

  const renderType = (type: CrossModelTypeOption, depth: number, inset = 0): ReactNode => {
    const chosen = chosenIds.has(type.id);
    const badge = <CanonicalBadge badge={type.badge ?? undefined} fallbackText={type.name} fallbackColor={MODEL_KIND_COLOR[kindOfType(type)]} size={22} />;
    const name = (
      <OverflowText variant="body2" tooltip={type.name} sx={{ flex: 1, minWidth: 0 }}>
        <Highlighted text={type.name} query={query} />
      </OverflowText>
    );
    if (props.mode === 'matrix') {
      return (
        <ListItemButton
          key={type.id}
          dense
          selected={chosen}
          onClick={() => toggleMatrixType(type)}
          sx={{ pl: 4.5 + inset + depth * 2, pr: 1, py: 0.25, gap: 1 }}
          aria-label={`${chosen ? 'Remove' : 'Add'} ${type.name}`}
        >
          <Checkbox size="small" checked={chosen} tabIndex={-1} disableRipple sx={{ p: 0.25 }} />
          {badge}
          {name}
        </ListItemButton>
      );
    }
    const isPicked = picked.has(type.id) && !chosen;
    const row = (
      <ListItemButton
        key={type.id}
        dense
        disabled={chosen}
        selected={isPicked}
        draggable={!chosen}
        data-type-id={type.id}
        onClick={(event) => pickRow(type, event)}
        onDoubleClick={(event) => {
          event.preventDefault();
          addPicked(withSelection(type));
        }}
        onDragStart={(event) => props.onDragStart(withSelection(type), event)}
        sx={{ pl: 4.5 + inset + depth * 2, pr: 1, py: 0.5, gap: 1, userSelect: 'none', '&.Mui-disabled': { opacity: 0.55 } }}
      >
        {badge}
        {name}
        {chosen && <Chip size="small" label="On diagram" sx={{ height: 18, fontSize: 10 }} />}
      </ListItemButton>
    );
    return chosen ? (
      <Tooltip key={type.id} title="Already on this diagram" placement="right">
        <Box>{row}</Box>
      </Tooltip>
    ) : (
      row
    );
  };

  const sideLabel = side === 'source' ? 'Source' : 'Target';

  const renderModel = ({ entry, open, rows }: Layout, nested: boolean) => {
    const total = entry.types.length;
    const count = entry.types.filter(({ type }) => chosenIds.has(type.id)).length;
    const all = total > 0 && count === total;
    const target = isMatrix ? sideLabel : 'the diagram';
    const key = `${entry.kind}:${entry.id}`;
    const base = extendsOf(packageState, key);
    const baseName = base ? entries.find((other) => `${other.kind}:${other.id}` === base)?.name ?? null : null;
    return (
      <Box key={entry.id} sx={{ borderBottom: 1, borderColor: 'divider' }}>
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
            {isCommon(packageState, key) && <CommonModelChip />}
            {entry.status && entry.status !== 'active' && (
              <Chip size="small" label={lifecycleLabel(entry.status)} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
            )}
            {count > 0 && (
              <Typography variant="caption" color="primary" fontWeight={700} sx={{ flexShrink: 0 }}>
                {count}/{total}
              </Typography>
            )}
          </ListItemButton>
          <Tooltip
            title={
              total === 0
                ? 'This model has no types yet'
                : all
                  ? `Remove the whole model from ${target}`
                  : `Add the whole model (${total} type${total === 1 ? '' : 's'}) to ${target}`
            }
          >
            <span>
              <Checkbox
                size="small"
                disabled={total === 0}
                checked={all}
                indeterminate={count > 0 && count < total}
                onChange={() => toggleModel(entry)}
                inputProps={{ 'aria-label': `Whole model ${entry.name}` }}
                sx={{ p: 0.5 }}
              />
            </span>
          </Tooltip>
        </Stack>
        {open && (
          <Box sx={{ pb: 0.5 }}>
            {rows.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 5, py: 0.5 }}>
                No types defined.
              </Typography>
            ) : (
              rows.map(({ type, depth }) => renderType(type, query ? 0 : depth, nested ? 1.5 : 0))
            )}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <Stack spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        {props.mode === 'matrix' && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <ToggleButtonGroup
              value={side}
              exclusive
              fullWidth
              size="small"
              onChange={(_event, value: MatrixSide | null) => value && setSide(value)}
              sx={{ flex: 1, '& .MuiToggleButton-root': { fontSize: 11, py: 0.75, lineHeight: 1.3 } }}
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
          <ToggleButtonGroup
            size="small"
            exclusive
            value={kindFilter}
            onChange={(_event, value: KindFilter | null) => value && setKindFilter(value)}
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
            <ToggleButton value="all" sx={{ px: 1.25, fontSize: 12, fontWeight: 700 }}>
              All
            </ToggleButton>
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
          placeholder={grouped ? 'Search packages, models, types' : 'Search models, node types, element types'}
          onChange={(event) => setSearch(event.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" aria-label="Clear search" onClick={() => setSearch('')}><CloseIcon fontSize="small" /></IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />

        {props.mode === 'matrix' && matrixSelected.length > 0 && (
          <Box sx={{ maxHeight: 148, overflowY: 'auto' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>
                {side === 'source' ? 'Source rows' : 'Target columns'}
              </Typography>
              <Button size="small" onClick={() => setMatrixSide([])} sx={{ minWidth: 0, py: 0, fontSize: 11 }}>
                Clear
              </Button>
            </Stack>
            <Stack spacing={0.5}>
              {selectedGroups.map((group) => (
                <Stack key={group.modelId} direction="row" gap={0.5} flexWrap="wrap" alignItems="center">
                  <Tooltip title={group.modelName}>
                    <Box sx={{ display: 'inline-flex' }}><ModelKindIcon kind={group.kind} size={18} /></Box>
                  </Tooltip>
                  {group.types.map((type) => (
                    <Chip
                      key={type.id}
                      size="small"
                      variant="outlined"
                      label={type.name}
                      title={`${type.name} · ${type.modelName}`}
                      onDelete={() => setMatrixSide(matrixSelected.filter((item) => item.id !== type.id))}
                      sx={{ height: 22, fontSize: 11, maxWidth: 180 }}
                    />
                  ))}
                </Stack>
              ))}
            </Stack>
          </Box>
        )}

        {props.mode === 'diagram' && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 30 }}>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1, lineHeight: 1.3 }}>
              {pickedTypes.length > 0
                ? `${pickedTypes.length} selected — double-click, drag or add.`
                : 'Click a type (Ctrl/⌘ or Shift for several), then double-click or drag it onto the diagram.'}
            </Typography>
            {pickedTypes.length > 0 && (
              <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={() => addPicked(pickedTypes)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                Add ({pickedTypes.length})
              </Button>
            )}
          </Stack>
        )}
      </Stack>

      <Box sx={{ flex: 1, minHeight: 180, overflowY: 'auto' }}>
        {(grouped ? groups.length === 0 : layout.length === 0) && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {query ? 'No packages, models or types match.' : 'No models match these filters.'}
          </Typography>
        )}
        {grouped
          ? groups.map((group) => {
              const open = packageOpen(group.pkg.id);
              return (
                <Box key={group.pkg.id} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                  <PackageGroupHeader
                    pkg={group.pkg}
                    open={open}
                    onToggle={() => togglePackage(group.pkg.id)}
                    shown={group.entries.length}
                    total={group.total}
                    filtered={kindFilter !== 'all' || activeOnly || Boolean(query)}
                  />
                  {open &&
                    (group.entries.length === 0 ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4.5, py: 0.75 }}>
                        {group.total === 0 ? 'No models in this package yet.' : 'No models match these filters.'}
                      </Typography>
                    ) : (
                      group.entries.map((entry) => renderModel(layoutOf(entry), true))
                    ))}
                </Box>
              );
            })
          : layout.map((item) => renderModel(item, false))}
      </Box>
    </Paper>
  );
}
