import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Stack, TextField } from '@mui/material';
import { MetadataOption, SupportDomainModelDraft, ValidationErrors } from '../../domain/types';

export type SupportDomainModelCreateEditDialogProps = {
  open: boolean;
  draft: SupportDomainModelDraft;
  lifecycleStatuses: MetadataOption[];
  validation: ValidationErrors;
  saving: boolean;
  onChange: (patch: Partial<SupportDomainModelDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

export function SupportDomainModelCreateEditDialog({
  open,
  draft,
  lifecycleStatuses,
  validation,
  saving,
  onChange,
  onSave,
  onDelete,
  onClose,
}: SupportDomainModelCreateEditDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {draft.id ? draft.name || 'Support Domain Model' : 'New Support Domain Model'}
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
            Save Support Domain Model
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
