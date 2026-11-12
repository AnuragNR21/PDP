import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Link,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import {
  ruleConfigurationsApi,
  type Vocabulary,
} from "@/features/rules/api/ruleConfigurationsApi";
import type {
  ExampleReport,
  RuleCatalogue,
  RuleDefinition,
  RuleParameters,
  RuleParameterSpec,
  SaveRulePayload,
  ScriptValidation,
} from "@/features/rules/api/rulesApi";

export type RuleDraft = {
  name: string;
  description: string;
  category: string;
  dimension: string;
  data_type: string;
  execution_scope: string;
  rationale: string;
  reference: string;
  message_template: string;
  examples_pass: string;
  examples_fail: string;
  owner: string;
  definition_kind: string;
  check_type: string;
  script: string;
  severity: string;
  status: string;
  /** Held as text while typing; converted only on save. */
  parameters: Record<string, string>;
  /** The governed vocabulary an approved-list rule reads. */
  reference_element_type_id: string;
  /** Which of its values the rule approves, ticked one by one. */
  reference_value_ids: string[];
};

/**
 * Checks whose whole question is which values they accept.
 *
 * These take their list from a governed vocabulary and from nowhere else. The
 * free-text box that used to sit here was never read by the run — the list came
 * from the configuration behind the rule — so a person could type six voltages,
 * save, and have the rule check against something different.
 */
const REFERENCE_DEPENDENT_CHECKS = ["allowed_values"];

/** The parameter that list fills in. Never typed, so never offered as a field. */
const VALUES_PARAMETER = "allowed_values";

/** Parameters a script reads through `params`, written one per line. */
const parseScriptParams = (text: string): RuleParameters => {
  const out: RuleParameters = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at < 0) continue;
    const name = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();
    if (!name || !raw) continue;
    out[name] = raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  }
  return out;
};

