"""
Discover API router — W2-DWS-FEATURE-01 + legacy MVP endpoints.

New W2-DWS endpoints are clearly separated from the MVP endpoints that
the current frontend still depends on.  All session mutations go through
authoritative services — the UI never acts as persisted truth.
"""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status

from app.dependencies import get_database_url
from features.discover.domain.models import (
    StructureInstanceQualityCommand,
    AttachSourceFileCommand,
    BuildRulesCommand,
    ConfigureRuleCommand,
    RemoveRuleCommand,
    ConfirmClassificationsCommand,
    CreateDiscoverySessionCommand,
    ImportDatasetCommand,
    RunChecksCommand,
    SetFieldRulesCommand,
    SetSourceContextCommand,
    SetValueClassificationCommand,
    StartImportCommand,
    UpdateRetentionPolicyCommand,
    UpsertColumnMappingCommand,
    ValidateImportCommand,
)
from features.discover.service.discover_import_service import (
    DiscoverImportService,
    SourceContextLocked,
    StructureApplicationContextReadService,
)
from features.discover.service.discover_session_service import (
    DiscoverOverviewReadService,
    DiscoverSessionReadService,
    DiscoverSessionService,
)
from features.discover.service.discover_validation_service import (
    DiscoverColumnService,
    DiscoverValidationService,
)
from features.discover.service.discover_dataset_service import DiscoverDatasetService
from features.discover.service.discover_source_application_service import (
    DiscoverSourceApplicationService,
    SourceApplicationInvalid,
    SourceApplicationNeedsConfirmation,
    SourceApplicationNotFound,
)
from features.discover.service.discover_governance_service import (
    DiscoverGovernanceService,
)
from features.discover.service.discover_rule_library_service import (
    DiscoverRuleLibraryService,
)
from features.discover.service.discover_rule_builder_service import (
    DiscoverRuleBuilderService,
)
from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_retention_repository import (
    DiscoverRetentionRepository,
)
from features.discover.service.retention_sweeper import get_retention_sweeper
# Legacy MVP service (kept for backward-compat until UI migration complete)
from features.discover.service.discover_services import DiscoverService
from features.discover.service.discover_structure_service import (
    DiscoverStructureService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discover", tags=["discover"])


# ── Dependency helpers ────────────────────────────────────────────────────────

def _session_svc(db_url: str = Depends(get_database_url)) -> DiscoverSessionService:
    return DiscoverSessionService(db_url)


def _session_read_svc(db_url: str = Depends(get_database_url)) -> DiscoverSessionReadService:
    return DiscoverSessionReadService(db_url)


def _overview_svc(db_url: str = Depends(get_database_url)) -> DiscoverOverviewReadService:
    return DiscoverOverviewReadService(db_url)


def _import_svc(db_url: str = Depends(get_database_url)) -> DiscoverImportService:
    return DiscoverImportService(db_url)


def _structure_svc(db_url: str = Depends(get_database_url)) -> StructureApplicationContextReadService:
    return StructureApplicationContextReadService(db_url)


def _validation_svc(db_url: str = Depends(get_database_url)) -> DiscoverValidationService:
    return DiscoverValidationService(db_url)


def _column_svc(db_url: str = Depends(get_database_url)) -> DiscoverColumnService:
    return DiscoverColumnService(db_url)


def _dataset_svc(db_url: str = Depends(get_database_url)) -> DiscoverDatasetService:
    return DiscoverDatasetService(db_url)


def _governance_svc(db_url: str = Depends(get_database_url)) -> DiscoverGovernanceService:
    return DiscoverGovernanceService(db_url)


def _rule_builder_svc(db_url: str = Depends(get_database_url)) -> DiscoverRuleBuilderService:
    return DiscoverRuleBuilderService(db_url)


def _legacy_svc(db_url: str = Depends(get_database_url)) -> DiscoverService:
    return DiscoverService(db_url)


def _audit_repo(db_url: str = Depends(get_database_url)) -> DiscoverAuditRepository:
    return DiscoverAuditRepository(db_url)


# ─────────────────────────────────────────────────────────────────────────────
# W2-DWS-FEATURE-01: Session endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/sessions")
def list_sessions(
    archived: bool | None = Query(
        default=None,
        description="true for archived sessions only, false for live ones, "
                    "omitted for both.",
    ),
    svc: DiscoverSessionReadService = Depends(_session_read_svc),
):
    """
    Return persisted discovery sessions for the session selector dropdown.
    AC-DWS-SHELL-001: shell loads from backend state only.

    Asking for progress is what catches up a missed retention sweep elsewhere;
    here, listing sessions is the natural moment — it is the first call the
    shell makes, and a session due for deletion should not be listed as though
    it were still there.
    """
    _sweep_if_due()
    return svc.list_sessions(archived=archived)


def _sweep_if_due() -> None:
    """
    Run the retention sweep if today's is owed, and never fail a request for it.

    The background thread is the normal path. This is the catch-up for a
    process that was asleep or CPU-throttled at the appointed hour, which on
    App Runner is most of the night.
    """
    try:
        get_retention_sweeper(get_database_url()).sweep_if_due()
    except Exception:  # a retention sweep must never break someone's page
        logger.exception("Retention catch-up sweep failed")


@router.post("/sessions/{session_id}/archive")
def archive_session(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverSessionService = Depends(_session_svc),
):
    """
    Put a finished session away. Nothing is deleted until its retention runs out.

    Refused until the quality checks have run at least once: archiving retires
    finished work, and an unchecked session is not finished.
    """
    try:
        return svc.archive_session(session_id, actor=actor)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/restore")
def restore_session(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverSessionService = Depends(_session_svc),
):
    """Take a session back out of the archive and stop its countdown."""
    try:
        return svc.restore_session(session_id, actor=actor)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/archive-eligibility")
def archive_eligibility(
    session_id: str,
    svc: DiscoverSessionReadService = Depends(_session_read_svc),
):
    """
    Whether this session can be archived, and the reason when it cannot.

    The button asks instead of deciding for itself, so the screen and the
    endpoint cannot disagree about what "finished" means.
    """
    return svc.can_archive(session_id)


# ─────────────────────────────────────────────────────────────────────────────
# Retention: how long an archived session is kept, and when the sweep runs
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/retention")
def retention_status():
    """
    The policy, when the sweep last ran, when it runs next, and how much is
    waiting. Everything the Admin page needs to explain itself.
    """
    _sweep_if_due()
    return get_retention_sweeper(get_database_url()).status()


@router.put("/retention")
def update_retention(
    command: UpdateRetentionPolicyCommand,
    actor: str = Query(default="admin"),
):
    """
    Set how many days an archived session is kept, and the UTC hour to sweep.

    Both are clamped rather than refused — 1 to 31 days, 0 to 23 hours — so a
    stored value can never put the job outside its own policy.
    """
    sweeper = get_retention_sweeper(get_database_url())
    DiscoverRetentionRepository(get_database_url()).set_policy(
        retention_days=command.retention_days,
        purge_hour_utc=command.purge_hour_utc,
    )
    DiscoverAuditRepository(get_database_url()).record(
        actor=actor,
        action="retention.policy_updated",
        outcome="success",
        detail={
            "retention_days": command.retention_days,
            "purge_hour_utc": command.purge_hour_utc,
        },
    )
    return sweeper.status()


@router.post("/retention/run")
def run_retention_now(actor: str = Query(default="admin")):
    """Sweep now, without waiting for the hour. The Admin page's Run now."""
    sweeper = get_retention_sweeper(get_database_url())
    outcome = sweeper.sweep_now(actor=actor)
    return {**outcome, "status": sweeper.status()}


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def create_session(
    command: CreateDiscoverySessionCommand,
    actor: str = Query(default="system"),
    svc: DiscoverSessionService = Depends(_session_svc),
):
    """Create a new discovery session. AC-DWS-SHELL-001."""
    return svc.create_session(command, actor=actor)


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverSessionService = Depends(_session_svc),
):
    """
    Remove a session and everything derived from it — files, rows, columns,
    mappings, rules and findings all hang off it and go with it.
    """
    try:
        return svc.delete_session(session_id, actor=actor)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}")
