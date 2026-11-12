import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import BookmarkBorderOutlinedIcon from "@mui/icons-material/BookmarkBorderOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import type { SaveDiagramInput, SavedDiagram, SavedDiagramApi, SavedDiagramEdge, SavedDiagramNode, SavedDiagramShape } from "../domain/savedDiagram";

function formatWhen(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export type SavedDiagramsBarProps = {
  api: SavedDiagramApi;
  /** react-query cache key for the saved-diagram list (keep distinct per workspace). */
  queryKey: readonly unknown[];
  canvasItemCount: number;
  getSaveNodes: () => SavedDiagramNode[];
  /** Per-connection line-style overrides to persist alongside the nodes. */
  getSaveEdges: () => SavedDiagramEdge[];
  /** Drawn annotations to persist; omitted on workspaces that don't offer them. */
  getSaveShapes?: () => SavedDiagramShape[];
  currentDiagramId: string | null;
  currentDiagramName: string | null;
  onLoad: (diagram: SavedDiagram) => void;
  onSaved: (diagram: SavedDiagram) => void;
  onClear: () => void;
  onDeleted: (id: string) => void;
};

export function SavedDiagramsBar({
  api,
  queryKey,
  canvasItemCount,
  getSaveNodes,
  getSaveEdges,
  getSaveShapes,
  currentDiagramId,
  currentDiagramName,
  onLoad,
  onSaved,
  onClear,
  onDeleted,
}: SavedDiagramsBarProps) {
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey, queryFn: api.list });
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const invalidateList = () => void queryClient.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: api.create,
    onSuccess: (diagram) => { invalidateList(); onSaved(diagram); setSaveOpen(false); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SaveDiagramInput }) =>
      api.update(id, input),
    onSuccess: (diagram) => { invalidateList(); onSaved(diagram); setSaveOpen(false); },
  });
  const deleteMutation = useMutation({
    mutationFn: api.remove,
    onSuccess: (_result, id) => { invalidateList(); onDeleted(id); },
  });

  const diagrams = listQuery.data ?? [];
  const saving = createMutation.isPending || updateMutation.isPending;
  const trimmedName = name.trim();

  async function handleLoad(id: string) {
    setLoadingId(id);
    try {
      const diagram = await api.get(id);
      onLoad(diagram);
      setMenuAnchor(null);
    } finally {
      setLoadingId(null);
    }
  }

  function openSave() {
    setName(currentDiagramName ?? "");
    setSaveOpen(true);
  }

  function buildInput(): SaveDiagramInput {
    return { name: trimmedName, nodes: getSaveNodes(), edges: getSaveEdges(), shapes: getSaveShapes?.() ?? [] };
  }

  function saveAsNew() {
    if (trimmedName) createMutation.mutate(buildInput());
  }

  function updateExisting() {
    if (trimmedName && currentDiagramId) {
      updateMutation.mutate({ id: currentDiagramId, input: buildInput() });
    }
  }

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Button
        size="small"
        variant="outlined"
        startIcon={<BookmarkBorderOutlinedIcon />}
        onClick={(event) => setMenuAnchor(event.currentTarget)}
      >
        Saved diagrams{diagrams.length > 0 ? ` (${diagrams.length})` : ""}
      </Button>
      <Button
        size="small"
        variant="contained"
        startIcon={<SaveOutlinedIcon />}
        disabled={canvasItemCount === 0}
        onClick={openSave}
      >
        Save
      </Button>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { onClear(); setMenuAnchor(null); }}>
          <AddIcon sx={{ fontSize: 18, mr: 1 }} /> New diagram
        </MenuItem>
        <Divider />
        {listQuery.isLoading && (
          <MenuItem disabled>
            <CircularProgress size={16} sx={{ mr: 1 }} /> Loading…
          </MenuItem>
        )}
        {!listQuery.isLoading && diagrams.length === 0 && (
          <MenuItem disabled>No saved diagrams yet</MenuItem>
        )}
        {diagrams.map((diagram) => (
          <MenuItem
            key={diagram.id}
            selected={diagram.id === currentDiagramId}
            onClick={() => void handleLoad(diagram.id)}
            sx={{ gap: 1, minWidth: 280 }}
          >
            <Box sx={{ width: 20, display: "flex", justifyContent: "center", flexShrink: 0 }}>
              {diagram.id === currentDiagramId && <CheckIcon color="primary" sx={{ fontSize: 16 }} />}
              {loadingId === diagram.id && <CircularProgress size={14} />}
            </Box>
            <Box flex={1} minWidth={0}>
              <Typography variant="body2" noWrap>{diagram.name}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {diagram.nodeCount} item{diagram.nodeCount !== 1 ? "s" : ""} · updated {formatWhen(diagram.updatedAt)}
              </Typography>
            </Box>
            <IconButton
              size="small"
              edge="end"
              disabled={deleteMutation.isPending}
              onClick={(event) => { event.stopPropagation(); deleteMutation.mutate(diagram.id); }}
            >
              <DeleteOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </MenuItem>
        ))}
      </Menu>

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
              if (event.key === "Enter" && trimmedName && !saving) {
                event.preventDefault();
                if (currentDiagramId) updateExisting();
                else saveAsNew();
              }
            }}
          />
          {currentDiagramId && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              Update the current diagram, or save the canvas as a new diagram.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)} disabled={saving}>Cancel</Button>
          {currentDiagramId && (
            <Button onClick={updateExisting} disabled={!trimmedName || saving}>
              {updateMutation.isPending ? <CircularProgress size={16} /> : "Update"}
            </Button>
          )}
          <Button variant="contained" onClick={saveAsNew} disabled={!trimmedName || saving}>
            {createMutation.isPending ? <CircularProgress size={16} /> : currentDiagramId ? "Save as new" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
