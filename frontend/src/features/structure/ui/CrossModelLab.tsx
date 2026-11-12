import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddLinkOutlinedIcon from "@mui/icons-material/AddLinkOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import ListOutlinedIcon from "@mui/icons-material/ListOutlined";
import SchemaOutlinedIcon from "@mui/icons-material/SchemaOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { CrossModelMatrixView } from "./CrossModelMatrixView";
import { CrossModelDiagramView } from "./CrossModelDiagramView";
import {
  useCrossModelLinks,
  useCreateCrossModelLink,
  useDeleteCrossModelLink,
  useElementInstances,
  useHierarchyModels,
  useModelNodeInstances,
  useModelNodeTypes,
  useSupportDomainElementTypes,
  useSupportDomainModels,
  useActiveCrossModelRelationshipTypes,
  type NodeTreeItem,
} from "@/features/structure/state/useStructureWorkspace";
import type { CrossModelInstance, ElementInstance } from "@/features/structure/api/structureApi";
import type { BadgeCustomization, CrossModelRelationshipTypeSummary } from "@/features/model/domain/types";
import type { ModelKind } from "@/shared/constants/ModelConfig";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GenericInstance {
  id: string;
  name: string;
  typeName: string;
  modelId: string;
  modelName: string;
}

// ── Badge chip ─────────────────────────────────────────────────────────────────

