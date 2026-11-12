import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import type {
  PermittedParameter,
  RuleConfiguration,
  StructureFieldOption,
} from "@/features/discover/api/discoverApi";
import type { OverviewReadModel } from "@/shared/contracts";
import { listToText, normaliseParameters } from "./ruleParameterValues";

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
  overview: OverviewReadModel;
};

const SEVERITIES = ["low", "medium", "high"];

/** True when a parameter has been given something usable. */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  // Strip separators and whitespace: a list left as ", ," has nothing in it,
  // while a format like ^[A-Z]{2,4}$ plainly does.
  if (typeof value === "string") return value.replace(/[\s,]/g, "").length > 0;
  return true;
}

/**
 * Configure permitted parameters.
 *
 * A governed rule's behaviour is fixed by the rule itself. What a session may
 * vary is only what that rule declares as permitted — a threshold, a tolerance,
 * a severity, a scope, an allowed list. Anything outside that list is refused
 * by the server, so a session can never quietly redefine a governed rule.
 */
export function DiscoverRuleParametersTab({ vm, overview }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [savedKey, setSavedKey] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const report = vm.governedRulesQuery.data;
  const hasRun = !!report?.has_run;

  // Only rules that are on and that permit something to be set are shown here:
  // a rule with no permitted parameters has nothing for a session to decide.
  const configurable = useMemo(
    () =>
      (report?.items ?? []).filter(
        (item) => item.is_enabled && item.permitted_parameters.length > 0
      ),
    [report?.items]
  );

  // Seed the editable copy from what the server holds, and re-seed when a save
  // returns fresh values, so the form always starts from persisted truth.
  useEffect(() => {
    setDrafts((current) => {
      const seeded: Record<string, Record<string, unknown>> = {};
      for (const item of configurable) {
        // Keep whatever is already being edited; only fill in rules that have
        // no draft yet, so a refetch never throws away half-typed input.
        seeded[item.configuration_id] =
          current[item.configuration_id] ?? { ...(item.parameters ?? {}) };
      }
      return seeded;
    });
  }, [configurable]);

  // Which mapped fields can be offered as a "group by" choice.
  const columnOptions = useMemo(
    () =>
      [...new Map((report?.items ?? []).filter((i) => i.column_id).map((i) => [i.column_name, i])).values()],
    [report?.items]
  );
  // A "node" parameter picks a governed instance anywhere in the model, so it
  // draws on the model's whole node list.
  const nodeOptions: StructureFieldOption[] = vm.applicationFieldsQuery.data ?? [];

  const setDraft = (configurationId: string, key: string, value: unknown) =>
    setDrafts((current) => ({
      ...current,
      [configurationId]: { ...(current[configurationId] ?? {}), [key]: value },
    }));

  const save = async (item: RuleConfiguration) => {
    setError(null);
    setBusyKey(item.configuration_id);
    try {
      await vm.configureGovernedRuleMutation.mutateAsync({
        ruleId: item.rule_id,
        columnId: item.column_id,
        parameters: normaliseParameters(
          item.permitted_parameters,
          drafts[item.configuration_id] ?? {}
        ),
      });
      setSavedKey(item.configuration_id);
      window.setTimeout(() => setSavedKey(""), 2000);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? (err instanceof Error ? err.message : "Could not save these parameters."));
    } finally {
      setBusyKey("");
    }
  };

  const field = (item: RuleConfiguration, parameter: PermittedParameter) => {
    const draft = drafts[item.configuration_id] ?? {};
    const value = draft[parameter.key];

    if (parameter.type === "boolean") {
      return (
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={Boolean(value)}
              onChange={(e) => setDraft(item.configuration_id, parameter.key, e.target.checked)}
            />
          }
          label={<Typography variant="body2">{parameter.label}</Typography>}
        />
      );
    }

    if (parameter.type === "node") {
      return (
        <Select
          size="small"
          fullWidth
          displayEmpty
          value={(value as string) ?? ""}
          onChange={(e) => setDraft(item.configuration_id, parameter.key, e.target.value || null)}
          renderValue={(v) =>
            v ? (
              nodeOptions.find((n) => n.node_id === v)?.name ?? String(v)
            ) : (
              <Typography variant="body2" color="text.disabled">Not set</Typography>
            )
          }
        >
          <MenuItem value="">
            <Typography variant="body2" color="text.disabled">Not set</Typography>
          </MenuItem>
          {nodeOptions.map((node) => (
            <MenuItem key={node.node_id} value={node.node_id}>
              <Box>
                <Typography variant="body2" fontWeight={600}>{node.name}</Typography>
                <Typography variant="caption" color="text.secondary">{node.path}</Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      );
    }

    if (parameter.type === "column") {
      return (
        <Select
          size="small"
          fullWidth
          displayEmpty
          value={(value as string) ?? ""}
          onChange={(e) => setDraft(item.configuration_id, parameter.key, e.target.value || null)}
          renderValue={(v) =>
            v ? String(v) : <Typography variant="body2" color="text.disabled">All rows together</Typography>
          }
        >
          <MenuItem value="">
            <Typography variant="body2" color="text.disabled">All rows together</Typography>
          </MenuItem>
          {columnOptions.map((column) => (
            <MenuItem key={column.column_name} value={column.column_name}>
              {column.column_name}
            </MenuItem>
          ))}
        </Select>
      );
    }

    if (parameter.type === "choice") {
      const options = parameter.options ?? [];
      const current = (value as string) ?? String(parameter.default ?? options[0]?.value ?? "");
      return (
        <Select
          size="small"
          fullWidth
          value={current}
          onChange={(e) => setDraft(item.configuration_id, parameter.key, e.target.value as string)}
        >
          {options.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </Select>
      );
    }

    if (parameter.type === "list") {
      // Held as text while it is being typed; parsed into a list on save, so a
      // comma survives long enough for the next value to be typed after it.
      return (
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          placeholder="e.g. ACTIVE, INACTIVE, PENDING"
          value={listToText(value)}
          onChange={(e) => setDraft(item.configuration_id, parameter.key, e.target.value)}
          helperText="Separate each value with a comma."
        />
      );
    }

    return (
      <TextField
        size="small"
        fullWidth
        type={parameter.type === "number" ? "number" : "text"}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(
            item.configuration_id,
            parameter.key,
            parameter.type === "number" ? (raw === "" ? null : Number(raw)) : raw
          );
        }}
      />
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Header */}
      <Box>
        <Stack direction="row" alignItems="center" spacing={1}>
          <TuneOutlinedIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>Configure permitted parameters</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Each governed rule decides what a session may vary — a threshold, a tolerance, a severity, a
          scope or an allowed list. Everything else about the rule is fixed by the governed definition.
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {!hasRun ? (
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 1.5 }}>
            <TuneOutlinedIcon sx={{ fontSize: 44, color: "text.disabled" }} />
            <Typography variant="h6" fontWeight={700}>Determine the applicable rules first</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
              There is nothing to configure until this session knows which governed rules apply to
              {" "}{overview.session.source_filename || "your data"}. Run that on the previous step.
            </Typography>
          </CardContent>
        </Card>
      ) : configurable.length === 0 ? (
        <Alert severity="info">
          None of the rules you turned on take a session parameter, so there is nothing to set here.
          You can continue to the quality run.
        </Alert>
      ) : (
        configurable.map((item) => {
          const draft = drafts[item.configuration_id] ?? {};
          const outstanding =
            item.requires_parameters &&
            !item.permitted_parameters.some((p) => hasValue(draft[p.key]));

          return (
            <Card key={item.configuration_id} variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap" sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle1" fontWeight={700}>{item.rule_name}</Typography>
                  <Chip size="small" variant="outlined" label={item.code} sx={{ height: 20, fontSize: "0.65rem" }} />
                  <Typography variant="body2" color="text.secondary">
                    on <b>{item.column_name}</b>
                    {item.target_name ? ` → ${item.target_name}` : ""}
                  </Typography>
                  {outstanding && (
                    <Chip
                      size="small"
                      color="warning"
                      label="not set — this rule will not run"
                      sx={{ height: 20, fontSize: "0.65rem" }}
                    />
                  )}
                </Stack>

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 2,
                    mt: 1.5,
                  }}
                >
                  {item.permitted_parameters.map((parameter) => (
                    <Box key={parameter.key}>
                      {parameter.type !== "boolean" && (
                        <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.5 }}>
                          {parameter.label}
                        </Typography>
                      )}
                      {field(item, parameter)}
                      {parameter.help && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                          {parameter.help}
                        </Typography>
                      )}
                    </Box>
                  ))}

                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.5 }}>
                      Severity in this session
                    </Typography>
                    <Select
                      size="small"
                      fullWidth
                      value={item.severity ?? item.default_severity}
                      onChange={(e) =>
                        vm.configureGovernedRuleMutation.mutate({
                          ruleId: item.rule_id,
                          columnId: item.column_id,
                          severity: e.target.value as string,
                        })
                      }
                      sx={{ textTransform: "capitalize" }}
                    >
                      {SEVERITIES.map((severity) => (
                        <MenuItem key={severity} value={severity} sx={{ textTransform: "capitalize" }}>
                          {severity}
                        </MenuItem>
                      ))}
                    </Select>
                  </Box>
                </Box>

                <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={1.5} sx={{ mt: 2 }}>
                  {savedKey === item.configuration_id && (
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />
                      <Typography variant="caption" color="success.main" fontWeight={600}>Saved</Typography>
                    </Stack>
                  )}
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => save(item)}
                    disabled={busyKey === item.configuration_id}
                    startIcon={
                      busyKey === item.configuration_id ? (
                        <CircularProgress size={14} color="inherit" />
                      ) : undefined
                    }
                    sx={{ textTransform: "none", fontWeight: 600 }}
                  >
                    Save parameters
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          );
        })
      )}
    </Box>
  );
}
