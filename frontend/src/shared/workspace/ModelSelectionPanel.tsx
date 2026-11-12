import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import AddOutlined from '@mui/icons-material/AddOutlined';
import CallSplitOutlined from '@mui/icons-material/CallSplitOutlined';
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DriveFileRenameOutlineOutlined from '@mui/icons-material/DriveFileRenameOutlineOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import FolderSpecialOutlined from '@mui/icons-material/FolderSpecialOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import MoreVert from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
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
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { MODEL_KIND_COLOR, ModelKindIcon } from './WorkspaceIcons';
import { OverflowText } from './OverflowText';
import { CommonModelChip, ModelExtendsCaption, PackageGroupHeader } from './PackageGroupParts';
import { ModelPackageDialog } from './ModelPackageDialog';
import {
  createPackage,
  deletePackage,
  extendsOf,
  isCommon,
  modelKey,
  moveModel,
  orderedPackages,
  packageIdOf,
  renamePackage,
  SHARED_PACKAGE_ID,
  usePackageState,
  type ModelPackage,
} from './modelPackages';
import { MODEL_KIND_LABEL, type ModelKind, type WorkspaceModel } from './workspaceModel';

export type ModelKindFilter = ModelKind | 'all';

/** Filter a model list the way the panel's toggles and Active checkbox do. */
export function filterModels(models: WorkspaceModel[], kind: ModelKindFilter, activeOnly: boolean): WorkspaceModel[] {
  return models.filter((model) => (kind === 'all' || model.kind === kind) && (!activeOnly || model.status === 'active'));
}

/**
 * + Model: opens Create Model, where the model type is chosen. It sits at the
 * right of the Model Navigation bar (MWS only — SWS works on models MWS has
 * defined).
 */
export function CreateModelButton(props: { onCreate: () => void }) {
  return (
    <Tooltip title="New model">
      <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={props.onCreate} aria-label="New model" sx={{ flexShrink: 0, ...COMPACT_ON_PHONE }}>
        <span className="pdp-button-label">Model</span>
      </Button>
    </Tooltip>
  );
}

/** On a phone the + buttons keep only their icon, so both fit beside the tabs. */
const COMPACT_ON_PHONE = {
  minWidth: { xs: 36, sm: 64 },
  px: { xs: 1, sm: 1.25 },
  '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } },
  '& .pdp-button-label': { display: { xs: 'none', sm: 'inline' } },
} as const;

/**
 * + Package: a secondary action beside + Model (MWS only). Creates an empty
 * package; models are then started in it or moved into it.
 */
export function CreatePackageButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => setOpen(false);
  const save = () => {
    try {
      createPackage(name);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the package.');
    }
  };
  return (
    <>
      <Tooltip title="New package">
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddOutlined />}
          aria-label="New package"
          onClick={() => {
            setName('');
            setError(null);
            setOpen(true);
          }}
          sx={{ flexShrink: 0, bgcolor: 'background.paper', ...COMPACT_ON_PHONE }}
        >
          <span className="pdp-button-label">Package</span>
        </Button>
      </Tooltip>
      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>New package</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              autoFocus
              fullWidth
              label="Package name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (name.trim()) save();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={!name.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

const COLLAPSED_KEY = 'pdp-model-selection-collapsed-packages';

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

type PackageDialog = { mode: 'create' } | { mode: 'rename'; pkg: ModelPackage } | null;

/**
 * Model Selection — the same panel in MWS and SWS.
 *
 * Models are grouped by the Package that owns them; each package folds and
 * shows how many models it holds. One search covers package and model names,
 * and the kind toggles and Active filter work across every package. A model
 * that extends a common model says which one.
 *
 * MWS manages packages (`manage`): create, rename, delete an empty one, start a
 * model in a package, and move a model or set what it extends.
 */
