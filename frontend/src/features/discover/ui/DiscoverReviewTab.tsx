import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import type { QualityFinding, QualityStatus } from "@/features/discover/api/discoverApi";
import type { DiscoverAuditEventSummary, OverviewReadModel } from "@/shared/contracts";

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
  overview: OverviewReadModel;
};

/** Audit actions rendered in words rather than as their internal codes. */
const ACTION_LABELS: Record<string, string> = {
  "import.file_attached": "File uploaded and parsed",
  "import.file_replaced": "Previous file replaced",
  "import.validation_run": "File shape validated",
  "import.columns_persisted": "Columns profiled and stored",
  "import.started": "Import started",
  "import.context_set": "Model selected",
  "rules.applicability_determined": "Applicable governed rules determined",
  "rules.configured": "Governed rule configured",
  "quality.checks_run": "Quality checks executed",
};

function statusIcon(status: QualityStatus, size = 18) {
  if (status === "passed") return <CheckCircleIcon color="success" sx={{ fontSize: size }} />;
  if (status === "warning") return <WarningAmberIcon color="warning" sx={{ fontSize: size }} />;
  return <ErrorOutlineIcon color="error" sx={{ fontSize: size }} />;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** A parameter set rendered as `key = value` chips. */
function ParameterChips({ parameters }: { parameters: Record<string, unknown> }) {
  const entries = Object.entries(parameters ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== "" &&
      !(Array.isArray(value) && value.length === 0)
  );
  if (entries.length === 0) {
    return <Typography variant="caption" color="text.disabled">Rule defaults</Typography>;
  }
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {entries.map(([key, value]) => (
        <Chip
          key={key}
          size="small"
          variant="outlined"
          label={`${key} = ${Array.isArray(value) ? value.join(", ") : String(value)}`}
          sx={{ height: 20, fontSize: "0.65rem" }}
        />
      ))}
    </Stack>
  );
}

/** A collapsible section, so a long record stays readable. */
function Section({
  title,
  caption,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  caption?: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: open ? 2 : 1.5 } }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ cursor: "pointer" }}
          onClick={() => setOpen((v) => !v)}
        >
          <Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
              {count !== undefined && (
                <Chip size="small" label={count} sx={{ height: 20, fontSize: "0.7rem" }} />
              )}
            </Stack>
            {caption && (
              <Typography variant="caption" color="text.secondary">{caption}</Typography>
            )}
          </Box>
          <IconButton size="small" sx={{ transform: open ? "rotate(180deg)" : "none", transition: "0.2s" }}>
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Collapse in={open}>
          <Box sx={{ mt: 1.5 }}>{children}</Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

/**
 * Review Results / Evidence — the last step.
 *
 * Everything before this produced a decision: what was loaded, what it was
 * mapped to, what its values were taken to mean, which governed rules were
 * judged applicable, what parameters this session set, and what the run found.
 * This step puts that record in one place, because retaining the evidence is
 * part of what Discover is for — a result nobody can trace back to the rules
 * and decisions that produced it is not evidence of anything.
 */
