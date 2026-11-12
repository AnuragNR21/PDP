import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import SwapVertOutlined from '@mui/icons-material/SwapVertOutlined';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { CrossModelRelationshipTypeDraft, CrossModelTypeOptions, MetadataOption } from '../../domain/types';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';

type SideKind = 'HIERARCHY_MODEL' | 'SUPPORT_DOMAIN_MODEL';

/**
 * Support Domain mode: the same editor, for a relationship between two element
 * types of one Support Domain model. As in cross-model mode, the name is
 * picked (a relationship kind, or a name the model already uses) or typed
 * new, e.g. "zz 123"; both ends are element types of that model, and the
 * description is kept as the relationship's notes.
 */
export type SupportDomainEditorMode = {
  modelName: string;
  elements: Array<{ id: string; name: string }>;
  kinds: MetadataOption[];
  /** Names of the model's own already used by its other relationships, with how often. */
  existingNames?: Array<{ name: string; uses: number }>;
};

const sectionTitleSx = { fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 } as const;

function TypeSelector({
  label,
  kind,
  typeId,
  typeOptions,
  onKindChange,
  onTypeIdChange,
  disabled,
  supportDomain,
  error,
}: {
  label: string;
  kind: SideKind;
  typeId: string | null;
  typeOptions: CrossModelTypeOptions;
  onKindChange: (k: SideKind) => void;
  onTypeIdChange: (id: string | null) => void;
  disabled?: boolean;
  supportDomain?: SupportDomainEditorMode;
  error?: string;
}) {
  const options = supportDomain
    ? supportDomain.elements.map((e) => ({ id: e.id, name: e.name, modelId: 'sd', modelName: supportDomain.modelName }))
    : kind === 'HIERARCHY_MODEL'
      ? typeOptions.nodeTypes
      : typeOptions.elementTypes;

  // Group by model
  const grouped = options.reduce<Record<string, { modelName: string; items: typeof options }>>((acc, t) => {
    if (!acc[t.modelId]) acc[t.modelId] = { modelName: t.modelName, items: [] };
    acc[t.modelId].items.push(t);
    return acc;
  }, {});

  const lockedSx = {
    '& .MuiToggleButton-root.Mui-selected': { bgcolor: 'action.disabledBackground', color: 'text.disabled', borderColor: 'divider' },
    '& .MuiToggleButton-root.Mui-selected.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'text.disabled' },
  };
  const helper = error
    ? error
    : supportDomain
      ? `An element type of ${supportDomain.modelName}.`
      : kind === 'HIERARCHY_MODEL'
        ? 'Select a specific node type, or leave blank for any node type.'
        : 'Select a specific element type, or leave blank for any element type.';

  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>{label}</Typography>
      <Tooltip title={supportDomain ? 'Relationships inside a Support Domain model are between its element types' : ''} placement="top-start">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={supportDomain ? 'SUPPORT_DOMAIN_MODEL' : kind}
          onChange={(_, v: SideKind | null) => { if (v) { onKindChange(v); onTypeIdChange(null); } }}
          sx={{
            alignSelf: 'flex-start',
            '& .MuiToggleButton-root': { textTransform: 'none', fontSize: 12, px: 1.5, py: 0.5 },
            ...((disabled || supportDomain) && lockedSx),
          }}
          disabled={disabled || !!supportDomain}
        >
          <ToggleButton value="HIERARCHY_MODEL">Hierarchy Node Type</ToggleButton>
          <ToggleButton value="SUPPORT_DOMAIN_MODEL">SD Element Type</ToggleButton>
        </ToggleButtonGroup>
      </Tooltip>
      <TextField
        select
        size="small"
        fullWidth
        value={typeId ?? ''}
        onChange={(e) => onTypeIdChange(e.target.value || null)}
        helperText={helper}
        error={!!error}
        SelectProps={{ displayEmpty: true }}
        disabled={disabled}
        sx={disabled ? {
          '& .MuiInputBase-root': { bgcolor: 'action.disabledBackground' },
          '& .MuiInputBase-input.Mui-disabled': { WebkitTextFillColor: 'rgba(0,0,0,0.38)' },
        } : undefined}
      >
        {supportDomain ? (
          <MenuItem value="" disabled><em>Select an element type</em></MenuItem>
        ) : (
          <MenuItem value=""><em>— Any {kind === 'HIERARCHY_MODEL' ? 'node type' : 'element type'} —</em></MenuItem>
        )}
        {Object.values(grouped).map((group) => [
          <MenuItem key={`__group_${group.modelName}`} disabled sx={{ fontSize: 11, opacity: 0.7, fontStyle: 'italic' }}>
            {group.modelName}
          </MenuItem>,
          ...group.items.map((t) => (
            <MenuItem key={t.id} value={t.id} sx={{ pl: 3 }}>
              {t.name}
            </MenuItem>
          )),
        ])}
        {options.length === 0 && (
          <MenuItem disabled><em>No active types found</em></MenuItem>
        )}
      </TextField>
    </Stack>
  );
}

