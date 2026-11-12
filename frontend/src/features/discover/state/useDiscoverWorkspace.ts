import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discoverApi, CreateDiscoverySessionCommand, AttachSourceFileCommand, SetSourceContextCommand, ValidateImportCommand } from "@/features/discover/api/discoverApi";
import type { RuleSelection } from "@/features/discover/api/discoverApi";
import { structureApi } from "@/features/structure/api/structureApi";
import { useSourceFileUploads } from "@/features/discover/state/useSourceFileUploads";

/**
 * How many data rows the Profile step's preview asks for.
 *
 * A preview answers "what does this data look like", and ten rows answer it.
 * The number is small on purpose: every row is one cell per column, so on a
 * ninety-column file each extra ten rows is another 900 cells the browser has
 * to build before the page settles.
 */
export const PREVIEW_ROW_LIMIT = 10;

/** The Discovery Workspace's own address. A session is a segment beneath it. */
export const DISCOVER_BASE_PATH = "/discover/mapping";

export function useDiscoverWorkspace() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { sessionId: sessionIdInUrl } = useParams<{ sessionId?: string }>();

  /**
   * The open session is the URL, not React state.
   *
   * Held in state it survived nothing: a reload, a bookmark, a link to a
   * colleague and the browser's own Back button all dropped the person back
   * on the session list with no way to say which session they had been in.
   * `/discover/mapping` is the list; `/discover/mapping/sess_…` is that
   * session.
   */
  const selectedSessionId = sessionIdInUrl ?? "";
  const setSelectedSessionId = useCallback(
    (id: string) => {
      navigate(id ? `${DISCOVER_BASE_PATH}/${id}` : DISCOVER_BASE_PATH);
    },
    [navigate]
  );
  const [selectedColumnId, setSelectedColumnId] = useState<string>("");
  const [selectedTargetNodeId, setSelectedTargetNodeId] = useState<string>("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  // Tracks whether Start Import has succeeded for the currently selected session/file,
  // so the Discover stepper can gate the Profile step behind a real completed import.
  const [importConfirmed, setImportConfirmed] = useState(false);
  // Reset the import gate whenever the user switches sessions.
  useEffect(() => {
    setImportConfirmed(false);
  }, [selectedSessionId]);

  // ── Session Queries ──
  const sessionsQuery = useQuery({
    queryKey: ["discover", "sessions"],
    queryFn: async () => (await discoverApi.listSessions()).items
  });

  /**
   * A session id in the address that no longer exists — deleted by the
   * retention job, or a mistyped link — goes back to the list rather than
   * leaving the person in a workspace with nothing in it.
   *
   * Only once the list has actually settled: a newly created session is
   * navigated to while its list is still refetching, and redirecting then
   * would throw the person out of the session they just made.
   */
  const knownSessions = sessionsQuery.data;
  useEffect(() => {
    if (!selectedSessionId) return;
    if (!sessionsQuery.isSuccess || sessionsQuery.isFetching) return;
    if ((knownSessions ?? []).some((s) => s.session_id === selectedSessionId)) return;
    navigate(DISCOVER_BASE_PATH, { replace: true });
  }, [
    selectedSessionId,
    knownSessions,
    sessionsQuery.isSuccess,
    sessionsQuery.isFetching,
    navigate,
  ]);

  /**
   * Whether this session may be archived, answered by the server.
   *
   * "Has the quality check run" is a question about stored findings, and the
   * button and the endpoint have to give the same answer — so only one side
   * of the wire decides it.
   */
  const archiveEligibilityQuery = useQuery({
    queryKey: ["discover", "archiveEligibility", selectedSessionId],
    queryFn: () => discoverApi.archiveEligibility(selectedSessionId),
    enabled: selectedSessionId.length > 0
  });

  const currentSessionQuery = useQuery({
    queryKey: ["discover", "session", selectedSessionId],
    queryFn: async () => (await discoverApi.getSession(selectedSessionId)).session,
    enabled: selectedSessionId.length > 0
  });

  // ── W2-DWS Queries ──
  const overviewQuery = useQuery({
    queryKey: ["discover", "overview", selectedSessionId],
    queryFn: async () => (await discoverApi.getOverview(selectedSessionId)).overview,
    enabled: selectedSessionId.length > 0
  });

  const sourceFileQuery = useQuery({
    queryKey: ["discover", "sourceFile", selectedSessionId],
    queryFn: async () => (await discoverApi.getSourceFile(selectedSessionId)).file,
    enabled: selectedSessionId.length > 0
  });

  const sourceContextQuery = useQuery({
    queryKey: ["discover", "sourceContext", selectedSessionId],
    queryFn: async () => (await discoverApi.getSourceContext(selectedSessionId)).context,
    enabled: selectedSessionId.length > 0
  });

  const validationResultQuery = useQuery({
    queryKey: ["discover", "validation", selectedSessionId],
    queryFn: async () => await discoverApi.getValidationResult(selectedSessionId),
    enabled: selectedSessionId.length > 0
  });

  const discoveryColumnsQuery = useQuery({
    queryKey: ["discover", "discoveryColumns", selectedSessionId],
    queryFn: async () => (await discoverApi.listDiscoveryColumns(selectedSessionId)).items,
    enabled: selectedSessionId.length > 0
  });

  // The real parsed file: headers, row count and a page of actual data rows,
  // all read back from Postgres so they survive refresh and session reopen.
  // Ten rows, because this is a preview: enough to see the shape of the data
  // and what the columns actually hold. Fifty rows of a ninety-column file is
  // 4,500 table cells to build before anything appears on screen, to show
  // forty more rows nobody reads.
  const datasetQuery = useQuery({
    queryKey: ["discover", "dataset", selectedSessionId],
    queryFn: async () => discoverApi.getDataset(selectedSessionId, PREVIEW_ROW_LIMIT, 0),
    enabled: selectedSessionId.length > 0
  });

  // Duplicate rows on their own, after the data is already on screen.
  // The scan reads every row of the table; the preview does not, and used to
  // wait on it anyway. Kept fresh for five minutes so stepping away from the
  // Profile step and back does not pay for it again.
  const datasetDuplicatesQuery = useQuery({
    queryKey: ["discover", "datasetDuplicates", selectedSessionId],
    queryFn: async () => discoverApi.getDatasetDuplicates(selectedSessionId),
    enabled: selectedSessionId.length > 0,
    staleTime: 5 * 60_000
  });

  const auditQuery = useQuery({
    queryKey: ["discover", "audit", selectedSessionId],
    queryFn: async () => (await discoverApi.listAuditEvents(selectedSessionId, 10)).items,
    enabled: selectedSessionId.length > 0,
    refetchInterval: 30_000, // refresh every 30s so panel stays live
  });

  // The full trail, not the last ten: the Review step has to show everything
  // the session did, because that record is the evidence. The key extends the
  // recent-activity key rather than standing apart, so every existing
  // invalidation of ["discover", "audit", id] refreshes this one too — React
  // Query matches on prefix, and a trail that quietly went stale would be
  // worse than no trail at all.
  const auditTrailQuery = useQuery({
    queryKey: ["discover", "audit", selectedSessionId, "full"],
    queryFn: async () => (await discoverApi.listAuditEvents(selectedSessionId, 500)).items,
    enabled: selectedSessionId.length > 0
  });

  // Every file in the session. Switching the active file re-scopes every other
  // query, so they are all invalidated together when it changes.
  const sourceFilesQuery = useQuery({
    queryKey: ["discover", "sourceFiles", selectedSessionId],
    queryFn: async () => (await discoverApi.listSourceFiles(selectedSessionId)).items,
    enabled: selectedSessionId.length > 0
  });

  // ── Structure Context Queries ──
  const structureApplicationsQuery = useQuery({
    queryKey: ["structure", "applications"],
    queryFn: async () => (await discoverApi.listApplications()).items
  });

  const structureModulesQuery = useQuery({
    queryKey: ["structure", "modules", sourceContextQuery.data?.application_ref_id],
    queryFn: async () => (await discoverApi.listModules(sourceContextQuery.data!.application_ref_id!)).items,
    enabled: !!sourceContextQuery.data?.application_ref_id
  });

  // ── Legacy MVP Queries ──
  const columnsQuery = useQuery({
    queryKey: ["discover", "columns", selectedSessionId],
    queryFn: async () => (await discoverApi.listColumns(selectedSessionId)).items,
    enabled: selectedSessionId.length > 0
  });

  // Profile of the column the user clicked: totals plus the field's real
  // distinct values, computed from the rows persisted in Postgres.
  const columnProfileQuery = useQuery({
    queryKey: ["discover", "columnProfile", selectedSessionId, selectedColumnId],
    queryFn: async () => discoverApi.getColumnProfile(selectedSessionId, selectedColumnId, 100),
    enabled: selectedSessionId.length > 0 && selectedColumnId.length > 0,
    retry: false
  });

  const mappingsQuery = useQuery({
    queryKey: ["discover", "mappings", selectedSessionId],
    queryFn: async () => (await discoverApi.listMappings(selectedSessionId)).items,
    enabled: selectedSessionId.length > 0
  });

  // Findings from the last data-quality run, read back from Postgres.
  const qualityReportQuery = useQuery({
    queryKey: ["discover", "quality", selectedSessionId],
    queryFn: async () => discoverApi.getQualityReport(selectedSessionId),
    enabled: selectedSessionId.length > 0
  });

  /**
   * How far the quality run has got.
   *
   * Polled only while something is actually working, so a finished session
   * costs one request when it opens and nothing after. Asking is also what
   * restarts a run the server dropped — which is why reopening the page is
   * enough to pick a broken one back up, and why the percentage carries on
   * from where it was rather than starting again.
   */
  const qualityProgressQuery = useQuery({
    queryKey: ["discover", "qualityProgress", selectedSessionId],
    queryFn: () => discoverApi.qualityProgress(selectedSessionId),
    enabled: selectedSessionId.length > 0,
    refetchInterval: (query) => (query.state.data?.is_working ? 1000 : false),
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
  });

  const startQualityRunMutation = useMutation({
    mutationFn: async () => discoverApi.startQualityRun(selectedSessionId),
    onSuccess: (report) => {
      // Show the queued tables at once rather than waiting for the next poll.
      queryClient.setQueryData(["discover", "qualityProgress", selectedSessionId], report);
    },
  });

  // When a run settles, everything downstream of it is stale: the findings,
  // the rule roll-up, the per-table counts on the tab strip.
  const qualityWasWorking = useRef(false);
  useEffect(() => {
    const working = qualityProgressQuery.data?.is_working ?? false;
    if (qualityWasWorking.current && !working) {
      void invalidateSessionScope();
    }
    qualityWasWorking.current = working;
  }, [qualityProgressQuery.data?.is_working]);

  // The same run, read by rule instead of by field, and across every table
  // rather than the one on screen. "Which rule is failing most" is not a
  // question about the active table, so it cannot be answered from it.
  const qualityByRuleQuery = useQuery({
    queryKey: ["discover", "qualityByRule", selectedSessionId],
    queryFn: async () => discoverApi.getQualityByRule(selectedSessionId),
    enabled: selectedSessionId.length > 0
  });

  // Every run the session has completed. A run is kept rather than
  // overwritten, so this is the evidence trail: how many times the session was
  // checked, what each check found, and the rules and mapping it used.
  const qualityRunsQuery = useQuery({
    queryKey: ["discover", "qualityRuns", selectedSessionId],
    queryFn: async () => discoverApi.getQualityRuns(selectedSessionId),
    enabled: selectedSessionId.length > 0
  });

  // Which governed rules this session has determined and configured.
  const governedRulesQuery = useQuery({
    queryKey: ["discover", "governedRules", selectedSessionId],
    queryFn: async () => discoverApi.getGovernedRules(selectedSessionId),
    enabled: selectedSessionId.length > 0
  });

  // The Support Domain models the Rule Builder can draw governance from. These
  // belong to the catalogue rather than to a session, so they are cached once
  // and shared by every session the user opens.
  const supportModelsQuery = useQuery({
    queryKey: ["discover", "ruleBuilder", "supportModels"],
    queryFn: async () => (await discoverApi.listRuleBuilderSupportModels()).models,
    staleTime: 5 * 60 * 1000
  });

  const resultsQuery = useQuery({
    queryKey: ["discover", "results", selectedSessionId, severityFilter],
    queryFn: async () =>
      (await discoverApi.listResults(selectedSessionId, severityFilter === "all" ? undefined : severityFilter)).items,
    enabled: selectedSessionId.length > 0
  });

  // Candidate mapping targets: pulled from Structure's node INSTANCES (the same
  // hierarchy_model_node_instance space that column_mapping.target_node_id resolves
  // against), not the Model's node-type diagram — those are two different id spaces.
  const canonicalTargetsQuery = useQuery({
    queryKey: ["structure", "discoverTargets", "mdl_business_information"],
    queryFn: async () => (await structureApi.listNodesForModel("mdl_business_information")).items,
    enabled: selectedSessionId.length > 0
  });

  // The model fields a column can be mapped to: everything beneath the source
  // application chosen for this session, so the Mapping step only offers fields
  // that belong to that application.
  const mappingApplicationRefId = sourceContextQuery.data?.application_ref_id ?? "";
  const applicationFieldsQuery = useQuery({
    queryKey: ["discover", "applicationFields", mappingApplicationRefId],
    queryFn: async () => (await discoverApi.listApplicationFields(mappingApplicationRefId)).items,
    enabled: mappingApplicationRefId.length > 0
  });


  // ── Mutations ──
  /**
   * Neither the session list nor the retention status is keyed on a session
   * id, so `invalidateSessionScope` reaches neither — and both have just
   * changed: the session moved between the two lists, and Admin's "sessions
   * archived" counter is now one out.
   */
  const refreshAfterArchiveChange = async () => {
    await queryClient.invalidateQueries({ queryKey: ["discover", "sessions"] });
    await queryClient.invalidateQueries({ queryKey: ["discover", "retention"] });
    await invalidateSessionScope();
  };

  const archiveSessionMutation = useMutation({
    mutationFn: () => discoverApi.archiveSession(selectedSessionId),
    onSuccess: refreshAfterArchiveChange
  });

  const restoreSessionMutation = useMutation({
    mutationFn: () => discoverApi.restoreSession(selectedSessionId),
    onSuccess: refreshAfterArchiveChange
  });

  const createSessionMutation = useMutation({
    mutationFn: async (payload: CreateDiscoverySessionCommand) => discoverApi.createSession(payload),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["discover", "sessions"] });
      setSelectedSessionId(response.session.session_id);
    }
  });

  const attachSourceFileMutation = useMutation({
    mutationFn: async (payload: AttachSourceFileCommand) => discoverApi.attachSourceFile(selectedSessionId, payload),
    onSuccess: async () => {
      setImportConfirmed(false);
      await queryClient.invalidateQueries({ queryKey: ["discover", "sourceFile", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] });
    }
  });

  const replaceSourceFileMutation = useMutation({
    mutationFn: async (payload: AttachSourceFileCommand) => discoverApi.replaceSourceFile(selectedSessionId, payload),
    onSuccess: async () => {
      setImportConfirmed(false);
      await queryClient.invalidateQueries({ queryKey: ["discover", "sourceFile", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "auditTrail", selectedSessionId] });
    }
  });

  const invalidateSessionScope = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "discover" && query.queryKey.includes(selectedSessionId)
    });
  };

  /**
   * How far each uploaded file has got.
   *
   * Polled only while something is actually working, so an idle session costs
   * one request when it opens and nothing after. Asking is also what restarts
   * an import the server dropped — which is why a reload is enough to pick a
   * broken one back up.
   */
  const importProgressQuery = useQuery({
    queryKey: ["discover", "importProgress", selectedSessionId],
    queryFn: () => discoverApi.importProgress(selectedSessionId),
    enabled: selectedSessionId.length > 0,
    refetchInterval: (query) => (query.state.data?.is_working ? 1200 : false),
    // Keep asking even when the tab is in the background. A browser pauses
    // timers in a hidden tab, and an import is exactly the thing a person
    // starts and then looks away from — coming back to a frozen bar that says
    // "reading 4 files" long after they were read is worse than no bar.
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
  });

  /**
   * When the last job settles, the session holds tables it did not hold a
   * moment ago — so everything that lists them is stale exactly once, here.
   */
  const wasWorking = useRef(false);
  useEffect(() => {
    const working = !!importProgressQuery.data?.is_working;
    if (wasWorking.current && !working) {
      void invalidateSessionScope();
    }
    wasWorking.current = working;
  }, [importProgressQuery.data?.is_working]);

  const runImportMutation = useMutation({
    mutationFn: async () => discoverApi.runImport(selectedSessionId),
    onSuccess: async (report) => {
      setImportConfirmed(true);
      queryClient.setQueryData(["discover", "importProgress", selectedSessionId], report);
    }
  });

  // Uploads the real file bytes; the server parses and stores the rows.
  /**
   * Files going up, with a bar each.
   *
   * Not a react-query mutation: a mutation has one pending flag for the whole
   * batch, and what this screen needs is a row per file with its own
   * percentage. An upload only puts a file down and records a job — nothing is
   * read yet — so all that changes on the server is the queue.
   */
  const fileUploads = useSourceFileUploads(selectedSessionId, async () => {
    setImportConfirmed(false);
    await queryClient.invalidateQueries({
      queryKey: ["discover", "importProgress", selectedSessionId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["discover", "sourceFiles", selectedSessionId],
    });
  });

  /**
   * Switch the model this file is mapped to, clearing the pairings first.
   *
   * It lives here rather than in the Mapping screen because the model is a
   * property of the session, and it is now chosen from the table strip along
   * the bottom as well as from the Mapping header — two screens cannot own one
   * decision between them.
   *
   * The pairings point at fields of the model being left behind and cannot
   * come along; the server refuses the switch while they exist, and rightly.
   * Clearing them here is what makes the switch legitimate rather than a way
   * around the rule — the caller is expected to have asked first.
   */
  const changeModelMutation = useMutation({
    mutationFn: async (model: { application_name: string; application_ref_id: string }) => {
      // Only the open table's pairings go.
      //
      // The model belongs to the table, not the session: one upload can hold
      // five files read against five different models, and choosing one for
      // the fifth must leave the four already mapped alone. The pairings that
      // have to go are the ones pointing at fields of the model this table is
      // leaving — which is this table's, and no other's.
      const ofThisTable = new Set((columnsQuery.data ?? []).map((c) => c.column_id));
      const paired = (mappingsQuery.data ?? []).filter(
        (m) => m.target_node_id && ofThisTable.has(m.column_id),
      );
      for (const mapping of paired) {
        await discoverApi.clearMapping(selectedSessionId, mapping.column_id);
      }
      return discoverApi.setSourceContext(selectedSessionId, {
        source_application: model.application_name,
        application_ref_id: model.application_ref_id,
      });
    },
    onSuccess: async () => {
      setSelectedTargetNodeId("");
      await invalidateSessionScope();
    }
  });

  /**
   * Profile every table of the session, not only the one on screen.
   *
   * Nothing downstream can start on a table until it has been profiled, so a
   * seven-sheet workbook needed seven visits to the same button before any of
   * it could be used. One run, every table.
   */
  const profileAllMutation = useMutation({
    mutationFn: async () => discoverApi.profileAllTables(selectedSessionId),
    onSuccess: async () => {
      setSelectedColumnId("");
      await invalidateSessionScope();
    }
  });

  /** Remove an uploaded file and every table it produced. */
  const removeUploadMutation = useMutation({
    mutationFn: async (filename: string) => discoverApi.removeUpload(selectedSessionId, filename),
    onSuccess: async () => {
      setSelectedColumnId("");
      setSelectedTargetNodeId("");
      await invalidateSessionScope();
    }
  });

  const setSourceContextMutation = useMutation({
    mutationFn: async (payload: SetSourceContextCommand) => discoverApi.setSourceContext(selectedSessionId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["discover", "sourceContext", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] });
    }
  });

  const startImportMutation = useMutation({
    mutationFn: async (sourceFileId: string) => discoverApi.startImport(selectedSessionId, sourceFileId),
    onSuccess: async () => {
      setImportConfirmed(true);
      await queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "discoveryColumns", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "session", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "auditTrail", selectedSessionId] });
    }
  });

  const validateImportMutation = useMutation({
    mutationFn: async (payload: ValidateImportCommand) => discoverApi.runValidation(selectedSessionId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["discover", "validation", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "discoveryColumns", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] });
    }
  });

  // Legacy MVP mutations — seeded with REAL columns from discovery_column.
  // Triggered explicitly from the Profile step's "Run Profiling" action.
  const importSeedMutation = useMutation({
    mutationFn: async (payload?: { row_count?: number; columns?: Array<{ column_name: string; detected_type: string; sample_values: string[] }> }) => {
      // Use provided real columns; if empty fall back to a single placeholder
      // so the legacy source_column table has at least one row.
      // NOTE: sample_values must be non-empty — the backend rejects an empty
      // list (min_length=1) — so an empty/unknown sample always falls back to "N/A".
      const providedColumns = (payload?.columns ?? []).map((c) => ({
        ...c,
        sample_values: c.sample_values.length > 0 ? c.sample_values : ["N/A"],
      }));
      const columns = providedColumns.length > 0
        ? providedColumns
        : [{ column_name: "(no columns)", detected_type: "text", sample_values: ["N/A"] }];
      // row_count reflects the *real* number of data rows in the source file
      // when the caller has it (from client-side CSV parsing). Falling back to
      // columns.length only covers the placeholder/no-file-parsed case.
      return discoverApi.importDataset(selectedSessionId, {
        source_name: "imported_file",
        row_count: payload?.row_count ?? columns.length,
        columns,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["discover", "columns", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "results", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "discoveryColumns", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "auditTrail", selectedSessionId] })
      ]);
    }
  });

  // Server-side profiling: reads the rows persisted in Postgres and computes
  // real column count, row count, missing/non-missing and distinct values.
  const runProfilingMutation = useMutation({
    mutationFn: async () => discoverApi.runProfiling(selectedSessionId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["discover", "discoveryColumns", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "columns", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "columnProfile", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "validation", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "sourceFile", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "session", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "auditTrail", selectedSessionId] }),
      ]);
    }
  });

  // Persists the validated/normalised column list into discovery_column
  // (AC-DWS-COLUMN-001..004) so refresh/reopen rehydrates real column
  // metadata instead of recomputing it from client state.
  const persistDiscoveryColumnsMutation = useMutation({
    mutationFn: async (payload: { sourceFileId: string; normalisedColumns: Array<Record<string, unknown>> }) =>
      discoverApi.persistDiscoveryColumns(selectedSessionId, payload.sourceFileId, payload.normalisedColumns),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["discover", "discoveryColumns", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "overview", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["discover", "auditTrail", selectedSessionId] }),
      ]);
    }
  });

  // Mapping writes take their ids explicitly: column_mapping.column_id is a
  // source_column id (col_…), which is a different id space from the
  // discovery_column ids (dc_…) the Profile step selects on.
  const saveMappingMutation = useMutation({
    mutationFn: async (payload: { columnId: string; targetNodeId: string; rationale?: string }) =>
      discoverApi.upsertMapping(selectedSessionId, {
        column_id: payload.columnId,
        target_node_id: payload.targetNodeId,
        mapping_state: "confirmed",
        confidence: 1,
        rationale: payload.rationale ?? "Mapped in Discover"
      }),
    onSuccess: async () => {
      // Pairing a column changes what half the session shows — the Rules step
      // is a list of mapped fields, the table tabs count what is mapped, the
      // overview reports it. This used to name the queries one at a time, and
      // it named the *old* rules screen: the one in use reads a different key,
      // so it went on answering "nothing is mapped yet" long after the mapping
      // was saved. A predicate cannot fall out of date with the screens the
      // way a list of names can.
      await invalidateSessionScope();
    }
  });

  const clearMappingMutation = useMutation({
    mutationFn: async (columnId: string) => discoverApi.clearMapping(selectedSessionId, columnId),
    onSuccess: async () => {
      // Unpairing is the same event read backwards, so it reaches as far.
      await invalidateSessionScope();
    }
  });

  // Checks the stored data against the model structure, for mapped fields only.
  /**
   * Check every mapped table, not only the one on screen — the same reason
   * profiling runs everywhere: a table nobody revisited reports nothing, which
   * reads exactly like nothing being wrong with it.
   */
  const runQualityChecksEverywhereMutation = useMutation({
    mutationFn: async () => discoverApi.runQualityChecksEverywhere(selectedSessionId),
    onSuccess: async () => {
      await invalidateSessionScope();
    }
  });

  const runQualityChecksMutation = useMutation({
    mutationFn: async () => discoverApi.runQualityChecks(selectedSessionId),
    onSuccess: async () => {
      // Findings are counted per table on the tabs, so a run is not only the
      // Quality screen's business.
      await invalidateSessionScope();
    }
  });

  // ── Governed layer mutations ──
  // Every one of these writes on the server and returns the fresh report, so
  // the cache is set from the response rather than refetched.
  const determineGovernedRulesMutation = useMutation({
    mutationFn: async () => discoverApi.determineGovernedRules(selectedSessionId),
    onSuccess: async (report) => {
      queryClient.setQueryData(["discover", "governedRules", selectedSessionId], report);
      await queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ["discover", "auditTrail", selectedSessionId] });
    }
  });

  const configureGovernedRuleMutation = useMutation({
    mutationFn: async (payload: {
      ruleId: string;
      columnId?: string;
      isEnabled?: boolean | null;
      severity?: string | null;
      parameters?: Record<string, unknown>;
    }) =>
      discoverApi.configureGovernedRule(selectedSessionId, {
        rule_id: payload.ruleId,
        column_id: payload.columnId ?? "",
        is_enabled: payload.isEnabled ?? null,
        severity: payload.severity ?? null,
        parameters: payload.parameters ?? {}
      }),
    onSuccess: (report) => {
      queryClient.setQueryData(["discover", "governedRules", selectedSessionId], report);
    }
  });

  /**
   * Finish the Rule Builder. The whole batch lands or none of it does, so the
   * report that comes back is written straight into the rules cache — every new
   * rule is visible the moment the dialog closes rather than after a refetch.
   */
  const buildRulesMutation = useMutation({
    mutationFn: async (payload: {
      supportModelId: string;
      relationshipTypeIds: string[];
      selections: RuleSelection[];
    }) =>
      discoverApi.buildRules(selectedSessionId, {
        support_model_id: payload.supportModelId,
        relationship_type_ids: payload.relationshipTypeIds,
        selections: payload.selections
      }),
    onSuccess: async (report) => {
      queryClient.setQueryData(["discover", "governedRules", selectedSessionId], report);
      await queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] });
    }
  });

  const removeGovernedRuleMutation = useMutation({
    mutationFn: async (payload: { ruleId: string; columnId?: string }) =>
      discoverApi.removeGovernedRule(selectedSessionId, {
        rule_id: payload.ruleId,
        column_id: payload.columnId ?? ""
      }),
    onSuccess: async (report) => {
      queryClient.setQueryData(["discover", "governedRules", selectedSessionId], report);
      await queryClient.invalidateQueries({ queryKey: ["discover", "audit", selectedSessionId] });
    }
  });


  // Pairs columns with model fields automatically. Existing mappings are left
  // alone by the server, so this never overwrites a decision the user made.
  const autoMapMutation = useMutation({
    mutationFn: async () => discoverApi.autoMap(selectedSessionId),
    onSuccess: async () => {
      // Auto map pairs many columns at once: everything one pairing touches,
      // several dozen times over.
      await invalidateSessionScope();
    }
  });

  /**
   * Everything a session derives from a file belongs to that file, so changing
   * which file is active changes what every step shows. Rather than list the
   * dozen affected queries, invalidate the whole session subtree.
   */
  const activateSourceFileMutation = useMutation({
    mutationFn: async (sourceFileId: string) =>
      discoverApi.activateSourceFile(selectedSessionId, sourceFileId),
    onSuccess: async () => {
      setSelectedColumnId("");
      setSelectedTargetNodeId("");
      await invalidateSessionScope();
    }
  });

  const removeSourceFileMutation = useMutation({
    mutationFn: async (sourceFileId: string) =>
      discoverApi.removeSourceFile(selectedSessionId, sourceFileId),
    onSuccess: async () => {
      setSelectedColumnId("");
      setSelectedTargetNodeId("");
      await invalidateSessionScope();
    }
  });

  const runChecksMutation = useMutation({
    mutationFn: async () => discoverApi.runChecks(selectedSessionId),
    onSuccess: async () => {
      await invalidateSessionScope();
    }
  });

  const selectedMapping = useMemo(
    () => mappingsQuery.data?.find((mapping) => mapping.column_id === selectedColumnId) ?? null,
    [mappingsQuery.data, selectedColumnId]
  );

  return {
    // State
    selectedSessionId, setSelectedSessionId,
    selectedColumnId, setSelectedColumnId,
    selectedTargetNodeId, setSelectedTargetNodeId,
    severityFilter, setSeverityFilter,
    importConfirmed,

    // W2-DWS Queries
    sessionsQuery,
    currentSessionQuery,
    archiveEligibilityQuery,
    archiveSessionMutation,
    restoreSessionMutation,
    overviewQuery,
    sourceFileQuery,
    sourceContextQuery,
    validationResultQuery,
    discoveryColumnsQuery,
    datasetQuery,
    datasetDuplicatesQuery,
    structureApplicationsQuery,
    structureModulesQuery,
    auditQuery,
    auditTrailQuery,
    sourceFilesQuery,
    importProgressQuery,

    // Legacy Queries
    columnsQuery,
    columnProfileQuery,
    mappingsQuery,
    resultsQuery,
    qualityReportQuery,
    qualityByRuleQuery,
    qualityRunsQuery,
    qualityProgressQuery,
    startQualityRunMutation,
    governedRulesQuery,
    supportModelsQuery,
    canonicalTargetsQuery,
    applicationFieldsQuery,
    mappingApplicationRefId,

    // W2-DWS Mutations
    createSessionMutation,
    attachSourceFileMutation,
    replaceSourceFileMutation,
    fileUploads,
    runImportMutation,
    runProfilingMutation,
    setSourceContextMutation,
    changeModelMutation,
    profileAllMutation,
    removeUploadMutation,
    startImportMutation,
    validateImportMutation,

    // Legacy Mutations
    importSeedMutation,
    persistDiscoveryColumnsMutation,
    saveMappingMutation,
    clearMappingMutation,
    runChecksMutation,
    runQualityChecksMutation,
    runQualityChecksEverywhereMutation,

    // Governed layer
    determineGovernedRulesMutation,
    configureGovernedRuleMutation,
    buildRulesMutation,
    removeGovernedRuleMutation,
    autoMapMutation,
    activateSourceFileMutation,
    removeSourceFileMutation,

    // Expose API client so panels can make ad-hoc reads (e.g. listDiscoveryColumns before seeding)
    discoverApi,

    // Derived
    selectedMapping
  };
}