export function DiscoverReviewTab({ vm, overview }: Props) {
  const report = vm.qualityReportQuery.data;
  const findings = report?.findings ?? [];
  const hasRun = !!report?.has_run;

  const rules = vm.governedRulesQuery.data;
  const mappings = vm.mappingsQuery.data ?? [];
  const columns = vm.columnsQuery.data ?? [];
  const dataset = vm.datasetQuery.data;
  const trail = vm.auditTrailQuery.data ?? [];

  const executedRules = useMemo(
    () => (rules?.items ?? []).filter((item) => item.is_enabled),
    [rules?.items]
  );
  const exceptions = useMemo(
    () => findings.filter((f) => f.status !== "passed" && f.check_type !== "usability"),
    [findings]
  );

  const columnName = (columnId: string) =>
    columns.find((c) => c.column_id === columnId)?.column_name ?? columnId;

  const failed = report?.failed ?? 0;
  const warnings = report?.warnings ?? 0;
  const usability = report?.usability ?? null;

  if (!hasRun) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 1.5 }}>
          <FactCheckOutlinedIcon sx={{ fontSize: 44, color: "text.disabled" }} />
          <Typography variant="h6" fontWeight={700}>Run the quality checks first</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
            There is no evidence to review until the governed rules have actually been run against
            {" "}{overview.session.source_filename || "your data"}. Run them on the previous step.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Header */}
      <Box>
        <Stack direction="row" alignItems="center" spacing={1}>
          <FactCheckOutlinedIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>Review results and evidence</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          The complete record of this session: what was loaded, how it was mapped and classified,
          which governed rules were applied with what parameters, and what they found.
        </Typography>
      </Box>

      {/* Verdict */}
      <Alert
        severity={failed > 0 ? "error" : warnings > 0 ? "warning" : "success"}
        sx={{ alignItems: "center" }}
      >
        <Typography variant="body2" fontWeight={600}>
          {failed > 0
            ? `${failed} check${failed === 1 ? "" : "s"} failed${warnings > 0 ? ` and ${warnings} raised a warning` : ""}.`
            : warnings > 0
              ? `Every check passed, with ${warnings} observation${warnings === 1 ? "" : "s"} worth a look.`
              : "Every check passed. This data meets the governed rules applied to it."}
        </Typography>
        {usability && (
          <Typography variant="body2">
            {usability.usable_percent}% of rows ({usability.usable_rows} of {usability.total_rows})
            can be used as they are.
          </Typography>
        )}
      </Alert>

      {/* Provenance */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>What was assessed</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }, gap: 2 }}>
            {[
              { label: "Source file", value: overview.session.source_filename || "—" },
              { label: "Model", value: overview.session.source_application || "—" },
              {
                label: "Rows × columns",
                value: `${dataset?.row_count ?? overview.session.row_count ?? 0} × ${dataset?.column_count ?? overview.session.column_count ?? 0}`,
              },
              { label: "Session", value: overview.session.session_name },
            ].map((item) => (
              <Box key={item.label}>
                <Typography variant="caption" color="text.secondary" display="block">{item.label}</Typography>
                <Typography variant="body2" fontWeight={600} sx={{ wordBreak: "break-word" }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Box>
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 2 }}>
            {[
              { label: "Fields mapped", value: mappings.length },
              { label: "Governed rules run", value: executedRules.length },
              { label: "Checks executed", value: report?.total_checks ?? 0 },
            ].map((tile) => (
              <Box key={tile.label}>
                <Typography variant="h5" fontWeight={700}>{tile.value}</Typography>
                <Typography variant="caption" color="text.secondary">{tile.label}</Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* Exceptions first — what a reviewer actually needs to act on */}
      <Section
        title="Exceptions"
        caption="Everything that did not pass, in one list."
        count={exceptions.length}
        defaultOpen
      >
        {exceptions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing to act on — every check passed.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {exceptions.map((finding: QualityFinding) => (
              <Stack key={finding.quality_check_id} direction="row" spacing={1} alignItems="flex-start">
                {statusIcon(finding.status)}
                <Box sx={{ flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                    <Typography variant="body2" fontWeight={600}>{finding.column_name}</Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={finding.detail?.rule_code ?? finding.check_type.replace(/_/g, " ")}
                      sx={{ height: 18, fontSize: "0.63rem" }}
                    />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{finding.message}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        )}
      </Section>

      {/* Mapping decisions */}
      <Section
        title="Mapping decisions"
        caption="Each source field and the governed model field it was paired with."
        count={mappings.length}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Source field</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Model field</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>State</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.map((mapping) => (
              <TableRow key={mapping.mapping_id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{columnName(mapping.column_id)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {mapping.target_name ?? mapping.target_node_id}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={mapping.mapping_state}
                    sx={{ height: 20, fontSize: "0.65rem", textTransform: "capitalize" }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {/* Governed rules and the session's parameters */}
      <Section
        title="Governed rules applied"
        caption="Which governed rules this session ran, and the parameters it was permitted to set."
        count={executedRules.length}
      >
        {executedRules.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No governed rules were turned on for this session.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Rule</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Applied to</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Severity</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Session parameters</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {executedRules.map((rule) => (
                <TableRow key={rule.configuration_id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{rule.rule_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{rule.code}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {rule.column_name}
                      {rule.target_name ? ` → ${rule.target_name}` : ""}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={rule.severity ?? rule.default_severity}
                      sx={{ height: 20, fontSize: "0.65rem", textTransform: "capitalize" }}
                    />
                  </TableCell>
                  <TableCell><ParameterChips parameters={rule.parameters} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {/* The trail itself */}
      <Section
        title="Audit trail"
        caption="Every action taken in this session, in order, with who did it and what happened."
        count={trail.length}
      >
        <Stack spacing={1}>
          {trail.map((event: DiscoverAuditEventSummary) => (
            <Stack
              key={event.audit_event_id}
              direction="row"
              spacing={1.5}
              alignItems="flex-start"
              sx={{ pb: 1, borderBottom: 1, borderColor: "divider" }}
            >
              <HistoryOutlinedIcon
                fontSize="small"
                sx={{ mt: 0.25, color: event.outcome === "success" ? "success.main" : "error.main" }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  {ACTION_LABELS[event.action] ?? event.action}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatWhen(event.created_at)} · {event.actor}
                  {event.outcome !== "success" ? ` · ${event.outcome}` : ""}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Section>
    </Box>
  );
}
