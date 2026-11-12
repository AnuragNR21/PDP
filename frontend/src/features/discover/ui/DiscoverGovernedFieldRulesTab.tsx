import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Link } from "react-router-dom";
import { apiClient } from "@/shared/http/apiClient";

/** How strongly governance expects a rule to run here. */
type Applicability = "required" | "recommended" | "available";

type GovernedOffer = {
  property_rule_id: string;
  rule_configuration_id: string;
  rule_definition_id: string;
  code: string;
  name: string;
  description: string;
  definition_name: string;
  check_type: string;
  dimension: string;
  severity: string;
  applicability: Applicability;
  notes: string;
  parameters: Record<string, unknown>;
  configuration_version: number;
  /** What this check needs from governed reference data, if anything. */
  reference_requirement: "none" | "approved_values";
  expected_reference_type_name: string;
  /** The values this property approves, where they satisfy the requirement. */
  approved_values: string[];
  /** Whether it can run at all. Incomplete means the reference source is missing. */
  readiness: "ready" | "configuration_incomplete";
  readiness_reason: string;
  selected_by_default: boolean;
  /** Stored on this session — what the run will actually execute. */
  is_attached: boolean;
  /** Governance says it applies and it can run, but it is not stored yet. */
  needs_apply: boolean;
};

/** A check that is linked but cannot run. Not a data-quality finding. */
type ConfigurationError = {
  property_rule_id: string;
  rule_configuration_id: string;
  name: string;
  code: string;
  expected_reference_type_name: string;
  reason: string;
};

type GovernedField = {
  column_id: string;
  column_name: string;
  table_name: string;
  target_node_id: string;
  target_name: string | null;
  items: GovernedOffer[];
  total: number;
  /** How many of them can actually run. */
  runnable: number;
  required: number;
  /** How many are stored on this session — what the run will execute. */
  attached: number;
  /** Required and ready, but not stored yet. Applied on sight, not drawn as a tick. */
  needs_apply: string[];
  configuration_errors: ConfigurationError[];
  /** How many values each rule on this field accepts, by vocabulary. */
  approved_by_vocabulary: {
    element_type_id: string;
    element_type_name: string;
    count: number;
  }[];
  empty_reason: string;
};

type GovernedReport = {
  session_id: string;
  fields: GovernedField[];
  total_fields: number;
  governed_fields: number;
  ungoverned_fields: number;
  configuration_errors: number;
};

const APPLICABILITY_COLOR: Record<Applicability, "error" | "info" | "default"> = {
  required: "error",
  recommended: "info",
  available: "default",
};

const APPLICABILITY_HELP: Record<Applicability, string> = {
  required: "Governance expects this to run. Ticked for you.",
  recommended: "Offered. You decide whether it applies to this file.",
  available: "There if you want it.",
};

const SEVERITY_COLOR: Record<string, "info" | "warning" | "error"> = {
  low: "info",
  medium: "warning",
  high: "error",
};

const readError = (err: unknown, fallback: string): string => {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail ?? (err instanceof Error ? err.message : fallback);
};

/**
 * The Rules step, resolved from governance rather than asked.
 *
 * A field is offered exactly the checks its mapped Asset Property is subject
 * to, and nothing else from the library. Nothing is inherited: a check linked
 * to the property beside this one does not appear here. Where governance
 * reaches nothing the field shows nothing, with the reason named — because a
 * screen that quietly fell back to the whole library would mean two different
 * things on two fields and the analyst could not tell which.
 *
 * A check whose approved values are missing is shown as a *configuration
 * error*, apart from the data-quality findings and with its own reason. It
 * cannot be ticked. The alternative — running it against nothing, or against
 * everything — would report the data as fine when the governance is what is
 * unfinished.
 *
 * Required rules arrive ticked, but only the ones that can run. The analyst
 * still chooses: governance decides what is relevant, the person decides what
 * runs on this file.
 */