function InstanceAvatar({ badge, fallbackText }: { badge?: BadgeCustomization; fallbackText: string }) {
  return (
    <Box sx={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <CanonicalBadge badge={badge} fallbackText={fallbackText} size={22} />
    </Box>
  );
}

// ── Model kind toggle ─────────────────────────────────────────────────────────

function ModelKindToggle({ value, onChange }: { value: ModelKind; onChange: (v: ModelKind) => void }) {
  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      size="small"
      onChange={(_, v) => v && onChange(v)}
      sx={{ height: 32 }}
    >
      <ToggleButton value="HIERARCHY_MODEL" sx={{ fontSize: 11, px: 1.5, gap: 0.5 }}>
        <AccountTreeOutlinedIcon sx={{ fontSize: 14 }} />
        Hierarchy
      </ToggleButton>
      <ToggleButton value="SUPPORT_DOMAIN_MODEL" sx={{ fontSize: 11, px: 1.5, gap: 0.5 }}>
        <LayersOutlinedIcon sx={{ fontSize: 14 }} />
        Support Domain
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

// ── Hierarchy tree node ────────────────────────────────────────────────────────

function HierarchyTreeNode({
  node, depth, expandedIds, selectedId, onToggle, onSelect, searchText, badgeMap,
}: {
  node: NodeTreeItem; depth: number; expandedIds: Set<string>;
  selectedId: string | null; onToggle: (id: string) => void;
  onSelect: (node: NodeTreeItem) => void; searchText: string; badgeMap: Map<string, BadgeCustomization>;
}) {
  const isExpanded = expandedIds.has(node.node_id);
  const isSelected = node.node_id === selectedId;
  const hasChildren = node.children.length > 0;

  const nodeInstanceMatches = (n: NodeTreeItem): boolean =>
    n.name.toLowerCase().includes(searchText.toLowerCase()) || n.children.some(nodeInstanceMatches);

  if (searchText && !nodeInstanceMatches(node)) return null;
  const matchesSearch = !searchText || node.name.toLowerCase().includes(searchText.toLowerCase());
  const visibleChildren = searchText ? node.children.filter(nodeInstanceMatches) : node.children;

  return (
    <>
      <ListItemButton sx={{ pl: 1 + depth * 3, py: 0.4, opacity: matchesSearch ? 1 : 0.5 }}
        selected={isSelected} onClick={() => onSelect(node)}>
        <Box sx={{ width: 22, display: "flex", alignItems: "center", mr: 0.5 }}>
          {hasChildren ? (
            <IconButton size="small" sx={{ p: 0 }} onClick={(e) => { e.stopPropagation(); onToggle(node.node_id); }}>
              {isExpanded ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          ) : null}
        </Box>
        <InstanceAvatar badge={badgeMap.get(node.node_type_id)} fallbackText={node.name} />
        <Typography variant="body2" sx={{ ml: 1, flex: 1, fontWeight: isSelected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </Typography>
      </ListItemButton>
      {hasChildren && (isExpanded || Boolean(searchText)) &&
        visibleChildren.map((child) => (
          <HierarchyTreeNode key={child.node_id} node={child} depth={depth + 1}
            expandedIds={expandedIds} selectedId={selectedId}
            onToggle={onToggle} onSelect={onSelect} searchText={searchText} badgeMap={badgeMap} />
        ))}
    </>
  );
}

function findAncestorIds(nodes: NodeTreeItem[], targetId: string): Set<string> {
  function walk(node: NodeTreeItem, path: string[]): string[] | null {
    if (node.node_id === targetId) return path;
    for (const child of node.children) {
      const found = walk(child, [...path, node.node_id]);
      if (found) return found;
    }
    return null;
  }
  for (const root of nodes) {
    const path = walk(root, []);
    if (path) return new Set(path);
  }
  return new Set();
}

// ── Linked instance row ────────────────────────────────────────────────────────

function LinkedInstanceRow({ link, governedTypes, onRemove }: { link: CrossModelInstance; governedTypes: CrossModelRelationshipTypeSummary[]; onRemove: () => void }) {
  const typeName = governedTypes.find((t) => t.id === link.relationship_rule_id)?.name ?? link.relationship_rule_id ?? "Unknown";

  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between"
      sx={{ px: 2, py: 1.25, borderRadius: 1.5, border: "1px solid", borderColor: "divider", bgcolor: "background.paper", gap: 2 }}>
      <Stack spacing={0.5} flex={1} minWidth={0}>
        <Stack direction="row" alignItems="baseline" gap={0.75}>
          <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0, minWidth: 120 }}>Target Instance</Typography>
          <Typography variant="body2" fontWeight={600} noWrap>{link.target_instance_name}</Typography>
        </Stack>
        <Stack direction="row" alignItems="baseline" gap={2}>
          <Stack direction="row" alignItems="baseline" gap={0.75}>
            <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0, minWidth: 120 }}>Type</Typography>
            <Typography variant="caption" fontWeight={500} color="text.secondary">{link.target_type_name}</Typography>
          </Stack>
          <Stack direction="row" alignItems="baseline" gap={0.75}>
            <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>Target Model</Typography>
            <Typography variant="caption" fontWeight={500} color="text.secondary">{link.target_model_name}</Typography>
          </Stack>
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.75}>
          <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0, minWidth: 120 }}>Relationship</Typography>
          <Chip label={typeName} size="small" sx={{ fontSize: 11, height: 20, bgcolor: "#EEF2FF", color: "#3730A3", fontWeight: 600 }} />
        </Stack>
      </Stack>
      <Tooltip title="Remove link">
        <IconButton size="small" color="error" onClick={onRemove} sx={{ flexShrink: 0 }}>
          <DeleteOutlineIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

// ── Source instance picker panel ───────────────────────────────────────────────

