import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import ChevronRightOutlined from "@mui/icons-material/ChevronRightOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import FolderSpecialOutlined from "@mui/icons-material/FolderSpecialOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { MODEL_KIND_COLOR, ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import { modelKey, orderedPackages, packageIdOf, SHARED_PACKAGE_ID, usePackageState } from "@/shared/workspace/modelPackages";
import { MODEL_KIND_LABEL, type ModelKind } from "@/shared/workspace/workspaceModel";
import type { ModelKindFilter } from "@/shared/workspace/ModelSelectionPanel";
import { LifecycleChip } from "@/features/structure/ui/workspace/lifecycle";

export type ExportModelOption = {
  id: string;
  name: string;
  /** Lifecycle status (draft / active / retired) — shown, never used to hide a model. */
  status?: string;
};

type ExportModel = { id: string; name: string; kind: ModelKind; status: string; key: string };

type ExportOptionsDialogProps = {
  open: boolean;
  hierarchyModels: ExportModelOption[];
  supportDomainModels: ExportModelOption[];
  isLoadingModels: boolean;
  isExporting: boolean;
  error?: string | null;
  onClose: () => void;
  onExport: (hierarchyModelIds: string[], supportDomainModelIds: string[]) => void;
};

/**
 * Export Structure Data — the models to export, chosen the way PDP's Model
 * Selection panel chooses a model: grouped by Package (Shared Models first,
 * then by name; models in the panel's order), the same model-type icons and Hierarchy / Support Domain / All
 * toggle, one search over package and model names, and lifecycle status shown.
 *
 * Search, the type toggle and folding a package only change what is shown;
 * the selection is kept, and a package says how many of its models are
 * selected even when folded. The selection decides which models are exported
 * and nothing else.
 */
export function ExportOptionsDialog({
  open,
  hierarchyModels,
  supportDomainModels,
  isLoadingModels,
  isExporting,
  error,
  onClose,
  onExport,
}: ExportOptionsDialogProps) {
  const packageState = usePackageState();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ModelKindFilter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const models = useMemo<ExportModel[]>(
    () => [
      ...hierarchyModels.map((m) => ({ id: m.id, name: m.name, kind: "hierarchy" as const, status: m.status ?? "active", key: modelKey({ kind: "hierarchy", id: m.id }) })),
      ...supportDomainModels.map((m) => ({ id: m.id, name: m.name, kind: "support" as const, status: m.status ?? "active", key: modelKey({ kind: "support", id: m.id }) })),
    ],
    [hierarchyModels, supportDomainModels],
  );
  const allKeys = useMemo(() => models.map((m) => m.key), [models]);

  // Each time the dialog opens: every model selected (as before), search and filter cleared.
  useEffect(() => {
    if (open) {
      setSelected(new Set(allKeys));
      setSearch("");
      setKindFilter("all");
    }
  }, [open, allKeys]);

  const query = search.trim().toLocaleLowerCase();
  const groups = useMemo(() => {
    return orderedPackages(packageState)
      .map((pkg) => {
        // Same order as the Model Selection panel: hierarchy models, then support domain models, each as listed there.
        const all = models.filter((m) => packageIdOf(packageState, m.key) === pkg.id);
        const ofKind = all.filter((m) => kindFilter === "all" || m.kind === kindFilter);
        // A package found by its name shows all of its models (of the chosen type).
        const packageMatch = Boolean(query) && pkg.name.toLocaleLowerCase().includes(query);
        const shown = !query || packageMatch ? ofKind : ofKind.filter((m) => m.name.toLocaleLowerCase().includes(query));
        return { pkg, all, shown };
      })
      .filter((group) => group.shown.length > 0);
  }, [packageState, models, kindFilter, query]);

  const shownKeys = groups.flatMap((g) => g.shown.map((m) => m.key));
  const selectedCount = allKeys.filter((key) => selected.has(key)).length;
  const hiddenSelected = selectedCount - shownKeys.filter((key) => selected.has(key)).length;
  const filtering = kindFilter !== "all" || Boolean(query);

  function setMany(keys: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExport() {
    const hierarchyModelIds = models.filter((m) => m.kind === "hierarchy" && selected.has(m.key)).map((m) => m.id);
    const supportDomainModelIds = models.filter((m) => m.kind === "support" && selected.has(m.key)).map((m) => m.id);
    onExport(hierarchyModelIds, supportDomainModelIds);
  }

  const hasModels = models.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Export Structure Data</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Select the models to export. A CSV is downloaded per data type (hierarchy node instances, SD element instances with the
            links drawn between them on the diagram), ready to be read straight back in on the Import step.
          </Typography>

          {isLoadingModels ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Loading models…
              </Typography>
            </Stack>
          ) : !hasModels ? (
            <Alert severity="info">No models available to export.</Alert>
          ) : (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search models and packages"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" aria-label="Clear search" onClick={() => setSearch("")}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  }}
                />
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={kindFilter}
                  onChange={(_event, value: ModelKindFilter | null) => value && setKindFilter(value)}
                  aria-label="Filter models by type"
                  sx={{ flexShrink: 0 }}
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
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button size="small" onClick={() => setMany(shownKeys, true)} disabled={shownKeys.length === 0}>
                  {filtering ? `Select all shown (${shownKeys.length})` : "Select all"}
                </Button>
                <Button size="small" onClick={() => setSelected(new Set())} disabled={selectedCount === 0}>
                  Clear selection
                </Button>
                <Box flex={1} />
                {hiddenSelected > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {hiddenSelected} selected not shown
                  </Typography>
                )}
              </Stack>

              <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 360, overflowY: "auto" }}>
                {groups.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                    {query ? "No packages or models match." : "No models of this type."}
                  </Typography>
                )}
                {groups.map(({ pkg, all, shown }) => {
                  const isOpen = Boolean(query) || !collapsed.has(pkg.id);
                  const shownSelected = shown.filter((m) => selected.has(m.key)).length;
                  const packageSelected = all.filter((m) => selected.has(m.key)).length;
                  const shared = pkg.id === SHARED_PACKAGE_ID;
                  return (
                    <Box key={pkg.id} sx={{ borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ bgcolor: "grey.50", pr: 1, py: 0.25 }}>
                        <IconButton size="small" onClick={() => toggleCollapsed(pkg.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${pkg.name}`}>
                          {isOpen ? <ExpandMoreOutlined sx={{ fontSize: 18 }} /> : <ChevronRightOutlined sx={{ fontSize: 18 }} />}
                        </IconButton>
                        <Tooltip title={filtering ? "Select the models of this package that are shown" : "Select every model in this package"}>
                          <Checkbox
                            size="small"
                            sx={{ p: 0.5 }}
                            checked={shownSelected === shown.length}
                            indeterminate={shownSelected > 0 && shownSelected < shown.length}
                            onChange={(event) => setMany(shown.map((m) => m.key), event.target.checked)}
                            inputProps={{ "aria-label": `Select package ${pkg.name}` }}
                          />
                        </Tooltip>
                        {shared ? (
                          <FolderSpecialOutlined sx={{ fontSize: 18, color: "#F9A825" }} />
                        ) : (
                          <FolderOutlined sx={{ fontSize: 18, color: "text.secondary" }} />
                        )}
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          noWrap
                          sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                          onClick={() => toggleCollapsed(pkg.id)}
                        >
                          {pkg.name}
                        </Typography>
                        <Chip
                          size="small"
                          color={packageSelected > 0 ? "primary" : "default"}
                          variant={packageSelected > 0 ? "filled" : "outlined"}
                          label={`${packageSelected}/${all.length} selected`}
                          sx={{ height: 20, fontSize: 11, fontWeight: 600 }}
                        />
                      </Stack>
                      {isOpen &&
                        shown.map((model) => {
                          const checked = selected.has(model.key);
                          return (
                            <Stack
                              key={model.key}
                              direction="row"
                              alignItems="center"
                              spacing={1}
                              onClick={() => setMany([model.key], !checked)}
                              sx={{
                                pl: 4.5,
                                pr: 1,
                                py: 0.4,
                                cursor: "pointer",
                                bgcolor: checked ? "action.selected" : undefined,
                                "&:hover": { bgcolor: checked ? "action.selected" : "action.hover" },
                              }}
                            >
                              <Checkbox
                                size="small"
                                sx={{ p: 0.5 }}
                                checked={checked}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => setMany([model.key], event.target.checked)}
                                inputProps={{ "aria-label": `Select ${model.name}` }}
                              />
                              <Tooltip title={MODEL_KIND_LABEL[model.kind]}>
                                <Box sx={{ display: "inline-flex" }}>
                                  <ModelKindIcon kind={model.kind} size={22} />
                                </Box>
                              </Tooltip>
                              <Typography variant="body2" fontWeight={checked ? 600 : 400} noWrap sx={{ flex: 1, minWidth: 0 }} title={model.name}>
                                {model.name}
                              </Typography>
                              <LifecycleChip status={model.status} showActive />
                            </Stack>
                          );
                        })}
                    </Box>
                  );
                })}
              </Box>

              <Typography variant="body2" fontWeight={600}>
                {selectedCount} model{selectedCount === 1 ? "" : "s"} selected
              </Typography>
            </>
          )}

          {hasModels && selectedCount === 0 && <Alert severity="warning">Select at least one model to export.</Alert>}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={isExporting ? <CircularProgress size={14} /> : <DownloadOutlinedIcon />}
          onClick={handleExport}
          disabled={isExporting || selectedCount === 0}
        >
          Export
        </Button>
      </DialogActions>
    </Dialog>
  );
}
