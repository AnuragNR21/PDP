"""
DiscoverAuditRepository — authoritative writes for discover_audit_event.

Implements AC-DWS-AUDIT-IMPORT-001.
Every session/import/validation/column persistence action or rejection
must produce an audit event via this repository.
"""
import json
from uuid import uuid4

from shared.contracts.canonical_types import DiscoverAuditEventSummary, DiscoverAuditOutcome
from shared.db import get_connection, utc_now_iso


class DiscoverAuditRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    def record(
        self,
        actor: str,
        action: str,
        outcome: DiscoverAuditOutcome,
        session_id: str | None = None,
        source_file_id: str | None = None,
        correlation_id: str | None = None,
        detail: dict | None = None,
    ) -> DiscoverAuditEventSummary:
        """
        Persist a single audit event.  Fields (AC-DWS-AUDIT-IMPORT-001):
          actor          — display name / email of the acting user
          action         — semantic action label (e.g. 'session.create')
          outcome        — 'success' | 'failure' | 'rejected'
          session_id     — owning discovery session (nullable)
          source_file_id — referenced source file (nullable, stored in detail_json)
          correlation_id — optional cross-service trace ID
          detail         — arbitrary JSON payload for extra context
        """
        audit_event_id = f"ae_{uuid4().hex[:12]}"
        now = utc_now_iso()
        detail_json = json.dumps(detail or {})
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO discover_audit_event "
                "(audit_event_id, session_id, source_file_id, actor, action, "
                "outcome, correlation_id, detail_json, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    audit_event_id,
                    session_id,
                    source_file_id,
                    actor,
                    action,
                    outcome,
                    correlation_id,
                    detail_json,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT audit_event_id, session_id, source_file_id, actor, action, "
                "outcome, correlation_id, detail_json, created_at "
                "FROM discover_audit_event WHERE audit_event_id = %s",
                (audit_event_id,),
            ).fetchone()
        raw = dict(row)
        raw["detail_json"] = json.loads(raw["detail_json"])
        return DiscoverAuditEventSummary(**raw)

    def list_events(
        self, session_id: str, limit: int = 50
    ) -> list[DiscoverAuditEventSummary]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT audit_event_id, session_id, source_file_id, actor, action, "
                "outcome, correlation_id, detail_json, created_at "
                "FROM discover_audit_event WHERE session_id = %s "
                "ORDER BY created_at DESC LIMIT %s",
                (session_id, limit),
            ).fetchall()
        result = []
        for r in rows:
            raw = dict(r)
            raw["detail_json"] = json.loads(raw["detail_json"])
            result.append(DiscoverAuditEventSummary(**raw))
        return result