def get_session(
    session_id: str,
    svc: DiscoverSessionReadService = Depends(_session_read_svc),
):
    """
    Return a single session for rehydration after refresh.
    AC-DWS-SHELL-002: selected session context rehydrates from backend.
    """
    session = svc.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Discovery session not found.")
    return {"session": session}


@router.get("/sessions/{session_id}/audit")
def list_audit_events(
    session_id: str,
    # The Recent Activity panel asks for ten; the Review step asks for the whole
    # trail, because a partial record is not evidence.
    limit: int = Query(default=10, ge=1, le=500),
    repo: DiscoverAuditRepository = Depends(_audit_repo),
):
    """
    Return the most recent audit events for a session (Recent Activity panel,
    and the full trail behind the Review Results / Evidence step).
    AC-DWS-AUDIT-IMPORT-001.
    """
    events = repo.list_events(session_id, limit=limit)
    return {"items": events}


@router.get("/sessions/{session_id}/overview")
def get_overview(
    session_id: str,
    svc: DiscoverOverviewReadService = Depends(_overview_svc),
):
    """
    Return the aggregated Overview read model (all 7 panels) for a session.
    AC-DWS-SHELL-002, AC-DWS-SHELL-003, AC-DWS-SHELL-004.
    Returns controlled empty-state values when no data exists — never placeholder.
    """
    svc_read = DiscoverSessionReadService.__new__(DiscoverSessionReadService)
    # Quick existence check using the overview service's internal sessions repo
    return svc.get_overview(session_id)


