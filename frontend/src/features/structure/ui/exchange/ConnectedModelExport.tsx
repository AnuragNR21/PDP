import AddCircleOutlineOutlined from "@mui/icons-material/AddCircleOutlineOutlined";
import ArrowForwardOutlined from "@mui/icons-material/ArrowForwardOutlined";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import DownloadOutlined from "@mui/icons-material/DownloadOutlined";
import ExploreOutlined from "@mui/icons-material/ExploreOutlined";
import LoopOutlined from "@mui/icons-material/LoopOutlined";
import SearchIcon from "@mui/icons-material/Search";
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
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BadgeCustomization } from "@/features/model/domain/types";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import { ModelSelectionPanel } from "@/shared/workspace/ModelSelectionPanel";
import { ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import type { ModelKind, WorkspaceModel } from "@/shared/workspace/workspaceModel";
import {
  CATEGORY_LABEL,
  MODEL_KIND_LABEL,
  buildBranchIndex,
  discover,
  exportFileName,
  instancesCsv,
  relationshipsCsv,
  resolveExport,
  scopeText,
  summarise,
  type BranchCategory,
  type BranchIndex,
  type DiscoveredBranch,
  type InstanceRecord,
  type ModelInstanceScope,
} from "../../domain/connectedExport";
import { createZipBlob } from "../../lib/zip";
import { useExportDefinitions, useExportInstances, type ConnectedExportTypeOption } from "../../state/useConnectedExportData";

const CATEGORY_COLOR: Record<BranchCategory, string> = { hierarchy: "#1565C0", support: "#2E7D32", cross: "#7B1FA2" };
const PREVIEW_ROWS = 200;
const BRANCH_ROWS = 150;

type TypeChoice = { all: boolean; typeIds: Set<string> };
type Profile = { name: string; description: string; purpose: string };

function CategoryChip(props: { category: BranchCategory }) {
  const color = CATEGORY_COLOR[props.category];
  return (
    <Chip
      size="small"
      label={CATEGORY_LABEL[props.category]}
      variant="outlined"
      sx={{ height: 20, fontSize: 10.5, color, borderColor: `${color}66`, bgcolor: `${color}0d`, textTransform: "capitalize", flexShrink: 0 }}
    />
  );
}

function Section(props: { step: number; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
        <Box sx={{ width: 22, height: 22, borderRadius: "50%", bgcolor: "primary.main", color: "primary.contrastText", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {props.step}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>{props.title}</Typography>
          {props.hint && <Typography variant="caption" color="text.secondary">{props.hint}</Typography>}
        </Box>
        {props.action}
      </Stack>
      {props.children}
    </Paper>
  );
}

/** Type label with its badge and model. */
function TypeLabel(props: { index: BranchIndex; typeId: string; badges: Map<string, BadgeCustomization | null | undefined>; showModel?: boolean }) {
  const t = props.index.types.get(props.typeId);
  if (!t) return <Typography variant="body2">{props.typeId}</Typography>;
  return (
    <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
      <CanonicalBadge badge={props.badges.get(t.id) ?? undefined} fallbackText={t.name} size={18} />
      <Typography variant="body2" sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
        {t.name}
      </Typography>
      {props.showModel !== false && (
        <Typography variant="caption" color="text.secondary" noWrap>
          · {props.index.models.get(t.modelId)?.name ?? t.modelId}
        </Typography>
      )}
    </Stack>
  );
}

// ── Instance picker (selected instances of a starting model) ─────────────────

function InstancePickerDialog(props: {
  open: boolean;
  modelName: string;
  instances: InstanceRecord[];
  typeName: (id: string) => string;
  selected: ReadonlySet<string>;
  activeOnly: boolean;
  onClose: () => void;
  onApply: (ids: Set<string>) => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (props.open) {
      setDraft(new Set(props.selected));
      setQuery("");
    }
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const shown = props.instances.filter((i) => !q || i.name.toLowerCase().includes(q) || props.typeName(i.typeId).toLowerCase().includes(q) || (i.externalId ?? "").toLowerCase().includes(q));
  const toggle = (id: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Select instances · {props.modelName}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1 }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder="Search instances, types or External IDs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <Button size="small" onClick={() => setDraft((prev) => new Set([...prev, ...shown.map((i) => i.id)]))} sx={{ flexShrink: 0 }}>
            Select shown
          </Button>
          <Button size="small" onClick={() => setDraft(new Set())} sx={{ flexShrink: 0 }}>
            Clear
          </Button>
        </Stack>
        <Divider />
        <Box sx={{ maxHeight: 420, overflowY: "auto" }}>
          {shown.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {props.instances.length === 0 ? "This model has no instances of the selected types." : "No instances match."}
            </Typography>
          )}
          {shown.map((i) => (
            <Stack key={i.id} direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.25, "&:hover": { bgcolor: "action.hover" }, cursor: "pointer" }} onClick={() => toggle(i.id)}>
              <Checkbox size="small" checked={draft.has(i.id)} tabIndex={-1} inputProps={{ "aria-label": `Select ${i.name}` }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{i.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {props.typeName(i.typeId)}
                  {i.externalId ? ` · ${i.externalId}` : ""}
                </Typography>
              </Box>
              {i.status !== "active" && (
                <Tooltip title={props.activeOnly ? "Left out while Active only is on" : ""}>
                  <Chip size="small" label={i.status} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                </Tooltip>
              )}
            </Stack>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1 }}>
          {draft.size} selected
        </Typography>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => props.onApply(draft)}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Starting model card: types and instance scope ────────────────────────────

function orderedTypes(options: ConnectedExportTypeOption[]) {
  const ids = new Set(options.map((o) => o.id));
  const children = new Map<string | null, ConnectedExportTypeOption[]>();
  for (const o of options) {
    const parent = o.parentId && ids.has(o.parentId) && o.parentId !== o.id ? o.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), o]);
  }
  const out: Array<{ option: ConnectedExportTypeOption; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const o of children.get(parent) ?? []) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      out.push({ option: o, depth });
      visit(o.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const o of options) if (!seen.has(o.id)) out.push({ option: o, depth: 0 });
  return out;
}

function StartingModelCard(props: {
  model: WorkspaceModel;
  types: ConnectedExportTypeOption[];
  choice: TypeChoice;
  onChoice: (next: TypeChoice) => void;
  scope: ModelInstanceScope;
  onScope: (next: ModelInstanceScope) => void;
  instances: InstanceRecord[];
  instancesLoading: boolean;
  activeOnly: boolean;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const rows = useMemo(() => orderedTypes(props.types), [props.types]);
  const chosen = props.choice.all ? new Set(props.types.map((t) => t.id)) : props.choice.typeIds;
  const typeName = (id: string) => props.types.find((t) => t.id === id)?.name ?? id;
  const ofChosen = props.instances.filter((i) => chosen.has(i.typeId));
  const toggleType = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onChoice({ all: next.size === props.types.length && props.types.length > 0, typeIds: next });
  };
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderColor: "divider" }} data-testid={`starting-model-${props.model.id}`}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <ModelKindIcon kind={props.model.kind} size={26} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} noWrap>{props.model.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {MODEL_KIND_LABEL[props.model.kind]} model · {chosen.size} of {props.types.length} type{props.types.length === 1 ? "" : "s"}
          </Typography>
        </Box>
        {props.model.status !== "active" && <Chip size="small" label={props.model.status} variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
        <Tooltip title="Remove starting model">
          <IconButton size="small" onClick={props.onRemove} aria-label={`Remove starting model ${props.model.name}`}>
            <CloseOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mt: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="caption" fontWeight={700}>Types</Typography>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={props.choice.all}
                  indeterminate={!props.choice.all && chosen.size > 0}
                  onChange={(e) => props.onChoice({ all: e.target.checked, typeIds: e.target.checked ? new Set(props.types.map((t) => t.id)) : new Set() })}
                />
              }
              label={<Typography variant="caption">All types</Typography>}
              sx={{ mr: 0 }}
            />
          </Stack>
          <Box sx={{ maxHeight: 168, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1, py: 0.25 }}>
            {props.types.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", p: 1 }}>This model defines no types yet.</Typography>
            )}
            {rows.map(({ option, depth }) => (
              <Stack
                key={option.id}
                direction="row"
                alignItems="center"
                spacing={0.5}
                sx={{ pl: 0.5 + depth * 1.75, pr: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                onClick={() => toggleType(option.id)}
              >
                <Checkbox size="small" checked={chosen.has(option.id)} tabIndex={-1} sx={{ p: 0.4 }} inputProps={{ "aria-label": `Type ${option.name}` }} />
                <CanonicalBadge badge={option.badge ?? undefined} fallbackText={option.name} size={18} />
                <Typography variant="body2" sx={{ fontSize: 12.5 }} noWrap>{option.name}</Typography>
              </Stack>
            ))}
          </Box>
        </Box>

        <Box sx={{ width: { xs: "100%", md: 260 }, flexShrink: 0 }}>
          <Typography variant="caption" fontWeight={700}>Instance scope</Typography>
          <RadioGroup
            value={props.scope.mode}
            onChange={(e) => props.onScope({ ...props.scope, mode: e.target.value as ModelInstanceScope["mode"] })}
          >
            <FormControlLabel value="all" control={<Radio size="small" sx={{ p: 0.5 }} />} label={<Typography variant="body2" sx={{ fontSize: 12.5 }}>All instances of the selected types</Typography>} />
            <FormControlLabel value="selected" control={<Radio size="small" sx={{ p: 0.5 }} />} label={<Typography variant="body2" sx={{ fontSize: 12.5 }}>Selected instances only</Typography>} />
          </RadioGroup>
          {props.scope.mode === "selected" && (
            <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 3.5 }}>
              <Typography variant="caption" color="text.secondary">
                {props.scope.selectedIds.size} selected
              </Typography>
              <Button size="small" onClick={() => setPickerOpen(true)} disabled={props.instancesLoading}>
                Choose…
              </Button>
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {props.instancesLoading ? "Loading instances…" : `${ofChosen.length} instance${ofChosen.length === 1 ? "" : "s"} of the selected types`}
          </Typography>
        </Box>
      </Stack>

      <InstancePickerDialog
        open={pickerOpen}
        modelName={props.model.name}
        instances={ofChosen}
        typeName={typeName}
        selected={props.scope.selectedIds}
        activeOnly={props.activeOnly}
        onClose={() => setPickerOpen(false)}
        onApply={(ids) => {
          props.onScope({ mode: "selected", selectedIds: ids });
          setPickerOpen(false);
        }}
      />
    </Paper>
  );
}

