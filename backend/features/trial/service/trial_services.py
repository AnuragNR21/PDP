from pathlib import Path

from features.trial.domain.models import TrialFeedbackCommand, TrialHomePayload, TrialScenarioCard, TrialEventCommand
from features.trial.repo.trial_repository import TrialRepository
from shared.contracts.refresh import RefreshRequest


class TrialHomeService:
    def get_home(self) -> TrialHomePayload:
        return TrialHomePayload(
            scenarios=[
                TrialScenarioCard(
                    scenario_code='model_subject_area',
                    title='Model a utility subject area',
                    persona='Architect / information manager',
                    route='/structure/tree',
                    summary='Browse the seeded model through tree, matrix, and diagram without making projections authoritative.',
                ),
                TrialScenarioCard(
                    scenario_code='discover_map_quality',
                    title='Upload and map discovered data',
                    persona='Operational data steward',
                    route='/discover/mapping',
                    summary='Inspect seeded import evidence, profile columns, confirm mappings, and run checks.',
                ),
                TrialScenarioCard(
                    scenario_code='guided_governance',
                    title='Assign accountability and action',
                    persona='Governance lead',
                    route='/improve/dashboard',
                    summary='Move from failing results to ownership, work programs, and remediation outcomes.',
                ),
            ],
            known_limitations=[
                'Prototype auth, tenancy, and notifications are simplified.',
                'Exports return JSON packs rather than final document formatting.',
                'Seed and reset tooling is intended for guided trial reliability, not production operations.',
            ],
            next_steps=['request_workshop', 'request_pilot', 'follow_up_with_sample_data', 'submit_feedback'],
        )


class TrialOpsService:
    def __init__(self, db_path: Path):
        self._repository = TrialRepository(db_path)

    def record_event(self, command: TrialEventCommand):
        event = self._repository.create_event(
            command.event_type,
            command.scenario_code,
            command.user_label,
            command.object_ref,
            command.metadata,
        )
        refresh = RefreshRequest(scope='workspace', reason='trial.event.recorded', targets=[command.scenario_code])
        return {'event': event, 'refresh': refresh}

    def record_feedback(self, command: TrialFeedbackCommand):
        feedback = self._repository.create_feedback(
            command.scenario_code,
            command.usefulness_score,
            command.trust_score,
            command.ease_score,
            command.next_step,
            command.notes,
        )
        refresh = RefreshRequest(scope='workspace', reason='trial.feedback.recorded', targets=[command.scenario_code])
        return {'feedback': feedback, 'refresh': refresh}

    def get_summary(self):
        return {'summary': self._repository.get_ops_summary()}

    def reset(self):
        self._repository.reset_trial_state()
        return {'status': 'reset', 'refresh': RefreshRequest(scope='workspace', reason='trial.reset', targets=['all'])}

    def reseed(self):
        self._repository.reset_trial_state()
        return {'status': 'reseeded', 'refresh': RefreshRequest(scope='workspace', reason='trial.reseed', targets=['all'])}
