import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import SearchIcon from "@mui/icons-material/Search";
import {
  propertyRulesApi,
  type LinkableConfiguration,
  type PropertyRule,
  type RuleApplicability,
} from "@/features/structure/api/propertyRulesApi";

const APPLICABILITY_HELP: Record<RuleApplicability, string> = {
  required: "Ticked for the analyst in Discover. Governance expects this to run.",
  recommended: "Offered and not ticked. The analyst decides.",
  available: "There if they want it. Nothing is implied by leaving it out.",
};

const readError = (err: unknown, fallback: string): string => {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail ?? (err instanceof Error ? err.message : fallback);
};

/** What a check will actually measure against, once its values resolve. */
function ValueSummary({ rule }: { rule: PropertyRule }) {
  if (rule.reference_requirement === "none") {
    const own = (rule.parameters?.allowed_values as string[]) ?? [];
    if (own.length === 0) return null;
    return (
      <Typography variant="caption" color="text.secondary" display="block">
        Values: {own.slice(0, 5).join(", ")}
        {own.length > 5 ? ` +${own.length - 5} more` : ""}
      </Typography>
    );
  }
  if (rule.readiness !== "ready") return null;
  const values = rule.approved_values;
  return (
    <Typography variant="caption" color="text.secondary" display="block">
      Approved {rule.expected_reference_type_name}: {values.slice(0, 5).join(", ")}
      {values.length > 5 ? ` +${values.length - 5} more` : ""}
    </Typography>
  );
}

