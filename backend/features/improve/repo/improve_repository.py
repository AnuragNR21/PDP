
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from shared.contracts.canonical_types import (
    DashboardMetricSummary,
    DashboardSummary,
    DashboardTrendPoint,
    ImproveAttentionSignalSummary,
    ImproveCandidateSummary,
    RemediationTaskSummary,
    VerificationEvidenceSummary,
    VerificationFollowUpSummary,
    WorkProgramSummary,
)
from shared.db import get_connection, utc_now_iso


class ImproveRepository:
    def __init__(self, db_path: Path):
        self._db_path = db_path

    def list_candidates(self) -> list[ImproveCandidateSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                """
                SELECT ic.candidate_id, ic.analysis_id, ic.finding_id, ic.target_node_id,
                       n.name AS target_name, ic.priority, ic.title, ic.detail, ic.status, ic.created_at
                FROM improve_candidate ic
                LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = ic.target_node_id
                ORDER BY ic.created_at DESC, ic.candidate_id DESC
                """
            ).fetchall()
        return [ImproveCandidateSummary.model_validate(dict(row)) for row in rows]

    def update_candidate_status(self, candidate_id: str, status: str) -> ImproveCandidateSummary:
        with get_connection(self._db_path) as connection:
            row = connection.execute(
                """
                UPDATE improve_candidate
                SET status = ?
                WHERE candidate_id = ?
                RETURNING candidate_id, analysis_id, finding_id, target_node_id,
                          priority, title, detail, status, created_at
                """,
                (status, candidate_id),
            ).fetchone()
            if row is None:
                raise ValueError(f"Improve candidate not found: {candidate_id}")
            row_dict = dict(row)
            target_name = connection.execute(
                "SELECT name FROM hierarchy_model_node_instance WHERE node_instance_id = ?",
                (row_dict["target_node_id"],),
            ).fetchone()
            row_dict["target_name"] = None if target_name is None else target_name["name"]
        return ImproveCandidateSummary.model_validate(row_dict)

    def list_attention_signals(self) -> list[ImproveAttentionSignalSummary]:
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            overdue_tasks = int(
                connection.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM remediation_task
                    WHERE due_date IS NOT NULL
                      AND status NOT IN ('done', 'verified')
                      AND date(due_date) < date('now')
                    """
                ).fetchone()["count"]
            )
            blocked_tasks = int(
                connection.execute(
                    "SELECT COUNT(*) AS count FROM remediation_task WHERE status = 'blocked'"
                ).fetchone()["count"]
            )
            failed_verifications = int(
                connection.execute(
                    "SELECT COUNT(*) AS count FROM verification_evidence WHERE outcome = 'failed'"
                ).fetchone()["count"]
            )
            open_follow_ups = int(
                connection.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM verification_follow_up_state
                    WHERE queue_status IN ('open', 'in_progress')
                    """
                ).fetchone()["count"]
            )

        items: list[ImproveAttentionSignalSummary] = []
        if overdue_tasks:
            items.append(
                ImproveAttentionSignalSummary(
                    signal_id="signal_overdue_tasks",
                    signal_type="task.overdue",
                    severity="high",
                    title="Overdue remediation tasks require attention",
                    detail="At least one remediation task is past its due date and not yet completed.",
                    related_route="/improve/progress-tracking",
                    related_count=overdue_tasks,
                    detected_at=now,
                )
            )
        if blocked_tasks:
            items.append(
                ImproveAttentionSignalSummary(
                    signal_id="signal_blocked_tasks",
                    signal_type="task.blocked",
                    severity="high",
                    title="Blocked tasks are slowing remediation flow",
                    detail="Blocked remediation tasks are preventing progress against active candidates.",
                    related_route="/improve/progress-tracking",
                    related_count=blocked_tasks,
                    detected_at=now,
                )
            )
        if failed_verifications:
            items.append(
                ImproveAttentionSignalSummary(
                    signal_id="signal_failed_verifications",
                    signal_type="verification.failed",
                    severity="high",
                    title="Failed verifications need follow-up",
                    detail="Verification evidence includes failed outcomes that need operational response.",
                    related_route="/improve/attention",
                    related_count=failed_verifications,
                    detected_at=now,
                )
            )
        if open_follow_ups:
            items.append(
                ImproveAttentionSignalSummary(
                    signal_id="signal_follow_up_queue",
                    signal_type="verification.follow_up",
                    severity="medium",
                    title="Open follow-up queue needs triage",
                    detail="Verification follow-up items are open or in progress and require review or completion.",
                    related_route="/improve/attention",
                    related_count=open_follow_ups,
                    detected_at=now,
                )
            )
        return items

    def list_follow_up_queue(self, queue_status: str | None = None) -> list[VerificationFollowUpSummary]:
        where = ""
        params: list[str] = []
        if queue_status:
            where = "WHERE vfs.queue_status = ?"
            params.append(queue_status)
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                f"""
                SELECT ve.verification_id,
                       ve.candidate_id,
                       ic.title AS candidate_title,
                       ve.task_id,
                       rt.title AS task_title,
                       ve.outcome,
                       vfs.queue_status,
                       vfs.due_date,
                       vfs.owner_party_id,
                       ap.display_name AS owner_party_name,
                       ve.evidence_note,
                       vfs.follow_up_note,
                       ve.verified_at,
                       vfs.updated_at
                FROM verification_evidence ve
                JOIN verification_follow_up_state vfs ON vfs.verification_id = ve.verification_id
                LEFT JOIN improve_candidate ic ON ic.candidate_id = ve.candidate_id
                LEFT JOIN remediation_task rt ON rt.task_id = ve.task_id
                LEFT JOIN accountability_party ap ON ap.party_id = vfs.owner_party_id
                {where}
                ORDER BY
                    CASE vfs.queue_status
                        WHEN 'open' THEN 1
                        WHEN 'in_progress' THEN 2
                        ELSE 3
                    END,
                    COALESCE(vfs.due_date, '9999-12-31'),
                    ve.verified_at DESC
                """,
                tuple(params),
            ).fetchall()
        return [VerificationFollowUpSummary.model_validate(dict(row)) for row in rows]

    def update_follow_up_queue(
        self,
        verification_id: str,
        queue_status: str,
        due_date: str | None,
        owner_party_id: str | None,
        follow_up_note: str | None,
    ) -> VerificationFollowUpSummary:
        with get_connection(self._db_path) as connection:
            verification = connection.execute(
                "SELECT verification_id FROM verification_evidence WHERE verification_id = ?",
                (verification_id,),
            ).fetchone()
            if verification is None:
                raise ValueError(f"Verification not found for follow-up update: {verification_id}")
            if owner_party_id is not None:
                owner = connection.execute(
                    "SELECT party_id FROM accountability_party WHERE party_id = ?",
                    (owner_party_id,),
                ).fetchone()
                if owner is None:
                    raise ValueError(f"Accountability party not found for follow-up owner: {owner_party_id}")

            updated_at = utc_now_iso()
            connection.execute(
                """
                UPDATE verification_follow_up_state
                SET queue_status = ?,
                    due_date = ?,
                    owner_party_id = ?,
                    follow_up_note = ?,
                    updated_at = ?
                WHERE verification_id = ?
                """,
                (queue_status, due_date, owner_party_id, follow_up_note, updated_at, verification_id),
            )

            if queue_status == "resolved":
                candidate_ref = connection.execute(
                    "SELECT candidate_id, task_id FROM verification_evidence WHERE verification_id = ?",
                    (verification_id,),
                ).fetchone()
                if candidate_ref is not None:
                    connection.execute(
                        "UPDATE improve_candidate SET status = 'closed' WHERE candidate_id = ?",
                        (candidate_ref["candidate_id"],),
                    )
                    if candidate_ref["task_id"] is not None:
                        connection.execute(
                            "UPDATE remediation_task SET status = 'verified' WHERE task_id = ?",
                            (candidate_ref["task_id"],),
                        )

        items = self.list_follow_up_queue()
        try:
            return next(item for item in items if item.verification_id == verification_id)
        except StopIteration as exc:
            raise ValueError(f"Verification follow-up state not found after update: {verification_id}") from exc

    def create_work_program(self, name: str, priority: str, owner_name: str, candidate_ids: list[str], owner_party_id: str | None = None) -> WorkProgramSummary:
        program_id = f"program_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            connection.execute(
                """
                INSERT INTO work_program (
                    program_id, name, status, priority, owner_name, created_at
                ) VALUES (?, ?, 'planned', ?, ?, ?)
                """,
                (program_id, name, priority, owner_name, now),
            )

            sort_order = 1
            for candidate_id in candidate_ids:
                candidate = connection.execute(
                    """
                    SELECT candidate_id, title, detail, priority
                    FROM improve_candidate
                    WHERE candidate_id = ?
                    """,
                    (candidate_id,),
                ).fetchone()
                if candidate is None:
                    raise ValueError(f"Improve candidate not found for work program: {candidate_id}")

                task_id = f"task_{uuid4().hex[:12]}"
                connection.execute(
                    """
                    INSERT INTO remediation_task (
                        task_id, program_id, candidate_id, title, detail, status,
                        assignee_name, due_date, created_at, sort_order
                    ) VALUES (?, ?, ?, ?, ?, 'open', ?, date('now', '+14 day'), ?, ?)
                    """,
                    (task_id, program_id, candidate_id, candidate["title"], candidate["detail"], owner_name, now, sort_order),
                )
                if owner_party_id is not None:
                    connection.execute(
                        """
                        INSERT OR IGNORE INTO accountability_scope_assignment (
                            assignment_id, scope_type, scope_id, role_code, party_id, assignment_status, assigned_at
                        ) VALUES (?, 'task', ?, 'assignee', ?, 'active', ?)
                        """,
                        (f"assign_{task_id}", task_id, owner_party_id, now),
                    )
                connection.execute("UPDATE improve_candidate SET status = 'in_progress' WHERE candidate_id = ?", (candidate_id,))
                sort_order += 1

        programs = self.list_work_programs()
        return next(program for program in programs if program.program_id == program_id)

    def list_work_programs(self) -> list[WorkProgramSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                """
                SELECT wp.program_id, wp.name, wp.status, wp.priority, wp.owner_name,
                       asa.party_id AS owner_party_id,
                       COUNT(DISTINCT rt.task_id) AS target_count,
                       SUM(CASE WHEN rt.status NOT IN ('done', 'verified') THEN 1 ELSE 0 END) AS open_task_count,
                       wp.created_at
                FROM work_program wp
                LEFT JOIN remediation_task rt ON rt.program_id = wp.program_id
                LEFT JOIN accountability_scope_assignment asa
                  ON asa.scope_type = 'candidate' AND asa.scope_id = rt.candidate_id AND asa.role_code = 'owner'
                GROUP BY wp.program_id, wp.name, wp.status, wp.priority, wp.owner_name, asa.party_id, wp.created_at
                ORDER BY wp.created_at DESC, wp.program_id DESC
                """
            ).fetchall()
        return [
            WorkProgramSummary.model_validate({**dict(row), 'open_task_count': int(row['open_task_count'] or 0)})
            for row in rows
        ]

    def list_tasks(self, program_id: str | None = None) -> list[RemediationTaskSummary]:
        where = ''
        params: tuple[str, ...] = ()
        if program_id:
            where = 'WHERE rt.program_id = ?'
            params = (program_id,)
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                f"""
                SELECT rt.task_id, rt.program_id, rt.candidate_id, rt.title, rt.detail,
                       rt.status, rt.assignee_name, asa.party_id AS assignee_party_id, rt.due_date,
                       ic.title AS source_title, COALESCE(ic.priority, 'medium') AS priority
                FROM remediation_task rt
                LEFT JOIN improve_candidate ic ON ic.candidate_id = rt.candidate_id
                LEFT JOIN accountability_scope_assignment asa
                  ON asa.scope_type = 'task' AND asa.scope_id = rt.task_id AND asa.role_code = 'assignee' AND asa.assignment_status = 'active'
                {where}
                ORDER BY rt.program_id, rt.sort_order, rt.created_at
                """,
                params,
            ).fetchall()
        return [RemediationTaskSummary.model_validate(dict(row)) for row in rows]

    def update_task_status(self, task_id: str, status: str) -> RemediationTaskSummary:
        with get_connection(self._db_path) as connection:
            row = connection.execute(
                """
                UPDATE remediation_task
                SET status = ?
                WHERE task_id = ?
                RETURNING task_id, program_id, candidate_id, title, detail,
                          status, assignee_name, due_date
                """,
                (status, task_id),
            ).fetchone()
            if row is None:
                raise ValueError(f"Remediation task not found: {task_id}")
            row_dict = dict(row)
            source = None
            if row_dict['candidate_id']:
                source = connection.execute(
                    'SELECT title, priority FROM improve_candidate WHERE candidate_id = ?',
                    (row_dict['candidate_id'],),
                ).fetchone()
            row_dict['source_title'] = None if source is None else source['title']
            assignee = connection.execute(
                "SELECT party_id FROM accountability_scope_assignment WHERE scope_type = 'task' AND scope_id = ? AND role_code = 'assignee' AND assignment_status = 'active' ORDER BY assigned_at DESC LIMIT 1",
                (task_id,),
            ).fetchone()
            row_dict['assignee_party_id'] = None if assignee is None else assignee['party_id']
            row_dict['priority'] = 'medium' if source is None else source['priority']

            candidate_id = row_dict['candidate_id']
            if candidate_id:
                if status == 'verified':
                    connection.execute("UPDATE improve_candidate SET status = 'closed' WHERE candidate_id = ?", (candidate_id,))
                elif status in {'done', 'open', 'in_progress', 'blocked'}:
                    connection.execute("UPDATE improve_candidate SET status = 'in_progress' WHERE candidate_id = ?", (candidate_id,))
        return RemediationTaskSummary.model_validate(row_dict)

    def list_verifications(self, candidate_id: str | None = None) -> list[VerificationEvidenceSummary]:
        where = ''
        params: tuple[str, ...] = ()
        if candidate_id:
            where = 'WHERE ve.candidate_id = ?'
            params = (candidate_id,)
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                f"""
                SELECT ve.verification_id, ve.candidate_id, ve.task_id, ve.result_id, ve.outcome,
                       ve.evidence_note, ve.follow_up_required, ve.verified_at, ve.verified_by_party_id,
                       ap.display_name AS verified_by_name,
                       ic.title AS candidate_title,
                       rt.title AS task_title
                FROM verification_evidence ve
                LEFT JOIN accountability_party ap ON ap.party_id = ve.verified_by_party_id
                LEFT JOIN improve_candidate ic ON ic.candidate_id = ve.candidate_id
                LEFT JOIN remediation_task rt ON rt.task_id = ve.task_id
                {where}
                ORDER BY ve.verified_at DESC, ve.verification_id DESC
                """,
                params,
            ).fetchall()
        items = []
        for row in rows:
            row_dict = dict(row)
            row_dict['follow_up_required'] = bool(row_dict['follow_up_required'])
            items.append(VerificationEvidenceSummary.model_validate(row_dict))
        return items

    def create_verification_evidence(
        self,
        candidate_id: str,
        outcome: str,
        evidence_note: str,
        follow_up_required: bool,
        task_id: str | None,
        result_id: str | None,
        verified_by_party_id: str | None,
    ) -> VerificationEvidenceSummary:
        verification_id = f"verify_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            candidate = connection.execute(
                'SELECT candidate_id, title FROM improve_candidate WHERE candidate_id = ?',
                (candidate_id,),
            ).fetchone()
            if candidate is None:
                raise ValueError(f"Improve candidate not found for verification: {candidate_id}")
            task_title = None
            if task_id is not None:
                task = connection.execute(
                    'SELECT task_id, title FROM remediation_task WHERE task_id = ?',
                    (task_id,),
                ).fetchone()
                if task is None:
                    raise ValueError(f"Remediation task not found for verification: {task_id}")
                task_title = task['title']
            verified_by_name = None
            if verified_by_party_id is not None:
                party = connection.execute(
                    'SELECT display_name FROM accountability_party WHERE party_id = ?',
                    (verified_by_party_id,),
                ).fetchone()
                if party is None:
                    raise ValueError(f"Accountability party not found for verification: {verified_by_party_id}")
                verified_by_name = party['display_name']

            connection.execute(
                """
                INSERT INTO verification_evidence (
                    verification_id, candidate_id, task_id, result_id, outcome, evidence_note,
                    follow_up_required, verified_by_party_id, verified_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    verification_id,
                    candidate_id,
                    task_id,
                    result_id,
                    outcome,
                    evidence_note,
                    int(follow_up_required),
                    verified_by_party_id,
                    now,
                    now,
                ),
            )
            initial_queue_status = 'resolved'
            if outcome == 'passed' and not follow_up_required:
                connection.execute("UPDATE improve_candidate SET status = 'closed' WHERE candidate_id = ?", (candidate_id,))
                if task_id is not None:
                    connection.execute("UPDATE remediation_task SET status = 'verified' WHERE task_id = ?", (task_id,))
            else:
                initial_queue_status = 'open'
                connection.execute("UPDATE improve_candidate SET status = 'in_progress' WHERE candidate_id = ?", (candidate_id,))
                if task_id is not None and outcome == 'failed':
                    connection.execute("UPDATE remediation_task SET status = 'blocked' WHERE task_id = ?", (task_id,))
            connection.execute(
                """
                INSERT INTO verification_follow_up_state (
                    verification_id, queue_status, due_date, owner_party_id, follow_up_note, updated_at
                ) VALUES (?, ?, date('now', '+7 day'), ?, ?, ?)
                """,
                (
                    verification_id,
                    initial_queue_status,
                    verified_by_party_id if initial_queue_status != 'resolved' else None,
                    'Auto-created from verification evidence.' if initial_queue_status != 'resolved' else 'Closed on creation.',
                    now,
                ),
            )

        return VerificationEvidenceSummary.model_validate({
            'verification_id': verification_id,
            'candidate_id': candidate_id,
            'task_id': task_id,
            'result_id': result_id,
            'outcome': outcome,
            'evidence_note': evidence_note,
            'follow_up_required': follow_up_required,
            'verified_at': now,
            'verified_by_party_id': verified_by_party_id,
            'verified_by_name': verified_by_name,
            'candidate_title': candidate['title'],
            'task_title': task_title,
        })

    def get_dashboard(self) -> DashboardSummary:
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            candidate_total = int(connection.execute('SELECT COUNT(*) AS count FROM improve_candidate').fetchone()['count'])
            open_candidates = int(connection.execute("SELECT COUNT(*) AS count FROM improve_candidate WHERE status = 'open'").fetchone()['count'])
            active_programs = int(connection.execute("SELECT COUNT(*) AS count FROM work_program WHERE status IN ('planned', 'active', 'in_progress', 'blocked')").fetchone()['count'])
            overdue_tasks = int(
                connection.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM remediation_task
                    WHERE due_date IS NOT NULL
                      AND status NOT IN ('done', 'verified')
                      AND date(due_date) < date('now')
                    """
                ).fetchone()['count']
            )
            verification_pending = int(
                connection.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM improve_candidate ic
                    WHERE NOT EXISTS (
                        SELECT 1 FROM verification_evidence ve WHERE ve.candidate_id = ic.candidate_id AND ve.outcome = 'passed' AND ve.follow_up_required = 0
                    )
                    """
                ).fetchone()['count']
            )
            failed_verifications = int(connection.execute("SELECT COUNT(*) AS count FROM verification_evidence WHERE outcome = 'failed'").fetchone()['count'])
            open_follow_ups = int(connection.execute("SELECT COUNT(*) AS count FROM verification_follow_up_state WHERE queue_status IN ('open', 'in_progress')").fetchone()['count'])
            metrics = [
                DashboardMetricSummary(metric_key='improve.open_candidates', metric_label='Open candidates', metric_value=float(open_candidates), unit='count', as_of=now, drill_target='/improve/work-program'),
                DashboardMetricSummary(metric_key='improve.total_candidates', metric_label='Total candidates', metric_value=float(candidate_total), unit='count', as_of=now, drill_target='/improve/dashboard'),
                DashboardMetricSummary(metric_key='improve.active_programs', metric_label='Active programs', metric_value=float(active_programs), unit='count', as_of=now, drill_target='/improve/work-program'),
                DashboardMetricSummary(metric_key='improve.overdue_tasks', metric_label='Overdue tasks', metric_value=float(overdue_tasks), unit='count', as_of=now, drill_target='/improve/progress-tracking'),
                DashboardMetricSummary(metric_key='improve.verification_pending', metric_label='Verification pending', metric_value=float(verification_pending), unit='count', as_of=now, drill_target='/improve/verification'),
                DashboardMetricSummary(metric_key='improve.failed_verifications', metric_label='Failed verifications', metric_value=float(failed_verifications), unit='count', as_of=now, drill_target='/improve/verification'),
                DashboardMetricSummary(metric_key='improve.follow_up_queue', metric_label='Open follow-up queue', metric_value=float(open_follow_ups), unit='count', as_of=now, drill_target='/improve/attention'),
            ]
            trend_rows = connection.execute(
                """
                SELECT substr(verified_at, 1, 10) AS point_label,
                       SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END) AS open_count,
                       SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS in_progress_count,
                       SUM(CASE WHEN outcome = 'passed' THEN 1 ELSE 0 END) AS closed_count
                FROM verification_evidence
                GROUP BY substr(verified_at, 1, 10)
                ORDER BY point_label
                LIMIT 8
                """
            ).fetchall()
            if not trend_rows:
                trend_rows = connection.execute(
                    """
                    SELECT COALESCE(due_date, substr(created_at, 1, 10)) AS point_label,
                           SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
                           SUM(CASE WHEN status IN ('in_progress', 'blocked') THEN 1 ELSE 0 END) AS in_progress_count,
                           SUM(CASE WHEN status IN ('done', 'verified') THEN 1 ELSE 0 END) AS closed_count
                    FROM remediation_task
                    GROUP BY COALESCE(due_date, substr(created_at, 1, 10))
                    ORDER BY point_label
                    LIMIT 8
                    """
                ).fetchall()
        trend = [
            DashboardTrendPoint(
                point_key=f"trend_{row['point_label']}",
                point_label=row['point_label'],
                open_count=int(row['open_count'] or 0),
                in_progress_count=int(row['in_progress_count'] or 0),
                closed_count=int(row['closed_count'] or 0),
            )
            for row in trend_rows
        ]
        return DashboardSummary(metrics=metrics, trend=trend)