// ── Discovered relationships ─────────────────────────────────────────────────

function BranchRow(props: {
  item: DiscoveredBranch;
  index: BranchIndex;
  badges: Map<string, BadgeCustomization | null | undefined>;
  onToggle: () => void;
}) {
  const { item, index } = props;
  const b = item.branch;
  const self = b.sourceTypeId === b.targetTypeId;
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ px: 0.75, py: 0.25, borderBottom: "1px solid", borderColor: "divider", opacity: item.included ? 1 : 0.55 }}
      data-branch-key={b.key}
    >
      <Checkbox size="small" checked={item.included} onChange={props.onToggle} sx={{ p: 0.4 }} inputProps={{ "aria-label": `Include ${b.ruleName}` }} />
      <CategoryChip category={b.category} />
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <TypeLabel index={index} typeId={b.sourceTypeId} badges={props.badges} />
        <ArrowForwardOutlined sx={{ fontSize: 14, color: CATEGORY_COLOR[b.category], flexShrink: 0 }} />
        <Typography variant="caption" sx={{ fontStyle: "italic", color: CATEGORY_COLOR[b.category], flexShrink: 0, maxWidth: 220 }} noWrap>
          {b.ruleName}
        </Typography>
        <ArrowForwardOutlined sx={{ fontSize: 14, color: CATEGORY_COLOR[b.category], flexShrink: 0 }} />
        {self ? <Typography variant="caption" color="text.secondary">itself</Typography> : <TypeLabel index={index} typeId={b.targetTypeId} badges={props.badges} />}
      </Stack>
      <Tooltip title={`Found from ${index.types.get(item.fromTypeId)?.name ?? item.fromTypeId}`}>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, width: 64, textAlign: "right" }}>
          {item.direction === "self" ? (b.category === "hierarchy" ? "recursive" : "self") : item.direction}
        </Typography>
      </Tooltip>
      {item.closesLoop && !self ? (
        <Tooltip title="Both ends are already in scope: their relationships are exported, and discovery goes no further this way">
          <LoopOutlined sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
        </Tooltip>
      ) : (
        <Box sx={{ width: 16, flexShrink: 0 }} />
      )}
    </Stack>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Connected Model Export (SWS Data Transfer).
 *
 * Choose starting models and their types, review the relationships the model
 * definitions propose between them and onwards, choose instance scope, then
 * preview and download one ZIP — Instances.csv, Relationships.csv, Scope.txt.
 * Read-only: nothing in PDP is changed.
 */
