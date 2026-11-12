import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { DiscoverAuditEventSummary, OverviewReadModel } from "@/shared/contracts";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ViewTimelineOutlinedIcon from "@mui/icons-material/ViewTimelineOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      {icon ? (
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Typography variant="body2" color="text.secondary">{label}</Typography>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      )}
      <Typography variant="body2" fontWeight={500}>{value}</Typography>
    </Box>
  );
}

// ── Action label map for audit events ─────────────────────────────────────────

function auditLabel(action: string): string {
  const map: Record<string, string> = {
    "session.create":          "Session created",
    "session.archive":         "Session archived",
    "import.file_attached":    "File uploaded",
    // The model a table's columns are mapped against — not where it came from.
    "import.context_set":      "Mapping model set",
    "source_application.set":    "Source application set",
    "source_application.change": "Source application changed",
    "source_application.clear":  "Source application cleared",
    "import.started":          "Import started",
    "import.validation_run":   "Validation completed",
    "import.columns_persisted":"Profiling completed",
    "mapping.confirmed":       "Mapping confirmed",
    "quality.checks_run":      "Quality checks executed",
    "evidence.exported":       "Evidence exported",
  };
  return map[action] ?? action.replace(/\./g, " → ");
}

function outcomeColor(outcome: string): "success" | "error" | "default" | "warning" {
  if (outcome === "success") return "success";
  if (outcome === "failure") return "error";
  if (outcome === "rejected") return "warning";
  return "default";
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Props ──────────────────────────────────────────────────────────────────────

type SummaryProps = {
  overview: OverviewReadModel;
  auditEvents?: DiscoverAuditEventSummary[];
  onNavigate?: (tabIndex: number) => void;
};

// ── Session Summary Card (consolidates all 3 sub-panels + raw metadata) ────────

export function DiscoverSessionSummaryCard({ overview, auditEvents, onNavigate }: SummaryProps) {
  const dq = overview.data_quality;
  const col = overview.column_highlights;
  const map = overview.mapping_summary;
  const sess = overview.session;

  // Derive recommended next action
  let nextAction = "";
  let nextTab: number | null = null;
  if (!sess.source_filename) {
    nextAction = "Upload a file to begin.";
  } else if ((col.total_columns ?? 0) === 0) {
    nextAction = "Start import to profile columns.";
  } else if ((map.confirmed ?? 0) === 0) {
    nextAction = "Review and confirm mappings.";
    nextTab = 2;
  } else if ((dq.total_checks ?? 0) === 0) {
    nextAction = "Run quality checks.";
    nextTab = 3;
  } else if ((dq.failed ?? 0) > 0) {
    nextAction = `${dq.failed} quality check(s) failed — review in Quality tab.`;
    nextTab = 3;
  } else {
    nextAction = "All checks passed. Ready to export.";
  }

  // Profiling progress %
  const profilePct =
    col.total_columns > 0
      ? Math.round(((sess.profiled_column_count ?? 0) / col.total_columns) * 100)
      : 0;

  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <ViewTimelineOutlinedIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>Session summary</Typography>
        </Stack>

        {/* Raw metadata */}
        <Stack spacing={1.5} divider={<Divider />}>
          <Row label="Source file" value={sess.source_filename || "—"} />
          <Row label="Rows" value={sess.row_count?.toLocaleString() ?? "—"} />
          <Row label="Columns" value={sess.column_count?.toLocaleString() ?? "—"} />
          <Row label="Last updated" value={sess.last_updated ? new Date(sess.last_updated).toLocaleString() : "—"} />
        </Stack>

        {/* ── Three visual summary cards ── */}
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1.5, mt: 1 }}>

          {/* Column highlights card */}
          <Card
            variant="outlined"
            sx={{ bgcolor: "background.default", cursor: onNavigate ? "pointer" : "default" }}
            onClick={() => onNavigate?.(1)}
          >
            <CardActionArea sx={{ p: 1.5, height: "100%" }} disabled={!onNavigate}>
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                <PersonOutlineOutlinedIcon color="primary" sx={{ fontSize: 16 }} />
                <Typography variant="caption" fontWeight={700} color="primary">Profile</Typography>
              </Stack>
              <Typography variant="h6" fontWeight={700} lineHeight={1}>{col.total_columns}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">columns</Typography>
              {col.total_columns > 0 && (
                <Box sx={{ mt: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={profilePct}
                    sx={{ height: 4, borderRadius: 2 }}
                  />
                  <Typography variant="caption" color="text.secondary">{profilePct}% profiled</Typography>
                </Box>
              )}
              {col.null_columns > 0 && (
                <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
                  {col.null_columns} null col{col.null_columns !== 1 ? "s" : ""}
                </Typography>
              )}
            </CardActionArea>
          </Card>

          {/* Data quality card */}
          <Card
            variant="outlined"
            sx={{
              bgcolor: dq.failed > 0 ? "error.50" : dq.warnings > 0 ? "warning.50" : "background.default",
              cursor: onNavigate ? "pointer" : "default",
            }}
            onClick={() => onNavigate?.(3)}
          >
            <CardActionArea sx={{ p: 1.5, height: "100%" }} disabled={!onNavigate}>
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                <VerifiedUserOutlinedIcon
                  sx={{
                    fontSize: 16,
                    color: dq.failed > 0 ? "error.main" : dq.warnings > 0 ? "warning.main" : "primary.main",
                  }}
                />
                <Typography
                  variant="caption"
                  fontWeight={700}
                  color={dq.failed > 0 ? "error.main" : dq.warnings > 0 ? "warning.main" : "primary.main"}
                >
                  Quality
                </Typography>
              </Stack>
              <Typography variant="h6" fontWeight={700} lineHeight={1}>{dq.total_checks}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">checks run</Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap">
                {dq.passed > 0 && (
                  <Stack direction="row" spacing={0.25} alignItems="center">
                    <CheckCircleOutlineIcon color="success" sx={{ fontSize: 12 }} />
                    <Typography variant="caption" color="success.main">{dq.passed}</Typography>
                  </Stack>
                )}
                {dq.warnings > 0 && (
                  <Stack direction="row" spacing={0.25} alignItems="center">
                    <WarningAmberIcon color="warning" sx={{ fontSize: 12 }} />
                    <Typography variant="caption" color="warning.main">{dq.warnings}</Typography>
                  </Stack>
                )}
                {dq.failed > 0 && (
                  <Stack direction="row" spacing={0.25} alignItems="center">
                    <HighlightOffIcon color="error" sx={{ fontSize: 12 }} />
                    <Typography variant="caption" color="error.main">{dq.failed}</Typography>
                  </Stack>
                )}
              </Stack>
            </CardActionArea>
          </Card>

          {/* Mapping summary card */}
          <Card
            variant="outlined"
            sx={{
              bgcolor: map.unmapped > 0 ? "warning.50" : "background.default",
              cursor: onNavigate ? "pointer" : "default",
            }}
            onClick={() => onNavigate?.(2)}
          >
            <CardActionArea sx={{ p: 1.5, height: "100%" }} disabled={!onNavigate}>
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                <LinkOutlinedIcon color="primary" sx={{ fontSize: 16 }} />
                <Typography variant="caption" fontWeight={700} color="primary">Mappings</Typography>
              </Stack>
              <Typography variant="h6" fontWeight={700} lineHeight={1}>{map.total_mappings}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">total</Typography>
              <Stack spacing={0.25} sx={{ mt: 1 }}>
                {map.confirmed > 0 && (
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <CheckCircleOutlineIcon color="success" sx={{ fontSize: 12 }} />
                    <Typography variant="caption">{map.confirmed} confirmed</Typography>
                  </Stack>
                )}
                {map.unmapped > 0 && (
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <InfoOutlinedIcon color="warning" sx={{ fontSize: 12 }} />
                    <Typography variant="caption" color="warning.main">{map.unmapped} unmapped</Typography>
                  </Stack>
                )}
              </Stack>
            </CardActionArea>
          </Card>
        </Box>

        {/* Recommended next action */}
        {nextAction && (
          <Box
            sx={{
              p: 1.5,
              bgcolor: "primary.50",
              borderRadius: 1,
              border: 1,
              borderColor: "primary.light",
              cursor: nextTab !== null && onNavigate ? "pointer" : "default",
            }}
            onClick={() => nextTab !== null && onNavigate?.(nextTab)}
          >
            <Typography variant="caption" color="primary.main" fontWeight={600}>
              Recommended next action
            </Typography>
            <Typography variant="body2" color="primary.dark" sx={{ mt: 0.25 }}>
              {nextAction}
              {nextTab !== null && onNavigate && (
                <ArrowForwardIcon fontSize="small" sx={{ ml: 0.5, verticalAlign: "middle" }} />
              )}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// ── Recent Activity Panel ──────────────────────────────────────────────────────

export function RecentActivityPanel({ events }: { events: DiscoverAuditEventSummary[] }) {
  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <HistoryOutlinedIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={600}>Recent activity</Typography>
        </Stack>

        {events.length === 0 ? (
          <Box
            sx={{
              flexGrow: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              py: 4,
            }}
          >
            <HistoryOutlinedIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
            <Typography variant="body2" fontWeight={600} gutterBottom>No recent activity</Typography>
            <Typography variant="caption" color="text.secondary">
              Activity will appear here once you get started.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={0} divider={<Divider />} sx={{ flexGrow: 1, overflow: "auto", maxHeight: 400 }}>
            {events.map((ev) => (
              <Box key={ev.audit_event_id} sx={{ py: 1.5 }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {auditLabel(ev.action)}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25 }} flexWrap="wrap">
                      <Typography variant="caption" color="text.secondary">
                        {ev.actor}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">·</Typography>
                      <Typography variant="caption" color="text.secondary" title={ev.created_at}>
                        {formatRelative(ev.created_at)}
                      </Typography>
                    </Stack>
                    {ev.source_file_id && (
                      <Typography variant="caption" color="text.disabled" noWrap sx={{ display: "block" }}>
                        File: {ev.source_file_id}
                      </Typography>
                    )}
                  </Box>
                  <Chip
                    label={ev.outcome}
                    size="small"
                    color={outcomeColor(ev.outcome)}
                    sx={{ textTransform: "capitalize", fontWeight: 600, fontSize: 10, height: 20 }}
                  />
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

// ── Legacy 4-card grid (Column Highlights / DQ / Mapping / Recent Activity) ───
// NOTE: Per the new design, this grid is REPLACED by DiscoverSessionSummaryCard.
// This component is kept only for backwards compatibility if still referenced elsewhere.

export function DiscoverOverviewPanel({ overview }: SummaryProps) {
  const col = overview.column_highlights;
  const dq = overview.data_quality;
  const map = overview.mapping_summary;

  return (
    <Box
      sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, gap: 3 }}
    >
      {/* Column Highlights */}
      <Card variant="outlined" sx={{ display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <PersonOutlineOutlinedIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>Column highlights</Typography>
          </Stack>
          <Stack spacing={1.5} divider={<Divider />} sx={{ flexGrow: 1 }}>
            <Row label="Total columns" value={col.total_columns} />
            <Row label="Key columns" value={col.key_columns} />
            <Row label="High cardinality" value={col.high_cardinality_columns} />
            <Row label="Null columns" value={col.null_columns} />
          </Stack>
        </CardContent>
      </Card>

      {/* Data Quality */}
      <Card variant="outlined" sx={{ display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <VerifiedUserOutlinedIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>Data quality (starter checks)</Typography>
          </Stack>
          <Stack spacing={1.5} divider={<Divider />} sx={{ flexGrow: 1 }}>
            <Row label="Total checks" value={dq.total_checks} />
            <Row
              label="Passed"
              value={dq.passed}
              icon={<CheckCircleOutlineIcon color="success" fontSize="small" />}
            />
            <Row
              label="Warnings"
              value={dq.warnings}
              icon={<WarningAmberIcon color="warning" fontSize="small" />}
            />
            <Row
              label="Failed"
              value={dq.failed}
              icon={<HighlightOffIcon color="error" fontSize="small" />}
            />
          </Stack>
        </CardContent>
      </Card>

      {/* Mapping Summary */}
      <Card variant="outlined" sx={{ display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <LinkOutlinedIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>Mapping summary</Typography>
          </Stack>
          <Stack spacing={1.5} divider={<Divider />} sx={{ flexGrow: 1 }}>
            <Row label="Total mappings" value={map.total_mappings} />
            <Row
              label="Confirmed"
              value={map.confirmed}
              icon={<CheckCircleOutlineIcon color="success" fontSize="small" />}
            />
            <Row
              label="Suggested"
              value={map.suggested}
              icon={<InfoOutlinedIcon color="primary" fontSize="small" />}
            />
            <Row
              label="Unmapped"
              value={map.unmapped}
              icon={<HighlightOffIcon color="error" fontSize="small" />}
            />
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
