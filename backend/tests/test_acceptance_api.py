from fastapi.testclient import TestClient


def test_acceptance_catalogue_and_harness(client: TestClient):
    scenarios = client.get('/api/acceptance/scenarios')
    assert scenarios.status_code == 200
    scenario_payload = scenarios.json()
    assert len(scenario_payload) >= 4
    assert any(item['scenario_code'] == 'scenario_discover_to_impact' for item in scenario_payload)

    routes = client.get('/api/acceptance/routes')
    assert routes.status_code == 200
    route_payload = routes.json()
    assert any(item['route'] == '/admin/acceptance' for item in route_payload)
    assert any(item['route'] == '/admin/release-readiness' for item in route_payload)

    readiness = client.get('/api/acceptance/release-readiness')
    assert readiness.status_code == 200
    readiness_payload = readiness.json()
    assert readiness_payload['release_label'] == 'PDP Trial Release Candidate'
    assert readiness_payload['scenario_total_count'] >= 4
    assert len(readiness_payload['checklist']) >= 5

    run = client.post(
        '/api/acceptance/runs',
        json={'actor_label': 'Test reviewer', 'scenario_codes': ['scenario_discover_to_impact']},
    )
    assert run.status_code == 200
    run_payload = run.json()
    assert run_payload['overall_status'] in {'passed', 'warning'}
    assert len(run_payload['results']) >= 4
