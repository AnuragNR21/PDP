import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Stack, TextField } from '@mui/material';
import { HierarchyModelDraft, MetadataOption, ValidationErrors } from '../../domain/types';

export type HierarchyModelCreateEditDialogProps = {
  open: boolean;
  draft: HierarchyModelDraft;
  owningDomains: MetadataOption[];
  lifecycleStatuses: MetadataOption[];
  validation: ValidationErrors;
  saving: boolean;
  onChange: (patch: Partial<HierarchyModelDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

export function HierarchyModelCreateEditDialog({
  open,
  draft,
  owningDomains,
  lifecycleStatuses,
  validation,
  saving,
  onChange,
  onSave,
  onDelete,
  onClose,
}: HierarchyModelCreateEditDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {draft.id ? draft.name || 'Hierarchy Model' : 'New Hierarchy Model'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Name"
                value={draft.name}
                onChange={(e) => onChange({ name: e.target.value })}
                error={!!validation.name}
                helperText={validation.name}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                select
                label="Owning Domain"
                value={draft.owningDomain}
                onChange={(e) => onChange({ owningDomain: e.target.value })}
                error={!!validation.owningDomain}
                helperText={validation.owningDomain}
              >
                {owningDomains.map((item) => (
                  <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Purpose"
                value={draft.purpose}
                onChange={(e) => onChange({ purpose: e.target.value })}
                error={!!validation.purpose}
                helperText={validation.purpose}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                select
                label="Status"
                value={draft.status}
                onChange={(e) => onChange({ status: e.target.value })}
                error={!!validation.status}
                helperText={validation.status}
              >
                {lifecycleStatuses.map((item) => (
                  <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Box>
          {onDelete && (
            <Button color="error" onClick={onDelete} disabled={saving}>Delete</Button>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={onSave} disabled={saving}>
            Save Hierarchy Model
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
