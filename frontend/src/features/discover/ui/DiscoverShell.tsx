import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import SearchIcon from "@mui/icons-material/Search";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import { SidePanel } from "@/shared/workspace/SidePanel";
import { OverflowText } from "@/shared/workspace/OverflowText";
import { useStoredFlag } from "@/shared/workspace/WorkspacePanels";
import { HeaderChip, WorkspaceHeaderCard } from "@/shared/workspace/WorkspaceHeaderCard";
import { DiscoverOverviewPanel, RecentActivityPanel } from "./DiscoverOverviewPanel";
import { DiscoverArchiveControl } from "./DiscoverArchiveControl";
import { DiscoverImportPanel } from "./DiscoverImportPanel";
import { DiscoverProfileTab } from "./DiscoverProfileTab";
import { DiscoverMappingsTab } from "./DiscoverMappingsTab";
import { DiscoverGovernedFieldRulesTab } from "./DiscoverGovernedFieldRulesTab";
import { DiscoverQualityTab } from "./DiscoverQualityTab";
import { DiscoverTableTabs } from "./DiscoverTableTabs";
import type { DiscoverySessionSummary } from "@/shared/contracts";

/** Discover's colour in the header tile, as Impact and the model kinds have theirs. */
const DISCOVER_COLOR = "#00796b";

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
};

// ── Stepper step definitions ───────────────────────────────────────────────
// Load → Profile → Map → Determine Applicable Governed Rules → Configure
// permitted parameters → Run Quality → Review Results/Evidence.
//
// There is no separate value-classification step. Mapping already says which
// governed field a column is, and a rule that cares about particular values —
// "these values are at most 10% of the rows" — names those values in its own
// parameters. A step that asked the user to relate every value to a governed
// instance first was work that only two rules ever used, and both were
// rewritten to say the same thing without it.
// The session's standing (activity and the three summary panels) sits alongside
// the import form on the first step rather than in a separate introduction.
//
// Rules is one step, not two. It used to be "Governed Rules" followed by "Rule
// Parameters": pick the checks, then fill in their thresholds and value lists.
// Now a rule arrives from the Rule Workspace already written — its wording, its
// tolerance and the values it ignores were decided once by whoever owns it — so
// there is nothing left to configure here and a second step had nothing to ask.
// Choosing is the whole of it.
const STEP_DEFS = [
  { key: "import", label: "Import Data", icon: <CloudUploadOutlinedIcon sx={{ fontSize: 16 }} /> },
  { key: "profile", label: "Profile Data", icon: <AssessmentOutlinedIcon sx={{ fontSize: 16 }} /> },
  { key: "mapping", label: "Mapping", icon: <LinkOutlinedIcon sx={{ fontSize: 16 }} /> },
  { key: "rules", label: "Rules", icon: <GavelOutlinedIcon sx={{ fontSize: 16 }} /> },
  { key: "quality", label: "Quality Check", icon: <VerifiedUserOutlinedIcon sx={{ fontSize: 16 }} /> },
] as const;

const STEP_IMPORT = 0;
const STEP_PROFILE = 1;
const STEP_MAPPING = 2;
const STEP_RULES = 3;
const STEP_QUALITY = 4;

/** How long until an archived session is deleted, in words. */
function purgeNote(iso: string): string {
  if (!iso) return "";
  const days = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  const when = new Date(iso).toLocaleDateString();
  return `deleted in ${days} day${days === 1 ? "" : "s"} · ${when}`;
}

// ── Lifecycle status chip ──────────────────────────────────────────────────
const STATUS_CHIP: Record<string, { label: string; color: "success" | "default" | "warning" | "error" }> = {
  draft:     { label: "Draft",    color: "default" },
  ready:     { label: "Active",   color: "success" },
  running:   { label: "Active",   color: "success" },
  completed: { label: "Active",   color: "success" },
  error:     { label: "Error",    color: "error" },
  archived:  { label: "Archived", color: "warning" },
  purged:    { label: "Purged",   color: "error" },
};