export function ModelSelectionPanel(props: {
  models: WorkspaceModel[];
  selected: { kind: ModelKind; id: string } | null;
  onSelect: (kind: ModelKind, id: string) => void;
  /** ⌂ — back to the workspace's landing page. */
  onHome?: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  loading?: boolean;
  /** MWS only: package management, and + Model inside a package. */
  manage?: { onCreateInPackage: (packageId: string) => void };
  /**
   * Pick several models at once (keys are `kind:id`): each row shows a tick,
   * and `onSelect` toggles the model in or out.
   */
  multiSelected?: ReadonlySet<string>;
  /** Heading of the panel; "Model Selection" by default. */
  title?: string;
  /** Told whenever the Active filter changes. */
  onActiveOnlyChange?: (activeOnly: boolean) => void;
}) {
  const s = usePackageState();
  const [kindFilter, setKindFilter] = useState<KindFilterState>('all');
  const [activeOnly, setActiveOnlyState] = useState(false);
  const setActiveOnly = (next: boolean) => {
    setActiveOnlyState(next);
    props.onActiveOnlyChange?.(next);
  };
  const [search, setSearch] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(readCollapsed);
  const [packageMenu, setPackageMenu] = useState<{ anchor: HTMLElement; pkg: ModelPackage } | null>(null);
  const [modelMenu, setModelMenu] = useState<{ anchor: HTMLElement; model: WorkspaceModel } | null>(null);
  const [packageDialog, setPackageDialog] = useState<PackageDialog>(null);
  const [packageName, setPackageName] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<WorkspaceModel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedIds]));
    } catch {
      // Not remembered.
    }
  }, [collapsedIds]);

  const byKey = useMemo(() => new Map(props.models.map((m) => [modelKey(m), m])), [props.models]);
  const filtered = useMemo(() => filterModels(props.models, kindFilter, activeOnly), [props.models, kindFilter, activeOnly]);
  const query = search.trim().toLocaleLowerCase();
  const packages = orderedPackages(s);

  const groups = useMemo(
    () =>
      packages
        .map((pkg) => {
          const all = props.models.filter((m) => packageIdOf(s, modelKey(m)) === pkg.id);
          const passing = filtered.filter((m) => packageIdOf(s, modelKey(m)) === pkg.id);
          // A package found by its name shows all of its (filtered) models.
          const packageMatch = Boolean(query) && pkg.name.toLocaleLowerCase().includes(query);
          const shown = !query || packageMatch ? passing : passing.filter((m) => m.name.toLocaleLowerCase().includes(query));
          return { pkg, total: all.length, shown, packageMatch };
        })
        .filter((group) => !query || group.packageMatch || group.shown.length > 0)
        .filter((group) => !(kindFilter !== 'all' || activeOnly) || group.shown.length > 0 || group.total === 0 || Boolean(query)),
    [packages, props.models, filtered, query, s, kindFilter, activeOnly],
  );

  const selectedKey = props.selected ? `${props.selected.kind}:${props.selected.id}` : null;
  const selectedPackage = selectedKey ? packageIdOf(s, selectedKey) : null;

  // The open model's package unfolds, so the model can be seen in the list.
  useEffect(() => {
    if (!selectedPackage) return;
    setCollapsedIds((previous) => {
      if (!previous.has(selectedPackage)) return previous;
      const next = new Set(previous);
      next.delete(selectedPackage);
      return next;
    });
  }, [selectedPackage]);

  const toggleGroup = (id: string) =>
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openPackageDialog = (dialog: PackageDialog) => {
    setPackageDialog(dialog);
    setPackageName(dialog?.mode === 'rename' ? dialog.pkg.name : '');
    setDialogError(null);
  };
  const savePackage = () => {
    try {
      if (packageDialog?.mode === 'rename') renamePackage(packageDialog.pkg.id, packageName);
      else {
        const pkg = createPackage(packageName);
        setCollapsedIds((previous) => {
          const next = new Set(previous);
          next.delete(pkg.id);
          return next;
        });
      }
      setPackageDialog(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Could not save the package.');
    }
  };

  if (props.collapsed) {
    return (
      <Paper
        variant="outlined"
        sx={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 1, height: '100%' }}
      >
        <Tooltip title="Expand Model Selection" placement="right">
          <IconButton size="small" onClick={props.onToggleCollapsed} aria-label="Expand Model Selection">
            <ChevronRightOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 600, letterSpacing: 0.5, cursor: 'pointer' }}
          onClick={props.onToggleCollapsed}
        >
          {props.title ?? 'Model Selection'}
        </Typography>
      </Paper>
    );
  }

  const otherPackages = modelMenu ? packages.filter((p) => p.id !== packageIdOf(s, modelKey(modelMenu.model))) : [];

  return (
    <Paper variant="outlined" sx={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
          {props.title ?? 'Model Selection'}
        </Typography>
        {props.onHome && (
          <Tooltip title="Workspace home">
            <IconButton size="small" onClick={props.onHome} aria-label="Workspace home">
              <HomeOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Collapse Model Selection">
          <IconButton size="small" onClick={props.onToggleCollapsed} aria-label="Collapse Model Selection">
            <ChevronLeftOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, pb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kindFilter}
          onChange={(_event, value: KindFilterState | null) => value && setKindFilter(value)}
          aria-label="Filter models by kind"
        >
          <ToggleButton value="hierarchy" aria-label="Hierarchy models" sx={{ px: 1 }}>
            <Tooltip title="Hierarchy models">
              <AccountTreeOutlined sx={{ fontSize: 18, color: MODEL_KIND_COLOR.hierarchy }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="support" aria-label="Support domain models" sx={{ px: 1 }}>
            <Tooltip title="Support domain models">
              <HubOutlined sx={{ fontSize: 18, color: MODEL_KIND_COLOR.support }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="all" sx={{ px: 1.25, fontSize: 12, fontWeight: 700 }}>
            All
          </ToggleButton>
        </ToggleButtonGroup>
        <FormControlLabel
          control={<Checkbox size="small" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} />}
          label={<Typography variant="caption">Active</Typography>}
          sx={{ mr: 0 }}
        />
      </Stack>

      <Box sx={{ px: 1.5, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search packages and models"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" aria-label="Clear search" onClick={() => setSearch('')}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
      </Box>

      {notice && (
        <Alert severity="warning" onClose={() => setNotice(null)} sx={{ mx: 1.5, mb: 1, py: 0 }}>
          {notice}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {props.loading ? 'Loading models…' : query ? 'No packages or models match.' : 'No models match these filters.'}
          </Typography>
        ) : (
          <List dense disablePadding>
            {groups.map(({ pkg, total, shown }) => {
              const filteredOut = kindFilter !== 'all' || activeOnly || Boolean(query);
              // Searching opens every package with a match; so does holding the open model.
              const open = Boolean(query) || !collapsedIds.has(pkg.id);
              return (
                <Box key={pkg.id} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                  <PackageGroupHeader
                    pkg={pkg}
                    open={open}
                    onToggle={() => toggleGroup(pkg.id)}
                    shown={shown.length}
                    total={total}
                    filtered={filteredOut}
                    actions={
                      props.manage && (
                        <IconButton
                          size="small"
                          className="pdp-pkg-menu"
                          aria-label={`Package options for ${pkg.name}`}
                          onClick={(event: MouseEvent<HTMLElement>) => setPackageMenu({ anchor: event.currentTarget, pkg })}
                          sx={{ opacity: 0.5, p: 0.25 }}
                        >
                          <MoreVert sx={{ fontSize: 16 }} />
                        </IconButton>
                      )
                    }
                  />
                  {open && (
                    <Box>
                      {shown.length === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4.5, py: 0.75 }}>
                          {total === 0 ? 'No models in this package yet.' : 'No models match these filters.'}
                        </Typography>
                      )}
                      {shown.map((model) => {
                        const key = modelKey(model);
                        const isSelected = props.multiSelected ? props.multiSelected.has(key) : key === selectedKey;
                        const base = extendsOf(s, key);
                        const baseModel = base ? byKey.get(base) : undefined;
                        return (
                          <Stack key={key} direction="row" alignItems="center" sx={{ '&:hover .pdp-model-menu': { opacity: 1 } }}>
                            <ListItemButton
                              selected={isSelected}
                              onClick={() => props.onSelect(model.kind, model.id)}
                              sx={{ flex: 1, minWidth: 0, gap: 1.25, py: 0.6, pl: props.multiSelected ? 1.5 : 3.5 }}
                            >
                              {props.multiSelected && (
                                <Checkbox
                                  size="small"
                                  checked={isSelected}
                                  tabIndex={-1}
                                  inputProps={{ 'aria-label': `${isSelected ? 'Remove' : 'Add'} ${model.name}` }}
                                  sx={{ p: 0.25, mr: -0.5 }}
                                />
                              )}
                              <Tooltip title={MODEL_KIND_LABEL[model.kind]}>
                                <Box sx={{ display: 'inline-flex' }}>
                                  <ModelKindIcon kind={model.kind} size={24} />
                                </Box>
                              </Tooltip>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <OverflowText variant="body2" fontWeight={isSelected ? 700 : 500}>
                                  {model.name}
                                </OverflowText>
                                {baseModel && <ModelExtendsCaption baseName={baseModel.name} />}
                              </Box>
                              {isCommon(s, key) && <CommonModelChip />}
                              {model.status !== 'active' && <Chip size="small" label={lifecycleLabel(model.status)} variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
                            </ListItemButton>
                            {props.manage && (
                              <IconButton
                                size="small"
                                className="pdp-model-menu"
                                aria-label={`Package options for model ${model.name}`}
                                onClick={(event: MouseEvent<HTMLElement>) => setModelMenu({ anchor: event.currentTarget, model })}
                                sx={{ opacity: 0, p: 0.25, mr: 0.5 }}
                              >
                                <MoreVert sx={{ fontSize: 16 }} />
                              </IconButton>
                            )}
                          </Stack>
                        );
                      })}
                    </Box>
                  )}
                </Box>
              );
            })}
          </List>
        )}
      </Box>

      {/* Package actions */}
      <Menu anchorEl={packageMenu?.anchor} open={Boolean(packageMenu)} onClose={() => setPackageMenu(null)}>
        <MenuItem
          dense
          onClick={() => {
            if (packageMenu) props.manage?.onCreateInPackage(packageMenu.pkg.id);
            setPackageMenu(null);
          }}
        >
          <ListItemIcon><AddOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>New model in this package</ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            if (packageMenu) openPackageDialog({ mode: 'rename', pkg: packageMenu.pkg });
            setPackageMenu(null);
          }}
        >
          <ListItemIcon><DriveFileRenameOutlineOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>Rename package</ListItemText>
        </MenuItem>
        {packageMenu && packageMenu.pkg.id !== SHARED_PACKAGE_ID && (() => {
          const count = props.models.filter((m) => packageIdOf(s, modelKey(m)) === packageMenu.pkg.id).length;
          return (
            <Tooltip title={count > 0 ? 'A package that contains models cannot be deleted' : ''} placement="right">
              <span>
                <MenuItem
                  dense
                  disabled={count > 0}
                  onClick={() => {
                    try {
                      deletePackage(packageMenu.pkg.id, props.models);
                    } catch (error) {
                      setNotice(error instanceof Error ? error.message : 'Could not delete the package.');
                    }
                    setPackageMenu(null);
                  }}
                  sx={{ color: 'error.main' }}
                >
                  <ListItemIcon><DeleteOutlineOutlined fontSize="small" color="error" /></ListItemIcon>
                  <ListItemText>{count > 0 ? `Delete package (${count} model${count === 1 ? '' : 's'})` : 'Delete package'}</ListItemText>
                </MenuItem>
              </span>
            </Tooltip>
          );
        })()}
      </Menu>

      {/* Model actions */}
      <Menu anchorEl={modelMenu?.anchor} open={Boolean(modelMenu)} onClose={() => setModelMenu(null)}>
        <MenuItem
          dense
          onClick={() => {
            if (modelMenu) setSettingsFor(modelMenu.model);
            setModelMenu(null);
          }}
        >
          <ListItemIcon><SettingsOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>Package &amp; extension…</ListItemText>
        </MenuItem>
        {otherPackages.length > 0 && <Divider />}
        {otherPackages.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block', fontWeight: 700 }}>
            Move to package
          </Typography>
        )}
        {otherPackages.map((pkg) => (
          <MenuItem
            key={pkg.id}
            dense
            onClick={() => {
              if (modelMenu) {
                try {
                  moveModel(modelKey(modelMenu.model), pkg.id);
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : 'Could not move the model.');
                }
              }
              setModelMenu(null);
            }}
          >
            <ListItemIcon>{pkg.id === SHARED_PACKAGE_ID ? <FolderSpecialOutlined fontSize="small" /> : <FolderOutlined fontSize="small" />}</ListItemIcon>
            <ListItemText>{pkg.name}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={packageDialog !== null} onClose={() => setPackageDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{packageDialog?.mode === 'rename' ? 'Rename package' : 'New package'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {dialogError && <Alert severity="error">{dialogError}</Alert>}
            <TextField
              autoFocus
              fullWidth
              label="Package name"
              value={packageName}
              onChange={(event) => setPackageName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  savePackage();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPackageDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={savePackage} disabled={!packageName.trim()}>
            {packageDialog?.mode === 'rename' ? 'Rename' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <ModelPackageDialog model={settingsFor} models={props.models} onClose={() => setSettingsFor(null)} />
    </Paper>
  );
}

type KindFilterState = ModelKindFilter;
