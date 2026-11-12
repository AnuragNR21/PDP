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
import type {
  SupportDomainElementDeleteImpact,
  SupportDomainModelDeleteImpact,
} from '../../domain/types';
import { CrossModelDeleteImpactList } from '@/shared/components/CrossModelDeleteImpactList';

type DeleteImpact = SupportDomainModelDeleteImpact | SupportDomainElementDeleteImpact;

export function DeleteSupportDomainDialog(props: {
  kind: 'model' | 'element';
  targetId: string | null;
  targetName: string;
  deleting?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const open = props.targetId !== null;
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !props.targetId) {
      setImpact(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const request = props.kind === 'model'
      ? modelDefinitionsApi.getSupportDomainModelDeleteImpact(props.targetId)
      : modelDefinitionsApi.getSupportDomainElementDeleteImpact(props.targetId);
    request
      .then(setImpact)
      .catch(() => setError('Could not load governed delete impact. Please try again.'))
      .finally(() => setLoading(false));
  }, [open, props.kind, props.targetId]);

  const modelImpact = impact && 'elements' in impact ? impact : null;
  const elementImpact = impact && 'affectedRelationships' in impact ? impact : null;
  const instances = impact?.elementInstances ?? [];

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Governed Delete Support Domain {props.kind === 'model' ? 'Model' : 'Element Type'}
      </DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You are about to permanently delete <strong>&ldquo;{props.targetName}&rdquo;</strong> and its governed dependencies.
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
              {modelImpact
                ? `This action will delete ${modelImpact.elementCount} element type${modelImpact.elementCount === 1 ? '' : 's'} and ${modelImpact.instanceCount} structure element instance${modelImpact.instanceCount === 1 ? '' : 's'}.`
                : `This action will delete the selected element type, ${elementImpact?.affectedRelationships.length ?? 0} relationship${elementImpact?.affectedRelationships.length === 1 ? '' : 's'}, ${elementImpact?.affectedRules.length ?? 0} rule${elementImpact?.affectedRules.length === 1 ? '' : 's'}, and ${elementImpact?.instanceCount ?? 0} structure element instance${elementImpact?.instanceCount === 1 ? '' : 's'}.`}
            </Alert>

            <CrossModelDeleteImpactList relationships={impact.crossModelRelationships} />

            {modelImpact && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Element types that will be deleted
                  <Chip label={modelImpact.elementCount} size="small" color="error" sx={{ ml: 1 }} />
                </Typography>
                <List dense disablePadding>
                  {modelImpact.elements.map((element) => (
                    <ListItem key={element.elementId} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText
                        primary={element.name}
                        secondary={element.displayName ? `Display name: ${element.displayName}` : undefined}
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            {elementImpact && elementImpact.affectedRelationships.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Support Domain relationships that will be removed
                  <Chip label={elementImpact.affectedRelationships.length} size="small" color="warning" sx={{ ml: 1 }} />
                </Typography>
                <List dense disablePadding>
                  {elementImpact.affectedRelationships.map((relationship) => (
                    <ListItem key={relationship.relationshipId} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText
                        primary={`${relationship.sourceName} -> ${relationship.targetName}`}
                        secondary={relationship.relationshipType}
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            {elementImpact && elementImpact.affectedRules.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Support Domain rules that will be removed
                  <Chip label={elementImpact.affectedRules.length} size="small" color="warning" sx={{ ml: 1 }} />
                </Typography>
                <List dense disablePadding>
                  {elementImpact.affectedRules.map((rule) => (
                    <ListItem key={rule.ruleId} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText
                        primary={`${rule.sourceName} -> ${rule.targetName}`}
                        secondary={`${rule.relationshipType} (${rule.ruleKind})`}
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Structure element instances that will be deleted
              <Chip label={instances.length} size="small" color="warning" sx={{ ml: 1 }} />
            </Typography>
            <List dense disablePadding>
              {instances.map((instance) => (
                <ListItem key={instance.instanceId} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={instance.instancePath}
                    secondary={`Element type: ${instance.elementTypeName}`}
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
          Delete {props.kind === 'model' ? 'Support Domain Model' : 'Element Type'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
