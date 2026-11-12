"""
DiscoverSessionService — authoritative write service for discovery_session.
DiscoverSessionReadService — read-only projection service.
DiscoverOverviewReadService — aggregated overview panel read model.

All session creation and status mutation must go through DiscoverSessionService.
The UI must never treat local state as persisted session truth.
(AC-DWS-SHELL-001, AC-DWS-SHELL-002, AC-DWS-SHELL-003, AC-DWS-SHELL-004)
"""
from features.discover.domain.models import (
    CreateDiscoverySessionCommand,
    DiscoverySessionsResponse,
    OverviewResponse,
)
from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_retention_repository import (
    DiscoverRetentionRepository,
    due_at,
)
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from shared.contracts.canonical_types import DiscoverySessionSummary
from shared.contracts.refresh import RefreshRequest


class DiscoverSessionService:
    """Authoritative writes to discovery_session."""

    def __init__(self, db_url: str) -> None:
        self._sessions = DiscoverSessionRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)
        self._retention = DiscoverRetentionRepository(db_url)

    def create_session(
        self, command: CreateDiscoverySessionCommand, actor: str = "system"
    ) -> dict:
        try:
            session = self._sessions.create_session(
                name=command.name,
                source_name=command.source_name,
            )
            self._audit.record(
                actor=actor,
                action="session.create",
                outcome="success",
                session_id=session.session_id,
                detail={"name": session.name},
            )
            return {
                "session": session,
                "refresh": RefreshRequest(
                    scope="session",
                    reason="Discovery session created.",
                    targets=[session.session_id],
                ),
            }
        except Exception as exc:
            self._audit.record(
                actor=actor,
                action="session.create",
                outcome="failure",
                detail={"error": str(exc)},
            )
            raise


    def archive_session(self, session_id: str, actor: str = "user") -> dict:
        """
        Retire a finished session. Nothing is deleted here.

        Archiving is only offered once the checks have run, so the two refusals
        below are the same rule stated twice — a session nobody has checked is
        not finished, and one already archived has nothing to archive.
        """
        if not self._sessions.session_exists(session_id):
            raise LookupError("Discovery session not found.")
        current = self._sessions.get_session(session_id)
        if current is not None and current.archived_at:
            raise ValueError("This session is already archived.")
        if not self._sessions.has_quality_run(session_id):
            raise ValueError(
                "Run the quality checks before archiving — archiving puts away "
                "finished work, and this session has not been checked yet."
            )

        session = self._sessions.archive_session(session_id)
        if session is None:
            raise LookupError("Discovery session not found.")
        policy = self._retention.get_policy()
        session.purge_due_at = due_at(session.archived_at, policy["retention_days"])
        self._audit.record(
            actor=actor,
            action="session.archive",
            outcome="success",
            session_id=session_id,
            detail={
                "name": session.name,
                "retention_days": policy["retention_days"],
                "purge_due_at": session.purge_due_at,
            },
        )
        return {
            "session": session,
            "retention_days": policy["retention_days"],
            "refresh": RefreshRequest(
                scope="session",
                reason="Discovery session archived.",
                targets=[session_id],
            ),
        }

    def restore_session(self, session_id: str, actor: str = "user") -> dict:
        """Take it back out of the archive and stop the countdown."""
        if not self._sessions.session_exists(session_id):
            raise LookupError("Discovery session not found.")
        current = self._sessions.get_session(session_id)
        if current is not None and not current.archived_at:
            raise ValueError("This session is not archived.")

        # Back to `completed`: archiving is only offered after a run, so a
        # restored session has findings and `completed` is what it was.
        session = self._sessions.restore_session(session_id, status="completed")
        if session is None:
            raise LookupError("Discovery session not found.")
        self._audit.record(
            actor=actor,
            action="session.restore",
            outcome="success",
            session_id=session_id,
            detail={"name": session.name},
        )
        return {
            "session": session,
            "refresh": RefreshRequest(
                scope="session",
                reason="Discovery session restored.",
                targets=[session_id],
            ),
        }

    def delete_session(self, session_id: str, actor: str = "user") -> dict:
        """
        Delete a session and everything it holds.

        Recorded in the audit trail before the row goes, because afterwards
        there is nothing left to hang the record on — and "who removed that
        session" is exactly the question someone asks later.
        """
        if not self._sessions.session_exists(session_id):
            raise LookupError("Discovery session not found.")
        self._audit.record(
            actor=actor,
            action="session.delete",
            outcome="success",
            session_id=session_id,
            detail={},
        )
        self._sessions.delete_session(session_id)
        return {
            "session_id": session_id,
            "refresh": RefreshRequest(
                scope="session",
                reason="Discovery session deleted.",
                targets=[session_id],
            ),
        }


class DiscoverSessionReadService:
    """Read-only projections for discovery_session."""

    def __init__(self, db_url: str) -> None:
        self._sessions = DiscoverSessionRepository(db_url)
        self._retention = DiscoverRetentionRepository(db_url)

    def _with_due_date(self, sessions: list) -> list:
        """
        Stamp each archived session with when it will be deleted.

        Computed on read rather than stored: shortening the retention has to
        move every countdown already running, not only the ones started after
        the change.
        """
        retention = self._retention.get_policy()["retention_days"]
        for session in sessions:
            session.purge_due_at = due_at(session.archived_at, retention)
        return sessions

    def list_sessions(self, archived: bool | None = None) -> DiscoverySessionsResponse:
        return DiscoverySessionsResponse(
            items=self._with_due_date(self._sessions.list_sessions(archived=archived))
        )

    def get_session(self, session_id: str) -> DiscoverySessionSummary | None:
        session = self._sessions.get_session(session_id)
        return None if session is None else self._with_due_date([session])[0]

    def can_archive(self, session_id: str) -> dict:
        """
        Whether the Archive button should be offered, and why not if it should not.

        The screen asks rather than working it out itself: "has the quality
        check run" is a question about stored findings, and a rule the button
        and the endpoint have to agree on belongs on one side of the wire.
        """
        session = self._sessions.get_session(session_id)
        if session is None:
            return {"can_archive": False, "reason": "Discovery session not found."}
        if session.archived_at:
            return {
                "can_archive": False,
                "is_archived": True,
                "reason": "This session is already archived.",
                "purge_due_at": due_at(
                    session.archived_at, self._retention.get_policy()["retention_days"]
                ),
            }
        if not self._sessions.has_quality_run(session_id):
            return {
                "can_archive": False,
                "is_archived": False,
                "reason": "Run the quality checks at least once before archiving.",
            }
        return {
            "can_archive": True,
            "is_archived": False,
            "reason": "",
            "retention_days": self._retention.get_policy()["retention_days"],
        }

    def session_exists(self, session_id: str) -> bool:
        return self._sessions.session_exists(session_id)


class DiscoverOverviewReadService:
    """Aggregated Overview panel read model — session-scoped, backend-only."""

    def __init__(self, db_url: str) -> None:
        self._sessions = DiscoverSessionRepository(db_url)

    def get_overview(self, session_id: str) -> OverviewResponse:
        """
        Build the Overview read model from persisted backend data only.
        Returns zero-value panels when no data exists — never local placeholders.
        (AC-DWS-SHELL-003, AC-DWS-SHELL-004)
        """
        overview = self._sessions.get_overview(session_id)
        return OverviewResponse(overview=overview)
