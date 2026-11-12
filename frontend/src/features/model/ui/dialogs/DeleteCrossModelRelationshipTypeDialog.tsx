import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type { CrossModelRelationshipTypeDeleteImpact } from '../../domain/types';
import { CrossModelDeleteImpactList } from '@/shared/components/CrossModelDeleteImpactList';

export function DeleteCrossModelRelationshipTypeDialog(props: {
  relationshipTypeId: string | null;
  onConfirm: () => void;
  onClose: () => void;
  deleting?: boolean;
}) {
  const open = props.relationshipTypeId !== null;
  const [impact, setImpact] = useState<CrossModelRelationshipTypeDeleteImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !props.relationshipTypeId) {
      setImpact(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    modelDefinitionsApi
      .getCrossModelRelationshipTypeDeleteImpact(props.relationshipTypeId)
      .then(setImpact)
      .catch(() => setError('Could not load governed delete impact. Please try again.'))
      .finally(() => setLoading(false));
  }, [open, props.relationshipTypeId]);

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>Governed Delete Relationship Type</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You are about to permanently delete this relationship type and its governed dependencies.
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
              This action will delete relationship type &ldquo;{impact.relationshipTypeName}&rdquo; and {impact.relationshipCount} relationship instance{impact.relationshipCount === 1 ? '' : 's'}.
            </Alert>
            <CrossModelDeleteImpactList relationships={impact.relationships} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={props.deleting}>Cancel</Button>
        <Button color="error" variant="contained" onClick={props.onConfirm} disabled={props.deleting || loading || Boolean(error)}>
          {props.deleting ? 'Deleting...' : 'Delete Relationship Type'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
