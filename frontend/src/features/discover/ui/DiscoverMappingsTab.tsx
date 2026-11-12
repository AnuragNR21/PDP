import { useEffect, useMemo, useState } from "react";
import { scrollToMarked } from "@/shared/workspace/useFocusParam";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import { DiscoverModelPicker } from "./DiscoverModelPicker";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import { SourceApplicationSummary } from "@/features/discover/ui/DiscoverSourceApplication";
import type { AutoMapResult } from "@/features/discover/api/discoverApi";
import type { OverviewReadModel } from "@/shared/contracts";

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
  overview: OverviewReadModel;
};

type SourceField = {
  id: string;
  ordinal: number;
  name: string;
  type: string;
  targetNodeId: string | null;
  targetName: string | null;
};

type ColumnFilter = "all" | "mapped" | "unmapped";

/** A small numbered badge that marks the two steps of the mapping flow. */
function StepBadge({ step, active }: { step: number; active: boolean }) {
  return (
    <Box
      sx={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        color: active ? "primary.contrastText" : "text.disabled",
        bgcolor: active ? "primary.main" : "action.disabledBackground",
      }}
    >
      {step}
    </Box>
  );
}

export function DiscoverMappingsTab({ vm, overview }: Props) {
  const [columnSearch, setColumnSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [columnFilter, setColumnFilter] = useState<ColumnFilter>("all");
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // What auto-mapping just did, kept on screen so the user reviews it rather
  // than discovering the pairings silently changed under them.
  const [autoMapResult, setAutoMapResult] = useState<AutoMapResult | null>(null);
  // column_mapping.column_id references source_column, so the mapping step
  // works in the col_… id space (the Profile step uses discovery_column ids).
  const legacyColumns = vm.columnsQuery.data ?? [];
  const mappings = vm.mappingsQuery.data ?? [];

  const sourceFields: SourceField[] = useMemo(() => {
    const byColumn = new Map(mappings.map((m) => [m.column_id, m]));
    return legacyColumns.map((c, index) => {
      const mapping = byColumn.get(c.column_id);
      return {
        id: c.column_id,
        ordinal: c.ordinal ?? index + 1,
        name: c.column_name,
        type: c.detected_type,
        targetNodeId: mapping?.target_node_id ?? null,
        targetName: mapping?.target_name ?? null,
      };
    });
  }, [legacyColumns, mappings]);

  // Model fields come from the application chosen on the Import step, so only
  // that application's structure is offered as a mapping target.
  const applicationFields = vm.applicationFieldsQuery.data ?? [];

  // One-to-one: each column holds at most one field and each field at most one
  // column, so both sides can be looked up by the other's id.
  const columnByTarget = new Map(
    sourceFields.filter((f) => f.targetNodeId).map((f) => [f.targetNodeId as string, f])
  );

  const mappedCount = sourceFields.filter((f) => f.targetNodeId).length;
  const mappableCount = Math.min(sourceFields.length, applicationFields.length);

  // Step 1 selects the model field; step 2 picks the column it belongs to.
  const selectedTargetId = vm.selectedTargetNodeId;
  const selectedTarget = applicationFields.find((f) => f.node_id === selectedTargetId) ?? null;

  // Drop a selection that belongs to a previous file or application.
  useEffect(() => {
    if (selectedTargetId && !applicationFields.some((f) => f.node_id === selectedTargetId)) {
      vm.setSelectedTargetNodeId("");
    }
  }, [applicationFields, selectedTargetId]);

  // A global search hit on a column or a mapping arrives with that column
  // (source_column id) selected: show it — its paired model field chosen on
  // the left, the column marked and scrolled to. Handled once, then let go,
  // so coming back to this step later does not pull the choice back.
  const [focusedColumnId, setFocusedColumnId] = useState<string | null>(null);
  useEffect(() => {
    const column = sourceFields.find((f) => f.id === vm.selectedColumnId);
    if (!column) return;
    setColumnSearch("");
    setColumnFilter("all");
    if (column.targetNodeId) vm.setSelectedTargetNodeId(column.targetNodeId);
    setFocusedColumnId(column.id);
    scrollToMarked("data-column-id", column.id);
    vm.setSelectedColumnId("");
  }, [vm.selectedColumnId, sourceFields]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleTargets = applicationFields.filter((field) => {
    const term = targetSearch.toLowerCase();
    return !term || field.name.toLowerCase().includes(term) || field.path.toLowerCase().includes(term);
  });

  const visibleColumns = sourceFields
    .filter((f) =>
      columnFilter === "mapped" ? !!f.targetNodeId : columnFilter === "unmapped" ? !f.targetNodeId : true
    )
    .filter((f) => f.name.toLowerCase().includes(columnSearch.toLowerCase()));

  const applicationName = overview.session.source_application || "the selected model";

  // The model is chosen in the table strip along the bottom, not at import: by
  // now profiling has shown what is in the file, so the right model is obvious.
  const selectedModelId = vm.sourceContextQuery.data?.application_ref_id ?? "";

  // ── Actions ──

  /**
   * Pair everything PDP can match, then hand it back for review. Columns the
   * user already paired are left untouched by the server, so pressing this
   * after some manual work only fills in the gaps.
   */
  const handleAutoMap = async () => {
    setMappingError(null);
    setAutoMapResult(null);
    try {
      setAutoMapResult(await vm.autoMapMutation.mutateAsync());
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMappingError(detail ?? (err instanceof Error ? err.message : "Could not map automatically."));
    }
  };

  /** Step 2: attach the selected model field to this source column. */
  const mapColumn = async (column: SourceField) => {
    if (!selectedTarget) {
      setMappingError("Choose a model field first, then pick the source field it belongs to.");
      return;
    }
    if (column.targetNodeId === selectedTarget.node_id) return; // already this pair
    setMappingError(null);
    setBusyId(column.id);
    try {
      await vm.saveMappingMutation.mutateAsync({
        columnId: column.id,
        targetNodeId: selectedTarget.node_id,
        rationale: `Mapped "${column.name}" to ${selectedTarget.path} in Discover`,
      });
      // Move on to the next model field still waiting for a column.
      const nextField = applicationFields.find(
        (f) => f.node_id !== selectedTarget.node_id && !columnByTarget.has(f.node_id) && f.is_leaf
      );
      vm.setSelectedTargetNodeId(nextField?.node_id ?? "");
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMappingError(detail ?? (err instanceof Error ? err.message : "Could not save this mapping."));
    } finally {
      setBusyId(null);
    }
  };

  const unmap = async (columnId: string) => {
    setMappingError(null);
    setBusyId(columnId);
    try {
      await vm.clearMappingMutation.mutateAsync(columnId);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMappingError(detail ?? (err instanceof Error ? err.message : "Could not remove this mapping."));
    } finally {
      setBusyId(null);
    }
  };

  const progress = mappableCount > 0 ? (mappedCount / mappableCount) * 100 : 0;
  const isComplete = mappableCount > 0 && mappedCount === mappableCount;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Session context + mapping progress */}
      <Card variant="outlined">
        <CardContent sx={{ py: 2, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Stack direction="row" spacing={4} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box display="flex" gap={1} alignItems="center">
              <DescriptionOutlinedIcon color="primary" sx={{ bgcolor: "primary.50", p: 0.5, borderRadius: 1 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">Source file</Typography>
                <Typography variant="body2" fontWeight={500}>{overview.session.source_filename || "N/A"}</Typography>
              </Box>
            </Box>
            {/* Where the data came from (set on Import Data) — not the same
                thing as the model below, which says what the columns mean. */}
            <SourceApplicationSummary
              vm={vm}
              sourceFileId={(vm.sourceFilesQuery.data ?? []).find((f) => f.is_active)?.source_file_id}
            />
            {/* Stated here, chosen below: the summary says what this table is
                being read against, and the panel that lists the model's fields
                is where it gets changed. */}
            <Box display="flex" gap={1} alignItems="center">
              <CategoryOutlinedIcon
                color={selectedModelId ? "primary" : "warning"}
                sx={{ bgcolor: selectedModelId ? "primary.50" : "warning.50", p: 0.5, borderRadius: 1 }}
              />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">Model</Typography>
                <Typography variant="body2" fontWeight={500}>
                  {selectedModelId ? applicationName : "Not chosen yet"}
                </Typography>
              </Box>
            </Box>
          </Stack>

          <Box sx={{ minWidth: 240, display: sourceFields.length === 0 ? "none" : "block" }}>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
              <Typography variant="caption" color="text.secondary">Mapping progress</Typography>
              <Typography variant="body2" fontWeight={600}>
                {mappedCount} of {mappableCount} paired
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={progress}
              color={isComplete ? "success" : "primary"}
              sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
            />
            <Typography variant="caption" color="text.secondary">
              Each model field pairs with exactly one column
            </Typography>
            {selectedModelId && sourceFields.length > 0 && (
              <Button
                fullWidth
                variant={mappedCount === 0 ? "contained" : "outlined"}
                size="small"
                startIcon={
                  vm.autoMapMutation.isPending
                    ? <CircularProgress size={15} color="inherit" />
                    : <AutoFixHighOutlinedIcon />
                }
                onClick={handleAutoMap}
                disabled={vm.autoMapMutation.isPending || mappedCount === sourceFields.length}
                sx={{ mt: 1.5, textTransform: "none", fontWeight: 600 }}
              >
                {vm.autoMapMutation.isPending ? "Matching…" : "Auto map"}
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {autoMapResult && (
        <Alert
          severity={autoMapResult.mapped.length === 0 ? "warning" : "success"}
          onClose={() => setAutoMapResult(null)}
        >
          <Typography variant="body2" fontWeight={600}>
            {autoMapResult.mapped.length === 0
              ? "Nothing could be matched confidently — pair these by hand below."
              : `Paired ${autoMapResult.mapped.length} field${autoMapResult.mapped.length === 1 ? "" : "s"}. Check each one and change any that are wrong.`}
          </Typography>
          {autoMapResult.mapped.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
              {autoMapResult.mapped.map((pair) => (
                <Chip
                  key={pair.column_id}
                  size="small"
                  variant="outlined"
                  color={pair.confidence >= 0.9 ? "success" : "warning"}
                  label={`${pair.column_name} → ${pair.target_name} (${Math.round(pair.confidence * 100)}%)`}
                  sx={{ height: 22, fontSize: "0.7rem" }}
                />
              ))}
            </Stack>
          )}
          {autoMapResult.unmatched.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              No confident match for: {autoMapResult.unmatched.join(", ")} — pair these yourself.
            </Typography>
          )}
        </Alert>
      )}

      {mappingError && (
        <Alert severity="error" onClose={() => setMappingError(null)}>{mappingError}</Alert>
      )}

      {sourceFields.length === 0 ? (
        /* First load, and again whenever a new file is imported: there is
           nothing to map until the file has been profiled. */
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 1.5 }}>
            <AccountTreeOutlinedIcon sx={{ fontSize: 44, color: "primary.main" }} />
            <Typography variant="h6" fontWeight={700}>Profile the file before mapping</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 500 }}>
              {overview.session.source_filename
                ? `${overview.session.source_filename} has not been profiled yet. Run profiling on the Profile Data step — its columns then appear here, ready to pair with your model's fields.`
                : "Import a file and run profiling first. Its columns then appear here, ready to pair with your model fields."}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 3, alignItems: "stretch" }}>

          {/* ── Step 1: model fields of the chosen application ── */}
          <Card
            variant="outlined"
            sx={{
              display: "flex",
              flexDirection: "column",
              minHeight: 620,
              borderColor: selectedTarget ? "divider" : "primary.main",
              borderWidth: selectedTarget ? 1 : 2,
            }}
          >
            <CardContent sx={{ pb: 1.5 }}>
              {/* Wrapping, so a narrow panel drops the model pill to its own
                  line rather than breaking the title across two. */}
              <Stack direction="row" alignItems="center" spacing={1} mb={0.5} flexWrap="wrap" useFlexGap>
                <StepBadge step={1} active={!selectedTarget} />
                <AccountTreeOutlinedIcon color="primary" />
                <Typography variant="h6" fontWeight={600} sx={{ flexShrink: 0 }}>
                  Choose a model field
                </Typography>
              </Stack>

              {/* The model sits on the panel whose contents it decides, and at
                  the size of the decision: everything listed below changes with
                  it. It spent a version in the table tab bar, where a control
                  that is not a tab read as one more table. */}
              <DiscoverModelPicker vm={vm} />
              {selectedModelId && (
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Fields defined for {applicationName} in the model structure. Start here, then pick
                  the column that carries this field's data.
                </Typography>
              )}

              <TextField
                size="small"
                fullWidth
                placeholder={selectedModelId ? `Search fields in ${applicationName}` : "Search model fields"}
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                }}
              />
            </CardContent>

            <Divider />

            <Box sx={{ flexGrow: 1, overflowY: "auto", maxHeight: 620 }}>
              {vm.applicationFieldsQuery.isLoading ? (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 3 }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">Loading model fields…</Typography>
                </Stack>
              ) : !vm.mappingApplicationRefId ? (
                <Alert severity="info" sx={{ m: 2 }}>
                  The model's fields will be listed here once you pick one in the box above.
                </Alert>
              ) : applicationFields.length === 0 ? (
                <Alert severity="info" sx={{ m: 2 }}>
                  {applicationName} has no fields defined in the model structure yet. Pick a different model
                  above, or define its fields in the Structure workspace.
                </Alert>
              ) : (
                <>
                  {visibleTargets.map((field) => {
                    const pairedColumn = columnByTarget.get(field.node_id);
                    const isSelected = field.node_id === selectedTargetId;
                    return (
                      <Box
                        key={field.node_id}
                        onClick={() => vm.setSelectedTargetNodeId(isSelected ? "" : field.node_id)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1.5,
                          pr: 2,
                          pl: 2 + (field.depth - 1) * 2.5,
                          py: 1.25,
                          cursor: "pointer",
                          borderLeft: "3px solid",
                          borderLeftColor: isSelected ? "primary.main" : "transparent",
                          bgcolor: isSelected ? "primary.50" : pairedColumn ? "success.50" : "transparent",
                          borderBottom: "1px solid",
                          borderBottomColor: "divider",
                          "&:hover": { bgcolor: isSelected ? "primary.50" : "action.hover" },
                        }}
                      >
                        {field.is_leaf ? (
                          <LabelOutlinedIcon sx={{ fontSize: 18, color: "primary.main", flexShrink: 0 }} />
                        ) : (
                          <FolderOutlinedIcon sx={{ fontSize: 18, color: "text.disabled", flexShrink: 0 }} />
                        )}

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            fontWeight={field.is_leaf ? 600 : 500}
                            color={field.is_leaf ? "text.primary" : "text.secondary"}
                            noWrap
                          >
                            {field.name}
                          </Typography>
                          {pairedColumn ? (
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
                              <ArrowBackIcon sx={{ fontSize: 13, color: "success.main" }} />
                              <Typography variant="caption" color="success.main" fontWeight={600} noWrap>
                                {pairedColumn.name}
                              </Typography>
                            </Stack>
                          ) : (
                            <Typography variant="caption" color="text.disabled" noWrap sx={{ display: "block" }}>
                              {field.node_type ? `${field.node_type} · ` : ""}{field.path}
                            </Typography>
                          )}
                        </Box>

                        {pairedColumn ? (
                          <Tooltip title={`Unpair "${pairedColumn.name}" from this field`}>
                            <IconButton
                              size="small"
                              onClick={(e) => { e.stopPropagation(); unmap(pairedColumn.id); }}
                              disabled={busyId === pairedColumn.id}
                            >
                              {busyId === pairedColumn.id
                                ? <CircularProgress size={14} />
                                : <CloseIcon sx={{ fontSize: 16 }} />}
                            </IconButton>
                          </Tooltip>
                        ) : isSelected ? (
                          <Chip size="small" label="Selected" color="primary" sx={{ height: 22, fontSize: "0.7rem", fontWeight: 600 }} />
                        ) : null}
                      </Box>
                    );
                  })}
                  {visibleTargets.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: "center" }}>
                      No fields match “{targetSearch}”.
                    </Typography>
                  )}
                </>
              )}
            </Box>
          </Card>

          {/* ── Step 2: columns from the file ── */}
          <Card
            variant="outlined"
            sx={{
              display: "flex",
              flexDirection: "column",
              minHeight: 620,
              borderColor: selectedTarget ? "primary.main" : "divider",
              borderWidth: selectedTarget ? 2 : 1,
              opacity: selectedTarget ? 1 : 0.75,
            }}
          >
            <CardContent sx={{ pb: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                <StepBadge step={2} active={!!selectedTarget} />
                <ViewColumnOutlinedIcon color={selectedTarget ? "primary" : "disabled"} />
                <Typography variant="h6" fontWeight={600}>Choose the source field</Typography>
                <Chip size="small" label={`${sourceFields.length} columns`} sx={{ height: 20, fontSize: "0.7rem" }} />
              </Stack>

              {selectedTarget ? (
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Click the column that holds{" "}
                  <Box component="span" fontWeight={700} color="text.primary">{selectedTarget.name}</Box>
                  {" "}data. It replaces any column currently paired with this field.
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Pick a model field on the left first — then choose its column here.
                </Typography>
              )}

              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search columns"
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                  }}
                />
                <Stack direction="row" spacing={0.5}>
                  {([
                    ["all", `All ${sourceFields.length}`],
                    ["unmapped", `Free ${sourceFields.length - mappedCount}`],
                    ["mapped", `Paired ${mappedCount}`],
                  ] as Array<[ColumnFilter, string]>).map(([key, label]) => (
                    <Chip
                      key={key}
                      label={label}
                      size="small"
                      onClick={() => setColumnFilter(key)}
                      color={columnFilter === key ? "primary" : "default"}
                      variant={columnFilter === key ? "filled" : "outlined"}
                      sx={{ fontWeight: 500 }}
                    />
                  ))}
                </Stack>
              </Stack>
            </CardContent>

            <Divider />

            <Box sx={{ flexGrow: 1, overflowY: "auto", maxHeight: 620 }}>
              {visibleColumns.map((field) => {
                const isBusy = busyId === field.id;
                const isPairedToSelected = !!selectedTarget && field.targetNodeId === selectedTarget.node_id;
                const isPairedElsewhere = !!field.targetNodeId && !isPairedToSelected;
                return (
                  <Box
                    key={field.id}
                    data-column-id={field.id}
                    onClick={() => selectedTarget && !isBusy && mapColumn(field)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      px: 2,
                      py: 1.5,
                      cursor: selectedTarget ? "pointer" : "default",
                      bgcolor: isPairedToSelected ? "success.50" : "transparent",
                      // The column a search result pointed at.
                      boxShadow: focusedColumnId === field.id ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}` : undefined,
                      borderBottom: "1px solid",
                      borderBottomColor: "divider",
                      "&:hover": selectedTarget
                        ? { bgcolor: isPairedToSelected ? "success.50" : "action.hover" }
                        : undefined,
                    }}
                  >
                    <Typography variant="caption" color="text.disabled" sx={{ width: 22, flexShrink: 0 }}>
                      {field.ordinal}
                    </Typography>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="baseline">
                        <Typography variant="body2" fontWeight={600} noWrap>{field.name}</Typography>
                        <Typography variant="caption" color="primary">{field.type}</Typography>
                      </Stack>
                      {field.targetNodeId ? (
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
                          <ArrowForwardIcon sx={{ fontSize: 13, color: "success.main" }} />
                          <Typography variant="caption" color="success.main" fontWeight={600} noWrap>
                            {field.targetName ?? "Paired"}
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.disabled" sx={{ mt: 0.25, display: "block" }}>
                          Not paired yet
                        </Typography>
                      )}
                    </Box>

                    {isBusy ? (
                      <CircularProgress size={16} />
                    ) : isPairedToSelected ? (
                      <Chip
                        size="small"
                        icon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                        label="Paired"
                        color="success"
                        sx={{ height: 22, fontSize: "0.7rem", fontWeight: 600 }}
                      />
                    ) : isPairedElsewhere && selectedTarget ? (
                      <Tooltip title={`Currently paired with "${field.targetName}" — clicking moves it to ${selectedTarget.name}`}>
                        <Chip size="small" label="Move here" variant="outlined" sx={{ height: 22, fontSize: "0.7rem" }} />
                      </Tooltip>
                    ) : field.targetNodeId ? (
                      <Tooltip title="Remove this pairing">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); unmap(field.id); }}>
                          <CloseIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Box>
                );
              })}
              {visibleColumns.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: "center" }}>
                  No columns match this filter.
                </Typography>
              )}
            </Box>
          </Card>
        </Box>
      )}

      <Stack direction="row" spacing={2} alignItems="center" sx={{ display: sourceFields.length === 0 ? "none" : "flex" }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
          Pairings are one-to-one and save as you click. Re-using a field or a column moves the pairing rather
          than duplicating it. Model fields are read-only and owned by Structure.
        </Typography>
        {isComplete && (
          <Chip
            icon={<CheckCircleOutlineIcon />}
            label="All pairs complete — ready for quality checks"
            color="success"
            variant="outlined"
            size="small"
          />
        )}
      </Stack>

    </Box>
  );
}
