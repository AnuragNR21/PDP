import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemButton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewOutlined from "@mui/icons-material/OpenInNewOutlined";
import {
  useUpdateNodeInstance,
  useUpdateElementInstance,
  useNodeInstanceProperties,
  useElementInstanceProperties,
  type NodeTreeItem,
} from "@/features/structure/state/useStructureWorkspace";
import { PropertyRulesPanel } from "../PropertyRulesPanel";
import { PropertyValuesPanel } from "../PropertyValuesPanel";
import { NodeInstancePropertiesPanel } from "../NodeInstancePropertiesPanel";
import { ReadOnlyIdField } from "@/features/model/ui/shared/ReadOnlyIdField";
import type { ElementInstance } from "@/features/structure/api/structureApi";
import type { HierarchyNodeSummary } from "@/features/model/domain/types";
import { CanonicalBadge } from "@/features/structure/ui/shared/CanonicalBadge";
import { ACTIVE, InstanceStatusField, LifecycleChip, useInstanceDefinition } from "./lifecycle";

/*
 * The instance editors of the Structure Workspace. They sit in the shared
 * layout's Element Details section, which carries the title and the row
 * actions, so `embedded` drops their own header.
 */

// ── Utilities ─────────────────────────────────────────────────────────────────

export function flattenTree(nodes: NodeTreeItem[]): NodeTreeItem[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

// ── Recursive tree node (with eye icon) ───────────────────────────────────────

type TreeNodeProps = {
  node: NodeTreeItem;
  depth: number;
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: NodeTreeItem) => void;
  onDelete: (node: NodeTreeItem) => void;
  onAddChild: (node: NodeTreeItem) => void;
  /** Lifecycle: whether a child may be added here (an Active model, a node that is not Archived). */
  canAddChild?: (node: NodeTreeItem) => boolean;
  searchText: string;
  nodeTypes?: HierarchyNodeSummary[];
};

