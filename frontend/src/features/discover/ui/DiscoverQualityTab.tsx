import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RuleOutlinedIcon from "@mui/icons-material/RuleOutlined";
import FilterNoneOutlinedIcon from "@mui/icons-material/FilterNoneOutlined";
import FingerprintOutlinedIcon from "@mui/icons-material/FingerprintOutlined";
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import PieChartOutlineIcon from "@mui/icons-material/PieChartOutline";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import { SourceApplicationSummary } from "@/features/discover/ui/DiscoverSourceApplication";
import type {
  QualityCheckType,
  QualityFinding,
  QualityStatus,
} from "@/features/discover/api/discoverApi";
import { DiscoverQualityByRule } from "@/features/discover/ui/DiscoverQualityByRule";
import { DiscoverQualityRunHistory } from "@/features/discover/ui/DiscoverQualityRunHistory";
import { DiscoverQualityRunProgress } from "@/features/discover/ui/DiscoverQualityRunProgress";
import type { OverviewReadModel } from "@/shared/contracts";

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
  overview: OverviewReadModel;
};

const CHECK_LABELS: Record<QualityCheckType, string> = {
  completeness: "No missing values",
  uniqueness: "No repeated values",
  type_conformance: "Correct data type",
  duplicate_records: "No duplicate records",
  overlap: "No overlapping fields",
  usability: "Usable records",
  governed_rule: "Governed rule",
  configuration_error: "Could not run",
  mapped_field_issue: "Missing or unknown value",
};

const CHECK_SHORT: Record<QualityCheckType, string> = {
  completeness: "Complete",
  uniqueness: "Unique",
  type_conformance: "Valid type",
  duplicate_records: "No duplicates",
  overlap: "No overlap",
  usability: "Usable",
  configuration_error: "Not run",
  mapped_field_issue: "Missing/unknown",
  governed_rule: "Governed",
};

/** The three per-field checks, in the order they appear as table columns. */
const FIELD_CHECKS: QualityCheckType[] = ["completeness", "uniqueness", "type_conformance"];

const HOW_IT_WORKS: Array<{ type: QualityCheckType; icon: ReactNode; what: string }> = [
  {
    type: "completeness",
    icon: <FilterNoneOutlinedIcon color="primary" />,
    what: "Counts empty cells. Missing values fail when the model marks the field required, and are flagged as a warning otherwise.",
  },
  {
    type: "uniqueness",
    icon: <FingerprintOutlinedIcon color="primary" />,
    what: "Runs only on fields the model marks unique or a key: every value must appear once. Fields that are allowed to repeat are not checked, so a passing result always means no repeats.",
  },
  {
    type: "type_conformance",
    icon: <DataObjectOutlinedIcon color="primary" />,
    what: "Every value must fit the field's data type — a number column may not contain text, a date column may not contain free text.",
  },
  {
    type: "duplicate_records",
    icon: <ContentCopyOutlinedIcon color="primary" />,
    what: "Looks for rows that repeat across every mapped field — the same record entered more than once.",
  },
  {
    type: "overlap",
    icon: <CompareArrowsOutlinedIcon color="primary" />,
    what: "Compares fields against each other. Two fields holding the same values usually means shifted or copy-pasted columns.",
  },
  {
    type: "usability",
    icon: <PieChartOutlineIcon color="primary" />,
    what: "Combines the checks row by row: a record counts as usable when it breaks no rule and is not a duplicate copy. A row with several problems is counted once.",
  },
];

function statusIcon(status: QualityStatus, size = 18) {
  if (status === "passed") return <CheckCircleIcon color="success" sx={{ fontSize: size }} />;
  if (status === "warning") return <WarningAmberIcon color="warning" sx={{ fontSize: size }} />;
  return <ErrorOutlineIcon color="error" sx={{ fontSize: size }} />;
}

function statusColor(status: QualityStatus): "success" | "warning" | "error" {
  return status === "passed" ? "success" : status === "warning" ? "warning" : "error";
}

