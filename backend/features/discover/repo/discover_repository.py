import json
from collections import Counter
from uuid import uuid4

from features.discover.domain.models import CreateDiscoverySessionCommand, ImportDatasetCommand, UpsertColumnMappingCommand
from shared.contracts.canonical_types import (
    CheckExecutionSummary,
    CheckResultSummary,
    ColumnMappingSummary,
    ColumnProfileSummary,
    DiscoverySessionSummary,
    SourceColumnSummary,
)
from shared.db import get_connection, utc_now_iso


class DiscoverRepository:
    def __init__(self, db_path: str):
        self._db_path = db_path

    def list_sessions(self) -> list[DiscoverySessionSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                'SELECT session_id, name, source_name, status, created_at, updated_at FROM discovery_session ORDER BY updated_at DESC, name'
            ).fetchall()
        return [DiscoverySessionSummary(**dict(row)) for row in rows]

    def create_session(self, command: CreateDiscoverySessionCommand) -> DiscoverySessionSummary:
        session_id = f'sess_{uuid4().hex[:12]}'
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            connection.execute(
                'INSERT INTO discovery_session (session_id, name, source_name, status, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s)',
                (session_id, command.name, command.source_name, 'draft', now, now),
            )
            row = connection.execute(
                'SELECT session_id, name, source_name, status, created_at, updated_at FROM discovery_session WHERE session_id = %s',
                (session_id,),
            ).fetchone()
        return DiscoverySessionSummary(**dict(row))

    def session_exists(self, session_id: str) -> bool:
        with get_connection(self._db_path) as connection:
            return connection.execute('SELECT 1 FROM discovery_session WHERE session_id = %s', (session_id,)).fetchone() is not None

    def import_dataset(self, session_id: str, command: ImportDatasetCommand) -> None:
        dataset_id = f'ds_{uuid4().hex[:12]}'
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            connection.execute('DELETE FROM source_dataset WHERE session_id = %s', (session_id,))
            connection.execute(
                'INSERT INTO source_dataset (dataset_id, session_id, source_name, row_count, import_status, created_at) VALUES (%s, %s, %s, %s, %s, %s)',
                (dataset_id, session_id, command.source_name, command.row_count, 'completed', now),
            )
            for ordinal, column in enumerate(command.columns, start=1):
                column_id = f'col_{uuid4().hex[:12]}'
                connection.execute(
                    'INSERT INTO source_column (column_id, session_id, dataset_id, column_name, ordinal, detected_type, sample_values_json, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
                    (column_id, session_id, dataset_id, column.column_name, ordinal, column.detected_type, json.dumps(column.sample_values), now),
                )
                values = column.sample_values
                blank_count = sum(1 for value in values if value == '')
                distinct_count = len(set(value for value in values if value != ''))
                inferred_kind = 'identifier' if 'id' in column.column_name.lower() else column.detected_type.lower()
                distribution = json.dumps([{'value': key, 'count': count} for key, count in Counter(values).most_common(10)])
                connection.execute(
                    'INSERT INTO column_profile_result VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
                    (f'prof_{uuid4().hex[:12]}', session_id, column_id, distinct_count, 0, blank_count, inferred_kind, distribution, now),
                )
            connection.execute('UPDATE discovery_session SET source_name = %s, status = %s, updated_at = %s WHERE session_id = %s', (command.source_name, 'ready', now, session_id))

    def list_columns(self, session_id: str) -> list[SourceColumnSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                'SELECT column_id, session_id, dataset_id, column_name, ordinal, detected_type, sample_values_json FROM active_source_column WHERE session_id = %s ORDER BY ordinal',
                (session_id,),
            ).fetchall()
        return [SourceColumnSummary(**{**dict(row), 'sample_values': json.loads(row['sample_values_json'])}) for row in rows]

    def get_profile(self, session_id: str, column_id: str) -> ColumnProfileSummary | None:
        with get_connection(self._db_path) as connection:
            row = connection.execute(
                'SELECT profile_id, session_id, column_id, distinct_count, null_count, blank_count, inferred_kind, value_distribution_json, profiled_at FROM column_profile_result WHERE session_id = %s AND column_id = %s',
                (session_id, column_id),
            ).fetchone()
        return None if row is None else ColumnProfileSummary(**{**dict(row), 'value_distribution': json.loads(row['value_distribution_json'])})

    def column_exists(self, session_id: str, column_id: str) -> bool:
        with get_connection(self._db_path) as connection:
            return connection.execute('SELECT 1 FROM active_source_column WHERE session_id = %s AND column_id = %s', (session_id, column_id)).fetchone() is not None

    def list_mappings(self, session_id: str) -> list[ColumnMappingSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                '''
                SELECT m.mapping_id, m.session_id, m.column_id, m.target_node_id, m.mapping_state, m.confidence, m.rationale, n.name AS target_name
                FROM column_mapping m LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = m.target_node_id
                WHERE m.session_id = %s ORDER BY m.updated_at DESC
                ''',
                (session_id,),
            ).fetchall()
        return [ColumnMappingSummary(**dict(row)) for row in rows]

    def upsert_mapping(self, session_id: str, command: UpsertColumnMappingCommand) -> ColumnMappingSummary:
        mapping_id = f'map_{uuid4().hex[:12]}'
        now = utc_now_iso()
        with get_connection(self._db_path) as connection:
            # Mappings are one-to-one inside a session: a model field belongs to
            # at most one source column, and a column to at most one field.
            # Re-using a target therefore MOVES it — release it from whichever
            # column held it before. (The column side is handled by the
            # ON CONFLICT(session_id, column_id) upsert below.)
            connection.execute(
                'DELETE FROM column_mapping WHERE session_id = %s AND target_node_id = %s AND column_id <> %s '
                'AND source_file_id = (SELECT active_source_file_id FROM discovery_session WHERE session_id = %s)',
                (session_id, command.target_node_id, command.column_id, session_id),
            )
            connection.execute(
                '''
                INSERT INTO column_mapping (mapping_id, session_id, source_file_id, column_id, target_node_id, mapping_state, confidence, rationale, created_at, updated_at)
                VALUES (%s, %s, (SELECT active_source_file_id FROM discovery_session WHERE session_id = %s), %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT(session_id, column_id)
                DO UPDATE SET target_node_id = excluded.target_node_id,
                              mapping_state = excluded.mapping_state,
                              confidence = excluded.confidence,
                              rationale = excluded.rationale,
                              updated_at = excluded.updated_at
                ''',
                (mapping_id, session_id, session_id, command.column_id, command.target_node_id, command.mapping_state, command.confidence, command.rationale, now, now),
            )
            row = connection.execute(
                'SELECT m.mapping_id, m.session_id, m.column_id, m.target_node_id, m.mapping_state, m.confidence, m.rationale, n.name AS target_name FROM column_mapping m LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = m.target_node_id WHERE m.session_id = %s AND m.column_id = %s',
                (session_id, command.column_id),
            ).fetchone()
        return ColumnMappingSummary(**dict(row))

    def clear_mapping(self, session_id: str, column_id: str) -> None:
        with get_connection(self._db_path) as connection:
            connection.execute('DELETE FROM column_mapping WHERE session_id = %s AND column_id = %s', (session_id, column_id))

    def run_checks(self, session_id: str, rule_version: str) -> CheckExecutionSummary:
        execution_id = f'exec_{uuid4().hex[:12]}'
        completed_at = utc_now_iso()
        with get_connection(self._db_path) as connection:
            connection.execute('DELETE FROM check_result WHERE session_id = %s', (session_id,))
            connection.execute('DELETE FROM check_execution WHERE session_id = %s', (session_id,))
            connection.execute('INSERT INTO check_execution VALUES (%s, %s, %s, %s, %s, %s)', (execution_id, session_id, 'completed', rule_version, completed_at, completed_at))
            rows = connection.execute(
                'SELECT c.column_id, c.column_name, c.sample_values_json, m.target_node_id FROM active_source_column c LEFT JOIN column_mapping m ON m.session_id = c.session_id AND m.column_id = c.column_id WHERE c.session_id = %s ORDER BY c.ordinal',
                (session_id,),
            ).fetchall()
            for row in rows:
                values = json.loads(row['sample_values_json'])
                blanks = sum(1 for value in values if value == '')
                if blanks > 0:
                    severity = 'medium'
                    message = f"{row['column_name']} contains blank values."
                    metric_value = blanks / len(values)
                elif row['target_node_id'] is None:
                    severity = 'low'
                    message = f"{row['column_name']} is not yet mapped to a canonical target."
                    metric_value = 1.0
                else:
                    severity = 'low'
                    message = f"{row['column_name']} completed seeded checks."
                    metric_value = 0.0
                connection.execute(
                    'INSERT INTO check_result VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
                    (f'res_{uuid4().hex[:12]}', execution_id, session_id, row['column_id'], row['target_node_id'], severity, message, metric_value, completed_at),
                )
            connection.execute('UPDATE discovery_session SET status = %s, updated_at = %s WHERE session_id = %s', ('completed', completed_at, session_id))
            result = connection.execute('SELECT execution_id, session_id, execution_status, rule_version, started_at, completed_at FROM check_execution WHERE execution_id = %s', (execution_id,)).fetchone()
        return CheckExecutionSummary(**dict(result))

    def latest_execution(self, session_id: str) -> CheckExecutionSummary | None:
        with get_connection(self._db_path) as connection:
            row = connection.execute('SELECT execution_id, session_id, execution_status, rule_version, started_at, completed_at FROM check_execution WHERE session_id = %s ORDER BY completed_at DESC LIMIT 1', (session_id,)).fetchone()
        return None if row is None else CheckExecutionSummary(**dict(row))

    def list_results(self, session_id: str, severity: str | None = None) -> list[CheckResultSummary]:
        sql = 'SELECT r.result_id, r.execution_id, r.session_id, r.column_id, r.target_node_id, r.severity, r.message, r.metric_value, r.created_at, c.column_name, n.name AS target_name FROM check_result r JOIN active_source_column c ON c.column_id = r.column_id LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = r.target_node_id WHERE r.session_id = %s'
        params: list[object] = [session_id]
        if severity is not None:
            sql += ' AND r.severity = %s'
            params.append(severity)
        sql += ' ORDER BY r.created_at DESC'
        with get_connection(self._db_path) as connection:
            rows = connection.execute(sql, tuple(params)).fetchall()
        return [CheckResultSummary(**dict(row)) for row in rows]
