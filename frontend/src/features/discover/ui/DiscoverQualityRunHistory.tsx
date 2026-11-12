/**
 * Every check this session has been through, and what each one found.
 *
 * A run is kept rather than overwritten, so this is the only place that can
 * answer "what did we know on the 14th, and what did we measure it against".
 * Everything on screen is read from the stored run — none of it is recomputed
 * against the rules or the mapping as they stand now, because those are
 * exactly the things that have moved.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
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
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import CloseIcon from "@mui/icons-material/Close";
import FingerprintOutlinedIcon from "@mui/icons-material/FingerprintOutlined";
import { discoverApi } from "@/features/discover/api/discoverApi";
import type {
  QualityRun,
  QualityRunGroup,
  QualityRunHistory,
} from "@/features/discover/api/discoverApi";
import { DISPLAY_ZONE_LABEL, readableDateWithZone } from "@/features/discover/ui/displayTime";

type Props = {
  sessionId: string;
  history: QualityRunHistory;
};

const countLabel = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "DQ-0001 v2" — the rule and the version of it that actually ran. */
function RuleVersionChips({
  used,
}: {
  used: { rule_definition_id: string; version: string; code: string; name: string }[];
}) {
  if (used.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No library rule was attached — the automatic structure checks only.
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
      {used.map((rule) => (
        <Tooltip key={`${rule.rule_definition_id}:${rule.version}`} title={rule.name}>
          <Chip
            size="small"
            variant="outlined"
            label={`${rule.code || "rule"} v${rule.version}`}
            sx={{ height: 22, fontSize: "0.7rem" }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} color={tone}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

/** One run's findings, as they were written. Loaded only when asked for. */
function RunFindingsDialog({
  sessionId,
  run,
  onClose,
}: {
  sessionId: string;
  run: QualityRun;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["discover", "qualityRun", sessionId, run.quality_run_id],
    queryFn: async () => discoverApi.getQualityRun(sessionId, run.quality_run_id),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        <Typography variant="h6" fontWeight={700}>
          {run.table_name || "This table"}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Checked {readableDateWithZone(run.completed_at)}
          {run.requested_by && ` by ${run.requested_by}`}
        </Typography>
        <IconButton onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {detail.isPending && (
          <Stack direction="row" spacing={1.5} alignItems="center" py={3}>
            <CircularProgress size={18} />
            <Typography variant="body2">Reading the run…</Typography>
          </Stack>
        )}
        {detail.error instanceof Error && (
          <Alert severity="error">{detail.error.message}</Alert>
        )}
        {detail.data && (
          <Stack spacing={2.5}>
            {/* What it was measured against. The fingerprints identify it; the
                snapshots below are it. */}
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Figure label="fields checked" value={String(detail.data.checked_columns)} />
              <Figure label="findings" value={String(detail.data.findings_total)} />
              <Figure
                label="failed"
                value={String(detail.data.failed_count)}
                tone={detail.data.failed_count > 0 ? "error.main" : undefined}
              />
              <Figure
                label="warnings"
                value={String(detail.data.warning_count)}
                tone={detail.data.warning_count > 0 ? "warning.main" : undefined}
              />
              <Figure label="rows" value={detail.data.rows_total.toLocaleString()} />
            </Stack>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center" mb={0.75}>
                <FingerprintOutlinedIcon fontSize="small" color="disabled" />
                <Typography variant="subtitle2" fontWeight={700}>
                  What this run was measured against
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" component="div">
                mapping <code>{detail.data.mapping_version || "—"}</code> · rules{" "}
                <code>{detail.data.rule_version || "—"}</code>
              </Typography>
              <Box mt={1}>
                <RuleVersionChips used={detail.data.rule_versions} />
              </Box>
            </Box>

            {detail.data.rule_snapshot.length > 0 && (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  The rules it ran, with the parameters it ran them with
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Rule</TableCell>
                      <TableCell>Field</TableCell>
                      <TableCell>Severity</TableCell>
                      <TableCell>Parameters as used</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.data.rule_snapshot.map((rule) => (
                      <TableRow key={rule.configuration_id || rule.rule_id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {rule.code} {rule.name}
                          </Typography>
                          {rule.source_rule_version && (
                            <Typography variant="caption" color="text.secondary">
                              library version {rule.source_rule_version}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{rule.column_name || "All mapped fields"}</TableCell>
                        <TableCell>{rule.severity || "—"}</TableCell>
                        <TableCell>
                          <Typography variant="caption" component="code">
                            {Object.keys(rule.parameters).length
                              ? JSON.stringify(rule.parameters)
                              : "none"}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                What it found
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Field</TableCell>
                    <TableCell>Check</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Message</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detail.data.findings.map((finding) => (
                    <TableRow key={finding.quality_check_id}>
                      <TableCell>{finding.column_name}</TableCell>
                      <TableCell>{finding.check_type}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={finding.status}
                          color={
                            finding.status === "failed"
                              ? "error"
                              : finding.status === "warning"
                                ? "warning"
                                : "default"
                          }
                          variant="outlined"
                          sx={{ height: 20, fontSize: "0.68rem" }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{finding.message}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RunGroupRow({
  sessionId,
  group,
  ordinal,
  isCurrent,
  onOpenRun,
}: {
  sessionId: string;
  group: QualityRunGroup;
  ordinal: number;
  isCurrent: boolean;
  onOpenRun: (run: QualityRun) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", py: 1.25 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
        <IconButton size="small" onClick={() => setOpen((v) => !v)}>
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
          />
        </IconButton>
        <Typography variant="body2" fontWeight={700} sx={{ minWidth: 60 }}>
          Run {ordinal}
        </Typography>
        <Typography variant="body2" sx={{ minWidth: 230 }}>
          {readableDateWithZone(group.completed_at)}
        </Typography>
        {isCurrent && (
          <Chip size="small" color="primary" label="showing now" sx={{ height: 20, fontSize: "0.68rem" }} />
        )}
        <Typography variant="caption" color="text.secondary">
          {countLabel(group.tables, "table")} · {countLabel(group.findings_total, "finding")}
        </Typography>
        {group.failed_count > 0 && (
          <Chip
            size="small"
            color="error"
            variant="outlined"
            label={`${group.failed_count} failed`}
            sx={{ height: 20, fontSize: "0.68rem" }}
          />
        )}
        {group.warning_count > 0 && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={`${group.warning_count} warning${group.warning_count === 1 ? "" : "s"}`}
            sx={{ height: 20, fontSize: "0.68rem" }}
          />
        )}
        {group.requested_by && (
          <Typography variant="caption" color="text.secondary">
            by {group.requested_by}
          </Typography>
        )}
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 5.5, pt: 1.5, pb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" component="div" gutterBottom>
            Rule versions this run executed
          </Typography>
          <Box mb={2}>
            <RuleVersionChips used={group.rule_versions} />
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Table</TableCell>
                <TableCell align="right">Fields</TableCell>
                <TableCell align="right">Findings</TableCell>
                <TableCell align="right">Failed</TableCell>
                <TableCell align="right">Warnings</TableCell>
                <TableCell align="right">Rows</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {group.runs.map((run) => (
                <TableRow key={run.quality_run_id} hover>
                  <TableCell>{run.table_name || "Unnamed table"}</TableCell>
                  <TableCell align="right">{run.checked_columns}</TableCell>
                  <TableCell align="right">{run.findings_total}</TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      color={run.failed_count > 0 ? "error.main" : undefined}
                    >
                      {run.failed_count}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{run.warning_count}</TableCell>
                  <TableCell align="right">{run.rows_total.toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => onOpenRun(run)} sx={{ textTransform: "none" }}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Collapse>
    </Box>
  );
}

export function DiscoverQualityRunHistory({ sessionId, history }: Props) {
  const [openRun, setOpenRun] = useState<QualityRun | null>(null);
  if (history.run_count === 0) return null;

  const current = new Set(history.current_run_ids);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
          <HistoryOutlinedIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={600}>
            Run history
          </Typography>
          <Chip
            size="small"
            label={countLabel(history.run_count, "run")}
            sx={{ height: 20, fontSize: "0.7rem" }}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          This session has been checked {countLabel(history.run_count, "time")}.
          {history.total !== history.run_count &&
            ` A check covers every mapped table, so that is ${countLabel(history.total, "table record")}.`}{" "}
          Every run is kept — opening one shows what it found and the rules and
          mapping it was measured against, as they were then.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Times shown in {DISPLAY_ZONE_LABEL} time.
        </Typography>

        <Box mt={1.5}>
          {history.groups.map((group, index) => (
            <RunGroupRow
              key={group.key}
              sessionId={sessionId}
              group={group}
              // Newest first on screen, but "Run 1" should be the first check
              // the session ever had, not the latest one.
              ordinal={history.groups.length - index}
              isCurrent={group.runs.some((run) => current.has(run.quality_run_id))}
              onOpenRun={setOpenRun}
            />
          ))}
        </Box>
        <Divider sx={{ mt: 1 }} />
      </CardContent>

      {openRun && (
        <RunFindingsDialog
          sessionId={sessionId}
          run={openRun}
          onClose={() => setOpenRun(null)}
        />
      )}
    </Card>
  );
}
