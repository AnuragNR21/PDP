from pathlib import Path

from features.export.repo.export_repository import ExportRepository


class ExportService:
    def __init__(self, db_path: Path):
        self._repository = ExportRepository(db_path)

    def get_pack(self):
        return {'pack': self._repository.build_export_pack()}

    def get_results(self):
        return {'items': self._repository.build_export_pack()['results']}

    def get_issues(self):
        return {'items': self._repository.build_export_pack()['issues']}

    def get_actions(self):
        return {'items': self._repository.build_export_pack()['actions']}

    def get_verifications(self):
        return {'items': self._repository.build_export_pack()['verifications']}

    def get_evaluation_summary(self):
        return {'summary': self._repository.build_export_pack()['evaluation_summary']}

    def get_demo_story_pack(self):
        pack = self._repository.build_export_pack()
        results = pack['results']
        issues = pack['issues']
        actions = pack['actions']
        verifications = pack['verifications']

        story_sections = [
            {
                'section_code': 'structure_context',
                'title': 'Structure and context',
                'narrative': 'Open with the authoritative model and structure routes to show governed information coverage before moving into evidence.',
                'primary_routes': ['/model/tree-models', '/structure/tree', '/structure/diagram', '/structure/matrix'],
                'asset_counts': {'results': 0, 'issues': 0, 'actions': 0, 'verifications': 0},
            },
            {
                'section_code': 'discover_evidence',
                'title': 'Discover evidence',
                'narrative': 'Show seeded profiling, mappings, and quality checks to establish concrete evidence for later analysis.',
                'primary_routes': ['/discover/mapping'],
                'asset_counts': {'results': len(results), 'issues': 0, 'actions': 0, 'verifications': 0},
            },
            {
                'section_code': 'impact_and_priority',
                'title': 'Impact and priority',
                'narrative': 'Move from evidence into connected impact findings, then demonstrate prioritised handoff into Improve.',
                'primary_routes': ['/impact/knowledge-graph', '/improve/dashboard', '/improve/attention'],
                'asset_counts': {'results': len(results), 'issues': len(issues), 'actions': 0, 'verifications': 0},
            },
            {
                'section_code': 'action_and_verification',
                'title': 'Action and verification',
                'narrative': 'Close with work programs, remediation tasks, verification evidence, and follow-up queue visibility.',
                'primary_routes': ['/improve/work-program', '/improve/progress-tracking', '/improve/verification', '/improve/export-summary'],
                'asset_counts': {'results': len(results), 'issues': len(issues), 'actions': len(actions), 'verifications': len(verifications)},
            },
        ]

        presentation_assets = [
            {
                'asset_code': 'summary_pack',
                'title': 'Export summary pack',
                'description': 'API-ready JSON pack containing results, issues, actions, verifications, and evaluation summary.',
                'source_endpoint': '/api/export/pack',
            },
            {
                'asset_code': 'evaluation_summary',
                'title': 'Evaluation summary',
                'description': 'Condensed trial metrics for slide-ready summary pages and handoff packs.',
                'source_endpoint': '/api/export/evaluation-summary',
            },
            {
                'asset_code': 'demo_story_pack',
                'title': 'Demo story pack',
                'description': 'Narrative grouping of routes and export assets for presentation-quality demonstrations.',
                'source_endpoint': '/api/export/demo-story-pack',
            },
        ]

        return {
            'story_pack': {
                'generated_at': pack['generated_at'],
                'headline': 'PDP trial demonstration pack',
                'sections': story_sections,
                'presentation_assets': presentation_assets,
                'evaluation_summary': pack['evaluation_summary'],
            }
        }
