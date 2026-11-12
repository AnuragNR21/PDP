"""
DiscoverDatasetService — authoritative service for uploading, parsing and
profiling the real content of a Discover source file.

Flow:
  1. The browser uploads the actual file bytes.
  2. The file is parsed here on the server (CSV or .xlsx).
  3. Headers and every data row are persisted to Postgres as JSON.
  4. Profiling reads that persisted data back and computes real column count,
     row count, missing/non-missing and distinct-value statistics in SQL.

Nothing in this flow depends on client-side state, so a refresh or a reopened
session shows exactly the same columns and numbers.
"""
import json
from hashlib import sha256
from uuid import uuid4

from features.discover.domain.file_parsing import (
    ParsedSourceFile,
    SourceFileParseError,
    infer_datatype,
    parse_source_tables,
)
from features.discover.domain.quality_rules import (
    CASE_INSENSITIVE_TYPES,
    TYPE_PATTERNS,
    resolve_field_rules,
)
from features.discover.domain.rule_builder import comparator_sql, describe
from features.discover.domain.validation import (
    normalise_column_labels,
    run_import_validation,
)
from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_column_repository import DiscoverColumnRepository
from features.discover.repo.discover_dataset_repository import DiscoverDatasetRepository
from features.discover.repo.discover_governance_repository import (
    DiscoverGovernanceRepository,
)
from features.discover.repo.discover_quality_job_repository import (
    DiscoverQualityJobRepository,
)
from features.discover.repo.discover_import_job_repository import (
    DiscoverImportJobRepository,
)
from features.discover.repo.discover_import_repository import DiscoverImportRepository
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from features.discover.repo.discover_validation_repository import (
    DiscoverValidationRepository,
)
from features.discover.service.discover_import_service import (
    StructureApplicationContextReadService,
)
from features.discover.service.discover_validation_service import (
    AdminDiscoverImportConfigReadService,
)
from features.discover.service.import_worker import get_import_pool, get_quality_pool
from shared.contracts.refresh import RefreshRequest

# How many values per column are echoed into the legacy sample_values payload.
_SAMPLE_VALUES_FOR_DISPLAY = 20
# Overlap compares every pair of mapped fields, so cap it on very wide files.
MAX_COLUMNS_FOR_OVERLAP = 40


