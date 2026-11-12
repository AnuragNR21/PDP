import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import type {
  MetadataOption,
  SupportDomainElementPropertyData,
} from '../../domain/types';

export function CreateEditSupportDomainElementTypePropertyDialog(props: {
  open: boolean;
  propertyData: SupportDomainElementPropertyData;
  lifecycleStatuses: MetadataOption[];
  validation: Record<string, string>;
  saving: boolean;
  onChange: (patch: Partial<SupportDomainElementPropertyData>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{props.propertyData.id ? 'Edit Property' : 'Add Property'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            fullWidth
            label="Property Name"
            value={props.propertyData.name}
            onChange={(event) => props.onChange({ name: event.target.value })}
            error={!!props.validation.name}
            helperText={props.validation.name}
          />
          <TextField
            fullWidth
            label="Description"
            value={props.propertyData.description}
            onChange={(event) => props.onChange({ description: event.target.value })}
            multiline
            minRows={3}
          />
          <TextField
            fullWidth
            select
            label="Status"
            value={props.propertyData.status}
            onChange={(event) => props.onChange({ status: event.target.value })}
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
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="contained" onClick={props.onSave} disabled={props.saving}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
