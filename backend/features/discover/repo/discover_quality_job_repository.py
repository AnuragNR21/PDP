"""
The quality-check queue: one job per table of a run.

Pressing Run writes a job for every table and returns. A pool of workers picks
them up, checks the table each one names and writes back how far it has got,
so the screen can show a percentage per table and a reload can find the same
run still going.

Everything a job needs is in its row — the session and the table — so a job
interrupted by a restart can simply be run again. Unlike an import there is
nothing to keep: the rows are already stored, and re-running a check is free
of consequence because a run replaces the previous findings for that table.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from shared.db import get_connection

#: A job whose worker has not reported in for this long is treated as lost:
#: the process holding it died, and nobody else will finish it.
STALE_AFTER_SECONDS = 180

_COLUMNS = (
    "job_id, session_id, source_file_id, table_name, run_id, requested_by, "
    "status, stage, progress, columns_done, columns_total, checked_columns, "
    "findings, failed_count, warnings, message, attempts, created_at, "
    "started_at, finished_at, heartbeat_at"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DiscoverQualityJobRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── starting a run ───────────────────────────────────────────────────────

    def start_run(self, session_id: str, tables: list[dict], requested_by: str) -> str:
        """
        Replace this session's jobs with one per table, all queued.

        A run is all of the session's tables or none of them: leaving the
        previous run's rows beside the new one would show a person two answers
        for the same table and no way to tell which is the live one.
        """
        run_id = f"qrun_{uuid4().hex[:12]}"
        now = _now()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_quality_job WHERE session_id = %s", (session_id,)
            )
            for entry in tables:
                conn.execute(
                    "INSERT INTO discovery_quality_job "
                    "(job_id, session_id, source_file_id, table_name, run_id, "
                    " requested_by, status, stage, created_at, heartbeat_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, 'queued', %s, %s, %s)",
                    (
                        f"qjob_{uuid4().hex[:12]}", session_id, entry["source_file_id"],
                        entry["original_filename"], run_id, requested_by,
                        "Waiting for a worker", now, now,
                    ),
                )
        return run_id

    def claim(self, job_id: str) -> dict | None:
        """
        Take a job, if it is still there to be taken.

        The update is the claim: two workers racing for the same table means
        one of them updates a row that is no longer queued and gets nothing
        back, so the table is never checked twice at once.
        """
        now = _now()
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "UPDATE discovery_quality_job "
                "SET status = 'running', stage = 'Reading the table', progress = 1, "
                "    started_at = %s, heartbeat_at = %s, attempts = attempts + 1, "
                "    message = '' "
                f"WHERE job_id = %s AND status = 'queued' RETURNING {_COLUMNS}",
                (now, now, job_id),
            ).fetchone()
        return None if row is None else dict(row)

    # ── saying where it has got to ───────────────────────────────────────────

    def progress(
        self, job_id: str, stage: str, percent: int, done: int = 0, total: int = 0
    ) -> None:
        """Report progress. Also the worker's sign of life."""
        with get_connection(self._db_url) as conn:
            # GREATEST, never plain assignment: a bar that goes backwards
            # tells the person the work was undone, and an out-of-order or
            # retried update must not be able to say that.
            conn.execute(
                "UPDATE discovery_quality_job SET stage = %s, "
                "progress = GREATEST(progress, %s), "
                "columns_done = GREATEST(columns_done, %s), columns_total = %s, "
                "heartbeat_at = %s WHERE job_id = %s",
                (stage, max(0, min(100, percent)), done, total, _now(), job_id),
            )

    def succeeded(self, job_id: str, outcome: dict) -> None:
        now = _now()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_quality_job SET status = 'succeeded', stage = 'Done', "
                "progress = 100, checked_columns = %s, findings = %s, failed_count = %s, "
                "warnings = %s, message = %s, finished_at = %s, heartbeat_at = %s "
                "WHERE job_id = %s",
                (
                    outcome.get("checked_columns", 0), outcome.get("findings", 0),
                    outcome.get("failed", 0), outcome.get("warnings", 0),
                    outcome.get("reason", ""), now, now, job_id,
                ),
            )

    def skipped(self, job_id: str, reason: str) -> None:
        """A table with nothing mapped is not a failure — it is a step not taken."""
        now = _now()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_quality_job SET status = 'skipped', stage = 'Skipped', "
                "progress = 100, message = %s, finished_at = %s, heartbeat_at = %s "
                "WHERE job_id = %s",
                (reason[:500], now, now, job_id),
            )

    def failed(self, job_id: str, message: str) -> None:
        """Stop, and say why in the words the person will read."""
        now = _now()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_quality_job SET status = 'failed', stage = 'Failed', "
                "message = %s, finished_at = %s, heartbeat_at = %s WHERE job_id = %s",
                (message[:500], now, now, job_id),
            )

    # ── reading a run ────────────────────────────────────────────────────────

    def list_for_session(self, session_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM discovery_quality_job "
                "WHERE session_id = %s ORDER BY created_at, table_name",
                (session_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def clear_for_session(self, session_id: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_quality_job WHERE session_id = %s", (session_id,)
            )

    def delete_for_file(self, session_id: str, source_file_id: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_quality_job "
                "WHERE session_id = %s AND source_file_id = %s",
                (session_id, source_file_id),
            )

    # ── picking up what was dropped ──────────────────────────────────────────

    def reclaim_lost(
        self, session_id: str | None = None, skip_ids: set[str] | None = None
    ) -> list[str]:
        """
        Put back any job whose worker stopped reporting.

        A process that dies mid-run leaves a row saying "running" that nothing
        is running. A check can always be redone — the rows it reads are
        already stored and a run replaces its own previous findings — so a
        lost job simply goes back in the queue.
        """
        # A job the caller is running is not abandoned, however quiet it has
        # been: a single long step can outlast the stale window with nothing
        # wrong, and requeueing it there runs the same table twice.
        held = sorted(skip_ids or ())
        with get_connection(self._db_url) as conn:
            scope = "AND session_id = %s" if session_id else ""
            params: list = [STALE_AFTER_SECONDS]
            if session_id:
                params.append(session_id)
            mine = ""
            if held:
                mine = "AND job_id <> ALL(%s)"
                params.append(held)
            rows = conn.execute(
                "UPDATE discovery_quality_job SET status = 'queued', "
                "stage = 'Queued again', progress = 0, "
                "message = 'Picked up again after the server restarted.' "
                "WHERE status = 'running' "
                "  AND EXTRACT(EPOCH FROM (NOW() - heartbeat_at::timestamptz)) > %s "
                f"  {scope} {mine} RETURNING job_id",
                tuple(params),
            ).fetchall()
        return [dict(row)["job_id"] for row in rows]

    def queued_ids(self, session_id: str | None = None) -> list[str]:
        """Tables waiting for a worker, oldest first."""
        with get_connection(self._db_url) as conn:
            if session_id:
                rows = conn.execute(
                    "SELECT job_id FROM discovery_quality_job WHERE status = 'queued' "
                    "AND session_id = %s ORDER BY created_at",
                    (session_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT job_id FROM discovery_quality_job WHERE status = 'queued' "
                    "ORDER BY created_at"
                ).fetchall()
        return [dict(row)["job_id"] for row in rows]
