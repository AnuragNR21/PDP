from fastapi.testclient import TestClient


def test_export_pack(client: TestClient):
    response = client.get('/api/export/pack')
    assert response.status_code == 200
    payload = response.json()['pack']
    assert 'results' in payload and len(payload['results']) >= 1
    assert 'issues' in payload and len(payload['issues']) >= 1
    assert 'actions' in payload and len(payload['actions']) >= 1
    assert 'verifications' in payload and len(payload['verifications']) >= 1


def test_export_verifications_and_summary(client: TestClient):
    response = client.get('/api/export/verifications')
    assert response.status_code == 200
    assert len(response.json()['items']) >= 1

    summary = client.get('/api/export/evaluation-summary')
    assert summary.status_code == 200
    payload = summary.json()['summary']
    assert payload['verification_items'] >= 1


def test_demo_story_pack(client: TestClient):
    response = client.get('/api/export/demo-story-pack')
    assert response.status_code == 200
    payload = response.json()['story_pack']
    assert payload['headline'] == 'PDP trial demonstration pack'
    assert len(payload['sections']) >= 4
    assert any(item['section_code'] == 'action_and_verification' for item in payload['sections'])
    assert any(asset['asset_code'] == 'demo_story_pack' for asset in payload['presentation_assets'])
