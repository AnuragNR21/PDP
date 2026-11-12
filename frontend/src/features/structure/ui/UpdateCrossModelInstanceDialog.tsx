import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  useActiveCrossModelRelationshipTypes,
  useDeleteCrossModelLink,
  useUpdateCrossModelLink,
} from "@/features/structure/state/useStructureWorkspace";
import type { CrossModelInstance } from "@/features/structure/api/structureApi";
import { getRelationshipColor } from "@/features/cross-model";

function Endpoint({ name, typeName, modelName }: { name: string; typeName: string; modelName: string }) {
  return (
    <Box minWidth={0}>
      <Typography variant="body2" fontWeight={600} noWrap>{name}</Typography>
      <Typography variant="caption" color="text.secondary" noWrap display="block">
        {typeName}{modelName ? ` · ${modelName}` : ""}
      </Typography>
    </Box>
  );
}

export function UpdateCrossModelInstanceDialog({
  open,
  link,
  sourceTypeId,
  targetTypeId,
  onClose,
}: {
  open: boolean;
  link: CrossModelInstance | null;
  /** Node/element TYPE ids of the two endpoints, used to filter allowed types. */
  sourceTypeId?: string;
  targetTypeId?: string;
  onClose: () => void;
}) {
  const [ruleId, setRuleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const governedTypesQuery = useActiveCrossModelRelationshipTypes();
  const updateLink = useUpdateCrossModelLink();
  const deleteLink = useDeleteCrossModelLink();

  // Same restriction the Matrix view applies per cell: a governed type is allowed
  // when it is unconstrained on a side, or constrained to that endpoint's type.
  const allowedTypes = useMemo(
    () => (governedTypesQuery.data ?? []).filter((gt) =>
      (gt.sourceModelItemTypeId === null || gt.sourceModelItemTypeId === sourceTypeId) &&
      (gt.targetModelItemTypeId === null || gt.targetModelItemTypeId === targetTypeId)
    ),
    [governedTypesQuery.data, sourceTypeId, targetTypeId],
  );

  useEffect(() => {
    if (!open) return;
    setRuleId(link?.relationship_rule_id ?? "");
    setError(null);
    setConfirmDelete(false);
  }, [open, link]);

  const isPending = updateLink.isPending || deleteLink.isPending;
  const unchanged = ruleId === link?.relationship_rule_id;

  // A link created before a type was constrained can sit outside the allowed set;
  // keep it selectable so the dialog reflects reality instead of silently blanking.
  const currentIsAllowed = allowedTypes.some((t) => t.id === link?.relationship_rule_id);
  const currentType = (governedTypesQuery.data ?? []).find((t) => t.id === link?.relationship_rule_id);

  async function handleSave() {
    if (!link || !ruleId) return;
    setError(null);
    try {
      await updateLink.mutateAsync({
        crossModelInstanceId: link.cross_model_instance_id,
        payload: { relationship_rule_id: ruleId },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update relationship.");
    }
  }

  async function handleDelete() {
    if (!link) return;
    setError(null);
    try {
      await deleteLink.mutateAsync({ crossModelInstanceId: link.cross_model_instance_id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove relationship.");
    }
  }

  return (
    <Dialog open={open && link !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Update Relationship</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {link && (
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Endpoint
                name={link.source_instance_name}
                typeName={link.source_type_name}
                modelName={link.source_model_name}
              />
              <ArrowForwardIcon sx={{ fontSize: 16, color: "text.disabled", flexShrink: 0 }} />
              <Endpoint
                name={link.target_instance_name}
                typeName={link.target_type_name}
                modelName={link.target_model_name}
              />
            </Stack>
          )}

          <TextField
            select
            label="Relationship type"
            value={ruleId}
            onChange={(event) => setRuleId(event.target.value)}
            size="small"
            fullWidth
            disabled={governedTypesQuery.isLoading}
            helperText="Only types the Model workspace allows for these two item types."
          >
            {!currentIsAllowed && currentType && (
              <MenuItem value={currentType.id}>
                <Box component="span" sx={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  bgcolor: getRelationshipColor(currentType.name), mr: 1,
                }} />
                {currentType.name} (current — no longer allowed)
              </MenuItem>
            )}
            {allowedTypes.map((type) => (
              <MenuItem key={type.id} value={type.id}>
                <Box component="span" sx={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  bgcolor: getRelationshipColor(type.name), mr: 1,
                }} />
                {type.name}
              </MenuItem>
            ))}
            {allowedTypes.length === 0 && !currentType && (
              <MenuItem disabled value="">
                <em>No governed types allow this pair</em>
              </MenuItem>
            )}
          </TextField>

          {confirmDelete && (
            <Alert severity="warning" action={
              <Button color="inherit" size="small" onClick={handleDelete} disabled={isPending}>
                {deleteLink.isPending ? <CircularProgress size={14} /> : "Confirm"}
              </Button>
            }>
              Remove this relationship?
            </Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        <Button
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => setConfirmDelete(true)}
          disabled={isPending || confirmDelete}
        >
          Remove
        </Button>
        <Box>
          <Button onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={isPending || unchanged || !ruleId}>
            {updateLink.isPending ? <CircularProgress size={16} /> : "Save"}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
