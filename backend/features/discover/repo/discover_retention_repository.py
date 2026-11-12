"""
What the retention sweep is configured to do, and what it last did.

Two organisation settings and one row of history. The settings live in
`organisation_setting` with everything else a person can set; the history
lives in its own table because nobody sets it — it is what the sweep wrote
about itself, and putting it in the settings list would offer it for editing.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from shared.db import get_connection, utc_now_iso

#: How long an archived session is kept before it is deleted.
RETENTION_DAYS_KEY = "archived_session_retention_days"
#: The hour of the day, UTC+0, at which the sweep runs.
PURGE_HOUR_KEY = "archived_session_purge_hour_utc"

#: A week is long enough to change your mind and short enough to be a
#: retention policy rather than a filing cabinet.
DEFAULT_RETENTION_DAYS = 7
#: 02:00 UTC — the middle of the night across Europe and the Americas, and
#: mid-morning in Asia-Pacific, which is why the hour is configurable.
DEFAULT_PURGE_HOUR = 2

#: The person is choosing a retention policy, not an archive. One day is the
#: shortest that still gives a working day to change your mind; 31 days is the
#: month the request asked for, and the longest this is meant to hold data.
MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 31

_SWEEP_ID = "archived_sessions"


def clamp_days(value) -> int:
    """A retention outside the permitted range is pulled into it, not refused."""
    try:
        days = int(str(value).strip())
    except (TypeError, ValueError):
        return DEFAULT_RETENTION_DAYS
    return max(MIN_RETENTION_DAYS, min(MAX_RETENTION_DAYS, days))


def clamp_hour(value) -> int:
    """Hours are 0–23 UTC. Anything else means the setting was never valid."""
    try:
        hour = int(str(value).strip())
    except (TypeError, ValueError):
        return DEFAULT_PURGE_HOUR
    return max(0, min(23, hour))


class DiscoverRetentionRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── settings ─────────────────────────────────────────────────────────────

    def get_policy(self) -> dict:
        """The two numbers the sweep runs on, always within their bounds."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT setting_key, setting_value FROM organisation_setting "
                "WHERE setting_key IN (%s, %s)",
                (RETENTION_DAYS_KEY, PURGE_HOUR_KEY),
            ).fetchall()
        stored = {row["setting_key"]: row["setting_value"] for row in rows}
        return {
            "retention_days": clamp_days(stored.get(RETENTION_DAYS_KEY, DEFAULT_RETENTION_DAYS)),
            "purge_hour_utc": clamp_hour(stored.get(PURGE_HOUR_KEY, DEFAULT_PURGE_HOUR)),
        }

    def set_policy(self, retention_days: int | None, purge_hour_utc: int | None) -> dict:
        """Write whichever of the two was given; leave the other alone."""
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            for key, value in (
                (RETENTION_DAYS_KEY, None if retention_days is None else clamp_days(retention_days)),
                (PURGE_HOUR_KEY, None if purge_hour_utc is None else clamp_hour(purge_hour_utc)),
            ):
                if value is None:
                    continue
                conn.execute(
                    "INSERT INTO organisation_setting (setting_key, setting_value, updated_at) "
                    "VALUES (%s, %s, %s) ON CONFLICT (setting_key) DO UPDATE SET "
                    "setting_value = EXCLUDED.setting_value, updated_at = EXCLUDED.updated_at",
                    (key, str(value), now),
                )
        return self.get_policy()

    # ── what the sweep last did ──────────────────────────────────────────────

    def last_run(self) -> dict:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT last_run_at, last_deleted_count, last_outcome FROM retention_sweep_run "
                "WHERE sweep_id = %s",
                (_SWEEP_ID,),
            ).fetchone()
        if row is None:
            return {"last_run_at": "", "last_deleted_count": 0, "last_outcome": ""}
        return {
            "last_run_at": row["last_run_at"],
            "last_deleted_count": int(row["last_deleted_count"]),
            "last_outcome": row["last_outcome"],
        }

    def claim_run(self, not_run_since_iso: str) -> bool:
        """
        Take today's sweep, or find that someone already has.

        The claim is the UPDATE: several workers, or a background thread and a
        request arriving at the same moment, all try it and exactly one row
        comes back. Without this a busy morning would run the sweep once per
        request.
        """
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO retention_sweep_run (sweep_id, last_run_at, last_deleted_count,"
                " last_outcome, updated_at) VALUES (%s, '', 0, '', %s) "
                "ON CONFLICT (sweep_id) DO NOTHING",
                (_SWEEP_ID, now),
            )
            row = conn.execute(
                "UPDATE retention_sweep_run SET last_run_at = %s, last_outcome = 'running', "
                "updated_at = %s WHERE sweep_id = %s AND last_run_at <= %s "
                "RETURNING sweep_id",
                (now, now, _SWEEP_ID, not_run_since_iso),
            ).fetchone()
        return row is not None

    def finish_run(self, deleted: int, outcome: str) -> None:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE retention_sweep_run SET last_deleted_count = %s, last_outcome = %s, "
                "updated_at = %s WHERE sweep_id = %s",
                (deleted, outcome, now, _SWEEP_ID),
            )


# ── the arithmetic, in one place so the screen and the sweep agree ──────────


def cutoff_for(retention_days: int, now: datetime | None = None) -> str:
    """Anything archived at or before this moment is out of time."""
    moment = now or datetime.now(timezone.utc)
    return (moment - timedelta(days=clamp_days(retention_days))).isoformat()


def due_at(archived_at: str, retention_days: int) -> str:
    """When a session archived at `archived_at` becomes due for deletion."""
    if not archived_at:
        return ""
    try:
        archived = datetime.fromisoformat(archived_at)
    except ValueError:
        return ""
    if archived.tzinfo is None:
        archived = archived.replace(tzinfo=timezone.utc)
    return (archived + timedelta(days=clamp_days(retention_days))).isoformat()


def next_run_after(purge_hour_utc: int, now: datetime | None = None) -> str:
    """The next time the sweep is due, so the screen can say it out loud."""
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    hour = clamp_hour(purge_hour_utc)
    candidate = moment.replace(hour=hour, minute=0, second=0, microsecond=0)
    if candidate <= moment:
        candidate = candidate + timedelta(days=1)
    return candidate.isoformat()


def window_opened_at(purge_hour_utc: int, now: datetime | None = None) -> str:
    """
    The most recent moment the sweep was due.

    A run is owed when the last one happened before this. Asking the question
    that way, rather than "is it that hour now", is what lets a sweep missed
    at 02:00 — the process asleep, the container throttled — still happen at
    07:13 when somebody opens the page.
    """
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    hour = clamp_hour(purge_hour_utc)
    candidate = moment.replace(hour=hour, minute=0, second=0, microsecond=0)
    if candidate > moment:
        candidate = candidate - timedelta(days=1)
    return candidate.isoformat()
