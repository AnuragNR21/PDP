/**
 * Admin → Data retention: when archived discovery sessions are deleted.
 *
 * Two numbers, and one thing the screen owes the person who sets them: the
 * hour is stored in UTC+0, and almost nobody lives there. A setting of "02:00"
 * that silently means 09:00 to the person reading it is how a deletion job
 * ends up running in the middle of the working day, so the local equivalent
 * is spelled out beside the field and the next run is given as a real date.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";

import {
  DISPLAY_ZONE_LABEL,
  readableDate,
  readableDateWithZone,
  utcHourInZone,
} from "./displayTime";
import { useRetentionPolicy } from "../state/useRetentionPolicy";
import { SectionPanel } from "@/shared/workspace/WorkspaceHeaderCard";

const MIN_DAYS = 1;
const MAX_DAYS = 31;

/**
 * Both fields, the same width.
 *
 * Wide enough for the longer label — "Run the deletion job at (UTC+0)" shrinks
 * to about 173px in the notch — and equal so the pair stays lined up whether
 * they sit side by side or wrap onto two lines on a narrow screen.
 */
const FIELD_WIDTH = 288;

/** An em dash for a date that does not exist yet, rather than a blank cell. */
function orDash(value: string): string {
  return value || "—";
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Box sx={{ minWidth: 150 }}>
      <Typography variant="h6" fontWeight={700} color={tone ?? "text.primary"} lineHeight={1.3}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

export function DiscoverRetentionAdmin() {
  const { statusQuery, saveMutation, runNowMutation } = useRetentionPolicy();
  const status = statusQuery.data;

  const [days, setDays] = useState("");
  const [hour, setHour] = useState("");

  // Seed the fields from the server once, then leave the person's typing alone.
  useEffect(() => {
    if (!status) return;
    setDays((current) => (current === "" ? String(status.retention_days) : current));
    setHour((current) => (current === "" ? String(status.purge_hour_utc) : current));
  }, [status]);

  if (statusQuery.isLoading) {
    return <Typography color="text.secondary">Loading the retention policy…</Typography>;
  }
  if (!status) {
    return <Alert severity="error">Could not read the retention policy.</Alert>;
  }

  const parsedDays = Number.parseInt(days, 10);
  const daysValid = Number.isFinite(parsedDays) && parsedDays >= MIN_DAYS && parsedDays <= MAX_DAYS;
  const chosenHour = Number.parseInt(hour, 10);
  const hourValid = Number.isFinite(chosenHour) && chosenHour >= 0 && chosenHour <= 23;
  const changed =
    daysValid && hourValid &&
    (parsedDays !== status.retention_days || chosenHour !== status.purge_hour_utc);

  return (
    <Stack spacing={3}>
      {saveMutation.error instanceof Error && (
        <Alert severity="error">{saveMutation.error.message}</Alert>
      )}
      {runNowMutation.data && (
        <Alert severity={runNowMutation.data.failed > 0 ? "warning" : "success"}>
          Deleted {runNowMutation.data.deleted} archived session
          {runNowMutation.data.deleted === 1 ? "" : "s"}
          {runNowMutation.data.failed > 0 && ` · ${runNowMutation.data.failed} could not be deleted`}.
          {/* Nothing deleted is the normal answer most days. Saying why, and
              when that changes, is the difference between a job that looks
              broken and a policy that is visibly working. */}
          {runNowMutation.data.deleted === 0 && runNowMutation.data.failed === 0 && (
            status.archived_sessions === 0
              ? " Nothing is archived."
              : ` None of the ${status.archived_sessions} archived session${
                  status.archived_sessions === 1 ? " has" : "s have"
                } reached ${status.retention_days} day${status.retention_days === 1 ? "" : "s"} yet${
                  status.next_due_at ? ` — the first is due ${readableDateWithZone(status.next_due_at)}` : ""
                }.`
          )}
        </Alert>
      )}

      {/* ── the policy ──────────────────────────────────────────────────── */}
      <SectionPanel title="Archived sessions">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            A session archived from the Discovery Workspace keeps everything it holds
            until this policy runs out. Deletion is permanent and takes the files,
            rows, mappings and quality findings with it.
          </Typography>

          {/* Both controls are outlined, small, with the label in the notch and
              the explanation in a FormHelperText. Mixing a TextField with a
              caption-above-a-bare-Select put the two boxes and their helper
              lines on four different heights. */}
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2.5}
            alignItems="flex-start"
            flexWrap="wrap"
            useFlexGap
          >
            <TextField
              label="Keep archived sessions for"
              type="number"
              size="small"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              error={days !== "" && !daysValid}
              helperText={
                days !== "" && !daysValid
                  ? `Between ${MIN_DAYS} and ${MAX_DAYS} days.`
                  : `days · ${MIN_DAYS} to ${MAX_DAYS} (one month)`
              }
              inputProps={{ min: MIN_DAYS, max: MAX_DAYS }}
              sx={{ width: { xs: "100%", md: FIELD_WIDTH } }}
            />

            <FormControl
              size="small"
              error={hour !== "" && !hourValid}
              sx={{ width: { xs: "100%", md: FIELD_WIDTH } }}
            >
              <InputLabel id="purge-hour-label">Run the deletion job at (UTC+0)</InputLabel>
              <Select
                labelId="purge-hour-label"
                // `label` as well as the InputLabel: without it the outline has
                // no notch and the label sits on top of the border.
                label="Run the deletion job at (UTC+0)"
                value={hourValid ? String(chosenHour) : ""}
                onChange={(e) => setHour(e.target.value)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <MenuItem key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00 UTC
                  </MenuItem>
                ))}
              </Select>
              {/* Rendered even when empty so the two helper lines keep the
                  same baseline and the row does not jump as the hour changes. */}
              <FormHelperText>
                {hourValid ? (
                  <>
                    That is <strong>{utcHourInZone(chosenHour)}</strong> in {DISPLAY_ZONE_LABEL}.
                  </>
                ) : (
                  " "
                )}
              </FormHelperText>
            </FormControl>
          </Stack>

          {/* The one thing this screen must not leave implicit. */}
          <Alert severity="info" icon={<ScheduleOutlinedIcon fontSize="inherit" />} sx={{ mt: 3 }}>
            <Typography variant="body2">
              The job runs <strong>once a day at {String(status.purge_hour_utc).padStart(2, "0")}:00 UTC+0</strong>
              {" "}— <strong>{utcHourInZone(status.purge_hour_utc)}</strong> in {DISPLAY_ZONE_LABEL} — and
              deletes every archived session older than {status.retention_days} day
              {status.retention_days === 1 ? "" : "s"}. The hour is set in UTC+0 and stays
              there; {DISPLAY_ZONE_LABEL} observes daylight saving, so the Australian time
              above moves by an hour twice a year — AEST (UTC+10) in winter, AEDT (UTC+11)
              from October to April.
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              If the server was asleep at that hour, the job runs as soon as somebody next
              uses the workspace — a missed night is caught up, never skipped.
            </Typography>
          </Alert>

          <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
            <Button
              variant="contained"
              disabled={!changed || saveMutation.isPending}
              onClick={() =>
                saveMutation.mutate({ retention_days: parsedDays, purge_hour_utc: chosenHour })
              }
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              {saveMutation.isPending ? "Saving…" : "Save policy"}
            </Button>
            <Button
              variant="text"
              disabled={!changed}
              onClick={() => {
                setDays(String(status.retention_days));
                setHour(String(status.purge_hour_utc));
              }}
              sx={{ textTransform: "none" }}
            >
              Reset
            </Button>
          </Stack>
        </SectionPanel>

      {/* ── what the job has done and will do ───────────────────────────── */}
      <SectionPanel title="The deletion job"><Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            Times shown in {DISPLAY_ZONE_LABEL} time.
          </Typography>
          <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Fact label="sessions archived" value={String(status.archived_sessions)} />
            <Fact
              label="already past their retention"
              value={String(status.due_now)}
              tone={status.due_now > 0 ? "warning.main" : undefined}
            />
            {status.archived_sessions > 0 && status.due_now === 0 && (
              <Fact
                label="first one due"
                value={orDash(readableDateWithZone(status.next_due_at))}
              />
            )}
            <Divider orientation="vertical" flexItem />
            <Fact label="next run" value={orDash(readableDateWithZone(status.next_run_at))} />
            <Fact label="last run" value={orDash(readableDate(status.last_run_at))} />
            <Fact
              label="deleted on the last run"
              value={String(status.last_deleted_count)}
            />
          </Stack>

          {status.last_outcome && status.last_outcome !== "ok" && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Last run: {status.last_outcome}
            </Alert>
          )}

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              color={status.due_now > 0 ? "warning" : "inherit"}
              startIcon={<DeleteSweepOutlinedIcon />}
              disabled={runNowMutation.isPending}
              onClick={() => runNowMutation.mutate()}
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              {runNowMutation.isPending ? "Running…" : "Run now"}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {status.due_now > 0
                ? "Deletes everything already past its retention, without waiting for the hour."
                : "Nothing is past its retention, so this would delete nothing. It does not shorten the policy."}
            </Typography>
            {status.due_now > 0 && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`${status.due_now} would be deleted`}
                sx={{ height: 22 }}
              />
            )}
          </Stack>
        </SectionPanel>
    </Stack>
  );
}
