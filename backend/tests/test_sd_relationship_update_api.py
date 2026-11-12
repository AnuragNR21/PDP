"""Editing an existing Support Domain relationship (MWS list, inline)."""

from tests.test_sd_element_relationship_instances_api import _element, _model, _relationship

API = "/api/model/support-domain-relationships"


def _setup(client):
    model_id = _model(client, "UD-12 Accountability")
    org = _element(client, model_id, "Organisation")
    person = _element(client, model_id, "Person")
    role = _element(client, model_id, "Role")
    first = _relationship(client, model_id, org, role, kind="responsible_for", status="draft")
    second = _relationship(client, model_id, person, role, kind="delegates_to", status="draft")
    return model_id, org, person, role, first, second


def test_a_listed_relationship_can_be_sent_straight_back(client):
    model_id, org, person, role, _first, second = _setup(client)
    listed = next(r for r in client.get(API, params={"model_id": model_id}).json() if r["relationship_id"] == second)
    # The read carries the id the write needs, under the write's name.
    assert listed["model_id"] == model_id and listed["notes"] == ""

    updated = client.put(
        f"{API}/{second}",
        json={
            "model_id": listed["model_id"],
            "source_element_id": role,
            "target_element_id": person,
            "relationship_kind": "applies_to",
            "notes": "nnn",
            "status": "active",
        },
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert (body["source_element_id"], body["target_element_id"], body["relationship_kind"], body["status"], body["notes"]) == (
        role, person, "applies_to", "active", "nnn",
    )
    again = next(r for r in client.get(API, params={"model_id": model_id}).json() if r["relationship_id"] == second)
    assert again["notes"] == "nnn"


def test_an_update_onto_an_existing_relationship_is_refused_not_a_500(client):
    model_id, org, person, role, first, second = _setup(client)
    clash = client.put(
        f"{API}/{second}",
        json={"model_id": model_id, "source_element_id": org, "target_element_id": role, "relationship_kind": "responsible_for", "status": "draft"},
    )
    assert clash.status_code == 400, clash.text
    assert "already has that relationship" in clash.text
    # Saving a relationship unchanged is not a clash with itself.
    same = client.put(
        f"{API}/{first}",
        json={"model_id": model_id, "source_element_id": org, "target_element_id": role, "relationship_kind": "responsible_for", "status": "draft"},
    )
    assert same.status_code == 200, same.text


def test_notes_are_kept_on_create(client):
    model_id = _model(client, "Notes Model")
    a = _element(client, model_id, "A")
    b = _element(client, model_id, "B")
    created = client.post(
        API, json={"model_id": model_id, "source_element_id": a, "target_element_id": b, "relationship_kind": "produces", "notes": "why", "status": "active"}
    )
    assert created.status_code == 200, created.text
    assert created.json()["notes"] == "why"
