import { OverflowText } from "@/shared/workspace/OverflowText";
import { useMemo } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import SettingsSuggestOutlinedIcon from "@mui/icons-material/SettingsSuggestOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import HubIcon from "@mui/icons-material/Hub";
import {
  QUALITY_OUTCOME,
  describeCheck,
  discoverHrefFor,
  latestRun,
  type QualityOutcome,
  type QualityRun,
  type ResultEntry,
} from "@/features/impact/domain/impactQualityResults";
import type { QualityResults } from "@/features/impact/api/impactQualityResultsApi";
import { MODEL_CATEGORY, type ConnectedModel } from "@/features/impact/domain/impactLayout";

/**
 * Status shown as a shape, not only as a colour.
 *
 * Four states have to be told apart at a glance — and one of them is easy to
 * lose: *not assessed* is not a pass, and a blank reads as one.
 */
const OUTCOME_FACE: Record<
  QualityOutcome,
  { label: string; colour: string; Icon: typeof CheckCircleOutlineIcon }
> = {
  [QUALITY_OUTCOME.PASSED]: { label: "Passed", colour: "#2E7D32", Icon: CheckCircleOutlineIcon },
  [QUALITY_OUTCOME.ATTENTION]: {
    label: "Needs attention",
    colour: "#ED6C02",
    Icon: ReportProblemOutlinedIcon,
  },
  [QUALITY_OUTCOME.FAILED]: { label: "Failed", colour: "#C62828", Icon: ErrorOutlineIcon },
  [QUALITY_OUTCOME.ERROR]: {
    label: "Execution / configuration error",
    colour: "#6A1B9A",
    Icon: SettingsSuggestOutlinedIcon,
  },
  [QUALITY_OUTCOME.NOT_ASSESSED]: { label: "Not assessed", colour: "#607D8B", Icon: HelpOutlineIcon },
};

const NOT_ASSESSED_REASON: Record<string, string> = {
  not_mapped: "no source column is mapped to this property",
  mapped_not_run: "a column is mapped, but this rule did not run",
};

function runLabel(run: QualityRun): string {
  const when = (run.completed_at || run.created_at || "").replace("T", " ").slice(0, 16);
  return `${run.table_name || "dataset"} · ${run.session_name} · ${when}`;
}

export type ImpactConnectedContextProps = {
  hubIds: string[];
  hubNames: Record<string, string>;
  focusId: string | null;
  onToggleHub: (id: string) => void;
  models: ConnectedModel[];
  modelsLoading: boolean;
  modelsTruncated: boolean;
  match: "any" | "every";
  onMatchChange: (value: "any" | "every") => void;
  onPickModel: (modelId: string) => void;
  results: ResultEntry[];
  report: QualityResults | undefined;
  resultsLoading: boolean;
  runId: string;
  onRunChange: (runId: string) => void;
  onPickResult: (entryKey: string) => void;
};

/**
 * What the active hubs are connected to.
 *
 * Two sections because they answer two different questions. **Models** is a
 * model-layer question — what else does governance connect this to. **Data
 * quality results** is a question about observed results — what did Discover
 * find in the data representing it. They are never merged into one list,
 * because a failed check is not a relationship and a reader who cannot tell
 * them apart will believe the model asserts something it does not.
 */
