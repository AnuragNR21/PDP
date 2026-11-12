import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';
import type { HierarchyNodeTypePropertyFormData, MetadataOption } from '../../domain/types';

export function CreateEditNodeTypePropertyDialog(props: {
  open: boolean;
  formData: HierarchyNodeTypePropertyFormData;
  lifecycleStatuses: MetadataOption[];
  validation: Record<string, string>;
  saving: boolean;
  onChange: (patch: Partial<HierarchyNodeTypePropertyFormData>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{props.formData.id ? 'Edit Property' : 'Add Property'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            fullWidth
            label="Property Name"
            value={props.formData.name}
            onChange={(e) => props.onChange({ name: e.target.value })}
            error={!!props.validation.name}
            helperText={props.validation.name}
          />
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Description"
            value={props.formData.description}
            onChange={(e) => props.onChange({ description: e.target.value })}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={props.formData.inheritable}
                onChange={(e) => props.onChange({ inheritable: e.target.checked })}
              />
            }
            label="Inheritable"
          />
          <TextField
            fullWidth
            select
            label="Status"
            value={props.formData.status}
            onChange={(e) => props.onChange({ status: e.target.value })}
            error={!!props.validation.status}
            helperText={props.validation.status}
          >
            {props.lifecycleStatuses.map((item) => (
              <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        {props.formData.id && props.onDelete && (
          <Button color="error" onClick={() => { props.onDelete!(); props.onClose(); }}>Delete</Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="contained" onClick={props.onSave} disabled={props.saving}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
