/**
 * What a rule used to say.
 *
 * `version` counted edits and kept none of them, so a quality result that
 * cited v1 could only ever be shown v3. Every version is now recorded, and
 * this is where one is read — including from a run that executed it.
 *
 * One entry can be marked "not recorded": a rule authored before the log
 * existed has no copy of the version it is currently on, so its present state
 * stands in. That is honest rather than tidy — it is the rule as it is now,
 * not a copy taken at the time — and the next edit records it properly.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import { rulesApi } from "@/features/rules/api/rulesApi";
import type { RuleVersion } from "@/features/rules/api/rulesApi";

type Props = {
  ruleDefinitionId: string;
  /** Opens straight onto this version — how a run's evidence links in. */
  initialVersion?: number;
  onClose: () => void;
};

const readable = (iso: string) => {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
};

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}

function VersionDetail({ version }: { version: RuleVersion }) {
  const parameters = Object.keys(version.parameters ?? {}).length
    ? JSON.stringify(version.parameters)
    : "none";
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
        <Field label="check" value={version.check_type} />
        <Field label="severity" value={version.severity} />
        <Field label="status" value={version.status} />
        <Field label="dimension" value={version.dimension} />
        <Field label="applies to" value={version.data_type} />
      </Stack>
      <Box>
        <Typography variant="caption" color="text.secondary" component="div">
          parameters
        </Typography>
        <Typography variant="body2" component="code">
          {parameters}
        </Typography>
      </Box>
      {version.script && (
        <Box>
          <Typography variant="caption" color="text.secondary" component="div">
            script
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0, p: 1.25, borderRadius: 1, bgcolor: "action.hover",
              fontSize: "0.72rem", overflowX: "auto",
            }}
          >
            {version.script}
          </Box>
        </Box>
      )}
      <Field label="description" value={version.description} />
      <Field label="rationale" value={version.rationale} />
      <Field label="message template" value={version.message_template} />
    </Stack>
  );
}

export function RuleVersionHistoryDialog({ ruleDefinitionId, initialVersion, onClose }: Props) {
  const [selected, setSelected] = useState<number | null>(initialVersion ?? null);
  const history = useQuery({
    queryKey: ["rules", "versions", ruleDefinitionId],
    queryFn: async () => rulesApi.getVersions(ruleDefinitionId),
  });

  const items = history.data?.items ?? [];
  const shown = items.find((v) => v.version === selected) ?? items[0];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <HistoryOutlinedIcon color="primary" fontSize="small" />
          <Typography variant="h6" fontWeight={700}>
            {history.data?.name || "Rule"} — version history
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {history.data?.code}
          {history.data?.rule_deleted
            ? " · this rule has been deleted; its versions are kept because results cite them"
            : ` · now on version ${history.data?.current_version ?? "—"}`}
        </Typography>
        <IconButton onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {history.isPending && (
          <Stack direction="row" spacing={1.5} alignItems="center" py={3}>
            <CircularProgress size={18} />
            <Typography variant="body2">Reading the history…</Typography>
          </Stack>
        )}
        {history.error instanceof Error && <Alert severity="error">{history.error.message}</Alert>}

        {items.length > 0 && (
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box sx={{ minWidth: 190 }}>
              {items.map((version) => {
                const active = shown?.version === version.version;
                return (
                  <Box
                    key={version.version}
                    onClick={() => setSelected(version.version)}
                    sx={{
                      px: 1.25, py: 1, borderRadius: 1, cursor: "pointer",
                      bgcolor: active ? "action.selected" : "transparent",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography variant="body2" fontWeight={700}>
                        v{version.version}
                      </Typography>
                      {version.is_current && (
                        <Chip size="small" color="primary" label="current"
                              sx={{ height: 18, fontSize: "0.62rem" }} />
                      )}
                      {!version.recorded && (
                        <Chip size="small" variant="outlined" label="not recorded"
                              sx={{ height: 18, fontSize: "0.62rem" }} />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {readable(version.recorded_at)}
                    </Typography>
                    {version.recorded_by && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        by {version.recorded_by}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ flex: 1 }}>
              {shown && !shown.recorded && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  This version was never copied into the log — it predates the
                  history. What you are reading is the rule as it stands now.
                </Alert>
              )}
              {shown && <VersionDetail version={shown} />}
            </Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
