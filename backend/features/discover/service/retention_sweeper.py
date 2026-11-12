"""
Deleting archived sessions once their time is up.

Two ways in, on purpose. A thread wakes each minute so a quiet server still
does the work at the hour it was told; and `sweep_if_due` is also called when
a request arrives, so a server that was asleep or throttled at that hour — AWS
App Runner throttles CPU when no request is in flight — catches up the moment
somebody uses it. Both go through the same claim, so the sweep runs once a day
however many callers ask.

The same shape as the import and quality pools: the database row is the
schedule, not a timer held in memory, which is what makes it survive a
restart and stay correct with more than one process running.
"""
from __future__ import annotations

import atexit
import logging
import os
import threading

from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_retention_repository import (
    DiscoverRetentionRepository,
    cutoff_for,
    due_at,
    next_run_after,
    window_opened_at,
)
from features.discover.repo.discover_session_repository import DiscoverSessionRepository

logger = logging.getLogger(__name__)

#: How often the thread looks. The sweep itself happens at most once a day;
#: this only decides how soon after the hour it notices.
TICK_SECONDS = 60

#: Set PDP_RETENTION_SWEEPER=off to stop the background thread starting.
#:
#: Two reasons it exists. A test run is one: a thread deleting rows on its own
#: schedule, in the middle of assertions about which rows exist, is how a suite
#: becomes intermittently red for no reason anybody can reproduce. The other is
#: a deployment that moves the sweep to a worker — the web processes should
#: then not each be running their own.
#:
#: Turning it off does not turn the sweep off: every request still catches up a
#: window that is owed, which is the path that works on a throttled host anyway.
def _thread_enabled() -> bool:
    return os.environ.get("PDP_RETENTION_SWEEPER", "on").strip().lower() not in (
        "off", "0", "false", "no",
    )


class RetentionSweeper:
    """Deletes archived sessions whose retention has run out."""

    def __init__(self, db_url: str) -> None:
        self._db_url = db_url
        self._policy = DiscoverRetentionRepository(db_url)
        self._sessions = DiscoverSessionRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    # ── the work ─────────────────────────────────────────────────────────────

    def sweep_now(self, actor: str = "retention job") -> dict:
        """
        Delete everything that is out of time, whatever the clock says.

        This is what the Admin page's "Run now" calls and what the scheduled
        path calls once it has claimed the day.
        """
        policy = self._policy.get_policy()
        cutoff = cutoff_for(policy["retention_days"])
        due = self._sessions.archived_before(cutoff)
        deleted: list[str] = []
        failed: list[str] = []
        for session in due:
            try:
                if not self._sessions.delete_session(session["session_id"]):
                    continue
                deleted.append(session["session_id"])
                # No session_id on the record, and the id in the detail
                # instead. `discover_audit_event.session_id` is ON DELETE SET
                # NULL, so a record written before the delete loses the very
                # id that makes it worth keeping, and one written after with
                # the id set cannot be written at all.
                self._audit.record(
                    actor=actor,
                    action="session.purged",
                    outcome="success",
                    detail={
                        "session_id": session["session_id"],
                        "name": session["name"],
                        "archived_at": session["archived_at"],
                        "retention_days": policy["retention_days"],
                    },
                )
            except Exception as exc:  # one bad session must not stop the rest
                failed.append(session["session_id"])
                logger.exception("Could not delete archived session %s: %s",
                                 session["session_id"], exc)
        outcome = "ok" if not failed else f"{len(failed)} could not be deleted"
        self._policy.finish_run(len(deleted), outcome)
        return {
            "deleted": len(deleted),
            "failed": len(failed),
            "cutoff": cutoff,
            "retention_days": policy["retention_days"],
        }

    def sweep_if_due(self, actor: str = "retention job") -> dict | None:
        """
        Run today's sweep if nobody has. Returns None when there is nothing owed.

        Cheap enough to call on a request: one SELECT when the day is already
        done, and the claiming UPDATE only matches when it is not.
        """
        policy = self._policy.get_policy()
        opened = window_opened_at(policy["purge_hour_utc"])
        last = self._policy.last_run()["last_run_at"]
        if last and last > opened:
            return None
        if not self._policy.claim_run(opened):
            # Somebody else took it between the read and here.
            return None
        logger.info("Retention sweep: running for the window opened at %s", opened)
        return self.sweep_now(actor=actor)

    def status(self) -> dict:
        """Everything the Admin page needs to explain itself."""
        policy = self._policy.get_policy()
        cutoff = cutoff_for(policy["retention_days"])
        archived = self._sessions.list_sessions(archived=True)
        return {
            **policy,
            **self._policy.last_run(),
            "next_run_at": next_run_after(policy["purge_hour_utc"]),
            "archived_sessions": len(archived),
            "due_now": len(self._sessions.archived_before(cutoff)),
            # When the first of them actually falls out of retention. Without
            # it a sweep that correctly deletes nothing looks like a sweep that
            # is broken: the screen says two sessions are archived, none are
            # due, and gives no way to tell whether that is the policy working
            # or the job failing.
            "next_due_at": _earliest_due(archived, policy["retention_days"]),
        }

    # ── the thread ───────────────────────────────────────────────────────────

    def start(self) -> None:
        if not _thread_enabled():
            logger.info("Retention sweeper thread disabled by PDP_RETENTION_SWEEPER")
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stopping.clear()
            self._thread = threading.Thread(
                target=self._loop, name="retention-sweeper", daemon=True
            )
            self._thread.start()

    def _loop(self) -> None:
        while not self._stopping.wait(TICK_SECONDS):
            try:
                self.sweep_if_due()
            except Exception:
                # A sweep that throws must not take the thread with it, or the
                # next day never runs either.
                logger.exception("Retention sweep failed; will try again next tick")

    def shutdown(self) -> None:
        self._stopping.set()


def _earliest_due(archived: list, retention_days: int) -> str:
    """
    The soonest an archived session becomes deletable, or "" if none are.

    `list_sessions` hands back summary models while `archived_before` hands
    back rows, so this reads either rather than assuming one of them.
    """
    moments = []
    for session in archived:
        archived_at = (
            session.get("archived_at") if isinstance(session, dict)
            else getattr(session, "archived_at", "")
        ) or ""
        moment = due_at(archived_at, retention_days)
        if moment:
            moments.append(moment)
    return min(moments) if moments else ""


_sweeper: RetentionSweeper | None = None
_sweeper_lock = threading.Lock()


def get_retention_sweeper(db_url: str) -> RetentionSweeper:
    """One sweeper per process, started the first time it is asked for."""
    global _sweeper
    with _sweeper_lock:
        if _sweeper is None:
            _sweeper = RetentionSweeper(db_url)
            _sweeper.start()
            atexit.register(_sweeper.shutdown)
        return _sweeper
