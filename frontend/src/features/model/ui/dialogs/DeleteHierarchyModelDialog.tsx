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
} from '@mui/material';
import { useEffect, useState } from 'react';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type { HierarchyModelDeleteImpact } from '../../domain/types';
import { CrossModelDeleteImpactList } from '@/shared/components/CrossModelDeleteImpactList';

export function DeleteHierarchyModelDialog(props: {
  modelId: string | null;
  modelName: string;
  deleting?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const open = props.modelId !== null;
  const [impact, setImpact] = useState<HierarchyModelDeleteImpact | null>(null);
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
    modelDefinitionsApi
      .getHierarchyModelDeleteImpact(props.modelId)
      .then(setImpact)
      .catch(() => setError('Could not load governed delete impact. Please try again.'))
      .finally(() => setLoading(false));
  }, [open, props.modelId]);

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>Governed Delete Hierarchy Model</DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You are about to permanently delete <strong>&ldquo;{props.modelName}&rdquo;</strong>. This will remove the hierarchy model from Model Workspace and its node instances from Structure Workspace.
        </DialogContentText>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading governed delete impact...</Typography>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {impact && !loading && (
          <>
            <Alert severity="warning">
              This action will delete {impact.nodeCount} hierarchy node{impact.nodeCount === 1 ? '' : 's'} and {impact.instanceCount} structure node instance{impact.instanceCount === 1 ? '' : 's'}.
            </Alert>

            <CrossModelDeleteImpactList relationships={impact.crossModelRelationships} />

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Hierarchy nodes that will be deleted
              <Chip label={impact.nodes.length} size="small" color="error" sx={{ ml: 1 }} />
            </Typography>
            <List dense disablePadding>
              {impact.nodes.map((node) => (
                <ListItem key={node.nodeId} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={node.nodePath}
                    secondary={node.displayName ? `Display name: ${node.displayName}` : undefined}
                  />
                </ListItem>
              ))}
            </List>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Structure node instances that will be deleted
              <Chip label={impact.nodeInstances.length} size="small" color="warning" sx={{ ml: 1 }} />
            </Typography>
            <List dense disablePadding>
              {impact.nodeInstances.map((instance) => (
                <ListItem key={instance.instanceId} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={instance.instancePath}
                    secondary={`Model node: ${instance.nodeName}`}
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
          variant="contained"
          color="error"
          onClick={props.onConfirm}
          disabled={loading || !!error || props.deleting}
        >
          Delete Hierarchy Model
        </Button>
      </DialogActions>
    </Dialog>
  );
}
