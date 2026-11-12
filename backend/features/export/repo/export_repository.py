from pathlib import Path

from shared.db import get_connection, utc_now_iso


class ExportRepository:
    def __init__(self, db_path: Path):
        self._db_path = db_path

    def build_export_pack(self) -> dict:
        with get_connection(self._db_path) as connection:
            results = [dict(row) for row in connection.execute(
                '''
                SELECT result_id, session_id, severity, message, metric_value, created_at
                FROM check_result
                ORDER BY created_at DESC
                '''
            ).fetchall()]
            issues = [dict(row) for row in connection.execute(
                '''
                SELECT c.candidate_id, c.analysis_id, c.priority, c.title, c.detail, c.status, c.created_at,
                       a.owner_name, a.role_code
                FROM improve_candidate c
                LEFT JOIN accountability_assignment a ON a.candidate_id = c.candidate_id
                ORDER BY c.created_at DESC
                '''
            ).fetchall()]
            actions = [dict(row) for row in connection.execute(
                '''
                SELECT t.task_id, t.program_id, t.title, t.detail, t.status, t.assignee_name, t.due_date,
                       p.name AS program_name, p.owner_name AS program_owner
                FROM remediation_task t
                JOIN work_program p ON p.program_id = t.program_id
                ORDER BY t.sort_order ASC
                '''
            ).fetchall()]
            verifications = [dict(row) for row in connection.execute(
                '''
                SELECT ve.verification_id, ve.candidate_id, ve.task_id, ve.result_id, ve.outcome,
                       ve.evidence_note, ve.follow_up_required, ve.verified_at,
                       ap.display_name AS verified_by_name,
                       ic.title AS candidate_title,
                       rt.title AS task_title
                FROM verification_evidence ve
                LEFT JOIN accountability_party ap ON ap.party_id = ve.verified_by_party_id
                LEFT JOIN improve_candidate ic ON ic.candidate_id = ve.candidate_id
                LEFT JOIN remediation_task rt ON rt.task_id = ve.task_id
                ORDER BY ve.verified_at DESC
                '''
            ).fetchall()]
            evaluation = {
                'events': connection.execute('SELECT COUNT(*) AS count FROM trial_event').fetchone()['count'],
                'feedback_items': connection.execute('SELECT COUNT(*) AS count FROM trial_feedback').fetchone()['count'],
                'follow_up_requests': connection.execute(
                    "SELECT COUNT(*) AS count FROM trial_feedback WHERE next_step IN ('request_workshop','request_pilot','follow_up_with_sample_data')"
                ).fetchone()['count'],
                'verification_items': len(verifications),
                'verification_passed': sum(1 for item in verifications if item['outcome'] == 'passed' and not item['follow_up_required']),
                'verification_failed': sum(1 for item in verifications if item['outcome'] == 'failed'),
            }
        return {
            'generated_at': utc_now_iso(),
            'results': results,
            'issues': issues,
            'actions': actions,
            'verifications': verifications,
            'evaluation_summary': evaluation,
        }
