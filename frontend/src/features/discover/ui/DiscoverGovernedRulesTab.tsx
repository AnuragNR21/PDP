import { useEffect, useMemo, useState } from "react";
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import { discoverApi } from "@/features/discover/api/discoverApi";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import type {
  CheckKind,
  CrossModelLink,
  FieldRuleGroup,
  GovernedRuleGroup,
  GovernedRuleInstance,
  RuleComparator,
  RuleConfiguration,
} from "@/features/discover/api/discoverApi";
import type { OverviewReadModel } from "@/shared/contracts";

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
  overview: OverviewReadModel;
};

/** A rule with no parameters says everything in its name. */
function summarise(rule: RuleConfiguration): string | null {
  const p = rule.parameters ?? {};
  const parts = Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .filter(([key, v]) => !(key === "tolerance_percent" && Number(v) === 0))
    .map(([key, v]) => `${key.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : v}`);
  return parts.length ? parts.join(" · ") : null;
}

function readError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail ?? (err instanceof Error ? err.message : fallback);
}

/** Draft state for one ticked governed rule, inside one field's panel. */
type Draft = {
  rule: GovernedRuleInstance;
  checkType: string;
  comparator: string;
  numberText: string;
  listText: string;
};

/**
 * Determine Applicable Governed Rules.
 *
 * Governance is chosen once at the top of the page — a Support Domain model and
 * the cross-model relationships the rules are founded on — and then every field
 * is worked on in place: open a field, tick the governed rules that apply to it,
 * add them. No dialog. The rules already on a field stay on screen while new
 * ones are picked, which is the comparison a person is actually making, and one
 * they could not make through a modal covering the page.
 */
