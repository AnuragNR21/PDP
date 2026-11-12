from fastapi.testclient import TestClient


def test_impact_analysis_from_seed_result_and_handoff(client: TestClient):
    analysis = client.post(
        '/api/impact/analysis',
        json={
            'subject_type': 'check_result',
            'subject_id': 'res_seed_1',
            'max_depth': 3,
            'include_relationships': True,
        },
    )
    assert analysis.status_code == 201
    analysis_id = analysis.json()['analysis']['analysis_id']
    assert analysis.json()['analysis']['seed_node_id'] == 'node_account_status'

    affected = client.get(f'/api/impact/analysis/{analysis_id}/affected-items')
    assert affected.status_code == 200
    affected_items = affected.json()['items']
    assert len(affected_items) >= 1
    assert any(item['node_id'] == 'node_account_status' for item in affected_items)

    findings = client.get(f'/api/impact/analysis/{analysis_id}/findings')
    assert findings.status_code == 200
    finding_items = findings.json()['items']
    assert len(finding_items) >= 0


def test_impact_analysis_from_node_and_improve_queue(client: TestClient):
    analysis = client.post(
        '/api/impact/analysis',
        json={
            'subject_type': 'node',
            'subject_id': 'node_customer_subject',
            'max_depth': 3,
            'include_relationships': True,
        },
    )
    assert analysis.status_code == 201
    analysis_id = analysis.json()['analysis']['analysis_id']

    paths = client.get(f'/api/impact/analysis/{analysis_id}/paths')
    assert paths.status_code == 200
    path_items = paths.json()['items']
    assert len(path_items) >= 2
    assert any(item['to_node_id'] == 'node_customer_account' for item in path_items)

    findings = client.get(f'/api/impact/analysis/{analysis_id}/findings').json()['items']
    assert len(findings) >= 1

    handoff = client.post(
        f'/api/impact/analysis/{analysis_id}/handoff',
        json={'finding_id': findings[0]['finding_id'], 'destination': 'improve'},
    )
    assert handoff.status_code == 200
    assert handoff.json()['candidate']['analysis_id'] == analysis_id

    candidates = client.get('/api/improve/candidates')
    assert candidates.status_code == 200
    assert any(item['analysis_id'] == analysis_id for item in candidates.json()['items'])