function SourcePanel({
  sourceKind, sourceModelId, selectedInstance,
  onKindChange, onModelChange, onSelectInstance,
}: {
  sourceKind: ModelKind;
  sourceModelId: string | null;
  selectedInstance: GenericInstance | null;
  onKindChange: (k: ModelKind) => void;
  onModelChange: (id: string | null) => void;
  onSelectInstance: (inst: GenericInstance | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const hierModels = useHierarchyModels();
  const sdModels = useSupportDomainModels();
  const nodeInstances = useModelNodeInstances(sourceKind === "HIERARCHY_MODEL" ? sourceModelId : null);
  const nodeTypes = useModelNodeTypes(sourceKind === "HIERARCHY_MODEL" ? sourceModelId : null);
  const elemInstances = useElementInstances(sourceKind === "SUPPORT_DOMAIN_MODEL" ? sourceModelId : null);
  const elementTypes = useSupportDomainElementTypes(sourceKind === "SUPPORT_DOMAIN_MODEL" ? sourceModelId : null);

  const modelOptions = sourceKind === "HIERARCHY_MODEL" ? hierModels.data ?? [] : sdModels.data ?? [];
  const roots = nodeInstances.data ?? [];
  const nodeBadgeMap = useMemo(
    () => new Map((nodeTypes.data ?? []).map((item) => [item.id, item.badge])),
    [nodeTypes.data],
  );
  const elementBadgeMap = useMemo(
    () => new Map((elementTypes.data ?? []).map((item) => [item.id, item.badge])),
    [elementTypes.data],
  );

  // Auto-expand ancestors of selection
  useEffect(() => {
    if (!selectedNodeId || roots.length === 0) return;
    const ancestors = findAncestorIds(roots, selectedNodeId);
    if (ancestors.size > 0) setExpandedIds((prev) => { const n = new Set(prev); ancestors.forEach((id) => n.add(id)); return n; });
  }, [selectedNodeId, roots]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleSelectNode(node: NodeTreeItem) {
    setSelectedNodeId(node.node_id);
    const modelName = modelOptions.find((m) => m.id === sourceModelId)?.name ?? "";
    onSelectInstance({ id: node.node_id, name: node.name, typeName: node.node_type_id, modelId: sourceModelId ?? "", modelName });
  }

  function handleSelectElem(el: ElementInstance) {
    const modelName = modelOptions.find((m) => m.id === sourceModelId)?.name ?? "";
    onSelectInstance({ id: el.instance_id, name: el.name, typeName: el.element_type_name, modelId: sourceModelId ?? "", modelName });
  }

  const filteredElems = useMemo(() => {
    const all = elemInstances.data ?? [];
    if (!search.trim()) return all;
    return all.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));
  }, [elemInstances.data, search]);

  return (
    <Stack spacing={1}>
      <Typography variant="overline" fontSize={10} letterSpacing={1} color="text.secondary">Source Model</Typography>
      <ModelKindToggle value={sourceKind} onChange={(k) => { onKindChange(k); onModelChange(null); onSelectInstance(null); setSearch(""); setExpandedIds(new Set()); }} />
      <Select size="small" fullWidth displayEmpty value={sourceModelId ?? ""}
        onChange={(e) => { onModelChange(e.target.value || null); onSelectInstance(null); setSearch(""); }}>
        <MenuItem value=""><em>— Select model —</em></MenuItem>
        {modelOptions.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
      </Select>

      {sourceModelId && (
        <>
          <TextField size="small" fullWidth placeholder="Search instances…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
          <Box sx={{ flex: 1, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1, maxHeight: 380, minHeight: 120 }}>
            {sourceKind === "HIERARCHY_MODEL" && (
              <>
                {nodeInstances.isLoading && <Box p={1.5}><CircularProgress size={16} /></Box>}
                {nodeInstances.isSuccess && (
                  <List dense disablePadding>
                    {roots.map((root) => (
                      <HierarchyTreeNode key={root.node_id} node={root} depth={0}
                        expandedIds={expandedIds} selectedId={selectedInstance?.id ?? null}
                        onToggle={toggleExpand} onSelect={handleSelectNode} searchText={search} badgeMap={nodeBadgeMap} />
                    ))}
                  </List>
                )}
              </>
            )}
            {sourceKind === "SUPPORT_DOMAIN_MODEL" && (
              <>
                {elemInstances.isLoading && <Box p={1.5}><CircularProgress size={16} /></Box>}
                {elemInstances.isSuccess && filteredElems.map((el) => (
                  <ListItemButton key={el.instance_id} selected={selectedInstance?.id === el.instance_id}
                    onClick={() => handleSelectElem(el)} sx={{ py: 0.4, px: 1.5 }}>
                    <InstanceAvatar badge={elementBadgeMap.get(el.element_type_id)} fallbackText={el.name} />
                    <Box ml={1} minWidth={0}>
                      <Typography variant="body2" fontWeight={selectedInstance?.id === el.instance_id ? 600 : 400} noWrap>{el.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }} noWrap>{el.element_type_name}</Typography>
                    </Box>
                  </ListItemButton>
                ))}
              </>
            )}
          </Box>
        </>
      )}
    </Stack>
  );
}

// ── Add link dialog ────────────────────────────────────────────────────────────

function AddLinkDialog({
  open,
  sourceInstance,
  sourceKind,
  alreadyLinkedIds,
  relationshipTypes,
  onClose,
  onConfirm,
}: {
  open: boolean;
  sourceInstance: GenericInstance;
  sourceKind: ModelKind;
  alreadyLinkedIds: Set<string>;
  relationshipTypes: CrossModelRelationshipTypeSummary[];
  onClose: () => void;
  onConfirm: (targets: GenericInstance[], relationshipRuleId: string) => void;
}) {
  const [targetKind, setTargetKind] = useState<ModelKind>(sourceKind === "HIERARCHY_MODEL" ? "SUPPORT_DOMAIN_MODEL" : "HIERARCHY_MODEL");
  const [targetModelId, setTargetModelId] = useState<string | null>(null);
  const [elementTypeFilter, setElementTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [relType, setRelType] = useState<string | null>(null);

  const hierModels = useHierarchyModels();
  const sdModels = useSupportDomainModels();
  const elementTypes = useSupportDomainElementTypes(targetKind === "SUPPORT_DOMAIN_MODEL" ? targetModelId : null);
  const nodeInstances = useModelNodeInstances(targetKind === "HIERARCHY_MODEL" ? targetModelId : null);
  const elemInstances = useElementInstances(targetKind === "SUPPORT_DOMAIN_MODEL" ? targetModelId : null);

  const modelOptions = targetKind === "HIERARCHY_MODEL" ? hierModels.data ?? [] : sdModels.data ?? [];
  // Filter out source model from target options - can't link to same model
  const availableTargetModels = modelOptions.filter((m) => m.id !== sourceInstance.modelId);
  const modelName = availableTargetModels.find((m) => m.id === targetModelId)?.name ?? "";

  // Reset target model if it matches source model
  useEffect(() => {
    if (targetModelId && targetModelId === sourceInstance.modelId) {
      setTargetModelId(null);
      setSelectedIds(new Set());
    }
  }, [targetModelId, sourceInstance.modelId]);

  // flatten hierarchy nodes
  function flattenTree(nodes: NodeTreeItem[]): NodeTreeItem[] {
    return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
  }

  const allTargets: GenericInstance[] = useMemo(() => {
    if (targetKind === "HIERARCHY_MODEL") {
      return flattenTree(nodeInstances.data ?? []).map((n) => ({
        id: n.node_id, name: n.name, typeName: n.node_type_id, modelId: targetModelId ?? "", modelName,
      }));
    }
    return (elemInstances.data ?? []).map((e) => ({
      id: e.instance_id, name: e.name, typeName: e.element_type_name, modelId: targetModelId ?? "", modelName,
    }));
  }, [targetKind, nodeInstances.data, elemInstances.data, targetModelId, modelName]);

  const filtered = useMemo(() => {
    return allTargets.filter((t) => {
      if (alreadyLinkedIds.has(t.id)) return false;
      if (t.id === sourceInstance.id) return false; // no self-link
      if (elementTypeFilter) {
        const elem = (elemInstances.data ?? []).find((e) => e.instance_id === t.id);
        if (elem && elem.element_type_id !== elementTypeFilter) return false;
      }
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [allTargets, alreadyLinkedIds, sourceInstance.id, elementTypeFilter, search, elemInstances.data]);

  function toggleItem(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleClose() {
    setTargetModelId(null); setElementTypeFilter(null); setSearch(""); setSelectedIds(new Set()); setRelType(null);
    onClose();
  }

  function handleConfirm() {
    if (selectedIds.size === 0 || !relType) return;
    const picked = filtered.filter((t) => selectedIds.has(t.id));
    onConfirm(picked, relType);
    handleClose();
  }

  const isLoading = targetKind === "HIERARCHY_MODEL" ? nodeInstances.isLoading : elemInstances.isLoading;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Cross-Model Link</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "16px !important" }}>
        {/* Source summary */}
        <Box sx={{ px: 1.5, py: 1, bgcolor: "action.hover", borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            <b>Source:</b> {sourceInstance.name} ({sourceInstance.modelName})
          </Typography>
        </Box>

        {/* Target model type */}
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">Target Model Type</Typography>
          <ModelKindToggle value={targetKind} onChange={(k) => { setTargetKind(k); setTargetModelId(null); setSelectedIds(new Set()); }} />
        </Stack>

        {/* Target model */}
        <Stack direction="row" spacing={1.5}>
          <Stack flex={1} spacing={0.5}>
            <Typography variant="caption" color="text.secondary">Target Model</Typography>
            <Select size="small" fullWidth displayEmpty value={targetModelId ?? ""}
              onChange={(e) => { setTargetModelId(e.target.value || null); setElementTypeFilter(null); setSelectedIds(new Set()); }}>
              <MenuItem value=""><em>— Select model —</em></MenuItem>
              {availableTargetModels.length === 0 && (
                <MenuItem value="" disabled><em>No other models available</em></MenuItem>
              )}
              {availableTargetModels.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </Select>
          </Stack>
          {targetKind === "SUPPORT_DOMAIN_MODEL" && (
            <Stack flex={1} spacing={0.5}>
              <Typography variant="caption" color="text.secondary">Element Type</Typography>
              <Select size="small" fullWidth displayEmpty disabled={!targetModelId}
                value={elementTypeFilter ?? ""}
                onChange={(e) => { setElementTypeFilter(e.target.value || null); setSelectedIds(new Set()); }}>
                <MenuItem value=""><em>— All types —</em></MenuItem>
                {(elementTypes.data ?? []).map((et) => <MenuItem key={et.id} value={et.id}>{et.name}</MenuItem>)}
              </Select>
            </Stack>
          )}
        </Stack>

        {/* Relationship type */}
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Relationship Type <Box component="span" color="error.main">*</Box>
          </Typography>
          <Select
            size="small"
            fullWidth
            displayEmpty
            value={relType ?? ""}
            onChange={(e) => setRelType(e.target.value || null)}
            error={!relType}
          >
            <MenuItem value=""><em>— Select a type —</em></MenuItem>
            {relationshipTypes.length === 0 && (
              <MenuItem value="" disabled><em>No governed types defined. Add them in the Model Workspace.</em></MenuItem>
            )}
            {relationshipTypes.map((rt) => (
              <MenuItem key={rt.id} value={rt.id}>{rt.name}</MenuItem>
            ))}
          </Select>
          {!relType && (
            <Typography variant="caption" color="error.main">A relationship type is required.</Typography>
          )}
        </Stack>

        <TextField size="small" placeholder="Search by name…" value={search}
          onChange={(e) => setSearch(e.target.value)} disabled={!targetModelId}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />

        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 180, maxHeight: 300, overflow: "auto" }}>
          {!targetModelId && <Typography variant="caption" color="text.disabled" sx={{ p: 2, display: "block" }}>Select a target model above.</Typography>}
          {targetModelId && isLoading && <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>}
          {targetModelId && !isLoading && filtered.length === 0 && <Typography variant="caption" color="text.disabled" sx={{ p: 2, display: "block" }}>No instances available.</Typography>}
          {targetModelId && !isLoading && filtered.length > 0 && (
            <List dense disablePadding>
              <ListItemButton onClick={() => {
                if (selectedIds.size === filtered.length) setSelectedIds(new Set());
                else setSelectedIds(new Set(filtered.map((t) => t.id)));
              }} sx={{ px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
                <Checkbox size="small" checked={selectedIds.size === filtered.length && filtered.length > 0}
                  indeterminate={selectedIds.size > 0 && selectedIds.size < filtered.length}
                  disableRipple sx={{ p: 0, mr: 1 }} />
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {selectedIds.size === filtered.length ? "Deselect all" : `Select all (${filtered.length})`}
                </Typography>
              </ListItemButton>
              {filtered.map((inst) => (
                <ListItemButton key={inst.id} selected={selectedIds.has(inst.id)}
                  onClick={() => toggleItem(inst.id)} sx={{ px: 1.5, py: 0.5 }}>
                  <Checkbox size="small" checked={selectedIds.has(inst.id)} disableRipple sx={{ p: 0, mr: 1 }} />
                  <Box>
                    <Typography variant="body2" fontWeight={500}>{inst.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{inst.typeName}</Typography>
                  </Box>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" disabled={selectedIds.size === 0 || !relType} onClick={handleConfirm}>
          {selectedIds.size > 1 ? `Add ${selectedIds.size} Links` : "Add Link"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Focused source panel (right side) ────────────────────────────────────────

function FocusedSourcePanel({
  source, sourceKind, links, linksLoading, governedTypes, onAddLink, onRemoveLink,
}: {
  source: GenericInstance;
  sourceKind: ModelKind;
  links: CrossModelInstance[];
  linksLoading: boolean;
  governedTypes: CrossModelRelationshipTypeSummary[];
  onAddLink: () => void;
  onRemoveLink: (link: CrossModelInstance) => void;
}) {
  const kindLabel = sourceKind === "HIERARCHY_MODEL" ? "Hierarchy Node" : "SD Element";
  return (
    <Stack spacing={2} flex={1} minHeight={0} overflow="auto">
      <Paper elevation={0} sx={{ px: 3, py: 2, background: "linear-gradient(135deg, #1565C0 0%, #1976D2 100%)", borderRadius: 2, color: "#fff" }}>
        <Typography variant="overline" sx={{ fontSize: 11, letterSpacing: 1.5, color: "rgba(255,255,255,0.75)" }}>
          Source {kindLabel} — {source.modelName}
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ mt: 0.25, color: "#fff" }}>{source.name}</Typography>
        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.6)" }}>{source.typeName}</Typography>
      </Paper>

      <Paper variant="outlined" sx={{ px: 2, py: 2, flex: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <Stack direction="row" alignItems="center" gap={1}>
            <LayersOutlinedIcon fontSize="small" color="action" />
            <Typography variant="overline" color="text.secondary" fontSize={11} letterSpacing={1}>
              Linked Target Instances
            </Typography>
          </Stack>
          <Button size="small" startIcon={<AddLinkOutlinedIcon />} variant="outlined" onClick={onAddLink}>
            Add Link
          </Button>
        </Stack>
        <Divider />

        {linksLoading && <CircularProgress size={20} />}

        {!linksLoading && links.length === 0 && (
          <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>
            No linked target instances yet. Click the button above to add one.
          </Typography>
        )}

        {!linksLoading && links.length > 0 && (
          <Stack spacing={0.75}>
            {links.map((link) => (
              <LinkedInstanceRow key={link.cross_model_instance_id} link={link} governedTypes={governedTypes} onRemove={() => onRemoveLink(link)} />
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

// ── List View Tab ──────────────────────────────────────────────────────────────

function ListViewTab() {
  const [sourceKind, setSourceKind] = useState<ModelKind>("HIERARCHY_MODEL");
  const [sourceModelId, setSourceModelId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<GenericInstance | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const sourceLinks = useCrossModelLinks(selectedSource?.id ?? null);
  const createLink = useCreateCrossModelLink();
  const deleteLink = useDeleteCrossModelLink();
  const relationshipTypesQuery = useActiveCrossModelRelationshipTypes();

  const links = sourceLinks.data ?? [];
  const governedRelationshipTypes = relationshipTypesQuery.data ?? [];

  const alreadyLinkedIds = useMemo(
    () => new Set(links.map((l) => l.target_instance_id)),
    [links],
  );

  async function handleAddLinks(targets: GenericInstance[], relationshipRuleId: string) {
    if (!selectedSource) return;
    for (const target of targets) {
      await createLink.mutateAsync({
        relationship_rule_id: relationshipRuleId,
        source_instance_id: selectedSource.id,
        source_instance_type: sourceKind,
        target_instance_id: target.id,
        target_instance_type: target.modelId === selectedSource.modelId ? "SUPPORT_DOMAIN_MODEL" : target.typeName as "HIERARCHY_MODEL" | "SUPPORT_DOMAIN_MODEL",
      });
    }
  }

  function handleRemoveLink(link: CrossModelInstance) {
    deleteLink.mutate({ crossModelInstanceId: link.cross_model_instance_id });
  }

  return (
    <Box display="flex" gap={2} flex={1} minHeight={0} width="100%">
      {/* ── Left: source picker ──────────────────────────────────────────── */}
      <Box width={320} flexShrink={0} display="flex" flexDirection="column">
        <Paper variant="outlined" sx={{ p: 1.5, flex: 1, overflow: "auto" }}>
          <SourcePanel
            sourceKind={sourceKind}
            sourceModelId={sourceModelId}
            selectedInstance={selectedSource}
            onKindChange={(k) => { setSourceKind(k); setSourceModelId(null); setSelectedSource(null); }}
            onModelChange={(id) => { setSourceModelId(id); setSelectedSource(null); }}
            onSelectInstance={setSelectedSource}
          />
        </Paper>
      </Box>

      {/* ── Right: links panel ───────────────────────────────────────────── */}
      <Box flex={1} minWidth={0} display="flex" flexDirection="column">
        {!selectedSource ? (
          <Box flex={1} display="flex" alignItems="center" justifyContent="center">
            <Typography variant="body2" color="text.disabled" textAlign="center" maxWidth={360}>
              Select a source instance from the left panel to view and manage its cross-model links.
            </Typography>
          </Box>
        ) : (
          <FocusedSourcePanel
            source={selectedSource}
            sourceKind={sourceKind}
            links={links}
            linksLoading={sourceLinks.isLoading}
            governedTypes={governedRelationshipTypes}
            onAddLink={() => setAddDialogOpen(true)}
            onRemoveLink={handleRemoveLink}
          />
        )}
      </Box>

      {selectedSource && (
        <AddLinkDialog
          open={addDialogOpen}
          sourceInstance={selectedSource}
          sourceKind={sourceKind}
          alreadyLinkedIds={alreadyLinkedIds}
          relationshipTypes={governedRelationshipTypes}
          onClose={() => setAddDialogOpen(false)}
          onConfirm={handleAddLinks}
        />
      )}
    </Box>
  );
}

// ── Main CrossModelLab ─────────────────────────────────────────────────────────

type InnerTab = "matrix" | "diagram";

export function CrossModelLab() {
  const [innerTab, setInnerTab] = useState<InnerTab>("matrix");

  return (
    <Box display="flex" flexDirection="column" flex={1} minHeight={0} width="100%">
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 1.5 }}>
        <Tabs value={innerTab} onChange={(_, v: InnerTab) => setInnerTab(v)} sx={{ minHeight: 36 }}>
          <Tab value="matrix" label="Matrix View" icon={<GridViewOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 36, py: 0.5, fontSize: 13 }} />
          <Tab value="diagram" label="Diagram View" icon={<SchemaOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 36, py: 0.5, fontSize: 13 }} />
        </Tabs>
      </Box>
      {innerTab === "matrix"  && <CrossModelMatrixView />}
      {innerTab === "diagram" && <CrossModelDiagramView />}
    </Box>
  );
}