class DiscoverDatasetService:
    def __init__(self, db_url: str) -> None:
        # Kept because the worker pools are built lazily, not in here: a pool
        # created at construction would be created by every request.
        self._db_url = db_url
        self._datasets = DiscoverDatasetRepository(db_url)
        self._imports = DiscoverImportRepository(db_url)
        self._sessions = DiscoverSessionRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)
        self._validations = DiscoverValidationRepository(db_url)
        self._columns = DiscoverColumnRepository(db_url)
        self._governance = DiscoverGovernanceRepository(db_url)
        self._config_svc = AdminDiscoverImportConfigReadService(db_url)
        self._structure_svc = StructureApplicationContextReadService(db_url)
        self._jobs = DiscoverImportJobRepository(db_url)
        self._quality_jobs = DiscoverQualityJobRepository(db_url)
        # One pool per process, shared by every session: the work is the same
        # work whoever asked for it, and three files at a time is three files.
        self._pool = get_import_pool(db_url, self.structure_uploaded_file)

    # ── upload + parse ───────────────────────────────────────────────────────

    def upload_source_file(
        self,
        session_id: str,
        filename: str,
        raw: bytes,
        uploaded_by: str = "user",
    ) -> dict:
        """
        Take the file and answer — the reading of it is a job, not a request.

        A 38 MB export takes seconds to send and rather longer to read: split
        into its sheets, every row stored, every table profiled. Doing that
        inside the upload meant the browser waited for all of it, five files
        meant five waits one after another, and a lost connection lost the
        work. So upload now writes the bytes down, records a job, and returns;
        Start Import sets the workers going, and the screen follows the job.

        The bytes are kept until the job finishes, which is what lets an import
        interrupted by a restart carry on instead of asking for the file again.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        if not raw:
            raise ValueError("The uploaded file is empty.")

        config = self._config_svc.get_config()
        if len(raw) > config.max_file_size_bytes:
            raise ValueError(
                f"File is {len(raw):,} bytes which exceeds the configured maximum "
                f"of {config.max_file_size_bytes:,} bytes."
            )

        extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if extension not in ("csv", "tsv", "txt", "xlsx", "xlsm"):
            raise ValueError(
                f"Unsupported file type '.{extension}'. Upload a CSV or Excel (.xlsx) file."
            )

        job = self._jobs.enqueue(
            session_id=session_id,
            filename=filename,
            content=raw,
            content_sha256=sha256(raw).hexdigest(),
            uploaded_by=uploaded_by,
        )
        self._audit.record(
            actor=uploaded_by,
            action="import.file_uploaded",
            outcome="success",
            session_id=session_id,
            detail={"filename": filename, "size_bytes": len(raw)},
        )
        return {
            "job": job,
            "refresh": RefreshRequest(
                scope="session",
                reason="File uploaded and waiting to be structured.",
                targets=[session_id],
            ),
        }

    def start_import(self, session_id: str, actor: str = "user") -> dict:
        """
        Set the workers going on everything this session has uploaded.

        One press covers every waiting file, and a file that failed last time
        is tried again: to a person, "Start import" means the whole upload, not
        one file of it.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")
        queued = self._jobs.mark_queued(session_id)
        if not queued and not self._jobs.queued_ids(session_id):
            raise ValueError("Upload a file before starting the import.")
        started = self._pool.pump(session_id)
        self._audit.record(
            actor=actor,
            action="import.started",
            outcome="success",
            session_id=session_id,
            detail={"files": len(queued), "workers_started": started},
        )
        return self.import_progress(session_id)

    def import_progress(self, session_id: str) -> dict:
        """
        Where every uploaded file has got to.

        Asking is also what restarts work that was dropped: a browser reload
        reaches this, the pool picks up anything queued or abandoned, and the
        import carries on. Nobody has to know the server was restarted.
        """
        self._pool.pump(session_id)
        jobs = self._jobs.list_for_session(session_id)
        running = [j for j in jobs if j["status"] in ("queued", "running")]
        return {
            "session_id": session_id,
            "jobs": jobs,
            "waiting": sum(1 for j in jobs if j["status"] == "waiting"),
            "running": len(running),
            "succeeded": sum(1 for j in jobs if j["status"] == "succeeded"),
            "failed": sum(1 for j in jobs if j["status"] == "failed"),
            # The screen polls while this is true and stops when it is not.
            "is_working": bool(running),
            "tables_created": sum(j["tables_created"] for j in jobs),
        }

    # ── the work itself, run by a worker rather than a request ───────────────

    def structure_uploaded_file(self, job: dict) -> None:
        """
        Turn one uploaded file into the tables it holds, then profile them.

        This is the body of an import job. It reports where it has got to as it
        goes, because a person watching a 134,000-row file deserves better than
        a spinner that says nothing for two minutes.
        """
        job_id = job["job_id"]
        session_id = job["session_id"]
        filename = job["filename"]
        uploaded_by = job["uploaded_by"]

        raw = self._jobs.content_of(job_id)
        if raw is None:
            self._jobs.failed(job_id, "The uploaded file is no longer stored. Upload it again.")
            return

        try:
            self._jobs.progress(job_id, "Reading the file", 5)
            found = parse_source_tables(raw, filename)
            # One table needs no qualifier: "poles.csv", not "poles.csv — Table 1".
            tables = [("", found[0].table)] if len(found) == 1 else [
                (table.name, table.table) for table in found
            ]
            for _, parsed in tables:
                if parsed.column_count == 0:
                    raise SourceFileParseError(
                        "No columns could be read from the file's header row."
                    )
        except SourceFileParseError as exc:
            self._audit.record(
                actor=uploaded_by,
                action="import.file_attached",
                outcome="failure",
                session_id=session_id,
                detail={"filename": filename, "error": str(exc)},
            )
            self._jobs.failed(job_id, str(exc))
            return

        total_rows = sum(parsed.row_count for _, parsed in tables)
        self._jobs.progress(
            job_id,
            f"Storing {total_rows:,} rows across {len(tables)} table"
            f"{'' if len(tables) == 1 else 's'}",
            10, 0, total_rows,
        )

        digest = sha256(raw).hexdigest()
        # The session keeps only the newest version of this upload: replacing
        # happens once, before anything is stored, so a workbook that used to
        # have four sheets and now has three does not leave the fourth behind.
        carried_context = self._replace_previous(session_id, filename, uploaded_by)

        stored = []
        rows_done = 0
        for name, parsed in tables:
            entry = self._store_table(
                session_id=session_id,
                filename=filename,
                table_name=name,
                parsed=parsed,
                raw_size=len(raw),
                digest=digest,
                uploaded_by=uploaded_by,
                carried_context=carried_context,
            )
            stored.append(entry)
            rows_done += parsed.row_count
            # Storing is the long half, so it owns the middle of the bar.
            share = rows_done / total_rows if total_rows else 1
            self._jobs.progress(
                job_id,
                f"Stored {entry['file'].original_filename}",
                10 + int(share * 55), rows_done, total_rows,
            )

        if self._imports.get_active_file_id(session_id) is None:
            # Work continues on the first table of the first upload. Landing on
            # the last sheet of a workbook would be an odd place to start.
            self._imports.set_active_file(session_id, stored[0]["file"].source_file_id)

        # ── profiling, table by table ────────────────────────────────────────
        # Each table is profiled through the same path a single one takes, so
        # the two cannot drift apart. A table that fails validation is recorded
        # against its own name and the others carry on.
        profiled, failures = 0, []
        for index, entry in enumerate(stored, start=1):
            source_file_id = entry["file"].source_file_id
            name = entry["file"].original_filename
            self._jobs.progress(
                job_id, f"Profiling {name}", 65 + int(index / len(stored) * 30),
                rows_done, total_rows,
            )
            try:
                self.run_profiling_for_file(session_id, source_file_id, actor=uploaded_by)
                profiled += 1
            except ValueError as exc:
                failures.append(f"{name}: {exc}")

        names = [entry["file"].original_filename for entry in stored]
        message = "" if not failures else "Could not profile — " + " · ".join(failures)
        self._jobs.succeeded(job_id, names, message)
        self._audit.record(
            actor=uploaded_by,
            action="import.file_structured",
            outcome="success",
            session_id=session_id,
            detail={
                "filename": filename,
                "tables": len(stored),
                "rows": total_rows,
                "profiled": profiled,
            },
        )

    def _replace_previous(self, session_id: str, filename: str, uploaded_by: str):
        """
        Drop what an earlier upload of this same file left in the session.

        Re-uploading a corrected file should not make the user choose its model
        again, so the model context of what is being replaced is returned for
        the new tables to inherit; everything else derived from the old tables
        goes, because it describes rows that are no longer there.
        """
        existing_active = self._imports.get_active_file_id(session_id)
        replaced = self._imports.delete_source_files_named(session_id, filename)
        if not replaced:
            return None

        carried = (
            self._imports.get_source_context(session_id)
            if existing_active in replaced
            else self._imports.get_context_for_file(replaced[0])
        )

        for old_id in replaced:
            self._datasets.delete_for_file(old_id)
            self._datasets.clear_profiling_results(old_id)
            self._datasets.clear_quality_checks(old_id)
            self._datasets.clear_validation_results(old_id)
            self._governance.clear_for_file(old_id)
            self._audit.record(
                actor=uploaded_by,
                action="import.file_replaced",
                outcome="success",
                session_id=session_id,
                source_file_id=old_id,
                detail={"replaced_by": filename},
            )
        return carried

    def _store_table(
        self,
        session_id: str,
        filename: str,
        table_name: str,
        parsed: ParsedSourceFile,
        raw_size: int,
        digest: str,
        uploaded_by: str,
        carried_context=None,
    ) -> dict:
        """
        Persist one table of an upload as a source of the session.

        A session holds several sources, and one file can be several of them:
        each sheet is mapped, ruled and checked on its own. The upload it came
        from is recorded so the Import step can show files rather than tables —
        a person chose files, and that is what they look for when removing one.
        """
        display_name = f"{filename} — {table_name}" if table_name else filename

        file_type = filename.rsplit(".", 1)[-1].lower() if "." in filename else "csv"
        source_file = self._imports.attach_source_file(
            session_id=session_id,
            original_filename=display_name,
            file_type=file_type,
            # The size of the file this table arrived in — every sheet of one
            # workbook reports the workbook's size.
            file_size_bytes=raw_size,
            # The content hash is what ties a stored result back to the exact
            # bytes it was computed from, and the sheet says which part of them.
            storage_ref=f"sha256:{digest}" + (f"#{table_name}" if table_name else ""),
            uploaded_by=uploaded_by,
            import_status="uploaded",
            origin_filename=filename,
            sheet_name=table_name,
        )

        if carried_context is not None:
            self._imports.upsert_source_context(
                session_id=session_id,
                source_application=carried_context.source_application,
                source_module=carried_context.source_module,
                application_ref_id=carried_context.application_ref_id,
                module_ref_id=carried_context.module_ref_id,
            )
        self._datasets.persist_parsed_file(session_id, source_file.source_file_id, parsed)

        self._audit.record(
            actor=uploaded_by,
            action="import.file_attached",
            outcome="success",
            session_id=session_id,
            source_file_id=source_file.source_file_id,
            detail={
                "filename": display_name,
                "sheet": table_name,
                "row_count": parsed.row_count,
                "column_count": parsed.column_count,
            },
        )
        return {
            "file": source_file,
            "table_name": table_name,
            "parsed": {
                "row_count": parsed.row_count,
                "column_count": parsed.column_count,
                "column_labels": parsed.column_labels,
            },
        }

    # ── profiling ────────────────────────────────────────────────────────────

    def run_profiling_everywhere(self, session_id: str, actor: str = "user") -> dict:
        """
        Profile every table of the session, not just the one on screen.

        Profiling is what turns stored rows into columns with types and counts,
        and nothing downstream — mapping, rules, checks — can start on a table
        until it has run. Leaving it per-table meant a seven-sheet workbook
        needed seven visits to the same button before any of it could be
        worked on, and a person who profiled one table saw the other six sit
        there looking imported and behaving as if they were empty.

        Each table is profiled through exactly the same path as a single one,
        so nothing here can drift from the one-table behaviour. A table that
        fails validation does not stop the others: it is reported alongside
        them, because six good tables and one bad one is a normal file.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        files = self._imports.list_source_files(session_id)
        if not files:
            raise ValueError("Upload a file before profiling.")

        started_on = self._imports.get_active_file_id(session_id)
        tables = []
        for entry in files:
            self._imports.set_active_file(session_id, entry["source_file_id"])
            try:
                result = self.run_profiling(session_id, actor=actor)
                tables.append({
                    "source_file_id": entry["source_file_id"],
                    "name": entry["original_filename"],
                    "status": "profiled",
                    "row_count": result["row_count"],
                    "column_count": result["column_count"],
                    "validation_status": result["validation_status"],
                    "reason": "",
                })
            except ValueError as exc:
                tables.append({
                    "source_file_id": entry["source_file_id"],
                    "name": entry["original_filename"],
                    "status": "failed",
                    "row_count": entry.get("row_count"),
                    "column_count": entry.get("column_count"),
                    "validation_status": "failed",
                    "reason": str(exc),
                })

        # Work resumes where it left off — or on the first table that profiled,
        # for the first run of a session, where nothing was open yet.
        profiled = [t for t in tables if t["status"] == "profiled"]
        resume_on = started_on or (profiled[0]["source_file_id"] if profiled else files[0]["source_file_id"])
        self._imports.set_active_file(session_id, resume_on)
        if profiled:
            # One table failing validation put the whole session in "error"
            # on its way past; the session still holds tables that are fine.
            self._sessions.update_status(session_id, "ready")

        self._audit.record(
            actor=actor,
            action="import.profiled_all",
            outcome="success" if profiled else "failure",
            session_id=session_id,
            detail={"tables": len(tables), "profiled": len(profiled)},
        )
        return {
            "session_id": session_id,
            "tables": tables,
            "profiled": len(profiled),
            "failed": len(tables) - len(profiled),
            "active_source_file_id": resume_on,
        }

    def run_profiling_for_file(
        self, session_id: str, source_file_id: str, actor: str = "user"
    ) -> dict:
        """Profile one named table, whichever table the session has open."""
        return self.run_profiling(session_id, actor=actor, source_file_id=source_file_id)

    def run_profiling(
        self, session_id: str, actor: str = "user", source_file_id: str = ""
    ) -> dict:
        """
        Profile the persisted rows: validate the file's real shape, persist the
        discovery columns, and compute per-column statistics in Postgres.

        Without a source_file_id this profiles the table the session has open,
        which is what the Profile screen asks for. With one it profiles that
        table, which is what an import worker asks for — several of them run at
        once, and they cannot each be moving the same "active table" pointer.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        parsed = self._datasets.get_parsed_file(session_id, source_file_id)
        if parsed is None:
            raise ValueError(
                "No parsed source file found for this session. Upload a file before profiling."
            )

        column_labels: list[str] = parsed["column_labels"]
        internal_names: list[str] = parsed["internal_names"]
        source_file_id = parsed["source_file_id"]
        row_count = self._datasets.count_rows(session_id, source_file_id)

        # 1. Validate the real shape against Admin-configured limits.
        config = self._config_svc.get_config()
        outcome = run_import_validation(
            column_labels=column_labels,
            row_count=row_count,
            has_header_row=True,
            config=config,
        )
        validation_status = (
            "failed" if outcome.is_blocking else ("warning" if outcome.issues else "passed")
        )
        self._datasets.clear_validation_results(source_file_id)
        result = self._validations.create_validation_result(
            session_id=session_id,
            source_file_id=source_file_id,
            validation_status=validation_status,
            row_count=row_count,
            column_count=len(column_labels),
            has_header_row=True,
            blocking_failure=outcome.is_blocking,
        )
        for issue in outcome.issues:
            self._validations.add_validation_issue(
                validation_result_id=result.validation_result_id,
                session_id=session_id,
                issue_type=issue.issue_type,
                detail=issue.detail,
                severity=issue.severity,
                is_blocking=issue.is_blocking,
                column_ordinal=issue.column_ordinal,
                original_label=issue.original_label,
                internal_name=issue.internal_name,
            )
        self._imports.update_file_status(
            source_file_id, "validation_failed" if outcome.is_blocking else "validated"
        )
        self._audit.record(
            actor=actor,
            action="import.validation_run",
            outcome="success",
            session_id=session_id,
            source_file_id=source_file_id,
            detail={
                "validation_status": validation_status,
                "blocking_failure": outcome.is_blocking,
                "issue_count": len(outcome.issues),
            },
        )

        if outcome.is_blocking:
            self._sessions.update_status(session_id, "error")
            blocking = next(i.detail for i in outcome.issues if i.is_blocking)
            raise ValueError(blocking)

        # 2. Profile every column from the persisted rows.
        normalised = normalise_column_labels(column_labels, config.duplicate_suffix_pattern)
        discovery_columns: list[dict] = []
        legacy_columns: list[dict] = []
        summary_columns: list[dict] = []

        for index, internal_name in enumerate(internal_names):
            entry = normalised[index] if index < len(normalised) else {}
            label = column_labels[index]
            samples = self._datasets.sample_column_values(
                session_id, internal_name, source_file_id=source_file_id
            )
            detected_type = infer_datatype(samples)
            stats = self._datasets.profile_column(
                session_id, internal_name, source_file_id=source_file_id
            )

            discovery_columns.append(
                {
                    "source_label": label,
                    "internal_name": internal_name,
                    "inferred_datatype": detected_type,
                    "ordinal": index + 1,
                    "is_nullable": stats["blank_count"] > 0,
                    "duplicate_group_key": entry.get("duplicate_group_key"),
                }
            )
            legacy_columns.append(
                {
                    "column_label": label,
                    "internal_name": internal_name,
                    "ordinal": index + 1,
                    "detected_type": detected_type,
                    "distinct_count": stats["distinct_count"],
                    "blank_count": stats["blank_count"],
                    "value_distribution": stats["value_distribution"],
                    "sample_values": samples[:_SAMPLE_VALUES_FOR_DISPLAY],
                }
            )
            summary_columns.append(
                {
                    "column_name": label,
                    "detected_type": detected_type,
                    "total_rows": stats["total_rows"],
                    "missing": stats["blank_count"],
                    "non_missing": stats["non_blank_count"],
                    "distinct_values": stats["distinct_count"],
                }
            )

        # 3. Persist authoritative discovery columns + the profile read models.
        self._columns.persist_columns(
            session_id=session_id,
            source_file_id=source_file_id,
            columns=discovery_columns,
        )
        source_name = self._imports.get_source_file_by_id(source_file_id)
        self._datasets.write_profiling_results(
            session_id=session_id,
            source_file_id=source_file_id,
            source_name=source_name.original_filename if source_name else "uploaded_file",
            row_count=row_count,
            columns=legacy_columns,
        )
        self._imports.update_file_status(source_file_id, "completed")

        self._audit.record(
            actor=actor,
            action="import.columns_persisted",
            outcome="success",
            session_id=session_id,
            source_file_id=source_file_id,
            detail={"column_count": len(discovery_columns), "row_count": row_count},
        )

        return {
            "session_id": session_id,
            "source_file_id": source_file_id,
            "row_count": row_count,
            "column_count": len(discovery_columns),
            "columns": summary_columns,
            "validation_status": validation_status,
            "refresh": RefreshRequest(
                scope="session",
                reason="Profiling completed from persisted file data.",
                targets=[session_id, source_file_id],
            ),
        }

    # ── reads ────────────────────────────────────────────────────────────────

    # ── data quality ─────────────────────────────────────────────────────────

    # ── the checks as a background run ───────────────────────────────────────

    def start_quality_run(self, session_id: str, actor: str = "user") -> dict:
        """
        Queue a check for every table and return at once.

        The run used to happen inside the request: a person pressed the button
        and watched a spinner for as long as every table took, and closing the
        page lost the thread of it. Now the press writes one job per table and
        the workers do the rest, which is also what makes the tables run
        together rather than one after another.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")
        files = self._imports.list_source_files(session_id)
        if not files:
            raise ValueError("Upload a file before running the checks.")
        if not self._datasets.list_mapped_columns_everywhere(session_id):
            raise ValueError(
                "No table has a mapped column yet. Map at least one column on the "
                "Mapping step, then run the checks."
            )

        self._quality_jobs.start_run(session_id, files, actor)
        self._audit.record(
            actor=actor,
            action="quality.run_started",
            outcome="success",
            session_id=session_id,
            detail={"tables": len(files)},
        )
        return self.quality_progress(session_id)

    def quality_progress(self, session_id: str) -> dict:
        """
        How far the run has got, table by table.

        Asking is also what restarts a run the server dropped, so reopening
        the page is enough to pick one back up — the person does not have to
        know the server restarted, only that the checks are still going.
        """
        pool = get_quality_pool(self._db_url, self.run_quality_job, self._quality_jobs)
        pool.pump(session_id)
        jobs = self._quality_jobs.list_for_session(session_id)

        waiting = sum(1 for j in jobs if j["status"] in ("waiting", "queued"))
        running = sum(1 for j in jobs if j["status"] == "running")
        done = [j for j in jobs if j["status"] in ("succeeded", "skipped", "failed")]
        # Every table counts the same towards the total, and a table's own
        # percentage moves as its columns are checked — so the bar advances
        # steadily rather than jumping a whole table at a time.
        percent = int(sum(j["progress"] for j in jobs) / len(jobs)) if jobs else 0
        return {
            "session_id": session_id,
            "jobs": jobs,
            "tables_total": len(jobs),
            "tables_done": len(done),
            "waiting": waiting,
            "running": running,
            "succeeded": sum(1 for j in jobs if j["status"] == "succeeded"),
            "skipped": sum(1 for j in jobs if j["status"] == "skipped"),
            "failed": sum(1 for j in jobs if j["status"] == "failed"),
            "percent": 100 if jobs and not (waiting or running) else percent,
            "is_working": bool(waiting or running),
            "has_run": bool(jobs),
            "findings": sum(j["findings"] for j in jobs),
            "failing_checks": sum(j["failed_count"] for j in jobs),
        }

    def run_quality_job(self, job: dict) -> None:
        """
        Check the one table a claimed job names.

        Called on a worker thread, so it touches nothing the session shares:
        the table is named on the job and read through a pinned repository,
        never through the session's active table.
        """
        job_id = job["job_id"]
        session_id = job["session_id"]
        entry = {
            "source_file_id": job["source_file_id"],
            "original_filename": job["table_name"],
        }

        def report(done: int, total: int, column_name: str) -> None:
            # 5% for opening the table, the rest spread over its columns.
            percent = 5 + int((done / total) * 90) if total else 50
            self._quality_jobs.progress(
                job_id, f"Checking {column_name}", percent, done, total
            )

        self._quality_jobs.progress(job_id, "Reading the table", 2)
        outcome = self.check_one_table(
            session_id, entry, actor=job["requested_by"] or "user", on_progress=report,
            run_group_id=job.get("run_id") or "",
        )
        if outcome["status"] == "skipped":
            self._quality_jobs.skipped(job_id, outcome["reason"])
        elif outcome["status"] == "failed":
            self._quality_jobs.failed(job_id, outcome["reason"])
        else:
            self._quality_jobs.succeeded(job_id, outcome)

    def run_quality_checks_everywhere(self, session_id: str, actor: str = "user") -> dict:
        """
        Run the checks on every table that has been mapped.

        A session is as many tables as the upload held, and each of them is
        checked against the model it was mapped to. Running only the table on
        screen made a seven-table session need seven runs and seven visits to
        remember, and the six tables nobody revisited reported nothing — which
        reads exactly like "nothing wrong".

        A table with no mapped column is skipped rather than failed: it has not
        been mapped yet, which is a step not taken, not a fault in the data.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        files = self._imports.list_source_files(session_id)
        if not files:
            raise ValueError("Upload a file before running the checks.")

        started_on = self._imports.get_active_file_id(session_id)
        # One id across the tables, so the evidence trail can say this was one
        # check of the session rather than four checks that happened together.
        # The queued path already has one — the job's run_id — and passes it
        # the same way.
        run_group_id = f"qrg_{uuid4().hex[:12]}"
        tables = [
            self.check_one_table(session_id, entry, actor=actor, run_group_id=run_group_id)
            for entry in files
        ]
        resume_on = started_on or files[0]["source_file_id"]

        checked = [t for t in tables if t["status"] == "checked"]
        if not checked:
            raise ValueError(
                "No table has a mapped column yet. Map at least one column on the "
                "Mapping step, then run the checks."
            )
        self._audit.record(
            actor=actor,
            action="quality.checks_run_all",
            outcome="success",
            session_id=session_id,
            detail={
                "tables": len(tables),
                "checked": len(checked),
                "failed_findings": sum(t["failed"] for t in checked),
            },
        )
        return {
            "session_id": session_id,
            "tables": tables,
            "checked": len(checked),
            "skipped": sum(1 for t in tables if t["status"] == "skipped"),
            "failed": sum(1 for t in tables if t["status"] == "failed"),
            "active_source_file_id": resume_on,
            # The report of the table left on screen, so the step below can show
            # findings straight away without a second call.
            "report": self._quality_report(session_id),
        }

    def check_one_table(
        self,
        session_id: str,
        entry: dict,
        actor: str = "user",
        on_progress=None,
        run_group_id: str = "",
    ) -> dict:
        """
        Run the checks on one named table and report what happened to it.

        The table is named rather than made active. That is the whole reason
        several of these can run at once: the session's active table is one
        value, and workers that each set it would be overwriting each other's
        idea of what they are checking.

        A table with no mapped column is skipped rather than failed: it has
        not been mapped yet, which is a step not taken, not a fault in the
        data. A table that fails does not stop the others — six good tables
        and one bad one is a normal session.
        """
        source_file_id = entry["source_file_id"]
        blank = {
            "source_file_id": source_file_id,
            "name": entry["original_filename"],
            "checked_columns": 0, "findings": 0, "failed": 0, "warnings": 0,
        }
        scoped = self._datasets.for_table(source_file_id)
        if not scoped.list_mapped_columns(session_id):
            return {
                **blank,
                "status": "skipped",
                "reason": "No column of this table is mapped to the model yet.",
            }
        try:
            report = self.run_quality_checks(
                session_id, actor=actor, source_file_id=source_file_id,
                on_progress=on_progress, run_group_id=run_group_id,
            )
        except ValueError as exc:
            return {**blank, "status": "failed", "reason": str(exc)}
        return {
            **blank,
            "status": "checked",
            "reason": "",
            "checked_columns": report["checked_columns"],
            "findings": report["total_checks"],
            "failed": report["failed"],
            "warnings": report["warnings"],
        }

    def run_quality_checks(
        self,
        session_id: str,
        actor: str = "user",
        source_file_id: str = "",
        on_progress=None,
        run_group_id: str = "",
    ) -> dict:
        """
        Check the data against the model structure.

        Only columns that were mapped to a model field are checked — an
        unmapped column is not part of the model, so there is nothing to hold
        it to. For each mapped column the rules come from the structure node it
        was mapped to (declared properties) plus the datatype recorded when the
        file was profiled.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        # Every read below goes through this one object. Pinned to a table it
        # ignores the session's active file entirely, which is what lets two
        # tables be checked at the same time; unpinned it behaves exactly as
        # before, following whichever table the session has open.
        datasets = self._datasets.for_table(source_file_id)

        if datasets.get_parsed_file(session_id) is None:
            raise ValueError("No stored file data for this session. Upload and profile a file first.")

        mapped = datasets.list_mapped_columns(session_id)
        if not mapped:
            raise ValueError(
                "No columns are mapped to the model structure yet. "
                "Map at least one column on the Mapping step, then run the checks."
            )

        execution_id = f"exec_{uuid4().hex[:12]}"
        # Two stages, agreed with the client: automatic risk observations
        # belong to Profile, at data load; the Quality Check stage reports the
        # governed DQ and BQ rules and nothing else. They are computed in the
        # same pass because they read the same column statistics, but they are
        # never mixed: `observations` is what Profile shows, `findings` is the
        # run. One list, one denominator, was how "4 rules run / 0 failing"
        # came to sit under "1 check failed".
        findings: list[dict] = []
        observations: list[dict] = []
        checked: list[dict] = []

        # Which mapped columns a governed rule already answers for. A field
        # with a Required Value rule on it reports its blanks through that
        # rule; saying the same thing again underneath, in different words, is
        # the duplication this screen was criticised for.
        #
        # An approved-list rule answers for them too, now that a blank breaches
        # it: the rule already reports the empty rows, by name and in its own
        # count, so repeating them underneath is the duplication this screen
        # was criticised for.
        covered_by_rule = {
            c["column_id"]
            for c in self._governance.list_configurations(session_id)
            if c["is_enabled"]
            and c["check_type"] in ("mandatory", "allowed_values")
            and c.get("column_id")
        }

        for position, column in enumerate(mapped):
            # A ninety-column table takes minutes; a bar that only moves when
            # the whole table finishes is a bar that does not move.
            if on_progress is not None:
                on_progress(position, len(mapped), column["column_name"])
            internal_name = column.get("internal_name") or column["column_name"]
            datatype = column.get("inferred_datatype") or column.get("detected_type") or "String"
            rules = resolve_field_rules(
                structure_properties=datasets.get_node_properties(column["target_node_id"])
                if column.get("target_node_id")
                else [],
                node_type=datasets.get_node_type_name(column["target_node_id"])
                if column.get("target_node_id")
                else None,
                field_name=column.get("target_name") or column["column_name"],
                datatype=datatype,
            )
            stats = datasets.profile_column(session_id, internal_name)
            total = stats["total_rows"]
            missing = stats["blank_count"]
            filled = stats["non_blank_count"]
            distinct = stats["distinct_count"]
            duplicates = max(0, filled - distinct)

            base = {
                "scope": "column",
                "column_id": column["column_id"],
                "column_name": column["column_name"],
                "target_node_id": column.get("target_node_id"),
                "target_name": column.get("target_name"),
                "total_count": total,
            }

            # 1. Completeness — are any values missing?
            if missing == 0:
                completeness = {
                    "status": "passed",
                    "message": f"Every row has a value for {column['column_name']}.",
                    "detail": {},
                }
            else:
                blocking = rules.required
                completeness = {
                    "status": "failed" if blocking else "warning",
                    "message": (
                        f"{missing} of {total} rows have no value"
                        + (" — this field is required by the model." if blocking else ".")
                    ),
                    "detail": {
                        "required": rules.required,
                        "rule_source": rules.required_source,
                        "example_rows": datasets.missing_row_numbers(session_id, internal_name),
                    },
                }
            # The distinct count is reported for every field, whether or not a
            # uniqueness rule applies, so the field summary can always show it.
            completeness["detail"]["distinct_count"] = distinct
            completeness["detail"]["unique_required"] = rules.unique
            observations.append({
                **base,
                "check_type": "completeness",
                "rule_source": rules.required_source if rules.required else "default",
                "observed_count": missing,
                "metric_value": round(missing / total, 4) if total else 0.0,
                **completeness,
            })

            # 1b. The same two facts, reported at the Quality stage because
            #     this field was MAPPED.
            #
            #     Agreed with the client: profiling displays missing and
            #     unknown for every column; the quality run reports them as
            #     issues for the fields somebody actually mapped, and says
            #     nothing at all about the fields they did not. They are kept
            #     apart from the governed rules — a rule somebody wrote and a
            #     fact about the data are different answers — so they carry
            #     their own check type and are counted on their own.
            if missing and column["column_id"] not in covered_by_rule:
                findings.append({
                    **base,
                    "check_type": "mapped_field_issue",
                    "rule_source": "mapped field",
                    "status": "failed" if rules.required else "warning",
                    "observed_count": missing,
                    "total_count": total,
                    "metric_value": round(missing / total, 4) if total else 0.0,
                    "message": (
                        f"{missing} of {total} rows have no value for "
                        f"{column['column_name']}"
                        + (" — this field is required by the model." if rules.required else ".")
                    ),
                    "detail": {
                        "issue": "missing",
                        "required": rules.required,
                        "example_rows": datasets.missing_row_numbers(session_id, internal_name),
                    },
                })

            placeholders = datasets.placeholder_counts(
                session_id, internal_name, list(self.PLACEHOLDER_VALUES)
            )
            if placeholders["total"]:
                share = round(placeholders["total"] / total * 100, 1) if total else 0.0
                findings.append({
                    **base,
                    "check_type": "mapped_field_issue",
                    "rule_source": "mapped field",
                    # A populated value that means "no answer" is not a pass. It
                    # is also not a rule failure — no rule was broken — so it is
                    # reported as something to decide about.
                    "status": "warning",
                    "observed_count": placeholders["total"],
                    "total_count": total,
                    "metric_value": round(placeholders["total"] / total, 4) if total else 0.0,
                    "message": (
                        f"{placeholders['total']} of {total} rows ({share}%) hold a "
                        f"placeholder rather than a value for {column['column_name']}: "
                        + ", ".join(
                            f"{v['value']} ({v['count']})" for v in placeholders["values"][:4]
                        )
                        + "."
                    ),
                    "detail": {
                        "issue": "unknown",
                        "percent": share,
                        "values": placeholders["values"],
                    },
                })

            # 2. Uniqueness — only a real check when the model requires it.
            #    Reporting repeats on a field that is allowed to repeat would
            #    mean passing a check while listing the values that "failed" it,
            #    so no finding is emitted at all in that case. The distinct
            #    count is still reported with the field either way.
            if rules.unique:
                duplicate_values = (
                    datasets.duplicate_values(session_id, internal_name) if duplicates else []
                )
                observations.append({
                    **base,
                    "check_type": "uniqueness",
                    "rule_source": rules.unique_source,
                    "observed_count": duplicates,
                    "metric_value": round(distinct / filled, 4) if filled else 0.0,
                    "status": "passed" if duplicates == 0 else "failed",
                    "message": (
                        f"All {filled} values are unique."
                        if duplicates == 0
                        else f"{duplicates} repeated value(s) — the model requires "
                             f"{column.get('target_name') or column['column_name']} to be unique."
                    ),
                    "detail": {
                        "unique_required": True,
                        "rule_source": rules.unique_source,
                        "distinct_count": distinct,
                        "duplicate_values": duplicate_values,
                    },
                })

            # 3. Type conformance — does every value match the field's datatype?
            #    Dates are the exception: a pattern can only judge the shape of
            #    a value, and 31/02/2026 has the shape of a date without being
            #    one, so the calendar itself decides.
            pattern = rules.type_pattern
            if datatype == "DateTime":
                violation = datasets.invalid_date_values(session_id, internal_name)
                bad = violation["violations"]
                observations.append({
                    **base,
                    "check_type": "type_conformance",
                    "status": "passed" if bad == 0 else "failed",
                    "rule_source": "model structure",
                    "observed_count": bad,
                    "metric_value": round((filled - bad) / filled, 4) if filled else 0.0,
                    "message": (
                        f"All {filled} values are real dates."
                        if bad == 0
                        else f"{bad} value(s) are not real calendar dates."
                    ),
                    "detail": {
                        "datatype": datatype,
                        "invalid_examples": violation["samples"],
                    },
                })
            elif pattern is None:
                observations.append({
                    **base,
                    "check_type": "type_conformance",
                    "status": "passed",
                    "rule_source": "model structure",
                    "observed_count": 0,
                    "metric_value": 1.0,
                    "message": f"Text field — every value is valid for {datatype}.",
                    "detail": {"datatype": datatype},
                })
            else:
                violation = datasets.type_violations(
                    session_id, internal_name, pattern, rules.type_case_insensitive
                )
                bad = violation["violations"]
                observations.append({
                    **base,
                    "check_type": "type_conformance",
                    "status": "passed" if bad == 0 else "failed",
                    "rule_source": "model structure",
                    "observed_count": bad,
                    "metric_value": round((filled - bad) / filled, 4) if filled else 0.0,
                    "message": (
                        f"All {filled} values are valid {datatype} values."
                        if bad == 0
                        else f"{bad} value(s) are not valid {datatype} data."
                    ),
                    "detail": {"datatype": datatype, "invalid_examples": violation["samples"]},
                })

            checked.append({
                "column_id": column["column_id"],
                "column_name": column["column_name"],
                # The property this column was mapped to. Carried so a later
                # pass can tell which properties are in play without going
                # back to the mapping.
                "target_node_id": column.get("target_node_id"),
                "target_name": column.get("target_name"),
                "datatype": datatype,
                "internal_name": internal_name,
                "total": total,
                "missing": missing,
                "filled": filled,
                "distinct": distinct,
                "duplicates": duplicates,
                "required": rules.required,
                "unique_required": rules.unique,
                "pattern": rules.type_pattern,
                "case_insensitive": rules.type_case_insensitive,
                "is_date": datatype == "DateTime",
            })

        # 4. Duplicate records — the same ROW entered twice.
        #
        #    Every column of the file, not the mapped subset. A duplicate
        #    record is a property of the data, not of what somebody happened to
        #    map: judged on one mapped column it asks "does this manufacturer
        #    name repeat?", which on a 10,000-row file answers "9,989 duplicate
        #    records" about a file that holds none.
        internal_names = [c["internal_name"] for c in checked]
        parsed_now = datasets.get_parsed_file(session_id) or {}
        all_columns = list(parsed_now.get("internal_names") or internal_names)
        dup_rows = datasets.duplicate_rows(session_id, all_columns)
        observations.append({
            "scope": "dataset",
            "column_id": None,
            "column_name": "Whole records",
            "target_node_id": None,
            "target_name": None,
            "check_type": "duplicate_records",
            "status": "passed" if dup_rows["duplicate_groups"] == 0 else "warning",
            "rule_source": "default",
            "observed_count": dup_rows["duplicate_rows"],
            "total_count": checked[0]["total"] if checked else 0,
            "metric_value": 0.0,
            "message": (
                "No two rows in this file are identical."
                if dup_rows["duplicate_groups"] == 0
                else f"{dup_rows['duplicate_rows']} rows are involved in "
                     f"{dup_rows['duplicate_groups']} identical group(s) — "
                     f"{dup_rows['duplicate_copies']} of them are copies of a row "
                     "already in the file."
            ),
            "detail": dup_rows,
        })

        # 5. Overlap — the same values showing up in two different fields,
        #    which usually means shifted or copy-pasted columns.
        overlaps: list[dict] = []
        if len(checked) <= MAX_COLUMNS_FOR_OVERLAP:
            for i, left in enumerate(checked):
                for right in checked[i + 1:]:
                    if left["distinct"] < 2 or right["distinct"] < 2:
                        continue
                    result = datasets.value_overlap(
                        session_id, left["internal_name"], right["internal_name"]
                    )
                    if result["shared_count"] > 0:
                        overlaps.append({
                            "left": left["column_name"],
                            "right": right["column_name"],
                            "shared_count": result["shared_count"],
                            "samples": result["samples"],
                        })
        observations.append({
            "scope": "dataset",
            "column_id": None,
            "column_name": "Field overlap",
            "target_node_id": None,
            "target_name": None,
            "check_type": "overlap",
            "status": "passed" if not overlaps else "warning",
            "rule_source": "default",
            "observed_count": len(overlaps),
            "total_count": len(checked),
            "metric_value": 0.0,
            "message": (
                "No two mapped fields share values — each field holds its own data."
                if not overlaps
                else f"{len(overlaps)} pair(s) of fields contain the same values."
            ),
            "detail": {"pairs": overlaps[:10]},
        })

        # 6. How much of the data is actually usable, row by row — against the
        #    model's own structure only. A Profile observation: it knows
        #    nothing about the rules anybody governed, so it cannot be the
        #    Quality Check verdict. The verdict is built at step 9, from the
        #    governed rules alone.
        usability = datasets.row_usability(
            session_id,
            specs=[
                {
                    "internal_name": c["internal_name"],
                    "required": c["required"],
                    "unique": c["unique_required"],
                    "pattern": c["pattern"],
                    "case_insensitive": c["case_insensitive"],
                    "is_date": c["is_date"],
                }
                for c in checked
            ],
            duplicate_keys=all_columns,
        )
        observations.append({
            "scope": "dataset",
            "column_id": None,
            "column_name": "Usable records",
            "target_node_id": None,
            "target_name": None,
            "check_type": "usability",
            "status": (
                "passed" if usability["unusable_rows"] == 0
                else "failed" if usability["usable_percent"] < 90
                else "warning"
            ),
            "rule_source": "default",
            "observed_count": usability["unusable_rows"],
            "total_count": usability["total_rows"],
            "metric_value": usability["usable_percent"] / 100,
            "message": (
                f"{usability['usable_percent']}% of rows "
                f"({usability['usable_rows']} of {usability['total_rows']}) can be used as they are."
                + (
                    f" {usability['unusable_percent']}% ({usability['unusable_rows']} rows) need fixing first."
                    if usability["unusable_rows"]
                    else ""
                )
            ),
            "detail": usability,
        })

        # 7. Governed rules the session enabled, evaluated with the parameters
        #    that session was permitted to set.
        configurations_for_run = [
            c for c in self._governance.list_configurations(session_id) if c["is_enabled"]
        ]
        if on_progress is not None:
            on_progress(len(mapped), len(mapped), "the governed rules")
        governed = self._run_governed_rules(session_id, checked, datasets)
        findings.extend(governed)

        # 8. How many ROWS each rule flags, as distinct from how many values.
        #
        #    A finding counts offending values in one field. Adding those up
        #    across a rule's fields counts a row once per bad field: 83 failing
        #    fields turned 419,000 rows into 2.8 million "rows flagged". One
        #    extra pass answers the row question properly — a row is one row
        #    however many of a rule's fields it breaks — and the two numbers
        #    are then reported side by side under their own names.
        by_column = {c["column_id"]: c for c in checked}
        tests: dict[str, list[dict]] = {}
        group_labels: dict[str, str] = {}
        for finding in findings:
            test = self._row_test_for(finding, by_column, internal_names)
            if test is None:
                continue
            key = _rule_group_key(finding)
            tests.setdefault(key, []).append(test)
            if key not in group_labels:
                detail_for_label = finding.get("detail") or {}
                group_labels[key] = (
                    detail_for_label.get("rule_name")
                    or self._AUTOMATIC_CHECK_LABELS.get(finding["check_type"])
                    or finding["check_type"]
                )
        counted = datasets.rows_failing_by_group(
            session_id, [{"key": key, "tests": value} for key, value in tests.items()]
        )

        for finding in findings:
            detail = finding.get("detail")
            if not isinstance(detail, dict):
                detail = {"value": detail}
                finding["detail"] = detail
            detail["table_rows_total"] = counted.get("__total__", 0)
            detail["table_rows_flagged"] = counted.get("__any__", 0)
            # None, not 0: a share or a readiness decision has no set of rows,
            # and "0 rows" would read as "nothing wrong here".
            detail["rows_in_table"] = counted.get(_rule_group_key(finding))

        # 9. Say again how much of this data can be used — this time counting
        #    the rules the person actually configured.
        #
        #    `row_usability` knows only the model's own structure: required,
        #    unique, datatype, duplicate rows. It has never seen a governed
        #    rule. So a table where every one of 18 rows breaks two
        #    approved-values rules still reported "100% can be used, 0% needs
        #    fixing" beside those two failures — the rules a person chose
        #    themselves are the ones they care most about, and they were the
        #    ones left out. The pass above already counted rows failing
        #    anything at all; that is the honest figure.
        rows_total = counted.get("__total__", 0)
        rows_failing = min(counted.get("__any__", 0), rows_total)
        usable_rows = max(0, rows_total - rows_failing)
        usable_percent = round(usable_rows / rows_total * 100, 1) if rows_total else 0.0
        unusable_percent = round(100 - usable_percent, 1) if rows_total else 0.0

        # Why, worst first — "42% cannot be used" is not actionable on its own.
        reasons = sorted(
            (
                {
                    "key": key,
                    "label": group_labels.get(key, key),
                    "rows": counted.get(key, 0),
                    "percent": (
                        round(counted.get(key, 0) / rows_total * 100, 1) if rows_total else 0.0
                    ),
                }
                for key in tests
                if counted.get(key, 0) > 0
            ),
            key=lambda reason: -reason["rows"],
        )

        # Which fields this verdict actually covers. "0% of this data can be
        # used" over 137,950 rows, when one field of ninety carried a rule, is
        # a true sentence about a number nobody asked for. The scope travels
        # with the figure so the screen can say what was assessed.
        assessed = sorted({
            f["column_name"] for f in findings
            if f.get("scope") == "governed" and f.get("column_name")
            and f["check_type"] != self.CONFIGURATION_ERROR
        })
        governed_ran = [
            f for f in findings
            if f.get("scope") == "governed" and f["check_type"] != self.CONFIGURATION_ERROR
        ]
        findings.append({
            "scope": "dataset",
            "column_id": None,
            "column_name": "Usable records",
            "target_node_id": None,
            "target_name": None,
            "check_type": "usability",
            # Nothing governed is not a pass. A screen that says "100% of
            # this data can be used" after checking nothing is the single
            # most misleading thing this step can print.
            "status": (
                "warning" if not governed_ran
                else "passed" if rows_failing == 0
                else "failed" if usable_percent < 90
                else "warning"
            ),
            "rule_source": "default",
            "observed_count": rows_failing,
            "total_count": rows_total,
            "metric_value": usable_percent / 100,
            "message": (
                "No governed rule ran on this table, so nothing here has been "
                "assessed. Attach rules on the Rules step, or review the Profile "
                "observations."
                if not governed_ran
                else f"{usable_percent}% of rows ({usable_rows} of {rows_total}) pass every "
                "governed rule that ran"
                + (f" on {', '.join(assessed)}." if assessed else ".")
                + (
                    f" {unusable_percent}% ({rows_failing} rows) break at least one and "
                    "need fixing first."
                    if rows_failing
                    else ""
                )
            ),
            "detail": {
                "total_rows": rows_total,
                "usable_rows": usable_rows,
                "unusable_rows": rows_failing,
                "usable_percent": usable_percent,
                "unusable_percent": unusable_percent,
                # What is making rows unusable, so the number can be acted on.
                "reasons": reasons,
                # Named, not implied. A verdict without its scope is how a
                # one-field assessment came to speak for ninety columns.
                "assessed_fields": assessed,
                "assessed_field_count": len(assessed),
                "scope_note": (
                    "Measured against the governed rules that ran on "
                    + ", ".join(assessed)
                    if assessed
                    else "No governed rule ran on this table."
                ),
                # The structure-only figure from the Profile stage, kept so
                # the two can be told apart.
                "structure_only_unusable_rows": usability["unusable_rows"],
            },
        })

        # A result that cannot be traced back to the bytes, the mapping and the
        # rule set it came from is not evidence, so all three are stamped on
        # every finding. The versions are content hashes: they change exactly
        # when the mapping or the rule set changes, and not otherwise.
        # Stored with the run, so a result stays explainable years later, but
        # under their own scope: every Quality Check read filters them out, and
        # the Profile step is the only screen that asks for them.
        for observation in observations:
            observation["scope"] = "profile"

        parsed_for_run = datasets.get_parsed_file(session_id)
        source_record = (self._imports.get_source_file_by_id(source_file_id) if source_file_id
                         else self._imports.get_source_file(session_id))
        # The fingerprints say whether two runs were measured the same way; the
        # snapshots say what that way was. Keeping only the first is what made a
        # past result unexplainable the moment a threshold moved.
        datasets.record_quality_run(
            session_id,
            parsed_for_run["source_file_id"],
            execution_id,
            findings + observations,
            file_hash=source_record.storage_ref if source_record else "",
            mapping_version=_mapping_version(mapped),
            rule_version=_rule_version(configurations_for_run),
            mapping_snapshot=_mapping_snapshot(mapped),
            rule_snapshot=_rule_snapshot(configurations_for_run),
            table_name=(source_record.original_filename if source_record else ""),
            run_group_id=run_group_id,
            checked_columns=len(checked),
            rows_total=int(checked[0]["total"]) if checked else 0,
            requested_by=actor,
        )
        self._audit.record(
            actor=actor,
            action="quality.checks_run",
            outcome="success",
            session_id=session_id,
            detail={
                "checked_columns": len(checked),
                "findings": len(findings),
                "profile_observations": len(observations),
                "governed_rules": len(governed),
                "configuration_errors": sum(
                    1 for f in findings if f["check_type"] == self.CONFIGURATION_ERROR
                ),
                "failed": sum(1 for f in findings if f["status"] == "failed"),
            },
        )
        return self._quality_report(
            session_id, checked_columns=len(checked), source_file_id=source_file_id
        )

    #: Governed checks a single row can break. The others — a share, a ratio,
    #: a readiness decision — are judgements about a whole column or a whole
    #: run, so there is no set of rows to point at and none is invented.
    _ROW_LEVEL_GOVERNED = {
        "mandatory", "unique", "format", "valid_date",
        "allowed_values", "range", "comparison", "duplicate_records",
    }

    def _row_test_for(
        self, finding: dict, by_column: dict, duplicate_keys: list[str]
    ) -> dict | None:
        """
        The row-level test behind a finding, in the form the repository's row
        counter takes — or None when the finding is not about rows at all.

        Each branch has to agree with the query that produced the finding's
        `observed_count`; if it stops agreeing, a rule reports more rows than
        values, which is impossible and visible.
        """
        column = by_column.get(finding.get("column_id"))
        check = finding.get("check_type")

        if check == "completeness":
            return {"kind": "missing", "column": column["internal_name"]} if column else None
        if check == "uniqueness":
            return {"kind": "unique", "column": column["internal_name"]} if column else None
        if check == "type_conformance":
            if column is None:
                return None
            if column["is_date"]:
                return {"kind": "date", "column": column["internal_name"]}
            if column["pattern"]:
                return {
                    "kind": "pattern",
                    "column": column["internal_name"],
                    "pattern": column["pattern"],
                    "case_insensitive": column["case_insensitive"],
                }
            # A text field with no pattern cannot fail its type.
            return None
        if check == "duplicate_records":
            return {"kind": "duplicate_row", "keys": duplicate_keys}
        if check != "governed_rule":
            # `overlap` is about pairs of fields, not rows; `usability` is the
            # roll-up of every other check and would count each row twice; a
            # mapped-field issue is reported beside the rules, not folded into
            # the verdict they produce.
            return None

        detail = finding.get("detail") or {}
        governed = detail.get("check_type") or ""
        if governed not in self._ROW_LEVEL_GOVERNED:
            return None
        parameters = detail.get("parameters") or {}
        ignored = _as_list(parameters.get("ignored_values"))

        if governed == "duplicate_records":
            return {"kind": "duplicate_row", "keys": duplicate_keys}
        if column is None:
            return None
        name = column["internal_name"]

        if governed == "mandatory":
            return {"kind": "missing", "column": name, "ignored": ignored}
        if governed == "unique":
            return {"kind": "unique", "column": name, "ignored": ignored}
        if governed == "valid_date":
            return {
                "kind": "date", "column": name, "ignored": ignored,
                "date_format": parameters.get("date_format") or "any",
            }
        if governed == "format":
            pattern = str(parameters.get("pattern") or "").strip()
            if not pattern:
                return None
            return {"kind": "pattern", "column": name, "ignored": ignored, "pattern": pattern}
        if governed == "allowed_values":
            values = _as_list(parameters.get("allowed_values"))
            if not values:
                return None
            return {
                "kind": "not_in_list", "column": name, "ignored": ignored,
                "values": values, "case_sensitive": bool(parameters.get("case_sensitive")),
            }
        if governed == "range":
            return {
                "kind": "outside_range", "column": name, "ignored": ignored,
                "min": parameters.get("min_value"), "max": parameters.get("max_value"),
            }
        if governed == "comparison":
            value = parameters.get("value")
            if value is None:
                return None
            try:
                operator = comparator_sql(str(parameters.get("comparator") or ""))
            except ValueError:
                return None
            return {"kind": "comparison", "column": name, "operator": operator,
                    "value": float(value)}
        return None

    # ── governed rule execution ──────────────────────────────────────────────

    #: Values that are present but say nothing — a stand-in for an answer
    #: nobody has given yet. They are not blank, so completeness counts them as
    #: populated, and on the client's file one of them ("unknown") accounts for
    #: 87.7% of the column. Matched case-insensitively on the trimmed value.
    PLACEHOLDER_VALUES = (
        "unknown", "unkown", "n/a", "na", "n.a.", "none", "null", "nil",
        "not known", "not applicable", "not available", "tbd", "tba",
        "-", "--", "---", "?", "??", ".", "#n/a", "#na", "blank", "empty",
    )

    #: A rule that was ticked but cannot run. Never a data-quality finding: it
    #: says the governance is unfinished, not that the data is wrong, and the
    #: two go to different people.
    CONFIGURATION_ERROR = "configuration_error"

    #: Missing or placeholder values on a field somebody mapped. Reported by the
    #: quality run because the field was mapped, counted on its own because it
    #: is a fact about the data rather than a rule anybody wrote.
    FIELD_ISSUE = "mapped_field_issue"

    def _live_readiness(self, session_id: str) -> dict[tuple[str, str], dict]:
        """
        Readiness as the governance stands right now, by (property, configuration).

        An attachment carries the parameters it was handed when it was ticked.
        That freeze is right for evidence -- a finished run must keep reporting
        what it actually measured -- and wrong for the next run, which would
        otherwise check against approved values that were revoked days ago.
        The governance note asks for readiness to be revalidated "again before
        execution", so it is resolved fresh here, every run.
        """
        from features.discover.service.discover_governed_rules_service import (
            DiscoverGovernedRulesService,
        )

        state: dict[tuple[str, str], dict] = {}
        try:
            fields = DiscoverGovernedRulesService(self._db_url).list_field_rules(session_id)
        except Exception:
            # Readiness is a safety net, not the run's spine. If it cannot be
            # resolved the run proceeds on the frozen parameters rather than
            # refusing to check anything at all.
            return state
        for field in fields.get("fields", []):
            node_id = field.get("target_node_id") or ""
            for item in field.get("items", []):
                state[(node_id, item.get("rule_configuration_id") or "")] = {
                    "readiness": item.get("readiness"),
                    "reason": item.get("readiness_reason") or "",
                    "name": item.get("name") or "",
                    "code": item.get("code") or "",
                    "is_attached": bool(item.get("is_attached")),
                    "column_id": field.get("column_id") or "",
                    "column_name": field.get("column_name") or "",
                    "target_node_id": node_id,
                    "target_name": field.get("target_name"),
                }
        return state

    def _configuration_error(self, config: dict, reason: str) -> dict:
        """A ticked rule that did not run, and why — reported, never silent."""
        return {
            "scope": "governed",
            "column_id": config.get("column_id") or None,
            "column_name": config.get("column_name") or "All mapped fields",
            "target_node_id": config.get("target_node_id"),
            "target_name": config.get("target_name"),
            "check_type": self.CONFIGURATION_ERROR,
            "rule_source": f"{config.get('code', '')} — {config.get('rule_name', '')}".strip(" —"),
            "status": "warning",
            "observed_count": 0,
            "total_count": 0,
            "metric_value": 0.0,
            "message": reason,
            "detail": {
                "rule_code": config.get("code", ""),
                "rule_name": config.get("rule_name", ""),
                "rule_kind": config.get("rule_kind", ""),
                "check_type": config.get("check_type", ""),
                "severity": config.get("severity") or config.get("default_severity") or "",
                "rule_configuration_id": config.get("source_rule_configuration_id") or "",
                "configuration_error": True,
                "reason": reason,
            },
        }

    def _run_governed_rules(
        self, session_id: str, checked: list[dict], datasets: "DiscoverDatasetRepository"
    ) -> list[dict]:
        """
        Execute the governed rules this session turned on.

        Discover does not author rules: each rule's behaviour comes from the
        governed catalogue, and only the parameters the rule permits — the ones
        stored against the session — vary here. Profile rules are observations
        already covered by the Profile step, so only Data Quality and Business
        Quality rules produce findings at this stage.
        """
        configurations = [
            c for c in self._governance.list_configurations(session_id)
            if c["is_enabled"] and c["rule_kind"] in ("dq", "bq")
        ]
        if not configurations:
            return []

        by_column = {c["column_id"]: c for c in checked}
        readiness = self._live_readiness(session_id)
        findings: list[dict] = []

        # Data Quality first, then Business Quality — a business rule decides
        # from the DQ evidence, so that evidence has to exist before it runs.
        for config in sorted(configurations, key=lambda c: c["rule_kind"] != "dq"):
            # Readiness as it stands now, not as it stood when this rule was
            # ticked. A configuration whose approved values have since been
            # revoked is incomplete and must not execute against the list it
            # happens to have frozen.
            state = readiness.get((
                config.get("target_node_id") or "",
                config.get("source_rule_configuration_id") or "",
            ))
            if state is not None and state["readiness"] != "ready":
                findings.append(self._configuration_error(
                    config,
                    state["reason"]
                    or "This check is not ready to run: its governance is incomplete.",
                ))
                continue

            if config["check_type"] == "input_readiness":
                finding = self._evaluate_input_readiness(config, findings, checked)
            else:
                finding = self._evaluate_governed_rule(
                    session_id, config, by_column.get(config["column_id"]), checked, datasets
                )
            if finding is None:
                # A rule the analyst ticked that produced nothing. It was once
                # dropped here without a word, which is the worst outcome
                # available: the screen reported a clean run and the check had
                # never been made.
                finding = self._configuration_error(
                    config,
                    f"This check is attached to {config.get('column_name') or 'a field'}, "
                    "which is not mapped in the table that was checked, so it did not run.",
                )
            findings.append(finding)

        # A rule that is incomplete was never attached, so the loop above never
        # sees it. Left there, the Quality step reported "nothing was assessed"
        # without saying why — the reason only existed on the Rules step. Every
        # mapped field's unfinished governance is carried onto the run.
        seen = {
            (f.get("target_node_id") or "", (f.get("detail") or {}).get("rule_configuration_id") or "")
            for f in findings
        }
        mapped_nodes = {c.get("target_node_id") for c in checked if c.get("target_node_id")}
        for (node_id, configuration_id), state in sorted(readiness.items()):
            if state["readiness"] == "ready" or state["is_attached"]:
                continue
            if node_id not in mapped_nodes or (node_id, configuration_id) in seen:
                continue
            findings.append(self._configuration_error({
                "column_id": state["column_id"],
                "column_name": state["column_name"],
                "target_node_id": state["target_node_id"],
                "target_name": state["target_name"],
                "code": state["code"],
                "rule_name": state["name"],
                "source_rule_configuration_id": configuration_id,
            }, state["reason"] or "This check is not ready to run: its governance is incomplete."))

        return findings

    #: Which check group each Data Quality check belongs to, for the readiness
    #: decision. Grouping is what turns a list of failures into an answer a
    #: business can act on.
    _READINESS_GROUPS = {
        "mandatory": "Asset identity",
        "unique": "Asset identity",
        "allowed_values": "Asset attribute",
        "format": "Asset attribute",
        "value_share": "Asset attribute",
        "range": "Asset attribute",
        "comparison": "Asset attribute",
        "classified_values": "Risk classification",
        "valid_date": "Inspection date",
        "duplicate_records": "Record integrity",
    }

    def _evaluate_input_readiness(
        self, config: dict, dq_findings: list[dict], checked: list[dict]
    ) -> dict:
        """
        Decide whether the dataset is fit for its business purpose.

        This rule measures nothing itself. It reads the Data Quality results
        already produced in this run, groups them, and turns them into one
        business answer with the reason for each group. Recomputing the raw
        fields here would duplicate the DQ logic and drift from it the moment
        either side changed — the two would disagree and nobody would know
        which to believe.
        """
        parameters = config.get("parameters") or {}
        required = _as_list(parameters.get("required_targets"))
        allowed_failures = int(parameters.get("max_failed_groups") or 0)

        groups: dict[str, dict] = {}
        for finding in dq_findings:
            if finding["check_type"] != "governed_rule":
                continue
            check_type = finding["detail"].get("check_type", "")
            group_name = self._READINESS_GROUPS.get(check_type, "Other checks")
            group = groups.setdefault(group_name, {"status": "passed", "reasons": []})
            if finding["status"] == "failed":
                group["status"] = "failed"
                group["reasons"].append(f"{finding['column_name']}: {finding['message']}")

        # A field the purpose cannot do without, that was never mapped at all.
        mapped_targets = {c.get("target_name") for c in checked}
        missing = [name for name in required if name not in mapped_targets]
        if missing:
            groups["Required mappings"] = {
                "status": "failed",
                "reasons": [f"Not mapped: {', '.join(missing)}"],
            }

        failed_groups = [name for name, g in groups.items() if g["status"] == "failed"]
        ready = len(failed_groups) <= allowed_failures
        severity = config.get("severity") or config.get("default_severity") or "high"

        return {
            "scope": "governed",
            "column_id": None,
            "column_name": "Business decision",
            "target_node_id": None,
            "target_name": None,
            "check_type": "governed_rule",
            "rule_source": f"{config['code']} — {config['rule_name']}",
            "status": "passed" if ready else "failed",
            "observed_count": len(failed_groups),
            "total_count": max(len(groups), 1),
            "metric_value": round(1 - (len(failed_groups) / max(len(groups), 1)), 4),
            "message": (
                "Ready — every critical check group passed."
                if ready
                else f"Not ready — {len(failed_groups)} check group(s) failed: "
                     f"{', '.join(failed_groups)}."
            ),
            "detail": {
                "rule_code": config["code"],
                "rule_kind": config["rule_kind"],
                "rule_name": config["rule_name"],
                "severity": severity,
                "parameters": parameters,
                "decision": "Ready" if ready else "Not ready",
                # The evidence this decision was made from, so the answer can be
                # traced back to the DQ results that produced it.
                "check_groups": [
                    {"group": name, "status": g["status"], "reasons": g["reasons"][:4]}
                    for name, g in sorted(groups.items())
                ],
                "consumed_dq_findings": sum(
                    1 for f in dq_findings if f["check_type"] == "governed_rule"
                ),
            },
        }

    def _evaluate_governed_rule(
        self,
        session_id: str,
        config: dict,
        column: dict | None,
        checked: list[dict],
        datasets: "DiscoverDatasetRepository",
    ) -> dict | None:
        """`datasets` is the run's pinned repository — see run_quality_checks."""
        parameters = config.get("parameters") or {}
        check_type = config["check_type"]
        severity = config.get("severity") or config.get("default_severity") or "medium"
        base = {
            "scope": "governed",
            "column_id": config["column_id"] or None,
            "column_name": config["column_name"] or "All mapped fields",
            "target_node_id": config.get("target_node_id"),
            "target_name": config.get("target_name"),
            "check_type": "governed_rule",
            "rule_source": f"{config['code']} — {config['rule_name']}",
        }

        def result(status: str, message: str, observed: int, total: int, detail: dict) -> dict:
            return {
                **base,
                "status": status,
                "observed_count": observed,
                "total_count": total,
                "metric_value": round(1 - (observed / total), 4) if total else 1.0,
                "message": message,
                "detail": {
                    "rule_code": config["code"],
                    "rule_kind": config["rule_kind"],
                    "rule_name": config["rule_name"],
                    # Which Rule Workspace rule this is a copy of. Attaching one
                    # library rule to fields in two tables makes two governed
                    # rules with two codes, because governed_rule.code is unique
                    # session-wide; this is what says they are the same rule.
                    "rule_definition_id": config.get("source_rule_definition_id") or "",
                    "check_type": check_type,
                    "severity": severity,
                    "parameters": parameters,
                    **detail,
                },
            }

        def within_tolerance(observed: int, total: int) -> bool:
            tolerance = float(parameters.get("tolerance_percent") or 0)
            return total > 0 and (observed / total) * 100 <= tolerance

        # Values a rule treats as "no answer yet" — see the ignore list on the
        # rule definition. They are left out of the question rather than counted
        # as failures, so the violations and the denominator are both recounted
        # without them.
        ignored = _as_list(parameters.get("ignored_values"))

        if check_type in ("mandatory", "unique", "allowed_values", "format", "range",
                          "valid_date", "value_share", "comparison"):
            if column is None:
                return None
            internal = column["internal_name"]
            total = column["total"]
            if ignored:
                counts = datasets.column_counts(session_id, internal, ignored)
                total = counts["total"]
                column = {
                    **column,
                    "total": counts["total"],
                    "missing": counts["missing"],
                    "filled": counts["filled"],
                    "duplicates": counts["duplicates"],
                }

        if check_type == "comparison":
            comparator = str(parameters.get("comparator") or "").strip()
            threshold = parameters.get("value")
            if not comparator or threshold is None:
                return result(
                    "warning", "No comparison is configured, so nothing was checked.",
                    0, total, {"needs_parameters": True},
                )
            try:
                sql_operator = comparator_sql(comparator)
            except ValueError:
                return result(
                    "warning", f"'{comparator}' is not a comparison this session can run.",
                    0, total, {"needs_parameters": True},
                )
            outcome = datasets.values_failing_comparison(
                session_id, internal, sql_operator, float(threshold)
            )
            observed = outcome["violations"]
            # Judged over the values that could be compared at all. Counting text
            # as failures would report a datatype problem as a threshold breach.
            comparable = outcome["comparable"]
            ok = observed == 0 or within_tolerance(observed, comparable)
            stated = describe(
                column["column_name"], comparator, {"value": threshold}
            )
            return result(
                "passed" if ok else "failed",
                f"All {comparable} comparable value(s) satisfy {stated}."
                if observed == 0
                else f"{observed} of {comparable} value(s) do not satisfy {stated}"
                     + (" — within the tolerance set for this session." if ok else "."),
                observed, comparable,
                {
                    "comparator": comparator,
                    "compared_against": threshold,
                    "failing_examples": outcome["samples"],
                    "non_numeric": outcome["non_numeric"],
                },
            )

        if check_type == "valid_date":
            date_format = str(parameters.get("date_format") or "any")
            outcome = datasets.invalid_date_values(
                session_id, internal, date_format, ignored=ignored
            )
            observed = outcome["violations"]
            ok = observed == 0 or within_tolerance(observed, column["filled"])
            shape = _DATE_FORMAT_LABELS.get(date_format, date_format)
            return result(
                "passed" if ok else "failed",
                f"All {column['filled']} values are real dates in {shape}."
                if observed == 0
                else f"{observed} value(s) are not real dates in {shape}"
                     + (" — within the tolerance set for this session." if ok else "."),
                observed, column["filled"],
                {"invalid_examples": outcome["samples"], "date_format": date_format},
            )

        if check_type == "mandatory":
            observed = column["missing"]
            ok = observed == 0 or within_tolerance(observed, total)
            return result(
                "passed" if ok else "failed",
                f"Every row carries a value for {column['column_name']}."
                if observed == 0
                else f"{observed} of {total} rows are missing a value"
                     + (" — within the tolerance set for this session." if ok else "."),
                observed, total,
                {"example_rows": datasets.missing_row_numbers(session_id, internal),
                 "ignored_values": ignored},
            )

        if check_type == "unique":
            observed = column["duplicates"]
            ok = observed == 0 or within_tolerance(observed, column["filled"])
            return result(
                "passed" if ok else "failed",
                f"All {column['filled']} values are unique."
                if observed == 0
                else f"{observed} repeated value(s)"
                     + (" — within the tolerance set for this session." if ok else "."),
                observed, column["filled"],
                {"duplicate_values": datasets.duplicate_values(session_id, internal, ignored=ignored)
                 if observed else [],
                 "ignored_values": ignored},
            )

        if check_type == "allowed_values":
            allowed = _as_list(parameters.get("allowed_values"))
            if not allowed:
                return result(
                    "warning", "No approved values are configured, so nothing was checked.",
                    0, total, {"needs_parameters": True},
                )
            outcome = datasets.values_outside_list(
                session_id, internal, allowed, bool(parameters.get("case_sensitive")),
                ignored=ignored,
            )
            observed = outcome["violations"]
            blanks = int(outcome.get("blanks", 0))
            wrong = int(outcome.get("populated_violations", observed))
            # A blank is not one of the approved values, so it fails — but it
            # fails for a different reason than a misspelt one, and the two are
            # named apart so the reader knows which work they are looking at.
            breakdown = (
                f"{observed} of {total} rows do not carry an approved value"
                + (
                    f" — {wrong} hold a value that is not in the list"
                    f" and {blanks} are empty."
                    if wrong and blanks
                    else f" — all {blanks} are empty." if blanks
                    else "."
                )
            )
            return result(
                "passed" if observed == 0 else "failed",
                f"Every one of the {total} rows carries a value from the approved list "
                f"of {len(allowed)}."
                if observed == 0
                else breakdown,
                observed, total,
                {
                    "allowed_values": allowed,
                    "invalid_examples": outcome["samples"],
                    "blank_rows": blanks,
                    "invalid_value_rows": wrong,
                },
            )

        if check_type == "format":
            pattern = str(parameters.get("pattern") or "").strip()
            if not pattern:
                return result(
                    "warning", "No format is configured, so nothing was checked.",
                    0, total, {"needs_parameters": True},
                )
            try:
                outcome = datasets.type_violations(session_id, internal, pattern, ignored=ignored)
            except Exception:  # an invalid regular expression is a config problem
                return result(
                    "warning", "The configured format is not a valid expression.",
                    0, total, {"pattern": pattern, "needs_parameters": True},
                )
            observed = outcome["violations"]
            return result(
                "passed" if observed == 0 else "failed",
                "Every value matches the approved format."
                if observed == 0
                else f"{observed} value(s) do not match the approved format.",
                observed, total,
                {"pattern": pattern, "invalid_examples": outcome["samples"]},
            )

        if check_type == "range":
            minimum, maximum = parameters.get("min_value"), parameters.get("max_value")
            if minimum is None and maximum is None:
                return result(
                    "warning", "No minimum or maximum is configured, so nothing was checked.",
                    0, total, {"needs_parameters": True},
                )
            outcome = datasets.values_outside_range(
                session_id, internal, minimum, maximum, ignored=ignored
            )
            observed = outcome["violations"]
            return result(
                "passed" if observed == 0 else "failed",
                "Every numeric value falls inside the expected range."
                if observed == 0
                else f"{observed} value(s) fall outside {minimum if minimum is not None else '−∞'}"
                     f" to {maximum if maximum is not None else '∞'}.",
                observed, total,
                {
                    "min_value": minimum,
                    "max_value": maximum,
                    "out_of_range_examples": outcome["samples"],
                    "non_numeric": outcome["non_numeric"],
                },
            )

        if check_type == "duplicate_records":
            keys = [c["internal_name"] for c in checked]
            outcome = datasets.duplicate_rows(session_id, keys)
            # Copies, not rows-in-groups: the same quantity the row counter
            # reports for this rule. Counting the whole group here is what put
            # "137,908 duplicate rows" beside "no duplicate records".
            observed = outcome["duplicate_copies"]
            total = checked[0]["total"] if checked else 0
            ok = observed == 0 or within_tolerance(observed, total)
            return result(
                "passed" if ok else "failed",
                "No record is repeated across the mapped fields."
                if observed == 0
                else f"{observed} repeated copy(ies) across the mapped fields, in "
                     f"{outcome['duplicate_groups']} group(s)"
                     + (" — within the tolerance set for this session." if ok else "."),
                observed, total, outcome,
            )

        if check_type == "value_share":
            wanted = str(parameters.get("value") or "").strip()
            max_percent = parameters.get("max_percent")
            if not wanted or max_percent is None:
                return result(
                    "warning",
                    "This rule needs a value and a maximum share before it can run.",
                    0, total, {"needs_parameters": True},
                )
            counts = datasets.value_counts_by_group(session_id, internal)
            populated = sum(c["count"] for c in counts if c["value"])
            observed = sum(
                c["count"] for c in counts if c["value"].strip().lower() == wanted.lower()
            )
            share = (observed / populated * 100) if populated else 0.0
            within = share <= float(max_percent)
            return result(
                "passed" if within else "failed",
                f"{wanted} is {round(share, 2)}% of {populated} rows, within the "
                f"{max_percent}% limit."
                if within
                else f"{wanted} is {round(share, 2)}% of {populated} rows, over the "
                     f"{max_percent}% limit.",
                observed, populated or 1,
                {
                    "value": wanted,
                    "max_percent": max_percent,
                    "observed_percent": round(share, 2),
                    "matching_rows": observed,
                    "populated_rows": populated,
                },
            )

        if check_type == "category_ratio":
            return self._evaluate_category_ratio(session_id, config, parameters, checked, result)

        return None

    def _evaluate_category_ratio(
        self, session_id: str, config: dict, parameters: dict, checked: list[dict], result,
    ) -> dict | None:
        """
        A governed share rule — Transformers at most 10% of Devices within each
        Network.

        The category is named by the values that belong to it, so the rule needs
        nothing beyond the data and the mapping. An earlier version counted
        through the governed hierarchy instead, which was more expressive but
        made every share rule depend on a separate classification pass; for the
        shapes this actually gets used on, naming the values says the same thing
        and is one step shorter.
        """
        column = next((c for c in checked if c["column_id"] == config["column_id"]), None)
        if column is None:
            return None

        category = {v.lower() for v in _as_list(parameters.get("category_values"))}
        max_percent = parameters.get("max_percent")
        if not category or max_percent is None:
            return result(
                "warning",
                "This rule needs the category's values and a maximum share before it can run.",
                0, 1, {"needs_parameters": True},
            )
        wider = {v.lower() for v in _as_list(parameters.get("compared_with_values"))}

        group_column = parameters.get("group_by_column")
        group_internal = next(
            (c["internal_name"] for c in checked
             if group_column in (c["column_name"], c["column_id"], c["internal_name"])),
            None,
        )
        rows = self._datasets.value_counts_by_group(
            session_id, column["internal_name"], group_internal
        )

        groups: dict[str, dict[str, int]] = {}
        for row in rows:
            value = (row["value"] or "").strip().lower()
            if not value:
                continue
            bucket = groups.setdefault(row["group_value"], {"category": 0, "compared": 0})
            if value in category:
                bucket["category"] += row["count"]
            # An empty "compared against" means the whole group is the comparison.
            if not wider or value in wider:
                bucket["compared"] += row["count"]

        breaches, reported = [], []
        for name, bucket in sorted(groups.items()):
            if bucket["compared"] == 0:
                continue
            share = bucket["category"] / bucket["compared"] * 100
            entry = {
                "group": name or "All rows",
                "numerator": bucket["category"],
                "denominator": bucket["compared"],
                "share_percent": round(share, 2),
            }
            reported.append(entry)
            if share > float(max_percent):
                breaches.append(entry)

        return result(
            "passed" if not breaches else "failed",
            f"Every group stays within the {max_percent}% limit."
            if not breaches
            else f"{len(breaches)} group(s) exceed the {max_percent}% limit "
                 f"(highest {max(b['share_percent'] for b in breaches)}%).",
            len(breaches), max(len(reported), 1),
            {
                "limit_percent": max_percent,
                "grouped_by": group_column,
                "category_values": sorted(category),
                "groups": reported[:20],
                "breaches": breaches[:10],
            },
        )


    # ── reads ────────────────────────────────────────────────────────────────

    # ── the results, arranged by the rule that produced them ─────────────────

    #: How an automatic check is named when a person is told why their rows
    #: cannot be used. The internal check_type is not an answer to that.
    _AUTOMATIC_CHECK_LABELS = {
        "completeness": "Missing values",
        "uniqueness": "Repeated values in a field that must be unique",
        "type_conformance": "Values that do not match the field's datatype",
        "duplicate_records": "Duplicate records",
    }

    #: Checks whose observed_count is a number of offending VALUES (cells).
    #: `duplicate_records` counts rows, not values; `overlap` counts pairs of
    #: fields; `usability` is a roll-up. None of those belongs in a cell total.
    _COUNTS_VALUES_AUTOMATIC = {"completeness", "uniqueness", "type_conformance"}
    #: The same, for governed rules. A share rule counts matching rows and a
    #: readiness rule counts failed check groups, so neither is a cell count.
    _COUNTS_VALUES_GOVERNED = {
        "mandatory", "unique", "format", "valid_date",
        "allowed_values", "range", "comparison",
    }

    #: Worst first. A rule's severity is whatever was set on it in the Rule
    #: Workspace; this is only the order they are read in.
    _SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
    #: Worst first, again for ordering only.
    _STATUS_ORDER = {"failed": 0, "warning": 1, "passed": 2}

    def quality_by_rule(self, session_id: str) -> dict:
        """
        The last run's findings grouped by the rule that produced them.

        The Quality step answers "what is wrong with this field, in this
        table". This answers the question a person asks first: which rules did
        we run, which of them is failing, how badly, and where. A rule is one
        row however many tables and fields it touched, and the places it broke
        hang underneath it.

        Rules the person defined and automatic checks are kept apart. A rule
        carries the severity it was given in the Rule Workspace; an automatic
        check was never given one, and inventing a severity for it would put a
        number nobody chose beside the numbers somebody did.
        """
        stored = self._datasets.list_quality_checks_everywhere(
            session_id, include_profile=True
        )
        # The Profile side is kept out of every rule count on this screen; it
        # is read here only so "has this session been checked" can answer yes
        # when a run produced observations but no governed rule.
        findings = [f for f in stored if f.get("scope") != "profile"]
        tables = {
            entry["source_file_id"]: entry["original_filename"]
            for entry in self._imports.list_source_files(session_id)
        }

        # Stamped on every finding by the run: how many rows the table has and
        # how many of them failed anything at all. Same value on every finding
        # of a table, so it is read into a dict rather than summed.
        rows_per_table: dict[str, int] = {}
        rows_flagged_per_table: dict[str, int] = {}
        for finding in findings:
            stamped = finding.get("detail") or {}
            if stamped.get("table_rows_total") is not None:
                rows_per_table[finding["source_file_id"]] = int(stamped["table_rows_total"])
            if stamped.get("table_rows_flagged") is not None:
                rows_flagged_per_table[finding["source_file_id"]] = int(
                    stamped["table_rows_flagged"]
                )

        grouped: dict[str, dict] = {}
        configuration_errors: list[dict] = []
        field_issues: list[dict] = []
        for finding in findings:
            detail = finding.get("detail") or {}
            # Usability is a roll-up of the other checks, not a check of its
            # own: counting it as a rule would count every row it read twice.
            if finding["check_type"] == "usability":
                continue
            # A configuration error is a rule that did NOT run. Counting it
            # among the rules would report a check that was never made, and
            # counting it as clean would be worse.
            if finding["check_type"] == self.FIELD_ISSUE:
                field_issues.append({
                    "column_name": finding["column_name"],
                    "target_name": finding.get("target_name"),
                    "table_name": tables.get(finding["source_file_id"], ""),
                    "issue": detail.get("issue", ""),
                    "status": finding["status"],
                    "observed_count": finding["observed_count"],
                    "total_count": finding["total_count"],
                    "message": finding["message"],
                })
                continue
            if finding["check_type"] == self.CONFIGURATION_ERROR:
                configuration_errors.append({
                    "rule_code": detail.get("rule_code", ""),
                    "rule_name": detail.get("rule_name", ""),
                    "column_name": finding["column_name"],
                    "target_name": finding.get("target_name"),
                    "table_name": tables.get(finding["source_file_id"], ""),
                    "reason": detail.get("reason") or finding["message"],
                })
                continue
            is_governed = finding["check_type"] == "governed_rule"

            # The same identity the row counter counted rows under. One
            # library rule attached to fields in two tables makes two governed
            # rules with two codes, and they are one rule.
            key = _rule_group_key(finding)
            if is_governed:
                name = detail.get("rule_name") or finding["rule_source"]
                code = detail.get("rule_code") or ""
                severity = detail.get("severity") or ""
                check_type = detail.get("check_type") or "governed_rule"
            else:
                key = f"auto:{finding['check_type']}"
                name = finding["check_type"]
                code = ""
                severity = ""
                check_type = finding["check_type"]

            rule = grouped.setdefault(key, {
                "key": key,
                "kind": "governed" if is_governed else "automatic",
                "code": code,
                "name": name,
                "severity": severity,
                "check_type": check_type,
                "runs": 0, "passed": 0, "warnings": 0, "failed": 0,
                # Rows and values are different quantities and are never added
                # together: one bad row with six bad fields is 1 row, 6 values.
                "rows_flagged": 0, "values_flagged": 0,
                "rows_total": 0, "values_checked": 0,
                "_counts_values": False,
                "_tables": set(), "_tables_failing": set(), "_fields_failing": set(),
                # rows_in_table is a per-TABLE figure repeated on every finding
                # of that rule in that table, so it is taken once per table.
                "_rows_by_table": {}, "_counts_rows": False,
                "targets": [],
            })

            # Copies of one library rule carry suffixed codes (REQ-01-B784);
            # the rule's own code is the short one it was given.
            if code and (not rule["code"] or len(code) < len(rule["code"])):
                rule["code"] = code

            rule["runs"] += 1
            if finding["status"] == "failed":
                rule["failed"] += 1
            elif finding["status"] == "warning":
                rule["warnings"] += 1
            else:
                rule["passed"] += 1
            # Two independent questions. Whether a check counts values is
            # decided by what it measures; whether it can name the rows is
            # decided by whether this run stamped them on. A finding from
            # before the row counter existed still has a true value count.
            counts_values = (
                (detail.get("check_type") or "") in self._COUNTS_VALUES_GOVERNED
                if is_governed
                else finding["check_type"] in self._COUNTS_VALUES_AUTOMATIC
            )
            if counts_values:
                rule["_counts_values"] = True
                rule["values_flagged"] += int(finding["observed_count"] or 0)
                rule["values_checked"] += int(finding["total_count"] or 0)

            rows_here = detail.get("rows_in_table")
            if rows_here is not None:
                # A share, a ratio or a readiness decision has no set of rows
                # to point at, and neither has a finding stored before this
                # run counted them. Showing 0 would read as "nothing wrong".
                rule["_counts_rows"] = True
                rule["_rows_by_table"][finding["source_file_id"]] = int(rows_here)

            table_name = tables.get(finding["source_file_id"]) or finding.get("table_name") or ""
            rule["_tables"].add(table_name)
            if finding["status"] != "passed":
                rule["_tables_failing"].add(table_name)
                rule["_fields_failing"].add((table_name, finding["column_name"]))

            rule["targets"].append({
                "quality_check_id": finding["quality_check_id"],
                "source_file_id": finding["source_file_id"],
                "table_name": table_name,
                "is_active_table": bool(finding.get("is_active_table")),
                "column_name": finding["column_name"],
                "target_name": finding.get("target_name"),
                "status": finding["status"],
                "observed_count": int(finding["observed_count"] or 0),
                "total_count": int(finding["total_count"] or 0),
                "message": finding["message"],
                "detail": detail,
            })

        rules = []
        for rule in grouped.values():
            rule["status"] = (
                "failed" if rule["failed"] else "warning" if rule["warnings"] else "passed"
            )
            rule["rows_flagged"] = sum(rule["_rows_by_table"].values())
            rule["rows_total"] = sum(
                rows_per_table.get(file_id, 0) for file_id in rule.pop("_rows_by_table")
            )
            # False for a rule that measures a share rather than rows: the
            # screen shows "—" instead of a zero that would read as "clean".
            rule["counts_rows"] = rule.pop("_counts_rows")
            rule["counts_values"] = rule.pop("_counts_values")
            rule["tables_checked"] = len(rule.pop("_tables"))
            rule["tables_failing_count"] = len(rule.pop("_tables_failing"))
            rule["fields_failing_count"] = len(rule.pop("_fields_failing"))
            rule["targets"].sort(key=lambda t: (
                self._STATUS_ORDER.get(t["status"], 9), t["table_name"], t["column_name"]
            ))
            rules.append(rule)

        rules.sort(key=lambda r: (
            self._STATUS_ORDER.get(r["status"], 9),
            self._SEVERITY_ORDER.get(r["severity"], 3),
            -r["fields_failing_count"],
            -r["rows_flagged"],
            r["name"].lower(),
        ))

        governed = [r for r in rules if r["kind"] == "governed"]
        by_severity = []
        for level in ("high", "medium", "low"):
            at_level = [r for r in governed if r["severity"] == level]
            if not at_level:
                continue
            by_severity.append({
                "severity": level,
                "rules": len(at_level),
                "failing": sum(1 for r in at_level if r["status"] != "passed"),
                # Values, not rows: two rules at the same severity can flag the
                # same row, and adding their row counts would count it twice.
                "values_flagged": sum(r["values_flagged"] for r in at_level),
            })

        # The rule breaking in the most places. Ties go to the one flagging the
        # most rows, because "worst" without a tie-break flickers between two
        # equals every time the page reloads.
        worst_rule = next(
            iter(sorted(
                (r for r in rules if r["status"] != "passed"),
                key=lambda r: (-r["fields_failing_count"], -r["rows_flagged"], r["name"].lower()),
            )),
            None,
        )

        checked_tables = sorted({
            t["table_name"] for r in rules for t in r["targets"] if t["table_name"]
        })

        # Summing the rules' row counts would count a row once per rule that
        # flags it. The only honest session figure is the per-table count of
        # rows failing anything at all, added across tables — a row belongs to
        # exactly one table, so that sum is a sum of distinct rows.
        rows_flagged_total = sum(rows_flagged_per_table.values())
        rows_total = sum(rows_per_table.values())

        return {
            "session_id": session_id,
            "has_run": len(stored) > 0,
            "profile_observations": sum(1 for f in stored if f.get("scope") == "profile"),
            "rules_run": len(rules),
            "rules_failing": sum(1 for r in rules if r["status"] == "failed"),
            "rules_warning": sum(1 for r in rules if r["status"] == "warning"),
            "rules_clean": sum(1 for r in rules if r["status"] == "passed"),
            "governed_rules": len(governed),
            "automatic_checks": len(rules) - len(governed),
            # Two different quantities, never added together and never shown
            # under one label: 419,000 rows can hold 8.6 million bad cells.
            "rows_flagged": rows_flagged_total,
            "rows_total": rows_total,
            "values_flagged": sum(r["values_flagged"] for r in rules),
            "values_checked": sum(r["values_checked"] for r in rules),
            "tables_checked": len(checked_tables),
            "table_names": checked_tables,
            # Their own list, never folded into the rule counts above.
            "configuration_errors": configuration_errors,
            "configuration_error_count": len(configuration_errors),
            "field_issues": field_issues,
            "field_issue_count": len(field_issues),
            "by_severity": by_severity,
            "worst_rule": None if worst_rule is None else {
                "key": worst_rule["key"],
                "name": worst_rule["name"],
                # An automatic check's name is its internal check type; the
                # screen turns that into words, and needs this to do it.
                "check_type": worst_rule["check_type"],
                "severity": worst_rule["severity"],
                "kind": worst_rule["kind"],
                "fields_failing_count": worst_rule["fields_failing_count"],
                "tables_failing_count": worst_rule["tables_failing_count"],
                "rows_flagged": worst_rule["rows_flagged"],
                "values_flagged": worst_rule["values_flagged"],
                "counts_rows": worst_rule["counts_rows"],
                "counts_values": worst_rule["counts_values"],
            },
            "rules": rules,
        }

    def get_quality_report(self, session_id: str) -> dict:
        """Return the persisted findings from the last run."""
        return self._quality_report(session_id)

    # ── the evidence trail ───────────────────────────────────────────────────

    def list_quality_runs(self, session_id: str, source_file_id: str = "") -> dict:
        """
        Every run this session has completed, newest first, and grouped.

        "How many times has this session been checked" is a question about
        *runs*, and a run is one table. Checking a seven-table session once
        writes seven records, and reporting that as seven runs would be a lie
        in the other direction — so the per-table records are rolled up by the
        `run_group_id` they were started under, and both numbers are returned.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")
        runs = self._datasets.list_quality_runs(session_id, source_file_id=source_file_id)
        for run in runs:
            run["rule_versions"] = _rule_versions_used(run.get("rule_snapshot") or [])

        groups: list[dict] = []
        by_group: dict[str, dict] = {}
        for run in runs:
            # A single-table run carries no group; it is a group of one, keyed
            # by itself, so the two kinds sit in one list without special cases.
            key = run["run_group_id"] or f"solo:{run['quality_run_id']}"
            group = by_group.get(key)
            if group is None:
                group = {
                    "run_group_id": run["run_group_id"],
                    "key": key,
                    "completed_at": run["completed_at"],
                    "requested_by": run["requested_by"],
                    "tables": 0,
                    "checked_columns": 0,
                    "findings_total": 0,
                    "failed_count": 0,
                    "warning_count": 0,
                    "rows_total": 0,
                    "runs": [],
                }
                by_group[key] = group
                groups.append(group)
            group["tables"] += 1
            for field in ("checked_columns", "findings_total", "failed_count",
                          "warning_count", "rows_total"):
                group[field] += run[field]
            # The group finished when its last table did.
            group["completed_at"] = max(group["completed_at"], run["completed_at"])
            group["runs"].append(run)

        for group in groups:
            seen: dict[tuple, dict] = {}
            for run in group["runs"]:
                for used in run["rule_versions"]:
                    seen.setdefault((used["rule_definition_id"], used["version"]), used)
            group["rule_versions"] = sorted(seen.values(), key=lambda u: (u["code"], u["version"]))
        groups.sort(key=lambda g: g["completed_at"], reverse=True)

        return {
            "session_id": session_id,
            "items": runs,
            "total": len(runs),
            "groups": groups,
            # What a person means by "how many times has this been checked".
            "run_count": len(groups),
            # The newest run of each table is the one the Quality step shows.
            "current_run_ids": sorted({
                next(r["quality_run_id"] for r in runs if r["source_file_id"] == file_id)
                for file_id in {r["source_file_id"] for r in runs}
            }),
        }

    def get_quality_run(self, session_id: str, quality_run_id: str) -> dict:
        """
        One run as it was recorded: its findings and the configuration that
        produced them, neither of which changes afterwards.
        """
        run = self._datasets.get_quality_run(quality_run_id)
        if run is None or run["session_id"] != session_id:
            raise LookupError("Quality run not found.")
        return {
            **run,
            "rule_versions": _rule_versions_used(run.get("rule_snapshot") or []),
            "findings": self._datasets.list_quality_checks_for_run(quality_run_id),
        }

    def _quality_report(
        self,
        session_id: str,
        checked_columns: int | None = None,
        source_file_id: str = "",
    ) -> dict:
        """
        The findings of one table. A run pinned to a table has to report that
        table, not whichever one the session happens to have open — otherwise
        a worker checking table three answers with table one's numbers.
        """
        stored = self._datasets.for_table(source_file_id).list_quality_checks(
            session_id, include_profile=True
        )
        # Three groups, never one total. Profile observations belong to the
        # Profile stage; configuration errors are rules that were turned on but
        # could not run; what is left is the Quality Check itself. "5 checks,
        # 1 failed" has to mean five checks were actually made.
        observations = [f for f in stored if f.get("scope") == "profile"]
        findings = [f for f in stored if f.get("scope") != "profile"]
        errors = [f for f in findings if f["check_type"] == self.CONFIGURATION_ERROR]
        # Usability is the verdict the other checks add up to, not a check of
        # its own. Counting it made the banner say "2 checks ... 2 failed"
        # beside tiles reading "1 rule run, 1 failing" — the same run, two
        # denominators, no label saying which was which.
        issues = [f for f in findings if f["check_type"] == self.FIELD_ISSUE]
        ran = [
            f for f in findings
            if f["check_type"] not in (self.CONFIGURATION_ERROR, self.FIELD_ISSUE, "usability")
        ]
        failed = sum(1 for f in ran if f["status"] == "failed")
        warnings = sum(1 for f in ran if f["status"] == "warning")
        passed = sum(1 for f in ran if f["status"] == "passed")
        columns = checked_columns
        if columns is None:
            # Counted over everything the run produced: a governed finding
            # carries scope "governed", and reading only "column" would report
            # no fields checked on a re-read of a governed-only run.
            columns = len({
                f["column_id"] for f in stored
                if f["column_id"] and f["scope"] in ("column", "governed", "profile")
            })
        governed = [f for f in ran if f["check_type"] == "governed_rule"]

        # The usable/unusable split is stored with the run so it survives reload.
        usability = next(
            (f["detail"] for f in findings if f["check_type"] == "usability"),
            next((f["detail"] for f in observations if f["check_type"] == "usability"), None),
        )

        # Which table these numbers describe. The roll-up above this card on
        # the Quality step spans every table, so a per-table figure sitting
        # beside it has to say so — 18 of 18 rows next to 429,186 reads as a
        # contradiction until you know they are counting different things.
        scoped_file_id = source_file_id or (findings[0]["source_file_id"] if findings else "")
        scoped_table = ""
        if scoped_file_id:
            record = self._imports.get_source_file_by_id(scoped_file_id)
            scoped_table = getattr(record, "original_filename", "") if record else ""

        return {
            "session_id": session_id,
            "table_name": scoped_table,
            "source_file_id": scoped_file_id,
            "checked_columns": columns,
            # Fields a governed rule actually ran on. `checked_columns` counts
            # what was mapped, which since the two stages were separated is a
            # different and larger number: "1 check across 4 mapped fields"
            # invited the reader to divide one by the other.
            "assessed_columns": len({
                f["column_id"] for f in ran
                if f["column_id"] and f["check_type"] == "governed_rule"
            }),
            "total_checks": len(ran),
            # One configuration attached to two fields makes two checks and is
            # still one rule. Both numbers are true and they are different, so
            # the screen states them together rather than leaving a reader to
            # divide one by the other.
            "rules_run": len({
                (f.get("detail") or {}).get("rule_configuration_id")
                or (f.get("detail") or {}).get("rule_code")
                or f["check_type"]
                for f in ran
            }),
            "passed": passed,
            "warnings": warnings,
            "failed": failed,
            # A run with a rule that could not execute is not a clean run, even
            # when everything that did execute passed.
            "is_clean": len(ran) > 0 and failed == 0 and warnings == 0 and not errors,
            # A run happened even if no governed rule produced a finding —
            # otherwise a session whose rules are all still unconfigured
            # reports "never checked" straight after being checked.
            "has_run": len(stored) > 0,
            "profile_observations": len(observations),
            "configuration_errors": [
                {
                    "rule_code": (f.get("detail") or {}).get("rule_code", ""),
                    "rule_name": (f.get("detail") or {}).get("rule_name", ""),
                    "column_name": f["column_name"],
                    "target_name": f.get("target_name"),
                    "reason": (f.get("detail") or {}).get("reason") or f["message"],
                }
                for f in errors
            ],
            "configuration_error_count": len(errors),
            # Missing and placeholder values on mapped fields. Their own list
            # and their own total: they are reported by the run, and they are
            # not rules, so they never move the pass/fail counts above.
            "field_issues": [
                {
                    "column_name": f["column_name"],
                    "target_name": f.get("target_name"),
                    "issue": (f.get("detail") or {}).get("issue", ""),
                    "status": f["status"],
                    "observed_count": f["observed_count"],
                    "total_count": f["total_count"],
                    "message": f["message"],
                    "detail": f.get("detail") or {},
                }
                for f in issues
            ],
            "field_issue_count": len(issues),
            "usability": usability,
            "governed_checks": len(governed),
            "governed_failed": sum(1 for f in governed if f["status"] == "failed"),
            "findings": findings,
            "refresh": RefreshRequest(
                scope="session",
                reason="Data quality checks completed.",
                targets=[session_id],
            ),
        }

    def get_column_profile(
        self, session_id: str, discovery_column_id: str, limit: int = 50
    ) -> dict:
        """
        Return one column's profile computed from the persisted rows: totals,
        missing/non-missing, and the field's real distinct values (variants)
        with their counts, plus the automatic profiling observations.
        """
        column = self._datasets.get_discovery_column(session_id, discovery_column_id)
        if column is None:
            raise ValueError(
                "Column not found for this session. Re-run profiling after changing the file."
            )

        internal_name = column["internal_name"]
        datatype = column["inferred_datatype"]
        stats = self._datasets.profile_column(session_id, internal_name)
        total_rows = stats["total_rows"]
        raw_values = self._datasets.column_value_counts(session_id, internal_name, limit)

        values = [
            {
                "value": entry["value"],
                "is_missing": entry["value"] == "",
                "count": entry["count"],
                "percent": round(entry["count"] / total_rows * 100, 1) if total_rows else 0.0,
            }
            for entry in raw_values
        ]

        extremes = self._datasets.column_extremes(session_id, internal_name, datatype)
        patterns = self._datasets.column_patterns(session_id, internal_name)
        outliers = self._datasets.column_outliers(session_id, internal_name)

        # "Basic type or parsing errors" from the automatic profiling list. A
        # date column is checked against the calendar rather than a pattern, so
        # profiling reports 31/02/2026 as the parsing error it is.
        pattern = TYPE_PATTERNS.get(datatype)
        if datatype == "DateTime":
            violation = self._datasets.invalid_date_values(session_id, internal_name)
            parse_errors = {
                "count": violation["violations"],
                "examples": violation["samples"],
                "expected": datatype,
            }
        elif pattern:
            violation = self._datasets.type_violations(
                session_id,
                internal_name,
                pattern,
                datatype in CASE_INSENSITIVE_TYPES,
            )
            parse_errors = {
                "count": violation["violations"],
                "examples": violation["samples"],
                "expected": datatype,
            }
        else:
            parse_errors = {"count": 0, "examples": [], "expected": datatype}

        return {
            "discovery_column_id": discovery_column_id,
            "source_label": column["source_label"],
            "internal_name": internal_name,
            "inferred_datatype": datatype,
            "ordinal": column["ordinal"],
            "is_nullable": column["is_nullable"],
            "total_rows": total_rows,
            "missing": stats["blank_count"],
            "non_missing": stats["non_blank_count"],
            "distinct_count": stats["distinct_count"],
            "values": values,
            "extremes": extremes,
            "patterns": patterns,
            "outliers": outliers,
            "parse_errors": parse_errors,
        }

    def get_dataset(self, session_id: str, limit: int = 50, offset: int = 0) -> dict:
        """
        The parsed file's headers plus a page of its real data rows.

        Deliberately cheap: a lookup of the stored shape and one indexed page
        of rows, a few milliseconds on a file of any size. The duplicate-row
        scan that used to be computed here reads every row of the table, and
        bundling the two meant a preview of ten rows waited on a full-table
        scan — ten seconds on a wide file, every time the step was opened. It
        is its own call now: see `duplicate_summary`.
        """
        parsed = self._datasets.get_parsed_file(session_id)
        if parsed is None:
            return {
                "column_labels": [],
                "internal_names": [],
                "row_count": 0,
                "column_count": 0,
                "rows": [],
            }
        return {
            "column_labels": parsed["column_labels"],
            "internal_names": parsed["internal_names"],
            "row_count": parsed["row_count"],
            "column_count": parsed["column_count"],
            "rows": self._datasets.list_rows(session_id, limit=limit, offset=offset),
        }

    def profile_observations(self, session_id: str, source_file_id: str = "") -> dict:
        """
        The automatic risk observations for the table being worked on.

        Missing values, repeated records, overlapping fields, values that do
        not parse. These need no rule and no mapping decision to be worth
        knowing, so they are reported at the Profile stage and are deliberately
        absent from the Quality Check verdict, which reports governed DQ and BQ
        rules only.
        """
        datasets = self._datasets.for_table(source_file_id)
        rows = datasets.list_profile_observations(session_id)
        by_check: dict[str, list[dict]] = {}
        for row in rows:
            by_check.setdefault(row["check_type"], []).append(row)
        flagged = [r for r in rows if r["status"] != "passed"]
        return {
            "session_id": session_id,
            "has_run": bool(rows),
            "observations": rows,
            "total": len(rows),
            "needs_attention": len(flagged),
            "by_check": [
                {
                    "check_type": check,
                    "label": self._AUTOMATIC_CHECK_LABELS.get(check, check),
                    "total": len(group),
                    "needs_attention": sum(1 for g in group if g["status"] != "passed"),
                }
                for check, group in sorted(by_check.items())
            ],
        }

    def duplicate_summary(self, session_id: str) -> dict:
        """
        How many rows of the table being worked on are copies of another.

        Exact duplicate rows are an automatic profiling observation: no rule is
        needed to notice the same record appearing twice. It costs a pass over
        every row, so the screen asks for it on its own, after the data is
        already on the page.
        """
        parsed = self._datasets.get_parsed_file(session_id)
        if parsed is None:
            return {"duplicate_row_count": 0, "duplicate_groups": 0}
        duplicates = self._datasets.duplicate_rows(session_id, parsed["internal_names"])
        return {
            "duplicate_row_count": duplicates["duplicate_rows"],
            "duplicate_groups": duplicates["duplicate_groups"],
        }


#: How each date convention is named in a finding, so the message says what was
#: actually asked of the data rather than an internal code.
_DATE_FORMAT_LABELS = {
    "any": "a recognised date format",
    "iso": "YYYY-MM-DD",
    "dmy": "DD-MM-YYYY",
    "mdy": "MM-DD-YYYY",
    "month_year": "MM-YYYY or YYYY-MM",
    "year": "YYYY",
}


def _rule_group_key(finding: dict) -> str:
    """
    Which rule a finding belongs to.

    `quality_by_rule` groups findings by this and the row counter counts rows
    by this, so they must be the same function — otherwise a rule's row count
    lands under a rule that did not produce it.
    """
    if finding.get("check_type") != "governed_rule":
        return f"auto:{finding.get('check_type')}"
    detail = finding.get("detail") or {}
    # The library rule is the identity: one rule attached to fields in two
    # tables makes two governed rules with two codes, and they are one rule.
    identity = (
        detail.get("rule_definition_id")
        or detail.get("rule_code")
        or detail.get("rule_name")
        or "rule"
    )
    return f"rule:{identity}"


def _as_list(value) -> list[str]:
    """Accept an approved-value list either as a list or as comma-separated text."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [part.strip() for part in str(value).split(",") if part.strip()]


