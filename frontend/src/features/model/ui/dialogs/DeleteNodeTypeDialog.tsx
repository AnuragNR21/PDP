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
import type { NodeDeleteImpact } from '../../domain/types';
import { CrossModelDeleteImpactList } from '@/shared/components/CrossModelDeleteImpactList';

export function DeleteNodeTypeDialog(props: {
  /** nodeId of the node type to delete. Dialog is open when non-null. */
  nodeId: string | null;
  nodeName: string;
  onConfirm: () => void;
  onClose: () => void;
  deleting?: boolean;
}) {
  const open = props.nodeId !== null;

  const [impact, setImpact] = useState<NodeDeleteImpact | null>(null);
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
    modelDefinitionsApi
      .getHierarchyNodeTypeDeleteImpact(props.nodeId)
      .then(setImpact)
      .catch(() => setError('Could not load impact preview. Please try again.'))
      .finally(() => setLoading(false));
  }, [open, props.nodeId]);

  const hasChildren = (impact?.childNodes.length ?? 0) > 0;
  const hasRules = (impact?.affectedRules.length ?? 0) > 0;
  const hasInstances = (impact?.instanceCount ?? 0) > 0;

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>Governed Delete Node Type</DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You are about to permanently delete{' '}
          <strong>&ldquo;{props.nodeName}&rdquo;</strong>. This action cannot be undone.
        </DialogContentText>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading impact preview…</Typography>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {impact && !loading && (
          <>
            <Alert severity="warning">
              This action will delete the selected node type, {impact.descendantCount} descendant node type{impact.descendantCount === 1 ? '' : 's'}, and {impact.instanceCount} structure node instance{impact.instanceCount === 1 ? '' : 's'}.
            </Alert>

            <CrossModelDeleteImpactList relationships={impact.crossModelRelationships} />

            {hasChildren && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Child node types that will also be deleted
                  <Chip label={impact.childNodes.length} size="small" color="error" sx={{ ml: 1 }} />
                </Typography>
                <List dense disablePadding>
                  {impact.childNodes.map((n) => (
                    <ListItem key={n.nodeId} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText primary={n.name} />
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            {hasRules && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Hierarchy rules that will be removed
                  <Chip label={impact.affectedRules.length} size="small" color="warning" sx={{ ml: 1 }} />
                </Typography>
                <List dense disablePadding>
                  {impact.affectedRules.map((r) => (
                    <ListItem key={r.ruleId} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText
                        primary={`${r.parentName} → ${r.childName}`}
                        secondary={r.relationshipKind}
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Structure node instances that will be deleted
              <Chip label={impact.instanceCount} size="small" color="warning" sx={{ ml: 1 }} />
            </Typography>
            {hasInstances && (
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
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={props.onClose} disabled={props.deleting}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          disabled={loading || !!error || props.deleting}
          onClick={props.onConfirm}
          startIcon={props.deleting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