function SessionStatusChip({ status }: { status: string }) {
  const { label, color } = STATUS_CHIP[status] ?? { label: "Active", color: "success" };
  return <HeaderChip label={label} color={color} />;
}

// ── Session Selection (the left panel) ────────────────────────────────────
// The same panel as Model Selection in MWS and SWS: a type-ahead, a filter,
// then the list. Archived sessions are kept out of the way but not hidden:
// they are still readable, and a person needs to see one to decide whether to
// restore it before it is deleted.
function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: DiscoverySessionSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = sessions.filter((s) => s.status === "archived").length;
  const needle = search.trim().toLowerCase();
  const shown = sessions.filter(
    (s) =>
      (s.status === "archived") === showArchived &&
      (!needle || s.name.toLowerCase().includes(needle) || (s.source_name ?? "").toLowerCase().includes(needle)),
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack spacing={1} sx={{ px: 0.5, pb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={showArchived ? "archived" : "active"}
          onChange={(_, value) => value && setShowArchived(value === "archived")}
        >
          <ToggleButton value="active" sx={{ textTransform: "none", fontSize: 12, fontWeight: 700, py: 0.25 }}>
            Active ({sessions.length - archivedCount})
          </ToggleButton>
          <ToggleButton value="archived" sx={{ textTransform: "none", fontSize: 12, fontWeight: 700, py: 0.25 }}>
            Archived ({archivedCount})
          </ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="Search sessions…"
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
      </Stack>
      <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {shown.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>
            {needle ? "No session matches." : showArchived ? "Nothing archived." : "No active sessions."}
          </Typography>
        )}
        {shown.map((s) => (
          <ListItemButton
            key={s.session_id}
            selected={s.session_id === selectedId}
            onClick={() => onSelect(s.session_id)}
            sx={{ borderRadius: 1, mb: 0.25, gap: 1, alignItems: "flex-start", py: 0.75 }}
          >
            <Box
              sx={{
                width: 24, height: 24, mt: 0.25, flexShrink: 0, borderRadius: 1,
                bgcolor: DISCOVER_COLOR, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <StorageOutlinedIcon sx={{ fontSize: 15 }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <OverflowText variant="body2" fontWeight={s.session_id === selectedId ? 700 : 500}>
                {s.name}
              </OverflowText>
              <OverflowText variant="caption" color="text.secondary" display="block">
                {s.source_name || "No file attached"}
              </OverflowText>
              {s.purge_due_at && (
                <Typography variant="caption" color="warning.main" display="block" fontWeight={600} noWrap>
                  {purgeNote(s.purge_due_at)}
                </Typography>
              )}
            </Box>
            {s.status === "draft" && <SessionStatusChip status={s.status} />}
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

// ── Landing state (no session selected) ───────────────────────────────────
// Laid out as the MWS / SWS landing: what this workspace is for, then the
// sessions opened most recently, so the usual next step is one click.
function DiscoverLandingState({
  sessions,
  onSelect,
}: {
  sessions: DiscoverySessionSummary[];
  onSelect: (id: string) => void;
}) {
  const recent = useMemo(
    () =>
      sessions
        .filter((s) => s.status !== "archived")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 6),
    [sessions],
  );

  const steps = [
    { icon: <CloudUploadOutlinedIcon fontSize="small" />, label: "Load & Profile", desc: "Upload a file, then read its real shape: counts, nulls, types and patterns." },
    { icon: <LinkOutlinedIcon fontSize="small" />, label: "Map Data", desc: "Pair source columns with the governed model's fields." },
    { icon: <GavelOutlinedIcon fontSize="small" />, label: "Pick Rules", desc: "Tick the rules from the Rule Workspace that apply to each field." },
    { icon: <VerifiedUserOutlinedIcon fontSize="small" />, label: "Run & Review", desc: "Run those rules against the mapped data, then review the results and evidence." },
  ];

  return (
    <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ mb: 3 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Discover Workspace</Typography>
          <Typography variant="body2" color="text.secondary">
            Create or select a discovery session to analyse and validate source data before it reaches the canonical model.
          </Typography>
        </Box>
      </Stack>

      <Typography variant="overline" color="text.secondary">
        How a session works
      </Typography>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", mt: 1, mb: 3 }}>
        {steps.map((step, index) => (
          <Paper key={step.label} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Box
                sx={{
                  width: 26, height: 26, borderRadius: 1, flexShrink: 0,
                  bgcolor: "action.hover", color: "primary.main",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {step.icon}
              </Box>
              <Typography variant="subtitle2" fontWeight={700}>
                {index + 1}. {step.label}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {step.desc}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Typography variant="overline" color="text.secondary">
        Recent sessions
      </Typography>
      {recent.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          There are no sessions yet. Use + Session to create the first one.
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", mt: 1 }}>
          {recent.map((s) => (
            <Card key={s.session_id} variant="outlined">
              <CardActionArea onClick={() => onSelect(s.session_id)} sx={{ p: 1.5, height: "100%" }}>
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 34, height: 34, flexShrink: 0, borderRadius: 1,
                      bgcolor: DISCOVER_COLOR, color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <StorageOutlinedIcon fontSize="small" />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <OverflowText variant="subtitle2" fontWeight={700}>
                      {s.name}
                    </OverflowText>
                    <OverflowText variant="caption" color="text.secondary" display="block">
                      {s.source_name || "No file attached"}
                    </OverflowText>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Updated {new Date(s.updated_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                  <SessionStatusChip status={s.status} />
                </Stack>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
    </Paper>
  );
}

// ── New Session Dialog ─────────────────────────────────────────────────────
function NewSessionDialog({
  open,
  onClose,
  onCreate,
  isCreating,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  isCreating: boolean;
}) {
  const [name, setName] = useState("");

  const handleConfirm = () => {
    if (!name.trim()) return;
    onCreate(name.trim());
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Create New Session</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Give this discovery session a descriptive name so you can find it later.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Session name"
          placeholder="e.g. Customer Master Import Q3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!name.trim() || isCreating}
          startIcon={isCreating ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ textTransform: "none", fontWeight: 600 }}
        >
          {isCreating ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}


// ── Workflow steps ─────────────────────────────────────────────────────────
// The steps of a session, drawn as the view tabs under an open model's header
// in MWS and SWS. Only the icon says where a step stands:
//   done     — a tick, still clickable
//   current  — the step's own icon, underlined
//   locked   — a padlock, not clickable until the work before it is complete
function WorkflowStepper({
  steps,
  activeStep,
  maxUnlockedStep,
  onSelect,
  trailing,
}: {
  steps: readonly { key: string; label: string; icon: React.ReactElement }[];
  activeStep: number;
  maxUnlockedStep: number;
  onSelect: (index: number) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 34, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
      <Tabs
        value={activeStep}
        onChange={(_, value: number) => onSelect(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 34, flex: 1, "& .MuiTab-root": { minHeight: 34, py: 0.25, px: 1.5, textTransform: "none", fontSize: 13, fontWeight: 600 } }}
        aria-label="Session steps"
      >
        {steps.map((step, index) => {
          const isCurrent = index === activeStep;
          // Completed means "behind the unlocked frontier", not "behind where I am
          // standing" — stepping back to Import must not un-tick Profile.
          const isDone = !isCurrent && index < maxUnlockedStep;
          const isLocked = index > maxUnlockedStep;
          const icon = isLocked ? (
            <LockOutlinedIcon sx={{ fontSize: 15 }} />
          ) : isDone ? (
            <CheckCircleIcon sx={{ fontSize: 16, color: "success.main" }} />
          ) : (
            step.icon
          );
          return (
            <Tab
              key={step.key}
              value={index}
              disabled={isLocked}
              icon={icon}
              iconPosition="start"
              aria-current={isCurrent ? "step" : undefined}
              label={`${index + 1}. ${step.label}`}
            />
          );
        })}
      </Tabs>
      {trailing}
    </Stack>
  );
}

// ── Main Shell ────────────────────────────────────────────────────────────
export function DiscoverShell({ vm }: Props) {
  const [activeStep, setActiveStep] = useState(STEP_IMPORT);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);

  // Archived sessions stay in the picker — you have to be able to open one to
  // read it or restore it — but they sink below the live ones.
  const sessions = [...(vm.sessionsQuery.data ?? [])].sort(
    (a, b) => Number(a.status === "archived") - Number(b.status === "archived")
  );
  const hasSession = vm.selectedSessionId.length > 0;

  // Back to step one whenever the open session changes. An effect rather than
  // a line at each call site, because the session can now also change from the
  // browser's Back and Forward buttons, which no call site sees.
  useEffect(() => {
    setActiveStep(STEP_IMPORT);
  }, [vm.selectedSessionId]);
  const selectedSession = sessions.find((s) => s.session_id === vm.selectedSessionId);
  const overview = vm.overviewQuery.data;
  const isSessionsLoading = vm.sessionsQuery.isLoading;

  // Profiling is considered "run" once the legacy source_column table has been
  // seeded via the Profile step's Run Profiling action.
  const hasProfiledColumns = (vm.columnsQuery.data?.length ?? 0) > 0;

  // The file's rows are stored on the server as soon as it is uploaded, and
  // profiling works from those rows alone. Unlocking on stored content — not
  // only on the in-page Start Import flag — means a reload, or a hiccup in that
  // call, can never strand a session on step one with a perfectly good file.
  const hasStoredFile = (vm.datasetQuery.data?.column_count ?? 0) > 0;
  // An import still reading files is not an import you can profile.
  //
  // One stored table is enough for `hasStoredFile`, so Profile Data used to
  // unlock the moment the first of five files landed — and profiling then
  // covered whichever tables happened to exist at that second. The step
  // waits for the whole batch.
  const importStillWorking = !!vm.importProgressQuery.data?.is_working;

  // Every file uploaded into this session; the active one drives every step.
  const sourceFiles = vm.sourceFilesQuery.data ?? [];

  // The governed steps and the quality run all work from mapped fields, so they
  // open together once at least one column has been paired with a model field.
  const hasMappings = (vm.mappingsQuery.data?.length ?? 0) > 0;

  // Review shows the evidence of a run, so it opens only once there has been one.

  // Furthest step the user is allowed to reach right now:
  //  - Import is always reachable once a session exists.
  //  - Profile unlocks once the uploaded file's content is stored.
  //  - Mapping unlocks once profiling has produced columns to work with.
  //  - Rules and Quality unlock once something has actually been mapped —
  //    both of them read mapped fields. Quality is the last step: it now
  //    carries the evidence itself, rule by rule, so there is nothing left
  //    to go and review somewhere else.
  const maxUnlockedStep = hasProfiledColumns
    ? hasMappings
      ? STEP_QUALITY
      : STEP_MAPPING
    : (vm.importConfirmed || hasStoredFile) && !importStillWorking
      ? STEP_PROFILE
      : STEP_IMPORT;

  // If the unlocked frontier ever shrinks (e.g. the user replaces the source
  // file after already profiling), fall back to the furthest step still open.
  useEffect(() => {
    setActiveStep((current) => (current > maxUnlockedStep ? maxUnlockedStep : current));
  }, [maxUnlockedStep]);

  const goToStep = (step: number) => {
    if (step >= STEP_IMPORT && step <= maxUnlockedStep) setActiveStep(step);
  };

  // ?step=&file=&column= (from the global search): open the session on that
  // table, at that step, with that column selected. Read once per address,
  // then dropped from it, so later navigation is the user's own.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusRef = useRef<{ step: number | null; file: string; column: string } | null>(null);
  const focusKey = searchParams.get("step") || searchParams.get("file") || searchParams.get("column") ? searchParams.toString() : "";
  useEffect(() => {
    if (!focusKey) return;
    const stepIndex = STEP_DEFS.findIndex((def) => def.key === searchParams.get("step"));
    focusRef.current = { step: stepIndex >= 0 ? stepIndex : null, file: searchParams.get("file") ?? "", column: searchParams.get("column") ?? "" };
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        ["step", "file", "column"].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true },
    );
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeFileId = sourceFiles.find((file) => file.is_active)?.source_file_id ?? "";
  const stepsSettled =
    hasSession && vm.sourceFilesQuery.isSuccess && !vm.columnsQuery.isLoading && !vm.mappingsQuery.isLoading && !vm.activateSourceFileMutation.isPending;
  useEffect(() => {
    const focus = focusRef.current;
    if (!focus || !stepsSettled) return;
    // First the table: activating it changes what every step shows.
    if (focus.file && focus.file !== activeFileId && sourceFiles.some((file) => file.source_file_id === focus.file)) {
      vm.activateSourceFileMutation.mutate(focus.file);
      focus.file = "";
      return;
    }
    focus.file = "";
    if (focus.column) vm.setSelectedColumnId(focus.column);
    if (focus.step !== null) setActiveStep(Math.min(focus.step, maxUnlockedStep));
    focusRef.current = null;
  }, [stepsSettled, activeFileId, maxUnlockedStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // Maps the Overview cards' legacy shortcut targets (Profile/Mapping/Quality)
  // onto the new stepper indices.
  const legacyShortcutToStep: Record<number, number> = { 1: STEP_PROFILE, 2: STEP_MAPPING, 3: STEP_QUALITY };
  const goToLegacyTarget = (legacyIndex: number) => goToStep(legacyShortcutToStep[legacyIndex] ?? STEP_IMPORT);

  const handleCreateSession = async (name: string) => {
    // The mutation navigates to the new session; the effect above resets the
    // stepper when it arrives.
    await vm.createSessionMutation.mutateAsync({ name });
    setNewSessionDialogOpen(false);
  };

  const [selectionCollapsed, setSelectionCollapsed] = useStoredFlag("discover-session-selection-collapsed", false);

  const loadingPanel = (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>
  );

  // The header's counts come from queries the steps load anyway.
  const counts = [
    { label: "Files", value: sourceFiles.length },
    { label: "Columns", value: vm.columnsQuery.data?.length ?? 0, hint: "Profiled columns" },
    { label: "Mappings", value: vm.mappingsQuery.data?.length ?? 0 },
  ];
  const description = [
    selectedSession?.source_name || "No file attached",
    selectedSession ? `updated ${new Date(selectedSession.updated_at).toLocaleDateString()}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 520, display: "flex" }}>
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
        {/* ── Session Selection: the same panel as Model Selection ── */}
        <SidePanel
          title="Sessions"
          collapsed={selectionCollapsed}
          onToggle={() => setSelectionCollapsed(!selectionCollapsed)}
          actions={
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setNewSessionDialogOpen(true)}>
              Session
            </Button>
          }
        >
          {isSessionsLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={22} /></Box>
          ) : (
            <SessionList sessions={sessions} selectedId={vm.selectedSessionId} onSelect={(id) => vm.setSelectedSessionId(id)} />
          )}
        </SidePanel>

        <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {!hasSession ? (
            isSessionsLoading ? (
              <Paper variant="outlined" sx={{ flex: 1 }}>{loadingPanel}</Paper>
            ) : (
              <DiscoverLandingState
                sessions={sessions}
                onSelect={(id) => vm.setSelectedSessionId(id)}
              />
            )
          ) : (
            <>
              {/* ── Header: the open session, as an open model's header ──
                  Archive sits here because it acts on the whole session and
                  the moment a person decides they are done with one is right
                  after they have read its results. */}
              <WorkspaceHeaderCard
                icon={<StorageOutlinedIcon />}
                color={DISCOVER_COLOR}
                title={selectedSession?.name ?? "Session"}
                chip={selectedSession ? <SessionStatusChip status={selectedSession.status} /> : undefined}
                description={description}
                counts={counts}
                actions={<DiscoverArchiveControl vm={vm} />}
              />

              {/* ── Session workspace: Import → Profile → Mapping → Rules → Quality ── */}
              <WorkflowStepper
                steps={STEP_DEFS}
                activeStep={activeStep}
                maxUnlockedStep={maxUnlockedStep}
                onSelect={goToStep}
                trailing={
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, pr: 0.5 }}>
                    <Tooltip title="Previous step">
                      <span>
                        <Button
                          size="small"
                          startIcon={<ArrowBackIcon />}
                          onClick={() => setActiveStep((s) => Math.max(STEP_IMPORT, s - 1))}
                          disabled={activeStep === STEP_IMPORT}
                        >
                          Back
                        </Button>
                      </span>
                    </Tooltip>
                    {activeStep < STEP_DEFS.length - 1 && (
                      <Tooltip title={activeStep + 1 > maxUnlockedStep ? "Finish this step first" : `Continue to ${STEP_DEFS[activeStep + 1].label}`}>
                        <span>
                          <Button
                            size="small"
                            variant="contained"
                            endIcon={<ArrowForwardIcon />}
                            onClick={() => goToStep(activeStep + 1)}
                            disabled={activeStep + 1 > maxUnlockedStep}
                          >
                            Next
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </Stack>
                }
              />

              {/* The step's own panels scroll here, under a header and step bar
                  that stay put — the same as the authoring area under an open
                  model.

                  The session's tables, as tabs above the step that works on
                  them — only on Profile and Mapping, the two steps that work on
                  one table at a time. From Rules on, every step lists every
                  mapped field of every table together, so a tab strip there
                  would offer a choice that changes nothing. */}
              <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 1.5, pr: 0.5 }}>
                {(activeStep === STEP_PROFILE || activeStep === STEP_MAPPING) && (
                  <DiscoverTableTabs vm={vm} />
                )}

                {activeStep === STEP_IMPORT && (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    {/* Import form beside the session's recent activity */}
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 3fr) minmax(280px, 2fr)" }, gap: 1.5, alignItems: "stretch" }}>
                      <DiscoverImportPanel vm={vm} />
                      <RecentActivityPanel events={vm.auditQuery.data ?? []} />
                    </Box>

                    {/* Column highlights · Data quality · Mapping summary */}
                    {overview ? (
                      <DiscoverOverviewPanel overview={overview} onNavigate={goToLegacyTarget} />
                    ) : (
                      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                        {[0, 1, 2].map((i) => (
                          <Paper key={i} variant="outlined" sx={{ minHeight: 180 }} />
                        ))}
                      </Box>
                    )}
                  </Box>
                )}

                {activeStep === STEP_PROFILE && (overview ? <DiscoverProfileTab vm={vm} overview={overview} /> : loadingPanel)}

                {activeStep === STEP_MAPPING && (overview ? <DiscoverMappingsTab vm={vm} overview={overview} /> : loadingPanel)}

                {activeStep === STEP_RULES && (overview ? <DiscoverGovernedFieldRulesTab sessionId={vm.selectedSessionId} /> : loadingPanel)}

                {activeStep === STEP_QUALITY && (overview ? <DiscoverQualityTab vm={vm} overview={overview} /> : loadingPanel)}
              </Box>
            </>
          )}
        </Stack>
      </Box>

      {/* ── New Session Dialog ── */}
      <NewSessionDialog
        open={newSessionDialogOpen}
        onClose={() => setNewSessionDialogOpen(false)}
        onCreate={handleCreateSession}
        isCreating={vm.createSessionMutation.isPending}
      />
    </Stack>
  );
}
