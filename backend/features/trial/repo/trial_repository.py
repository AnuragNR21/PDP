import json
import uuid

from features.trial.domain.models import TrialEventRecord, TrialFeedbackRecord, TrialOpsSummary
from shared.db import get_connection, reset_database, utc_now_iso


class TrialRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def create_event(self, event_type: str, scenario_code: str, user_label: str, object_ref: str | None, metadata: dict):
        event = TrialEventRecord(
            event_id=f'evt_{uuid.uuid4().hex[:10]}',
            event_type=event_type,
            scenario_code=scenario_code,
            user_label=user_label,
            object_ref=object_ref,
            metadata=metadata,
            created_at=utc_now_iso(),
        )
        with get_connection(self._db_url) as connection:
            connection.execute(
                '''
                INSERT INTO trial_event (event_id, event_type, scenario_code, user_label, object_ref, metadata_json, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''',
                (
                    event.event_id,
                    event.event_type,
                    event.scenario_code,
                    event.user_label,
                    event.object_ref,
                    json.dumps(event.metadata),
                    event.created_at,
                ),
            )
        return event

    def create_feedback(self, scenario_code: str, usefulness_score: int, trust_score: int, ease_score: int, next_step: str, notes: str):
        feedback = TrialFeedbackRecord(
            feedback_id=f'fb_{uuid.uuid4().hex[:10]}',
            scenario_code=scenario_code,
            usefulness_score=usefulness_score,
            trust_score=trust_score,
            ease_score=ease_score,
            next_step=next_step,
            notes=notes,
            created_at=utc_now_iso(),
        )
        with get_connection(self._db_url) as connection:
            connection.execute(
                '''
                INSERT INTO trial_feedback (feedback_id, scenario_code, usefulness_score, trust_score, ease_score, next_step, notes, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ''',
                (
                    feedback.feedback_id,
                    feedback.scenario_code,
                    feedback.usefulness_score,
                    feedback.trust_score,
                    feedback.ease_score,
                    feedback.next_step,
                    feedback.notes,
                    feedback.created_at,
                ),
            )
        return feedback

    def get_ops_summary(self) -> TrialOpsSummary:
        with get_connection(self._db_url) as connection:
            total_events = connection.execute('SELECT COUNT(*) AS count FROM trial_event').fetchone()['count']
            total_feedback = connection.execute('SELECT COUNT(*) AS count FROM trial_feedback').fetchone()['count']
            next_steps = {
                row['next_step']: row['count']
                for row in connection.execute(
                    'SELECT next_step, COUNT(*) AS count FROM trial_feedback GROUP BY next_step ORDER BY count DESC'
                ).fetchall()
            }
            top_scenarios = [
                {'scenario_code': row['scenario_code'], 'count': row['count']}
                for row in connection.execute(
                    'SELECT scenario_code, COUNT(*) AS count FROM trial_event GROUP BY scenario_code ORDER BY count DESC, scenario_code ASC LIMIT 5'
                ).fetchall()
            ]
        return TrialOpsSummary(
            total_events=total_events,
            total_feedback=total_feedback,
            next_step_counts=next_steps,
            top_scenarios=top_scenarios,
        )

    def reset_trial_state(self) -> None:
        reset_database(self._db_url)
