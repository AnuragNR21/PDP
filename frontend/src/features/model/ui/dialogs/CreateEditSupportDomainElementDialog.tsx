import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import type { MetadataOption, SupportDomainElementDraft } from '../../domain/types';

export function CreateEditSupportDomainElementDialog(props: {
  open: boolean;
  draft: SupportDomainElementDraft;
  lifecycleStatuses: MetadataOption[];
  validation: Record<string, string>;
  saving: boolean;
  onChange: (patch: Partial<SupportDomainElementDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{props.draft.id ? 'Edit Element' : 'Add Element'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            fullWidth
            label="Element type name"
            value={props.draft.name}
            onChange={(e) => props.onChange({ name: e.target.value })}
            error={!!props.validation.name}
            helperText={props.validation.name}
          />
          <TextField
            fullWidth
            label="Display Name"
            value={props.draft.displayName}
            onChange={(e) => props.onChange({ displayName: e.target.value })}
          />
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Description"
            value={props.draft.description}
            onChange={(e) => props.onChange({ description: e.target.value })}
          />
          <TextField
            fullWidth
            select
            label="Status"
            value={props.draft.status}
            onChange={(e) => props.onChange({ status: e.target.value })}
          >
            {props.lifecycleStatuses.map((item) => (
              <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        {props.draft.id && props.onDelete && (
          <Button color="error" onClick={() => { props.onDelete!(); props.onClose(); }}>Delete</Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="contained" onClick={props.onSave} disabled={props.saving}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
