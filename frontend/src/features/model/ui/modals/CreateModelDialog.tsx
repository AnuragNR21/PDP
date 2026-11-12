import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { MODEL_KIND_LABEL, type ModelKind, type WorkspaceModel } from '@/shared/workspace/workspaceModel';
import { extensionTargets, modelKey, orderedPackages, SHARED_PACKAGE_ID, usePackageState } from '@/shared/workspace/modelPackages';
import { ModelKindIcon } from '@/shared/workspace/WorkspaceIcons';
import type { MetadataOption } from '../../domain/types';

export type CreateModelForm = { kind: ModelKind; name: string; purpose: string; status: string; packageId: string; extendsKey: string | null };

/**
 * Create Model — one dialog for every model type. The type is the first
 * field; name, purpose and status are the same for all of them. Create makes
 * the model and opens it; Cancel closes without creating anything.
 *
 * The form is mirrored into the workspace's draft for the chosen type as it
 * is typed (`onDraftChange`), so Create runs the same save as before.
 */
export function CreateModelDialog(props: {
  open: boolean;
  lifecycleStatuses: MetadataOption[];
  saving: boolean;
  onDraftChange: (form: CreateModelForm) => void;
  /** Create receives the form, so the new model can be placed in its Package. */
  onCreate: (kind: ModelKind, form: CreateModelForm) => Promise<void>;
  onClose: () => void;
  /** Every model, for the Extends choice. */
  models: WorkspaceModel[];
  /** The Package a new model starts in: the one it was started from, or the open model's. */
  initialPackageId?: string;
}) {
  const packages = usePackageState();
  const defaultStatus = props.lifecycleStatuses.find((item) => item.key === 'draft')?.key ?? props.lifecycleStatuses[0]?.key ?? '';
  const blank: CreateModelForm = { kind: 'hierarchy', name: '', purpose: '', status: defaultStatus, packageId: props.initialPackageId ?? SHARED_PACKAGE_ID, extendsKey: null };
  const [form, setForm] = useState<CreateModelForm>(blank);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time the dialog opens.
  useEffect(() => {
    if (!props.open) return;
    setForm(blank);
    setTouched(false);
    setError(null);
    props.onDraftChange(blank);
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch: Partial<CreateModelForm>) => {
    const next = { ...form, ...patch };
    setForm(next);
    props.onDraftChange(next);
  };

  const extendTargets = extensionTargets(packages, props.models, { kind: form.kind });

  const nameError = touched && !form.name.trim() ? 'Name is required.' : '';
  // The service stores a purpose with every model, so it cannot be left empty yet.
  const purposeError = touched && !form.purpose.trim() ? 'Purpose is required.' : '';

  const create = async () => {
    setTouched(true);
    if (!form.name.trim() || !form.purpose.trim()) return;
    setError(null);
    try {
      await props.onCreate(form.kind, form);
      props.onClose();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : err instanceof Error ? err.message : 'Could not create the model.');
    }
  };

  return (
    <Dialog open={props.open} onClose={props.saving ? undefined : props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Model</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            fullWidth
            required
            label="Select Model Type"
            value={form.kind}
            onChange={(event) => change({ kind: event.target.value as ModelKind, extendsKey: null })}
            SelectProps={{ renderValue: (value) => MODEL_KIND_LABEL[value as ModelKind] }}
          >
            {(['hierarchy', 'support'] as ModelKind[]).map((kind) => (
              <MenuItem key={kind} value={kind}>
                <ModelKindIcon kind={kind} size={22} sx={{ mr: 1.25 }} />
                {MODEL_KIND_LABEL[kind]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            required
            label="Package"
            value={form.packageId}
            onChange={(event) => change({ packageId: event.target.value })}
            helperText="The package that will own the model."
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
            autoFocus
            label="Name"
            value={form.name}
            onChange={(event) => change({ name: event.target.value })}
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
            value={form.purpose}
            onChange={(event) => change({ purpose: event.target.value })}
            error={!!purposeError}
            helperText={purposeError}
          />
          <TextField
            select
            fullWidth
            label="Extends (optional)"
            value={form.extendsKey ?? ''}
            onChange={(event) => change({ extendsKey: event.target.value || null })}
            helperText={
              extendTargets.length === 0
                ? `No common ${MODEL_KIND_LABEL[form.kind].toLowerCase()} to extend yet.`
                : 'Build on a common model from Shared Models without copying it.'
            }
          >
            <MenuItem value="">
              <em>Does not extend a model</em>
            </MenuItem>
            {extendTargets.map((target) => (
              <MenuItem key={modelKey(target)} value={modelKey(target)}>
                {target.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select fullWidth label="Status" value={form.status} onChange={(event) => change({ status: event.target.value })}>
            {props.lifecycleStatuses.map((item) => (
              <MenuItem key={item.key} value={item.key}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onClose} disabled={props.saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void create()} disabled={props.saving}>
          {props.saving ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
