import { useMemo, useRef, useState } from "react";
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
  Divider,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import type {
  RuleImportPlan,
  RuleImportReport,
  RuleImportRow,
} from "@/features/rules/api/rulesApi";

const ACTION_CHIP: Record<
  RuleImportRow["action"],
  { label: string; color: "success" | "info" | "default" | "error"; help: string }
> = {
  new: { label: "new", color: "success", help: "No rule in the library matches this row." },
  changed: {
    label: "changed",
    color: "info",
    help: "Matches a rule in the library, and would change it. The version history keeps what it said before.",
  },
  unchanged: {
    label: "unchanged",
    color: "default",
    help: "Matches a rule that already says exactly this. Nothing to apply.",
  },
  invalid: { label: "can't read", color: "error", help: "This row cannot be applied as written." },
};

const MATCH_LABEL: Record<string, string> = {
  rule_definition_id: "matched on internal ID",
  code: "matched on code",
  name: "matched on name",
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  description: "Description",
  category: "Category",
  status: "Status",
  severity: "Severity",
  dimension: "Dimension",
  data_type: "Applies to",
  execution_scope: "Execution scope",
  definition_kind: "Definition",
  check_type: "Check",
  parameters: "Parameters",
  script: "Script",
  rationale: "Rationale",
  reference: "Reference",
  message_template: "Message",
  owner: "Owner",
  examples_pass: "Examples that pass",
  examples_fail: "Examples that fail",
};

const shorten = (value: string) =>
  !value ? "—" : value.length > 90 ? `${value.slice(0, 90)}…` : value;

type Props = {
  open: boolean;
  plan: RuleImportPlan | null;
  report: RuleImportReport | null;
  busy: boolean;
  error: string | null;
  onPickFile: (csv: string) => void;
  onCommit: (rows: number[]) => void;
  onDownloadTemplate: () => void;
  onClose: () => void;
};

/**
 * Bringing a rule file into the library.
 *
 * Deliberately two steps. A file cannot overwrite the library: it is
 * reconciled against it first, the whole plan is shown — matched how, changing
 * what, from what to what — and only the ticked rows are applied.
 *
 * A matched rule keeps its internal ID and its code whatever the file says.
 * Results cite codes, so a file carrying somebody else's codes must not be
 * able to re-label evidence that already exists.
 */