def _mapping_version(mapped: list[dict]) -> str:
    """
    A fingerprint of the mapping a run used. Two runs share a version exactly
    when they mapped the same source fields to the same governed targets.
    """
    pairs = sorted(
        f"{m.get('column_name', '')}->{m.get('target_node_id') or ''}" for m in mapped
    )
    return f"map:{sha256('|'.join(pairs).encode()).hexdigest()[:16]}"


def _rule_versions_used(rule_snapshot: list[dict]) -> list[dict]:
    """
    The distinct library rules and versions a run executed.

    Read off the snapshot rather than the library, because the library is the
    thing that has since moved. A rule built in the Rule Builder carries no
    library version and is left out: there is no earlier version of it to read.
    """
    seen: dict[tuple, dict] = {}
    for entry in rule_snapshot:
        definition_id = entry.get("source_rule_definition_id") or ""
        version = str(entry.get("source_rule_version") or "")
        if not definition_id or not version:
            continue
        seen.setdefault((definition_id, version), {
            "rule_definition_id": definition_id,
            "version": version,
            "code": entry.get("code") or "",
            "name": entry.get("name") or "",
        })
    return sorted(seen.values(), key=lambda u: (u["code"], u["version"]))


def _mapping_snapshot(mapped: list[dict]) -> list[dict]:
    """
    The mapping as it stood when the run read it.

    `_mapping_version` hashes exactly these pairs, so the two cannot disagree:
    one identifies the mapping, this one is the mapping.
    """
    return [
        {
            "column_id": m.get("column_id") or "",
            "column_name": m.get("column_name") or "",
            "target_node_id": m.get("target_node_id") or "",
            "target_name": m.get("target_name") or "",
        }
        for m in mapped
    ]


