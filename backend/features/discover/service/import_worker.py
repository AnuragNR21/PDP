"""
The pool that structures uploaded files, several at a time.

What a job does, in order: read the file into the tables it holds, store every
row of each table, then profile each table. That used to happen inside the
upload request, which meant a person watched a spinner for as long as their
file took — and uploading five files meant waiting for them one after another.

Threads, not processes. Nearly all of the time is spent talking to Postgres —
inserting rows in batches — and a thread waiting on a socket holds no lock, so
several files really do make progress at once. The parsing between those waits
is the part the GIL serialises, and it is the smaller half.

The pool is per process and deliberately small: each worker holds a database
connection and a file's rows in memory, so more of them is not automatically
faster. PDP_IMPORT_WORKERS sets it.
"""
from __future__ import annotations

import atexit
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor

from features.discover.repo.discover_import_job_repository import (
    DiscoverImportJobRepository,
)

logger = logging.getLogger(__name__)

#: How many files are structured at the same time.
DEFAULT_WORKERS = 3


def _worker_count() -> int:
    try:
        return max(1, min(8, int(os.environ.get("PDP_IMPORT_WORKERS", DEFAULT_WORKERS))))
    except ValueError:
        return DEFAULT_WORKERS


class ImportWorkerPool:
    """
    Runs import jobs in the background of this process.

    It holds no queue of its own: the queue is the job table, and this is a set
    of hands that reach into it. That is what lets a second process — or this
    one after a restart — pick up work nobody finished, and what keeps the
    screen's idea of progress and the worker's the same thing rather than two
    things that have to agree.
    """

    def __init__(self, db_url: str, run_job, jobs=None, name: str = "pdp-import") -> None:
        """
        `jobs` is the queue to take work from — any repository offering
        claim / failed / reclaim_lost / queued_ids. Import and quality use the
        same shape of queue and the same pool; what differs is which table
        the rows live in and what a job does.
        """
        self._db_url = db_url
        self._run_job = run_job
        self._jobs = jobs if jobs is not None else DiscoverImportJobRepository(db_url)
        self._pool = ThreadPoolExecutor(
            max_workers=_worker_count(), thread_name_prefix=name
        )
        #: Jobs this process has in flight, so a second Start Import does not
        #: hand the same file to two workers.
        self._in_flight: set[str] = set()
        self._lock = threading.Lock()
        atexit.register(self.shutdown)

    # ── handing work out ─────────────────────────────────────────────────────

    def submit(self, job_ids: list[str]) -> int:
        """Put these jobs to work, skipping any this process already holds."""
        started = 0
        for job_id in job_ids:
            with self._lock:
                if job_id in self._in_flight:
                    continue
                self._in_flight.add(job_id)
            self._pool.submit(self._run, job_id)
            started += 1
        return started

    def pump(self, session_id: str | None = None) -> int:
        """
        Pick up whatever is waiting: anything queued, and anything abandoned.

        Called when the screen asks for progress, so a browser reload is enough
        to get a stalled session moving again — no one has to know that the
        server restarted, only that the import is still going.

        A job this process is running is never treated as abandoned, however
        long it has been quiet. Heartbeats are written when a job reports
        progress, and a single long step — storing a 60 MB file, scanning
        140,000 rows for duplicates — can outlast the stale window without
        anything being wrong. Reclaiming it there handed the same work to a
        second worker and reset the first one's progress, which is what made
        the screen flicker between "running" and "queued again".
        """
        with self._lock:
            mine = set(self._in_flight)
        self._jobs.reclaim_lost(session_id, skip_ids=mine)
        return self.submit(self._jobs.queued_ids(session_id))

    # ── doing the work ───────────────────────────────────────────────────────

    def _run(self, job_id: str) -> None:
        try:
            job = self._jobs.claim(job_id)
            if job is None:
                # Someone else took it, or it was cancelled between the queue
                # and here. Not an error: the work is accounted for either way.
                return
            self._run_job(job)
        except Exception as exc:  # pragma: no cover - the worker must not die
            logger.exception("Import job %s failed", job_id)
            try:
                self._jobs.failed(job_id, str(exc))
            except Exception:
                logger.exception("Could not record the failure of import job %s", job_id)
        finally:
            with self._lock:
                self._in_flight.discard(job_id)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


#: One pool per process. The first service to ask builds it; everyone else
#: shares it, because three workers per service instance would be three pools
#: fighting over the same queue.
_POOL: ImportWorkerPool | None = None
_POOL_LOCK = threading.Lock()


def get_import_pool(db_url: str, run_job) -> ImportWorkerPool:
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = ImportWorkerPool(db_url, run_job)
        return _POOL


#: The quality pool is separate from the import pool on purpose: a long import
#: should not leave the checks without a worker, and neither should starve the
#: other. Each gets its own hands.
_QUALITY_POOL: ImportWorkerPool | None = None


def get_quality_pool(db_url: str, run_job, jobs) -> ImportWorkerPool:
    global _QUALITY_POOL
    with _POOL_LOCK:
        if _QUALITY_POOL is None:
            _QUALITY_POOL = ImportWorkerPool(
                db_url, run_job, jobs=jobs, name="pdp-quality"
            )
        return _QUALITY_POOL
