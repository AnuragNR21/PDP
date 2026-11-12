from fastapi.testclient import TestClient


def test_trial_home_feedback_and_summary(client: TestClient):
    home = client.get('/api/trial/home')
    assert home.status_code == 200
    assert len(home.json()['scenarios']) >= 3

    event = client.post(
        '/api/trial/events',
        json={
            'event_type': 'scenario.completed',
            'scenario_code': 'guided_governance',
            'user_label': 'jeff',
            'metadata': {'entry': 'test'},
        },
    )
    assert event.status_code == 201

    feedback = client.post(
        '/api/trial/feedback',
        json={
            'scenario_code': 'guided_governance',
            'usefulness_score': 5,
            'trust_score': 4,
            'ease_score': 4,
            'next_step': 'request_workshop',
            'notes': 'Strong end-to-end prototype flow.',
        },
    )
    assert feedback.status_code == 201

    summary = client.get('/api/trial/summary')
    assert summary.status_code == 200
    assert summary.json()['summary']['total_events'] >= 3
    assert summary.json()['summary']['next_step_counts']['request_workshop'] >= 1


def test_trial_reset_restores_seeded_state(client: TestClient):
    created = client.post(
        '/api/trial/events',
        json={'event_type': 'scenario.started', 'scenario_code': 'discover_map_quality', 'user_label': 'ops'},
    )
    assert created.status_code == 201

    reset = client.post('/api/trial/reset')
    assert reset.status_code == 200
    assert reset.json()['status'] == 'reset'

    summary = client.get('/api/trial/summary').json()['summary']
    assert summary['total_events'] == 2