function RuleCard({
  rule,
  options,
  onApplicability,
  onRemove,
  busy,
}: {
  rule: PropertyRule;
  options: { key: RuleApplicability; label: string }[];
  onApplicability: (next: RuleApplicability) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const incomplete = rule.readiness === "configuration_incomplete";
  return (
    <Box
      sx={{
        border: 1,
        borderColor: incomplete ? "warning.main" : "divider",
        borderRadius: 1,
        p: 1.25,
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" fontWeight={600}>
            {rule.name}
          </Typography>
          {rule.code && (
            <Typography variant="caption" sx={{ fontFamily: "monospace" }} color="text.secondary">
              {rule.code}
            </Typography>
          )}
          <Chip
            size="small"
            variant="outlined"
            label={rule.effective_severity}
            sx={{ height: 17, fontSize: "0.6rem" }}
          />
          {incomplete && (
            <Chip
              size="small"
              color="warning"
              icon={<ErrorOutlineIcon sx={{ fontSize: "0.8rem" }} />}
              label="Configuration incomplete"
              sx={{ height: 19, fontSize: "0.6rem" }}
            />
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {rule.definition_name} · v{rule.configuration_version}
          {rule.reference_requirement === "approved_values"
            ? ` · checks against ${rule.expected_reference_type_name}`
            : ""}
        </Typography>
        <ValueSummary rule={rule} />

        {incomplete && (
          <Alert severity="warning" sx={{ py: 0, fontSize: "0.75rem" }}>
            {rule.readiness_reason} The link is saved; the check will not run until the rule
            says what it accepts.
          </Alert>
        )}

        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title={APPLICABILITY_HELP[rule.applicability]}>
            <TextField
              select
              size="small"
              value={rule.applicability}
              disabled={busy}
              onChange={(e) => onApplicability(e.target.value as RuleApplicability)}
              sx={{ width: 150 }}
            >
              {options.map((option) => (
                <MenuItem key={option.key} value={option.key}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Remove this check from this property. The rule itself is untouched.">
            <span>
              <IconButton size="small" color="error" disabled={busy} onClick={onRemove}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  );
}

/**
 * Governance on one Asset Property.
 *
 * One statement is made here and nowhere else:
 *
 *   this property is subject to this rule
 *
 * It is not inherited. A rule linked here says nothing about the property
 * beside it, which is the point: `Valid Asset Voltage` is true of Rated
 * Voltage and nonsense on the Manufacturer field next to it.
 *
 * Which values a rule accepts is **not** decided here. It belongs to the rule,
 * is chosen once in the Rule Workspace, and is the same wherever the rule is
 * attached — otherwise one approved list would exist in as many versions as it
 * had properties, and nobody could say which one a result was measured
 * against. A rule that has not been told what it accepts shows as
 * *Configuration incomplete* rather than quietly accepting everything: the
 * link is saved, the check does not run, and Discover reports it as a
 * configuration error rather than as failing data.
 *
 * Like every Structure screen, this offers no way to write a rule.
 */
export function PropertyRulesPanel({
  nodeInstanceId,
  propertyName,
}: {
  nodeInstanceId: string;
  propertyName: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = useQuery({
    queryKey: ["structure", "propertyRules", nodeInstanceId],
    queryFn: () => propertyRulesApi.list(nodeInstanceId),
    enabled: Boolean(nodeInstanceId),
  });

  const linkable = useQuery({
    queryKey: ["structure", "linkableForProperty", nodeInstanceId, search],
    queryFn: () => propertyRulesApi.listLinkable(nodeInstanceId, search),
    enabled: picking && Boolean(nodeInstanceId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["structure", "propertyRules", nodeInstanceId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["structure", "linkableForProperty", nodeInstanceId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["structure", "valueCandidates", nodeInstanceId],
    });
    void queryClient.invalidateQueries({ queryKey: ["structure", "propertyRuleCounts"] });
  };

  const linkMutation = useMutation({
    mutationFn: ({
      candidate,
      applicability,
    }: {
      candidate: LinkableConfiguration;
      applicability: RuleApplicability;
    }) =>
      propertyRulesApi.link(
        nodeInstanceId,
        candidate.kind === "configuration"
          ? { configurationId: candidate.rule_configuration_id }
          : { definitionId: candidate.rule_definition_id },
        applicability,
      ),
    onSuccess: refresh,
  });

  const applicabilityMutation = useMutation({
    mutationFn: ({ id, applicability }: { id: string; applicability: RuleApplicability }) =>
      propertyRulesApi.setApplicability(id, applicability),
    onSuccess: refresh,
  });

  const unlinkMutation = useMutation({
    mutationFn: (id: string) => propertyRulesApi.unlink(id),
    onSuccess: refresh,
  });

  const run = async (work: Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await work;
    } catch (err) {
      setError(readError(err, fallback));
    }
  };

  const report = linked.data;
  const options = report?.applicability_options ?? [];
  const items = report?.items ?? [];
  const candidates = linkable.data?.items ?? [];
  const busy =
    linkMutation.isPending || applicabilityMutation.isPending || unlinkMutation.isPending;

  if (linked.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  return (
    <Stack spacing={1.5}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0 }}>
          {error}
        </Alert>
      )}

      {report?.path && report.path.length > 1 && (
        <Typography variant="caption" color="text.secondary">
          {report.path.map((step) => step.name).join(" › ")}
        </Typography>
      )}

      <Typography variant="caption" color="text.secondary">
        Rules are written once in the Rule Workspace and linked here. A column mapped to{" "}
        <strong>{propertyName}</strong> is offered these checks in Discover, and nothing else from
        the library.
      </Typography>

      {report && report.incomplete > 0 && (
        <Alert severity="warning" sx={{ py: 0.25 }}>
          {report.incomplete} check{report.incomplete === 1 ? "" : "s"} cannot run yet. Open{" "}
          {report.incomplete === 1 ? "it" : "them"} in the Rule Workspace and choose the governed
          vocabulary and the values {report.incomplete === 1 ? "it accepts" : "they accept"}.
        </Alert>
      )}

      {items.length === 0 ? (
        <Box sx={{ py: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {propertyName} is not subject to any check yet.
          </Typography>
          <Typography variant="caption" color="text.disabled">
            Until it is, a column mapped to this property shows no rules in Discover.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1}>
          {items.map((rule) => (
            <RuleCard
              key={rule.property_rule_id}
              rule={rule}
              options={options}
              busy={busy}
              onApplicability={(next) =>
                void run(
                  applicabilityMutation.mutateAsync({
                    id: rule.property_rule_id,
                    applicability: next,
                  }),
                  "Could not change how this check applies.",
                )
              }
              onRemove={() =>
                void run(
                  unlinkMutation.mutateAsync(rule.property_rule_id),
                  "Could not remove this link.",
                )
              }
            />
          ))}
        </Stack>
      )}

      {!picking ? (
        <Button
          size="small"
          startIcon={<AddIcon />}
          variant="outlined"
          onClick={() => setPicking(true)}
          sx={{ textTransform: "none", alignSelf: "flex-start" }}
        >
          Link a check
        </Button>
      ) : (
        <Stack spacing={1}>
          <TextField
            size="small"
            autoFocus
            placeholder="Search rule configurations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          {!linkable.isLoading && candidates.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {candidates.length} active rule{candidates.length === 1 ? "" : "s"}
              {linkable.data?.configurations
                ? ` · ${linkable.data.configurations} configured`
                : ""}
            </Typography>
          )}
          {linkable.isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size={18} />
            </Box>
          ) : candidates.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1.5 }}>
              No active rule matches. Draft rules are not offered; activate one in the Rule
              Workspace first.
            </Typography>
          ) : (
            <Box
              sx={{
                maxHeight: 260,
                overflow: "auto",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
              }}
            >
              {candidates.map((candidate: LinkableConfiguration) => (
                <Stack
                  key={candidate.rule_configuration_id || candidate.rule_definition_id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ px: 1.25, py: 0.75, borderBottom: 1, borderColor: "divider" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={0.75}
                      alignItems="center"
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Typography variant="body2" fontWeight={candidate.is_linked ? 400 : 600}>
                        {candidate.name}
                      </Typography>
                      {candidate.code && (
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: "monospace" }}
                          color="text.secondary"
                        >
                          {candidate.code}
                        </Typography>
                      )}
                      {candidate.reference_element_type_name && (
                        <Tooltip title="Needs approved values on this property before it can run.">
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`needs ${candidate.reference_element_type_name}`}
                            sx={{ height: 17, fontSize: "0.6rem" }}
                          />
                        </Tooltip>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {candidate.statement || candidate.definition_name}
                      {candidate.dimension ? ` · ${candidate.dimension}` : ""}
                    </Typography>
                  </Box>
                  {candidate.is_linked ? (
                    <Chip size="small" label="linked" sx={{ height: 19, fontSize: "0.6rem" }} />
                  ) : (
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          linkMutation.mutateAsync({
                            candidate,
                            applicability: "recommended",
                          }),
                          "Could not link this check.",
                        )
                      }
                      sx={{ textTransform: "none" }}
                    >
                      Link
                    </Button>
                  )}
                </Stack>
              ))}
            </Box>
          )}
          <Button
            size="small"
            onClick={() => {
              setPicking(false);
              setSearch("");
            }}
            sx={{ textTransform: "none", alignSelf: "flex-start" }}
          >
            Done adding
          </Button>
        </Stack>
      )}

    </Stack>
  );
}
