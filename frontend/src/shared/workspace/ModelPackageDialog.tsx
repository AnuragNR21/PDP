import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { ModelKindIcon } from './WorkspaceIcons';
import {
  extendersOf,
  extendsOf,
  extensionTargets,
  isCommon,
  modelKey,
  moveModel,
  orderedPackages,
  packageIdOf,
  setCommon,
  setExtends,
  SHARED_PACKAGE_ID,
  usePackageState,
} from './modelPackages';
import type { WorkspaceModel } from './workspaceModel';

const NONE = '__none__';

/**
 * Where a model lives and what it builds on: its Package, whether it is a
 * common model (Shared Models only), and the common model it extends. None of
 * this changes the model's own content or status.
 */
export function ModelPackageDialog(props: { model: WorkspaceModel | null; models: WorkspaceModel[]; onClose: () => void }) {
  const s = usePackageState();
  const key = props.model ? modelKey(props.model) : '';
  const [packageId, setPackageId] = useState(SHARED_PACKAGE_ID);
  const [common, setCommonDraft] = useState(false);
  const [extendsKey, setExtendsKey] = useState<string>(NONE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.model) return;
    setPackageId(packageIdOf(s, key));
    setCommonDraft(isCommon(s, key));
    setExtendsKey(extendsOf(s, key) ?? NONE);
    setError(null);
  }, [props.model?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!props.model) return null;
  const model = props.model;
  const inShared = packageId === SHARED_PACKAGE_ID;
  const extenders = extendersOf(s, key);
  const targets = extensionTargets(s, props.models, { kind: model.kind, key });

  const save = () => {
    setError(null);
    try {
      const wantCommon = inShared && common;
      if (wantCommon && extendsKey !== NONE) throw new Error('A common model cannot also extend another model — choose one.');
      // Order matters: clear what would block a later step first.
      if (extendsKey === NONE) setExtends(key, null);
      if (!wantCommon && isCommon(s, key)) setCommon(key, false);
      if (packageIdOf(s, key) !== packageId) moveModel(key, packageId);
      if (wantCommon) setCommon(key, true);
      if (extendsKey !== NONE) setExtends(key, extendsKey);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  return (
    <Dialog open onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Package &amp; extension</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <ModelKindIcon kind={model.kind} size={24} />
            <Typography variant="subtitle2" fontWeight={700} noWrap>
              {model.name}
            </Typography>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select fullWidth label="Package" value={packageId} onChange={(event) => setPackageId(event.target.value)} helperText="The package that owns this model.">
            {orderedPackages(s).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={inShared && common} disabled={!inShared || extendsKey !== NONE} onChange={(event) => setCommonDraft(event.target.checked)} />}
            label={
              <Stack>
                <Typography variant="body2">Common model, intended for reuse</Typography>
                <Typography variant="caption" color="text.secondary">
                  {!inShared
                    ? 'Only models in Shared Models can be common models.'
                    : extenders.length > 0
                      ? `${extenders.length} model${extenders.length === 1 ? '' : 's'} extend${extenders.length === 1 ? 's' : ''} this one.`
                      : 'Models in other packages can then extend it.'}
                </Typography>
              </Stack>
            }
          />
          <TextField
            select
            fullWidth
            label="Extends"
            value={extendsKey}
            disabled={inShared && common}
            onChange={(event) => setExtendsKey(event.target.value)}
            helperText={targets.length === 0 ? 'No common model of this type to extend yet.' : 'Adds package-specific content to a common model, without changing it.'}
          >
            <MenuItem value={NONE}>
              <em>Does not extend a model</em>
            </MenuItem>
            {targets.map((target) => (
              <MenuItem key={modelKey(target)} value={modelKey(target)}>
                <ModelKindIcon kind={target.kind} size={18} sx={{ mr: 1 }} />
                {target.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
