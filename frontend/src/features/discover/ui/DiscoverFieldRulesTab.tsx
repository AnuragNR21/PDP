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
  FormControlLabel,
  InputAdornment,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import TableRowsOutlinedIcon from "@mui/icons-material/TableRowsOutlined";
import { Link } from "react-router-dom";
import {
  discoverApi,
  type FieldRuleReport,
  type LibraryRuleOffer,
} from "@/features/discover/api/discoverApi";

const SEVERITY_COLOR: Record<string, "info" | "warning" | "error"> = {
  low: "info",
  medium: "warning",
  high: "error",
};

const DIMENSION_LABEL: Record<string, string> = {
  completeness: "Completeness",
  validity: "Validity",
  uniqueness: "Uniqueness",
  consistency: "Consistency",
  accuracy: "Accuracy",
  timeliness: "Timeliness",
};

const FIELD_KIND_LABEL: Record<string, string> = {
  any: "any field",
  text: "text",
  number: "number",
  date: "date",
  record: "whole record",
};

/** The record-level picker sits in the same list as the fields, under this id. */
const RECORD_TARGET = "__record__";

const readError = (err: unknown, fallback: string): string => {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail ?? (err instanceof Error ? err.message : fallback);
};

/**
 * Choosing which rules apply to which field.
 *
 * One field at a time, on purpose. Showing every field's rules at once meant a
 * page that grew with the library, re-rendered on every tick and threw the
 * reader back to the top; here the left column is the work list and the right
 * pane is the one field being decided, so a tick changes a checkbox and
 * nothing else moves.
 *
 * Nothing is authored here. A rule already says what it checks, what it
 * tolerates and what it ignores, so the only question left is where it applies.
 */
