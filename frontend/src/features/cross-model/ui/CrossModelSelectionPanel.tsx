import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import type { ModelKind } from "@/shared/constants/ModelConfig";
import {
  CROSS_MODEL_SELECTION_LEVEL,
  filterCrossModelItemsByName,
  getCrossModelSelectionKey,
  getHierarchySearchState,
  groupCrossModelItemsByType,
  type CrossModelModelKindFilter,
  type CrossModelSelectableItem,
  type CrossModelSelectionMode,
  type CrossModelSelectionModel,
  type CrossModelSelectionLevel,
  type CrossModelView,
  type CrossModelWorkspace,
} from "../domain/crossModelSelection";

export type CrossModelSelectionPanelProps = {
  workspace: CrossModelWorkspace;
  view: CrossModelView;
  selectionLevel: CrossModelSelectionLevel;
  models: CrossModelSelectionModel[];
  sourceSelection?: CrossModelSelectableItem[];
  targetSelection?: CrossModelSelectableItem[];
  diagramSelection?: CrossModelSelectableItem[];
  initialMode?: CrossModelSelectionMode;
  onSourceSelectionChange?: (items: CrossModelSelectableItem[]) => void;
  onTargetSelectionChange?: (items: CrossModelSelectableItem[]) => void;
  onDiagramSelectionChange?: (items: CrossModelSelectableItem[]) => void;
  onItemDoubleClick?: (item: CrossModelSelectableItem) => void;
  onItemDragStart?: (item: CrossModelSelectableItem, event: DragEvent<HTMLElement>) => void;
  getItemStatus?: (item: CrossModelSelectableItem, mode: CrossModelSelectionMode) => CrossModelSelectableItem["status"];
  getModelStatus?: (model: CrossModelSelectionModel, mode: CrossModelSelectionMode) => CrossModelSelectableItem["status"];
  renderStatus?: (item: CrossModelSelectableItem, mode: CrossModelSelectionMode) => ReactNode;
  emptyMessage?: string;
};

type ItemTreeNode = { item: CrossModelSelectableItem; children: ItemTreeNode[] };

function buildTree(items: CrossModelSelectableItem[]) {
  const nodes = new Map(items.map((item) => [item.id, { item, children: [] } as ItemTreeNode]));
  const roots: ItemTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentId ? nodes.get(node.item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function HighlightedName({ name, search }: { name: string; search: string }) {
  const query = search.trim();
  const index = query ? name.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  if (index < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, index)}
      <Box component="mark" sx={{ bgcolor: "warning.light", color: "inherit", px: 0 }}>
        {name.slice(index, index + query.length)}
      </Box>
      {name.slice(index + query.length)}
    </>
  );
}