export function RuleImportDialog(props: Props) {
  const { open, plan, report, busy, error } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // The plan arrives with everything actionable already ticked. `selected`
  // stays null until somebody changes it, so a fresh plan is never overridden
  // by a stale selection from the last file.
  const ticked = useMemo(
    () => selected ?? new Set(plan?.selected_row_numbers ?? []),
    [selected, plan],
  );

  const rows = plan?.rows ?? [];
  const actionable = rows.filter((row) => row.action === "new" || row.action === "changed");
  const tickedCount = actionable.filter((row) => ticked.has(row.row_number)).length;

  const reset = () => {
    setSelected(null);
    setExpanded(new Set());
    if (fileInput.current) fileInput.current.value = "";
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    props.onPickFile(await file.text());
  };

  const toggle = (rowNumber: number) => {
    const next = new Set(ticked);
    if (next.has(rowNumber)) next.delete(rowNumber);
    else next.add(rowNumber);
    setSelected(next);
  };

  const toggleAll = () => {
    setSelected(
      tickedCount === actionable.length
        ? new Set()
        : new Set(actionable.map((row) => row.row_number)),
    );
  };

  const toggleDetail = (rowNumber: number) => {
    const next = new Set(expanded);
    if (next.has(rowNumber)) next.delete(rowNumber);
    else next.add(rowNumber);
    setExpanded(next);
  };

  const close = () => {
    reset();
    props.onClose();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Import rules
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          The file is reconciled against the library first. Nothing is written until you apply it.
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          {report ? (
            <Alert severity={report.failed > 0 ? "warning" : "success"}>
              <Typography variant="body2" fontWeight={600}>
                {report.created} created · {report.updated} updated · {report.skipped} skipped
                {report.failed > 0 ? ` · ${report.failed} failed` : ""}
              </Typography>
              {report.failed > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {report.rows
                    .filter((row) => row.outcome === "failed")
                    .map((row) => `Row ${row.row_number}: ${row.errors[0] ?? "unknown"}`)
                    .join(" · ")}
                </Typography>
              )}
            </Alert>
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                startIcon={<UploadFileOutlinedIcon />}
                onClick={() => fileInput.current?.click()}
                sx={{ textTransform: "none" }}
                disabled={busy}
              >
                {plan ? "Choose a different file" : "Choose a CSV file"}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => void pick(event.target.files?.[0])}
              />
              {busy && <CircularProgress size={16} />}
              <Box sx={{ flexGrow: 1 }} />
              <Link
                component="button"
                type="button"
                variant="body2"
                underline="hover"
                onClick={props.onDownloadTemplate}
              >
                Download a blank template
              </Link>
            </Stack>
          )}

          {!plan && !report && (
            <Alert severity="info" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
              <Typography variant="body2" fontWeight={600} gutterBottom>
                How rows are matched
              </Typography>
              <Typography variant="body2" component="div">
                Internal ID first, then rule code, then name. A matched rule keeps its ID and its
                code — a file never renumbers rules that already exist, because results cite those
                codes. Columns the file leaves out are left as they are.
              </Typography>
            </Alert>
          )}

          {plan && !report && plan.unknown_columns.length > 0 && (
            <Alert severity="warning">
              Ignored {plan.unknown_columns.length === 1 ? "a column" : "columns"} the library does
              not recognise: {plan.unknown_columns.join(", ")}.
            </Alert>
          )}

          {plan && !report && (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip size="small" sx={{ fontWeight: 600 }} label={`${plan.summary.total} rows`} />
              <Chip size="small" color="success" variant="outlined" label={`${plan.summary.new} new`} />
              <Chip size="small" color="info" variant="outlined" label={`${plan.summary.changed} changed`} />
              <Chip size="small" variant="outlined" label={`${plan.summary.unchanged} unchanged`} />
              {plan.summary.invalid > 0 && (
                <Chip size="small" color="error" variant="outlined" label={`${plan.summary.invalid} can't read`} />
              )}
            </Stack>
          )}

          {(plan || report) && (
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      {!report && (
                        <Checkbox
                          size="small"
                          disabled={actionable.length === 0}
                          checked={actionable.length > 0 && tickedCount === actionable.length}
                          indeterminate={tickedCount > 0 && tickedCount < actionable.length}
                          onChange={toggleAll}
                        />
                      )}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 60 }}>Row</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Rule</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 120 }}>Code</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 130 }}>What happens</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Detail</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(report?.rows ?? rows).map((row) => {
                    const chip = ACTION_CHIP[row.action];
                    const open = expanded.has(row.row_number);
                    const applied = row.outcome === "applied";
                    return (
                      <TableRow key={row.row_number} hover>
                        <TableCell padding="checkbox">
                          {report ? (
                            <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
                              {applied ? "✓" : row.outcome === "failed" ? "✕" : "–"}
                            </Typography>
                          ) : (
                            <Checkbox
                              size="small"
                              disabled={row.action === "unchanged" || row.action === "invalid"}
                              checked={ticked.has(row.row_number)}
                              onChange={() => toggle(row.row_number)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {row.row_number}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {row.name || "—"}
                          </Typography>
                          {row.match_on && (
                            <Typography variant="caption" color="text.secondary">
                              {MATCH_LABEL[row.match_on] ?? row.match_on}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                            {row.code || (row.action === "new" ? "auto" : "—")}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Tooltip title={chip.help}>
                            <Chip
                              size="small"
                              color={chip.color}
                              variant="outlined"
                              label={chip.label}
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          {row.errors.length > 0 && (
                            <Typography variant="caption" color="error.main" display="block">
                              {row.errors.join(" · ")}
                            </Typography>
                          )}
                          {row.notes.map((note) => (
                            <Typography key={note} variant="caption" color="text.secondary" display="block">
                              {note}
                            </Typography>
                          ))}
                          {row.changes.length > 0 && (
                            <>
                              <Link
                                component="button"
                                type="button"
                                variant="caption"
                                underline="hover"
                                onClick={() => toggleDetail(row.row_number)}
                              >
                                {open
                                  ? "Hide changes"
                                  : `${row.changes.length} field${row.changes.length === 1 ? "" : "s"} would change`}
                              </Link>
                              {open && (
                                <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                                  {row.changes.map((change) => (
                                    <Box key={change.field}>
                                      <Typography variant="caption" fontWeight={600}>
                                        {FIELD_LABEL[change.field] ?? change.field}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary" display="block">
                                        <s>{shorten(change.from)}</s> → {shorten(change.to)}
                                      </Typography>
                                    </Box>
                                  ))}
                                </Stack>
                              )}
                            </>
                          )}
                          {row.changes.length === 0 && row.errors.length === 0 && row.notes.length === 0 && (
                            <Typography variant="caption" color="text.disabled">
                              {row.action === "new" ? "Creates this rule" : "Nothing to apply"}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}

          {plan && !report && plan.summary.changed > 0 && (
            <>
              <Divider />
              <Typography variant="caption" color="text.secondary">
                Applying a change bumps that rule's version. Earlier versions stay readable, so a
                quality run that cited an earlier one still resolves to what the rule said then.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={close} sx={{ textTransform: "none" }}>
          {report ? "Done" : "Cancel"}
        </Button>
        {plan && !report && (
          <Button
            variant="contained"
            disabled={busy || tickedCount === 0}
            onClick={() => props.onCommit([...ticked])}
            sx={{ textTransform: "none" }}
          >
            {busy
              ? "Applying…"
              : `Apply ${tickedCount} row${tickedCount === 1 ? "" : "s"}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
