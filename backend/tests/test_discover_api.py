from fastapi.testclient import TestClient


def test_discover_seed_session_and_profile(client: TestClient):
    sessions = client.get('/api/discover/sessions')
    assert sessions.status_code == 200
    session_id = sessions.json()['items'][0]['session_id']

    columns = client.get(f'/api/discover/sessions/{session_id}/columns')
    assert columns.status_code == 200
    column_id = columns.json()['items'][0]['column_id']

    profile = client.get(f'/api/discover/sessions/{session_id}/profiles/{column_id}')
    assert profile.status_code == 200
    assert profile.json()['profile']['column_id'] == column_id


def test_discover_create_import_map_and_run_checks(client: TestClient):
    created = client.post('/api/discover/sessions', json={'name': 'April run', 'source_name': 'extract.csv'})
    assert created.status_code == 201
    session_id = created.json()['session']['session_id']

    imported = client.post(
        f'/api/discover/sessions/{session_id}/imports',
        json={
            'source_name': 'extract.csv',
            'row_count': 3,
            'columns': [
                {'column_name': 'Status', 'detected_type': 'text', 'sample_values': ['Active', 'Closed', '']},
                {'column_name': 'Customer ID', 'detected_type': 'text', 'sample_values': ['C001', 'C002', 'C003']},
            ],
        },
    )
    assert imported.status_code == 200

    columns = client.get(f'/api/discover/sessions/{session_id}/columns').json()['items']
    status_column = next(item for item in columns if item['column_name'] == 'Status')

    mapped = client.post(
        f'/api/discover/sessions/{session_id}/mappings',
        json={
            'column_id': status_column['column_id'],
            'target_node_id': 'node_account_status',
            'mapping_state': 'confirmed',
            'confidence': 0.98,
            'rationale': 'Status aligns to seeded canonical attribute.',
        },
    )
    assert mapped.status_code == 200

    checks = client.post(f'/api/discover/sessions/{session_id}/checks/run', json={'rule_version': 'mvp-v1'})
    assert checks.status_code == 200

    results = client.get(f'/api/discover/sessions/{session_id}/results').json()
    assert results['execution']['execution_status'] == 'completed'
    assert len(results['items']) == 2
