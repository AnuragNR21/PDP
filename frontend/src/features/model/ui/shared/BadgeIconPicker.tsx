import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import {
  addCustomIcon,
  customIconId,
  encodeIconValue,
  iconFromValue,
  IconValidationError,
  MAX_ICON_FILE_BYTES,
  readIconFile,
  removeCustomIcon,
  renameCustomIcon,
  sanitiseSvg,
  useCustomIconLibrary,
} from '../../domain/customBadgeIcons';
import type { MetadataOption } from '../../domain/types';
import { BadgeIcon } from './BadgeIcon';

const CUSTOM_COLOR = '#7B1FA2';
const PREVIEW_SIZES = [20, 28, 42];

type Usage = { name: string; where: string };
type KnownIcon = { id: string; svg: string; name: string | null };

/** Draw a cleaned icon in the current text colour. */
function SvgGlyph({ svg, size }: { svg: string; size: number }) {
  return <Box component="span" sx={{ width: size, height: size, display: 'inline-flex', '& svg': { width: '100%', height: '100%', display: 'block' } }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * The badge icon selector: the standard PDP icons, then this organisation's
 * custom icons (marked, with a dashed purple frame), with upload, rename and
 * delete. A custom icon is stored on the badge itself, so it shows wherever the
 * badge does and can be used on any number of node types and element types.
 */
export function BadgeIconPicker(props: {
  value: string | null;
  onChange: (value: string) => void;
  standardIcons: MetadataOption[];
  standardRender: Record<string, ReactElement>;
  badgeColor: string;
  badgeTextColor: string;
  badgeShape: Parameters<typeof BadgeIcon>[0]['badgeShape'];
}) {
  const library = useCustomIconLibrary();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ fileName: string; raw: string; name: string; recolour: boolean; svg: string | null; error: string | null } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  // Every node type and element type with its badge — where custom icons are in use.
  const typesQuery = useQuery({ queryKey: ['cross-model-type-options'], queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions() });
  const usage = useMemo(() => {
    const map = new Map<string, { svg: string; uses: Usage[] }>();
    const types = [...(typesQuery.data?.nodeTypes ?? []), ...(typesQuery.data?.elementTypes ?? [])];
    for (const type of types) {
      const icon = iconFromValue(type.badge?.badgeIcon);
      if (!icon) continue;
      const entry = map.get(icon.id) ?? { svg: icon.svg, uses: [] };
      entry.uses.push({ name: type.name, where: `${type.kind === 'HIERARCHY_MODEL' ? 'Node type' : 'Element type'} · ${type.modelName}` });
      map.set(icon.id, entry);
    }
    return map;
  }, [typesQuery.data]);

  // The library, plus any custom icon already in use (or on this badge) that this browser has not named.
  const known = useMemo<KnownIcon[]>(() => {
    const list: KnownIcon[] = library.map((i) => ({ id: i.id, svg: i.svg, name: i.name }));
    const seen = new Set(list.map((i) => i.id));
    for (const [id, entry] of usage) if (!seen.has(id)) {
      list.push({ id, svg: entry.svg, name: null });
      seen.add(id);
    }
    const current = iconFromValue(props.value);
    if (current && !seen.has(current.id)) list.push({ id: current.id, svg: current.svg, name: null });
    return list;
  }, [library, usage, props.value]);

  const selectedCustom = customIconId(props.value);

  const startUpload = async (file: File) => {
    setError(null);
    try {
      // Read as text first so the colour choice can be re-applied without re-reading.
      const svg = await readIconFile(file, true);
      setPending({ fileName: file.name, raw: await file.text(), name: file.name.replace(/\.svg$/i, ''), recolour: true, svg, error: null });
    } catch (err) {
      setError(err instanceof IconValidationError ? err.message : `“${file.name}” could not be read.`);
    }
  };

  const setRecolour = (recolour: boolean) => {
    if (!pending) return;
    try {
      setPending({ ...pending, recolour, svg: sanitiseSvg(pending.raw, recolour), error: null });
    } catch (err) {
      setPending({ ...pending, recolour, error: err instanceof Error ? err.message : 'The icon could not be read.' });
    }
  };

  const confirmUpload = () => {
    if (!pending?.svg) return;
    try {
      const icon = addCustomIcon(pending.name, pending.svg);
      props.onChange(encodeIconValue(icon));
      setPending(null);
    } catch (err) {
      setPending({ ...pending, error: err instanceof Error ? err.message : 'Could not add the icon.' });
    }
  };

  const tileSx = (selected: boolean, custom: boolean) => ({
    border: selected ? '2px solid' : custom ? '1px dashed' : '1px solid',
    borderColor: selected ? 'primary.main' : custom ? `${CUSTOM_COLOR}88` : 'divider',
    borderRadius: 1,
    bgcolor: selected ? 'primary.50' : 'transparent',
    width: 36,
    height: 36,
    position: 'relative' as const,
  });

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" fontWeight={600}>Icon</Typography>

      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Standard PDP icons
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={0.5}>
        {props.standardIcons.map((icon) => (
          <Tooltip key={icon.key} title={icon.label}>
            <IconButton size="small" aria-label={`Standard icon ${icon.label}`} onClick={() => props.onChange(icon.key)} sx={tileSx(props.value === icon.key, false)}>
              {props.standardRender[icon.key]}
            </IconButton>
          </Tooltip>
        ))}
      </Stack>

      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pt: 0.5 }}>
        <Typography variant="caption" sx={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: CUSTOM_COLOR, fontWeight: 700, flex: 1 }}>
          Custom icons
        </Typography>
        <Tooltip title={`Upload an SVG icon (up to ${MAX_ICON_FILE_BYTES / 1024} KB)`}>
          <Button size="small" startIcon={<UploadFileOutlined sx={{ fontSize: '16px !important' }} />} onClick={() => inputRef.current?.click()} sx={{ fontSize: 11, py: 0 }}>
            Upload SVG
          </Button>
        </Tooltip>
        <Tooltip title="Rename or delete custom icons">
          <span>
            <IconButton size="small" aria-label="Manage custom icons" onClick={() => setManageOpen(true)} disabled={known.length === 0}>
              <SettingsOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          data-testid="custom-icon-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void startUpload(file);
          }}
        />
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0, fontSize: 12 }}>
          {error}
        </Alert>
      )}
      {known.length === 0 ? (
        <Typography variant="caption" color="text.secondary">No custom icons yet — upload an SVG to add one.</Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          {known.map((icon) => (
            <Tooltip key={icon.id} title={`${icon.name ?? 'Custom icon'} · custom`}>
              <IconButton
                size="small"
                aria-label={`Custom icon ${icon.name ?? icon.id}`}
                onClick={() => props.onChange(encodeIconValue(icon))}
                sx={{ ...tileSx(selectedCustom === icon.id, true), color: 'text.secondary' }}
              >
                <SvgGlyph svg={icon.svg} size={20} />
                <Box sx={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', bgcolor: CUSTOM_COLOR }} />
              </IconButton>
            </Tooltip>
          ))}
        </Stack>
      )}

      {/* Add a custom icon: name it, choose colours, see it at badge sizes. */}
      <Dialog open={pending !== null} onClose={() => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Add custom icon</DialogTitle>
        <DialogContent>
          {pending && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {pending.error && <Alert severity="error">{pending.error}</Alert>}
              <Stack direction="row" spacing={2} alignItems="flex-end" justifyContent="center" sx={{ py: 1 }}>
                {pending.svg !== null &&
                  PREVIEW_SIZES.map((size) => (
                    <Stack key={size} alignItems="center" spacing={0.5}>
                      <BadgeIcon
                        badgeShape={props.badgeShape}
                        badgeColor={props.badgeColor}
                        badgeTextColor={props.badgeTextColor}
                        badgeIcon={encodeIconValue({ id: 'preview', svg: pending.svg ?? '' })}
                        badgeSize={size}
                        badgeContentType="icon"
                      />
                      <Typography variant="caption" color="text.secondary">{size}px</Typography>
                    </Stack>
                  ))}
              </Stack>
              <TextField label="Icon name" fullWidth autoFocus value={pending.name} onChange={(event) => setPending({ ...pending, name: event.target.value })} />
              <FormControlLabel
                control={<Checkbox checked={pending.recolour} onChange={(event) => setRecolour(event.target.checked)} />}
                label={
                  <Stack>
                    <Typography variant="body2">Use the badge’s icon colour</Typography>
                    <Typography variant="caption" color="text.secondary">Off keeps the icon’s own colours (for a logo).</Typography>
                  </Stack>
                }
              />
              <Typography variant="caption" color="text.secondary">
                From {pending.fileName}. Scripts, links and embedded images are removed; only the drawing is kept.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="contained" onClick={confirmUpload} disabled={!pending?.svg || !pending.name.trim()}>
            Add icon
          </Button>
        </DialogActions>
      </Dialog>

      <ManageCustomIconsDialog open={manageOpen} icons={known} usage={usage} onClose={() => setManageOpen(false)} />
    </Stack>
  );
}

function ManageCustomIconsDialog(props: {
  open: boolean;
  icons: KnownIcon[];
  usage: Map<string, { svg: string; uses: Usage[] }>;
  onClose: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KnownIcon | null>(null);

  const save = (icon: KnownIcon) => {
    setError(null);
    try {
      renameCustomIcon(icon, names[icon.id] ?? icon.name ?? '');
      setNames((n) => {
        const next = { ...n };
        delete next[icon.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the icon.');
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Custom icons</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {props.icons.map((icon) => {
            const uses = props.usage.get(icon.id)?.uses ?? [];
            const draft = names[icon.id] ?? icon.name ?? '';
            const changed = draft.trim() !== (icon.name ?? '');
            return (
              <Stack key={icon.id} direction="row" spacing={1.25} alignItems="center" data-custom-icon={icon.id}>
                <Box sx={{ width: 34, height: 34, border: '1px dashed', borderColor: `${CUSTOM_COLOR}88`, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.primary', flexShrink: 0 }}>
                  <SvgGlyph svg={icon.svg} size={20} />
                </Box>
                <TextField
                  size="small"
                  label="Name"
                  placeholder="Unnamed custom icon"
                  value={draft}
                  onChange={(event) => setNames((n) => ({ ...n, [icon.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && changed) save(icon);
                  }}
                  sx={{ flex: 1 }}
                />
                <Button size="small" onClick={() => save(icon)} disabled={!changed || !draft.trim()}>
                  Rename
                </Button>
                <Tooltip
                  title={
                    uses.length === 0 ? (
                      'Not used by any badge'
                    ) : (
                      <Box>
                        {uses.map((u) => (
                          <div key={`${u.name}-${u.where}`}>
                            {u.name} — {u.where}
                          </div>
                        ))}
                      </Box>
                    )
                  }
                >
                  <Chip size="small" label={uses.length === 0 ? 'Not in use' : `Used by ${uses.length}`} color={uses.length ? 'primary' : 'default'} variant="outlined" sx={{ height: 22, fontSize: 11 }} />
                </Tooltip>
                <Tooltip title={uses.length ? 'In use — change those badges to another icon before deleting it' : icon.name === null ? 'Not in this library' : 'Delete icon'}>
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`Delete custom icon ${icon.name ?? icon.id}`}
                      disabled={uses.length > 0 || icon.name === null}
                      onClick={() => setConfirmDelete(icon)}
                    >
                      <DeleteOutlineOutlined fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            );
          })}
          <Typography variant="caption" color="text.secondary">
            An icon used by a badge cannot be deleted — hover “Used by” to see where, and choose another icon there first.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete custom icon?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">“{confirmDelete?.name}” is not used by any badge and will be removed from the icon selector.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (confirmDelete) removeCustomIcon(confirmDelete.id);
              setConfirmDelete(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
