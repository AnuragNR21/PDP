import { useRef } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import CircularProgress from "@mui/material/CircularProgress";
import type { QualityJob, QualityRunProgress } from "@/features/discover/api/discoverApi";

type Props = { progress: QualityRunProgress };

function JobIcon({ status }: { status: QualityJob["status"] }) {
  if (status === "running") return <CircularProgress size={14} />;
  if (status === "succeeded") return <CheckCircleIcon color="success" sx={{ fontSize: 16 }} />;
  if (status === "failed") return <ErrorOutlineIcon color="error" sx={{ fontSize: 16 }} />;
  if (status === "skipped")
    return <RemoveCircleOutlineIcon sx={{ fontSize: 16, color: "text.disabled" }} />;
  return <HourglassEmptyIcon sx={{ fontSize: 16, color: "text.disabled" }} />;
}

/** What a table is doing, in the words a person would use. */
function describe(job: QualityJob): string {
  if (job.status === "queued" || job.status === "waiting") return "Waiting for a worker";
  if (job.status === "running") {
    return job.columns_total > 0
      ? `${job.stage} — field ${Math.min(job.columns_done + 1, job.columns_total)} of ${job.columns_total}`
      : job.stage;
  }
  if (job.status === "skipped") return job.message || "Skipped";
  if (job.status === "failed") return job.message || "Could not be checked";
  // Mapped, not assessed. Since the automatic checks moved to Profile, a
  // mapped field with no governed rule on it is not checked here at all, and
  // "4 fields checked · 1 failing" read as though three of them had passed.
  const parts = [`${job.checked_columns} field${job.checked_columns === 1 ? "" : "s"} mapped`];
  if (job.failed_count > 0) parts.push(`${job.failed_count} failing`);
  if (job.warnings > 0) parts.push(`${job.warnings} warning${job.warnings === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * A quality run in flight, table by table.
 *
 * The run happens on the server, so this is a window onto it rather than the
 * thing itself: closing the page does not stop it, and opening the page again
 * shows it wherever it has got to. That is the reason for showing a
 * percentage at all — a spinner would say "wait", and the honest thing to say
 * is "this is still going, and you need not stay".
 */
export function DiscoverQualityRunProgress({ progress }: Props) {
  // A bar that goes backwards says the work was undone.
  //
  // The run's percentage is the mean of its tables', so anything that lowers
  // one table lowers the whole bar. The server no longer lets a table's own
  // figure fall, and this holds the line for the rest: whatever the arriving
  // numbers say, the bar only ever moves forward within a run. A new run has
  // a new id and starts again from nothing.
  const runId = progress.jobs[0]?.run_id ?? "";
  const highWater = useRef({ runId, percent: 0 });
  if (highWater.current.runId !== runId) {
    highWater.current = { runId, percent: 0 };
  }
  highWater.current.percent = Math.max(highWater.current.percent, progress.percent);
  const percent = highWater.current.percent;

  if (!progress.has_run) return null;

  const working = progress.is_working;
  const failed = progress.jobs.filter((j) => j.status === "failed");

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
          {working && <CircularProgress size={16} />}
          <Typography variant="subtitle1" fontWeight={600}>
            {working ? "Running the checks" : "Checks complete"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {progress.tables_done} of {progress.tables_total} table
            {progress.tables_total === 1 ? "" : "s"}
            {progress.running > 0 && ` · ${progress.running} running at once`}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="h6" fontWeight={700} color={working ? "primary.main" : "text.primary"}>
            {percent}%
          </Typography>
        </Stack>

        <LinearProgress
          variant="determinate"
          value={percent}
          color={progress.failed > 0 ? "warning" : "primary"}
          sx={{ height: 8, borderRadius: 4, mb: working ? 1 : 2 }}
        />

        {working && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            This runs on the server — you can leave this page and come back to it.
          </Typography>
        )}

        <Stack spacing={1.2}>
          {progress.jobs.map((job) => (
            <Stack key={job.job_id} direction="row" spacing={1.2} alignItems="flex-start">
              <Box sx={{ pt: 0.2 }}>
                <JobIcon status={job.status} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                  <TableChartOutlinedIcon sx={{ fontSize: 13, color: "text.disabled" }} />
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 360 }}>
                    {job.table_name}
                  </Typography>
                  {job.status === "succeeded" && job.failed_count > 0 && (
                    <Chip
                      size="small"
                      color="error"
                      variant="outlined"
                      label={`${job.failed_count} failing`}
                      sx={{ height: 18, fontSize: "0.68rem" }}
                    />
                  )}
                  {job.status === "running" && (
                    <Typography variant="caption" color="primary.main" fontWeight={600}>
                      {job.progress}%
                    </Typography>
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {describe(job)}
                </Typography>
                {(job.status === "running" || job.status === "queued") && (
                  <LinearProgress
                    variant={job.status === "queued" ? "indeterminate" : "determinate"}
                    value={job.progress}
                    sx={{ height: 3, borderRadius: 2, mt: 0.5 }}
                  />
                )}
              </Box>
            </Stack>
          ))}
        </Stack>

        {failed.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2, py: 0.5 }}>
            {failed.length} table{failed.length === 1 ? "" : "s"} could not be checked — the
            tables that worked are already reported below.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
