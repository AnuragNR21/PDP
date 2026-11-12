import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { useQuery } from "@tanstack/react-query";
import { useRulesWorkspace } from "@/features/rules/state/useRulesWorkspace";
import {
  downloadCsv,
  rulesApi,
  type RuleDefinition,
  type RuleImportPlan,
  type RuleImportReport,
  type SaveRulePayload,
} from "@/features/rules/api/rulesApi";
import { RuleVersionHistoryDialog } from "@/features/rules/ui/RuleVersionHistoryDialog";
import { RuleImportDialog } from "@/features/rules/ui/RuleImportDialog";
import { RuleCodePrefixDialog } from "@/features/rules/ui/RuleCodePrefixDialog";
import { CreateEditRuleDialog } from "./CreateEditRuleDialog";
import { SidePanel } from "@/shared/workspace/SidePanel";
import { scrollToMarked, useFocusParam } from "@/shared/workspace/useFocusParam";
import { AuthoringPanel, useStoredFlag } from "@/shared/workspace/WorkspacePanels";
import { HeaderChip, WorkspaceHeaderCard } from "@/shared/workspace/WorkspaceHeaderCard";

/** The Rule Workspace's colour in the header tile. */
const RULES_COLOR = "#ef6c00";

const STATUS_COLOR: Record<string, "default" | "success" | "warning"> = {
  draft: "default",
  active: "success",
  retired: "warning",
};

const SEVERITY_COLOR: Record<string, "default" | "info" | "warning" | "error"> = {
  low: "info",
  medium: "warning",
  high: "error",
};

const readError = (err: unknown, fallback: string): string => {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail ?? (err instanceof Error ? err.message : fallback);
};

/**
 * The rule library.
 *
 * A rule is written here on its own, before any field is in sight, and is
 * attached to a field later. That is why this page shows no model, no session
 * and no column: what it holds is the wording of a rule, which is the part
 * worth writing once and reusing.
 */
