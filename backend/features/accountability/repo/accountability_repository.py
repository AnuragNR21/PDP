from __future__ import annotations

from uuid import uuid4

from shared.contracts.canonical_types import AccountabilityAssignmentSummary, AccountabilityPartySummary
from shared.db import get_connection, utc_now_iso


class AccountabilityRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def list_parties(self) -> list[AccountabilityPartySummary]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                """
                SELECT party_id, display_name, email, party_type, party_status
                FROM accountability_party
                ORDER BY display_name
                """
            ).fetchall()
        return [AccountabilityPartySummary.model_validate(dict(row)) for row in rows]

    def list_assignments(self, scope_type: str | None = None, scope_id: str | None = None) -> list[AccountabilityAssignmentSummary]:
        clauses: list[str] = []
        params: list[str] = []
        if scope_type:
            clauses.append('asa.scope_type = %s')
            params.append(scope_type)
        if scope_id:
            clauses.append('asa.scope_id = %s')
            params.append(scope_id)
        where = '' if not clauses else 'WHERE ' + ' AND '.join(clauses)
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                f"""
                SELECT asa.assignment_id, asa.scope_type, asa.scope_id, asa.role_code, asa.party_id,
                       ap.display_name AS party_name, ap.email AS party_email, asa.assignment_status, asa.assigned_at
                FROM accountability_scope_assignment asa
                JOIN accountability_party ap ON ap.party_id = asa.party_id
                {where}
                ORDER BY asa.assigned_at DESC, asa.assignment_id DESC
                """,
                tuple(params),
            ).fetchall()
        return [AccountabilityAssignmentSummary.model_validate(dict(row)) for row in rows]

    def create_assignment(self, scope_type: str, scope_id: str, role_code: str, party_id: str) -> AccountabilityAssignmentSummary:
        assignment_id = f"assign_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as connection:
            exists = connection.execute(
                """
                SELECT assignment_id FROM accountability_scope_assignment
                WHERE scope_type = %s AND scope_id = %s AND role_code = %s AND party_id = %s
                """,
                (scope_type, scope_id, role_code, party_id),
            ).fetchone()
            if exists is not None:
                return self.get_assignment(exists['assignment_id'])
            connection.execute(
                """
                INSERT INTO accountability_scope_assignment (
                    assignment_id, scope_type, scope_id, role_code, party_id, assignment_status, assigned_at
                ) VALUES (%s, %s, %s, %s, %s, 'active', %s)
                """,
                (assignment_id, scope_type, scope_id, role_code, party_id, now),
            )
        return self.get_assignment(assignment_id)

    def get_assignment(self, assignment_id: str) -> AccountabilityAssignmentSummary:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                SELECT asa.assignment_id, asa.scope_type, asa.scope_id, asa.role_code, asa.party_id,
                       ap.display_name AS party_name, ap.email AS party_email, asa.assignment_status, asa.assigned_at
                FROM accountability_scope_assignment asa
                JOIN accountability_party ap ON ap.party_id = asa.party_id
                WHERE asa.assignment_id = %s
                """,
                (assignment_id,),
            ).fetchone()
        if row is None:
            raise ValueError(f"Accountability assignment not found: {assignment_id}")
        return AccountabilityAssignmentSummary.model_validate(dict(row))

    def update_assignment(self, assignment_id: str, role_code: str | None, party_id: str | None, assignment_status: str | None) -> AccountabilityAssignmentSummary:
        updates: list[str] = []
        params: list[str] = []
        if role_code is not None:
            updates.append('role_code = %s')
            params.append(role_code)
        if party_id is not None:
            updates.append('party_id = %s')
            params.append(party_id)
        if assignment_status is not None:
            updates.append('assignment_status = %s')
            params.append(assignment_status)
        if not updates:
            return self.get_assignment(assignment_id)
        params.append(assignment_id)
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                f"UPDATE accountability_scope_assignment SET {', '.join(updates)} WHERE assignment_id = %s RETURNING assignment_id",
                tuple(params),
            ).fetchone()
        if row is None:
            raise ValueError(f"Accountability assignment not found: {assignment_id}")
        return self.get_assignment(assignment_id)