def _rule_snapshot(configurations: list[dict]) -> list[dict]:
    """
    Every rule the run executed, with the parameters it executed them with.

    This is the record that makes an old result explainable. A library rule can
    be edited and a session's parameters changed the next day; neither touches
    what is written here, because it is a copy taken at the moment of the run
    rather than a pointer to something that moves. `source_rule_definition_id`
    and `source_rule_version` say which library rule, at which version, the
    executed copy came from.
    """
    return [
        {
            "configuration_id": c.get("configuration_id") or "",
            "rule_id": c.get("rule_id") or "",
            "code": c.get("code") or "",
            "name": c.get("rule_name") or "",
            "rule_kind": c.get("rule_kind") or "",
            "check_type": c.get("check_type") or "",
            "applies_to": c.get("applies_to") or "",
            "column_id": c.get("column_id") or "",
            "column_name": c.get("column_name") or "",
            "target_node_id": c.get("target_node_id") or "",
            "target_name": c.get("target_name") or "",
            "severity": c.get("severity") or c.get("default_severity") or "",
            "parameters": c.get("parameters") or {},
            "source_rule_definition_id": c.get("source_rule_definition_id") or "",
            "source_rule_version": c.get("source_rule_version") or "",
        }
        for c in configurations
    ]


def _rule_version(configurations: list[dict]) -> str:
    """
    A fingerprint of the rule set a run used, including the parameters. Change
    a threshold and the version changes, so two results are never compared as
    though they were measured the same way.
    """
    entries = sorted(
        f"{c.get('code', '')}@{c.get('target_node_id') or ''}"
        f":{json.dumps(c.get('parameters') or {}, sort_keys=True)}"
        f":{c.get('severity') or ''}"
        for c in configurations
    )
    return f"rules:{sha256('|'.join(entries).encode()).hexdigest()[:16]}"
