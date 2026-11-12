def test_health_endpoint_returns_ok(client) -> None:
    response = client.get('/api/platform/health')

    assert response.status_code == 200
    assert response.json()['status'] == 'ok'


def test_diagnostics_endpoint_returns_runtime_state(client) -> None:
    response = client.get('/api/platform/diagnostics')

    assert response.status_code == 200
    assert response.json()['status'] == 'ok'
    assert response.json()['database_present'] is True
