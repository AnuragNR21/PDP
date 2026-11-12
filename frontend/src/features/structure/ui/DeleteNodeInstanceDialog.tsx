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
  type HierarchyModelGovernedDeleteImpact,
} from "@/features/structure/api/structureApi";
import { CrossModelDeleteImpactList } from "@/shared/components/CrossModelDeleteImpactList";

export function DeleteNodeInstanceDialog(props: {
  nodeId: string | null;
  nodeName: string;
  deleting?: boolean;
  actionError?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = props.nodeId !== null;
  const [impact, setImpact] = useState<HierarchyModelGovernedDeleteImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !props.nodeId) {
      setImpact(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    structureApi
      .getGovernedDeleteImpact(props.nodeId)
      .then(setImpact)
      .catch(() => setError("Could not load governed delete impact. Please try again."))
      .finally(() => setLoading(false));
  }, [open, props.nodeId]);

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>{impact?.is_root ? "Governed Delete Hierarchy Model" : "Delete Node Instance"}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You are about to permanently delete <strong>&ldquo;{props.nodeName}&rdquo;</strong>.{" "}
          {impact?.is_root
            ? "This will remove the runtime node instances from Structure Workspace. Model Workspace definitions will remain unchanged."
            : "This will remove the selected node instance and all descendant instances from Structure Workspace."}
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
              This action will delete {impact.instance_count} structure node instance{impact.instance_count === 1 ? "" : "s"}.
              {" "}Related diagram and matrix projections will be cleaned up after the authoritative delete succeeds.
            </Alert>

            <CrossModelDeleteImpactList relationships={impact.cross_model_relationship_impact.impact_list_items} />

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Runtime cleanup impact
            </Typography>
            <List dense disablePadding>
              <ListItem disableGutters sx={{ py: 0.25 }}>
                <ListItemText primary={`${impact.relationship_count} relationship${impact.relationship_count === 1 ? "" : "s"} will be removed`} />
              </ListItem>
              <ListItem disableGutters sx={{ py: 0.25 }}>
                <ListItemText primary={`${impact.diagram_node_count} diagram node projection${impact.diagram_node_count === 1 ? "" : "s"} will be cleaned up`} />
              </ListItem>
              <ListItem disableGutters sx={{ py: 0.25 }}>
                <ListItemText primary={`${impact.diagram_edge_count} diagram edge projection${impact.diagram_edge_count === 1 ? "" : "s"} will be cleaned up`} />
              </ListItem>
              <ListItem disableGutters sx={{ py: 0.25 }}>
                <ListItemText primary="Matrix presentation will rehydrate from persisted runtime structure after delete." />
              </ListItem>
            </List>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Structure node instances that will be deleted
              <Chip label={impact.node_instances.length} size="small" color="error" sx={{ ml: 1 }} />
            </Typography>
            <List dense disablePadding>
              {impact.node_instances.map((instance) => (
                <ListItem key={instance.instance_id} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={instance.instance_path}
                    secondary={`Model node: ${instance.node_name}`}
                  />
                </ListItem>
              ))}
            </List>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              {impact.is_root
                ? "Model Workspace definitions referenced by these runtime node instances"
                : "Corresponding Model Workspace definitions"}
              <Chip label={impact.nodes.length} size="small" color="warning" sx={{ ml: 1 }} />
            </Typography>
            <List dense disablePadding>
              {impact.nodes.map((node) => (
                <ListItem key={node.node_id} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={node.node_path}
                    secondary={node.display_name ? `Display name: ${node.display_name}` : undefined}
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
          Delete Node Instance
        </Button>
      </DialogActions>
    </Dialog>
  );
}
