import AddOutlined from "@mui/icons-material/AddOutlined";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlined from "@mui/icons-material/DeleteOutlineOutlined";
import SaveOutlined from "@mui/icons-material/SaveOutlined";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { UNTITLED_DIAGRAM_NAME, type SaveDiagramInput, type SavedDiagram, type SavedDiagramApi } from "@/features/cross-model";

const NONE = "__none__";

function formatWhen(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Diagram management for the Relationship diagram: pick a saved diagram, start a
 * new one, duplicate or delete the open one, and name it. Every change on the
 * canvas is written back to the open diagram on its own (see useSavedDiagramSync).
 */
export function DiagramPicker(props: {
  api: SavedDiagramApi;
  queryKey: readonly unknown[];
  currentDiagramId: string | null;
  currentDiagramName: string | null;
  /** The canvas as it stands, for Save / Duplicate. */
  buildInput: (name: string) => SaveDiagramInput;
  canvasItemCount: number;
  onLoad: (diagram: SavedDiagram) => void;
  onNew: () => void;
  onSaved: (diagram: SavedDiagram) => void;
  onDuplicated: (fromId: string | null, diagram: SavedDiagram) => void;
  onDeleted: (id: string) => void;
  status?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: props.queryKey, queryFn: props.api.list });
  const diagrams = listQuery.data ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: props.queryKey });
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const create = useMutation({ mutationFn: props.api.create });
  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: SaveDiagramInput }) => props.api.update(id, input) });
  const remove = useMutation({ mutationFn: props.api.remove });
  const busy = create.isPending || update.isPending || remove.isPending;

  const load = async (id: string) => {
    setLoadingId(id);
    try {
      props.onLoad(await props.api.get(id));
    } finally {
      setLoadingId(null);
    }
  };

  const duplicate = async () => {
    const base = props.currentDiagramName?.trim() || UNTITLED_DIAGRAM_NAME;
    const taken = new Set(diagrams.map((d) => d.name));
    let copyName = `${base} (copy)`;
    for (let n = 2; taken.has(copyName); n += 1) copyName = `${base} (copy ${n})`;
    const diagram = await create.mutateAsync(props.buildInput(copyName));
    invalidate();
    props.onDuplicated(props.currentDiagramId, diagram);
  };

  const save = async (asNew: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const diagram =
      !asNew && props.currentDiagramId
        ? await update.mutateAsync({ id: props.currentDiagramId, input: props.buildInput(trimmed) })
        : await create.mutateAsync(props.buildInput(trimmed));
    invalidate();
    setSaveOpen(false);
    if (asNew && props.currentDiagramId) props.onDuplicated(props.currentDiagramId, diagram);
    else props.onSaved(diagram);
  };

  const confirmDelete = async () => {
    const id = props.currentDiagramId;
    if (!id) return;
    await remove.mutateAsync(id);
    invalidate();
    setDeleteOpen(false);
    props.onDeleted(id);
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.75}>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        Diagram:
      </Typography>
      <Select
        size="small"
        value={props.currentDiagramId ?? NONE}
        onChange={(event) => {
          const id = event.target.value;
          if (id !== NONE && id !== props.currentDiagramId) void load(id);
        }}
        renderValue={(value) =>
          value === NONE ? (
            <Typography component="span" sx={{ fontSize: 13, color: "text.secondary", fontStyle: "italic" }}>
              New diagram (not saved yet)
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} alignItems="center" component="span">
              <span>{props.currentDiagramName ?? diagrams.find((d) => d.id === value)?.name ?? "Diagram"}</span>
              {loadingId && <CircularProgress size={12} />}
            </Stack>
          )
        }
        sx={{ minWidth: 240, maxWidth: 320, fontSize: 13, "& .MuiSelect-select": { py: 0.6 } }}
        MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}
        aria-label="Diagram"
      >
        <MenuItem value={NONE} disabled sx={{ display: "none" }}>
          New diagram
        </MenuItem>
        {diagrams.length === 0 && (
          <MenuItem disabled value="__empty__">
            {listQuery.isLoading ? "Loading…" : "No saved diagrams yet"}
          </MenuItem>
        )}
        {diagrams.map((diagram) => (
          <MenuItem key={diagram.id} value={diagram.id} sx={{ display: "block", py: 0.75 }}>
            <Typography variant="body2" noWrap>{diagram.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {diagram.nodeCount} item{diagram.nodeCount === 1 ? "" : "s"} · updated {formatWhen(diagram.updatedAt)}
            </Typography>
          </MenuItem>
        ))}
      </Select>
      <Button size="small" variant="outlined" startIcon={<AddOutlined />} onClick={props.onNew} disabled={busy}>
        New
      </Button>
      <Tooltip title={props.canvasItemCount === 0 ? "Nothing on the canvas to duplicate" : "Save a copy of this diagram and open it"}>
        <span>
          <Button size="small" variant="outlined" startIcon={<ContentCopyOutlined />} onClick={() => void duplicate()} disabled={busy || props.canvasItemCount === 0}>
            Duplicate
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={props.currentDiagramId ? "Delete this diagram (the types and relationships on it stay)" : "This diagram has not been saved"}>
        <span>
          <Button size="small" variant="outlined" color="error" startIcon={<DeleteOutlineOutlined />} onClick={() => setDeleteOpen(true)} disabled={busy || !props.currentDiagramId}>
            Delete
          </Button>
        </span>
      </Tooltip>
      <Button
        size="small"
        variant="contained"
        startIcon={<SaveOutlined />}
        disabled={busy || props.canvasItemCount === 0}
        onClick={() => {
          setName(props.currentDiagramName ?? "");
          setSaveOpen(true);
        }}
      >
        Save
      </Button>
      {props.status}

      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save diagram</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Diagram name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={{ mt: 1 }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim() && !busy) {
                event.preventDefault();
                void save(false);
              }
            }}
          />
          {props.currentDiagramId && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              Rename and update this diagram, or save the canvas as a new one.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)} disabled={busy}>Cancel</Button>
          {props.currentDiagramId && (
            <Button onClick={() => void save(true)} disabled={!name.trim() || busy}>
              Save as new
            </Button>
          )}
          <Button variant="contained" onClick={() => void save(false)} disabled={!name.trim() || busy}>
            {props.currentDiagramId ? "Update" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete diagram?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            “{props.currentDiagramName ?? "This diagram"}” will be deleted. Only the diagram goes — the node types, element types and relationships on it are not changed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={busy}>
            Delete diagram
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