# ─────────────────────────────────────────────────────────────────────────────
# W2-DWS-FEATURE-01: Import endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/files", status_code=status.HTTP_201_CREATED)
def attach_source_file(
    session_id: str,
    command: AttachSourceFileCommand,
    svc: DiscoverImportService = Depends(_import_svc),
):
    """
    Attach a source file to a discovery session and persist all metadata.
    AC-DWS-IMPORT-001, AC-DWS-IMPORT-007.
    """
    try:
        return svc.attach_source_file(session_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/files")
def get_source_file(
    session_id: str,
    svc: DiscoverImportService = Depends(_import_svc),
):
    """Return the latest source file attached to a session. AC-DWS-IMPORT-001."""
    return svc.get_source_file(session_id)


@router.put("/sessions/{session_id}/files")
def replace_source_file(
    session_id: str,
    command: AttachSourceFileCommand,
    svc: DiscoverImportService = Depends(_import_svc),
):
    """
    Replace the existing source file for a session with a new one.

    Removes all prior source file records (audit-logged) then attaches the
    new file.  The user must re-run import to regenerate profile/mapping/DQ.
    """
    try:
        return svc.replace_source_file(session_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc



@router.post("/sessions/{session_id}/context")
def set_source_context(
    session_id: str,
    command: SetSourceContextCommand,
    actor: str = Query(default="system"),
    svc: DiscoverImportService = Depends(_import_svc),
):
    """
    Persist selected source application/module for a session.
    Discover reads Structure read-only; this stores only the selection.
    AC-DWS-IMPORT-003, AC-DWS-IMPORT-006.
    """
    try:
        return svc.set_source_context(session_id, command, actor=actor)
    except SourceContextLocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/context")
def get_source_context(
    session_id: str,
    svc: DiscoverImportService = Depends(_import_svc),
):
    """Return the persisted source application/module context. AC-DWS-IMPORT-004."""
    return svc.get_source_context(session_id)


@router.post("/sessions/{session_id}/start-import")
def start_import(
    session_id: str,
    command: StartImportCommand,
    svc: DiscoverImportService = Depends(_import_svc),
):
    """
    Gate: validates that source application/module is selected before proceeding.
    Returns a handoff token/signal for the governed W2-DWS-02 import flow.
    AC-DWS-SHELL-006, AC-DWS-IMPORT-002, AC-DWS-IMPORT-005.
    """
    try:
        svc.validate_start_import_preconditions(session_id, command.source_file_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # Handoff to W2-DWS-02 governed import flow
    return {
        "session_id": session_id,
        "source_file_id": command.source_file_id,
        "status": "import_initiated",
        "message": "Import preconditions satisfied. Proceeding to governed import flow.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# W2-DWS-FEATURE-01: Source file content — upload, parse, profile, preview
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/files/upload", status_code=status.HTTP_201_CREATED)
async def upload_source_file(
    session_id: str,
    request: Request,
    filename: str = Query(..., min_length=1),
    uploaded_by: str = Query(default="user"),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Receive the raw bytes of a CSV/Excel file, parse it server-side, and persist
    its real headers and rows to Postgres as JSON.

    The body is the file itself (Content-Type is ignored), so no multipart
    dependency is required. The file is read for the tables it holds — a
    workbook's sheets, a CSV's stacked blocks — and each becomes a source of
    the session. Re-uploading the same file replaces every table it produced.
    """
    raw = await request.body()
    try:
        return svc.upload_source_file(
            session_id, filename=filename, raw=raw, uploaded_by=uploaded_by
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/import/run")
def run_import(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Start structuring every file this session has uploaded.

    The request returns as soon as the work is handed to the workers; what
    happens next is read from /import/progress.
    """
    try:
        return svc.start_import(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/import/progress")
def import_progress(
    session_id: str,
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    How far each uploaded file has got.

    Asking also restarts anything that was dropped — a reload is enough to get
    an interrupted import moving again.
    """
    return svc.import_progress(session_id)


@router.post("/sessions/{session_id}/profile-all")
def run_profiling_everywhere(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Profile every table of the session in one run, reporting each one's result.

    A table that fails validation is reported beside the others rather than
    stopping them: six good tables and one bad one is an ordinary file.
    """
    try:
        return svc.run_profiling_everywhere(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/profile")
def run_profiling(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Profile the persisted rows for a session: validate the file's real shape,
    persist discovery columns, and compute per-column row/missing/distinct
    statistics in Postgres.
    """
    try:
        return svc.run_profiling(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/rule-governance/fields")
def list_governed_field_rules(session_id: str, db_url=Depends(get_database_url)):
    """
    The Rules step, resolved from governance rather than asked.

    Each mapped field comes back with the rules its concept's governed
    vocabularies carry, required first. A field whose governance reaches
    nothing comes back empty, with `empty_reason` saying which of the three
    possible gaps it is — unmapped, or mapped to a property nothing has been
    linked to.
    """
    from features.discover.service.discover_governed_rules_service import (
        DiscoverGovernedRulesService,
    )

    try:
        return DiscoverGovernedRulesService(db_url).list_field_rules(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/sessions/{session_id}/rule-governance/fields/{column_id}")
def set_governed_field_rules(
    session_id: str,
    column_id: str,
    property_rule_ids: list[str] = Body(embed=True),
    actor: str = Query(default="user"),
    db_url=Depends(get_database_url),
):
    """
    Run exactly these governed rules on this field.

    A rule the field's governance does not carry is refused: the point of the
    step is that the set of runnable rules comes from governance, and a route
    around that would make the guarantee meaningless.
    """
    from features.discover.service.discover_governed_rules_service import (
        DiscoverGovernedRulesService,
    )

    try:
        return DiscoverGovernedRulesService(db_url).set_field_rules(
            session_id, column_id, property_rule_ids, actor=actor
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/rule-library/fields")
def list_rule_library_fields(session_id: str, db_url=Depends(get_database_url)):
    """Each mapped field, the library rules on it, and the ones it could have."""
    try:
        return DiscoverRuleLibraryService(db_url).list_fields(session_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/sessions/{session_id}/rule-library/fields/{column_id}")
def set_rule_library_field_rules(
    session_id: str,
    column_id: str,
    command: SetFieldRulesCommand,
    actor: str = Query(default="user"),
    db_url=Depends(get_database_url),
):
    """Make the rules on one field exactly the ones chosen."""
    try:
        return DiscoverRuleLibraryService(db_url).set_field_rules(
            session_id, column_id, command.rule_definition_ids, actor=actor
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/sessions/{session_id}/rule-library/record-rules")
def set_rule_library_record_rules(
    session_id: str,
    command: SetFieldRulesCommand,
    actor: str = Query(default="user"),
    db_url=Depends(get_database_url),
):
    """The same, for rules that read whole records."""
    try:
        return DiscoverRuleLibraryService(db_url).set_record_rules(
            session_id, command.rule_definition_ids, actor=actor
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/quality/run-all")
def run_quality_checks_everywhere(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Run the checks on every mapped table of the session, reporting each result.

    A table with nothing mapped is skipped and named, not treated as a failure:
    it is a step not taken rather than a fault in the data.
    """
    try:
        return svc.run_quality_checks_everywhere(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/quality/start")
def start_quality_run(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Queue a check for every table and return at once. The workers run the
    tables together; the screen watches `quality/progress`.
    """
    try:
        return svc.start_quality_run(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/quality/progress")
def quality_progress(
    session_id: str,
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    How far the run has got, table by table. Asking also restarts a run the
    server dropped, so reopening the page picks it back up.
    """
    return svc.quality_progress(session_id)


@router.post("/sessions/{session_id}/quality/run")
def run_quality_checks(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Check the stored data against the model structure. Only columns mapped to a
    model field are checked; rules come from the structure node's declared
    properties plus the field's datatype.
    """
    try:
        return svc.run_quality_checks(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/quality/by-rule")
def get_quality_by_rule(
    session_id: str,
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    The last run's findings grouped by the rule that produced them, across
    every table of the session — which rules ran, which are failing, how
    severe each one is, and the tables and fields where it broke.
    """
    return svc.quality_by_rule(session_id)


@router.get("/sessions/{session_id}/quality/runs")
def list_quality_runs(
    session_id: str,
    source_file_id: str = Query(default=""),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Every quality run the session holds, newest first — the evidence trail.

    A run is kept rather than overwritten, so this answers "what did we know
    on the 14th, and what did we measure it against", which the findings on
    their own cannot.
    """
    try:
        return svc.list_quality_runs(session_id, source_file_id=source_file_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/quality/runs/{quality_run_id}")
def get_quality_run(
    session_id: str,
    quality_run_id: str,
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    One run, its findings, and the effective configuration it used.

    The snapshots are the part that matters: the mapping and the rules exactly
    as they were when the run read them, not as they are now.
    """
    try:
        return svc.get_quality_run(session_id, quality_run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/quality")
def get_quality_report(
    session_id: str,
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """Return the persisted findings from the last quality run."""
    return svc.get_quality_report(session_id)


@router.get("/sessions/{session_id}/columns/{discovery_column_id}/profile")
def get_column_profile(
    session_id: str,
    discovery_column_id: str,
    limit: int = Query(default=50, ge=1, le=1000),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    Profile one column from the persisted rows: totals, missing/non-missing and
    the field's real distinct values (variants) with their counts.
    """
    try:
        return svc.get_column_profile(session_id, discovery_column_id, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/dataset")
def get_dataset(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """Return the parsed file's headers plus a page of its real data rows."""
    return svc.get_dataset(session_id, limit=limit, offset=offset)


@router.get("/sessions/{session_id}/profile-observations")
def get_profile_observations(
    session_id: str,
    source_file_id: str = Query(default=""),
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    The automatic risk observations for this table: missing values, repeated
    records, overlapping fields, values that do not parse.

    These belong to the Profile stage. The Quality Check stage reports the
    governed DQ and BQ rules and nothing else, so the two never share a total.
    """
    return svc.profile_observations(session_id, source_file_id=source_file_id)


@router.get("/sessions/{session_id}/dataset/duplicates")
def get_dataset_duplicates(
    session_id: str,
    svc: DiscoverDatasetService = Depends(_dataset_svc),
):
    """
    How many stored rows are exact copies of another.

    Separate from the dataset itself because it reads every row: the preview
    should not wait on a full-table scan to show ten rows.
    """
    return svc.duplicate_summary(session_id)


# ─────────────────────────────────────────────────────────────────────────────
# Governed layer: classify values → determine applicable rules → configure
# the parameters those rules permit.
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/classifications/suggest")
def suggest_classifications(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """
    Propose the governed Structure instance each distinct value stands for —
    KIOSK → Kiosk Transformer. Suggestions only; nothing is applied.
    """
    try:
        return svc.suggest_classifications(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/classifications")
def get_classifications(
    session_id: str,
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """The session's value classifications and the governed instances on offer."""
    return svc.get_classifications(session_id)


@router.post("/sessions/{session_id}/classifications/decide")
def set_classification(
    session_id: str,
    command: SetValueClassificationCommand,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """Confirm, correct or reject one proposed classification."""
    try:
        return svc.set_classification(
            session_id,
            command.column_id,
            command.source_value,
            command.target_node_id,
            command.state,
            actor=actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/classifications/confirm-suggested")
def confirm_classifications(
    session_id: str,
    command: ConfirmClassificationsCommand,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """Bulk-accept high-confidence suggestions so only the ambiguous ones remain."""
    try:
        return svc.confirm_high_confidence(
            session_id,
            column_id=command.column_id,
            min_confidence=command.min_confidence,
            actor=actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/governed-rules/determine")
def determine_applicable_rules(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """
    Work out which governed rules apply to what this session mapped and
    classified. Parameters already set are preserved.
    """
    try:
        return svc.determine_applicable_rules(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/governed-rules")
def get_rule_configurations(
    session_id: str,
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """The applicable governed rules for this session and their configuration."""
    return svc.get_rule_configurations(session_id)


@router.get("/sessions/{session_id}/source-files")
def list_source_files(
    session_id: str,
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """Every file in the session, with the one being worked on marked active."""
    return svc.list_files(session_id)


def _source_application_svc(db_url: str = Depends(get_database_url)) -> DiscoverSourceApplicationService:
    return DiscoverSourceApplicationService(db_url)


def _source_application_error(exc: ValueError) -> HTTPException:
    if isinstance(exc, SourceApplicationNeedsConfirmation):
        return HTTPException(
            status_code=409,
            detail={"msg": str(exc), "dependents": exc.dependents, "needs_confirmation": True},
        )
    if isinstance(exc, SourceApplicationNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions/{session_id}/source-applications")
def list_source_applications(
    session_id: str,
    svc: DiscoverSourceApplicationService = Depends(_source_application_svc),
):
    """Each table of the session with the Application it came from (or none yet)."""
    try:
        return svc.list_for_session(session_id)
    except ValueError as exc:
        raise _source_application_error(exc) from exc


@router.get("/sessions/{session_id}/source-files/{source_file_id}/source-application")
def get_source_application(
    session_id: str,
    source_file_id: str,
    svc: DiscoverSourceApplicationService = Depends(_source_application_svc),
):
    try:
        return svc.get(session_id, source_file_id)
    except ValueError as exc:
        raise _source_application_error(exc) from exc


@router.put("/sessions/{session_id}/source-files/{source_file_id}/source-application")
def set_source_application(
    session_id: str,
    source_file_id: str,
    body: dict = Body(...),
    actor: str = Query(default="user"),
    svc: DiscoverSourceApplicationService = Depends(_source_application_svc),
):
    """
    Record Application → table. Body: model_kind ('hierarchy'|'support'),
    model_id, instance_id, confirm. Changing it once the table has mappings or
    quality findings answers 409 until confirm is true.
    """
    try:
        return svc.set(
            session_id,
            source_file_id,
            model_kind=str(body.get("model_kind") or ""),
            model_id=str(body.get("model_id") or ""),
            instance_id=str(body.get("instance_id") or ""),
            confirm=bool(body.get("confirm")),
            actor=actor,
        )
    except ValueError as exc:
        raise _source_application_error(exc) from exc


@router.delete("/sessions/{session_id}/source-files/{source_file_id}/source-application")
def clear_source_application(
    session_id: str,
    source_file_id: str,
    confirm: bool = Query(default=False),
    actor: str = Query(default="user"),
    svc: DiscoverSourceApplicationService = Depends(_source_application_svc),
):
    try:
        return svc.clear(session_id, source_file_id, confirm=confirm, actor=actor)
    except ValueError as exc:
        raise _source_application_error(exc) from exc


@router.post("/sessions/{session_id}/source-files/{source_file_id}/activate")
def activate_source_file(
    session_id: str,
    source_file_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """
    Switch which file the session is working on. Columns, mappings, rules and
    results are all scoped to a file, so this changes what every step shows
    without discarding any of it.
    """
    try:
        return svc.activate_file(session_id, source_file_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/sessions/{session_id}/uploads")
def remove_upload(
    session_id: str,
    filename: str = Query(..., min_length=1),
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """Remove one uploaded file and every table it produced."""
    try:
        return svc.remove_upload(session_id, filename, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/sessions/{session_id}/source-files/{source_file_id}")
def remove_source_file(
    session_id: str,
    source_file_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """Remove one file from the session, along with everything derived from it."""
    try:
        return svc.remove_file(session_id, source_file_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/mappings/auto")
def auto_map(
    session_id: str,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """
    Pair source columns with model fields automatically. Columns the user has
    already mapped are left untouched, and every pairing stays editable.
    """
    try:
        return svc.suggest_mappings(session_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/governed-rules/remove")
def remove_rule(
    session_id: str,
    command: RemoveRuleCommand,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """Take a rule off a field."""
    try:
        return svc.remove_rule(session_id, command.rule_id, command.column_id, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ─────────────────────────────────────────────────────────────────────────────
# Rule Builder — the only way a rule enters a session
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/rule-builder/support-models")
def list_rule_builder_support_models(
    svc: DiscoverRuleBuilderService = Depends(_rule_builder_svc),
):
    """The Support Domain models a session may draw governance from."""
    return svc.list_support_models()


@router.get("/sessions/{session_id}/rule-builder/links")
def list_rule_builder_links(
    session_id: str,
    support_model_id: str = Query(...),
    svc: DiscoverRuleBuilderService = Depends(_rule_builder_svc),
):
    """
    The cross-model relationships of one Support Domain model, plus every field
    this session has mapped — the relationships found a rule, the fields carry it.
    """
    try:
        return svc.list_links(session_id, support_model_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/rule-builder/rules")
def list_rule_builder_rules(
    session_id: str,
    support_model_id: str = Query(...),
    svc: DiscoverRuleBuilderService = Depends(_rule_builder_svc),
):
    """
    Every rule a Support Domain model declares, grouped by category, each with
    the check its wording implies and what that check needs — the list the
    person ticks through.
    """
    try:
        return svc.list_rules(session_id, support_model_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/rule-builder/rules", status_code=status.HTTP_201_CREATED)
def build_rules(
    session_id: str,
    command: BuildRulesCommand,
    actor: str = Query(default="user"),
    svc: DiscoverRuleBuilderService = Depends(_rule_builder_svc),
):
    """Finish the builder: each ticked governed rule becomes one session rule."""
    try:
        return svc.build_rules(
            session_id,
            support_model_id=command.support_model_id,
            relationship_type_ids=command.relationship_type_ids,
            selections=[s.model_dump() for s in command.selections],
            actor=actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/governed-rules/configure")
def configure_rule(
    session_id: str,
    command: ConfigureRuleCommand,
    actor: str = Query(default="user"),
    svc: DiscoverGovernanceService = Depends(_governance_svc),
):
    """Set the parameters a governed rule permits, or turn it on or off."""
    try:
        return svc.configure_rule(
            session_id,
            command.rule_id,
            column_id=command.column_id,
            is_enabled=command.is_enabled,
            severity=command.severity,
            parameters=command.parameters,
            actor=actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ─────────────────────────────────────────────────────────────────────────────
# W2-DWS-FEATURE-01: Validation endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/validate")
def run_validation(
    session_id: str,
    command: ValidateImportCommand,
    svc: DiscoverValidationService = Depends(_validation_svc),
):
    """
    Run import validation against Admin-configured limits.
    Persists result, issues, and updates import_status.
    AC-DWS-VALIDATE-001 through AC-DWS-VALIDATE-006.
    """
    try:
        return svc.run_validation(session_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/validation")
def get_validation_result(
    session_id: str,
    svc: DiscoverValidationService = Depends(_validation_svc),
):
    """
    Return persisted validation result + issues for a session.
    AC-DWS-VALIDATE-004: validation issues rehydrate from backend state.
    """
    return svc.get_validation_result(session_id)


# ─────────────────────────────────────────────────────────────────────────────
# W2-DWS-FEATURE-01: Discovery column endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/discovery-columns", status_code=status.HTTP_201_CREATED)
def persist_discovery_columns(
    session_id: str,
    source_file_id: str = Query(...),
    normalised_columns: list[dict] = ...,
    actor: str = Query(default="system"),
    svc: DiscoverColumnService = Depends(_column_svc),
):
    """
    Persist discovery_column records from normalised validation output.
    Blocked when session has a blocking validation failure.
    AC-DWS-COLUMN-001 through AC-DWS-COLUMN-004.
    """
    try:
        return svc.persist_columns(session_id, source_file_id, normalised_columns, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/discovery-columns")
def list_discovery_columns(
    session_id: str,
    svc: DiscoverColumnService = Depends(_column_svc),
):
    """
    Return persisted discovery columns rehydrated from backend state.
    AC-DWS-COLUMN-003.
    """
    return svc.list_discovery_columns(session_id)


# ─────────────────────────────────────────────────────────────────────────────
# Structure read-only endpoints (application/module selector)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/structure/applications")
def list_applications(svc: StructureApplicationContextReadService = Depends(_structure_svc)):
    """
    Return Structure application nodes for the source application selector.
    Read-only — Discover does not mutate Structure records.
    AC-DWS-IMPORT-006.
    """
    return {"items": svc.list_applications()}


@router.get("/structure/applications/{application_ref_id}/modules")
def list_modules(
    application_ref_id: str,
    svc: StructureApplicationContextReadService = Depends(_structure_svc),
):
    """
    Return child module nodes for a given application.
    Read-only — Discover does not mutate Structure records.
    AC-DWS-IMPORT-006.
    """
    return {"items": svc.list_modules(application_ref_id)}


@router.get("/structure/applications/{application_ref_id}/fields")
def list_application_fields(
    application_ref_id: str,
    svc: StructureApplicationContextReadService = Depends(_structure_svc),
):
    """
    Return every node beneath an application, flattened with its full path —
    the mapping targets offered once a source application is selected.
    Read-only — Discover does not mutate Structure records.
    """
    return {"items": svc.list_application_fields(application_ref_id)}


# ─────────────────────────────────────────────────────────────────────────────
# Legacy MVP endpoints (kept for backward-compat)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/imports")
def import_dataset(
    session_id: str,
    command: ImportDatasetCommand,
    svc: DiscoverService = Depends(_legacy_svc),
):
    try:
        return svc.import_dataset(session_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/columns")
def list_columns(session_id: str, svc: DiscoverService = Depends(_legacy_svc)):
    try:
        return svc.list_columns(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/profiles/{column_id}")
def get_profile(
    session_id: str,
    column_id: str,
    svc: DiscoverService = Depends(_legacy_svc),
):
    try:
        return svc.get_profile(session_id, column_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/mappings")
def list_mappings(session_id: str, svc: DiscoverService = Depends(_legacy_svc)):
    return svc.list_mappings(session_id)


@router.post("/sessions/{session_id}/mappings")
def upsert_mapping(
    session_id: str,
    command: UpsertColumnMappingCommand,
    svc: DiscoverService = Depends(_legacy_svc),
):
    try:
        return svc.upsert_mapping(session_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/sessions/{session_id}/mappings/{column_id}")
def clear_mapping(
    session_id: str,
    column_id: str,
    svc: DiscoverService = Depends(_legacy_svc),
):
    return svc.clear_mapping(session_id, column_id)


@router.post("/sessions/{session_id}/checks/run")
def run_checks(
    session_id: str,
    command: RunChecksCommand,
    svc: DiscoverService = Depends(_legacy_svc),
):
    return svc.run_checks(session_id, command)


@router.get("/sessions/{session_id}/results")
def list_results(
    session_id: str,
    severity: str | None = Query(default=None),
    svc: DiscoverService = Depends(_legacy_svc),
):
    return svc.list_results(session_id, severity=severity)


# ── what Discover found about structure instances (read by the Impact workspace) ──


@router.post("/structure-instances/quality-results")
def search_quality_results_by_structure_instance(
    command: StructureInstanceQualityCommand, db_url=Depends(get_database_url)
):
    """
    What Discover found about the data representing these PDP instances.

    The two layers are resolved together here and nowhere else: the model says
    which rule configuration a property is subject to and which governed
    vocabulary it reads; Discover says which source column was mapped onto it
    and what the latest run concluded. Nothing is written, and a property with
    no assessment comes back saying so rather than looking like a pass.
    """
    try:
        return DiscoverStructureService(db_url).search_quality_results_by_structure_instance(
            command.item_ids, run_id=command.run_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/quality-checks/{quality_check_id}/findings")
def list_findings_for_quality_check(
    quality_check_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db_url=Depends(get_database_url),
):
    """
    One check's findings, a page at a time.

    Paged because a check over a large table holds thousands of them, and the
    tree opens on the branch rather than on the records.
    """
    try:
        return DiscoverStructureService(db_url).list_findings_for_quality_check(
            quality_check_id, offset=offset, limit=limit
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
