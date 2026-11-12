import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
} from "@mui/material";
import {
  useCreateNodeInstance,
  useUpdateNodeInstance,
  useModelNodeTypes,
  type NodeTreeItem,
} from "@/features/structure/state/useStructureWorkspace";

export type CreateNodeMode = "child";

type CreateProps = {
  dialogMode: "create";
  parentNode: NodeTreeItem | null;
  editNode?: never;
};

type EditProps = {
  dialogMode: "edit";
  editNode: NodeTreeItem;
  mode?: never;
  parentNode?: never;
};

type Props = (CreateProps | EditProps) & {
  open: boolean;
  modelId: string;
  onClose: () => void;
  onDone: () => void;
};

export function CreateEditNodeInstanceDialog({
  open,
  modelId,
  onClose,
  onDone,
  ...modeProps
}: Props) {
  const nodeTypes = useModelNodeTypes(modelId);
  const createNode = useCreateNodeInstance();
  const updateNode = useUpdateNodeInstance();

  const isEdit = modeProps.dialogMode === "edit";
  const editNode = isEdit ? modeProps.editNode : null;

  const [form, setForm] = useState({ node_type_id: "", name: "" });
  const [error, setError] = useState<string | null>(null);

  // Populate form when opening in edit mode
  useEffect(() => {
    if (open && isEdit && editNode) {
      setForm({ node_type_id: editNode.node_type_id, name: editNode.name });
    } else if (open && !isEdit) {
      setForm({ node_type_id: "", name: "" });
    }
    setError(null);
  }, [open, isEdit, editNode?.node_id]);

  const allowedNodeTypes = useMemo(() => {
    const allTypes = nodeTypes.data ?? [];
    if (isEdit) return allTypes;
    // Lifecycle: new instances only from Active node types.
    const activeTypes = allTypes.filter((t) => t.status === "active");
    const parentNode = !isEdit ? modeProps.parentNode : null;
    if (!parentNode) return activeTypes;
    return activeTypes.filter(
      (t) =>
        t.parentNodeId === parentNode.node_type_id ||
        (t.id === parentNode.node_type_id && t.isRecursive),
    );
  }, [nodeTypes.data, isEdit, !isEdit ? modeProps.parentNode?.node_id : null]);

  function handleClose() {
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && editNode) {
        await updateNode.mutateAsync({
          nodeId: editNode.node_id,
          modelId,
          payload: { name: form.name },
        });
      } else {
        const parentNode = !isEdit ? modeProps.parentNode : null;
        await createNode.mutateAsync({
          model_id: modelId,
          node_type_id: form.node_type_id,
          name: form.name,
          parent_node_id: parentNode?.node_id ?? null,
        });
      }
      onDone();
      handleClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? (isEdit ? "Failed to update node instance." : "Failed to create node instance."));
    }
  }

  const isPending = createNode.isPending || updateNode.isPending;

  const title = isEdit
    ? `Edit Node Instance: ${editNode?.name ?? ""}`
    : `Add Child Node Instance${modeProps.parentNode ? ` to: ${modeProps.parentNode.name}` : ""}`;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} component="form" id="node-instance-form" onSubmit={handleSubmit} sx={{ pt: 1 }}>
          {nodeTypes.isLoading ? (
            <CircularProgress size={24} />
          ) : (
            <TextField
              select
              label="Node type"
              size="small"
              value={form.node_type_id}
              onChange={(e) => setForm((f) => ({ ...f, node_type_id: e.target.value }))}
              required
              fullWidth
              disabled={isEdit}
              helperText={isEdit ? "Node type cannot be changed." : undefined}
            >
              {allowedNodeTypes.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.displayName || t.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Tooltip
            title={isEdit && !editNode?.parent_node_id ? "The root node instance name is always kept in sync with the model name. Rename the model to change it." : ""}
            placement="top-start"
          >
            <TextField
              label="Name"
              size="small"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              fullWidth
              autoFocus={isEdit}
              disabled={isEdit && !editNode?.parent_node_id}
            />
          </Tooltip>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="node-instance-form"
          variant="contained"
          disabled={isPending}
        >
          {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save Changes" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
