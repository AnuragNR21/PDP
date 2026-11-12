import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Tooltip } from '@mui/material';
import { useEffect, useState } from 'react';
import { MODEL_KIND_LABEL, type ModelKind, type WorkspaceModel } from '@/shared/workspace/workspaceModel';
import {
  extendersOf,
  extendsOf,
  extensionTargets,
  isCommon,
  modelKey,
  moveModel,
  orderedPackages,
  packageIdOf,
  PackageError,
  setExtends,
  usePackageState,
} from '@/shared/workspace/modelPackages';
import { ModelKindIcon } from '@/shared/workspace/WorkspaceIcons';
import type { MetadataOption, ValidationErrors } from '../../domain/types';

export type EditModelDraft = { id?: string | null; name: string; purpose: string; status: string };

/**
 * Edit Model — the same fields, in the same order, as Create Model, for every
 * model type: Model Type (fixed once created), Package, Name, Purpose,
 * Extends and Status. Package and Extends are applied when Save is pressed,
 * together with the model's own fields; Cancel changes nothing.
 */
export function EditModelDialog(props: {
  open: boolean;
  kind: ModelKind;
  draft: EditModelDraft;
  lifecycleStatuses: MetadataOption[];
  /** Every model, for the Extends choice. */
  models: WorkspaceModel[];
  validation: ValidationErrors;
  saving: boolean;
  onChange: (patch: { name?: string; purpose?: string; status?: string }) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const packages = usePackageState();
  const key = props.draft.id ? modelKey({ kind: props.kind, id: props.draft.id }) : null;
  const [packageId, setPackageId] = useState('');
  const [extendsKey, setExtendsKey] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the model's current Package and Extends every time the dialog opens.
  useEffect(() => {
    if (!props.open || !key) return;
    setPackageId(packageIdOf(packages, key));
    setExtendsKey(extendsOf(packages, key));
    setTouched(false);
    setError(null);
  }, [props.open, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const common = key ? isCommon(packages, key) : false;
  const extenders = key ? extendersOf(packages, key).length : 0;
  const targets = extensionTargets(packages, props.models, { kind: props.kind, key: key ?? undefined });

  const nameError = (touched && !props.draft.name.trim() ? 'Name is required.' : '') || props.validation.name || '';
  const purposeError = (touched && !props.draft.purpose.trim() ? 'Purpose is required.' : '') || props.validation.purpose || '';

  const save = () => {
    setTouched(true);
    if (!props.draft.name.trim() || !props.draft.purpose.trim() || !key) return;
    setError(null);
    try {
      if (packageId !== packageIdOf(packages, key)) moveModel(key, packageId);
      if ((extendsKey ?? null) !== extendsOf(packages, key)) setExtends(key, extendsKey);
    } catch (err) {
      setError(err instanceof PackageError ? err.message : 'Could not change the package.');
      return;
    }
    props.onSave();
  };

  return (
    <Dialog open={props.open} onClose={props.saving ? undefined : props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Model</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Tooltip title="A model's type is fixed once it is created" placement="top-start">
            <TextField
              select
              fullWidth
              required
              disabled
              label="Model Type"
              value={props.kind}
              SelectProps={{ renderValue: (value) => MODEL_KIND_LABEL[value as ModelKind] }}
            >
              {(['hierarchy', 'support'] as ModelKind[]).map((kind) => (
                <MenuItem key={kind} value={kind}>
                  <ModelKindIcon kind={kind} size={22} sx={{ mr: 1.25 }} />
                  {MODEL_KIND_LABEL[kind]}
                </MenuItem>
              ))}
            </TextField>
          </Tooltip>
          <TextField
            select
            fullWidth
            required
            label="Package"
            value={packageId || (key ? packageIdOf(packages, key) : '')}
            InputLabelProps={{ shrink: true }}
            onChange={(event) => setPackageId(event.target.value)}
            helperText={
              common && extenders > 0
                ? 'Other models extend this common model, so it stays in Shared Models.'
                : common
                  ? 'The package that owns the model. A common model moved out of Shared Models stops being common.'
                  : 'The package that owns the model.'
            }
          >
            {orderedPackages(packages).map((pkg) => (
              <MenuItem key={pkg.id} value={pkg.id}>
                {pkg.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            required
            label="Name"
            value={props.draft.name}
            onChange={(event) => props.onChange({ name: event.target.value })}
            error={!!nameError}
            helperText={nameError}
          />
          <TextField
            fullWidth
            required
            multiline
            minRows={3}
            label="Purpose"
            placeholder="What the model represents or is used for"
            value={props.draft.purpose}
            onChange={(event) => props.onChange({ purpose: event.target.value })}
            error={!!purposeError}
            helperText={purposeError}
          />
          <TextField
            select
            fullWidth
            label="Extends (optional)"
            value={extendsKey ?? ''}
            onChange={(event) => setExtendsKey(event.target.value || null)}
            disabled={common}
            helperText={
              common
                ? 'This is a common model — other models extend it, it does not extend one.'
                : targets.length === 0
                  ? `No common ${MODEL_KIND_LABEL[props.kind].toLowerCase()} to extend yet.`
                  : 'Build on a common model from Shared Models without copying it.'
            }
          >
            <MenuItem value="">
              <em>Does not extend a model</em>
            </MenuItem>
            {targets.map((target) => (
              <MenuItem key={modelKey(target)} value={modelKey(target)}>
                {target.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            label="Status"
            value={props.draft.status}
            onChange={(event) => props.onChange({ status: event.target.value })}
            error={!!props.validation.status}
            helperText={props.validation.status}
          >
            {props.lifecycleStatuses.map((item) => (
              <MenuItem key={item.key} value={item.key}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Box>
          {props.onDelete && (
            <Button color="error" onClick={props.onDelete} disabled={props.saving}>
              Delete
            </Button>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button onClick={props.onClose} disabled={props.saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={props.saving}>
            {props.saving ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