const formatScriptParams = (parameters: RuleParameters, shared: string[]): string =>
  Object.entries(parameters)
    .filter(([key]) => !shared.includes(key))
    .map(([key, value]) => `${key} = ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");

const toDraft = (rule: RuleDefinition | null, catalogue: RuleCatalogue | undefined): RuleDraft => {
  const parameters: Record<string, string> = {};
  for (const [key, value] of Object.entries(rule?.parameters ?? {})) {
    parameters[key] = Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value);
  }
  const isScript = rule?.definition_kind === "python";
  return {
    name: rule?.name ?? "",
    description: rule?.description ?? "",
    // A new rule starts in the library's default category rather than blank,
    // so the common case needs no thought — but it can be anything typed here.
    category: rule?.category ?? catalogue?.default_category ?? "Common",
    dimension: rule?.dimension ?? "validity",
    data_type: rule?.data_type ?? "any",
    // Empty on a new rule: the backend fills in whatever the chosen check
    // normally needs, which is right for almost every rule.
    execution_scope: rule?.execution_scope ?? "",
    rationale: rule?.rationale ?? "",
    reference: rule?.reference ?? "",
    message_template: rule?.message_template ?? "",
    examples_pass: (rule?.examples_pass ?? []).join(", "),
    examples_fail: (rule?.examples_fail ?? []).join(", "),
    owner: rule?.owner ?? "",
    definition_kind: rule?.definition_kind ?? "builtin",
    check_type: isScript
      ? catalogue?.check_types[0]?.check_type ?? ""
      : rule?.check_type ?? catalogue?.check_types[0]?.check_type ?? "",
    script: rule?.script ?? "",
    severity: rule?.severity ?? "medium",
    status: rule?.status ?? "draft",
    parameters,
    reference_element_type_id: rule?.reference_element_type_id ?? "",
    reference_value_ids: rule?.reference_value_ids ?? [],
  };
};

/**
 * Authoring one rule.
 *
 * The form asks for the check first and then only what that check needs: a
 * uniqueness rule is finished as soon as it has a name, while an approved list
 * still has to say which values are approved. Anything a check does not use is
 * simply absent rather than disabled, so the form never shows a field that
 * cannot be filled in.
 */
export function CreateEditRuleDialog({
  open,
  rule,
  catalogue,
  saving,
  error,
  onClose,
  onSave,
  onValidateScript,
  onTestExamples,
}: {
  open: boolean;
  rule: RuleDefinition | null;
  catalogue: RuleCatalogue | undefined;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: SaveRulePayload) => void;
  onValidateScript: (script: string) => Promise<ScriptValidation>;
  onTestExamples: (payload: {
    check_type: string;
    parameters: RuleParameters;
    examples_pass: string[];
    examples_fail: string[];
  }) => Promise<ExampleReport>;
}) {
  const [draft, setDraft] = useState<RuleDraft>(() => toDraft(rule, catalogue));
  const [touched, setTouched] = useState(false);
  const [scriptParams, setScriptParams] = useState("");
  const [validation, setValidation] = useState<ScriptValidation | null>(null);
  const [checking, setChecking] = useState(false);
  const [examples, setExamples] = useState<ExampleReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [valueSearch, setValueSearch] = useState("");
  /**
   * Whether the ticks have been seeded for the vocabulary now on screen.
   *
   * A rule bound to a whole vocabulary stores no ids — "all of them" was the
   * only thing it could have meant. Opening it has to show every value ticked,
   * or the author reads an accurate rule as an empty one; but that seeding
   * must happen once per vocabulary, not on every render, or unticking a value
   * would snap straight back.
   */
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const splitList = (text: string) => text.split(",").map((v) => v.trim()).filter(Boolean);

  const sharedNames = (catalogue?.shared_parameters ?? []).map((spec) => spec.name);

  useEffect(() => {
    if (open) {
      setDraft(toDraft(rule, catalogue));
      setScriptParams(rule ? formatScriptParams(rule.parameters, sharedNames) : "");
      setValidation(null);
      setExamples(null);
      setTouched(false);
      setValueSearch("");
      setSeededFor(null);
    }
    // sharedNames is derived from catalogue, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule, catalogue]);

  const isScript = draft.definition_kind === "python";
  const readsVocabulary =
    !isScript && REFERENCE_DEPENDENT_CHECKS.includes(draft.check_type);

  const vocabularies = useQuery({
    queryKey: ["rules", "vocabularies"],
    queryFn: () => ruleConfigurationsApi.listVocabularies(),
    enabled: open && readsVocabulary,
    staleTime: 5 * 60_000,
  });

  const vocabularyValues = useQuery({
    queryKey: ["rules", "vocabularyValues", draft.reference_element_type_id],
    queryFn: () => ruleConfigurationsApi.listVocabularyValues(draft.reference_element_type_id),
    enabled: open && readsVocabulary && Boolean(draft.reference_element_type_id),
  });

  const candidates = vocabularyValues.data?.items ?? [];

  useEffect(() => {
    if (!readsVocabulary || !draft.reference_element_type_id) return;
    if (seededFor === draft.reference_element_type_id) return;
    if (!vocabularyValues.data) return;
    setSeededFor(draft.reference_element_type_id);
    if (draft.reference_value_ids.length > 0) return;
    setDraft((current) => ({
      ...current,
      reference_value_ids: (vocabularyValues.data?.items ?? []).map(
        (value) => value.element_instance_id,
      ),
    }));
  }, [
    readsVocabulary,
    draft.reference_element_type_id,
    draft.reference_value_ids.length,
    seededFor,
    vocabularyValues.data,
  ]);

  const toggleValue = (elementInstanceId: string) =>
    setDraft((current) => ({
      ...current,
      reference_value_ids: current.reference_value_ids.includes(elementInstanceId)
        ? current.reference_value_ids.filter((id) => id !== elementInstanceId)
        : [...current.reference_value_ids, elementInstanceId],
    }));

  const shownValues = useMemo(() => {
    const needle = valueSearch.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((value) => value.value_name.toLowerCase().includes(needle));
  }, [candidates, valueSearch]);

  /**
   * Ask the server whether the script is allowed.
   *
   * The same check runs again on save, so this is about seeing the mistake
   * while still looking at the line that caused it, not about trusting the
   * browser: the server is the one that refuses.
   */
  const checkScript = async (script: string) => {
    if (!script.trim()) {
      setValidation(null);
      return null;
    }
    setChecking(true);
    try {
      const report = await onValidateScript(script);
      setValidation(report);
      return report;
    } catch {
      setValidation(null);
      return null;
    } finally {
      setChecking(false);
    }
  };

  const selectedCheck = useMemo(
    () => catalogue?.check_types.find((c) => c.check_type === draft.check_type),
    [catalogue, draft.check_type],
  );

  const parameterSpecs: RuleParameterSpec[] = useMemo(() => {
    if (!catalogue) return [];
    if (draft.definition_kind === "python") {
      // A script names its own parameters, so only the shared ones are offered
      // as fields; the rest are typed in the parameters box.
      return catalogue.shared_parameters ?? [];
    }
    if (!selectedCheck) return [];
    // The check's own parameters first, then the shared ones it accepts:
    // ignoring values means nothing to a check that reads whole records.
    const shared = (catalogue.shared_parameters ?? []).filter((spec) =>
      (selectedCheck.shared ?? []).includes(spec.name),
    );
    // The approved list is not typed here. It is ticked from a governed
    // vocabulary below, which is the only list the run ever reads.
    const own = REFERENCE_DEPENDENT_CHECKS.includes(selectedCheck.check_type)
      ? selectedCheck.parameters.filter((spec) => spec.name !== VALUES_PARAMETER)
      : selectedCheck.parameters;
    return [...own, ...shared];
  }, [catalogue, selectedCheck, draft.definition_kind]);

  const executionScope = (catalogue?.execution_scopes ?? []).find(
    (item) => item.key === draft.execution_scope,
  );

  const patch = (change: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...change }));
  const patchParameter = (name: string, value: string) =>
    setDraft((current) => ({ ...current, parameters: { ...current.parameters, [name]: value } }));

  const nameError = touched && !draft.name.trim() ? "Give the rule a name." : "";
  const categoryError = touched && !draft.category.trim() ? "Choose or type a category." : "";
  const missing = parameterSpecs
    .filter((spec) => spec.required && !(draft.parameters[spec.name] ?? "").trim())
    .map((spec) => spec.label);
  if (readsVocabulary && !draft.reference_element_type_id) {
    missing.push("Approved values come from");
  }
  // A rule that approves nothing would fail every row it ever saw. That is not
  // governance, it is a half-finished sentence, so it is refused here rather
  // than discovered in a quality run against 134,000 rows.
  const approvesNothing =
    readsVocabulary &&
    Boolean(draft.reference_element_type_id) &&
    candidates.length > 0 &&
    draft.reference_value_ids.length === 0;

  /** The parameters as they will be saved — also what the self-test judges. */
  const buildParameters = (): RuleParameters => {
    const parameters: RuleParameters = {};
    for (const spec of parameterSpecs) {
      const raw = (draft.parameters[spec.name] ?? "").trim();
      if (!raw) continue;
      if (spec.kind === "list") parameters[spec.name] = splitList(raw);
      else if (spec.kind === "number") parameters[spec.name] = Number(raw);
      else parameters[spec.name] = raw;
    }
    return parameters;
  };

  const runExamples = async () => {
    setTesting(true);
    try {
      setExamples(await onTestExamples({
        check_type: draft.check_type,
        parameters: buildParameters(),
        examples_pass: splitList(draft.examples_pass),
        examples_fail: splitList(draft.examples_fail),
      }));
    } catch {
      setExamples(null);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setTouched(true);
    if (!draft.name.trim() || !draft.category.trim() || missing.length > 0) return;
    if (approvesNothing) return;
    // Never save a list the author has not been shown. Until the vocabulary's
    // values have loaded, the ticks on screen are not yet the rule's answer,
    // and writing them would change what the rule accepts behind their back.
    if (readsVocabulary && draft.reference_element_type_id && !vocabularyValues.data) return;
    if (isScript) {
      const report = validation ?? (await checkScript(draft.script));
      if (!report || !report.ok) return;
    }

    const parameters: RuleParameters = isScript ? parseScriptParams(scriptParams) : buildParameters();
    onSave({
      name: draft.name.trim(),
      description: draft.description.trim(),
      category: draft.category.trim(),
      dimension: draft.dimension,
      data_type: draft.data_type,
      execution_scope: draft.execution_scope,
      rationale: draft.rationale.trim(),
      reference: draft.reference.trim(),
      message_template: draft.message_template.trim(),
      examples_pass: splitList(draft.examples_pass),
      examples_fail: splitList(draft.examples_fail),
      owner: draft.owner.trim(),
      definition_kind: draft.definition_kind,
      check_type: isScript ? "" : draft.check_type,
      script: isScript ? draft.script : "",
      parameters,
      severity: draft.severity,
      status: draft.status,
      // Saved with the rule, in the same call. The vocabulary and the values
      // ticked are what the rule checks against, so they are part of writing
      // it rather than a second screen somebody has to remember.
      reference_element_type_id: readsVocabulary ? draft.reference_element_type_id : "",
      reference_value_ids: readsVocabulary ? draft.reference_value_ids : [],
      governs_values: true,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{rule ? "Edit Rule" : "New Rule"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            fullWidth
            label="Rule name"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            error={!!nameError}
            helperText={nameError}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Description"
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              select
              sx={{ flex: 1, minWidth: 190 }}
              label="Quality dimension"
              value={draft.dimension}
              onChange={(e) => patch({ dimension: e.target.value })}
              helperText={(catalogue?.dimensions ?? []).find((d) => d.key === draft.dimension)?.detail}
            >
              {(catalogue?.dimensions ?? []).map((item) => (
                <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              sx={{ flex: 1, minWidth: 190 }}
              label="Applies to"
              value={draft.data_type}
              onChange={(e) => patch({ data_type: e.target.value })}
              helperText="Which fields this rule is offered for when mapping."
            >
              {(catalogue?.data_types ?? []).map((item) => (
                <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
              ))}
            </TextField>
          </Stack>

          {/* What the rule needs in order to run — a different question from
              which field it is offered for. A governed rule may need execution
              this platform does not have yet; saying so keeps it in the
              catalogue and out of the pickers, instead of it being quietly
              absent and looking like an oversight. */}
          <TextField
            select
            fullWidth
            label="Execution scope"
            value={draft.execution_scope}
            onChange={(e) => patch({ execution_scope: e.target.value })}
            helperText={
              executionScope
                ? executionScope.executable
                  ? executionScope.detail
                  : `${executionScope.detail} The engine cannot run this yet, so the rule is listed and marked rather than offered.`
                : "Whatever this check normally needs."
            }
          >
            <MenuItem value="">Whatever this check normally needs</MenuItem>
            {(catalogue?.execution_scopes ?? []).map((item) => (
              <MenuItem key={item.key} value={item.key}>
                {item.label}
                {!item.executable && " — not executable yet"}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={2}>
            {/* Free text, with what the library already uses as suggestions:
                the team decides how its rules are grouped, not us. */}
            <Autocomplete
              freeSolo
              fullWidth
              options={catalogue?.categories ?? []}
              value={draft.category}
              onChange={(_e, value) => patch({ category: value ?? "" })}
              onInputChange={(_e, value) => patch({ category: value })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Category"
                  error={!!categoryError}
                  helperText={categoryError || "Type a new one, or pick one already in use."}
                />
              )}
            />
            <TextField
              select
              fullWidth
              label="Severity"
              value={draft.severity}
              onChange={(e) => patch({ severity: e.target.value })}
            >
              {(catalogue?.severities ?? []).map((item) => (
                <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
              ))}
            </TextField>
          </Stack>

          {/* How the rule is written. Switching keeps the name and description:
              only the definition below them changes. */}
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs
              value={draft.definition_kind}
              onChange={(_e, value) => patch({ definition_kind: value, parameters: {} })}
            >
              {(catalogue?.definition_kinds ?? []).map((kind) => (
                <Tab key={kind.key} value={kind.key} label={kind.label} sx={{ textTransform: "none" }} />
              ))}
            </Tabs>
          </Box>

          {isScript ? (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
                  Write the body of the check and end with <code>return</code>. It runs once per row.
                </Typography>
                {!draft.script.trim() && (
                  <Button size="small" sx={{ textTransform: "none" }}
                          onClick={() => patch({ script: catalogue?.python.template ?? "" })}>
                    Start from an example
                  </Button>
                )}
                <Button size="small" variant="outlined" sx={{ textTransform: "none" }}
                        disabled={checking || !draft.script.trim()}
                        onClick={() => void checkScript(draft.script)}>
                  {checking ? "Checking…" : "Check script"}
                </Button>
              </Stack>

              <TextField
                fullWidth
                multiline
                minRows={8}
                value={draft.script}
                placeholder={catalogue?.python.template}
                onChange={(e) => { patch({ script: e.target.value }); setValidation(null); }}
                onBlur={() => void checkScript(draft.script)}
                spellCheck={false}
                InputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13 } }}
              />

              {validation && !validation.ok && validation.errors.map((err, index) => (
                <Alert severity="error" key={index}>
                  Line {err.line}, column {err.column + 1}: {err.message}
                </Alert>
              ))}
              {validation?.ok && (
                <Alert severity="success">
                  The script is valid.
                  {validation.row_fields.length > 0 && ` It also reads ${validation.row_fields.join(", ")}.`}
                  {validation.param_names.length > 0 && ` It expects ${validation.param_names.join(", ")} below.`}
                </Alert>
              )}

              <Box sx={{ p: 2, borderRadius: 1, bgcolor: "action.hover", display: "grid", gap: 1 }}>
                <Typography variant="caption" fontWeight={700}>What the script is given</Typography>
                {(catalogue?.python.context ?? []).map((item) => (
                  <Typography variant="caption" color="text.secondary" key={item.name}>
                    <code>{item.name}</code> — {item.detail}
                  </Typography>
                ))}
                <Typography variant="caption" fontWeight={700} sx={{ mt: 0.5 }}>Helpers</Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {(catalogue?.python.helpers ?? []).map((helper) => (
                    <Chip key={helper.signature} size="small" variant="outlined" label={helper.signature}
                          title={helper.detail}
                          sx={{ height: 20, fontSize: "0.65rem", fontFamily: "ui-monospace, monospace" }} />
                  ))}
                </Stack>
              </Box>

              <TextField
                fullWidth
                multiline
                minRows={2}
                size="small"
                label="Parameters (optional)"
                value={scriptParams}
                onChange={(e) => setScriptParams(e.target.value)}
                placeholder={"min = 5\nallowed = Wood, Metal"}
                helperText={catalogue?.python.params_help}
                InputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13 } }}
              />
            </Stack>
          ) : (
            <TextField
              select
              fullWidth
              label="Checks that"
              value={draft.check_type}
              // Parameters belong to the check, so a different check starts with
              // an empty set rather than the previous check's leftovers.
              onChange={(e) => patch({ check_type: e.target.value, parameters: {} })}
              helperText={selectedCheck?.summary}
            >
              {(catalogue?.check_types ?? []).map((item) => (
                <MenuItem key={item.check_type} value={item.check_type}>{item.label}</MenuItem>
              ))}
            </TextField>
          )}

          {parameterSpecs.length > 0 && (
            <Box sx={{ display: "grid", gap: 2, p: 2, borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="caption" fontWeight={700}>What this check needs</Typography>
              {parameterSpecs.map((spec) =>
                spec.kind === "select" ? (
                  <TextField
                    key={spec.name}
                    select
                    fullWidth
                    size="small"
                    label={spec.label}
                    value={draft.parameters[spec.name] ?? ""}
                    onChange={(e) => patchParameter(spec.name, e.target.value)}
                    helperText={spec.help}
                  >
                    {(spec.options ?? []).map((option) => (
                      <MenuItem key={option.key} value={option.key}>{option.label}</MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <TextField
                    key={spec.name}
                    fullWidth
                    size="small"
                    type={spec.kind === "number" ? "number" : "text"}
                    label={spec.label + (spec.required ? "" : " (optional)")}
                    value={draft.parameters[spec.name] ?? ""}
                    onChange={(e) => patchParameter(spec.name, e.target.value)}
                    placeholder={spec.kind === "list" ? "Metal, Wood, Plastic" : undefined}
                    helperText={spec.help}
                  />
                ),
              )}
            </Box>
          )}

          {readsVocabulary && (
            <Box sx={{ display: "grid", gap: 1.5, p: 2, borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="caption" fontWeight={700}>
                What this rule accepts
              </Typography>
              <Typography variant="caption" color="text.secondary">
                The approved list comes from a governed vocabulary, so adding a value there
                changes every rule that reads it. Tick the ones this rule accepts — those,
                and only those, are what the quality run checks against.
              </Typography>

              <TextField
                select
                fullWidth
                size="small"
                label="Approved values come from"
                value={draft.reference_element_type_id}
                onChange={(e) => {
                  setSeededFor(null);
                  setValueSearch("");
                  patch({ reference_element_type_id: e.target.value, reference_value_ids: [] });
                }}
                error={touched && !draft.reference_element_type_id}
                helperText={
                  vocabularies.isLoading
                    ? "Loading governed vocabularies…"
                    : (vocabularies.data?.items ?? []).length === 0
                      ? "No governed vocabulary exists yet. Create one in a Support Domain model first."
                      : "A Support Domain or cross-model vocabulary."
                }
              >
                <MenuItem value="">Choose a vocabulary…</MenuItem>
                {(vocabularies.data?.items ?? []).map((vocabulary: Vocabulary) => (
                  <MenuItem key={vocabulary.element_id} value={vocabulary.element_id}>
                    {vocabulary.model_name} · {vocabulary.name} ({vocabulary.value_count})
                  </MenuItem>
                ))}
              </TextField>

              {draft.reference_element_type_id && (
                vocabularyValues.isLoading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                    <CircularProgress size={18} />
                  </Box>
                ) : candidates.length === 0 ? (
                  <Alert severity="warning" sx={{ py: 0.25 }}>
                    That vocabulary holds no active values, so this rule would accept nothing.
                    Add its values in the Support Domain model first.
                  </Alert>
                ) : (
                  <>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 140 }}>
                        {draft.reference_value_ids.length} of {candidates.length} approved
                      </Typography>
                      <Link
                        component="button"
                        type="button"
                        variant="caption"
                        underline="hover"
                        onClick={() =>
                          patch({
                            reference_value_ids: candidates.map((v) => v.element_instance_id),
                          })
                        }
                      >
                        Select all
                      </Link>
                      <Link
                        component="button"
                        type="button"
                        variant="caption"
                        underline="hover"
                        onClick={() => patch({ reference_value_ids: [] })}
                      >
                        Clear
                      </Link>
                    </Stack>
                    {candidates.length > 8 && (
                      <TextField
                        size="small"
                        placeholder="Find a value…"
                        value={valueSearch}
                        onChange={(e) => setValueSearch(e.target.value)}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <SearchIcon fontSize="small" />
                            </InputAdornment>
                          ),
                        }}
                      />
                    )}
                    <Box
                      sx={{
                        maxHeight: 240,
                        overflow: "auto",
                        border: 1,
                        borderColor: "divider",
                        borderRadius: 1,
                        bgcolor: "background.paper",
                      }}
                    >
                      {shownValues.map((value) => (
                        <Stack
                          key={value.element_instance_id}
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          sx={{ px: 1, py: 0.25, borderBottom: 1, borderColor: "divider" }}
                        >
                          <Checkbox
                            size="small"
                            checked={draft.reference_value_ids.includes(value.element_instance_id)}
                            onChange={() => toggleValue(value.element_instance_id)}
                          />
                          <Typography variant="body2">{value.value_name}</Typography>
                        </Stack>
                      ))}
                      {shownValues.length === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: "block" }}>
                          No value matches “{valueSearch}”.
                        </Typography>
                      )}
                    </Box>
                    {approvesNothing && (
                      <Alert severity="warning" sx={{ py: 0.25 }}>
                        Nothing is ticked, so this rule would reject every row. Tick the values
                        it accepts.
                      </Alert>
                    )}
                  </>
                )
              )}
            </Box>
          )}

          <Box sx={{ p: 2, borderRadius: 1, border: 1, borderColor: "divider", display: "grid", gap: 2 }}>
            <Typography variant="caption" fontWeight={700}>Why this rule exists</Typography>
            <TextField
              fullWidth multiline minRows={2} size="small" label="Rationale"
              value={draft.rationale}
              onChange={(e) => patch({ rationale: e.target.value })}
              helperText="What goes wrong downstream when this is not true. Read months later by someone who was not here."
            />
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <TextField
                size="small" sx={{ flex: 1, minWidth: 200 }} label="Standard or policy"
                value={draft.reference}
                onChange={(e) => patch({ reference: e.target.value })}
                placeholder="e.g. Fusion data standard §4.2"
              />
              <TextField
                size="small" sx={{ flex: 1, minWidth: 180 }} label="Owner"
                value={draft.owner}
                onChange={(e) => patch({ owner: e.target.value })}
                placeholder="Who answers for it"
              />
            </Stack>
            <TextField
              fullWidth size="small" label="Message when a row fails"
              value={draft.message_template}
              onChange={(e) => patch({ message_template: e.target.value })}
              placeholder="{field} must be outdoor, indoor or both — found {value}."
              helperText="Shown against every failing row. {field} and {value} are filled in."
            />
          </Box>

          {!isScript && (
            <Box sx={{ p: 2, borderRadius: 1, border: 1, borderColor: "divider", display: "grid", gap: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="caption" fontWeight={700} sx={{ flex: 1, minWidth: 180 }}>
                  Worked examples
                </Typography>
                <Button size="small" variant="outlined" sx={{ textTransform: "none" }}
                        disabled={testing || (!draft.examples_pass.trim() && !draft.examples_fail.trim())}
                        onClick={() => void runExamples()}>
                  {testing ? "Testing…" : "Test the rule"}
                </Button>
              </Stack>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <TextField
                  size="small" sx={{ flex: 1, minWidth: 200 }} label="Should pass"
                  value={draft.examples_pass}
                  onChange={(e) => { patch({ examples_pass: e.target.value }); setExamples(null); }}
                  placeholder="outdoor, indoor"
                />
                <TextField
                  size="small" sx={{ flex: 1, minWidth: 200 }} label="Should fail"
                  value={draft.examples_fail}
                  onChange={(e) => { patch({ examples_fail: e.target.value }); setExamples(null); }}
                  placeholder="Sf6, 12"
                />
              </Stack>
              {examples && !examples.testable && (
                <Alert severity="info">
                  This check reads the whole column, so a single value cannot be judged. The examples
                  are kept as documentation.
                </Alert>
              )}
              {examples && examples.testable && (
                <Alert severity={examples.disagreements === 0 ? "success" : "warning"}>
                  {examples.disagreements === 0
                    ? `The rule agrees with all ${examples.checked} examples.`
                    : `${examples.disagreements} of ${examples.checked} examples disagree with the rule:`}
                  {examples.results.filter((r) => !r.agrees).map((r) => (
                    <Typography variant="caption" component="div" key={r.value}>
                      “{r.value}” was expected to {r.expected} but the rule says {r.verdict} — {r.reason}
                    </Typography>
                  ))}
                </Alert>
              )}
            </Box>
          )}

          <TextField
            select
            fullWidth
            label="Status"
            value={draft.status}
            onChange={(e) => patch({ status: e.target.value })}
            helperText="A rule can be written now and made active once it has been reviewed."
          >
            {(catalogue?.statuses ?? []).map((item) => (
              <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
            ))}
          </TextField>

          {touched && missing.length > 0 && (
            <Alert severity="info">Still to fill in: {missing.join(", ")}.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || checking || (isScript && validation !== null && !validation.ok)}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {rule ? "Save changes" : "Create rule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
