from __future__ import annotations

from collections import deque
from pathlib import Path
from uuid import uuid4

from features.impact.domain.models import RunImpactAnalysisCommand
from shared.contracts.canonical_types import (
    AffectedItemSummary,
    CanonicalNodeSummary,
    ImpactAnalysisSummary,
    ImpactFindingSummary,
    ImpactPathSummary,
    ImproveCandidateSummary,
)
from shared.contracts.refresh import RefreshRequest
from shared.db import get_connection, utc_now_iso


class ImpactRepository:
    def __init__(self, db_path: Path):
        self._db_path = db_path

    def _get_subject_seed_node_id(self, subject_type: str, subject_id: str) -> str:
        with get_connection(self._db_path) as connection:
            if subject_type == 'node':
                row = connection.execute(
                    'SELECT node_instance_id FROM hierarchy_model_node_instance WHERE node_instance_id = ?',
                    (subject_id,),
                ).fetchone()
                if row is None:
                    raise ValueError(f'Impact subject node not found: {subject_id}')
                return str(row['node_instance_id'])

            if subject_type == 'check_result':
                row = connection.execute(
                    '''
                    SELECT COALESCE(cr.target_node_id, cm.target_node_id) AS seed_node_id
                    FROM check_result cr
                    LEFT JOIN column_mapping cm
                        ON cm.session_id = cr.session_id AND cm.column_id = cr.column_id
                    WHERE cr.result_id = ?
                    ''',
                    (subject_id,),
                ).fetchone()
                if row is None or row['seed_node_id'] is None:
                    raise ValueError(f'Impact subject result does not resolve to a canonical node: {subject_id}')
                return str(row['seed_node_id'])

        raise ValueError(f'Unsupported impact subject type: {subject_type}')

    def _get_node_summary(self, connection, node_id: str) -> CanonicalNodeSummary:
        row = connection.execute(
            '''
            SELECT n.node_instance_id AS node_id, n.model_id, n.node_type_id, n.name, n.status,
                   e.parent_node_id, e.sort_order
            FROM hierarchy_model_node_instance n
            LEFT JOIN hierarchy_edge e ON e.child_node_id = n.node_instance_id
            WHERE n.node_instance_id = ?
            ''',
            (node_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f'Canonical node not found: {node_id}')
        return CanonicalNodeSummary.model_validate(dict(row))

    def _get_analysis_summary(self, analysis_id: str) -> ImpactAnalysisSummary:
        with get_connection(self._db_path) as connection:
            row = connection.execute(
                '''
                SELECT ar.analysis_id, ar.analysis_status, ar.created_at,
                       sr.subject_type, sr.subject_id,
                       sc.max_depth, sc.include_relationships,
                       sr.seed_node_id
                FROM impact_analysis_run ar
                JOIN impact_subject_ref sr ON sr.analysis_id = ar.analysis_id
                JOIN impact_scope sc ON sc.analysis_id = ar.analysis_id
                WHERE ar.analysis_id = ?
                ''',
                (analysis_id,),
            ).fetchone()
        if row is None:
            raise ValueError(f'Impact analysis not found: {analysis_id}')
        row_dict = dict(row)
        row_dict['include_relationships'] = bool(row_dict['include_relationships'])
        return ImpactAnalysisSummary.model_validate(row_dict)

    def run_analysis(self, command: RunImpactAnalysisCommand) -> tuple[ImpactAnalysisSummary, RefreshRequest]:
        analysis_id = f'analysis_{uuid4().hex[:12]}'
        now = utc_now_iso()
        seed_node_id = self._get_subject_seed_node_id(command.subject_type, command.subject_id)

        with get_connection(self._db_path) as connection:
            seed = self._get_node_summary(connection, seed_node_id)
            connection.execute(
                '''
                INSERT INTO impact_analysis_run (analysis_id, analysis_status, created_at)
                VALUES (?, 'completed', ?)
                ''',
                (analysis_id, now),
            )
            connection.execute(
                '''
                INSERT INTO impact_scope (analysis_id, max_depth, include_relationships, created_at)
                VALUES (?, ?, ?, ?)
                ''',
                (analysis_id, command.max_depth, 1 if command.include_relationships else 0, now),
            )
            connection.execute(
                '''
                INSERT INTO impact_subject_ref (
                    analysis_id, subject_type, subject_id, seed_node_id, created_at
                ) VALUES (?, ?, ?, ?, ?)
                ''',
                (analysis_id, command.subject_type, command.subject_id, seed_node_id, now),
            )

            visited: set[str] = {seed_node_id}
            queue: deque[tuple[str, int]] = deque([(seed_node_id, 0)])
            path_counter = 1
            finding_counter = 1
            affected_counter = 1

            connection.execute(
                '''
                INSERT INTO affected_item (
                    affected_item_id, analysis_id, node_id, depth, reached_via,
                    reached_from_node_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    f'affected_{analysis_id}_{affected_counter}',
                    analysis_id,
                    seed_node_id,
                    0,
                    'subject',
                    None,
                    now,
                ),
            )
            affected_counter += 1

            while queue:
                current_node_id, depth = queue.popleft()
                if depth >= command.max_depth:
                    continue

                child_rows = connection.execute(
                    '''
                    SELECT he.child_node_id AS next_node_id, 'parent_child' AS semantic_key
                    FROM hierarchy_edge he
                    WHERE he.parent_node_id = ?
                    ORDER BY he.sort_order, he.child_node_id
                    ''',
                    (current_node_id,),
                ).fetchall()

                rel_rows = []
                if command.include_relationships:
                    rel_rows = connection.execute(
                        '''
                        SELECT ri.target_node_id AS next_node_id, ri.semantic_key AS semantic_key
                        FROM cross_model_relationship_instance ri
                        WHERE ri.source_node_id = ?
                        ORDER BY ri.created_at, ri.relationship_id
                        ''',
                        (current_node_id,),
                    ).fetchall()

                for row in [*child_rows, *rel_rows]:
                    next_node_id = str(row['next_node_id'])
                    semantic_key = str(row['semantic_key'])
                    if next_node_id in visited:
                        continue
                    visited.add(next_node_id)
                    queue.append((next_node_id, depth + 1))
                    connection.execute(
                        '''
                        INSERT INTO impact_path (
                            path_id, analysis_id, from_node_id, to_node_id,
                            semantic_key, depth, path_order, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ''',
                        (
                            f'path_{analysis_id}_{path_counter}',
                            analysis_id,
                            current_node_id,
                            next_node_id,
                            semantic_key,
                            depth + 1,
                            path_counter,
                            now,
                        ),
                    )
                    connection.execute(
                        '''
                        INSERT INTO affected_item (
                            affected_item_id, analysis_id, node_id, depth, reached_via,
                            reached_from_node_id, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        ''',
                        (
                            f'affected_{analysis_id}_{affected_counter}',
                            analysis_id,
                            next_node_id,
                            depth + 1,
                            semantic_key,
                            current_node_id,
                            now,
                        ),
                    )
                    next_node = self._get_node_summary(connection, next_node_id)
                    severity = 'medium' if depth + 1 <= 1 else 'low'
                    score = round(max(0.1, 1 - ((depth + 1) * 0.2)), 2)
                    connection.execute(
                        '''
                        INSERT INTO impact_finding (
                            finding_id, analysis_id, target_node_id, severity,
                            score, title, detail, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ''',
                        (
                            f'finding_{analysis_id}_{finding_counter}',
                            analysis_id,
                            next_node_id,
                            severity,
                            score,
                            f'Impact reaches {next_node.name}',
                            f'Derived from {seed.name} to {next_node.name} via {semantic_key}.',
                            now,
                        ),
                    )
                    affected_counter += 1
                    path_counter += 1
                    finding_counter += 1

        return self._get_analysis_summary(analysis_id), RefreshRequest(
            scope='workspace',
            reason='impact.analysis.completed',
            targets=[analysis_id, seed_node_id],
        )

    def get_analysis(self, analysis_id: str) -> ImpactAnalysisSummary:
        return self._get_analysis_summary(analysis_id)

    def list_affected_items(self, analysis_id: str) -> list[AffectedItemSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                '''
                SELECT ai.affected_item_id, ai.analysis_id, ai.node_id, n.name AS node_name,
                       n.node_type_id, ai.depth, ai.reached_via, ai.reached_from_node_id
                FROM affected_item ai
                JOIN hierarchy_model_node_instance n ON n.node_instance_id = ai.node_id
                WHERE ai.analysis_id = ?
                ORDER BY ai.depth, n.name
                ''',
                (analysis_id,),
            ).fetchall()
        return [AffectedItemSummary.model_validate(dict(row)) for row in rows]

    def list_paths(self, analysis_id: str) -> list[ImpactPathSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                '''
                SELECT ip.path_id, ip.analysis_id, ip.from_node_id, source.name AS from_node_name,
                       ip.to_node_id, target.name AS to_node_name, ip.semantic_key,
                       ip.depth, ip.path_order
                FROM impact_path ip
                JOIN hierarchy_model_node_instance source ON source.node_instance_id = ip.from_node_id
                JOIN hierarchy_model_node_instance target ON target.node_instance_id = ip.to_node_id
                WHERE ip.analysis_id = ?
                ORDER BY ip.path_order
                ''',
                (analysis_id,),
            ).fetchall()
        return [ImpactPathSummary.model_validate(dict(row)) for row in rows]

    def list_findings(self, analysis_id: str) -> list[ImpactFindingSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                '''
                SELECT f.finding_id, f.analysis_id, f.target_node_id, n.name AS target_node_name,
                       f.severity, f.score, f.title, f.detail
                FROM impact_finding f
                LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = f.target_node_id
                WHERE f.analysis_id = ?
                ORDER BY f.score DESC, f.created_at, f.finding_id
                ''',
                (analysis_id,),
            ).fetchall()
        return [ImpactFindingSummary.model_validate(dict(row)) for row in rows]

    def create_handoff(self, analysis_id: str, finding_id: str) -> tuple[ImproveCandidateSummary, RefreshRequest]:
        candidate_id = f'candidate_{uuid4().hex[:12]}'
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            finding = connection.execute(
                '''
                SELECT f.finding_id, f.analysis_id, f.target_node_id, n.name AS target_name,
                       f.severity, f.title, f.detail
                FROM impact_finding f
                LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = f.target_node_id
                WHERE f.analysis_id = ? AND f.finding_id = ?
                ''',
                (analysis_id, finding_id),
            ).fetchone()
            if finding is None:
                raise ValueError(f'Impact finding not found for handoff: {finding_id}')
            connection.execute(
                '''
                INSERT INTO improve_candidate (
                    candidate_id, analysis_id, finding_id, target_node_id, priority,
                    title, detail, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
                ''',
                (
                    candidate_id,
                    analysis_id,
                    finding_id,
                    finding['target_node_id'],
                    finding['severity'],
                    finding['title'],
                    finding['detail'],
                    now,
                ),
            )
            row = connection.execute(
                '''
                SELECT ic.candidate_id, ic.analysis_id, ic.finding_id, ic.target_node_id,
                       n.name AS target_name, ic.priority, ic.title, ic.detail, ic.status, ic.created_at
                FROM improve_candidate ic
                LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = ic.target_node_id
                WHERE ic.candidate_id = ?
                ''',
                (candidate_id,),
            ).fetchone()
        candidate = ImproveCandidateSummary.model_validate(dict(row))
        refresh = RefreshRequest(
            scope='workspace',
            reason='impact.handoff.created',
            targets=[analysis_id, candidate_id],
        )
        return candidate, refresh

    def list_improve_candidates(self) -> list[ImproveCandidateSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                '''
                SELECT ic.candidate_id, ic.analysis_id, ic.finding_id, ic.target_node_id,
                       n.name AS target_name, ic.priority, ic.title, ic.detail, ic.status, ic.created_at
                FROM improve_candidate ic
                LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = ic.target_node_id
                ORDER BY ic.created_at DESC, ic.candidate_id DESC
                '''
            ).fetchall()
        return [ImproveCandidateSummary.model_validate(dict(row)) for row in rows]