export function DiscoverGovernedFieldRulesTab({ sessionId }: { sessionId: string | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [chosen, setChosen] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // One ticket per field. A tick that has been overtaken by a later tick on the
  // same field must not write its own result back, or a fast double-click
  // leaves the screen showing the older of the two answers.
  const ticket = useRef<Record<string, number>>({});

  const report = useQuery({
    // Not "governedRules": useDiscoverWorkspace already owns that key for the
    // older session-governance report, and two shapes under one key hand
    // whichever component renders second the wrong object.
    queryKey: ["discover", "ruleGovernanceFields", sessionId],
    queryFn: () =>
      apiClient.get<GovernedReport>(
        `/api/discover/sessions/${sessionId}/rule-governance/fields`,
      ),
    enabled: Boolean(sessionId),
  });

  // What this session has STORED is the starting point — not what governance
  // merely recommends. Seeding the boxes from `selected_by_default` drew a
  // tick over a rule that had never been saved: the chip said "1 chosen", the
  // run had no governed rule in it, and the screen reported a clean result for
  // a check nobody had made.
  useEffect(() => {
    if (!report.data) return;
    setChosen((current) => {
      const next = { ...current };
      for (const field of report.data.fields) {
        if (next[field.column_id]) continue;
        next[field.column_id] = new Set(
          field.items.filter((i) => i.is_attached).map((i) => i.property_rule_id),
        );
      }
      return next;
    });
  }, [report.data]);

  // A Required check that governance can run is not a suggestion. Store it
  // once, for real, so what is on screen is what the run will execute.
  const applied = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!report.data) return;
    for (const field of report.data.fields) {
      const pending = field.needs_apply ?? [];
      if (!pending.length || applied.current.has(field.column_id)) continue;
      applied.current.add(field.column_id);
      const ids = [
        ...new Set([
          ...field.items.filter((i) => i.is_attached).map((i) => i.property_rule_id),
          ...pending,
        ]),
      ];
      setChosen((current) => ({ ...current, [field.column_id]: new Set(ids) }));
      void saveMutation
        .mutateAsync({ columnId: field.column_id, ids })
        .catch((err) => setError(readError(err, "Could not apply the required rules.")));
    }
  }, [report.data]);

  const saveMutation = useMutation({
    mutationFn: ({ columnId, ids }: { columnId: string; ids: string[] }) =>
      apiClient.put<{ attached: number }>(
        `/api/discover/sessions/${sessionId}/rule-governance/fields/${columnId}`,
        { property_rule_ids: ids },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["discover", "rules"] });
      void queryClient.invalidateQueries({ queryKey: ["discover", "overview"] });
    },
  });

  const fields = report.data?.fields ?? [];
  const governed = report.data?.governed_fields ?? 0;
  const ungoverned = report.data?.ungoverned_fields ?? 0;
  const configurationErrors = report.data?.configuration_errors ?? 0;

  const totalChosen = useMemo(
    () => Object.values(chosen).reduce((sum, set) => sum + set.size, 0),
    [chosen],
  );

  /**
   * Ticking a rule applies it. There is no separate save.
   *
   * The tick is the decision, and a screen that asks for the decision twice
   * invites the second half to be forgotten — somebody ticks three rules,
   * walks away, and the run uses none of them. So the box moves at once and
   * the request follows; if the request fails the box goes back and says why,
   * which is the only honest way to show optimism.
   */
  const toggle = async (columnId: string, propertyRuleId: string) => {
    const before = new Set(chosen[columnId] ?? []);
    const next = new Set(before);
    if (next.has(propertyRuleId)) next.delete(propertyRuleId);
    else next.add(propertyRuleId);

    setChosen((current) => ({ ...current, [columnId]: next }));
    setError(null);
    setSavedField(null);

    const mine = (ticket.current[columnId] = (ticket.current[columnId] ?? 0) + 1);
    setSaving((current) => ({ ...current, [columnId]: true }));
    try {
      // The request carries the whole set, so it is the field's current state
      // that is saved rather than a stream of increments that can arrive out
      // of order.
      await saveMutation.mutateAsync({ columnId, ids: [...next] });
      if (ticket.current[columnId] !== mine) return;
      setSavedField(columnId);
    } catch (err) {
      if (ticket.current[columnId] !== mine) return;
      setChosen((current) => ({ ...current, [columnId]: before }));
      setError(readError(err, "Could not apply this rule."));
    } finally {
      if (ticket.current[columnId] === mine) {
        setSaving((current) => ({ ...current, [columnId]: false }));
      }
    }
  };

  if (!sessionId) {
    return <Typography color="text.secondary" variant="body2">Select a session first.</Typography>;
  }

  if (report.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  if (report.isError) {
    return <Alert severity="error">Could not load the rules for this session.</Alert>;
  }

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Alert severity="info" sx={{ py: 0.5 }}>
        Each field is offered the checks its mapped Asset Property is subject to — nothing is
        inherited, and nothing else from the library is shown. Rules are written in the Rule
        Workspace and linked to the property in the Structure Workspace.
      </Alert>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" sx={{ fontWeight: 600 }}
              label={`${governed} governed field${governed === 1 ? "" : "s"}`} />
        {ungoverned > 0 && (
          <Chip size="small" color="warning" variant="outlined"
                label={`${ungoverned} with no rules yet`} />
        )}
        <Chip size="small" color="primary" variant="outlined" label={`${totalChosen} chosen`} />
        {configurationErrors > 0 && (
          <Tooltip title="Checks that are linked but cannot run until their approved values are set. Not data-quality findings.">
            <Chip size="small" color="warning" label={`${configurationErrors} configuration error${configurationErrors === 1 ? "" : "s"}`} />
          </Tooltip>
        )}
        {report.isFetching && <CircularProgress size={14} />}
      </Stack>

      {fields.length === 0 && (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 5 }}>
            <AccountTreeOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
            <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>
              Nothing is mapped yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Map a column to a governed concept on the Mapping step, and its rules appear here.
            </Typography>
          </CardContent>
        </Card>
      )}

      {fields.map((field) => {
        const isOpen = open[field.column_id] ?? field.total > 0;
        const picked = chosen[field.column_id] ?? new Set<string>();
        // What the rules on this field accept, by vocabulary. Read from the
        // rules rather than from the property: the property no longer carries
        // an approved list, and showing one beside a rule that ignores it is
        // how somebody reads the wrong set.
        const counts = new Map<string, number>();
        for (const entry of field.approved_by_vocabulary ?? []) {
          counts.set(entry.element_type_name, Math.max(counts.get(entry.element_type_name) ?? 0, entry.count));
        }
        const approvedByType = [...counts.entries()];
        return (
          <Card key={field.column_id} variant="outlined">
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ px: 2, py: 1.25, cursor: "pointer", bgcolor: "action.hover" }}
              onClick={() => setOpen((s) => ({ ...s, [field.column_id]: !isOpen }))}
            >
              <ExpandMoreIcon
                fontSize="small"
                sx={{ transform: isOpen ? "none" : "rotate(-90deg)", transition: "0.2s", color: "text.secondary" }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {field.column_name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {field.table_name}
                  {field.target_name ? ` · mapped to ${field.target_name}` : ""}
                </Typography>
              </Box>
              {/* What this property approves, by vocabulary — the thing the
                  membership checks measure against. */}
              {approvedByType.slice(0, 3).map(([typeName, count]) => (
                <Tooltip key={typeName} title={`${count} approved ${typeName} value${count === 1 ? "" : "s"} on the rules chosen for this field`}>
                  <Chip size="small" variant="outlined" label={`${typeName} · ${count}`}
                        sx={{ height: 20, fontSize: "0.65rem" }} />
                </Tooltip>
              ))}
              {field.configuration_errors.length > 0 && (
                <Chip size="small" color="warning"
                      label={`${field.configuration_errors.length} incomplete`}
                      sx={{ height: 20, fontSize: "0.65rem" }} />
              )}
              {field.total > 0 ? (
                <Chip size="small" color="primary" variant="outlined"
                      label={`${picked.size}/${field.runnable}`}
                      sx={{ height: 20, fontSize: "0.65rem" }} />
              ) : (
                <Chip size="small" color="warning" variant="outlined" label="no rules"
                      sx={{ height: 20, fontSize: "0.65rem" }} />
              )}
            </Stack>

            <Collapse in={isOpen} unmountOnExit>
              <CardContent sx={{ pt: 1.5 }}>
                {field.total === 0 ? (
                  <Alert severity="warning" sx={{ py: 0.5 }}
                         action={
                           <Button component={Link} to="/structure-workspace" size="small"
                                   endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                                   sx={{ textTransform: "none" }}>
                             Structure
                           </Button>
                         }>
                    {field.empty_reason}
                  </Alert>
                ) : (
                  <Stack spacing={1}>
                    {field.items.map((offer) => {
                      const ticked = picked.has(offer.property_rule_id);
                      const incomplete = offer.readiness === "configuration_incomplete";
                      return (
                        <Stack
                          key={offer.property_rule_id}
                          direction="row"
                          spacing={1}
                          alignItems="flex-start"
                          sx={{
                            border: 1,
                            borderColor: incomplete
                              ? "warning.main"
                              : ticked
                                ? "primary.main"
                                : "divider",
                            borderRadius: 1,
                            p: 1,
                          }}
                        >
                          <Tooltip
                            title={
                              incomplete
                                ? "This check cannot run until its approved values are set in the Structure Workspace."
                                : ""
                            }
                          >
                            <span>
                              <Checkbox
                                size="small"
                                checked={ticked}
                                disabled={incomplete}
                                onChange={() =>
                                  void toggle(field.column_id, offer.property_rule_id)
                                }
                                sx={{ p: 0.5 }}
                              />
                            </span>
                          </Tooltip>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography variant="body2" fontWeight={600}>{offer.name}</Typography>
                              {offer.code && (
                                <Typography variant="caption" sx={{ fontFamily: "monospace" }} color="text.secondary">
                                  {offer.code}
                                </Typography>
                              )}
                              <Tooltip title={APPLICABILITY_HELP[offer.applicability]}>
                                <Chip size="small" color={APPLICABILITY_COLOR[offer.applicability]}
                                      variant="outlined" label={offer.applicability}
                                      sx={{ height: 18, fontSize: "0.62rem", textTransform: "capitalize" }} />
                              </Tooltip>
                              <Chip size="small" color={SEVERITY_COLOR[offer.severity] ?? "default"}
                                    variant="outlined" label={offer.severity}
                                    sx={{ height: 18, fontSize: "0.62rem" }} />
                            </Stack>
                            <Typography variant="caption" color="text.secondary" display="block">
                              {offer.definition_name}
                              {offer.reference_requirement === "approved_values"
                                ? ` · checks against ${offer.expected_reference_type_name} approved on ${field.target_name ?? "this property"}`
                                : ""}
                            </Typography>
                            {offer.approved_values.length > 0 && (
                              <Typography variant="caption" color="text.disabled" display="block">
                                Accepts: {offer.approved_values.slice(0, 8).join(", ")}
                                {offer.approved_values.length > 8
                                  ? ` +${offer.approved_values.length - 8} more`
                                  : ""}
                              </Typography>
                            )}
                            {incomplete && (
                              <Alert
                                severity="warning"
                                sx={{ py: 0, mt: 0.5, fontSize: "0.72rem" }}
                                action={
                                  <Button
                                    component={Link}
                                    to="/structure-workspace"
                                    size="small"
                                    endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                                    sx={{ textTransform: "none" }}
                                  >
                                    Fix
                                  </Button>
                                }
                              >
                                Configuration incomplete. {offer.readiness_reason}
                              </Alert>
                            )}
                          </Box>
                        </Stack>
                      );
                    })}

                    {/* No save button: the tick is the decision. This line
                        only reports what became of it. */}
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pt: 0.5 }}>
                      {saving[field.column_id] ? (
                        <>
                          <CircularProgress size={12} />
                          <Typography variant="caption" color="text.secondary">
                            Saving…
                          </Typography>
                        </>
                      ) : savedField === field.column_id ? (
                        <Typography variant="caption" color="success.main">
                          Saved. {picked.size} rule{picked.size === 1 ? "" : "s"} run on the next
                          quality check.
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.disabled">
                          Ticking a rule applies it to this field straight away.
                        </Typography>
                      )}
                    </Stack>
                  </Stack>
                )}
              </CardContent>
            </Collapse>
          </Card>
        );
      })}
    </Stack>
  );
}