export function CrossModelSelectionPanel({
  workspace,
  view,
  selectionLevel,
  models,
  sourceSelection = [],
  targetSelection = [],
  diagramSelection = [],
  initialMode = "source",
  onSourceSelectionChange,
  onTargetSelectionChange,
  onDiagramSelectionChange,
  onItemDoubleClick,
  onItemDragStart,
  getItemStatus,
  getModelStatus,
  renderStatus,
  emptyMessage = "No matching items.",
}: CrossModelSelectionPanelProps) {
  const isDiagram = view === "diagram";
  const [mode, setMode] = useState<CrossModelSelectionMode>(initialMode);
  const [modelKindFilter, setModelKindFilter] = useState<CrossModelModelKindFilter>("HIERARCHY_MODEL" as ModelKind);
  const [sourceModelId, setSourceModelId] = useState("");
  const [targetModelId, setTargetModelId] = useState("");
  const modelId = isDiagram ? sourceModelId : mode === "source" ? sourceModelId : targetModelId;
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedModelIds, setExpandedModelIds] = useState<Set<string>>(new Set());
  const [expandedTypeIds, setExpandedTypeIds] = useState<Set<string>>(new Set());
  const autoExpandedHierarchyKey = useRef<string | null>(null);

  const filteredModels = useMemo(
    () => models.filter((model) => modelKindFilter === "ALL" || model.modelKind === modelKindFilter),
    [modelKindFilter, models],
  );

  useEffect(() => {
    if (!modelId || filteredModels.some((model) => model.id === modelId)) return;
    if (isDiagram || mode === "source") setSourceModelId("");
    else setTargetModelId("");
  }, [filteredModels, isDiagram, mode, modelId]);

  const selectedItems = isDiagram ? diagramSelection : mode === "source" ? sourceSelection : targetSelection;
  const selectedKeys = useMemo(
    () => new Set(selectedItems.map(getCrossModelSelectionKey)),
    [selectedItems],
  );

  const visibleModels = useMemo(() => {
    const scopeModels = modelKindFilter === "ALL"
      ? filteredModels
      : filteredModels.filter((model) => model.id === modelId);
    const modelsWithMatches = scopeModels.map((model) => ({
      ...model,
      matchingItemCount: filterCrossModelItemsByName(model.items, search).filter(
        (item) => !typeFilter || item.typeId === typeFilter,
      ).length,
    }));
    if (!search.trim()) return modelsWithMatches;
    return modelsWithMatches.filter((model) => (
      model.matchingItemCount > 0 || model.loading || Boolean(model.error)
    ));
  }, [filteredModels, modelKindFilter, modelId, search, typeFilter]);

  const availableTypes = useMemo(() => {
    const values = new Map<string, string>();
    filteredModels
      .filter((model) => modelKindFilter === "ALL" || !modelId || model.id === modelId)
      .flatMap((model) => model.items)
      .forEach((item) => values.set(item.typeId, item.typeName));
    return [...values.entries()];
  }, [filteredModels, modelKindFilter, modelId]);

  useEffect(() => {
    if (!typeFilter || availableTypes.some(([id]) => id === typeFilter)) return;
    setTypeFilter("");
  }, [availableTypes, typeFilter]);

  useEffect(() => {
    if (modelKindFilter !== ("HIERARCHY_MODEL" as ModelKind) || !modelId) {
      autoExpandedHierarchyKey.current = null;
      return;
    }
    const selectedModel = filteredModels.find((model) => model.id === modelId);
    if (!selectedModel) return;
    const expansionKey = `${modelId}:${selectedModel.items.length}`;
    if (autoExpandedHierarchyKey.current === expansionKey) return;

    const parentIds = new Set(
      selectedModel.items.flatMap((item) => item.parentId ? [item.parentId] : []),
    );
    setExpandedIds((previous) => new Set([...previous, ...parentIds]));
    autoExpandedHierarchyKey.current = expansionKey;
  }, [filteredModels, modelKindFilter, modelId]);

  function updateSelection(next: CrossModelSelectableItem[]) {
    if (isDiagram) onDiagramSelectionChange?.(next);
    else if (mode === "source") onSourceSelectionChange?.(next);
    else onTargetSelectionChange?.(next);
  }

  function updateModelId(nextModelId: string) {
    if (isDiagram || mode === "source") setSourceModelId(nextModelId);
    else setTargetModelId(nextModelId);
  }

  function toggleItem(item: CrossModelSelectableItem, event: MouseEvent<HTMLElement>) {
    const status = getItemStatus?.(item, mode) ?? item.status;
    if (status?.disabled) return;
    if (isDiagram && event.detail > 1) return;
    const key = getCrossModelSelectionKey(item);
    const alreadySelected = selectedKeys.has(key);
    if (isDiagram && !event.ctrlKey && !event.metaKey) {
      updateSelection(alreadySelected && selectedItems.length === 1 ? [] : [item]);
      return;
    }
    updateSelection(alreadySelected
      ? selectedItems.filter((selected) => getCrossModelSelectionKey(selected) !== key)
      : [...selectedItems, item]);
  }

  function removeSelected(item: CrossModelSelectableItem) {
    const key = getCrossModelSelectionKey(item);
    updateSelection(selectedItems.filter((selected) => getCrossModelSelectionKey(selected) !== key));
  }

  function toggleExpanded(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleModelExpanded(model: CrossModelSelectionModel) {
    const isExpanded = expandedModelIds.has(model.id);
    setExpandedModelIds((previous) => {
      const next = new Set(previous);
      if (isExpanded) next.delete(model.id);
      else next.add(model.id);
      return next;
    });

    if (model.modelKind === ("HIERARCHY_MODEL" as ModelKind)) {
      const parentIds = new Set(
        model.items.flatMap((item) => item.parentId ? [item.parentId] : []),
      );
      setExpandedIds((previous) => {
        const next = new Set(previous);
        for (const item of model.items) {
          if (!parentIds.has(item.id)) continue;
          if (isExpanded) next.delete(item.id);
          else next.add(item.id);
        }
        return next;
      });
      return;
    }

    setExpandedTypeIds((previous) => {
      const next = new Set(previous);
      for (const group of groupCrossModelItemsByType(model.items)) {
        const groupId = `${model.id}:${group.typeId}`;
        if (isExpanded) next.delete(groupId);
        else next.add(groupId);
      }
      return next;
    });
  }

  function handleModelKindChange(value: CrossModelModelKindFilter | null) {
    if (!value) return;
    setModelKindFilter(value);
    if (value === "ALL") {
      updateModelId("");
      return;
    }
    const firstModelId = models.find((model) => model.modelKind === value)?.id ?? "";
    updateModelId(firstModelId);
  }

  function renderItem(item: CrossModelSelectableItem, depth = 0) {
    const selected = selectedKeys.has(getCrossModelSelectionKey(item));
    const status = getItemStatus?.(item, mode) ?? item.status;
    const showTypeName = item.typeName.trim()
      && item.typeName.trim().toLocaleLowerCase() !== item.name.trim().toLocaleLowerCase();
    const content = (
      <ListItemButton
        selected={selected}
        disabled={status?.disabled}
        draggable={!status?.disabled && Boolean(onItemDragStart)}
        onDragStart={(event) => onItemDragStart?.(item, event)}
        onClick={(event) => toggleItem(item, event)}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!status?.disabled) onItemDoubleClick?.(item);
        }}
        sx={{ pl: 1 + depth * 2, py: 0.5, gap: 1 }}
      >
        <CanonicalBadge badge={item.badge} fallbackText={item.name} fallbackColor="#1976D2" size={24} />
        <Box minWidth={0} flex={1}>
          <Typography variant="body2" noWrap>
            <HighlightedName name={item.name} search={search} />
          </Typography>
          {showTypeName && (
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {item.typeName}
            </Typography>
          )}
        </Box>
        {renderStatus?.(item, mode) ?? (status?.label && <Chip size="small" label={status.label} />)}
        {selected && !isDiagram && <CheckIcon color="primary" sx={{ fontSize: 16 }} />}
      </ListItemButton>
    );
    return status?.reason ? <Tooltip title={status.reason}>{content}</Tooltip> : content;
  }

  function renderHierarchy(model: CrossModelSelectionModel) {
    const searchState = getHierarchySearchState(model.items, search, typeFilter);
    const tree = buildTree(model.items);
    const renderNode = (node: ItemTreeNode, depth: number): ReactNode => {
      if (!searchState.visibleIds.has(node.item.id)) return null;
      const hasChildren = node.children.some((child) => searchState.visibleIds.has(child.item.id));
      const expanded = search.trim() || typeFilter
        ? searchState.expandedIds.has(node.item.id)
        : expandedIds.has(node.item.id);
      return (
        <Box key={node.item.id}>
          <Stack direction="row" alignItems="center">
            <Box width={28 + depth * 16} flexShrink={0} textAlign="right">
              {hasChildren && (
                <IconButton size="small" onClick={() => toggleExpanded(setExpandedIds, node.item.id)}>
                  {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                </IconButton>
              )}
            </Box>
            <Box flex={1} minWidth={0}>{renderItem(node.item)}</Box>
          </Stack>
          {hasChildren && expanded && node.children.map((child) => renderNode(child, depth + 1))}
        </Box>
      );
    };
    return tree.map((node) => renderNode(node, 0));
  }

  function renderSupportDomain(model: CrossModelSelectionModel) {
    if (selectionLevel === CROSS_MODEL_SELECTION_LEVEL.TYPE) {
      return filterCrossModelItemsByName(model.items, search)
        .filter((item) => !typeFilter || item.typeId === typeFilter)
        .map((item) => (
          <Box key={getCrossModelSelectionKey(item)}>
            {renderItem(item)}
          </Box>
        ));
    }

    const itemGroups = new Map(
      groupCrossModelItemsByType(model.items).map((group) => [group.typeId, group]),
    );
    const groups = (model.supportDomainElementTypes ?? [...itemGroups.values()].map((group) => ({
      typeId: group.typeId,
      typeName: group.typeName,
    })))
      .filter((group) => !typeFilter || group.typeId === typeFilter)
      .map((group) => ({
        ...group,
        items: itemGroups.get(group.typeId)?.items ?? [],
      }));

    return groups
      .filter((group) => !typeFilter || group.typeId === typeFilter)
      .map((group) => {
        const matchingItems = filterCrossModelItemsByName(group.items, search);
        const expanded = search.trim() ? true : expandedTypeIds.has(`${model.id}:${group.typeId}`);
        return (
          <Box key={group.typeId}>
            <ListItemButton onClick={() => toggleExpanded(setExpandedTypeIds, `${model.id}:${group.typeId}`)}>
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
              <Typography variant="body2" fontWeight={700} ml={0.5}>{group.typeName}</Typography>
              <Chip size="small" label={matchingItems.length} sx={{ ml: "auto" }} />
            </ListItemButton>
            <Collapse in={expanded}>
              {matchingItems.map((item) => <Box key={getCrossModelSelectionKey(item)}>{renderItem(item, 1)}</Box>)}
            </Collapse>
          </Box>
        );
      });
  }

  return (
    <Paper variant="outlined" sx={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <Stack spacing={1.25} sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="subtitle2">Item selection</Typography>
          <Chip size="small" label={`${workspace} ${selectionLevel}`} />
        </Stack>

        {!isDiagram && (
          <ToggleButtonGroup
            value={mode}
            exclusive
            fullWidth
            size="small"
            onChange={(_, value) => value && setMode(value)}
            sx={{ "& .MuiToggleButton-root": { fontSize: 11, py: 1, lineHeight: 1.3 } }}
          >
            <ToggleButton value="source">Source ({sourceSelection.length})</ToggleButton>
            <ToggleButton value="target">Target ({targetSelection.length})</ToggleButton>
          </ToggleButtonGroup>
        )}

        <ToggleButtonGroup
          value={modelKindFilter}
          exclusive
          fullWidth
          size="small"
          onChange={(_, value) => handleModelKindChange(value)}
          sx={{ "& .MuiToggleButton-root": { fontSize: 11, py: 0.5, lineHeight: 1.3 } }}
        >
          <ToggleButton value={"HIERARCHY_MODEL" as ModelKind}><AccountTreeOutlinedIcon sx={{ fontSize: 14, mr: 0.5 }} />Hierarchy</ToggleButton>
          <ToggleButton value={"SUPPORT_DOMAIN_MODEL" as ModelKind}><LayersOutlinedIcon sx={{ fontSize: 14, mr: 0.5 }} />Support Domain</ToggleButton>
          <ToggleButton value="ALL">All</ToggleButton>
        </ToggleButtonGroup>

        <Stack direction="row" gap={1}>
          {modelKindFilter !== "ALL" && (
            <FormControl size="small" fullWidth>
              <Select value={modelId} displayEmpty onChange={(event) => updateModelId(event.target.value)}>
                <MenuItem value=""><em>Select model</em></MenuItem>
                {filteredModels.map((model) => {
                  const status = getModelStatus?.(model, mode);
                  return (
                    <MenuItem key={model.id} value={model.id} disabled={status?.disabled}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" width="100%" gap={1}>
                        <Typography variant="body2" noWrap>{model.name}</Typography>
                        {status?.label && (
                          <Typography variant="caption" color="text.disabled" noWrap>
                            {status.label}
                          </Typography>
                        )}
                      </Stack>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          )}
          {selectionLevel === CROSS_MODEL_SELECTION_LEVEL.INSTANCE && (
            <FormControl size="small" fullWidth>
              <Select value={typeFilter} displayEmpty onChange={(event) => setTypeFilter(event.target.value)}>
                <MenuItem value=""><em>All types</em></MenuItem>
                {availableTypes.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
              </Select>
            </FormControl>
          )}
        </Stack>

        <TextField
          size="small"
          fullWidth
          value={search}
          disabled={modelKindFilter !== "ALL" && !modelId}
          placeholder={modelKindFilter === "ALL" ? "Search all models" : "Search selected model"}
          onChange={(event) => setSearch(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />

        {selectedItems.length > 0 && (
          <Stack direction="row" gap={0.5} flexWrap="wrap">
            {selectedItems.map((item) => (
              <Chip
                key={getCrossModelSelectionKey(item)}
                size="small"
                label={`${item.name} · ${item.modelName}`}
                onDelete={() => removeSelected(item)}
                deleteIcon={<CloseIcon />}
              />
            ))}
          </Stack>
        )}
      </Stack>

      <Box flex={1} minHeight={180} overflow="auto">
        {visibleModels.map((model) => {
          const expanded = modelKindFilter !== "ALL" || expandedModelIds.has(model.id) || Boolean(search.trim());
          return (
            <Box key={model.id} sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
              {modelKindFilter === "ALL" && (
                <ListItemButton onClick={() => toggleModelExpanded(model)}>
                  {expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                  <Box ml={0.5}>
                    <Typography variant="body2" fontWeight={700}>{model.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {model.modelKind === ("HIERARCHY_MODEL" as ModelKind) ? "Hierarchy" : "Support Domain"}
                    </Typography>
                  </Box>
                </ListItemButton>
              )}
              <Collapse in={expanded}>
                {model.loading && <Stack direction="row" gap={1} p={2}><CircularProgress size={18} /><Typography variant="body2">Loading {model.name}…</Typography></Stack>}
                {model.error && <Alert severity="error">{model.name}: {model.error}</Alert>}
                {!model.loading && !model.error && model.matchingItemCount === 0 && (
                  <Typography variant="body2" color="text.secondary" p={2}>{emptyMessage}</Typography>
                )}
                {!model.loading && !model.error && model.matchingItemCount > 0 && (
                  <List dense disablePadding>
                    {model.modelKind === ("HIERARCHY_MODEL" as ModelKind) ? renderHierarchy(model) : renderSupportDomain(model)}
                  </List>
                )}
              </Collapse>
            </Box>
          );
        })}
        {visibleModels.length === 0 && (
          <Typography variant="body2" color="text.secondary" p={2}>
            {modelKindFilter !== "ALL" && !modelId
              ? "Select a model to view and search its items."
              : search.trim() ? "No matches found." : emptyMessage}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