export function DiscoverFieldRulesTab({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [tab, setTab] = useState<"available" | "chosen">("available");
  const [search, setSearch] = useState("");
  /** Off by default: the whole library is shown, matching the Rule Workspace. */
  const [onlySuited, setOnlySuited] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** What is ticked right now, ahead of the server. */
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const fieldsQuery = useQuery({
    queryKey: ["discover", "fieldRules", sessionId],
    queryFn: () => discoverApi.listFieldRules(sessionId),
    enabled: sessionId.length > 0,
  });

  const report: FieldRuleReport | undefined = fieldsQuery.data;

  // The server's answer seeds the local selection, and re-seeds whenever that
  // answer is a different one. After that the local copy leads, so a tick is
  // instant and the list never re-orders.
  //
  // The signature used to be the session plus the number of fields, which is
  // the same for two different tables of the same width: map one table, map
  // another, and the second table's rules were shown against the first one's
  // ticks. It now names the fields themselves.
  const seeded = useRef("");
  useEffect(() => {
    const signature =
      report &&
      [report.session_id, ...report.fields.map((f) => `${f.column_id}:${f.chosen_ids.join(",")}`)].join("|");
    if (!report || seeded.current === signature) return;
    seeded.current = signature ?? "";
    const next: Record<string, string[]> = { [RECORD_TARGET]: report.record_chosen_ids };
    for (const field of report.fields) next[field.column_id] = field.chosen_ids;
    setChosen(next);
    // Keep the field being worked on when it is still in the list; otherwise
    // fall back to the first one, so the pane is never pointed at nothing.
    setTargetId((current) =>
      current === RECORD_TARGET || report.fields.some((f) => f.column_id === current)
        ? current
        : report.fields[0]?.column_id ?? RECORD_TARGET,
    );
  }, [report]);

  const save = useMutation({
    mutationFn: ({ target, ids }: { target: string; ids: string[] }) =>
      target === RECORD_TARGET
        ? discoverApi.setRecordRules(sessionId, ids)
        : discoverApi.setFieldRules(sessionId, target, ids),
    onSuccess: () => {
      // The session's rules changed, so anything reporting them is stale. The
      // picker itself is not refetched: the local selection is already right,
      // and replacing it mid-work is what used to throw the page around.
      void queryClient.invalidateQueries({ queryKey: ["discover", "governedRules", sessionId] });
    },
  });

  const toggle = async (target: string, ruleId: string) => {
    setError(null);
    const current = chosen[target] ?? [];
    const next = current.includes(ruleId)
      ? current.filter((id) => id !== ruleId)
      : [...current, ruleId];
    setChosen((state) => ({ ...state, [target]: next }));
    setSaving((state) => ({ ...state, [target]: true }));
    try {
      await save.mutateAsync({ target, ids: next });
    } catch (err) {
      // Put the tick back rather than leaving the screen claiming something
      // the session does not hold.
      setChosen((state) => ({ ...state, [target]: current }));
      setError(readError(err, "Could not change the rules on this field."));
    } finally {
      setSaving((state) => ({ ...state, [target]: false }));
    }
  };

  const targets = useMemo(() => {
    if (!report) return [];
    const list = report.fields.map((field) => ({
      id: field.column_id,
      name: field.column_name,
      detail: field.target_name ?? "—",
      data_type: field.data_type,
      rules: field.rules,
      table: field.table_name,
    }));
    if (report.record_rules.length > 0) {
      list.push({
        id: RECORD_TARGET,
        name: "Across the whole record",
        detail: "Reads every mapped field together",
        data_type: "record",
        rules: report.record_rules,
        table: "",
      });
    }
    return list;
  }, [report]);

  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const chosenIds = chosen[target?.id ?? ""] ?? [];

  const visible = useMemo(() => {
    if (!target) return [];
    const needle = search.trim().toLowerCase();
    return target.rules
      .filter((rule) => (tab === "chosen" ? chosenIds.includes(rule.rule_definition_id) : true))
      // A rule already chosen stays visible whatever the narrowing says, so a
      // tick can always be undone where it was made.
      .filter(
        (rule) =>
          !onlySuited ||
          rule.applicability.state === "applicable" ||
          rule.applicability.state === "compatible" ||
          chosenIds.includes(rule.rule_definition_id),
      )
      .filter((rule) =>
        !needle ||
        rule.name.toLowerCase().includes(needle) ||
        rule.code.toLowerCase().includes(needle) ||
        rule.category.toLowerCase().includes(needle) ||
        rule.statement.toLowerCase().includes(needle),
      );
  }, [target, tab, chosenIds, search, onlySuited]);

  // Grouped by the library's own categories, in the library's own order, so a
  // rule sits in the same place here as it does in the Rule Workspace. Within
  // a category the ones written for this kind of field come first; that order
  // is fixed by the rule and the field, never by what is ticked, so nothing
  // moves while a person works down the list.
  const groups = useMemo(() => {
    const order = report?.categories ?? [];
    const byCategory = new Map<string, LibraryRuleOffer[]>();
    for (const rule of visible) {
      const key = rule.category || "Uncategorised";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(rule);
    }
    return [...byCategory.entries()]
      .sort((a, b) => {
        const rank = (key: string) => {
          const at = order.indexOf(key);
          return at === -1 ? order.length : at;
        };
        return rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]);
      })
      .map(([key, rules]) => ({
        key,
        label: key,
        // Applicable first, then compatible, mismatch, and the ones that
        // cannot run at all. Fixed by the rule and the field, never by what
        // is ticked, so nothing moves while a person works down the list.
        rules: [...rules].sort(
          (a, b) =>
            (APPLICABILITY_RANK[a.applicability.state] ?? 9) -
            (APPLICABILITY_RANK[b.applicability.state] ?? 9),
        ),
      }));
  }, [visible, report]);

  if (fieldsQuery.isLoading) {
    return <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={24} /></Stack>;
  }

  if (fieldsQuery.isError) {
    return (
      <Alert severity="error" action={
        <Button size="small" onClick={() => void fieldsQuery.refetch()} sx={{ textTransform: "none" }}>
          Try again
        </Button>
      }>
        Could not load this session's fields.
      </Alert>
    );
  }

  if (!report || report.fields.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 1.5 }}>
          <AccountTreeOutlinedIcon sx={{ fontSize: 44, color: "text.disabled" }} />
          <Typography variant="h6" fontWeight={700}>Map your fields first</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
            A rule is chosen for a field, so there is nothing to choose for yet. Pair your columns
            with model fields on the Mapping step.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const totalChosen = Object.values(chosen).reduce((sum, ids) => sum + ids.length, 0);

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" alignItems="center" spacing={1}>
          <GavelOutlinedIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>Choose the rules for each field</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Every field you have mapped{report && report.tables.length > 1
            ? `, across all ${report.tables.length} mapped tables,`
            : ""}{" "}
          is listed here with every rule in the Rule Workspace, grouped by category. Tick the ones
          that apply — there is nothing else to fill in, and the run happens on the next step.
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" sx={{ fontWeight: 600 }}
              label={`${totalChosen} rule${totalChosen === 1 ? "" : "s"} chosen`} />
        {report.not_runnable.length > 0 && (
          <Tooltip title={report.not_runnable.map((r) => `${r.name} — ${r.reason}`).join("\n")}>
            <Chip size="small" variant="outlined" color="info"
                  label={`${report.not_runnable.length} rule${report.not_runnable.length === 1 ? "" : "s"} the engine cannot run yet`} />
          </Tooltip>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button component={Link} to="/rules" size="small" endIcon={<OpenInNewIcon />} sx={{ textTransform: "none" }}>
          Write a new rule
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="stretch">
        {/* The work list: every field, and how many rules it holds. */}
        <Card variant="outlined" sx={{ width: { xs: "100%", md: 300 }, flexShrink: 0 }}>
          <Box sx={{ maxHeight: 520, overflowY: "auto" }}>
            {targets.map((item, index) => {
              const count = (chosen[item.id] ?? []).length;
              const active = item.id === target?.id;
              // A session maps several tables, so the list says which table
              // each run of fields belongs to. Without it, two tables with a
              // column called "ID" are two identical rows.
              const startsTable = item.table !== "" && item.table !== targets[index - 1]?.table;
              return (
                <Box key={item.id}>
                {startsTable && (
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    noWrap
                    sx={{
                      display: "block", px: 1.5, py: 0.75,
                      bgcolor: "action.hover", borderBottom: 1, borderColor: "divider",
                      color: "text.secondary",
                    }}
                  >
                    {item.table}
                  </Typography>
                )}
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  onClick={() => { setTargetId(item.id); setSearch(""); setTab("available"); }}
                  sx={{
                    px: 1.5, py: 1.25, cursor: "pointer",
                    borderLeft: 3,
                    borderLeftColor: active ? "primary.main" : "transparent",
                    borderBottom: 1, borderBottomColor: "divider",
                    bgcolor: active ? "action.selected" : "transparent",
                    "&:hover": { bgcolor: active ? "action.selected" : "action.hover" },
                  }}
                >
                  {item.id === RECORD_TARGET && <TableRowsOutlinedIcon fontSize="small" color="action" />}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={active ? 700 : 500} noWrap>
                      {item.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {item.detail}
                    </Typography>
                  </Box>
                  {saving[item.id] ? (
                    <CircularProgress size={13} />
                  ) : (
                    <Chip size="small" color={count ? "primary" : "default"} label={count}
                          sx={{ height: 20, minWidth: 28, fontSize: "0.65rem" }} />
                  )}
                </Stack>
                </Box>
              );
            })}
          </Box>
        </Card>

        {/* The one field being decided. */}
        <Card variant="outlined" sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ px: 2, pt: 1.5 }}>
            <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle1" fontWeight={700}>{target?.name}</Typography>
              <Chip size="small" variant="outlined" label={target?.data_type}
                    sx={{ height: 20, fontSize: "0.65rem" }} />
              {target?.table && (
                <Chip size="small" variant="outlined" color="info" label={target.table}
                      sx={{ height: 20, fontSize: "0.65rem", maxWidth: 260 }} />
              )}
              <Typography variant="caption" color="text.secondary">{target?.detail}</Typography>
            </Stack>
          </Box>

          <Tabs
            value={tab}
            onChange={(_e, value) => setTab(value)}
            sx={{ px: 2, borderBottom: 1, borderColor: "divider", minHeight: 40 }}
          >
            <Tab value="available" label={`All rules (${target?.rules.length ?? 0})`}
                 sx={{ textTransform: "none", minHeight: 40 }} />
            <Tab value="chosen" label={`Chosen (${chosenIds.length})`}
                 sx={{ textTransform: "none", minHeight: 40 }} />
          </Tabs>

          <Box sx={{ px: 2, pt: 1.5 }}>
            <TextField
              size="small" fullWidth placeholder="Search rules, or a category…"
              value={search} onChange={(e) => setSearch(e.target.value)}
              InputProps={{ startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ) }}
            />
            {target?.id !== RECORD_TARGET && (
              <FormControlLabel
                sx={{ mt: 0.5, ml: 0 }}
                control={
                  <Checkbox size="small" checked={onlySuited}
                            onChange={(e) => setOnlySuited(e.target.checked)} sx={{ p: 0.5, mr: 0.5 }} />
                }
                label={
                  <Typography variant="caption" color="text.secondary">
                    Only rules written for {FIELD_KIND_LABEL[target?.data_type ?? "text"] ?? target?.data_type} fields
                  </Typography>
                }
              />
            )}
          </Box>

          <Box sx={{ maxHeight: 440, overflowY: "auto", px: 2, py: 1.5 }}>
            {groups.length === 0 ? (
              <Alert severity="info">
                {tab === "chosen"
                  ? "No rule chosen for this field yet. Pick one under “All rules”."
                  : search
                    ? `No rule matches “${search}”.`
                    : onlySuited
                      ? "No rule in the library was written for this kind of field. Untick the filter to see them all."
                      : "The rule library is empty. Write a rule in the Rule Workspace first."}
              </Alert>
            ) : (
              groups.map((group) => {
                const open = !collapsed[group.key];
                const chosenHere = group.rules.filter((r) => chosenIds.includes(r.rule_definition_id)).length;
                return (
                  <Box key={group.key} sx={{ mb: 1 }}>
                    <Stack
                      direction="row" alignItems="center" spacing={1}
                      onClick={() => setCollapsed((state) => ({ ...state, [group.key]: open }))}
                      sx={{
                        cursor: "pointer", px: 1, py: 0.75, borderRadius: 1,
                        border: 1, borderColor: "divider", bgcolor: "action.hover",
                      }}
                    >
                      <ExpandMoreIcon fontSize="small" sx={{
                        transform: open ? "none" : "rotate(-90deg)", transition: "0.2s", color: "text.secondary",
                      }} />
                      <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>{group.label}</Typography>
                      {chosenHere > 0 && (
                        <Chip size="small" color="primary" label={`${chosenHere} chosen`}
                              sx={{ height: 17, fontSize: "0.6rem" }} />
                      )}
                      <Typography variant="caption" color="text.secondary">{group.rules.length}</Typography>
                    </Stack>
                    <Collapse in={open} unmountOnExit>
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {group.rules.map((rule) => (
                          <RuleChoice
                            key={rule.rule_definition_id}
                            rule={rule}
                            checked={chosenIds.includes(rule.rule_definition_id)}
                            onToggle={() => void toggle(target!.id, rule.rule_definition_id)}
                          />
                        ))}
                      </Stack>
                    </Collapse>
                  </Box>
                );
              })
            )}
          </Box>
        </Card>
      </Stack>
    </Stack>
  );
}

