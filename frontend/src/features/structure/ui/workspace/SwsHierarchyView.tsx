import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  List,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { InlineEditTable } from "@/shared/workspace/InlineEditTable";
import { scrollToMarked, useFocusParam } from "@/shared/workspace/useFocusParam";
import { RelationshipDetailsList, type RelationshipDetailsGroup } from "@/shared/workspace/RelationshipDetailsList";
import { AuthoringPanel, WorkspaceBody } from "@/shared/workspace/WorkspacePanels";
import { DeleteAction, DuplicateAction, SaveAction } from "@/shared/workspace/WorkspaceIcons";
import { useToast } from "@/shared/toast/ToastContext";
import { uniqueCopyName } from "@/features/model/ui/workspace/HierarchyListView";
import {
  useAllCrossModelLinks,
  useCreateNodeInstance,
  useDeleteNodeInstance,
  useEnsureRootInstance,
  useHierarchyModels,
  useModelNodeInstances,
  useModelNodeTypes,
  useReorderNodeInstances,
  useUpdateNodeInstance,
  type NodeTreeItem,
} from "@/features/structure/state/useStructureWorkspace";
import { CreateEditNodeInstanceDialog } from "../CreateEditNodeInstanceDialog";
import { DeleteNodeInstanceDialog } from "../DeleteNodeInstanceDialog";
import { CanonicalBadge } from "../shared/CanonicalBadge";
import { HierarchyNodeInstanceEditor, TreeNode, flattenTree } from "./instanceEditors";
import { ACTIVE, ARCHIVED, LifecycleChip, lifecycleLabel } from "./lifecycle";

type ListRow = NodeTreeItem & { depth: number };

function withDepth(nodes: NodeTreeItem[], depth = 0): ListRow[] {
  return nodes.flatMap((node) => [{ ...node, depth }, ...withDepth(node.children, depth + 1)]);
}

function errorDetail(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? (error instanceof Error ? error.message : fallback);
}

/**
 * SWS › Model › a hierarchy model: its node instances.
 *
 * Hierarchy shows them as the tree they form — select one, + Child adds
 * beneath it, the arrows reorder it among its siblings. List shows every node
 * instance for editing where it stands. Both read the same selection, so
 * switching between them keeps your place.
 */
