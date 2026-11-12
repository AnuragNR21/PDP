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
  type SupportDomainElementInstanceGovernedDeleteImpact,
} from "@/features/structure/api/structureApi";
import { CrossModelDeleteImpactList } from "@/shared/components/CrossModelDeleteImpactList";

export function DeleteElementInstanceDialog(props: {
  instanceId: string | null;
  instanceName: string;
  deleting?: boolean;
  actionError?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = props.instanceId !== null;
  const [impact, setImpact] = useState<SupportDomainElementInstanceGovernedDeleteImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !props.instanceId) {
      setImpact(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    structureApi
      .getElementInstanceDeleteImpact(props.instanceId)
      .then(setImpact)
      .catch(() => setError("Could not load governed delete impact. Please try again."))
      .finally(() => setLoading(false));
  }, [open, props.instanceId]);

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>Delete Element Instance</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You are about to permanently delete <strong>&ldquo;{props.instanceName}&rdquo;</strong>.
          This will remove only the selected element instance from Structure Workspace.
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
              This action will delete {impact.instance_count} structure element instance.
            </Alert>

            <CrossModelDeleteImpactList relationships={impact.cross_model_relationship_impact.impact_list_items} />

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Structure element instance that will be deleted
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
              Corresponding Model Workspace element type
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
          Delete Element Instance
        </Button>
      </DialogActions>
    </Dialog>
  );
}
