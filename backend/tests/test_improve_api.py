from fastapi.testclient import TestClient


def test_improve_dashboard_and_work_program_flow(client: TestClient):
    dashboard = client.get('/api/improve/dashboard')
    assert dashboard.status_code == 200
    metric_keys = {item['metric_key'] for item in dashboard.json()['dashboard']['metrics']}
    assert 'improve.verification_pending' in metric_keys

    candidates = client.get('/api/improve/candidates')
    assert candidates.status_code == 200
    candidate_id = candidates.json()['items'][0]['candidate_id']

    created = client.post(
        '/api/improve/work-programs',
        json={
            'name': 'Status remediation wave',
            'priority': 'high',
            'owner_name': 'Jeff Steward',
            'candidate_ids': [candidate_id],
        },
    )
    assert created.status_code == 201
    program_id = created.json()['program']['program_id']

    tasks = client.get('/api/improve/tasks', params={'program_id': program_id})
    assert tasks.status_code == 200
    assert len(tasks.json()['items']) == 1
    task_id = tasks.json()['items'][0]['task_id']

    verification = client.post(
        '/api/improve/verifications',
        json={
            'candidate_id': candidate_id,
            'task_id': task_id,
            'outcome': 'passed',
            'evidence_note': 'Post-remediation rerun confirms allowed status domain only.',
            'follow_up_required': False,
            'verified_by_party_id': 'party_manager',
        },
    )
    assert verification.status_code == 201
    assert verification.json()['verification']['outcome'] == 'passed'

    refreshed_candidates = client.get('/api/improve/candidates').json()['items']
    matched = next(item for item in refreshed_candidates if item['candidate_id'] == candidate_id)
    assert matched['status'] == 'closed'


def test_create_work_program_with_owner_party(client):
    response = client.post('/api/improve/work-programs', json={
        'name': 'Assigned ownership program',
        'priority': 'high',
        'owner_name': 'Operations Manager',
        'owner_party_id': 'party_manager',
        'candidate_ids': ['candidate_seed_1']
    })
    assert response.status_code == 201
    tasks = client.get('/api/improve/tasks')
    assert tasks.status_code == 200
    assert any(item.get('assignee_party_id') == 'party_manager' for item in tasks.json()['items'])


def test_list_verifications_seeded(client: TestClient):
    response = client.get('/api/improve/verifications')
    assert response.status_code == 200
    items = response.json()['items']
    assert any(item['verification_id'] == 'verify_seed_1' for item in items)
