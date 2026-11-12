import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ReportGmailerrorredOutlinedIcon from "@mui/icons-material/ReportGmailerrorredOutlined";
import TroubleshootOutlinedIcon from "@mui/icons-material/TroubleshootOutlined";
import { discoverApi } from "@/features/discover/api/discoverApi";
import type { ProfileAllReport } from "@/features/discover/api/discoverApi";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import { useLazyReveal } from "@/features/discover/state/useLazyReveal";
import type { OverviewReadModel } from "@/shared/contracts";

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
  overview: OverviewReadModel;
};


/** Column-list rows rendered before the person has scrolled anywhere. */
const COLUMN_LIST_BATCH = 25;
/** Preview columns rendered up front; more arrive as the table is scrolled. */
const PREVIEW_COLUMN_BATCH = 12;

// What automatic profiling reports. None of it needs a rule or a model
// constraint — it is derived from the file itself. Anything that needs a
// defined business expectation is a governed check on the Quality step.
const PROFILING_COVERS = [
  "Row and column counts",
  "Null and blank values",
  "Distinct-value counts",
  "Exact duplicate rows",
  "Inferred data types",
  "Common value patterns",
  "Minimum, maximum and value distributions",
  "Potential outliers",
  "Basic type or parsing errors",
];

function ProfilingScopeNote() {
  return (
    <Alert severity="info" icon={<InfoOutlinedIcon fontSize="small" />} sx={{ textAlign: "left" }}>
      <Typography variant="body2" fontWeight={600} gutterBottom>
        Profiling runs automatically on the loaded file and needs no model rules.
      </Typography>
      <Box
        component="ul"
        sx={{ m: 0, pl: 2.5, columns: { xs: 1, sm: 2, md: 3 }, "& li": { breakInside: "avoid" } }}
      >
        {PROFILING_COVERS.map((item) => (
          <Typography key={item} component="li" variant="caption" color="text.secondary">
            {item}
          </Typography>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Checks that test a business requirement — a field must not be null, must be unique, must match an
        approved format or reference list — need a defined rule and run on the Quality Check step.
      </Typography>
    </Alert>
  );
}

export function DiscoverProfileTab({ vm, overview }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isProfiling, setIsProfiling] = useState(false);
  const [profilingError, setProfilingError] = useState<string | null>(null);
  /** What the last run did, per table, so a run over seven tables is visible. */
  const [profileRun, setProfileRun] = useState<ProfileAllReport | null>(null);

  const rawColumns = vm.discoveryColumnsQuery.data ?? [];
  const legacyColumns = vm.columnsQuery.data ?? [];

  // The per-column profile is fetched by discovery_column_id, so the list that
  // feeds the selection must be the discovery columns and nothing else. Falling
  // back to the legacy source_column list handed the endpoint a col_… id it
  // cannot resolve, and since the two queries settle independently after
  // profiling, whichever landed first decided whether the page worked.
  const columns = rawColumns.map((c) => ({
    id: c.discovery_column_id,
    name: c.source_label,
    type: c.inferred_datatype,
  }));

  // Profiling has run once either projection holds columns; the legacy list is
  // only consulted for that verdict, never for an id.
  const hasRunProfiling = legacyColumns.length > 0 || rawColumns.length > 0;

  // The automatic risk observations of the last run. They used to be reported
  // on the Quality Check step beside the governed rules, which meant one
  // screen carrying two kinds of answer under one set of totals. They belong
  // here: no rule and no mapping decision is needed to notice any of them.
  const observationsQuery = useQuery({
    queryKey: ["discover", "profile-observations", vm.selectedSessionId],
    queryFn: () => discoverApi.getProfileObservations(vm.selectedSessionId),
    enabled: Boolean(vm.selectedSessionId) && hasRunProfiling,
  });
  const riskObservations = (observationsQuery.data?.observations ?? []).filter(
    (o) => o.check_type === "duplicate_records" || o.check_type === "overlap"
  );
  const isLoadingColumns = vm.discoveryColumnsQuery.isLoading || vm.discoveryColumnsQuery.isFetching;
  // A session profiled before discovery columns existed has the legacy list but
  // not the one this screen reads from — say so instead of showing a blank pane.
  const needsReprofile = !isLoadingColumns && rawColumns.length === 0 && legacyColumns.length > 0;

  // The parsed file as stored in Postgres: real headers, real row count and
  // a page of the actual data rows.
  const dataset = vm.datasetQuery.data;
  const duplicates = vm.datasetDuplicatesQuery.data;
  const isCheckingDuplicates = vm.datasetDuplicatesQuery.isLoading
    || vm.datasetDuplicatesQuery.isFetching;

  // Profiling runs entirely on the server against the rows persisted at upload
  // time, so the column count, row count, missing/non-missing and distinct
  // values all come from the real file — and survive a page refresh.
  /**
   * Profile every table of the session, in one press.
   *
   * Profiling is what turns stored rows into typed columns with counts, and
   * nothing downstream can start on a table until it has run. Running it only
   * on the table on screen meant a seven-sheet workbook needed seven presses
   * of the same button, in seven visits, before the session could be used —
   * and the six unvisited tables looked imported while behaving as if empty.
   */
  const handleRunProfiling = async () => {
    setProfilingError(null);
    setIsProfiling(true);
    try {
      setProfileRun(await vm.profileAllMutation.mutateAsync());
      await vm.datasetQuery.refetch();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setProfilingError(
        detail ?? (err instanceof Error ? err.message : "Profiling failed. Please try again.")
      );
    } finally {
      setIsProfiling(false);
    }
  };

  // Every table the session holds — profiling covers all of them at once.
  const tableCount = (vm.sourceFilesQuery.data ?? []).length;

  const filteredColumns = columns.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

  // Two long lists, both rendered a batch at a time as the person reaches the
  // end of what is already there. A ninety-column file was building ninety
  // list rows and ninety cells per preview row before the page settled, to
  // show a handful of each.
  const columnList = useLazyReveal(filteredColumns.length, COLUMN_LIST_BATCH, COLUMN_LIST_BATCH);
  const previewColumns = useLazyReveal(
    dataset?.internal_names.length ?? 0,
    PREVIEW_COLUMN_BATCH,
    PREVIEW_COLUMN_BATCH
  );
  const visibleColumns = filteredColumns.slice(0, columnList.shown);
  const visiblePreviewNames = (dataset?.internal_names ?? []).slice(0, previewColumns.shown);
  const visiblePreviewLabels = (dataset?.column_labels ?? []).slice(0, previewColumns.shown);

  const selectedColData = columns.find(c => c.id === vm.selectedColumnId);
  const profile = vm.columnProfileQuery.data;

  // Keep the selection valid: pick the first column when nothing is selected,
  // and drop a selection that belongs to a previous file/profiling run.
  useEffect(() => {
    // Never choose while the list is still arriving: selecting from an empty or
    // half-loaded list is what produced a request for a column that does not
    // exist yet.
    if (isLoadingColumns) return;
    if (columns.length === 0) {
      if (vm.selectedColumnId) vm.setSelectedColumnId("");
      return;
    }
    if (!columns.some((c) => c.id === vm.selectedColumnId)) {
      vm.setSelectedColumnId(columns[0].id);
    }
  }, [columns, vm.selectedColumnId, isLoadingColumns]);

  // Every figure below comes from the rows stored in Postgres for this column.
  const totalRows = profile?.total_rows ?? overview.session.row_count ?? 0;
  const nonMissingCount = profile?.non_missing ?? 0;
  const missingCount = profile?.missing ?? 0;
  const nonMissingPct = totalRows > 0 ? ((nonMissingCount / totalRows) * 100).toFixed(1) : "0.0";
  const missingPct = totalRows > 0 ? ((missingCount / totalRows) * 100).toFixed(1) : "0.0";
  const variants = profile?.values ?? [];
  // `variants` carries a synthetic row for missing values; `distinct_count`
  // counts non-blank values only. Comparing the two is what produced
  // "Showing 42 of 41 distinct values".
  const valueVariants = variants.filter((v) => !v.is_missing);
  const missingVariantCount = variants.length - valueVariants.length;
  const topVariant = valueVariants[0];
  // Alphabetical extremes mean little on text. Shown for numbers and dates,
  // where they are a real minimum and maximum; relabelled where they are not.
  const isTextColumn = (profile?.inferred_datatype ?? "String") === "String";

  let cumulativePct = 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Session Details Banner */}
      <Card variant="outlined" sx={{ bgcolor: "background.paper" }}>
        <CardContent sx={{ py: 2, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Stack direction="row" spacing={4} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" color="text.secondary">Discovery session</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" fontWeight={600}>{overview.session.session_name}</Typography>
                <Chip label={overview.session.status} size="small" color={overview.session.status === "completed" ? "success" : "default"} sx={{ height: 20, fontSize: "0.7rem" }} />
              </Stack>
            </Box>
            
            <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
            
            <Box>
              <Typography variant="caption" color="text.secondary">Source file</Typography>
              <Typography variant="body2" fontWeight={500}>{overview.session.source_filename || "N/A"}</Typography>
            </Box>
            
            <Box>
              <Typography variant="caption" color="text.secondary">Model</Typography>
              <Typography variant="body2" fontWeight={500}>
                {overview.session.source_application || "Chosen at mapping"}
              </Typography>
            </Box>
            
            <Box>
              <Typography variant="caption" color="text.secondary">Source module</Typography>
              <Typography variant="body2" fontWeight={500}>{overview.session.source_module || "N/A"}</Typography>
            </Box>
            
            <Box>
              <Typography variant="caption" color="text.secondary">Rows / columns</Typography>
              <Typography variant="body2" fontWeight={500}>
                {dataset ? `${dataset.row_count.toLocaleString()} / ${dataset.column_count}` : "—"}
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">Exact duplicate rows</Typography>
              {/* Arrives after the page does: finding duplicates means reading
                  every row, and nothing else on the screen should wait for it. */}
              {duplicates ? (
                <Typography
                  variant="body2"
                  fontWeight={500}
                  color={duplicates.duplicate_row_count > 0 ? "warning.main" : "text.primary"}
                >
                  {duplicates.duplicate_row_count > 0
                    ? `${duplicates.duplicate_row_count.toLocaleString()} in ${duplicates.duplicate_groups} group(s)`
                    : "None"}
                </Typography>
              ) : isCheckingDuplicates ? (
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <CircularProgress size={11} />
                  <Typography variant="body2" color="text.secondary">Checking…</Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">—</Typography>
              )}
            </Box>
          </Stack>
          
          <Button variant="outlined" size="small">
            View session summary
          </Button>
        </CardContent>
      </Card>

      {profilingError && (
        <Alert severity="error" onClose={() => setProfilingError(null)}>{profilingError}</Alert>
      )}

      {hasRunProfiling && <ProfilingScopeNote />}

      {/* Risk observations across the whole table. Repeated records and
          overlapping fields are properties of the table, not of one column,
          so they have nowhere to live in the per-column panel below. */}
      {riskObservations.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
              <TroubleshootOutlinedIcon color="primary" />
              <Typography variant="subtitle1" fontWeight={600}>
                Risk observations
              </Typography>
              <Chip
                size="small"
                label={`${observationsQuery.data?.needs_attention ?? 0} need attention`}
                color={
                  (observationsQuery.data?.needs_attention ?? 0) > 0 ? "warning" : "default"
                }
                sx={{ height: 20, fontSize: "0.7rem" }}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
              Found automatically from the loaded data — no rule needed. The Quality Check
              step reports the governed rules you chose, and these are kept out of its
              totals.
            </Typography>
            <Stack spacing={1}>
              {riskObservations.map((observation) => (
                <Stack
                  key={observation.quality_check_id}
                  direction="row"
                  spacing={1}
                  alignItems="flex-start"
                >
                  {observation.status === "passed" ? (
                    <CheckCircleOutlineIcon color="success" sx={{ fontSize: 18, mt: 0.2 }} />
                  ) : (
                    <ReportGmailerrorredOutlinedIcon
                      color="warning"
                      sx={{ fontSize: 18, mt: 0.2 }}
                    />
                  )}
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {observation.check_type === "duplicate_records"
                        ? "Repeated records"
                        : "Overlapping fields"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {observation.message}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* What the last run did, table by table. A run over seven tables that
          reported only the one on screen was indistinguishable from a run over
          one — and a table that failed validation would vanish silently. */}
      {profileRun && profileRun.tables.length > 1 && (
        <Alert
          severity={profileRun.failed > 0 ? "warning" : "success"}
          onClose={() => setProfileRun(null)}
          sx={{ "& .MuiAlert-message": { width: "100%" } }}
        >
          <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
            Profiled {profileRun.profiled} of {profileRun.tables.length} tables
            {profileRun.failed > 0 && ` · ${profileRun.failed} could not be profiled`}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {profileRun.tables.map((table) => (
              <Chip
                key={table.source_file_id}
                size="small"
                variant="outlined"
                color={table.status === "profiled" ? "success" : "error"}
                label={
                  table.status === "profiled"
                    ? `${table.name} · ${table.column_count} cols · ${(table.row_count ?? 0).toLocaleString()} rows`
                    : `${table.name} · ${table.reason}`
                }
                sx={{ height: 22, fontSize: "0.68rem", maxWidth: 420 }}
              />
            ))}
          </Box>
        </Alert>
      )}

      {needsReprofile && (
        <Alert severity="info">
          This session was profiled by an older version that did not store per-column detail.
          Run profiling again to see each column's statistics.
        </Alert>
      )}

      {!hasRunProfiling ? (
        /* ── Run Profiling call-to-action (no columns profiled yet) ── */
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 2 }}>
            <AssessmentOutlinedIcon sx={{ fontSize: 44, color: "primary.main" }} />
            <Typography variant="h6" fontWeight={700}>
              {tableCount > 1
                ? `Run profiling on all ${tableCount} tables`
                : "Run profiling to analyse this file"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
              Profiling reads every column of {tableCount > 1 ? "every table you imported" : "your imported file"}{" "}
              and reports what is actually in it — no model rules required.
            </Typography>
            <Box sx={{ maxWidth: 720, width: "100%" }}><ProfilingScopeNote /></Box>
            {dataset && dataset.column_count > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {dataset.column_count} columns and {dataset.row_count.toLocaleString()} rows were read from{" "}
                {overview.session.source_filename ?? "the uploaded file"} and stored.
              </Typography>
            ) : (
              <Alert severity="info" sx={{ maxWidth: 480, textAlign: "left" }}>
                No stored file content found for this session. Upload a CSV or Excel file on the Import Data
                step first — its rows are parsed and saved before profiling can run.
              </Alert>
            )}
            <Button
              variant="contained"
              size="large"
              startIcon={isProfiling ? <CircularProgress size={18} color="inherit" /> : <PlayArrowIcon />}
              onClick={handleRunProfiling}
              disabled={isProfiling}
              sx={{ px: 4, py: 1, textTransform: "none", fontWeight: 600, mt: 1 }}
            >
              {isProfiling
                ? tableCount > 1 ? `Profiling ${tableCount} tables…` : "Running profiling…"
                : tableCount > 1 ? `Run profiling on ${tableCount} tables` : "Run Profiling"}
            </Button>
          </CardContent>
        </Card>
      ) : (
      /* Main Grid */
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "minmax(320px, 380px) minmax(0, 1fr)" }, gap: 1.5, alignItems: "start" }}>
        {/* Columns Panel */}
        <Card variant="outlined" sx={{ minWidth: 0 }}>
          <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
              <ViewColumnOutlinedIcon color="primary" />
              <Typography variant="subtitle1" fontWeight={600}>Columns</Typography>
              <Typography variant="caption" color="text.secondary">{columns.length} columns</Typography>
            </Stack>

            <TextField
              fullWidth
              size="small"
              placeholder="Search columns"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />

            <Stack direction="row" spacing={2} mb={2}>
              <FormControl size="small" sx={{ flexGrow: 1 }}>
                <Select value="all" displayEmpty>
                  <MenuItem value="all">Type: All</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ flexGrow: 1 }}>
                <Select value="all" displayEmpty>
                  <MenuItem value="all">Status: All</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            {/* Its own scroll, so ninety columns do not push the rest of the
                page down — and so reaching the bottom is what asks for more. */}
            <Box
              sx={{
                maxHeight: 460,
                overflowY: "auto",
                overflowX: "auto",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
              }}
            >
              <Table size="small" stickyHeader sx={{ "& .MuiTableCell-root": { p: 1, borderBottom: "none" } }}>
                <TableHead sx={{ bgcolor: "background.default" }}>
                  <TableRow>
                    <TableCell sx={{ bgcolor: "background.default", whiteSpace: "nowrap" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Column name ↑</Typography></TableCell>
                    <TableCell sx={{ bgcolor: "background.default", whiteSpace: "nowrap" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Inferred type</Typography></TableCell>
                    <TableCell sx={{ bgcolor: "background.default", whiteSpace: "nowrap" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Profile status</Typography></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleColumns.map((col, index) => (
                    <TableRow 
                      key={col.id} 
                      hover
                      // The last rendered row is the trigger for the next batch.
                      ref={index === visibleColumns.length - 1 ? columnList.lastItemRef : undefined}
                      onClick={() => vm.setSelectedColumnId(col.id)}
                      sx={{ 
                        cursor: "pointer",
                        bgcolor: vm.selectedColumnId === col.id ? "primary.50" : "transparent"
                      }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {vm.selectedColumnId === col.id && <PlayArrowIcon color="primary" sx={{ fontSize: 14 }} />}
                          <Typography variant="body2" fontWeight={vm.selectedColumnId === col.id ? 600 : 400} color={vm.selectedColumnId === col.id ? "primary" : "text.primary"}>
                            {col.name}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell><Typography variant="body2">{col.type}</Typography></TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 14 }} />
                          <Typography variant="body2" color="success.main">Profiled</Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            
            <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
              <Typography variant="caption" color="text.secondary">{vm.selectedColumnId ? 1 : 0} column selected</Typography>
              <Typography variant="caption" color="text.secondary">
                {columnList.isComplete
                  ? `${filteredColumns.length} column${filteredColumns.length === 1 ? "" : "s"}`
                  : `${visibleColumns.length} of ${filteredColumns.length} — scroll for more`}
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        {/* Selected Column Profile */}
        <Card variant="outlined" sx={{ minWidth: 0 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} spacing={1} flexWrap="wrap" useFlexGap>
              <Stack direction="row" alignItems="baseline" spacing={1} sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={600} noWrap>Selected column profile</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>Read model (persisted)</Typography>
              </Stack>
              <Button
                variant="outlined"
                size="small"
                startIcon={isProfiling ? <CircularProgress size={14} color="inherit" /> : <ReplayIcon />}
                onClick={handleRunProfiling}
                disabled={isProfiling}
                sx={{ textTransform: "none", whiteSpace: "nowrap", flexShrink: 0 }}
              >
                {isProfiling
                  ? "Re-running…"
                  : tableCount > 1 ? `Re-run on all ${tableCount} tables` : "Re-run profiling"}
              </Button>
            </Stack>

            <Box mb={3}>
              <Typography variant="caption" color="text.secondary">Column</Typography>
              <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ minWidth: 0 }}>
                <Typography variant="h6" fontWeight={600} sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {profile?.source_label ?? selectedColData?.name ?? "—"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {profile?.inferred_datatype ?? selectedColData?.type ?? ""}
                </Typography>
              </Stack>
            </Box>

            {vm.columnProfileQuery.isLoading ? (
              <Stack direction="row" spacing={1.5} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">Loading column profile…</Typography>
              </Stack>
            ) : vm.columnProfileQuery.isError ? (
              <Alert
                severity="warning"
                action={
                  <Button
                    size="small"
                    onClick={() => vm.columnProfileQuery.refetch()}
                    sx={{ textTransform: "none", fontWeight: 600 }}
                  >
                    Try again
                  </Button>
                }
              >
                This column's profile could not be loaded. If the file has changed since it was
                profiled, run profiling again to refresh it.
              </Alert>
            ) : profile ? (
              <>
                {/* Metrics Grid */}
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 1.5, mb: 3 }}>
                  <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block">Total rows</Typography>
                    <Typography variant="h6" fontWeight={600}>{totalRows.toLocaleString()}</Typography>
                  </Box>
                  <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} sx={{ whiteSpace: "nowrap" }}>
                      <CheckCircleOutlineIcon color="success" sx={{ fontSize: 14 }} /> Non-missing
                    </Typography>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={0.5}>
                      <Typography variant="h6" fontWeight={600}>{nonMissingCount.toLocaleString()}</Typography>
                      {/* MISSING BACKEND DATA: nonMissingPct not directly provided, computed manually */}
                      <Typography variant="caption" color="text.secondary">{nonMissingPct}%</Typography>
                    </Stack>
                  </Box>
                  <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} sx={{ whiteSpace: "nowrap" }}>
                      <Box component="span" sx={{ width: 8, height: 8, borderRadius: "50%", border: "2px solid #ed6c02" }} /> Missing
                    </Typography>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography variant="h6" fontWeight={600}>{missingCount.toLocaleString()}</Typography>
                      {/* MISSING BACKEND DATA: missingPct not directly provided, computed manually */}
                      <Typography variant="caption" color="text.secondary">{missingPct}%</Typography>
                    </Stack>
                  </Box>
                  <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block">Distinct values</Typography>
                    <Typography variant="h6" fontWeight={600}>{profile.distinct_count.toLocaleString()}</Typography>
                  </Box>
                  <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block">Top value</Typography>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography variant="h6" fontWeight={600} noWrap title={topVariant?.value}>
                        {topVariant?.value || "—"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {topVariant ? `${topVariant.percent}%` : ""}
                      </Typography>
                    </Stack>
                  </Box>
                  {!isTextColumn && (
                    <>
                      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                        <Typography variant="caption" color="text.secondary" display="block">Minimum</Typography>
                        <Typography variant="h6" fontWeight={600} noWrap title={profile.extremes?.min_value ?? ""}>
                          {profile.extremes?.min_value ?? "—"}
                        </Typography>
                      </Box>
                      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                        <Typography variant="caption" color="text.secondary" display="block">Maximum</Typography>
                        <Typography variant="h6" fontWeight={600} noWrap title={profile.extremes?.max_value ?? ""}>
                          {profile.extremes?.max_value ?? "—"}
                        </Typography>
                      </Box>
                    </>
                  )}

                </Box>

                {/* Second row of automatic observations: parsing, outliers, length */}
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1.5, mb: 3 }}>
                  <Box sx={{
                    p: 2, borderRadius: 1, border: "1px solid",
                    borderColor: (profile.parse_errors?.count ?? 0) > 0 ? "warning.light" : "divider",
                    bgcolor: (profile.parse_errors?.count ?? 0) > 0 ? "warning.50" : "transparent",
                  }}>
                    <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} sx={{ whiteSpace: "nowrap" }}>
                      <ReportGmailerrorredOutlinedIcon sx={{ fontSize: 14 }} /> Type / parsing errors
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {(profile.parse_errors?.count ?? 0).toLocaleString()}
                    </Typography>
                    {(profile.parse_errors?.examples?.length ?? 0) > 0 ? (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        {profile.parse_errors.examples.map((v) => (
                          <Chip key={v} size="small" variant="outlined" color="warning" label={v}
                            sx={{ height: 20, fontSize: "0.68rem" }} />
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        every value parses as {profile.inferred_datatype}
                      </Typography>
                    )}
                  </Box>

                  <Box sx={{
                    p: 2, borderRadius: 1, border: "1px solid",
                    borderColor: (profile.outliers?.count ?? 0) > 0 ? "warning.light" : "divider",
                    bgcolor: (profile.outliers?.count ?? 0) > 0 ? "warning.50" : "transparent",
                  }}>
                    <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} sx={{ whiteSpace: "nowrap" }}>
                      <TroubleshootOutlinedIcon sx={{ fontSize: 14 }} /> Potential outliers
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {(profile.outliers?.count ?? 0).toLocaleString()}
                    </Typography>
                    {(profile.outliers?.count ?? 0) > 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        outside {profile.outliers.lower_bound} – {profile.outliers.upper_bound}
                        {profile.outliers.samples.length > 0 &&
                          ` · e.g. ${profile.outliers.samples.map((o) => o.value).join(", ")}`}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {(profile.outliers?.numeric_values ?? 0) > 0
                          ? "no values sit far outside the range"
                          : "not a numeric column"}
                      </Typography>
                    )}
                  </Box>

                  <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block">Value length</Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {profile.extremes?.min_length ?? "—"} – {profile.extremes?.max_length ?? "—"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">characters, shortest to longest</Typography>
                  </Box>
                </Box>

                {/* Common value patterns */}
                {(profile.patterns?.length ?? 0) > 0 && (
                  <Box sx={{ mb: 4 }}>
                    <Typography variant="subtitle2" fontWeight={600} mb={1}>
                      Common value patterns
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        letters shown as A/a, digits as 9
                      </Typography>
                    </Typography>
                    <Stack spacing={0.75}>
                      {profile.patterns.map((p) => {
                        const pct = totalRows > 0 ? (p.count / totalRows) * 100 : 0;
                        return (
                          <Stack key={p.pattern} direction="row" alignItems="center" spacing={1.5}>
                            <Typography variant="body2" fontFamily="monospace" fontWeight={600} sx={{ minWidth: 150 }} noWrap>
                              {p.pattern}
                            </Typography>
                            <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: "grey.200", overflow: "hidden" }}>
                              <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: "primary.main" }} />
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 96, textAlign: "right" }}>
                              {p.count.toLocaleString()} · {pct.toFixed(0)}%
                            </Typography>
                            <Typography variant="caption" color="text.disabled" sx={{ minWidth: 120 }} noWrap title={p.example}>
                              e.g. {p.example}
                            </Typography>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Box>
                )}

                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 3, mb: 3 }}>
                  {/* Distribution of the most common variants */}
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600} mb={2}>
                      Value distribution (top {Math.min(variants.length, 6)} of {profile.distinct_count.toLocaleString()} distinct)
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "flex-end", height: 150, gap: 4, borderBottom: "1px solid", borderLeft: "1px solid", borderColor: "divider", pl: 1, pb: 1 }}>
                      {variants.slice(0, 6).map((variant, i) => (
                        <Box
                          key={i}
                          sx={{
                            flex: 1,
                            bgcolor: variant.is_missing ? "warning.main" : "primary.main",
                            height: `${variant.percent}%`,
                            minHeight: 2,
                            borderRadius: "4px 4px 0 0",
                          }}
                          title={`${variant.is_missing ? "(missing)" : variant.value}: ${variant.count} (${variant.percent}%)`}
                        />
                      ))}
                    </Box>
                    <Box sx={{ display: "flex", gap: 4, pl: 1, mt: 1 }}>
                      {variants.slice(0, 6).map((variant, i) => (
                        <Typography
                          key={i}
                          variant="caption"
                          sx={{ flex: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          color="text.secondary"
                          title={variant.is_missing ? "(missing)" : variant.value}
                        >
                          {variant.is_missing ? "(missing)" : variant.value}
                        </Typography>
                      ))}
                    </Box>
                  </Box>

                  {/* Observations */}
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600} mb={2}>Observations</Typography>
                    <Stack spacing={1.5}>
                      <Typography variant="body2" sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                        <CheckCircleOutlineIcon color="action" sx={{ fontSize: 16, mt: 0.2 }} />
                        {missingCount.toLocaleString()} of {totalRows.toLocaleString()} rows ({missingPct}%) are missing
                      </Typography>
                      <Typography variant="body2" sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                        <CheckCircleOutlineIcon color="action" sx={{ fontSize: 16, mt: 0.2 }} />
                        {profile.distinct_count.toLocaleString()} distinct values across {nonMissingCount.toLocaleString()} non-missing rows
                      </Typography>
                      <Typography variant="body2" sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                        <CheckCircleOutlineIcon color="action" sx={{ fontSize: 16, mt: 0.2 }} />
                        {profile.distinct_count === totalRows && totalRows > 0
                          ? "Every value is unique — this column looks like an identifier"
                          : `Inferred type is ${profile.inferred_datatype}`}
                      </Typography>
                    </Stack>
                  </Box>
                </Box>

                {/* Every distinct value in this field, with how often it occurs */}
                <Typography variant="subtitle2" fontWeight={600} mb={2}>Values in this column</Typography>
                <Box sx={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ bgcolor: "background.paper" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Rank</Typography></TableCell>
                        <TableCell sx={{ bgcolor: "background.paper" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Value</Typography></TableCell>
                        <TableCell align="right" sx={{ bgcolor: "background.paper" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Count</Typography></TableCell>
                        <TableCell align="right" sx={{ bgcolor: "background.paper" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Percent</Typography></TableCell>
                        <TableCell align="right" sx={{ bgcolor: "background.paper" }}><Typography variant="caption" fontWeight={600} color="text.secondary">Cumulative percent</Typography></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {variants.map((variant, i) => {
                        cumulativePct += variant.percent;
                        return (
                          <TableRow hover key={i}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {variant.is_missing ? (
                                <Typography variant="body2" color="warning.main" fontStyle="italic">(missing)</Typography>
                              ) : (
                                <Typography variant="body2" title={variant.value}>{variant.value}</Typography>
                              )}
                            </TableCell>
                            <TableCell align="right">{variant.count.toLocaleString()}</TableCell>
                            <TableCell align="right">{variant.percent.toFixed(1)}%</TableCell>
                            <TableCell align="right">{Math.min(cumulativePct, 100).toFixed(1)}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>

                <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
                  <Typography variant="caption" color="text.secondary">
                    Showing {valueVariants.length.toLocaleString()} of{" "}
                    {profile.distinct_count.toLocaleString()} distinct values
                    {missingVariantCount > 0
                      ? ` · ${missingVariantCount} missing-value group listed separately`
                      : ""}
                  </Typography>
                </Stack>
              </>
            ) : null}

            <Divider sx={{ my: 3 }} />
            <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} sx={{ whiteSpace: "nowrap" }}>
              <InfoOutlinedIcon sx={{ fontSize: 16 }} />
              Profile results are read-only and based on persisted profiling results.
            </Typography>
          </CardContent>
        </Card>
      </Box>
      )}

      {/* ── Stored file data (read back from Postgres) ── */}
      {hasRunProfiling && dataset && dataset.rows.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} mb={2} flexWrap="wrap" useFlexGap>
              <TableChartOutlinedIcon color="primary" />
              <Typography variant="subtitle1" fontWeight={600}>File data</Typography>
              <Typography variant="caption" color="text.secondary">
                first {dataset.rows.length} of {dataset.row_count.toLocaleString()} rows
                {previewColumns.isComplete
                  ? ` · all ${dataset.column_count} columns`
                  : ` · ${previewColumns.shown} of ${dataset.column_count} columns — scroll right for more`}
              </Typography>
              {!previewColumns.isComplete && (
                <Button size="small" onClick={previewColumns.revealAll} sx={{ textTransform: "none", py: 0 }}>
                  Show all columns
                </Button>
              )}
            </Stack>
            {/* Columns arrive a batch at a time as the table is scrolled right:
                ten rows of a ninety-column file is 900 cells, and the first
                dozen columns are what anyone looks at first. */}
            <Box sx={{ overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ bgcolor: "background.default" }}>
                      <Typography variant="caption" fontWeight={600} color="text.secondary">#</Typography>
                    </TableCell>
                    {visiblePreviewLabels.map((label, index) => (
                      <TableCell
                        key={`${label}-${index}`}
                        // Scrolling the rightmost header into view asks for the
                        // next batch of columns.
                        ref={
                          index === visiblePreviewLabels.length - 1
                            ? previewColumns.lastItemRef
                            : undefined
                        }
                        sx={{ bgcolor: "background.default", whiteSpace: "nowrap" }}
                      >
                        <Typography variant="caption" fontWeight={600} color="text.secondary">{label}</Typography>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dataset.rows.map((row) => (
                    <TableRow key={row.row_number} hover>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">{row.row_number}</Typography>
                      </TableCell>
                      {visiblePreviewNames.map((name) => (
                        <TableCell key={name} sx={{ whiteSpace: "nowrap", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>
                          <Typography variant="body2" title={row.row_data?.[name] ?? ""}>
                            {row.row_data?.[name] || "—"}
                          </Typography>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