type NameOption = { name: string; description: string; group: string; uses?: number };

/**
 * The relationship editor — used by the Relationship Diagram, the relationship
 * matrix and tables, and (in Support Domain mode) the Support Domain diagram.
 *
 * The Name field searches as you type: existing relationship names, then the
 * suggested names, so the same relationship is named the same way everywhere.
 */
export function CreateEditCrossModelRelationshipTypeDialog(props: {
  open: boolean;
  draft: CrossModelRelationshipTypeDraft;
  typeOptions: CrossModelTypeOptions;
  lifecycleStatuses: MetadataOption[];
  validation: Record<string, string>;
  saving: boolean;
  constraintsLocked?: boolean;
  /** Edit a relationship inside one Support Domain model (see SupportDomainEditorMode). */
  supportDomain?: SupportDomainEditorMode;
  onChange: (patch: Partial<CrossModelRelationshipTypeDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const isEdit = !!props.draft.id;
  const sd = props.supportDomain;

  const templatesQuery = useQuery({
    queryKey: ['cross-model-relationship-type-templates'],
    queryFn: () => modelDefinitionsApi.getCrossModelRelationshipTypeTemplates(),
    staleTime: Infinity,
    enabled: props.open && !sd,
  });
  const existingQuery = useQuery({
    queryKey: ['cross-model-relationship-types', 'all'],
    queryFn: () => modelDefinitionsApi.listCrossModelRelationshipTypes(),
    enabled: props.open && !sd,
  });

  // Quick Select: suggested names (cross-model) or the model's relationship kinds (Support Domain).
  const quick: Array<{ name: string; description: string }> = sd
    ? sd.kinds.map((k) => ({ name: k.label, description: k.description ?? '' }))
    : (templatesQuery.data ?? []);

  const nameOptions = useMemo<NameOption[]>(() => {
    if (sd) {
      const kindNames = new Set(sd.kinds.map((k) => k.label.toLocaleLowerCase()));
      const own = (sd.existingNames ?? [])
        .filter((n) => !kindNames.has(n.name.toLocaleLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((n) => ({ name: n.name, description: '', group: 'Existing relationship names', uses: n.uses }));
      return [...own, ...sd.kinds.map((k) => ({ name: k.label, description: k.description ?? '', group: 'Relationship kinds' }))];
    }
    const existing = new Map<string, NameOption>();
    for (const row of existingQuery.data ?? []) {
      if (row.id === props.draft.id) continue;
      const key = row.name.trim().toLocaleLowerCase();
      const seen = existing.get(key);
      if (seen) seen.uses = (seen.uses ?? 1) + 1;
      else existing.set(key, { name: row.name.trim(), description: row.description ?? '', group: 'Existing relationship names', uses: 1 });
    }
    const suggestions = (templatesQuery.data ?? [])
      .filter((t) => !existing.has(t.name.trim().toLocaleLowerCase()))
      .map((t) => ({ name: t.name, description: t.description, group: 'Suggested names' }));
    const sorted = [...existing.values()].sort((a, b) => a.name.localeCompare(b.name));
    return [...sorted, ...suggestions];
  }, [sd, existingQuery.data, templatesQuery.data, props.draft.id]);

  const existingMatch = nameOptions.find((o) => o.group === 'Existing relationship names' && o.name.toLocaleLowerCase() === props.draft.name.trim().toLocaleLowerCase());

  /**
   * Choosing a name fills the description too — replacing an empty one or one
   * that came from another suggestion, but never text the person wrote.
   */
  const pickName = (option: { name: string; description: string }) => {
    const current = props.draft.description.trim();
    const suggested = [...quick, ...nameOptions].some((o) => o.description.trim() === current);
    const keepDescription = current.length > 0 && !suggested;
    props.onChange(keepDescription || !option.description ? { name: option.name } : { name: option.name, description: option.description });
  };

  const nameHelper =
    props.validation.name ??
    (sd && !existingMatch
      ? `Pick a relationship kind or a name ${sd.modelName} already uses, or type a new one.`
      : existingMatch
        ? `“${existingMatch.name}” is already used by ${existingMatch.uses} relationship type${existingMatch.uses === 1 ? '' : 's'} — reusing a name keeps reporting consistent.`
        : 'Start typing to find an existing name, or enter a new, descriptive one.');

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Relationship' : 'Create Relationship'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>

          {/* ── Quick select (create only) ──────────────────────────────── */}
          {!isEdit && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ ...sectionTitleSx, display: 'block', mb: 1 }}>
                Quick Select
              </Typography>
              {!sd && templatesQuery.isLoading ? (
                <CircularProgress size={16} />
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {quick.map((t) => {
                    const selected = props.draft.name === t.name;
                    return (
                      <Tooltip key={t.name} title={t.description} disableHoverListener={!t.description}>
                        <Chip
                          label={t.name}
                          size="small"
                          variant={selected ? 'filled' : 'outlined'}
                          color={selected ? 'primary' : 'default'}
                          onClick={() => pickName(t)}
                          sx={{ fontSize: 12, cursor: 'pointer' }}
                        />
                      </Tooltip>
                    );
                  })}
                </Box>
              )}
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.75 }}>
                {sd ? 'Click a relationship kind to choose it.' : 'Click a suggestion to pre-fill the name and description, then adjust as needed.'}
              </Typography>
            </Box>
          )}

          <Divider />

          <Autocomplete<NameOption, false, false, boolean>
            freeSolo
            options={nameOptions}
            groupBy={(o) => o.group}
            value={props.draft.name}
            inputValue={props.draft.name}
            onInputChange={(_e, value, reason) => { if (reason !== 'reset') props.onChange({ name: value }); }}
            onChange={(_e, value) => {
              if (value === null) return;
              if (typeof value === 'string') props.onChange({ name: value });
              else pickName(value);
            }}
            getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
            isOptionEqualToValue={(o, v) => (typeof v === 'string' ? o.name === v : o.name === v.name)}
            filterOptions={(options, state) => {
              const q = state.inputValue.trim().toLocaleLowerCase();
              if (!q) return options;
              // Names that start with the text first, then names that contain it.
              const starts = options.filter((o) => o.name.toLocaleLowerCase().startsWith(q));
              const contains = options.filter((o) => !o.name.toLocaleLowerCase().startsWith(q) && (o.name.toLocaleLowerCase().includes(q) || o.description.toLocaleLowerCase().includes(q)));
              return [...starts, ...contains];
            }}
            renderOption={(liProps, o) => {
              const { key, ...rest } = liProps as typeof liProps & { key: string };
              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'block !important' }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" fontWeight={600}>{o.name}</Typography>
                    {o.uses ? <Chip size="small" label={`used ${o.uses}×`} variant="outlined" sx={{ height: 18, fontSize: 10 }} /> : null}
                  </Stack>
                  {o.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                      {o.description}
                    </Typography>
                  )}
                </Box>
              );
            }}
            loading={!sd && existingQuery.isLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                fullWidth
                label="Name"
                required
                placeholder="Search existing names, or type a new one"
                error={!!props.validation.name}
                helperText={nameHelper}
                autoFocus={isEdit}
              />
            )}
          />
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Description"
              value={props.draft.description}
              onChange={(e) => props.onChange({ description: e.target.value })}
              error={!!props.validation.description}
              helperText={props.validation.description}
            />

          <Divider />

          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5, ...sectionTitleSx }}>
              Source Constraint
            </Typography>
            <TypeSelector
              label="Allowed Source"
              kind={props.draft.sourceModelType}
              typeId={props.draft.sourceModelItemTypeId}
              typeOptions={props.typeOptions}
              onKindChange={(k) => props.onChange({ sourceModelType: k, sourceModelItemTypeId: null })}
              onTypeIdChange={(id) => props.onChange({ sourceModelItemTypeId: id })}
              disabled={props.constraintsLocked}
              supportDomain={sd}
              error={props.validation.source}
            />
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'center', my: '-8px !important' }}>
            <Tooltip title="Swap source and target">
              <span>
                <IconButton
                  size="small"
                  aria-label="Swap source and target"
                  disabled={props.constraintsLocked}
                  onClick={() =>
                    props.onChange({
                      sourceModelType: props.draft.targetModelType,
                      sourceModelItemTypeId: props.draft.targetModelItemTypeId,
                      targetModelType: props.draft.sourceModelType,
                      targetModelItemTypeId: props.draft.sourceModelItemTypeId,
                    })
                  }
                >
                  <SwapVertOutlined fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5, ...sectionTitleSx }}>
              Target Constraint
            </Typography>
            <TypeSelector
              label="Allowed Target"
              kind={props.draft.targetModelType}
              typeId={props.draft.targetModelItemTypeId}
              typeOptions={props.typeOptions}
              onKindChange={(k) => props.onChange({ targetModelType: k, targetModelItemTypeId: null })}
              onTypeIdChange={(id) => props.onChange({ targetModelItemTypeId: id })}
              disabled={props.constraintsLocked}
              supportDomain={sd}
              error={props.validation.target}
            />
          </Box>

          <Divider />

          <TextField
            fullWidth
            select
            label="Status"
            value={props.draft.status}
            onChange={(e) => props.onChange({ status: e.target.value })}
            error={!!props.validation.status}
            helperText={props.validation.status}
          >
            {props.lifecycleStatuses.map((opt) => (
              <MenuItem key={opt.key} value={opt.key}>{opt.label}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: props.onDelete ? 'space-between' : 'flex-end' }}>
        {props.onDelete && (
          <Button color="error" onClick={props.onDelete} disabled={props.saving}>
            Delete
          </Button>
        )}
        <Stack direction="row" spacing={1}>
          <Button onClick={props.onClose} disabled={props.saving}>Cancel</Button>
          <Button variant="contained" onClick={props.onSave} disabled={props.saving}>
            {props.saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
