import { lifecycleLabel } from "./workspace/lifecycle";
import { useEffect, useState } from "react";
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
} from "@mui/material";
import {
  useCreateElementInstance,
  useSupportDomainElementTypes,
  useUpdateElementInstance,
} from "@/features/structure/state/useStructureWorkspace";
import type { ElementInstance } from "@/features/structure/api/structureApi";

type SupportDomainModelSummary = { id: string; name: string; status?: string };

type CreateProps = {
  dialogMode: "create";
  open: boolean;
  supportDomainModels: SupportDomainModelSummary[];
  initialModelId?: string;
  initialTypeId?: string;
  onClose: () => void;
  onDone: () => void;
};

type EditProps = {
  dialogMode: "edit";
  open: boolean;
  instance: ElementInstance;
  onClose: () => void;
  onDone: () => void;
};

type Props = CreateProps | EditProps;

export function CreateEditElementInstanceDialog(props: Props) {
  const { dialogMode, open, onClose, onDone } = props;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [elementTypeId, setElementTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createInstance = useCreateElementInstance();
  const updateInstance = useUpdateElementInstance();

  // Load element types for selected SD model (create mode only)
  const elementTypesQuery = useSupportDomainElementTypes(
    dialogMode === "create" && selectedModelId ? selectedModelId : null
  );

  const isPending = createInstance.isPending || updateInstance.isPending;

  useEffect(() => {
    if (open) {
      setError(null);
      if (dialogMode === "edit") {
        setName(props.instance.name);
        setDescription(props.instance.description ?? "");
        setSelectedModelId(props.instance.support_domain_model_id);
        setElementTypeId(props.instance.element_type_id);
      } else {
        setName("");
        setDescription("");
        const cp = props as CreateProps;
        const firstModel = cp.supportDomainModels[0];
        setSelectedModelId(cp.initialModelId ?? firstModel?.id ?? "");
        setElementTypeId(cp.initialTypeId ?? "");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dialogMode]);

  // Reset element type when model changes — but not if an initial type was pre-selected for the same model
  const initialModelId = dialogMode === "create" ? (props as CreateProps).initialModelId : undefined;
  useEffect(() => {
    if (dialogMode === "create" && selectedModelId !== initialModelId) setElementTypeId("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, dialogMode]);

  async function handleSubmit() {
    setError(null);
    try {
      if (dialogMode === "create") {
        await createInstance.mutateAsync({
          support_domain_model_id: selectedModelId,
          element_type_id: elementTypeId,
          name: name.trim(),
          description: description.trim() || null,
        });
      } else {
        const inst = (props as EditProps).instance;
        await updateInstance.mutateAsync({
          instanceId: inst.instance_id,
          payload: { name: name.trim(), description: description.trim() || null },
        });
      }
      onDone();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Failed to save. Please try again.");
    }
  }

  const title = dialogMode === "create" ? "Add Element Instance" : "Edit Element Instance";
  const submitLabel = dialogMode === "create" ? "Create" : "Save";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {dialogMode === "create" && (
            <TextField
              select
              label="Support Domain Model"
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              fullWidth
              size="small"
            >
              {(props as CreateProps).supportDomainModels.map((m) => (
                // Lifecycle: instances only from Active models.
                <MenuItem key={m.id} value={m.id} disabled={Boolean(m.status && m.status !== "active")}>
                  {m.name}{m.status && m.status !== "active" ? ` — ${lifecycleLabel(m.status)}` : ""}
                </MenuItem>
              ))}
            </TextField>
          )}
          {dialogMode === "create" && (
            elementTypesQuery.isLoading ? (
              <CircularProgress size={20} />
            ) : (
              <TextField
                select
                label="Element Type"
                value={elementTypeId}
                onChange={(e) => setElementTypeId(e.target.value)}
                fullWidth
                size="small"
                disabled={!selectedModelId || (elementTypesQuery.data ?? []).length === 0}
              >
                {(elementTypesQuery.data ?? []).map((et) => (
                  // Lifecycle: instances only from Active element types.
                  <MenuItem key={et.id} value={et.id} disabled={et.status !== "active"}>
                    {et.name}{et.status !== "active" ? ` — ${lifecycleLabel(et.status)}` : ""}
                  </MenuItem>
                ))}
              </TextField>
            )
          )}
          {dialogMode === "edit" && (
            <>
              <TextField
                label="Support Domain Model"
                value={(props as EditProps).instance.support_domain_model_name}
                disabled
                fullWidth
                size="small"
              />
              <TextField
                label="Element Type"
                value={(props as EditProps).instance.element_type_name}
                disabled
                fullWidth
                size="small"
              />
            </>
          )}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isPending || !name.trim() || (dialogMode === "create" && (!selectedModelId || !elementTypeId))}
        >
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