/** The offending values behind a finding, when there are any to show. */
function FindingDetail({ finding }: { finding: QualityFinding }) {
  const d = finding.detail ?? {};
  const rows: Array<{ label: string; content: ReactNode }> = [];

  if (d.example_rows?.length) {
    rows.push({ label: "Empty at row(s)", content: d.example_rows.join(", ") });
  }
  if (d.duplicate_values?.length) {
    rows.push({
      label: "Repeated values",
      content: (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {d.duplicate_values.map((v) => (
            <Chip
              key={v.value}
              size="small"
              variant="outlined"
              label={`${v.value} ×${v.count}`}
              sx={{ height: 22, fontSize: "0.7rem" }}
            />
          ))}
        </Stack>
      ),
    });
  }
  if (d.invalid_examples?.length) {
    rows.push({
      label: `Not valid ${d.datatype ?? "values"}`,
      content: (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {d.invalid_examples.map((v) => (
            <Chip
              key={v}
              size="small"
              color="error"
              variant="outlined"
              label={v}
              sx={{ height: 22, fontSize: "0.7rem" }}
            />
          ))}
        </Stack>
      ),
    });
  }
  if (d.pairs?.length) {
    rows.push({
      label: "Fields sharing values",
      content: (
        <Stack spacing={0.5}>
          {d.pairs.map((p) => (
            <Typography key={`${p.left}-${p.right}`} variant="caption">
              <b>{p.left}</b> and <b>{p.right}</b> share {p.shared_count} value(s)
              {p.samples.length > 0 && ` — e.g. ${p.samples.join(", ")}`}
            </Typography>
          ))}
        </Stack>
      ),
    });
  }
  if (d.duplicate_groups) {
    rows.push({
      label: "Duplicate records",
      content: `${d.duplicate_rows} rows across ${d.duplicate_groups} group(s)`,
    });
  }

  if (rows.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ mt: 1, pl: 3.5 }}>
      {rows.map((row) => (
        <Box key={row.label}>
          <Typography variant="caption" color="text.secondary" display="block">{row.label}</Typography>
          <Box sx={{ mt: 0.25 }}>
            {typeof row.content === "string"
              ? <Typography variant="body2">{row.content}</Typography>
              : row.content}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

export function DiscoverQualityTab({ vm, overview }: Props) {
  const [runError, setRunError] = useState<string | null>(null);
  /** What the last run did, table by table. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showHow, setShowHow] = useState(false);

  const report = vm.qualityReportQuery.data;
  // The same run, grouped by rule and covering every table rather than
  // only the one on screen.
  const byRule = vm.qualityByRuleQuery.data;
  const runHistory = vm.qualityRunsQuery.data;
  const findings = report?.findings ?? [];

  const allColumns = vm.columnsQuery.data ?? [];
  const mappings = vm.mappingsQuery.data ?? [];
  const unmappedCount = Math.max(0, allColumns.length - mappings.length);
  // The step is gated the same way Mapping is: a new file resets both, so the
  // first-load message returns instead of a button that would only error.
  const needsProfiling = allColumns.length === 0;
  const needsMapping = !needsProfiling && mappings.length === 0;
  const canRun = !needsProfiling && !needsMapping;

  // Three kinds of finding, shown apart: structural checks per field, checks
  // across the whole dataset, and the governed rules this session configured.
  const { byColumn, datasetFindings, governedFindings } = useMemo(() => {
    const grouped = new Map<string, { name: string; target: string | null; items: QualityFinding[] }>();
    const dataset: QualityFinding[] = [];
    const governed: QualityFinding[] = [];
    for (const finding of findings) {
      if (finding.check_type === "governed_rule") {
        governed.push(finding);
        continue;
      }
      // A rule that could not run has its own block above. It is not a
      // profiling observation, and grouping it by column put a row of zeros
      // and "n/a" into the per-field table for a field nothing was measured on.
      if (finding.check_type === "configuration_error") continue;
      // Missing and unknown values on mapped fields have their own block.
      if (finding.check_type === "mapped_field_issue") continue;
      if (finding.scope === "dataset" || !finding.column_id) {
        // The usability split has its own card above, so it is not repeated here.
        if (finding.check_type !== "usability") dataset.push(finding);
        continue;
      }
      const entry = grouped.get(finding.column_id) ?? {
        name: finding.column_name,
        target: finding.target_name,
        items: [],
      };
      entry.items.push(finding);
      grouped.set(finding.column_id, entry);
    }
    return {
      byColumn: [...grouped.entries()],
      datasetFindings: dataset,
      governedFindings: governed,
    };
  }, [findings]);

  const worstOf = (items: QualityFinding[]): QualityStatus =>
    items.some((i) => i.status === "failed")
      ? "failed"
      : items.some((i) => i.status === "warning")
        ? "warning"
        : "passed";

  /**
   * Check every mapped table of the session, not only the one on screen.
   *
   * The findings belong to a table, and a table nobody opened reports none —
   * which on a seven-table session reads exactly like a clean table. One run,
   * every table that has been mapped; the ones still unmapped are named rather
   * than counted as passing.
   */
  const handleRun = async () => {
    setRunError(null);
    try {
      // Returns as soon as the tables are queued. From here the run belongs
      // to the server: the progress panel watches it, and closing the page
      // does not stop it.
      await vm.startQualityRunMutation.mutateAsync();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRunError(detail ?? (err instanceof Error ? err.message : "Could not run the quality checks."));
    }
  };

  const runProgress = vm.qualityProgressQuery.data;
  // "Running" is what the server says, not what this tab remembers — which is
  // what lets a reload, or another tab, show the same run still going.
  const isRunning =
    (runProgress?.is_working ?? false) || vm.startQualityRunMutation.isPending;

  const hasRun = !!report?.has_run;
  // Every table of the session, so the button can say how many it will check.
  const tableCount = (vm.sourceFilesQuery.data ?? []).length;
  const mappedTables = (vm.sourceFilesQuery.data ?? []).filter((f) => f.mapped_columns > 0).length;
  const failed = report?.failed ?? 0;
  const warnings = report?.warnings ?? 0;
  const usability = report?.usability ?? null;

  /** Pull one check out of a field's findings, for a table cell. */
  const checkOf = (items: QualityFinding[], type: QualityCheckType) =>
    items.find((i) => i.check_type === type);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <RuleOutlinedIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>Data quality</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Checks every mapped table of this session against the model structure. Only fields paired
            with a model field are checked; the findings below are for{" "}
            {overview.session.source_filename || "the table you have open"}.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center">
          {/* Who to go back to about these findings: the application the
              open table came from, recorded on Import Data. */}
          <SourceApplicationSummary
            vm={vm}
            sourceFileId={(vm.sourceFilesQuery.data ?? []).find((f) => f.is_active)?.source_file_id}
          />
          {canRun && (
            <Button
              variant="contained"
              startIcon={isRunning ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              onClick={handleRun}
              disabled={isRunning}
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              {isRunning
                ? mappedTables > 1 ? `Checking ${mappedTables} tables…` : "Running checks…"
                : mappedTables > 1
                  ? `${hasRun ? "Re-run" : "Run"} checks on ${mappedTables} mapped tables`
                  : hasRun ? "Re-run checks" : "Run quality checks"}
            </Button>
          )}
        </Stack>
      </Stack>

      {runError && <Alert severity="error" onClose={() => setRunError(null)}>{runError}</Alert>}

      {/* How the checks work */}
      <Card variant="outlined">
        <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ cursor: "pointer" }}
            onClick={() => setShowHow((v) => !v)}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <InfoOutlinedIcon color="primary" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={600}>How these checks work</Typography>
            </Stack>
            <IconButton size="small" sx={{ transform: showHow ? "rotate(180deg)" : "none", transition: "0.2s" }}>
              <ExpandMoreIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Collapse in={showHow}>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, mb: 2 }}>
              Each mapped column is checked against the model field it was mapped to. What counts as correct
              comes from the model structure itself — properties declared on the field (such as <b>Required</b>
              {" "}or <b>Unique</b>) become rules, and the field's data type defines the shape every value must
              have. Where the model declares nothing, findings are reported as observations rather than failures.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, gap: 2 }}>
              {HOW_IT_WORKS.map((item) => (
                <Box key={item.type} sx={{ display: "flex", gap: 1.5, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <Box sx={{ mt: 0.25 }}>{item.icon}</Box>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{CHECK_LABELS[item.type]}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.what}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Collapse>
        </CardContent>
      </Card>

      {/* How far the run has got.
          Outside the verdict below on purpose. That is gated on findings
          existing, and the very first run has none yet — so the progress of
          the run that is about to produce them was rendered nowhere, and
          pressing the button appeared to do nothing until it finished. */}
      {runProgress?.has_run && <DiscoverQualityRunProgress progress={runProgress} />}

      {/* Verdict and results, once the run is over.
          Nothing below is shown while a run is in flight. Findings are
          written table by table, so a run in progress has a real but partial
          answer — showing it counts some tables and not others, and the
          numbers move as the rest arrive. A half-finished verdict is worse
          than none: it reads as the result. The same gate hides the "Check
          this data against the model" invitation, which otherwise asks for
          something already happening. */}
      {runProgress?.is_working ? null : !hasRun ? (
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 1.5 }}>
            <RuleOutlinedIcon sx={{ fontSize: 44, color: needsProfiling || needsMapping ? "text.disabled" : "primary.main" }} />
            {needsProfiling ? (
              <>
                <Typography variant="h6" fontWeight={700}>Profile the file before checking it</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
                  {overview.session.source_filename
                    ? `${overview.session.source_filename} has not been profiled yet. Run profiling on the Profile Data step, map its columns, then come back to check the data.`
                    : "Import a file and run profiling first, then map its columns — the quality checks run against mapped fields."}
                </Typography>
              </>
            ) : needsMapping ? (
              <>
                <Typography variant="h6" fontWeight={700}>Map your fields before checking them</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
                  The checks test each column against the model field it was mapped to, so nothing can be
                  checked yet. Pair your columns with model fields on the Mapping step first.
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h6" fontWeight={700}>Check this data against the model</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
                  Every field you mapped is tested for missing values, repeated values, the correct data type,
                  duplicate records and overlap between fields — so you know the data is clean before you use it.
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={isRunning ? <CircularProgress size={18} color="inherit" /> : <PlayArrowIcon />}
                  onClick={handleRun}
                  disabled={isRunning}
                  sx={{ px: 4, py: 1, textTransform: "none", fontWeight: 600, mt: 1 }}
                >
                  {isRunning
                    ? mappedTables > 1 ? `Checking ${mappedTables} tables…` : "Running checks…"
                    : mappedTables > 1 ? `Run checks on ${mappedTables} mapped tables` : "Run quality checks"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Alert
            severity={failed > 0 ? "error" : warnings > 0 ? "warning" : "success"}
            icon={statusIcon(failed > 0 ? "failed" : warnings > 0 ? "warning" : "passed", 22)}
          >
            <Typography variant="body2" fontWeight={700}>
              {failed > 0
                ? `${failed} check${failed === 1 ? "" : "s"} failed — this data is not ready to use yet.`
                : warnings > 0
                  ? `${warnings} warning${warnings === 1 ? "" : "s"} — review before using this data.`
                  : "This data is clean and correct against the model structure."}
            </Typography>
            <Typography variant="caption">
              {report?.total_checks} check{report?.total_checks === 1 ? "" : "s"} across{" "}
              {report?.assessed_columns ?? 0} assessed field
              {(report?.assessed_columns ?? 0) === 1 ? "" : "s"}
              {(report?.rules_run ?? 0) > 0 &&
                `, from ${report?.rules_run} rule${report?.rules_run === 1 ? "" : "s"}`}{" "}
              · {report?.passed} passed · {warnings} warning
              {warnings === 1 ? "" : "s"} · {failed} failed
              {unmappedCount > 0 && ` · ${unmappedCount} unmapped column${unmappedCount === 1 ? "" : "s"} not checked`}
            </Typography>
          </Alert>

          {/* ── The run, read by rule ───────────────────────────────────────
              Which rules ran, which are failing, how severe each one is, and
              the table and field it broke in. The per-field view below answers
              the other question — what is wrong with this column — and both
              are read from the same run. */}
          {byRule && <DiscoverQualityByRule report={byRule} />}

          {/* ── Every check this session has been through ───────────────────
              The panels above describe the newest run. This one keeps the
              earlier ones, because a result is only explainable next to the
              rules and mapping it was actually measured against. */}
          {runHistory && (
            <DiscoverQualityRunHistory
              sessionId={vm.selectedSessionId}
              history={runHistory}
            />
          )}

          {/* How much of the data can actually be used */}
          {usability && (
            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <PieChartOutlineIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight={600}>How much of this data can you use?</Typography>
                  {report?.table_name && (
                    // The roll-up above spans every table; this card is one
                    // table. Without saying which, 18 of 18 rows sitting under
                    // "429,186 rows with errors" reads as a contradiction.
                    <Chip
                      size="small"
                      variant="outlined"
                      label={report.table_name}
                      sx={{ height: 20, fontSize: "0.7rem", maxWidth: 260 }}
                    />
                  )}
                  <Tooltip title="A row is usable when it breaks no rule at all — the model's own structure and every governed rule this session runs — and is not a duplicate copy. A row with several problems is counted once.">
                    <InfoOutlinedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                  </Tooltip>
                </Stack>

                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 3, mb: 2 }}>
                  <Box sx={{ p: 2, borderRadius: 1, bgcolor: "success.50", border: "1px solid", borderColor: "success.light" }}>
                    <Typography variant="caption" color="success.dark" fontWeight={600}>CAN BE USED</Typography>
                    <Stack direction="row" alignItems="baseline" spacing={1}>
                      <Typography variant="h3" fontWeight={700} color="success.main" lineHeight={1.1}>
                        {usability.usable_percent}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {usability.usable_rows.toLocaleString()} of {usability.total_rows.toLocaleString()} rows
                      </Typography>
                    </Stack>
                  </Box>
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 1,
                      bgcolor: usability.unusable_rows > 0 ? "error.50" : "background.default",
                      border: "1px solid",
                      borderColor: usability.unusable_rows > 0 ? "error.light" : "divider",
                    }}
                  >
                    <Typography
                      variant="caption"
                      fontWeight={600}
                      color={usability.unusable_rows > 0 ? "error.dark" : "text.secondary"}
                    >
                      NEEDS FIXING FIRST
                    </Typography>
                    <Stack direction="row" alignItems="baseline" spacing={1}>
                      <Typography
                        variant="h3"
                        fontWeight={700}
                        lineHeight={1.1}
                        color={usability.unusable_rows > 0 ? "error.main" : "text.disabled"}
                      >
                        {usability.unusable_percent}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {usability.unusable_rows.toLocaleString()} of {usability.total_rows.toLocaleString()} rows
                      </Typography>
                    </Stack>
                  </Box>
                </Box>

                {/* Why. A percentage nobody can act on is not a finding, and
                    this card used to give the number with no way to reach the
                    rules behind it. Worst first; a row breaking three rules is
                    in all three lines, so these do not sum to the total. */}
                {usability.unusable_rows > 0 && (usability.reasons?.length ?? 0) > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      What is breaking
                    </Typography>
                    <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                      {usability.reasons!.slice(0, 6).map((reason) => (
                        <Stack
                          key={reason.key}
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <ErrorOutlineIcon sx={{ fontSize: 15, color: "error.main" }} />
                          <Typography variant="body2" sx={{ minWidth: 0 }}>
                            {reason.label}
                          </Typography>
                          <Box sx={{ flexGrow: 1 }} />
                          <Typography variant="body2" fontWeight={600}>
                            {reason.rows.toLocaleString()}
                            <Typography component="span" variant="caption" color="text.secondary">
                              {" "}rows · {reason.percent}%
                            </Typography>
                          </Typography>
                        </Stack>
                      ))}
                      {usability.reasons!.length > 6 && (
                        <Typography variant="caption" color="text.disabled">
                          and {usability.reasons!.length - 6} more — see Quality Check Result above.
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                )}

                {/* One bar, split by what is usable */}
                <Box sx={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", bgcolor: "grey.200" }}>
                  <Tooltip title={`${usability.usable_rows} usable rows`}>
                    <Box sx={{ width: `${usability.usable_percent}%`, bgcolor: "success.main" }} />
                  </Tooltip>
                  <Tooltip title={`${usability.unusable_rows} rows need fixing`}>
                    <Box sx={{ width: `${usability.unusable_percent}%`, bgcolor: "error.main" }} />
                  </Tooltip>
                </Box>

                {usability.unusable_rows > 0 && (
                  <Stack direction="row" spacing={2} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                    {usability.rows_with_field_problems > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        <b>{usability.rows_with_field_problems.toLocaleString()}</b> rows break a field rule
                        (missing, repeated or wrong type)
                      </Typography>
                    )}
                    {usability.duplicate_copies > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        <b>{usability.duplicate_copies.toLocaleString()}</b> rows are duplicate copies
                      </Typography>
                    )}
                  </Stack>
                )}
              </CardContent>
            </Card>
          )}

          {/* Dataset-wide checks */}
          {datasetFindings.length > 0 && (
            <Card variant="outlined">
              <CardContent sx={{ pb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600} mb={1.5}>Across all mapped fields</Typography>
                <Stack spacing={1.5}>
                  {datasetFindings.map((finding) => (
                    <Box key={finding.quality_check_id}>
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        {statusIcon(finding.status)}
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {CHECK_LABELS[finding.check_type]}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">{finding.message}</Typography>
                        </Box>
                      </Stack>
                      <FindingDetail finding={finding} />
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Governed rules this session turned on, run with its parameters */}
          {governedFindings.length > 0 && (
            <Card variant="outlined">
              <CardContent sx={{ pb: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <GavelOutlinedIcon color="primary" fontSize="small" />
                  <Typography variant="subtitle1" fontWeight={600}>Governed rules</Typography>
                  <Chip
                    size="small"
                    label={`${governedFindings.length} run`}
                    sx={{ height: 20, fontSize: "0.7rem" }}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  The governed rules you determined and configured, evaluated with this session's parameters.
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                  {governedFindings.map((finding) => (
                    <Box key={finding.quality_check_id}>
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        {statusIcon(finding.status)}
                        <Box sx={{ flex: 1 }}>
                          <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                            <Typography variant="body2" fontWeight={600}>
                              {finding.detail?.rule_name ?? CHECK_LABELS.governed_rule}
                            </Typography>
                            {finding.detail?.rule_code && (
                              <Chip
                                size="small"
                                variant="outlined"
                                label={finding.detail.rule_code}
                                sx={{ height: 18, fontSize: "0.63rem" }}
                              />
                            )}
                            <Typography variant="caption" color="text.secondary">
                              on {finding.column_name}
                            </Typography>
                          </Stack>
                          <Typography variant="body2" color="text.secondary">{finding.message}</Typography>
                          {!!finding.detail?.groups?.length && (
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                              {finding.detail.groups.map((group) => (
                                <Chip
                                  key={group.group}
                                  size="small"
                                  variant="outlined"
                                  color={
                                    finding.detail?.limit_percent !== undefined &&
                                    group.share_percent > finding.detail.limit_percent
                                      ? "error"
                                      : "default"
                                  }
                                  label={`${group.group}: ${group.share_percent}% (${group.numerator}/${group.denominator})`}
                                  sx={{ height: 22, fontSize: "0.7rem" }}
                                />
                              ))}
                            </Stack>
                          )}
                          {!!finding.detail?.unresolved_values?.length && (
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                              {finding.detail.unresolved_values.map((value) => (
                                <Chip
                                  key={value}
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  label={value || "(blank)"}
                                  sx={{ height: 22, fontSize: "0.7rem" }}
                                />
                              ))}
                            </Stack>
                          )}
                        </Box>
                      </Stack>
                      <FindingDetail finding={finding} />
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Per-field profiling detail — completeness, uniqueness and type per
              mapped field. These are automatic observations, not governed
              rules, so they live on the Profile step and appear here only for
              a run made before the two stages were separated. Showing an empty
              shell of them on a governed-only run read as "nothing was
              checked" on a run that had just failed 8,917 rows. */}
          {byColumn.length > 0 && (
          <Card variant="outlined">
            <CardContent sx={{ pb: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle1" fontWeight={600}>Mapped fields</Typography>
                <Chip size="small" label={`${byColumn.length} profiled`} sx={{ height: 20, fontSize: "0.7rem" }} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Automatic observations per field — completeness, uniqueness and type. These come
                from profiling, not from the governed rules above. Click a row for the values.
              </Typography>
            </CardContent>
            <Divider />
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: "background.default" }}>
                    <TableCell sx={{ width: 36 }} />
                    <TableCell><Typography variant="caption" fontWeight={700} color="text.secondary">Source field</Typography></TableCell>
                    <TableCell><Typography variant="caption" fontWeight={700} color="text.secondary">Model field</Typography></TableCell>
                    <TableCell><Typography variant="caption" fontWeight={700} color="text.secondary">Type</Typography></TableCell>
                    <TableCell align="right"><Typography variant="caption" fontWeight={700} color="text.secondary">Rows</Typography></TableCell>
                    <TableCell align="right"><Typography variant="caption" fontWeight={700} color="text.secondary">Missing</Typography></TableCell>
                    <TableCell align="right"><Typography variant="caption" fontWeight={700} color="text.secondary">Distinct</Typography></TableCell>
                    {FIELD_CHECKS.map((check) => (
                      <TableCell key={check} align="center">
                        <Typography variant="caption" fontWeight={700} color="text.secondary">
                          {CHECK_SHORT[check]}
                        </Typography>
                      </TableCell>
                    ))}
                    <TableCell sx={{ width: 36 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {byColumn.map(([columnId, entry]) => {
                    const worst = worstOf(entry.items);
                    const isOpen = !!expanded[columnId];
                    const completeness = checkOf(entry.items, "completeness");
                    const typeCheck = checkOf(entry.items, "type_conformance");
                    const totalRows = completeness?.total_count ?? 0;
                    const missing = completeness?.observed_count ?? 0;
                    const distinct =
                      entry.items.find((i) => typeof i.detail?.distinct_count === "number")
                        ?.detail.distinct_count ?? 0;
                    const missingPct = totalRows > 0 ? (missing / totalRows) * 100 : 0;

                    return [
                      <TableRow
                        key={columnId}
                        hover
                        onClick={() => setExpanded((prev) => ({ ...prev, [columnId]: !prev[columnId] }))}
                        sx={{
                          cursor: "pointer",
                          bgcolor: worst === "failed" ? "error.50" : worst === "warning" ? "warning.50" : "transparent",
                          "& > td": { borderBottom: isOpen ? "none" : undefined },
                        }}
                      >
                        <TableCell>{statusIcon(worst, 18)}</TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} noWrap>{entry.name}</Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <ArrowForwardIcon sx={{ fontSize: 12, color: "text.disabled" }} />
                            <Typography variant="body2" color="primary" fontWeight={500} noWrap>
                              {entry.target ?? "—"}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {typeCheck?.detail?.datatype ?? "—"}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">{totalRows.toLocaleString()}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            fontWeight={missing > 0 ? 600 : 400}
                            color={missing > 0 ? "warning.main" : "text.secondary"}
                          >
                            {missing.toLocaleString()}
                            {missing > 0 && (
                              <Typography component="span" variant="caption" color="text.secondary">
                                {" "}({missingPct.toFixed(0)}%)
                              </Typography>
                            )}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">{distinct.toLocaleString()}</Typography>
                        </TableCell>
                        {FIELD_CHECKS.map((check) => {
                          const finding = checkOf(entry.items, check);
                          if (!finding) {
                            return (
                              <TableCell key={check} align="center">
                                <Tooltip
                                  title={
                                    check === "uniqueness"
                                      ? "The model does not require this field to be unique, so repeated values are allowed."
                                      : "Not applicable to this field."
                                  }
                                >
                                  <Typography variant="caption" color="text.disabled">n/a</Typography>
                                </Tooltip>
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={check} align="center">
                              <Tooltip title={finding.message}>
                                <Chip
                                  size="small"
                                  icon={statusIcon(finding.status, 13)}
                                  label={finding.status === "passed" ? "OK" : finding.observed_count.toLocaleString()}
                                  color={statusColor(finding.status)}
                                  variant={finding.status === "passed" ? "outlined" : "filled"}
                                  sx={{ height: 22, fontSize: "0.7rem", fontWeight: 600, minWidth: 54 }}
                                />
                              </Tooltip>
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          <ExpandMoreIcon
                            fontSize="small"
                            sx={{
                              color: "text.disabled",
                              transform: isOpen ? "rotate(180deg)" : "none",
                              transition: "0.2s",
                            }}
                          />
                        </TableCell>
                      </TableRow>,
                      <TableRow key={`${columnId}-detail`}>
                        <TableCell colSpan={8 + FIELD_CHECKS.length} sx={{ py: 0, borderBottom: isOpen ? undefined : "none" }}>
                          <Collapse in={isOpen} unmountOnExit>
                            <Stack spacing={1.5} sx={{ py: 2 }}>
                              {entry.items.map((finding) => (
                                <Box key={finding.quality_check_id}>
                                  <Stack direction="row" spacing={1} alignItems="flex-start">
                                    {statusIcon(finding.status)}
                                    <Box sx={{ flex: 1 }}>
                                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                        <Typography variant="body2" fontWeight={600}>
                                          {CHECK_LABELS[finding.check_type]}
                                        </Typography>
                                        {finding.rule_source === "model structure" && (
                                          <Chip size="small" label="rule from model" variant="outlined"
                                            sx={{ height: 18, fontSize: "0.65rem" }} />
                                        )}
                                      </Stack>
                                      <Typography variant="body2" color="text.secondary">{finding.message}</Typography>
                                    </Box>
                                  </Stack>
                                  <FindingDetail finding={finding} />
                                </Box>
                              ))}
                            </Stack>
                          </Collapse>
                        </TableCell>
                      </TableRow>,
                    ];
                  })}
                </TableBody>
              </Table>
            </Box>
          </Card>
          )}
        </>
      )}

      {canRun && unmappedCount > 0 && (
        <Alert severity="info" variant="outlined">
          {unmappedCount} column{unmappedCount === 1 ? " is" : "s are"} not mapped to the model structure, so
          {unmappedCount === 1 ? " it is" : " they are"} not checked here. Map{" "}
          {unmappedCount === 1 ? "it" : "them"} on the Mapping step to include{" "}
          {unmappedCount === 1 ? "it" : "them"}.
        </Alert>
      )}
    </Box>
  );
}