export function SwsHierarchyView({ modelId, view }: { modelId: string; view: "hierarchy" | "list" }) {
  const { showToast } = useToast();
  const nodeInstances = useModelNodeInstances(modelId);
  const nodeTypes = useModelNodeTypes(modelId);
  const ensureRoot = useEnsureRootInstance();
  const hierarchyModels = useHierarchyModels();
  const model = (hierarchyModels.data ?? []).find((item) => item.id === modelId);
  const modelActive = !model || model.status === ACTIVE;
  const createNode = useCreateNodeInstance();
  const updateNode = useUpdateNodeInstance();
  const deleteNode = useDeleteNodeInstance();
  const reorder = useReorderNodeInstances();
  const links = useAllCrossModelLinks();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [createUnder, setCreateUnder] = useState<NodeTreeItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NodeTreeItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Save lives in the details panel's toolbar, as in MWS Node Type Details.
  const saveInstanceRef = useRef<(() => Promise<void>) | null>(null);
  const [instanceDirty, setInstanceDirty] = useState(false);

  useEffect(() => {
    // The root is a new instance: only made once the model is Active (the server refuses otherwise).
    if (!model || model.status !== ACTIVE) return;
    ensureRoot.mutate(modelId);
  }, [modelId, model?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedId(null);
    setExpanded(new Set());
    setSearch("");
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const roots = nodeInstances.data ?? [];
  const flat = useMemo(() => flattenTree(roots), [roots]);
  const byId = useMemo(() => new Map(flat.map((node) => [node.node_id, node])), [flat]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  // Start on the root, and fall back to it when the selection is deleted.
  useEffect(() => {
    if (!nodeInstances.isSuccess) return;
    if (!selected && roots.length > 0) setSelectedId(roots[0].node_id);
  }, [nodeInstances.isSuccess, selected, roots]);

  // ?instance=<id> (from the global search): select that node, open its branch, show it.
  // ?panel=properties|rules comes with it and is read here, together with the
  // instance: read inside the editor it was taken by whichever node was shown
  // before the search's node got selected.
  const [focusInstance, consumeFocus] = useFocusParam("instance");
  const [focusPanelParam] = useFocusParam("panel");
  const [focusPanel, setFocusPanel] = useState<{ nodeId: string; tab: "properties" | "rules" } | null>(null);
  // Only for the arrival: once another node is picked, coming back opens General.
  useEffect(() => {
    if (focusPanel && selectedId !== focusPanel.nodeId) setFocusPanel(null);
  }, [selectedId, focusPanel]);
  useEffect(() => {
    if (!focusInstance || !nodeInstances.isSuccess) return;
    const node = byId.get(focusInstance);
    if (node) {
      setSearch("");
      setSelectedId(node.node_id);
      if (focusPanelParam === "properties" || focusPanelParam === "rules") setFocusPanel({ nodeId: node.node_id, tab: focusPanelParam });
      setExpanded((previous) => {
        if (previous.size === 0) return previous; // everything is open already
        const next = new Set(previous);
        for (let at = node.parent_node_id ? byId.get(node.parent_node_id) : undefined; at; at = at.parent_node_id ? byId.get(at.parent_node_id) : undefined) next.add(at.node_id);
        return next;
      });
      scrollToMarked("data-node-id", node.node_id);
    }
    consumeFocus("panel"); // one URL update for both: two would overwrite each other
  }, [focusInstance, nodeInstances.isSuccess, byId, consumeFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  const allIds = useMemo(() => new Set(flat.map((node) => node.node_id)), [flat]);
  const displayExpanded = nodeInstances.isSuccess && expanded.size === 0 ? allIds : expanded;
  const typeById = useMemo(() => new Map((nodeTypes.data ?? []).map((type) => [type.id, type])), [nodeTypes.data]);
  const isPropertyNode = (node: NodeTreeItem) => typeById.get(node.node_type_id)?.isProperty ?? false;

  // Lifecycle: a non-Active model takes no new instances, and any Draft or
  // Active instance under it is an invalid combination left from before.
  const invalidCount = modelActive ? 0 : flat.filter((node) => node.status !== ARCHIVED).length;
  const lifecycleBanner = !modelActive ? (
    <Alert severity={invalidCount > 0 ? "warning" : "info"} sx={{ borderRadius: 0, py: 0.25 }}>
      Model “{model?.name}” is {lifecycleLabel(model?.status)} in the Model Workspace, so no new instances can be created here.
      {invalidCount > 0 && ` ${invalidCount} instance${invalidCount === 1 ? " is" : "s are"} still Draft or Active, which is not valid under a ${lifecycleLabel(model?.status)} model — archive ${invalidCount === 1 ? "it" : "them"} here, or activate the model in the Model Workspace.`}
    </Alert>
  ) : null;


  const siblingsOf = (node: NodeTreeItem) => (node.parent_node_id ? byId.get(node.parent_node_id)?.children ?? [] : roots);
  const move = async (node: NodeTreeItem, offset: -1 | 1) => {
    if (!node.parent_node_id) return;
    const siblings = siblingsOf(node).map((item) => item.node_id);
    const index = siblings.indexOf(node.node_id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    try {
      await reorder.mutateAsync({ modelId, parentNodeId: node.parent_node_id, orderedChildIds: siblings });
    } catch (error) {
      showToast(errorDetail(error, "Could not reorder."), "error");
    }
  };

  const duplicate = async (node: NodeTreeItem) => {
    if (!node.parent_node_id) return;
    try {
      const siblings = siblingsOf(node).map((item) => item.name);
      const created = await createNode.mutateAsync({
        model_id: modelId,
        node_type_id: node.node_type_id,
        parent_node_id: node.parent_node_id,
        name: uniqueCopyName(node.name, siblings),
      });
      setSelectedId(created.node.node_id);
      showToast("Node instance duplicated.");
    } catch (error) {
      showToast(errorDetail(error, "Could not duplicate."), "error");
    }
  };

  const rename = async (node: NodeTreeItem, draft: Record<string, string>) => {
    const name = (draft.name ?? "").trim();
    if (!name) {
      showToast("A node instance needs a name.", "error");
      return false;
    }
    try {
      await updateNode.mutateAsync({ nodeId: node.node_id, modelId, payload: { name } });
      showToast("Node instance updated.");
      return true;
    } catch (error) {
      showToast(errorDetail(error, "Could not update."), "error");
      return false;
    }
  };

  const relationshipGroups = (node: NodeTreeItem): RelationshipDetailsGroup[] => {
    const parent = node.parent_node_id ? byId.get(node.parent_node_id) : undefined;
    const related = (links.data ?? []).filter((link) => link.source_instance_id === node.node_id || link.target_instance_id === node.node_id);
    return [
      {
        title: "Hierarchy — inherited from the model",
        items: [
          ...(parent ? [{ key: `p:${parent.node_id}`, label: parent.name, relation: "parent", direction: "in" as const, secondary: parent.node_type_name, onClick: () => setSelectedId(parent.node_id) }] : []),
          ...node.children.map((child) => ({
            key: `c:${child.node_id}`,
            label: child.name,
            relation: "child",
            direction: "out" as const,
            secondary: child.node_type_name,
            onClick: () => setSelectedId(child.node_id),
          })),
        ],
      },
      {
        title: "Relationships — other models",
        items: related.map((link) => {
          const outgoing = link.source_instance_id === node.node_id;
          return {
            key: link.cross_model_instance_id,
            label: outgoing ? link.target_instance_name : link.source_instance_name,
            secondary: outgoing ? `${link.target_model_name} › ${link.target_type_name}` : `${link.source_model_name} › ${link.source_type_name}`,
            direction: outgoing ? ("out" as const) : ("in" as const),
          };
        }),
      },
    ];
  };

  const loading = nodeInstances.isLoading || nodeTypes.isLoading;

  const tree = (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      {lifecycleBanner}
      <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search node instances…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
      </Box>
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {loading && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading instances…</Typography>
          </Stack>
        )}
        {nodeInstances.isError && <Alert severity="error" sx={{ m: 2 }}>Could not load node instances.</Alert>}
        {nodeInstances.isSuccess && roots.length === 0 && (
          <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>No node instances yet.</Typography>
        )}
        <List dense disablePadding>
          {roots.map((root) => (
            <TreeNode
              key={root.node_id}
              node={root}
              depth={0}
              expandedIds={displayExpanded}
              selectedId={selectedId}
              onToggle={(id) =>
                setExpanded((previous) => {
                  const next = new Set(previous.size === 0 ? allIds : previous);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onSelect={(node) => setSelectedId(node.node_id)}
              onDelete={(node) => {
                setDeleteError(null);
                setDeleteTarget(node);
              }}
              onAddChild={(node) => setCreateUnder(node)}
              canAddChild={(node) => modelActive && node.status !== ARCHIVED && !isPropertyNode(node)}
              searchText={search}
              nodeTypes={nodeTypes.data}
            />
          ))}
        </List>
      </Box>
    </Stack>
  );

  const selectedSiblings = selected ? siblingsOf(selected) : [];
  const selectedIndex = selected ? selectedSiblings.findIndex((item) => item.node_id === selected.node_id) : -1;
  const hierarchyToolbar = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Tooltip
        title={
          !modelActive
            ? `Model “${model?.name}” is ${lifecycleLabel(model?.status)} in the Model Workspace — new instances can only be created from Active models.`
            : selected?.status === ARCHIVED
              ? "The selected instance is Archived, so nothing new can be added beneath it."
              : ""
        }
      >
        <span>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!selected || isPropertyNode(selected) || !modelActive || selected.status === ARCHIVED}
            onClick={() => selected && setCreateUnder(selected)}
          >
            Child
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="Move up">
        <span>
          <IconButton size="small" aria-label="Move up" disabled={!selected?.parent_node_id || selectedIndex <= 0 || reorder.isPending} onClick={() => selected && void move(selected, -1)}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Move down">
        <span>
          <IconButton
            size="small"
            aria-label="Move down"
            disabled={!selected?.parent_node_id || selectedIndex < 0 || selectedIndex >= selectedSiblings.length - 1 || reorder.isPending}
            onClick={() => selected && void move(selected, 1)}
          >
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );

  const listRows = useMemo(() => withDepth(roots), [roots]);
  const list = (
    <InlineEditTable<ListRow>
      rows={listRows}
      getId={(row) => row.node_id}
      getLabel={(row) => row.name}
      draftOf={(row) => ({ name: row.name })}
      onSave={rename}
      onDuplicate={(row) => void duplicate(row)}
      onDelete={(row) => {
        setDeleteError(null);
        setDeleteTarget(row);
      }}
      canDelete={(row) => Boolean(row.parent_node_id)}
      selectedId={selectedId}
      onRowClick={(row) => setSelectedId(row.node_id)}
      emptyText={loading ? "Loading instances…" : "No node instances yet."}
      searchPlaceholder="Search node instances…"
      columns={[
        {
          key: "name",
          label: "Node Instance",
          render: (row) => (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: row.depth * 2.5 }}>
              <CanonicalBadge badge={typeById.get(row.node_type_id)?.badge} fallbackText={row.name} size={22} />
              <Typography variant="body2" fontWeight={600}>{row.name}</Typography>
            </Stack>
          ),
          // The root instance carries the model's name.
          editor: (row) => ({ field: "name", disabled: !row.parent_node_id }),
          value: (row) => row.name,
        },
        { key: "type", label: "Node Type", filter: true, render: (row) => row.node_type_name || "—" },
        { key: "parent", label: "Parent", render: (row) => (row.parent_node_id ? byId.get(row.parent_node_id)?.name ?? "—" : "—") },
        { key: "status", label: "Status", width: 110, filter: true, render: (row) => <LifecycleChip status={row.status} showActive />, value: (row) => lifecycleLabel(row.status) },
      ]}
    />
  );

  return (
    <>
      <WorkspaceBody
        storageKey={view === "list" ? "sws-hierarchy-list" : "sws-hierarchy"}
        authoring={
          view === "list" ? (
            <AuthoringPanel title="Hierarchy List Workspace" hint="Every node instance in the selected hierarchy model — edit, duplicate and delete in line.">
              {lifecycleBanner}
              {list}
            </AuthoringPanel>
          ) : (
            <AuthoringPanel
              title="Hierarchy Authoring Workspace"
              hint="“Parent of” instance relationships are created automatically, as the Hierarchy Model's node type relationships allow"
              toolbar={hierarchyToolbar}
              flush
            >
              {tree}
            </AuthoringPanel>
          )
        }
        element={
          view === "list"
            ? undefined
            : {
                title: "Node Instance Details",
                isEmpty: !selected,
                empty: "Select a node instance in the hierarchy.",
                flush: true,
                actions: selected ? (
                  <Stack direction="row">
                    <SaveAction label={selected.name} disabled={!instanceDirty} onClick={() => void saveInstanceRef.current?.()} />
                    {selected.parent_node_id && <DuplicateAction label={selected.name} onClick={() => void duplicate(selected)} />}
                    {selected.parent_node_id && <DeleteAction label={selected.name} onClick={() => { setDeleteError(null); setDeleteTarget(selected); }} />}
                  </Stack>
                ) : undefined,
                content: selected && (
                  <HierarchyNodeInstanceEditor
                    key={selected.node_id}
                    embedded
                    node={selected}
                    nodeTypes={nodeTypes.data}
                    modelId={modelId}
                    onDelete={() => { setDeleteError(null); setDeleteTarget(selected); }}
                    onAddChild={() => setCreateUnder(selected)}
                    onSaved={() => undefined}
                    saveRef={saveInstanceRef}
                    onDirtyChange={setInstanceDirty}
                    initialTab={focusPanel?.nodeId === selected.node_id ? focusPanel.tab : undefined}
                  />
                ),
              }
        }
        relationship={
          view === "list"
            ? undefined
            : {
                title: "Relationship Details",
                isEmpty: !selected,
                empty: "Select a node instance to see its immediate relationships.",
                content: selected && <RelationshipDetailsList groups={relationshipGroups(selected)} loading={links.isLoading} />,
              }
        }
      />
      <CreateEditNodeInstanceDialog
        open={createUnder !== null}
        modelId={modelId}
        dialogMode="create"
        parentNode={createUnder}
        onClose={() => setCreateUnder(null)}
        onDone={() => {
          if (createUnder) setExpanded((previous) => (previous.size === 0 ? previous : new Set(previous).add(createUnder.node_id)));
          setCreateUnder(null);
        }}
      />
      <DeleteNodeInstanceDialog
        nodeId={deleteTarget?.node_id ?? null}
        nodeName={deleteTarget?.name ?? "Node instance"}
        deleting={deleteNode.isPending}
        actionError={deleteError}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError(null);
          try {
            await deleteNode.mutateAsync({ nodeId: deleteTarget.node_id, modelId });
            if (selectedId === deleteTarget.node_id) setSelectedId(deleteTarget.parent_node_id ?? null);
            setDeleteTarget(null);
          } catch (error) {
            setDeleteError(errorDetail(error, "Failed to delete node instance."));
          }
        }}
      />
    </>
  );
}