export function ConnectedModelExport(props: { models: WorkspaceModel[]; modelsLoading: boolean }) {
  const [profile, setProfile] = useState<Profile>({ name: "", description: "", purpose: "" });
  const [startKeys, setStartKeys] = useState<string[]>([]);
  const [typeChoice, setTypeChoice] = useState<Map<string, TypeChoice>>(new Map());
  const [instanceScopes, setInstanceScopes] = useState<Map<string, ModelInstanceScope>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [includeAll, setIncludeAll] = useState(true);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [activeOnly, setActiveOnly] = useState(false);
  const [modelActiveOnly, setModelActiveOnly] = useState(false);
  const [selectionCollapsed, setSelectionCollapsed] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchCategory, setBranchCategory] = useState<BranchCategory | "all">("all");
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [previewTab, setPreviewTab] = useState<"instances" | "relationships" | "scope">("instances");
  const [recursionModels, setRecursionModels] = useState<string[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadedAt, setDownloadedAt] = useState<string | null>(null);

  const modelByKey = useMemo(() => new Map(props.models.map((m) => [`${m.kind}:${m.id}`, m])), [props.models]);
  const startModels = useMemo(() => startKeys.map((k) => modelByKey.get(k)).filter((m): m is WorkspaceModel => Boolean(m)), [startKeys, modelByKey]);
  const startModelIds = useMemo(() => new Set(startModels.map((m) => m.id)), [startModels]);

  const defs = useExportDefinitions(props.models, recursionModels);
  const index = useMemo(() => (defs.definitions ? buildBranchIndex(defs.definitions) : null), [defs.definitions]);
  const badges = useMemo(() => {
    const map = new Map<string, BadgeCustomization | null | undefined>();
    for (const t of [...(defs.typeOptions?.nodeTypes ?? []), ...(defs.typeOptions?.elementTypes ?? [])]) map.set(t.id, t.badge);
    return map;
  }, [defs.typeOptions]);
  const typesOfModel = useMemo(() => {
    const map = new Map<string, ConnectedExportTypeOption[]>();
    for (const t of [...(defs.typeOptions?.nodeTypes ?? []), ...(defs.typeOptions?.elementTypes ?? [])]) map.set(t.modelId, [...(map.get(t.modelId) ?? []), t]);
    return map;
  }, [defs.typeOptions]);

  const choiceFor = (modelId: string): TypeChoice => typeChoice.get(modelId) ?? { all: true, typeIds: new Set() };
  const scopeFor = (modelId: string): ModelInstanceScope => instanceScopes.get(modelId) ?? { mode: "all", selectedIds: new Set() };

  const startTypeIds = useMemo(() => {
    const out = new Set<string>();
    for (const m of startModels) {
      const c = typeChoice.get(m.id) ?? { all: true, typeIds: new Set<string>() };
      for (const t of typesOfModel.get(m.id) ?? []) if (c.all || c.typeIds.has(t.id)) out.add(t.id);
    }
    return out;
  }, [startModels, typeChoice, typesOfModel]);

  const selection = useMemo(() => ({ startTypeIds, expandedTypeIds: expanded, includeAll, toggled }), [startTypeIds, expanded, includeAll, toggled]);
  const discovery = useMemo(() => (index ? discover(index, selection) : null), [index, selection]);

  // Models whose instances are needed: starting models, and every model a type in scope belongs to.
  const scopeModels = useMemo(() => {
    const ids = new Set(startModelIds);
    if (discovery && index) for (const t of discovery.scopeTypeIds) {
      const def = index.types.get(t);
      if (def) ids.add(def.modelId);
    }
    return [...ids]
      .map((id) => props.models.find((m) => m.id === id))
      .filter((m): m is WorkspaceModel => Boolean(m))
      .map((m) => ({ id: m.id, kind: m.kind as ModelKind }));
  }, [startModelIds, discovery, index, props.models]);
  const scopeModelsKey = scopeModels.map((m) => `${m.kind}:${m.id}`).sort().join(",");
  const stableScopeModels = useMemo(() => scopeModels, [scopeModelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recursion is read for the hierarchy models in play.
  useEffect(() => {
    const ids = stableScopeModels.filter((m) => m.kind === "hierarchy").map((m) => m.id).sort();
    setRecursionModels((prev) => (prev.join(",") === ids.join(",") ? prev : ids));
  }, [stableScopeModels]);

  const data = useExportInstances(stableScopeModels);

  const result = useMemo(() => {
    if (!index || !discovery) return null;
    return resolveExport({
      index,
      discovery,
      startModelIds,
      startTypeIds,
      scopes: instanceScopes,
      activeOnly,
      instances: data.instances,
      crossLinks: data.crossLinks,
    });
  }, [index, discovery, startModelIds, startTypeIds, instanceScopes, activeOnly, data.instances, data.crossLinks]);
  const summary = useMemo(() => (index && discovery && result ? summarise(index, discovery, startModelIds, result) : null), [index, discovery, startModelIds, result]);

  const allTypesByModel = useMemo(() => new Map(startModels.map((m) => [m.id, (typeChoice.get(m.id) ?? { all: true }).all])), [startModels, typeChoice]);
  const buildScopeText = (when: Date) =>
    index && discovery && result && summary
      ? scopeText({ profile, exportedAt: when, index, selection, discovery, startModelIds, allTypesByModel, scopes: instanceScopes, activeOnly, modelActiveOnly, result, summary })
      : "";
  const scopePreview = useMemo(() => buildScopeText(new Date()), [index, discovery, result, summary, profile, activeOnly, modelActiveOnly, instanceScopes, allTypesByModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStart = (kind: ModelKind, id: string) => {
    const key = `${kind}:${id}`;
    setStartKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    setDownloadedAt(null);
  };
  /** A related model becomes a starting model: its in-scope types, all instances (connected or not). */
  const promoteModel = (modelId: string) => {
    const m = props.models.find((x) => x.id === modelId);
    if (!m || !discovery || !index) return;
    const inScope = [...discovery.scopeTypeIds].filter((t) => index.types.get(t)?.modelId === modelId);
    const all = (typesOfModel.get(modelId) ?? []).length === inScope.length;
    setTypeChoice((prev) => new Map(prev).set(modelId, { all, typeIds: new Set(inScope) }));
    setStartKeys((prev) => (prev.includes(`${m.kind}:${m.id}`) ? prev : [...prev, `${m.kind}:${m.id}`]));
  };
  const toggleBranch = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleExpanded = (typeId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });

  const typeNameOf = (id: string) => index?.types.get(id)?.name ?? id;
  const instanceById = useMemo(() => new Map((result?.instances ?? []).map((i) => [i.id, i])), [result]);

  const q = branchQuery.trim().toLowerCase();
  const branches = (discovery?.branches ?? []).filter(
    (b) =>
      (branchCategory === "all" || b.branch.category === branchCategory) &&
      (!q ||
        b.branch.ruleName.toLowerCase().includes(q) ||
        typeNameOf(b.branch.sourceTypeId).toLowerCase().includes(q) ||
        typeNameOf(b.branch.targetTypeId).toLowerCase().includes(q)),
  );
  const categoryCount = (c: BranchCategory) => (discovery?.branches ?? []).filter((b) => b.branch.category === c).length;
  const shownBranches = showAllBranches ? branches : branches.slice(0, BRANCH_ROWS);

  const loadingInstances = data.loading;
  const canDownload = Boolean(result && summary && startModels.length > 0 && !loadingInstances && !data.error);

  const download = () => {
    if (!index || !result || !summary) return;
    setDownloadError(null);
    try {
      const when = new Date();
      const blob = createZipBlob([
        { name: "Instances.csv", content: instancesCsv(index, result) },
        { name: "Relationships.csv", content: relationshipsCsv(result) },
        { name: "Scope.txt", content: buildScopeText(when) },
      ]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(profile.name, when);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadedAt(a.download);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "The export could not be built.");
    }
  };

  const startKeySet = useMemo(() => new Set(startKeys), [startKeys]);

  return (
    <Box sx={{ display: "flex", gap: 1, flex: 1, minHeight: 0, minWidth: 0 }}>
      <ModelSelectionPanel
        title="Starting Models"
        models={props.models}
        selected={null}
        multiSelected={startKeySet}
        onSelect={toggleStart}
        onActiveOnlyChange={setModelActiveOnly}
        collapsed={selectionCollapsed}
        onToggleCollapsed={() => setSelectionCollapsed(!selectionCollapsed)}
        loading={props.modelsLoading}
      />

      <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", pr: 0.5 }} data-testid="connected-model-export">
        {defs.error && <Alert severity="error">Could not load the model definitions.</Alert>}

        <Section step={1} title="Profile" hint="Describes this export. Recorded in Scope.txt and used for the file name.">
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.25}>
            <TextField size="small" label="Profile name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} sx={{ flex: 1 }} inputProps={{ maxLength: 120 }} />
            <TextField size="small" label="Purpose" value={profile.purpose} onChange={(e) => setProfile({ ...profile, purpose: e.target.value })} sx={{ flex: 1 }} placeholder="e.g. Asset risk reporting" inputProps={{ maxLength: 240 }} />
          </Stack>
          <TextField size="small" label="Description" value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} fullWidth multiline minRows={1} maxRows={4} sx={{ mt: 1.25 }} inputProps={{ maxLength: 2000 }} />
        </Section>

        <Section
          step={2}
          title="Starting models and types"
          hint="Tick one or more models in Starting Models. They need not be connected; each keeps its own types and instance scope."
        >
          {startModels.length === 0 ? (
            <Alert severity="info" variant="outlined">No starting model yet — tick a Hierarchy or Support Domain model on the left.</Alert>
          ) : (
            <Stack spacing={1}>
              {startModels.map((m) => (
                <StartingModelCard
                  key={m.id}
                  model={m}
                  types={typesOfModel.get(m.id) ?? []}
                  choice={choiceFor(m.id)}
                  onChoice={(next) => setTypeChoice((prev) => new Map(prev).set(m.id, next))}
                  scope={scopeFor(m.id)}
                  onScope={(next) => setInstanceScopes((prev) => new Map(prev).set(m.id, next))}
                  instances={data.instances.filter((i) => i.modelId === m.id)}
                  instancesLoading={loadingInstances}
                  activeOnly={activeOnly}
                  onRemove={() => toggleStart(m.kind, m.id)}
                />
              ))}
            </Stack>
          )}
        </Section>

        <Section
          step={3}
          title="Discovered relationships"
          hint="Proposed from the model definitions. Along a branch: hierarchy follows each node's stored parent, Support Domain is inherited from the model (every instance of one type to every instance of the other), cross-model follows the stored instance links. Untick a branch to leave it out; explore a related type to follow it further."
          action={
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={includeAll}
                  onChange={(e) => {
                    setIncludeAll(e.target.checked);
                    setToggled(new Set());
                  }}
                />
              }
              label={<Typography variant="caption" fontWeight={600}>Include all discovered branches</Typography>}
              sx={{ mr: 0 }}
            />
          }
        >
          {!discovery || startTypeIds.size === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {defs.loading ? "Loading model definitions…" : "Choose starting models and types to see their relationships."}
            </Typography>
          ) : (
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                {(["all", "hierarchy", "support", "cross"] as const).map((c) => (
                  <Chip
                    key={c}
                    size="small"
                    clickable
                    onClick={() => setBranchCategory(c)}
                    color={branchCategory === c ? "primary" : "default"}
                    variant={branchCategory === c ? "filled" : "outlined"}
                    label={c === "all" ? `All (${discovery.branches.length})` : `${CATEGORY_LABEL[c]} (${categoryCount(c)})`}
                    sx={{ textTransform: c === "all" ? "none" : "capitalize", ...(c !== "all" && branchCategory !== c ? { color: CATEGORY_COLOR[c], borderColor: `${CATEGORY_COLOR[c]}66` } : {}) }}
                  />
                ))}
                <Box sx={{ flex: 1 }} />
                <TextField
                  size="small"
                  placeholder="Search types or rules"
                  value={branchQuery}
                  onChange={(e) => setBranchQuery(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                  sx={{ width: 240 }}
                />
              </Stack>
              <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, maxHeight: 320, overflowY: "auto" }} aria-label="Discovered branches">
                {branches.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1.25 }}>
                    {discovery.branches.length === 0 ? "The model definitions relate these types to nothing else." : "No branches match."}
                  </Typography>
                )}
                {shownBranches.map((item) => (
                  <BranchRow key={item.branch.key} item={item} index={index!} badges={badges} onToggle={() => toggleBranch(item.branch.key)} />
                ))}
                {!showAllBranches && branches.length > BRANCH_ROWS && (
                  <Button size="small" onClick={() => setShowAllBranches(true)} sx={{ m: 0.5 }}>
                    Show all {branches.length}
                  </Button>
                )}
              </Box>

              <Box>
                <Typography variant="caption" fontWeight={700}>
                  Related types ({discovery.related.length})
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Related types contribute only instances connected to the export. Explore one to offer its own relationships, or add its model as a starting model to choose its instances independently.
                </Typography>
                {discovery.related.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">None — no included branch leads outside the starting types.</Typography>
                ) : (
                  <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, maxHeight: 260, overflowY: "auto" }}>
                    {discovery.related.map((r) => {
                      const t = index!.types.get(r.typeId);
                      const modelIsStart = t ? startModelIds.has(t.modelId) : false;
                      return (
                        <Stack key={r.typeId} direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.4, borderBottom: "1px solid", borderColor: "divider" }} data-related-type={r.typeId}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <TypeLabel index={index!} typeId={r.typeId} badges={badges} />
                          </Box>
                          <Chip size="small" label={`step ${r.depth}`} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                          {r.viaBranchKeys.length > 1 && (
                            <Tooltip title="Reached by more than one path; listed and exported once">
                              <Chip size="small" label={`${r.viaBranchKeys.length} paths`} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                            </Tooltip>
                          )}
                          <Button
                            size="small"
                            startIcon={<ExploreOutlined sx={{ fontSize: "15px !important" }} />}
                            variant={expanded.has(r.typeId) ? "contained" : "outlined"}
                            onClick={() => toggleExpanded(r.typeId)}
                            sx={{ fontSize: 11, py: 0.1 }}
                          >
                            {expanded.has(r.typeId) ? "Exploring" : "Explore"}
                          </Button>
                          {t && !modelIsStart && (
                            <Tooltip title="Add this model as a starting model: its instances can then be chosen independently, including unconnected ones">
                              <Button size="small" startIcon={<AddCircleOutlineOutlined sx={{ fontSize: "15px !important" }} />} onClick={() => promoteModel(t.modelId)} sx={{ fontSize: 11, py: 0.1 }}>
                                Starting model
                              </Button>
                            </Tooltip>
                          )}
                        </Stack>
                      );
                    })}
                  </Box>
                )}
              </Box>
            </Stack>
          )}
        </Section>

        <Section
          step={4}
          title="Preview and export"
          hint="Preview and download use exactly the same scope."
          action={
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Tooltip title="Instance filter — separate from the Active filter on models">
                <FormControlLabel
                  control={<Switch size="small" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />}
                  label={<Typography variant="caption" fontWeight={600}>Active instances only</Typography>}
                  sx={{ mr: 0 }}
                />
              </Tooltip>
              <Button variant="contained" startIcon={<DownloadOutlined />} disabled={!canDownload} onClick={download}>
                Download ZIP
              </Button>
            </Stack>
          }
        >
          {downloadError && <Alert severity="error" sx={{ mb: 1 }}>{downloadError}</Alert>}
          {downloadedAt && <Alert severity="success" sx={{ mb: 1 }} onClose={() => setDownloadedAt(null)}>Downloaded {downloadedAt}</Alert>}
          {data.error && <Alert severity="error" sx={{ mb: 1 }}>Some instances could not be loaded, so the export is not available. Reload to try again.</Alert>}
          {startModels.length === 0 || !summary || !result ? (
            <Alert severity="info" variant="outlined">Nothing to preview yet — add a starting model.</Alert>
          ) : (
            <Stack spacing={1.25}>
              <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                <Table size="small" aria-label="Export summary">
                  <TableHead>
                    <TableRow>
                      <TableCell>Model</TableCell>
                      <TableCell>Kind</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell align="right">Types</TableCell>
                      <TableCell align="right">Instances</TableCell>
                      <TableCell align="right">Relationships</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.byModel.map((r) => (
                      <TableRow key={r.modelId}>
                        <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                        <TableCell>{MODEL_KIND_LABEL[r.kind]}</TableCell>
                        <TableCell>
                          <Chip size="small" label={r.role === "starting" ? "Starting" : "Related"} color={r.role === "starting" ? "primary" : "default"} variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />
                        </TableCell>
                        <TableCell align="right">{r.types}</TableCell>
                        <TableCell align="right">{loadingInstances ? "…" : r.instances}</TableCell>
                        <TableCell align="right">{loadingInstances ? "…" : r.relationships}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={{ "& td": { fontWeight: 700, borderBottom: 0 } }}>
                      <TableCell colSpan={3}>Total ({summary.totals.models} model{summary.totals.models === 1 ? "" : "s"})</TableCell>
                      <TableCell align="right">{summary.totals.types}</TableCell>
                      <TableCell align="right">{loadingInstances ? "…" : summary.totals.instances}</TableCell>
                      <TableCell align="right">{loadingInstances ? "…" : summary.totals.relationships}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {(["hierarchy", "support", "cross"] as const).map((c) => (
                  <Chip
                    key={c}
                    size="small"
                    variant="outlined"
                    label={`${CATEGORY_LABEL[c]}: ${loadingInstances ? "…" : summary.totals.byCategory[c]}`}
                    sx={{ color: CATEGORY_COLOR[c], borderColor: `${CATEGORY_COLOR[c]}66`, textTransform: "capitalize" }}
                  />
                ))}
                {!loadingInstances && result.unmatchedLinks > 0 && (
                  <Tooltip title="Stored relationships touching exported instances that match no relationship the models currently define (for example a link whose rule changed after it was made). They follow no defined path, so they are left out; Scope.txt records the count.">
                    <Chip size="small" color="warning" variant="outlined" label={`${result.unmatchedLinks} stored link${result.unmatchedLinks === 1 ? "" : "s"} outside the model definitions — not exported`} />
                  </Tooltip>
                )}
                {loadingInstances && (
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <CircularProgress size={14} />
                    <Typography variant="caption" color="text.secondary">Loading instances…</Typography>
                  </Stack>
                )}
              </Stack>

              <Box>
                <Tabs value={previewTab} onChange={(_e, v) => setPreviewTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, textTransform: "none" } }}>
                  <Tab value="instances" label={`Instances (${result.instances.length})`} />
                  <Tab value="relationships" label={`Relationships (${result.relationships.length})`} />
                  <Tab value="scope" label="Scope" />
                </Tabs>
                <Divider />
                {previewTab === "instances" &&
                  (result.instances.length === 0 ? (
                    <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
                      {loadingInstances ? "Loading…" : "No instances match this scope. Check the chosen types, instance scope and the Active instances filter."}
                    </Alert>
                  ) : (
                    <TableContainer sx={{ maxHeight: 360 }}>
                      <Table size="small" stickyHeader aria-label="Instances preview">
                        <TableHead>
                          <TableRow>
                            <TableCell>Instance</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Model</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>External ID</TableCell>
                            <TableCell>PDP ID</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {result.instances.slice(0, PREVIEW_ROWS).map((i) => (
                            <TableRow key={i.id} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{i.name}</TableCell>
                              <TableCell>{typeNameOf(i.typeId)}</TableCell>
                              <TableCell>{index?.models.get(i.modelId)?.name ?? i.modelId}</TableCell>
                              <TableCell>{i.status}</TableCell>
                              <TableCell>{i.externalId ?? "—"}</TableCell>
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 11, color: "text.secondary" }}>{i.id}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ))}
                {previewTab === "relationships" &&
                  (result.relationships.length === 0 ? (
                    <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
                      {loadingInstances ? "Loading…" : "No relationships in this scope: no included branch connects two exported instances."}
                    </Alert>
                  ) : (
                    <TableContainer sx={{ maxHeight: 360 }}>
                      <Table size="small" stickyHeader aria-label="Relationships preview">
                        <TableHead>
                          <TableRow>
                            <TableCell>Category</TableCell>
                            <TableCell>Source</TableCell>
                            <TableCell>Rule</TableCell>
                            <TableCell>Target</TableCell>
                            <TableCell>Relationship ID</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {result.relationships.slice(0, PREVIEW_ROWS).map((r) => (
                            <TableRow key={r.id} hover>
                              <TableCell><CategoryChip category={r.category} /></TableCell>
                              <TableCell>{instanceById.get(r.sourceId)?.name ?? r.sourceId}</TableCell>
                              <TableCell sx={{ fontStyle: "italic", color: CATEGORY_COLOR[r.category], maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.ruleName}>
                                {r.ruleName}
                              </TableCell>
                              <TableCell>{instanceById.get(r.targetId)?.name ?? r.targetId}</TableCell>
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 11, color: "text.secondary", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.id}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ))}
                {previewTab === "scope" && (
                  <Box component="pre" sx={{ m: 0, mt: 1, p: 1.25, bgcolor: "grey.50", border: "1px solid", borderColor: "divider", borderRadius: 1, fontSize: 11.5, maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }} data-testid="scope-preview">
                    {scopePreview}
                  </Box>
                )}
                {previewTab !== "scope" && (previewTab === "instances" ? result.instances.length : result.relationships.length) > PREVIEW_ROWS && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    Showing the first {PREVIEW_ROWS} of {previewTab === "instances" ? result.instances.length : result.relationships.length}; the download holds every row.
                  </Typography>
                )}
              </Box>
            </Stack>
          )}
        </Section>
      </Stack>
    </Box>
  );
}
