import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import {
  structureApi,
  type SupportDomainModelGovernedDeleteImpact,
} from "@/features/structure/api/structureApi";
import { CrossModelDeleteImpactList } from "@/shared/components/CrossModelDeleteImpactList";

export function DeleteSupportDomainModelDialog(props: {
  modelId: string | null;
  modelName: string;
  deleting?: boolean;
  actionError?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = props.modelId !== null;
  const [impact, setImpact] = useState<SupportDomainModelGovernedDeleteImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !props.modelId) {
      setImpact(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    structureApi
      .getSupportDomainModelDeleteImpact(props.modelId)
      .then(setImpact)
      .catch(() => setError("Could not load governed delete impact. Please try again."))
      .finally(() => setLoading(false));
  }, [open, props.modelId]);

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>Governed Delete Support Domain Model</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You are about to permanently delete <strong>&ldquo;{props.modelName}&rdquo;</strong>.
          This will remove the Support Domain model from Structure Workspace and Model Workspace.
        </DialogContentText>

        {loading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading governed delete impact...</Typography>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}
        {!error && props.actionError && <Alert severity="error">{props.actionError}</Alert>}

        {impact && !loading && (
          <>
            <Alert severity="warning">
              This action will delete {impact.element_count} element type{impact.element_count === 1 ? "" : "s"} and {impact.instance_count} structure element instance{impact.instance_count === 1 ? "" : "s"}.
            </Alert>

            <CrossModelDeleteImpactList relationships={impact.cross_model_relationship_impact.impact_list_items} />

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Structure element instances that will be deleted
              <Chip label={impact.element_instances.length} size="small" color="error" sx={{ ml: 1 }} />
            </Typography>
            <List dense disablePadding>
              {impact.element_instances.map((instance) => (
                <ListItem key={instance.instance_id} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={instance.instance_path}
                    secondary={`Element type: ${instance.element_type_name}`}
                  />
                </ListItem>
              ))}
            </List>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Model Workspace element types that will be deleted
              <Chip label={impact.elements.length} size="small" color="warning" sx={{ ml: 1 }} />
            </Typography>
            <List dense disablePadding>
              {impact.elements.map((element) => (
                <ListItem key={element.element_id} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={element.name}
                    secondary={element.display_name ? `Display name: ${element.display_name}` : undefined}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={props.deleting}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          onClick={props.onConfirm}
          disabled={loading || !!error || props.deleting}
        >
          Delete Support Domain Model
        </Button>
      </DialogActions>
    </Dialog>
  );
}
