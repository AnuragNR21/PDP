"""
The import queue: one job per uploaded file.

Upload writes a job and returns. A pool of workers picks jobs up, structures
the file they hold and writes back what stage they are at, so the screen can
show progress per file and a reload can find the same work still going.

Everything a job needs is in its row — including the file's bytes — so a job
interrupted by a restart can be run again without asking anyone to upload
anything a second time.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from shared.db import get_connection

#: A job whose worker has not reported in for this long is treated as lost:
#: the process holding it died, and nobody else will finish it.
STALE_AFTER_SECONDS = 120

_COLUMNS = (
    "job_id, session_id, filename, file_size_bytes, content_sha256, uploaded_by, "
    "status, stage, progress, rows_done, rows_total, tables_created, "
    "table_names_json, message, attempts, created_at, started_at, finished_at, "
    "heartbeat_at"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hydrate(row: dict) -> dict:
    entry = dict(row)
    entry["table_names"] = json.loads(entry.pop("table_names_json", "[]") or "[]")
    return entry


class DiscoverImportJobRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── writing a job ────────────────────────────────────────────────────────

    def enqueue(
        self,
        session_id: str,
        filename: str,
        content: bytes,
        content_sha256: str,
        uploaded_by: str,
        status: str = "waiting",
    ) -> dict:
        """
        Record an uploaded file as work to be done.

        Re-uploading a file replaces the job it had, the same way it replaces
        the tables it produced: a session holds one job per file name, which is
        also what stops a queue filling with abandoned attempts.
        """
        job_id = f"job_{uuid4().hex[:12]}"
        now = _now()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_import_job WHERE session_id = %s AND filename = %s",
                (session_id, filename),
            )
            conn.execute(
                "INSERT INTO discovery_import_job "
                "(job_id, session_id, filename, file_size_bytes, content_sha256, content, "
                " uploaded_by, status, stage, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    job_id, session_id, filename, len(content), content_sha256,
                    memoryview(content), uploaded_by, status, "Waiting to start", now,
                ),
            )
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM discovery_import_job WHERE job_id = %s", (job_id,)
            ).fetchone()
        return _hydrate(row)

    def mark_queued(self, session_id: str) -> list[str]:
        """Send everything this session is holding to the workers."""
        now = _now()
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "UPDATE discovery_import_job SET status = 'queued', stage = 'Queued', "
                "message = '', progress = 0, finished_at = NULL, heartbeat_at = %s "
                "WHERE session_id = %s AND status IN ('waiting', 'failed') "
                "RETURNING job_id",
                (now, session_id),
            ).fetchall()
        return [dict(row)["job_id"] for row in rows]

    def claim(self, job_id: str) -> dict | None:
        """
        Take a job, if it is still there to be taken.

        The update is the claim: two workers racing for the same job means one
        of them updates a row that is no longer queued, and gets nothing back.
        """
        now = _now()
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "UPDATE discovery_import_job "
                "SET status = 'running', stage = 'Reading the file', progress = 1, "
                "    started_at = %s, heartbeat_at = %s, attempts = attempts + 1, message = '' "
                f"WHERE job_id = %s AND status = 'queued' RETURNING {_COLUMNS}",
                (now, now, job_id),
            ).fetchone()
        return None if row is None else _hydrate(row)

    def content_of(self, job_id: str) -> bytes | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT content FROM discovery_import_job WHERE job_id = %s", (job_id,)
            ).fetchone()
        if row is None or dict(row)["content"] is None:
            return None
        return bytes(dict(row)["content"])

    def progress(
        self,
        job_id: str,
        stage: str,
        percent: int,
        rows_done: int = 0,
        rows_total: int = 0,
    ) -> None:
        """Say where the work has got to. Also the worker's sign of life."""
        with get_connection(self._db_url) as conn:
            # GREATEST, never plain assignment: a bar that goes backwards
            # tells the person the work was undone.
            conn.execute(
                "UPDATE discovery_import_job SET stage = %s, "
                "progress = GREATEST(progress, %s), "
                "rows_done = GREATEST(rows_done, %s), rows_total = %s, "
                "heartbeat_at = %s WHERE job_id = %s",
                (stage, max(0, min(100, percent)), rows_done, rows_total, _now(), job_id),
            )

    def succeeded(self, job_id: str, table_names: list[str], message: str = "") -> None:
        """
        Finish a job and let go of its bytes.

        The file was kept only so the work could be done again after a restart;
        once it is done, holding a copy of every file ever uploaded would be a
        database of things nobody reads.
        """
        now = _now()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_import_job SET status = 'succeeded', stage = 'Done', "
                "progress = 100, tables_created = %s, table_names_json = %s, message = %s, "
                "finished_at = %s, heartbeat_at = %s, content = NULL WHERE job_id = %s",
                (len(table_names), json.dumps(table_names), message, now, now, job_id),
            )

    def failed(self, job_id: str, message: str) -> None:
        """Stop, and say why in the words the person will read."""
        now = _now()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_import_job SET status = 'failed', stage = 'Failed', "
                "message = %s, finished_at = %s, heartbeat_at = %s WHERE job_id = %s",
                (message[:500], now, now, job_id),
            )

    # ── reading jobs ─────────────────────────────────────────────────────────

    def list_for_session(self, session_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM discovery_import_job "
                "WHERE session_id = %s ORDER BY created_at",
                (session_id,),
            ).fetchall()
        return [_hydrate(row) for row in rows]

    def get(self, job_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM discovery_import_job WHERE job_id = %s", (job_id,)
            ).fetchone()
        return None if row is None else _hydrate(row)

    def delete_for_file(self, session_id: str, filename: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_import_job WHERE session_id = %s AND filename = %s",
                (session_id, filename),
            )

    # ── picking up what was dropped ──────────────────────────────────────────

    def reclaim_lost(
        self, session_id: str | None = None, skip_ids: set[str] | None = None
    ) -> list[str]:
        """
        Put back any job whose worker stopped reporting.

        A process that dies mid-import leaves a row saying "running" that
        nothing is running. Rather than let it sit there for ever, a job that
        has not reported in for a while and still has its bytes goes back in
        the queue; one that has lost its bytes cannot be redone, and says so.
        """
        # A job the caller is running is not abandoned, however quiet it has
        # been: storing a large file is one long step with no progress to
        # report, and requeueing it there reads the same file twice.
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
            requeued = conn.execute(
                "UPDATE discovery_import_job SET status = 'queued', stage = 'Queued again', "
                "message = 'Picked up again after the server restarted.' "
                "WHERE status = 'running' AND content IS NOT NULL "
                "  AND EXTRACT(EPOCH FROM (NOW() - heartbeat_at::timestamptz)) > %s "
                f"  {scope} {mine} RETURNING job_id",
                tuple(params),
            ).fetchall()
            conn.execute(
                "UPDATE discovery_import_job SET status = 'failed', stage = 'Failed', "
                "message = 'The server stopped while reading this file. Upload it again.' "
                "WHERE status = 'running' AND content IS NULL "
                "  AND EXTRACT(EPOCH FROM (NOW() - heartbeat_at::timestamptz)) > %s "
                f"  {scope} {mine}",
                tuple(params),
            )
        return [dict(row)["job_id"] for row in requeued]

    def queued_ids(self, session_id: str | None = None) -> list[str]:
        """Jobs waiting for a worker, oldest first."""
        with get_connection(self._db_url) as conn:
            if session_id:
                rows = conn.execute(
                    "SELECT job_id FROM discovery_import_job WHERE status = 'queued' "
                    "AND session_id = %s ORDER BY created_at",
                    (session_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT job_id FROM discovery_import_job WHERE status = 'queued' "
                    "ORDER BY created_at"
                ).fetchall()
        return [dict(row)["job_id"] for row in rows]