/**
 * How each of the four states looks, and the order they sort in.
 *
 * `applicable` carries no chip: it is the ordinary case, and a badge on every
 * row is a badge that says nothing.
 */
const APPLICABILITY_CHIP: Record<
  string,
  { label: string; color: "warning" | "default" | "error"; show: boolean }
> = {
  applicable: { label: "Applicable", color: "default", show: false },
  compatible: { label: "Any field", color: "default", show: true },
  mismatch: { label: "Mismatch", color: "warning", show: true },
  not_executable: { label: "Not executable", color: "error", show: true },
};

/** Applicable first, then compatible, mismatch, and what cannot run at all. */
const APPLICABILITY_RANK: Record<string, number> = {
  applicable: 0,
  compatible: 1,
  mismatch: 2,
  not_executable: 3,
};

function RuleChoice({
  rule,
  checked,
  onToggle,
}: {
  rule: LibraryRuleOffer;
  checked: boolean;
  onToggle: () => void;
}) {
  const blocked = !!rule.blocked_reason && !checked;
  const row = (
    <Stack
      direction="row"
      alignItems="flex-start"
      spacing={1}
      onClick={blocked ? undefined : onToggle}
      sx={{
        px: 1, py: 0.75, borderRadius: 1, cursor: blocked ? "not-allowed" : "pointer",
        border: 1, borderColor: checked ? "primary.main" : "divider",
        bgcolor: checked ? "action.hover" : "transparent",
        opacity: blocked ? 0.55 : 1,
      }}
    >
      {/* The row toggles, so the box must not toggle again on its own. */}
      <Checkbox size="small" checked={checked} disabled={blocked} onChange={onToggle}
                onClick={(e) => e.stopPropagation()} sx={{ p: 0.5 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap">
          <Typography variant="caption" sx={{ fontFamily: "ui-monospace, monospace", color: "text.secondary" }}>
            {rule.code}
          </Typography>
          <Typography variant="body2" fontWeight={600}>{rule.name}</Typography>
          <Chip size="small" variant="outlined" color={SEVERITY_COLOR[rule.severity] ?? "default"}
                label={rule.severity} sx={{ height: 17, fontSize: "0.6rem" }} />
          {rule.dimension && (
            <Chip size="small" variant="outlined" label={DIMENSION_LABEL[rule.dimension] ?? rule.dimension}
                  sx={{ height: 17, fontSize: "0.6rem" }} />
          )}
          {/* Governance's verdict, said plainly and never used to hide the
              rule. A mismatch is still yours to choose — the profiler's
              guess at a type is often the thing that is wrong, not the
              rule. */}
          {APPLICABILITY_CHIP[rule.applicability.state]?.show && (
            <Tooltip title={rule.applicability.reason}>
              <Chip
                size="small"
                variant="outlined"
                color={APPLICABILITY_CHIP[rule.applicability.state].color}
                label={
                  rule.applicability.state === "mismatch"
                    ? `written for ${FIELD_KIND_LABEL[rule.data_type] ?? rule.data_type} fields`
                    : APPLICABILITY_CHIP[rule.applicability.state].label
                }
                sx={{ height: 17, fontSize: "0.6rem" }}
              />
            </Tooltip>
          )}
          {/* Only worth naming when it is the thing stopping the rule. */}
          {rule.applicability.state === "not_executable" && rule.execution_scope_label && (
            <Chip size="small" variant="outlined"
                  label={rule.execution_scope_label}
                  sx={{ height: 17, fontSize: "0.6rem" }} />
          )}
        </Stack>
        <Tooltip title={rule.rationale || rule.description || ""}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {rule.statement}
          </Typography>
        </Tooltip>
        {rule.blocked_reason && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
            {rule.blocked_reason}
          </Typography>
        )}
      </Box>
    </Stack>
  );
  return blocked ? <Tooltip title={rule.blocked_reason}><Box>{row}</Box></Tooltip> : row;
}
