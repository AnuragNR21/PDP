def test_home_overview_endpoint_returns_foundation_payload(client) -> None:
    response = client.get("/api/home/overview")

    assert response.status_code == 200
    payload = response.json()

    assert payload["workspace"] == "home"
    assert len(payload["cards"]) >= 1
    assert len(payload["alerts"]) >= 1
