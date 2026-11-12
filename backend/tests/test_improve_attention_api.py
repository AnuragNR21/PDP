
from fastapi.testclient import TestClient


def test_improve_attention_signals_and_follow_up_queue(client: TestClient) -> None:
    signals = client.get("/api/improve/attention-signals")
    assert signals.status_code == 200
    payload = signals.json()
    assert any(item["signal_type"] == "verification.follow_up" for item in payload["items"])

    queue = client.get("/api/improve/follow-up-queue")
    assert queue.status_code == 200
    queue_payload = queue.json()
    assert len(queue_payload["items"]) >= 1
    assert queue_payload["items"][0]["queue_status"] in {"open", "in_progress", "resolved"}


def test_follow_up_queue_update_can_resolve_item(client: TestClient) -> None:
    response = client.patch(
        "/api/improve/follow-up-queue/verify_seed_1",
        json={
            "queue_status": "resolved",
            "owner_party_id": "party_manager",
            "follow_up_note": "Verification rerun reviewed and closed."
        },
    )
    assert response.status_code == 200
    item = response.json()["item"]
    assert item["queue_status"] == "resolved"

    queue = client.get("/api/improve/follow-up-queue?queue_status=resolved")
    assert queue.status_code == 200
    assert any(entry["verification_id"] == "verify_seed_1" for entry in queue.json()["items"])
