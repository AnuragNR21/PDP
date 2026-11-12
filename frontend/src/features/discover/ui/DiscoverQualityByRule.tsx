import { useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import type {
  QualityByRuleReport,
  QualityRuleSummary,
  QualityRuleTarget,
  QualityStatus,
} from "@/features/discover/api/discoverApi";

type Props = { report: QualityByRuleReport };

/**
 * Severity as the Rule Workspace defines it. Nothing here invents a level:
 * a rule shows the severity it was given when it was written, and a check
 * that was never given one shows none.
 */
const SEVERITY_LABEL: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
const SEVERITY_COLOR: Record<string, "error" | "warning" | "info"> = {
  high: "error",
  medium: "warning",
  low: "info",
};

/** Plain names for the checks the platform runs without being asked. */
const AUTOMATIC_LABEL: Record<string, string> = {
  completeness: "No missing values",
  uniqueness: "No repeated values",
  type_conformance: "Correct data type",
  duplicate_records: "No duplicate records",
  overlap: "No overlapping fields",
};

/**
 * What to call a rule on screen.
 *
 * An automatic check has no name of its own — its "name" is the internal
 * check type — so it is given the same plain words used everywhere else.
 */
function labelFor(kind: string, checkType: string, name: string): string {
  if (kind === "automatic") return AUTOMATIC_LABEL[checkType] ?? checkType;
  return name;
}

function ruleLabel(rule: QualityRuleSummary): string {
  return labelFor(rule.kind, rule.check_type, rule.name);
}

function statusIcon(status: QualityStatus, size = 18) {
  if (status === "passed") return <CheckCircleIcon color="success" sx={{ fontSize: size }} />;
  if (status === "warning") return <WarningAmberIcon color="warning" sx={{ fontSize: size }} />;
  return <ErrorOutlineIcon color="error" sx={{ fontSize: size }} />;
}

function statusWord(status: QualityStatus): string {
  if (status === "passed") return "Clean";
  return status === "warning" ? "Warning" : "Failing";
}

/** A number and what it counts, for the strip along the top. */
function Stat({
  value,
  label,
  color,
  hint,
  title,
}: {
  value: string | number;
  label: string;
  color?: string;
  /** A second line under the label — a denominator, or what the number counts. */
  hint?: string;
  title?: string;
}) {
  const body = (
    <Box sx={{ minWidth: 92 }}>
      <Typography variant="h5" fontWeight={700} color={color ?? "text.primary"} lineHeight={1.2}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      {hint && (
        <Typography variant="caption" color="text.disabled" display="block" lineHeight={1.3}>
          {hint}
        </Typography>
      )}
    </Box>
  );
  return title ? <Tooltip title={title}>{body}</Tooltip> : body;
}

/** Where one rule broke: a field, in a table, with the count that failed. */
function TargetRow({ target }: { target: QualityRuleTarget }) {
  const share =
    target.total_count > 0 ? (target.observed_count / target.total_count) * 100 : 0;
  return (
    <TableRow>
      <TableCell sx={{ pl: 6, width: 30 }}>{statusIcon(target.status, 15)}</TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <TableChartOutlinedIcon sx={{ fontSize: 14, color: "text.disabled" }} />
          <Typography variant="body2" color="text.secondary">{target.table_name}</Typography>
        </Stack>
      </TableCell>
      <TableCell>
        <Typography variant="body2" fontWeight={target.status === "passed" ? 400 : 600}>
          {target.column_name}
        </Typography>
        {target.target_name && (
          <Typography variant="caption" color="text.secondary">
            mapped to {target.target_name}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">
        {target.status === "passed" ? (
          <Typography variant="body2" color="text.secondary">—</Typography>
        ) : (
          <Typography variant="body2" fontWeight={600} color={target.status === "failed" ? "error.main" : "warning.main"}>
            {target.observed_count.toLocaleString()}
            <Typography component="span" variant="caption" color="text.secondary">
              {" "}/ {target.total_count.toLocaleString()} ({share.toFixed(1)}%)
            </Typography>
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <Typography variant="caption" color="text.secondary">{target.message}</Typography>
      </TableCell>
    </TableRow>
  );
}

function RuleRow({ rule }: { rule: QualityRuleSummary }) {
  // A failing rule opens itself: the reason someone is on this screen is the
  // thing that is wrong, and making them click to see where is a click that
  // has no other possible answer.
  const [open, setOpen] = useState(rule.status !== "passed");
  const share = rule.rows_total > 0 ? (rule.rows_flagged / rule.rows_total) * 100 : 0;

  return (
    <>
      <TableRow
        hover
        onClick={() => setOpen((o) => !o)}
        sx={{ cursor: "pointer", "& > td": { borderBottom: open ? "none" : undefined } }}
      >
        <TableCell sx={{ width: 30, pr: 0 }}>
          <IconButton size="small" sx={{ p: 0.2 }}>
            {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ width: 30, pl: 0 }}>{statusIcon(rule.status)}</TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={600}>{ruleLabel(rule)}</Typography>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            {rule.code && (
              <Typography variant="caption" color="text.secondary">{rule.code}</Typography>
            )}
            <Typography variant="caption" color="text.disabled">
              ran on {rule.tables_checked} table{rule.tables_checked === 1 ? "" : "s"} ·
              {" "}{rule.runs} field{rule.runs === 1 ? "" : "s"}
            </Typography>
          </Stack>
        </TableCell>
        <TableCell>
          {rule.severity ? (
            <Chip
              size="small"
              variant="outlined"
              color={SEVERITY_COLOR[rule.severity] ?? "default"}
              label={SEVERITY_LABEL[rule.severity] ?? rule.severity}
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          ) : (
            <Tooltip title="Automatic checks are not given a severity — only rules you define carry one.">
              <Typography variant="caption" color="text.disabled">—</Typography>
            </Tooltip>
          )}
        </TableCell>
        <TableCell>
          <Typography
            variant="body2"
            fontWeight={600}
            color={
              rule.status === "passed"
                ? "success.main"
                : rule.status === "warning"
                ? "warning.main"
                : "error.main"
            }
          >
            {statusWord(rule.status)}
          </Typography>
        </TableCell>
        <TableCell align="right">
          {rule.fields_failing_count > 0 ? (
            <Typography variant="body2" fontWeight={600}>
              {rule.fields_failing_count}
              <Typography component="span" variant="caption" color="text.secondary">
                {" "}in {rule.tables_failing_count} table{rule.tables_failing_count === 1 ? "" : "s"}
              </Typography>
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">none</Typography>
          )}
        </TableCell>
        <TableCell align="right" sx={{ minWidth: 120 }}>
          {rule.counts_rows ? (
            <>
              <Typography variant="body2" fontWeight={rule.rows_flagged > 0 ? 600 : 400}>
                {rule.rows_flagged.toLocaleString()}
                <Typography component="span" variant="caption" color="text.secondary">
                  {" "}/ {rule.rows_total.toLocaleString()}
                </Typography>
              </Typography>
              {rule.rows_total > 0 && (
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, share)}
                  color={rule.status === "passed" ? "success" : rule.status === "warning" ? "warning" : "error"}
                  sx={{ height: 3, borderRadius: 2, mt: 0.4 }}
                />
              )}
            </>
          ) : (
            // A share or a readiness decision is a judgement about a whole
            // column or a whole run. Printing 0 would read as "clean".
            <Tooltip title="This rule measures a proportion, not individual rows.">
              <Typography variant="body2" color="text.disabled">—</Typography>
            </Tooltip>
          )}
        </TableCell>
        <TableCell align="right" sx={{ minWidth: 90 }}>
          {rule.counts_values ? (
            <Typography variant="body2" fontWeight={rule.values_flagged > 0 ? 600 : 400}>
              {rule.values_flagged.toLocaleString()}
            </Typography>
          ) : (
            <Tooltip title="This rule counts something other than field values — pairs of fields, or whole check groups.">
              <Typography variant="body2" color="text.disabled">—</Typography>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={8} sx={{ py: 0, borderBottom: open ? undefined : "none" }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ py: 1 }}>
              <Table size="small">
                <TableBody>
                  {rule.targets.map((target) => (
                    <TargetRow key={target.quality_check_id} target={target} />
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function RuleTable({ rules }: { rules: QualityRuleSummary[] }) {
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: "background.default" }}>
            <TableCell sx={{ width: 30 }} />
            <TableCell sx={{ width: 30 }} />
            <TableCell><Typography variant="caption" fontWeight={700} color="text.secondary">Rule</Typography></TableCell>
            <TableCell><Typography variant="caption" fontWeight={700} color="text.secondary">Severity</Typography></TableCell>
            <TableCell><Typography variant="caption" fontWeight={700} color="text.secondary">Result</Typography></TableCell>
            <TableCell align="right"><Typography variant="caption" fontWeight={700} color="text.secondary">Fields affected</Typography></TableCell>
            <TableCell align="right"><Typography variant="caption" fontWeight={700} color="text.secondary">Rows with errors</Typography></TableCell>
            <TableCell align="right"><Typography variant="caption" fontWeight={700} color="text.secondary">Cells with errors</Typography></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rules.map((rule) => (
            <RuleRow key={rule.key} rule={rule} />
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/**
 * The quality run read by rule rather than by field.
 *
 * The field view answers "what is wrong with this column". This answers what
 * a person asks before that: which rules ran, which are failing, how severe
 * they are, and which table and field each one broke in.
 */
export function DiscoverQualityByRule({ report }: Props) {
  const [filter, setFilter] = useState<"all" | "problems">("problems");

  if (!report.has_run || report.rules.length === 0) return null;

  const shown =
    filter === "problems" ? report.rules.filter((r) => r.status !== "passed") : report.rules;
  const governed = shown.filter((r) => r.kind === "governed");
  const automatic = shown.filter((r) => r.kind === "automatic");
  const worst = report.worst_rule;

  return (
    <Stack spacing={2}>
      {/* ── what the run amounts to ───────────────────────────────────────── */}
      <Card variant="outlined">
        <CardContent sx={{ pb: 2 }}>
          <Stack
            direction="row"
            spacing={4}
            alignItems="flex-start"
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: report.by_severity.length || worst ? 2 : 0 }}
          >
            <Stat value={report.rules_run} label="rules run" />
            <Stat
              value={report.rules_failing}
              label="failing"
              color={report.rules_failing > 0 ? "error.main" : "text.primary"}
            />
            <Stat
              value={report.rules_warning}
              label="warnings"
              color={report.rules_warning > 0 ? "warning.main" : "text.primary"}
            />
            <Stat
              value={report.rules_clean}
              label="clean"
              color={report.rules_clean > 0 ? "success.main" : "text.primary"}
            />
            <Divider orientation="vertical" flexItem />
            {/* Two different quantities. A row with six bad fields is one row
                and six values, so these are never added together and never
                shown under one label. */}
            <Stat
              value={report.rows_flagged.toLocaleString()}
              label="rows with errors"
              hint={`of ${report.rows_total.toLocaleString()} rows`}
              color={report.rows_flagged > 0 ? "error.main" : "text.primary"}
              title="Rows that break at least one rule, counted once each — never more than the rows in the files."
            />
            <Stat
              value={report.values_flagged.toLocaleString()}
              label="cells with errors"
              hint={`of ${report.values_checked.toLocaleString()} value checks`}
              title="Individual field values that failed, against the number of value checks made. Two rules on one field check that field twice, so the denominator is checks, not cells."
            />
            <Stat value={report.tables_checked} label="tables checked" />
            {report.field_issue_count > 0 && (
              <>
                <Divider orientation="vertical" flexItem />
                <Stat
                  value={report.field_issue_count}
                  label="field issues"
                  color="warning.main"
                  title="Missing or placeholder values on fields you mapped. Reported because the field was mapped — not rule failures, and never counted as one."
                />
              </>
            )}
            {report.configuration_error_count > 0 && (
              <>
                <Divider orientation="vertical" flexItem />
                <Stat
                  value={report.configuration_error_count}
                  label="could not run"
                  color="warning.main"
                  title="Rules that were turned on but could not be executed. They are not failures and not passes — the governance behind them is unfinished."
                />
              </>
            )}
          </Stack>

          {report.field_issues.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                <AlertTitle sx={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  Missing and unknown values on mapped fields
                </AlertTitle>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  Reported because you mapped these fields. Fields you did not map are not
                  reported here at all. These are facts about the data, not rule failures,
                  so they are counted apart from the rules above.
                </Typography>
                <Stack spacing={0.75}>
                  {report.field_issues.map((issue, index) => (
                    <Typography key={index} variant="body2">
                      <strong>{issue.column_name}</strong>
                      {issue.target_name ? ` → ${issue.target_name}` : ""} — {issue.message}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            </>
          )}

          {report.configuration_errors.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                <AlertTitle sx={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  {report.configuration_errors.length} rule
                  {report.configuration_errors.length === 1 ? "" : "s"} could not run
                </AlertTitle>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  These were turned on but not executed, so they are neither passes nor
                  failures. Finish the governance in the Structure Workspace, then re-run.
                </Typography>
                <Stack spacing={0.75}>
                  {report.configuration_errors.map((error, index) => (
                    <Typography key={index} variant="body2">
                      <strong>{error.rule_name || error.rule_code || "Rule"}</strong>
                      {error.column_name ? ` · ${error.column_name}` : ""} — {error.reason}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            </>
          )}

          {report.by_severity.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  By severity
                </Typography>
                {report.by_severity.map((level) => (
                  <Stack key={level.severity} direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      variant="outlined"
                      color={SEVERITY_COLOR[level.severity] ?? "default"}
                      label={SEVERITY_LABEL[level.severity] ?? level.severity}
                      sx={{ height: 20, fontSize: "0.7rem" }}
                    />
                    <Typography variant="body2">
                      <Typography component="span" variant="body2" fontWeight={700}
                        color={level.failing > 0 ? "error.main" : "success.main"}>
                        {level.failing}
                      </Typography>
                      <Typography component="span" variant="body2" color="text.secondary">
                        {" "}of {level.rules} failing
                      </Typography>
                    </Typography>
                  </Stack>
                ))}
                <Typography variant="caption" color="text.disabled">
                  Severity is set on the rule in the Rule Workspace.
                </Typography>
              </Stack>
            </>
          )}

          {worst && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <ErrorOutlineIcon color="error" sx={{ fontSize: 18 }} />
                <Typography variant="body2">
                  <Typography component="span" variant="body2" color="text.secondary">
                    Breaking in the most places:{" "}
                  </Typography>
                  <Typography component="span" variant="body2" fontWeight={700}>
                    {labelFor(worst.kind, worst.check_type, worst.name)}
                  </Typography>
                </Typography>
                {worst.severity && (
                  <Chip
                    size="small"
                    variant="outlined"
                    color={SEVERITY_COLOR[worst.severity] ?? "default"}
                    label={SEVERITY_LABEL[worst.severity] ?? worst.severity}
                    sx={{ height: 20, fontSize: "0.7rem" }}
                  />
                )}
                <Typography variant="body2" color="text.secondary">
                  {worst.fields_failing_count} field{worst.fields_failing_count === 1 ? "" : "s"} across{" "}
                  {worst.tables_failing_count} table{worst.tables_failing_count === 1 ? "" : "s"}
                  {worst.counts_rows
                    ? ` · ${worst.rows_flagged.toLocaleString()} rows`
                    : ""}
                  {worst.counts_values
                    ? ` · ${worst.values_flagged.toLocaleString()} cells`
                    : ""}
                </Typography>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── the rules themselves ──────────────────────────────────────────── */}
      <Card variant="outlined">
        <CardContent sx={{ pb: 1.5 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>Quality Check Result</Typography>
              <Typography variant="caption" color="text.secondary">
                One row per rule, across every table it ran on. Open a rule to see the
                table and field it broke in.
              </Typography>
            </Box>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={filter}
              onChange={(_, next) => next && setFilter(next)}
            >
              <ToggleButton value="problems" sx={{ textTransform: "none", py: 0.3 }}>
                Needs attention ({report.rules_failing + report.rules_warning})
              </ToggleButton>
              <ToggleButton value="all" sx={{ textTransform: "none", py: 0.3 }}>
                All ({report.rules_run})
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </CardContent>

        {shown.length === 0 ? (
          <Box sx={{ px: 2, pb: 2.5, display: "flex", alignItems: "center", gap: 1 }}>
            <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />
            <Typography variant="body2" color="text.secondary">
              Every rule passed on every table it ran against.
            </Typography>
          </Box>
        ) : (
          <>
            {governed.length > 0 && (
              <>
                <Divider />
                <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1 }}>
                  <GavelOutlinedIcon color="primary" sx={{ fontSize: 16 }} />
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    RULES YOU DEFINED ({governed.length})
                  </Typography>
                </Stack>
                <RuleTable rules={governed} />
              </>
            )}
            {automatic.length > 0 && (
              <>
                <Divider />
                <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1 }}>
                  <AutoAwesomeOutlinedIcon color="action" sx={{ fontSize: 16 }} />
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    AUTOMATIC CHECKS ({automatic.length})
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    run on every mapped field, no rule needed
                  </Typography>
                </Stack>
                <RuleTable rules={automatic} />
              </>
            )}
          </>
        )}
      </Card>
    </Stack>
  );
}