export function TreeNode({
  node,
  depth,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
  onDelete,
  onAddChild,
  canAddChild,
  searchText,
  nodeTypes,
}: TreeNodeProps) {
  const isExpanded = expandedIds.has(node.node_id);
  const isSelected = node.node_id === selectedId;
  const hasChildren = node.children.length > 0;
  const matchesSearch =
    !searchText || node.name.toLowerCase().includes(searchText.toLowerCase());
  const nodeInstanceMatches = (n: NodeTreeItem): boolean =>
    n.name.toLowerCase().includes(searchText.toLowerCase()) ||
    n.children.some(nodeInstanceMatches);

  if (searchText && !nodeInstanceMatches(node)) return null;
  const visibleChildren = searchText
    ? node.children.filter(nodeInstanceMatches)
    : node.children;

  return (
    <>
      <ListItemButton
        data-node-id={node.node_id}
        sx={{
          pl: 1 + depth * 3,
          py: 0.5,
          opacity: matchesSearch ? 1 : 0.5,
          "&:hover .node-actions": { opacity: 1 },
        }}
        selected={isSelected}
        onClick={() => onSelect(node)}
      >
        <Box sx={{ width: 24, display: "flex", alignItems: "center", mr: 0.5 }}>
          {hasChildren ? (
            <Tooltip title={isExpanded ? "Collapse" : "Expand"}>
              <IconButton
                size="small"
                sx={{ p: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node.node_id);
                }}
              >
                {isExpanded ? (
                  <ExpandMoreIcon sx={{ fontSize: 18 }} />
                ) : (
                  <ChevronRightIcon sx={{ fontSize: 18 }} />
                )}
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
        <CanonicalBadge
          badge={nodeTypes?.find((t) => t.id === node.node_type_id)?.badge}
          fallbackText={node.name}
          size={24}
        />
        <Typography
          variant="body2"
          sx={{
            ml: 1,
            flex: 1,
            fontWeight: isSelected ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name}
        </Typography>
        <LifecycleChip status={node.status} />
        <Box className="node-actions" sx={{ display: 'flex', opacity: 0, transition: 'opacity 0.15s' }}>
          {(canAddChild ? canAddChild(node) : true) && (
            <IconButton
              size="small"
              color="primary"
              sx={{ p: 0.25 }}
              onClick={(e) => { e.stopPropagation(); onAddChild(node); }}
            >
              <AddIcon sx={{ fontSize: 15 }} />
            </IconButton>
          )}
          <IconButton
            size="small"
            color="error"
            sx={{ p: 0.25 }}
            onClick={(e) => { e.stopPropagation(); onDelete(node); }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>
      </ListItemButton>

      {hasChildren &&
        (isExpanded || Boolean(searchText)) &&
        visibleChildren.map((child) => (
          <TreeNode
            key={child.node_id}
            node={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onToggle={onToggle}
            onSelect={onSelect}
            onDelete={onDelete}
            onAddChild={onAddChild}
            canAddChild={canAddChild}
            searchText={searchText}
            nodeTypes={nodeTypes}
          />
        ))}
    </>
  );
}

// ── Node instance inline editor ───────────────────────────────────────────────

/**
 * SWS › Node Instance Details — laid out like MWS › Node Type Details: the
 * same full-width General / Properties / Rules tabs, outlined fields in one
 * column, what the Node Type governs shown read-only, and Save in the panel's
 * toolbar (`saveRef` / `onDirtyChange`) rather than in the body.
 *
 * Properties are the Node Type's (MWS) with this instance's values (SWS);
 * nothing here defines a property.
 */
export function HierarchyNodeInstanceEditor({
  node,
  nodeTypes,
  modelId,
  onDelete,
  onAddChild,
  onSaved,
  embedded,
  saveRef,
  onDirtyChange,
  initialTab,
}: {
  node: NodeTreeItem;
  nodeTypes?: HierarchyNodeSummary[];
  modelId: string;
  onDelete: () => void;
  onAddChild: () => void;
  onSaved: (name: string) => void;
  embedded?: boolean;
  /** Filled with this editor's save, for a Save button outside it (the panel toolbar). */
  saveRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Told whether there are unsaved changes, so that button can be enabled. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The tab to open on (a global search hit on a property value opens Properties). */
  initialTab?: "general" | "properties" | "rules";
}) {
  const updateNode = useUpdateNodeInstance();
  const nodeProps = useNodeInstanceProperties(node.node_id);
  const [tab, setTab] = useState<"general" | "properties" | "rules">(initialTab ?? "general");
  const [name, setName] = useState(node.name);
  const [status, setStatus] = useState<string>(node.status);
  const [error, setError] = useState<string | null>(null);
  const isRoot = !node.parent_node_id;
  const definition = useInstanceDefinition("node", node.model_id ?? modelId, node.node_type_id);

  // The state above already starts from this node; reset only when it changes
  // afterwards, so the first run does not undo initialTab.
  const shownFor = useRef(`${node.node_id}|${node.status}`);
  useEffect(() => {
    const key = `${node.node_id}|${node.status}`;
    if (shownFor.current === key) return;
    shownFor.current = key;
    setName(node.name);
    setStatus(node.status);
    setError(null);
    setTab("general");
  }, [node.node_id, node.status]);


  const nodeType = nodeTypes?.find((t) => t.id === node.node_type_id);
  const typeName = nodeType?.displayName || nodeType?.name || node.node_type_name || node.node_type_id;
  // A property node holds a value, not a level, so it takes no children.
  // The backend refuses one too; this only says so before the save has to.
  const isPropertyNode = nodeType?.isProperty ?? false;
  const modelWorkspaceUrl = node.model_id && node.node_type_id
    ? `/model/tree-models?kind=hierarchy&model=${encodeURIComponent(node.model_id)}&focus=${encodeURIComponent(node.node_type_id)}`
    : null;

  const dirty = (!isRoot && name.trim() !== node.name) || status !== node.status;
  const canSave = dirty && name.trim().length > 0 && !updateNode.isPending;
  useEffect(() => onDirtyChange?.(canSave), [canSave, onDirtyChange]);

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    try {
      await updateNode.mutateAsync({
        nodeId: node.node_id,
        modelId,
        payload: { name: isRoot ? node.name : name.trim(), ...(status !== node.status ? { status } : {}) },
      });
      onSaved(name);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Failed to update.");
    }
  }
  if (saveRef) saveRef.current = handleSave;

  const readOnlySx = { "& .MuiInputBase-root": { bgcolor: "action.hover" } };

  return (
    <Stack spacing={0} sx={{ height: "100%", maxWidth: "100%", display: "flex", flexDirection: "column" }}>
      {!embedded && (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pt: 2, pb: 1, flexShrink: 0 }}>
            <Typography variant="overline" color="text.secondary" fontSize={11} letterSpacing={1}>
              Node Instance
            </Typography>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={onDelete}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pb: 1, flexShrink: 0 }}>
            {node.name}
          </Typography>
        </>
      )}

      {/* Tabs — the MWS Node Type Details style: full width, sentence case. */}
      <Box sx={{ px: 2, pt: 1, flexShrink: 0 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: "divider", minHeight: 40, "& .MuiTab-root": { minHeight: 40, minWidth: 0, px: 1, textTransform: "none", fontWeight: 600 } }}
        >
          <Tab value="general" label="General" />
          <Tab value="properties" label="Properties" />
          {/* Governance binds here. A column mapped to this property is offered
              these checks in Discover, and nothing else from the library. */}
          <Tab value="rules" label="Rules" />
        </Tabs>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {tab === "general" && (
          <Stack spacing={2}>
            <Tooltip title={isRoot ? "The root node's name is kept in sync with the model name. Rename the model to change it." : ""} placement="top-start">
              <TextField
                fullWidth
                label="Name"
                value={isRoot ? node.name : name}
                onChange={(e) => setName(e.target.value)}
                disabled={isRoot}
                error={!isRoot && name.trim().length === 0}
                helperText={isRoot ? "Root node name is synced with the model." : name.trim().length === 0 ? "A name is required." : undefined}
              />
            </Tooltip>
            {/* Governed by the Node Type: read-only here, opens the definition in MWS. */}
            <TextField
              fullWidth
              label="Node Type"
              value={typeName}
              InputProps={{
                readOnly: true,
                endAdornment: modelWorkspaceUrl ? (
                  <InputAdornment position="end">
                    <Tooltip title="Open the Node Type in the Model Workspace">
                      <IconButton size="small" edge="end" component={Link} to={modelWorkspaceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the Node Type in the Model Workspace">
                        <OpenInNewOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : undefined,
              }}
              helperText="Defined in the Model Workspace — it governs this instance's properties and rules."
              sx={readOnlySx}
            />
            <InstanceStatusField value={status} current={node.status} definition={definition} onChange={setStatus} />
            {/* Read-only, as in MWS where it is set: a property of the Node Type. */}
            <Stack direction="row" spacing={0.5} alignItems="center">
              <FormControlLabel control={<Checkbox checked={isPropertyNode} disabled />} label="Is property node" sx={{ mr: 0 }} />
              <Tooltip
                title={
                  isPropertyNode
                    ? "This node holds a value rather than a level of the hierarchy, so nothing can be placed beneath it. The setting lives on the node type, in the Model Workspace."
                    : "A property node holds a value rather than a level of the hierarchy — Install Date is a property, Material is a level. Set it on the node type in the Model Workspace."
                }
              >
                <HelpOutlineOutlinedIcon sx={{ fontSize: 17, color: "text.disabled", cursor: "help" }} />
              </Tooltip>
            </Stack>
            <ReadOnlyIdField label="Node ID" value={node.node_id} helperText="System identifier — the node_instance_id used in import / export files." />
            {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
            {!embedded && (
              <Box>
                <Button size="small" variant="contained" onClick={() => void handleSave()} disabled={!canSave}>
                  {updateNode.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </Box>
            )}
            <Box>
              {isPropertyNode ? (
                <Tooltip title="A property node holds a value rather than a level of the hierarchy, so nothing can be placed beneath it.">
                  <Chip size="small" variant="outlined" label="Property node — no children" />
                </Tooltip>
              ) : (
                <Tooltip
                  title={
                    definition.status !== ACTIVE
                      ? `${definition.reason ?? "The definition is not Active"} — new instances can only be created from Active models and types.`
                      : node.status === "retired"
                        ? "This instance is Archived, so nothing new can be added beneath it."
                        : ""
                  }
                >
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={onAddChild}
                      disabled={definition.status !== ACTIVE || node.status === "retired"}
                    >
                      Child
                    </Button>
                  </span>
                </Tooltip>
              )}
            </Box>
          </Stack>
        )}
        {tab === "properties" && (
          <NodeInstancePropertiesPanel
            nodeInstanceId={node.node_id}
            instanceStatus={node.status}
            nodeTypeName={typeName}
            properties={nodeProps.data}
            isLoading={nodeProps.isLoading}
            isError={nodeProps.isError}
            modelWorkspaceUrl={modelWorkspaceUrl}
          />
        )}
        {tab === "rules" && (
          <PropertyRulesPanel nodeInstanceId={node.node_id} propertyName={node.name} />
        )}
      </Box>
    </Stack>
  );
}

// ── SD: Element instance inline editor ───────────────────────────────────────

export function SdInstanceEditor({
  inst,
  onDelete,
  onSaved,
  embedded,
}: {
  inst: ElementInstance;
  onDelete: () => void;
  onSaved: () => void;
  embedded?: boolean;
}) {
  const updateInst = useUpdateElementInstance();
  const elemProps = useElementInstanceProperties(inst.instance_id);
  const [tab, setTab] = useState<"general" | "properties">("general");
  const [name, setName] = useState(inst.name);
  const [description, setDescription] = useState(inst.description ?? "");
  const [status, setStatus] = useState<string>(inst.status);
  const [error, setError] = useState<string | null>(null);
  const definition = useInstanceDefinition("element", inst.support_domain_model_id, inst.element_type_id);

  useEffect(() => {
    setName(inst.name);
    setDescription(inst.description ?? "");
    setStatus(inst.status);
    setError(null);
    setTab("general");
  }, [inst.instance_id, inst.status]);

  async function handleSave() {
    setError(null);
    try {
      await updateInst.mutateAsync({ instanceId: inst.instance_id, payload: { name, description: description || null, ...(status !== inst.status ? { status } : {}) } });
      onSaved();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Failed to update.");
    }
  }

  const isDirty = name !== inst.name || description !== (inst.description ?? "");

  return (
    <Stack spacing={0} sx={{ height: "100%", maxWidth: "100%", display: "flex", flexDirection: "column" }}>
      {!embedded && (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pt: 2, pb: 1, flexShrink: 0 }}>
            <Typography variant="overline" color="text.secondary" fontSize={11} letterSpacing={1}>
              Element Instance
            </Typography>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={onDelete}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pb: 1, flexShrink: 0 }}>
            {inst.name}
          </Typography>
        </>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36, px: 1 }}>
          <Tab value="general" label="General" sx={{ minHeight: 36, py: 0.5, fontSize: 13 }} />
          <Tab value="properties" label="Properties" sx={{ minHeight: 36, py: 0.5, fontSize: 13 }} />
        </Tabs>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {tab === "general" && (
          <Stack spacing={2}>
            <TextField fullWidth size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField fullWidth size="small" label="Description" multiline minRows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary" sx={{ width: 80, flexShrink: 0 }}>Type</Typography>
              <Typography variant="body2" fontWeight={500}>{inst.element_type_name}</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary" sx={{ width: 80, flexShrink: 0 }}>Model</Typography>
              <Typography variant="body2" fontWeight={500}>{inst.support_domain_model_name}</Typography>
            </Stack>
            <InstanceStatusField value={status} current={inst.status} definition={definition} onChange={setStatus} />
            {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
            <Button
              size="small"
              variant="contained"
              onClick={handleSave}
              disabled={updateInst.isPending}
            >
              {updateInst.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </Stack>
        )}
        {tab === "properties" && (
          <PropertyValuesPanel
            properties={elemProps.data}
            isLoading={elemProps.isLoading}
            isError={elemProps.isError}
            kind="support-domain"
          />
        )}
      </Box>
    </Stack>
  );
}