export function ImpactConnectedContext({
  hubIds,
  hubNames,
  focusId,
  onToggleHub,
  models,
  modelsLoading,
  modelsTruncated,
  match,
  onMatchChange,
  onPickModel,
  results,
  report,
  resultsLoading,
  runId,
  onRunChange,
  onPickResult,
}: ImpactConnectedContextProps) {
  const runs = useMemo(() => report?.runs ?? [], [report]);
  const runsById = useMemo(() => new Map(runs.map((run) => [run.quality_run_id, run])), [runs]);

  /**
   * The newest run of each dataset, so a group can say whether it is the
   * current assessment of its data or an earlier one opened on purpose.
   */
  const newestPerDataset = useMemo(() => {
    const byDataset = new Map<string, QualityRun[]>();
    for (const run of runs) {
      const key = `${run.session_id}:${run.source_file_id}`;
      byDataset.set(key, [...(byDataset.get(key) ?? []), run]);
    }
    return new Set([...byDataset.values()].map((list) => latestRun(list)?.quality_run_id));
  }, [runs]);

  /**
   * Results grouped by the run that produced them, newest first, with the
   * properties no shown run assessed in a group of their own. Two runs
   * measured different bytes; they are never listed as one reading.
   */
  const groups = useMemo(() => {
    const grouped = new Map<string, ResultEntry[]>();
    for (const entry of results) {
      const key = entry.kind === "not_assessed" ? "~not-assessed" : entry.check?.quality_run_id || "";
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return [...grouped.entries()]
      .map(([key, entries]) => ({ key, run: runsById.get(key) ?? null, entries }))
      .sort((a, b) => {
        if (a.key === "~not-assessed") return 1;
        if (b.key === "~not-assessed") return -1;
        return (b.run?.completed_at ?? "").localeCompare(a.run?.completed_at ?? "");
      });
  }, [results, runsById]);

  const ownModels = models.filter((model) => model.is_own_model);
  const otherModels = models.filter((model) => !model.is_own_model);
  const several = hubIds.length > 1;
  const checkCount = results.filter((entry) => entry.kind === "check").length;

  if (hubIds.length === 0) {
    return (
      <Stack spacing={1} sx={{ p: 2 }}>
        <Typography variant="subtitle2">Connected context</Typography>
        <Typography variant="body2" color="text.secondary">
          Press the hub icon <HubIcon sx={{ fontSize: 14, verticalAlign: "middle" }} /> on a card to
          see the models it connects to and what Discover found in the data behind it. Press it on
          another card to compare several hubs.
        </Typography>
      </Stack>
    );
  }

  const renderModel = (model: ConnectedModel) => (
    <ListItemButton
      key={model.model_id}
      onClick={() => onPickModel(model.model_id)}
      sx={{ px: 1, py: 0.5, borderRadius: 1 }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <OverflowText variant="body2"  sx={{ fontSize: 12.5, fontWeight: 600 }}>
          {model.model_name}
        </OverflowText>
        <Typography variant="caption" color="text.secondary" display="block">
          {model.model_kind === MODEL_CATEGORY.SUPPORT_DOMAIN ? "Support Domain model" : "Hierarchy model"}{" "}
          · {model.instance_count} connected instance{model.instance_count === 1 ? "" : "s"}
        </Typography>
        {several && (
          <Typography variant="caption" color="text.disabled" display="block">
            Connected to {model.connected_hub_ids.length} of {model.selected_hub_count} selected hubs
          </Typography>
        )}
      </Box>
    </ListItemButton>
  );

  return (
    <Stack spacing={1.25} sx={{ p: 1.5, minWidth: 0 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Typography variant="subtitle2">Connected context</Typography>
        {(modelsLoading || resultsLoading) && <CircularProgress size={14} />}
      </Stack>

      <Stack direction="row" gap={0.5} flexWrap="wrap">
        {hubIds.map((id) => (
          <Chip
            key={id}
            size="small"
            icon={<HubIcon sx={{ fontSize: 14 }} />}
            label={`${hubNames[id] ?? id}${id === focusId ? " · focus" : ""}`}
            color={id === focusId ? "primary" : "default"}
            variant={id === focusId ? "filled" : "outlined"}
            onDelete={() => onToggleHub(id)}
            sx={{ maxWidth: "100%" }}
          />
        ))}
      </Stack>

      {several && (
        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={match}
          onChange={(_, value: "any" | "every" | null) => value && onMatchChange(value)}
          sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontSize: 11, py: 0.25 } }}
        >
          <ToggleButton value="any">Any selected hub</ToggleButton>
          <ToggleButton value="every">Every selected hub</ToggleButton>
        </ToggleButtonGroup>
      )}

      {/* ── models ─────────────────────────────────────────────────────── */}
      <Typography variant="overline" sx={{ lineHeight: 1.6 }} color="text.secondary">
        Models
      </Typography>
      {models.length === 0 && !modelsLoading ? (
        <Typography variant="caption" color="text.disabled">
          Nothing is connected within the current depth, direction and relationship filters.
        </Typography>
      ) : (
        <>
          {ownModels.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                {several ? "The hubs' own models" : "Its own model"}
              </Typography>
              <List dense disablePadding>{ownModels.map(renderModel)}</List>
            </Box>
          )}
          {otherModels.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Connected models
              </Typography>
              <List dense disablePadding>{otherModels.map(renderModel)}</List>
            </Box>
          )}
          <Typography variant="caption" color="text.disabled">
            Pick a model to add the path to its nearest instance.
          </Typography>
        </>
      )}
      {modelsTruncated && (
        <Typography variant="caption" color="warning.main">
          The graph around these hubs is large; only part of it was read.
        </Typography>
      )}

      <Divider />

      {/* ── data quality results ───────────────────────────────────────── */}
      <Typography variant="overline" sx={{ lineHeight: 1.6 }} color="text.secondary">
        Data quality results
      </Typography>

      {runs.length > 0 && (
        <TextField
          select
          size="small"
          label="Discover run"
          value={runId}
          onChange={(event) => onRunChange(event.target.value)}
          helperText={
            runId
              ? "Only this run's results are shown."
              : "Each dataset's newest run, listed run by run — never combined."
          }
        >
          <MenuItem value="">Newest run of each dataset</MenuItem>
          {runs.map((run) => (
            <MenuItem key={run.quality_run_id} value={run.quality_run_id}>
              {runLabel(run)}
              {newestPerDataset.has(run.quality_run_id) ? " (newest)" : ""}
            </MenuItem>
          ))}
        </TextField>
      )}

      {!resultsLoading && results.length === 0 && (
        <Alert severity="info" sx={{ py: 0, fontSize: 12 }}>
          {match === "every" && several
            ? "No result is traceable to every selected hub."
            : "No quality check has assessed the data behind this, and none is expected. That is not the same as passing."}
        </Alert>
      )}

      {groups.map(({ key, run, entries }) => (
        <Box key={key} sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
            <OverflowText
              variant="caption"
              fontWeight={700}
              color="text.secondary"
              sx={{ flex: 1, minWidth: 0 }}
              
            >
              {key === "~not-assessed"
                ? "Not assessed"
                : run
                  ? runLabel(run)
                  : "An assessment made before runs were recorded"}
            </OverflowText>
            {run && newestPerDataset.has(run.quality_run_id) && (
              <Chip size="small" label="newest" sx={{ height: 16, fontSize: 9.5 }} />
            )}
            {run && discoverHrefFor(run.session_id) && (
              <Tooltip title="Open the authoritative result in Discover (new tab)">
                <IconButton
                  size="small"
                  component="a"
                  href={discoverHrefFor(run.session_id)!}
                  target="_blank"
                  rel="noopener"
                  aria-label="Open in Discover"
                  sx={{ p: 0.25 }}
                >
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>

          <List dense disablePadding>
            {entries.map((entry) => {
              const face = OUTCOME_FACE[entry.outcome];
              const check = entry.check;
              const described = check ? describeCheck(check, { run, mapping: entry.mapping }) : null;
              const ruleLabel = check
                ? [
                    check.configuration_code ?? check.rule_code,
                    check.configuration_name ?? check.rule_name ?? check.check_type,
                  ]
                    .filter(Boolean)
                    .join(" — ")
                : [entry.not_assessed?.rule_code, entry.not_assessed?.rule_name ?? "No rule configured"]
                    .filter(Boolean)
                    .join(" — ");
              const column = entry.mapping?.column_name ?? check?.column_name ?? null;
              return (
                <ListItemButton
                  key={entry.key}
                  onClick={() => onPickResult(entry.key)}
                  sx={{ px: 1, py: 0.5, borderRadius: 1, alignItems: "flex-start", gap: 1 }}
                >
                  <Tooltip title={face.label}>
                    <face.Icon sx={{ fontSize: 16, color: face.colour, mt: 0.25 }} />
                  </Tooltip>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <OverflowText variant="body2" sx={{ fontSize: 12.5, fontWeight: 600 }} >
                      {ruleLabel}
                    </OverflowText>
                    <OverflowText variant="caption" color="text.secondary" display="block" >
                      {entry.target_name ?? "—"}
                      {column ? ` ← ${column}` : ""}
                      {entry.mapping?.file_name ? ` · ${entry.mapping.file_name}` : ""}
                    </OverflowText>
                    <Typography variant="caption" display="block" sx={{ color: face.colour }}>
                      {face.label}
                      {described && entry.outcome !== QUALITY_OUTCOME.ERROR
                        ? ` · ${described.records_assessed} assessed · ${described.records_passed} passed · ${described.records_attention} failed`
                        : ""}
                      {entry.outcome === QUALITY_OUTCOME.ERROR && check?.message ? ` · ${check.message}` : ""}
                      {entry.not_assessed
                        ? ` · ${NOT_ASSESSED_REASON[entry.not_assessed.reason] ?? entry.not_assessed.reason}`
                        : ""}
                    </Typography>
                    {several && (
                      <Typography variant="caption" color="text.disabled" display="block">
                        Connected to {entry.hub_ids.length} of {entry.selected_hub_count} selected hubs
                      </Typography>
                    )}
                  </Box>
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      ))}

      {checkCount > 1 && (
        <Typography variant="caption" color="text.disabled">
          Failed counts are per result. They are not added together: two results can flag the same
          record, and the overlap between them has not been resolved.
        </Typography>
      )}
      {report?.truncated && (
        <Typography variant="caption" color="warning.main">
          These hubs stand for more properties than one read covers; some results may be missing.
        </Typography>
      )}
      {results.length > 0 && (
        <Typography variant="caption" color="text.disabled">
          Pick a result to trace it on the diagram: hub → property → source column → result.
        </Typography>
      )}
    </Stack>
  );
}
