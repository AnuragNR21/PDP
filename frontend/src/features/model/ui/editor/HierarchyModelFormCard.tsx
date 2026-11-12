import { Button, Card, CardContent, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { MetadataOption, HierarchyModelDraft } from '../../domain/types';

export function HierarchyModelFormCard(props: {
  draft: HierarchyModelDraft;
  owningDomains: MetadataOption[];
  lifecycleStatuses: MetadataOption[];
  validation: Record<string, string>;
  saving: boolean;
  onChange: (patch: Partial<HierarchyModelDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const { draft, owningDomains, lifecycleStatuses, validation, saving, onChange, onSave, onDelete } = props;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{draft.id ? draft.name || 'Hierarchy Model' : 'New Hierarchy Model'}</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="Name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} error={!!validation.name} helperText={validation.name} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth select label="Owning Domain" value={draft.owningDomain} onChange={(e) => onChange({ owningDomain: e.target.value })} error={!!validation.owningDomain} helperText={validation.owningDomain}>
                {owningDomains.map((item) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth multiline minRows={3} label="Purpose" value={draft.purpose} onChange={(e) => onChange({ purpose: e.target.value })} error={!!validation.purpose} helperText={validation.purpose} />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField fullWidth select label="Status" value={draft.status} onChange={(e) => onChange({ status: e.target.value })} error={!!validation.status} helperText={validation.status}>
                {lifecycleStatuses.map((item) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
              </TextField>
            </Grid>
          </Grid>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={onSave} disabled={saving}>Save Hierarchy Model</Button>
            {onDelete ? <Button color="error" onClick={onDelete}>Delete</Button> : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