export function RuleWorkspace() {
  const vm = useRulesWorkspace();
  const [editing, setEditing] = useState<RuleDefinition | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RuleDefinition | null>(null);
  // Which rule's history is open, if any. A rule's earlier versions are kept,
  // so "what did this say when that result was produced" has an answer.
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Bringing a file in is two steps — reconcile, then apply — so the plan and
  // the report both live here, and only one of them is ever on screen.
  const [importOpen, setImportOpen] = useState(false);
  const [importPlan, setImportPlan] = useState<RuleImportPlan | null>(null);
  const [importReport, setImportReport] = useState<RuleImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const [categoriesCollapsed, setCategoriesCollapsed] = useStoredFlag("rules-category-selection-collapsed", false);

  // ?rule=<id> / ?category=<name> (from the global search): show that rule —
  // its category open, the row marked and scrolled to — or that category.
  const [focusRule, consumeFocusRule] = useFocusParam("rule");
  const [focusCategory, consumeFocusCategory] = useFocusParam("category");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    if (!focusCategory) return;
    vm.setSearch("");
    vm.setStatus("");
    vm.setCategory(focusCategory);
    consumeFocusCategory();
  }, [focusCategory]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusRule || !vm.rulesQuery.isSuccess) return;
    const rule = (vm.rulesQuery.data?.items ?? []).find((item) => item.rule_definition_id === focusRule);
    if (!rule && (vm.search || vm.status || vm.category)) {
      // A filter is hiding it: clear the filters and look again.
      vm.setSearch("");
      vm.setStatus("");
      vm.setCategory("");
      return;
    }
    if (rule) {
      const category = rule.category?.trim() || "Uncategorised";
      setCollapsed((previous) => ({ ...previous, [category]: false }));
      setHighlighted(rule.rule_definition_id);
      scrollToMarked("data-rule-id", rule.rule_definition_id);
    }
    consumeFocusRule();
  }, [focusRule, vm.rulesQuery.isSuccess, vm.rulesQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const catalogue = vm.catalogueQuery.data;
  const report = vm.rulesQuery.data;
  const rules = report?.items ?? [];
  const filtering = vm.search.length > 0 || vm.status.length > 0 || vm.category.length > 0;

  const labelOf = (options: { key: string; label: string }[] | undefined, key: string) =>
    options?.find((option) => option.key === key)?.label ?? key;

  /**
   * The library, grouped by the team's own categories.
   *
   * A flat list of a hundred rules is a list nobody reads. Grouping is by the
   * category each rule was given, in the order the team would say them —
   * alphabetical — with an "Uncategorised" group only when something needs one,
   * rather than a permanent empty shelf.
   */
  const groups = useMemo(() => {
    const byCategory = new Map<string, RuleDefinition[]>();
    for (const rule of rules) {
      const key = rule.category?.trim() || "Uncategorised";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(rule);
    }
    return [...byCategory.entries()]
      .map(([category, items]) => ({
        category,
        rules: items,
        active: items.filter((rule) => rule.status === "active").length,
      }))
      .sort((a, b) => a.category.localeCompare(b.category, undefined, { sensitivity: "base" }));
  }, [rules]);

  const openCreate = () => {
    setEditing(null);
    setSaveError(null);
    setDialogOpen(true);
  };

  const openEdit = (rule: RuleDefinition) => {
    setEditing(rule);
    setSaveError(null);
    setDialogOpen(true);
  };

  const save = async (payload: SaveRulePayload) => {
    setSaveError(null);
    try {
      if (editing) {
        await vm.updateRuleMutation.mutateAsync({
          ruleDefinitionId: editing.rule_definition_id,
          payload,
        });
      } else {
        await vm.createRuleMutation.mutateAsync(payload);
      }
      setDialogOpen(false);
    } catch (err) {
      // The rule was removed while this form was open, so there is nothing to
      // save onto. Keeping the form up would only offer the same dead button
      // again; close it and say what happened, with the work still in view
      // on the refreshed list.
      if (vm.isMissing(err)) {
        setDialogOpen(false);
        setListError(
          `“${editing?.name ?? payload.name}” no longer exists — it was removed somewhere else. ` +
            "The list has been refreshed; create it again if you still need it.",
        );
        return;
      }
      setSaveError(readError(err, "Could not save this rule."));
    }
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  /** The file carries the internal id, so what comes back re-imports by identity. */
  const exportRules = async () => {
    setListError(null);
    try {
      downloadCsv(
        `rules-${stamp()}.csv`,
        await rulesApi.exportCsv({ status: vm.status, category: vm.category, search: vm.search }),
      );
    } catch (err) {
      setListError(readError(err, "Could not export the library."));
    }
  };

  const openImport = () => {
    setImportPlan(null);
    setImportReport(null);
    setImportError(null);
    setImportOpen(true);
  };

  const reviewFile = async (csv: string) => {
    setImportError(null);
    setImportReport(null);
    try {
      setImportPlan(await vm.validateImportMutation.mutateAsync(csv));
    } catch (err) {
      setImportPlan(null);
      setImportError(readError(err, "Could not read that file."));
    }
  };

  const applyImport = async (rows: number[]) => {
    if (!importPlan) return;
    setImportError(null);
    try {
      setImportReport(
        await vm.commitImportMutation.mutateAsync({ stageId: importPlan.stage_id, rows }),
      );
      setImportPlan(null);
    } catch (err) {
      setImportError(readError(err, "Could not apply this file."));
    }
  };

  const downloadTemplate = async () => {
    setImportError(null);
    try {
      downloadCsv("rules-template.csv", await rulesApi.templateCsv());
    } catch (err) {
      setImportError(readError(err, "Could not build a template."));
    }
  };

  const saveCodePrefix = async (category: string, prefix: string) => {
    setPrefixError(null);
    try {
      await vm.setCodePrefixMutation.mutateAsync({ category, prefix });
    } catch (err) {
      setPrefixError(readError(err, "Could not set that prefix."));
    }
  };

  const clearCodePrefix = async (category: string) => {
    setPrefixError(null);
    try {
      await vm.clearCodePrefixMutation.mutateAsync(category);
    } catch (err) {
      setPrefixError(readError(err, "Could not clear that prefix."));
    }
  };

  // Asked as the dialog opens, so a rule in use says where before anyone
  // presses Delete. It is a warning, not a lock: the person may still delete.
  const deleteUsage = useQuery({
    queryKey: ["rule-usage", pendingDelete?.rule_definition_id ?? null],
    queryFn: () => rulesApi.getUsage(pendingDelete!.rule_definition_id),
    enabled: !!pendingDelete,
    staleTime: 0,
    gcTime: 0,
  });
  const usage = deleteUsage.data;
  const deleteInUse = !!usage?.in_use;

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setListError(null);
    try {
      // In use: the dialog has already warned where, so the delete is confirmed.
      await vm.deleteRuleMutation.mutateAsync({
        ruleDefinitionId: pendingDelete.rule_definition_id,
        force: !!usage?.in_use,
      });
      setPendingDelete(null);
    } catch (err) {
      setListError(
        vm.isMissing(err)
          ? `“${pendingDelete.name}” had already been removed. The list has been refreshed.`
          : readError(err, "Could not delete this rule."),
      );
      setPendingDelete(null);
    }
  };

  const categories = catalogue?.categories ?? [];
  const categoryTitle = vm.category || "All categories";

  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 520, display: "flex" }}>
      {listError && <Alert severity="error" onClose={() => setListError(null)}>{listError}</Alert>}
      {vm.rulesQuery.isError && (
        <Alert
          severity="error"
          action={
            <Button size="small" onClick={() => void vm.rulesQuery.refetch()} sx={{ textTransform: "none" }}>
              Try again
            </Button>
          }
        >
          Could not load the rule library.
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
        {/* ── Category Selection: the same left panel as Model Selection.
              Picking a category is the Category filter; All shows the library. */}
        <SidePanel
          title="Categories"
          collapsed={categoriesCollapsed}
          onToggle={() => setCategoriesCollapsed(!categoriesCollapsed)}
          actions={
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              Rule
            </Button>
          }
        >
          <List dense disablePadding sx={{ overflow: "auto" }}>
            {["", ...categories].map((category) => (
              <ListItemButton
                key={category || "__all"}
                selected={vm.category === category}
                onClick={() => vm.setCategory(category)}
                sx={{ borderRadius: 1, mb: 0.25, gap: 1 }}
              >
                <Box
                  sx={{
                    width: 24, height: 24, flexShrink: 0, borderRadius: 1,
                    bgcolor: category ? RULES_COLOR : "action.selected",
                    color: category ? "#fff" : "text.secondary",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <GavelOutlinedIcon sx={{ fontSize: 15 }} />
                </Box>
                <Typography variant="body2" fontWeight={vm.category === category ? 700 : 500} noWrap sx={{ flex: 1, minWidth: 0 }}>
                  {category || "All categories"}
                </Typography>
              </ListItemButton>
            ))}
          </List>
        </SidePanel>

        <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <WorkspaceHeaderCard
            icon={<GavelOutlinedIcon />}
            color={RULES_COLOR}
            title="Rule Workspace"
            chip={<HeaderChip label={categoryTitle} />}
            description="Write data quality rules once, then attach them to fields where they apply."
            counts={[
              { label: "Rules", value: report?.total ?? 0, hint: filtering ? "Matching the filters" : undefined },
              { label: "Active", value: report?.active ?? 0 },
              { label: "Categories", value: categories.length },
            ]}
            actions={
              <>
                <Tooltip title="Set the code prefix each category hands out. Codes already issued never change.">
                  <Button size="small" variant="text" startIcon={<LabelOutlinedIcon />} onClick={() => { setPrefixError(null); setPrefixOpen(true); }}>
                    Rule codes
                  </Button>
                </Tooltip>
                <Tooltip title="Download the library as CSV. The file carries the internal rule ID, so re-importing it matches on identity rather than on name.">
                  <Button size="small" variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={() => void exportRules()}>
                    Export
                  </Button>
                </Tooltip>
                <Tooltip title="Reconcile a CSV against the library. Nothing is written until you review the plan and apply it.">
                  <Button size="small" variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={openImport}>
                    Import
                  </Button>
                </Tooltip>
              </>
            }
          />

          <AuthoringPanel
            title={`Rule Library – ${categoryTitle}`}
            hint="Rules are grouped by category. Edit, view the version history or delete a rule in its row."
            flush
            toolbar={
              <Stack direction="row" spacing={1} alignItems="center">
                {vm.rulesQuery.isFetching && <CircularProgress size={14} />}
                <TextField
                  size="small"
                  placeholder="Search rules…"
                  value={vm.search}
                  onChange={(e) => vm.setSearch(e.target.value)}
                  sx={{ width: 220 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  select size="small" value={vm.status}
                  onChange={(e) => vm.setStatus(e.target.value)} sx={{ width: 150 }}
                  SelectProps={{ displayEmpty: true }}
                  inputProps={{ "aria-label": "Status" }}
                >
                  <MenuItem value="">All statuses</MenuItem>
                  {(catalogue?.statuses ?? []).map((item) => (
                    <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
                  ))}
                </TextField>
              </Stack>
            }
          >
        {vm.rulesQuery.isLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress size={22} />
              </Box>
            ) : rules.length === 0 ? (
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", py: 6, gap: 1.5 }}>
                <GavelOutlinedIcon sx={{ fontSize: 44, color: "text.disabled" }} />
                <Typography variant="subtitle1" fontWeight={700}>
                  {filtering ? "No rule matches these filters" : "No rules yet"}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
                  {filtering
                    ? "Clear the search or filters to see the whole library."
                    : "Write a rule once here, then attach it to the fields it applies to."}
                </Typography>
                {!filtering && (
                  <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ textTransform: "none", mt: 1 }}>
                    New rule
                  </Button>
                )}
              </Box>
            ) : (
              <Box>
                {groups.map((group, index) => {
                  const open = !collapsed[group.category];
                  return (
                    <Box key={group.category} sx={{ borderTop: index === 0 ? 0 : 1, borderColor: "divider" }}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        onClick={() => setCollapsed((state) => ({ ...state, [group.category]: open }))}
                        sx={{
                          px: 1.5, py: 0.75, cursor: "pointer",
                          bgcolor: "action.hover",
                          "&:hover": { bgcolor: "action.selected" },
                        }}
                      >
                        <ExpandMoreIcon
                          fontSize="small"
                          sx={{ transform: open ? "none" : "rotate(-90deg)", transition: "0.2s", color: "text.secondary" }}
                        />
                        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
                          {group.category}
                        </Typography>
                        {group.active > 0 && (
                          <Chip size="small" color="success" variant="outlined" label={`${group.active} active`}
                                sx={{ height: 20, fontSize: "0.65rem" }} />
                        )}
                        <Chip size="small" label={group.rules.length}
                              sx={{ height: 20, minWidth: 28, fontSize: "0.65rem" }} />
                      </Stack>

                      <Collapse in={open} unmountOnExit>
                        <Box sx={{ overflowX: "auto" }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12 }}>Code</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12, minWidth: 260 }}>Name</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12, minWidth: 200 }}>Checks that</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12 }}>Dimension</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12, whiteSpace: "nowrap" }}>Applies to</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12 }}>Severity</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12 }}>Status</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "text.secondary", fontSize: 12, width: 136, minWidth: 136, whiteSpace: "nowrap" }} align="center">Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {group.rules.map((rule) => (
                                <TableRow
                                  key={rule.rule_definition_id}
                                  hover
                                  data-rule-id={rule.rule_definition_id}
                                  selected={highlighted === rule.rule_definition_id}
                                  onClick={() => highlighted === rule.rule_definition_id || setHighlighted(null)}
                                >
                                  <TableCell>
                                    <Typography variant="caption" sx={{ fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
                                      {rule.code || "—"}
                                    </Typography>
                                    {!rule.is_executable && (
                                      <Tooltip title={`Needs ${rule.execution_scope_label.toLowerCase()} execution, which the engine does not have yet. The rule is governed and valid; Discover lists it and marks it rather than offering it.`}>
                                        <Chip size="small" variant="outlined" color="error"
                                              label="not executable"
                                              sx={{ height: 17, fontSize: "0.6rem", mt: 0.25 }} />
                                      </Tooltip>
                                    )}
                                    {rule.version > 1 && (
                                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                        v{rule.version}
                                      </Typography>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body2" fontWeight={600}>{rule.name}</Typography>
                                    {rule.description && (
                                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                        {rule.description}
                                      </Typography>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body2">{rule.check_label}</Typography>
                                    <Typography variant="caption" color="text.secondary">{rule.statement}</Typography>
                                  </TableCell>
                                  <TableCell>{rule.dimension_label}</TableCell>
                                  <TableCell>{rule.applies_to_label}</TableCell>
                                  <TableCell>
                                    <Chip size="small" variant="outlined" color={SEVERITY_COLOR[rule.severity] ?? "default"}
                                          label={labelOf(catalogue?.severities, rule.severity)}
                                          sx={{ height: 20, fontSize: "0.65rem" }} />
                                  </TableCell>
                                  <TableCell>
                                    <Chip size="small" color={STATUS_COLOR[rule.status] ?? "default"}
                                          label={labelOf(catalogue?.statuses, rule.status)}
                                          sx={{ height: 20, fontSize: "0.65rem" }} />
                                  </TableCell>
                                  <TableCell align="center" sx={{ whiteSpace: "nowrap" }}>
                                    <Tooltip title="Edit">
                                      <IconButton size="small" onClick={() => openEdit(rule)}>
                                        <EditOutlinedIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Version history">
                                      <IconButton size="small" onClick={() => setHistoryFor(rule.rule_definition_id)}>
                                        <HistoryOutlinedIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Delete">
                                      <IconButton size="small" color="error" onClick={() => setPendingDelete(rule)}>
                                        <DeleteOutlineIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            )}
          </AuthoringPanel>
        </Stack>
      </Box>

      <CreateEditRuleDialog
        open={dialogOpen}
        rule={editing}
        catalogue={catalogue}
        saving={vm.createRuleMutation.isPending || vm.updateRuleMutation.isPending}
        error={saveError}
        onClose={() => setDialogOpen(false)}
        onSave={save}
        onValidateScript={(script) => vm.validateScriptMutation.mutateAsync(script)}
        onTestExamples={(payload) => vm.testExamplesMutation.mutateAsync(payload)}
      />

      {historyFor && (
        <RuleVersionHistoryDialog
          ruleDefinitionId={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}

      <RuleImportDialog
        open={importOpen}
        plan={importPlan}
        report={importReport}
        busy={vm.validateImportMutation.isPending || vm.commitImportMutation.isPending}
        error={importError}
        onPickFile={(csv) => void reviewFile(csv)}
        onCommit={(rows) => void applyImport(rows)}
        onDownloadTemplate={() => void downloadTemplate()}
        onClose={() => setImportOpen(false)}
      />

      <RuleCodePrefixDialog
        open={prefixOpen}
        report={vm.codePrefixesQuery.data}
        loading={vm.codePrefixesQuery.isLoading}
        busy={vm.setCodePrefixMutation.isPending || vm.clearCodePrefixMutation.isPending}
        error={prefixError}
        onSave={(category, prefix) => void saveCodePrefix(category, prefix)}
        onClear={(category) => void clearCodePrefix(category)}
        onClose={() => setPrefixOpen(false)}
      />

      <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this rule?</DialogTitle>
        <DialogContent>
          {deleteUsage.isLoading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <DialogContentText>Checking where this rule is used…</DialogContentText>
            </Stack>
          ) : deleteInUse && usage ? (
            <Stack spacing={1.5}>
              <Alert severity="warning">
                “{pendingDelete?.name}” is in use. Deleting it removes it from the node instances below;
                Discover sessions keep their own copy, and the rule's version history is kept.
                Consider retiring it instead.
              </Alert>
              {usage.node_instances.total > 0 && (
                <Box>
                  <Typography variant="subtitle2">
                    Attached to {usage.node_instances.total} node instance{usage.node_instances.total === 1 ? "" : "s"}
                  </Typography>
                  {usage.node_instances.items.map((item) => (
                    <Typography key={item.id} variant="body2" color="text.secondary">
                      {item.name}{item.model_name ? ` · ${item.model_name}` : ""}
                    </Typography>
                  ))}
                  {usage.node_instances.total > usage.node_instances.items.length && (
                    <Typography variant="body2" color="text.secondary">
                      and {usage.node_instances.total - usage.node_instances.items.length} more
                    </Typography>
                  )}
                </Box>
              )}
              {usage.discover_sessions.total > 0 && (
                <Box>
                  <Typography variant="subtitle2">
                    Chosen in {usage.discover_sessions.total} Discover session{usage.discover_sessions.total === 1 ? "" : "s"}
                  </Typography>
                  {usage.discover_sessions.items.map((item) => (
                    <Typography key={item.id} variant="body2" color="text.secondary">{item.name}</Typography>
                  ))}
                  {usage.discover_sessions.total > usage.discover_sessions.items.length && (
                    <Typography variant="body2" color="text.secondary">
                      and {usage.discover_sessions.total - usage.discover_sessions.items.length} more
                    </Typography>
                  )}
                </Box>
              )}
            </Stack>
          ) : (
            <DialogContentText>
              “{pendingDelete?.name}” will be removed from the library. This cannot be undone.
            </DialogContentText>
          )}
          {deleteUsage.isError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              Could not check where this rule is used. Try again before deleting it.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}
                  disabled={vm.deleteRuleMutation.isPending || !usage}>
            {deleteInUse ? "Delete anyway" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