export function DiscoverGovernedRulesTab({ vm, overview }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);
  const [busyKey, setBusyKey] = useState("");

  // Governance, chosen once and used by every field below.
  const [modelId, setModelId] = useState("");
  const [linkIds, setLinkIds] = useState<string[]>([]);
  const [showLinks, setShowLinks] = useState(true);
  /** Which field's "add rules" panel is open. One at a time keeps the page readable. */
  const [openFieldId, setOpenFieldId] = useState("");

  const sessionId = vm.selectedSessionId;
  const report = vm.governedRulesQuery.data;
  const fields = report?.fields ?? [];
  const datasetRules = report?.dataset_rules ?? [];
  const mappedCount = vm.mappingsQuery.data?.length ?? 0;
  const ruleCount = report?.total ?? 0;
  const models = vm.supportModelsQuery.data ?? [];

  /**
   * The fields cannot be spoken about until both reads have answered.
   *
   * Before this guard the page read `?? []` off a query that was still in
   * flight and stated the result as fact — "0 rules across 0 fields", no cards —
   * which is indistinguishable from having lost every mapping. `mappedCount`
   * and `fields` come from two different requests, so the pair is briefly
   * inconsistent on every visit, and whichever lands second decides what the
   * user believes. Say nothing until both have landed.
   */
  const loadingFields = vm.mappingsQuery.isLoading || vm.governedRulesQuery.isLoading;
  const loadFailed = vm.mappingsQuery.isError || vm.governedRulesQuery.isError;
  const needsMapping = !loadingFields && !loadFailed && mappedCount === 0;

  const retryFields = () => {
    void vm.mappingsQuery.refetch();
    void vm.governedRulesQuery.refetch();
  };

  const linksQuery = useQuery({
    queryKey: ["discover", "ruleBuilder", "links", sessionId, modelId],
    queryFn: async () => discoverApi.listRuleBuilderLinks(sessionId, modelId),
    enabled: sessionId.length > 0 && modelId.length > 0,
  });

  const rulesQuery = useQuery({
    queryKey: ["discover", "ruleBuilder", "rules", sessionId, modelId],
    queryFn: async () => discoverApi.listRuleBuilderRules(sessionId, modelId),
    enabled: sessionId.length > 0 && modelId.length > 0,
    placeholderData: keepPreviousData,
  });

  const links = linksQuery.data?.links ?? [];
  const comparators: RuleComparator[] = linksQuery.data?.comparators ?? [];
  const catalogue = rulesQuery.data;
  const checkKinds: CheckKind[] = catalogue?.check_kinds ?? [];
  /**
   * Every rule the model declares, under its own category heading.
   *
   * There used to be a "Rules held under" select in front of this, and one
   * category came back at a time. It asked the person to know the model's
   * internal shape before they could see what was in it, and hid that a
   * threshold and a rule are both things you might tick in the same visit.
   */
  const ruleGroups: GovernedRuleGroup[] = catalogue?.groups ?? [];

  // A relationship chosen under one model means nothing under another, so
  // changing the model clears what was chosen beneath it.
  useEffect(() => {
    setLinkIds([]);
    setOpenFieldId("");
  }, [modelId]);

  /** Fields the chosen relationships bind to — shown as a hint, never a gate. */
  const boundColumnIds = useMemo(() => {
    const ids = new Set<string>();
    for (const link of links) {
      if (!linkIds.includes(link.relationship_type_id)) continue;
      for (const c of link.columns) ids.add(c.column_id);
    }
    return ids;
  }, [links, linkIds]);

  const governanceReady = modelId.length > 0 && linkIds.length > 0;

  const removeRule = async (rule: RuleConfiguration) => {
    setError(null);
    setBusyKey(rule.configuration_id);
    try {
      await vm.removeGovernedRuleMutation.mutateAsync({
        ruleId: rule.rule_id,
        columnId: rule.column_id,
      });
    } catch (err) {
      setError(readError(err, "Could not remove this rule."));
    } finally {
      setBusyKey("");
    }
  };

  const addRules = async (columnId: string, drafts: Draft[]) => {
    setError(null);
    await vm.buildRulesMutation.mutateAsync({
      supportModelId: modelId,
      relationshipTypeIds: linkIds,
      selections: drafts.map((d) => {
        const needs = checkKinds.find((k) => k.check_type === d.checkType)?.needs ?? "none";
        return {
          rule_instance_id: d.rule.instance_id,
          rule_name: d.rule.name,
          check_type: d.checkType,
          column_id: columnId,
          comparator: needs === "number" ? d.comparator : "",
          value: needs === "number" ? Number(d.numberText) : null,
          values:
            needs === "list"
              ? d.listText.split(",").map((v) => v.trim()).filter(Boolean)
              : [],
        };
      }),
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Stack direction="row" alignItems="center" spacing={1}>
          <GavelOutlinedIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>Build the rules for this data</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Choose the governance once, then add rules to each field in place.
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Card variant="outlined">
        <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ cursor: "pointer" }}
            onClick={() => setShowHow((v) => !v)}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <InfoOutlinedIcon color="primary" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={600}>Where a rule comes from</Typography>
            </Stack>
            <IconButton size="small" sx={{ transform: showHow ? "rotate(180deg)" : "none", transition: "0.2s" }}>
              <ExpandMoreIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Collapse in={showHow}>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Rules come from a <b>Support Domain model</b>: pick the model and the{" "}
              <b>cross-model relationships</b> that found them, then tick the governed rules
              each field needs. The relationship is recorded on every rule, so months later it
              still says which governance it came from.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Most governed rules need nothing from you beyond the field — “must be populated”,
              “must be unique” have already said everything. Only a threshold asks for an
              operator and a number, and only an approved list asks for values. Nothing is
              seeded and nothing is attached automatically.
            </Typography>
          </Collapse>
        </CardContent>
      </Card>

      {loadFailed ? (
        <Alert
          severity="error"
          action={<Button size="small" onClick={retryFields} sx={{ textTransform: "none" }}>Try again</Button>}
        >
          Could not load this session's fields. Nothing has been lost — the rules and mappings
          are still stored; this screen just could not read them.
        </Alert>
      ) : loadingFields ? (
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 6, gap: 1.5 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary">Loading your fields…</Typography>
          </CardContent>
        </Card>
      ) : needsMapping ? (
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 1.5 }}>
            <AccountTreeOutlinedIcon sx={{ fontSize: 44, color: "text.disabled" }} />
            <Typography variant="h6" fontWeight={700}>Map your fields first</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
              A rule binds to a field through the model, so there is nothing to build against
              yet. Pair your columns with model fields on the Mapping step.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Governance, chosen once for the whole page ── */}
          <Card variant="outlined" sx={{ borderColor: governanceReady ? "divider" : "primary.main" }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <Typography variant="subtitle1" fontWeight={700}>Governance</Typography>
                {governanceReady && (
                  <Chip size="small" color="primary" variant="outlined"
                        label={`${linkIds.length} relationship${linkIds.length === 1 ? "" : "s"} · ${catalogue?.total ?? 0} rules available`}
                        sx={{ height: 20, fontSize: "0.65rem" }} />
                )}
              </Stack>

              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="flex-start">
                <Box sx={{ minWidth: 260, flex: 1 }}>
                  <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.5 }}>
                    Support Domain model
                  </Typography>
                  <Select
                    size="small" fullWidth displayEmpty
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value as string)}
                    renderValue={(v) =>
                      v ? (models.find((m) => m.model_id === v)?.name ?? String(v))
                        : <Typography variant="body2" color="text.disabled">Choose a model</Typography>
                    }
                  >
                    {models.map((model) => (
                      <MenuItem key={model.model_id} value={model.model_id}>
                        <Box>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="body2" fontWeight={600}>{model.name}</Typography>
                            {model.status !== "active" && (
                              <Chip size="small" label={lifecycleLabel(model.status)} sx={{ height: 17, fontSize: "0.6rem" }} />
                            )}
                          </Stack>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </Box>

              </Stack>

              {modelId && (
                <Box sx={{ mt: 2 }}>
                  <Stack
                    direction="row" alignItems="center" justifyContent="space-between"
                    sx={{ cursor: "pointer" }} onClick={() => setShowLinks((v) => !v)}
                  >
                    <Typography variant="caption" fontWeight={600}>
                      Cross-model relationships these rules are founded on
                    </Typography>
                    <IconButton size="small" sx={{ transform: showLinks ? "rotate(180deg)" : "none", transition: "0.2s" }}>
                      <ExpandMoreIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <Collapse in={showLinks}>
                    {linksQuery.isLoading ? (
                      <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={20} /></Stack>
                    ) : links.length === 0 ? (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        This model has no cross-model relationships yet. Add one in the Model
                        workspace, or choose a different model.
                      </Alert>
                    ) : (
                      <Box sx={{ mt: 1, maxHeight: 260, overflowY: "auto" }}>
                        {links.map((link) => (
                          <LinkOption
                            key={`${link.relationship_type_id}-${link.direction}`}
                            link={link}
                            checked={linkIds.includes(link.relationship_type_id)}
                            onToggle={() =>
                              setLinkIds((current) =>
                                current.includes(link.relationship_type_id)
                                  ? current.filter((id) => id !== link.relationship_type_id)
                                  : [...current, link.relationship_type_id]
                              )
                            }
                          />
                        ))}
                      </Box>
                    )}
                  </Collapse>
                </Box>
              )}

              {!governanceReady && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
                  {modelId
                    ? "Tick at least one relationship — it is what each rule records as its source."
                    : "Pick a model to see the rules it declares."}
                </Typography>
              )}
            </CardContent>
          </Card>

          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={`${ruleCount} rule${ruleCount === 1 ? "" : "s"} across ${fields.length} field${fields.length === 1 ? "" : "s"}`}
              sx={{ fontWeight: 600 }}
            />
            {(report?.needs_parameters ?? 0) > 0 && (
              <Chip
                size="small"
                color="warning"
                icon={<TuneOutlinedIcon sx={{ fontSize: 15 }} />}
                label={`${report?.needs_parameters} still need a value`}
              />
            )}
          </Stack>

          {/* ── One card per mapped field, worked on in place ── */}
          {fields.map((field) => (
            <FieldCard
              key={field.column_id}
              field={field}
              bound={boundColumnIds.has(field.column_id)}
              governanceReady={governanceReady}
              rulesLoading={rulesQuery.isLoading}
              ruleGroups={ruleGroups}
              checkKinds={checkKinds}
              comparators={comparators}
              open={openFieldId === field.column_id}
              onToggleOpen={() =>
                setOpenFieldId((current) => (current === field.column_id ? "" : field.column_id))
              }
              busyKey={busyKey}
              onRemove={removeRule}
              onAdd={addRules}
              onError={setError}
            />
          ))}

          {datasetRules.length > 0 && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700}>Across the whole record</Typography>
                <Typography variant="caption" color="text.secondary">
                  Checks that look at every mapped field together rather than one field.
                </Typography>
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                  {datasetRules.map((rule) => (
                    <RuleRow
                      key={rule.configuration_id}
                      rule={rule}
                      busy={busyKey === rule.configuration_id}
                      onRemove={() => removeRule(rule)}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Box>
  );
}

// ── One field ───────────────────────────────────────────────────────────────

/**
 * A mapped field, the rules already on it, and — opened in place — the governed
 * rules that could be added to it.
 *
 * The field is not something the person picks here; it is the card they are
 * standing in. That removes the whole question a dialog had to ask, which is
 * why adding a rule now takes a tick and a click.
 */
function FieldCard({
  field,
  bound,
  governanceReady,
  rulesLoading,
  ruleGroups,
  checkKinds,
  comparators,
  open,
  onToggleOpen,
  busyKey,
  onRemove,
  onAdd,
  onError,
}: {
  field: FieldRuleGroup;
  bound: boolean;
  governanceReady: boolean;
  rulesLoading: boolean;
  ruleGroups: GovernedRuleGroup[];
  checkKinds: CheckKind[];
  comparators: RuleComparator[];
  open: boolean;
  onToggleOpen: () => void;
  busyKey: string;
  onRemove: (rule: RuleConfiguration) => void;
  onAdd: (columnId: string, drafts: Draft[]) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  /** Which categories are expanded. Collapsed is the default past the first. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Closing the panel discards the half-built batch rather than keeping it
  // hidden — a tick the person cannot see is a tick they did not make.
  useEffect(() => {
    if (!open) {
      setDrafts({});
      setSearch("");
      setOpenGroups({});
    }
  }, [open]);

  const kindOf = (checkType: string) => checkKinds.find((k) => k.check_type === checkType);
  const picked = Object.values(drafts);

  const searching = search.trim().length > 0;

  /**
   * The categories, each narrowed to what the search matches.
   *
   * A model can declare several hundred rules across a dozen categories, so a
   * category that matches nothing is dropped entirely rather than left as an
   * empty heading to scroll past.
   */
  const visibleGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return ruleGroups
      .map((group) => ({
        ...group,
        rules: needle
          ? group.rules.filter(
              (r) =>
                r.name.toLowerCase().includes(needle) ||
                (r.description ?? "").toLowerCase().includes(needle)
            )
          : group.rules,
      }))
      .filter((group) => group.rules.length > 0);
  }, [ruleGroups, search]);

  const totalRules = ruleGroups.reduce((sum, g) => sum + g.rules.length, 0);
  const matchCount = visibleGroups.reduce((sum, g) => sum + g.rules.length, 0);

  /**
   * Which category the panel opens on.
   *
   * The categories are listed in the order governance declares them, which puts
   * "Evidence Requirement" before "Rule" — alphabetically fair and useless to
   * open on. So the one called exactly "Rule" opens, and the largest otherwise.
   * "Rule Category" and "Rule Level" are deliberately not accepted as near
   * misses: opening on a list of categories would look like the rule list and
   * quietly be the wrong thing.
   */
  const defaultGroupId = useMemo(() => {
    const exact = ruleGroups.find((g) => g.name.trim().toLowerCase() === "rule");
    if (exact) return exact.element_id;
    const largest = [...ruleGroups].sort((a, b) => b.rules.length - a.rules.length)[0];
    return largest?.element_id ?? "";
  }, [ruleGroups]);

  /**
   * A category is open when the person opened it, when their search reached
   * into it, or when it is the default and they have not touched anything — so
   * the panel opens showing rules rather than a row of closed drawers.
   */
  const isGroupOpen = (groupId: string) => {
    if (searching) return true;
    const explicit = openGroups[groupId];
    if (explicit !== undefined) return explicit;
    return groupId === defaultGroupId;
  };

  const toggleGroup = (groupId: string) =>
    setOpenGroups((current) => ({ ...current, [groupId]: !isGroupOpen(groupId) }));

  const pickedInGroup = (group: GovernedRuleGroup) =>
    group.rules.filter((r) => drafts[r.instance_id]).length;

  const toggle = (rule: GovernedRuleInstance) =>
    setDrafts((current) => {
      if (current[rule.instance_id]) {
        const { [rule.instance_id]: _gone, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [rule.instance_id]: {
          rule,
          checkType: rule.suggested_check,
          comparator: "gte",
          numberText: "",
          listText: "",
        },
      };
    });

  const patch = (id: string, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...change } }));

  const missing = picked.filter((d) => {
    const needs = kindOf(d.checkType)?.needs ?? "none";
    if (needs === "number") return d.numberText.trim().length === 0;
    if (needs === "list") return d.listText.split(",").every((v) => !v.trim());
    return false;
  });

  const add = async () => {
    setSaving(true);
    try {
      await onAdd(field.column_id, picked);
      setDrafts({});
      onToggleOpen();
    } catch (err) {
      onError(readError(err, "Could not add these rules."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ borderColor: open ? "primary.main" : "divider" }}>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2} flexWrap="wrap">
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap">
              <Typography variant="subtitle1" fontWeight={700}>{field.column_name}</Typography>
              <Chip size="small" variant="outlined" label={field.datatype}
                    sx={{ height: 20, fontSize: "0.65rem" }} />
              {bound && (
                <Chip size="small" color="primary" variant="outlined" label="bound"
                      sx={{ height: 20, fontSize: "0.6rem" }} />
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              mapped to {field.target_name ?? "—"}
            </Typography>
          </Box>
          <Tooltip title={governanceReady ? "" : "Choose a model and a relationship above first"}>
            <span>
              <Button
                size="small"
                variant={open ? "outlined" : "contained"}
                startIcon={open ? <CloseIcon /> : <AddIcon />}
                onClick={onToggleOpen}
                disabled={!governanceReady}
                sx={{ textTransform: "none", fontWeight: 600 }}
              >
                {open ? "Close" : "Add rule"}
              </Button>
            </span>
          </Tooltip>
        </Stack>

        {field.rules.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ mt: 1.5 }}>
            No rules yet — nothing will be checked on this field.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {field.rules.map((rule) => (
              <RuleRow
                key={rule.configuration_id}
                rule={rule}
                busy={busyKey === rule.configuration_id}
                onRemove={() => onRemove(rule)}
              />
            ))}
          </Stack>
        )}

        {/* ── Adding, in place ── */}
        <Collapse in={open}>
          <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small"
                placeholder={`Search rules to add to ${field.column_name}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ flex: 1, minWidth: 220 }}
              />
              <Chip size="small" color={picked.length ? "primary" : "default"}
                    label={`${picked.length} ticked`} sx={{ fontWeight: 600 }} />
            </Stack>

            {rulesLoading ? (
              <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={20} /></Stack>
            ) : visibleGroups.length === 0 ? (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                {totalRules
                  ? `No rule matches \u201c${search}\u201d.`
                  : "This model declares no rules yet."}
              </Alert>
            ) : (
              <Box sx={{ mt: 1.5, maxHeight: 420, overflowY: "auto", pr: 0.5 }}>
                {searching && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                    {matchCount} rule{matchCount === 1 ? "" : "s"} across{" "}
                    {visibleGroups.length} categor{visibleGroups.length === 1 ? "y" : "ies"}
                  </Typography>
                )}

                {visibleGroups.map((group) => {
                  const expanded = isGroupOpen(group.element_id);
                  const ticked = pickedInGroup(group);
                  return (
                    <Box key={group.element_id} sx={{ mb: 1 }}>
                      {/* The category heading. Governance names these drawers —
                          Rule, Threshold, Severity — and a person ticks across
                          as many of them as they like in one visit. */}
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        onClick={() => toggleGroup(group.element_id)}
                        sx={{
                          cursor: "pointer",
                          px: 1,
                          py: 0.75,
                          borderRadius: 1,
                          // Opaque, because it is sticky: `action.hover` is a
                          // translucent overlay, so the rules scrolling under
                          // the heading showed straight through it.
                          backgroundColor: (t) =>
                            t.palette.mode === "dark" ? t.palette.grey[900] : t.palette.grey[100],
                          border: 1,
                          borderColor: "divider",
                          position: "sticky",
                          top: 0,
                          zIndex: 2,
                        }}
                      >
                        <ExpandMoreIcon
                          fontSize="small"
                          sx={{
                            transform: expanded ? "none" : "rotate(-90deg)",
                            transition: "0.2s",
                            color: "text.secondary",
                          }}
                        />
                        <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>
                          {group.display_name}
                        </Typography>
                        {ticked > 0 && (
                          <Chip
                            size="small"
                            color="primary"
                            label={`${ticked} ticked`}
                            sx={{ height: 17, fontSize: "0.6rem" }}
                          />
                        )}
                        <Typography variant="caption" color="text.secondary">
                          {group.rules.length}
                        </Typography>
                      </Stack>

                      <Collapse in={expanded} unmountOnExit>
                        <Box sx={{ mt: 0.5 }}>
                          {group.rules.map((rule) => {
                            const draft = drafts[rule.instance_id];
                            const on = !!draft;
                            const checkType = draft?.checkType ?? rule.suggested_check;
                            const kind = kindOf(checkType);
                            const needs = kind?.needs ?? "none";
                            return (
                              <Box
                                key={rule.instance_id}
                                sx={{
                                  px: 1, py: 0.75, mb: 0.5, borderRadius: 1,
                                  border: 1, borderColor: on ? "primary.main" : "divider",
                                  bgcolor: on ? "action.hover" : "transparent",
                                }}
                              >
                                <Stack direction="row" alignItems="flex-start" spacing={1}
                                       sx={{ cursor: "pointer" }} onClick={() => toggle(rule)}>
                                  {/* The whole row toggles, so the box must not
                                      toggle again on its own: without this the
                                      click landed twice — on, then straight back
                                      off — and hitting the box did nothing while
                                      hitting the name worked. */}
                                  <Checkbox
                                    size="small"
                                    checked={on}
                                    onChange={() => toggle(rule)}
                                    onClick={(e) => e.stopPropagation()}
                                    sx={{ p: 0.5 }}
                                  />
                                  <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap">
                                      <Typography variant="body2" fontWeight={600}>{rule.name}</Typography>
                                      <Chip size="small" variant="outlined" label={kind?.label ?? checkType}
                                            sx={{ height: 17, fontSize: "0.6rem" }} />
                                      {needs === "none" && (
                                        <Chip size="small" color="success" variant="outlined" label="no value needed"
                                              sx={{ height: 17, fontSize: "0.6rem" }} />
                                      )}
                                    </Stack>
                                    {rule.description && (
                                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} noWrap>
                                        {rule.description}
                                      </Typography>
                                    )}
                                  </Box>
                                </Stack>

                                {/* Only a ticked rule asks anything, and only what its check needs. */}
                                {on && (
                                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap
                                         sx={{ mt: 1, pl: 4.5, pb: 0.5 }}>
                                    <Box sx={{ minWidth: 180 }}>
                                      <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.25 }}>
                                        Checks that
                                      </Typography>
                                      <Select
                                        size="small" fullWidth
                                        value={draft.checkType}
                                        onChange={(e) => patch(rule.instance_id, { checkType: e.target.value as string })}
                                      >
                                        {checkKinds.map((k) => (
                                          <MenuItem key={k.check_type} value={k.check_type}>{k.label}</MenuItem>
                                        ))}
                                      </Select>
                                    </Box>

                                    {needs === "number" && (
                                      <>
                                        <Box sx={{ width: 150 }}>
                                          <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.25 }}>
                                            Operator
                                          </Typography>
                                          <Select
                                            size="small" fullWidth
                                            value={draft.comparator}
                                            onChange={(e) => patch(rule.instance_id, { comparator: e.target.value as string })}
                                          >
                                            {comparators.filter((c) => c.sql !== null).map((c) => (
                                              <MenuItem key={c.key} value={c.key}>
                                                <b>{c.symbol}</b>&nbsp;&nbsp;{c.label}
                                              </MenuItem>
                                            ))}
                                          </Select>
                                        </Box>
                                        <Box sx={{ width: 130 }}>
                                          <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.25 }}>
                                            Value
                                          </Typography>
                                          <TextField
                                            size="small" fullWidth type="number" placeholder="e.g. 8"
                                            value={draft.numberText}
                                            onChange={(e) => patch(rule.instance_id, { numberText: e.target.value })}
                                          />
                                        </Box>
                                      </>
                                    )}

                                    {needs === "list" && (
                                      <Box sx={{ minWidth: 260, flex: 1 }}>
                                        <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.25 }}>
                                          Accepted values
                                        </Typography>
                                        {/* Held as raw text and split only on save, so a comma
                                            survives long enough for the next value to follow it. */}
                                        <TextField
                                          size="small" fullWidth placeholder="Metal, Wood, Plastic"
                                          value={draft.listText}
                                          onChange={(e) => patch(rule.instance_id, { listText: e.target.value })}
                                          helperText="Separate each value with a comma."
                                        />
                                      </Box>
                                    )}
                                  </Stack>
                                )}
                              </Box>
                            );
                          })}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            )}

            {missing.length > 0 && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                Still to fill in: {missing.map((d) => d.rule.name).join(", ")}.
              </Alert>
            )}

            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
              <Button size="small" onClick={onToggleOpen} sx={{ textTransform: "none" }}>
                Cancel
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={add}
                disabled={picked.length === 0 || missing.length > 0 || saving}
                startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
                sx={{ textTransform: "none", fontWeight: 600 }}
              >
                {saving
                  ? "Adding…"
                  : `Add ${picked.length || ""} rule${picked.length === 1 ? "" : "s"} to ${field.column_name}`}
              </Button>
            </Stack>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

function RuleRow({
  rule,
  busy,
  onRemove,
}: {
  rule: RuleConfiguration;
  busy: boolean;
  onRemove: () => void;
}) {
  const detail = summarise(rule);
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        px: 1.5, py: 1,
        border: 1, borderColor: "divider", borderRadius: 1,
        bgcolor: "background.default",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap">
          <Typography variant="body2" fontWeight={600}>{rule.rule_name}</Typography>
          <Chip size="small" variant="outlined" label={rule.severity ?? rule.default_severity}
                sx={{ height: 18, fontSize: "0.6rem", textTransform: "capitalize" }} />
        </Stack>
        {detail && <Typography variant="caption" color="text.secondary">{detail}</Typography>}
        {rule.requires_parameters && !detail && (
          <Typography variant="caption" color="warning.main">
            Needs a value before it can run — set it on the next step.
          </Typography>
        )}
      </Box>
      {busy ? (
        <CircularProgress size={16} />
      ) : (
        <Tooltip title="Remove this rule">
          <IconButton size="small" onClick={onRemove}><CloseIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

/**
 * One relationship, shown from the Support Domain model's side.
 *
 * Every relationship can be picked. Whether it happens to reach a field of this
 * file is worth knowing — it is shown underneath — but it is not permission.
 * Gating selection on it made a model's whole list untouchable whenever its
 * relationships bound to types this file had nothing mapped to.
 */
function LinkOption({
  link,
  checked,
  onToggle,
}: {
  link: CrossModelLink;
  checked: boolean;
  onToggle: () => void;
}) {
  const arrow = link.direction === "outgoing" ? "→" : "←";
  return (
    <Stack
      direction="row"
      alignItems="flex-start"
      spacing={1}
      onClick={onToggle}
      sx={{
        px: 1, py: 0.75, mb: 0.5,
        border: 1,
        borderColor: checked ? "primary.main" : "divider",
        borderRadius: 1,
        cursor: "pointer",
      }}
    >
      {/* Same as the rule rows: the row already toggles, so the box must not. */}
      <Checkbox
        size="small"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        sx={{ p: 0.5 }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={600}>
          {link.governed_type_name} <span style={{ opacity: 0.6 }}>{arrow}</span>{" "}
          {link.bound_type_name ?? "—"}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {link.relationship_name}
          {link.bound_model_name ? ` · ${link.bound_model_name}` : ""}
        </Typography>
        {link.is_usable ? (
          <Typography variant="caption" color="primary.main">
            reaches {link.columns.map((c) => c.column_name).join(", ")}
          </Typography>
        ) : (
          link.unusable_reason && (
            <Typography variant="caption" color="text.disabled">{link.unusable_reason}</Typography>
          )
        )}
      </Box>
    </Stack>
  );
}
