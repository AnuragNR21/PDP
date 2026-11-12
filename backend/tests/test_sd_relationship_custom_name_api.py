"""A Support Domain relationship named by the model itself ("zz 123"), as a cross-model type is."""

from tests.test_sd_element_relationship_instances_api import _element, _model

API = "/api/model/support-domain-relationships"


def _create(client, model_id, source, target, kind, **extra):
    return client.post(
        API,
        json={"model_id": model_id, "source_element_id": source, "target_element_id": target, "relationship_kind": kind, "status": "active", **extra},
    )


def _pair(client, name):
    model_id = _model(client, name)
    return model_id, _element(client, model_id, "Organisation"), _element(client, model_id, "Role")


def test_a_new_name_is_kept_as_typed(client):
    model_id, org, role = _pair(client, "Custom Name")
    created = _create(client, model_id, org, role, "  zz   123 ", notes="Our own wording")
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["relationship_kind"] == "zz 123"
    assert body["notes"] == "Our own wording"
    listed = client.get(API, params={"model_id": model_id}).json()
    assert [r["relationship_kind"] for r in listed] == ["zz 123"]


def test_a_kind_label_is_stored_as_its_key(client):
    model_id, org, role = _pair(client, "Kind Label")
    created = _create(client, model_id, org, role, "Reports to")
    assert created.status_code == 200, created.text
    assert created.json()["relationship_kind"] == "reports_to"
    assert _create(client, model_id, role, org, "reports_to").json()["relationship_kind"] == "reports_to"


def test_hierarchy_kinds_and_empty_names_are_refused(client):
    model_id, org, role = _pair(client, "Refused Names")
    for kind in ("parent_child", "Parent of", "recursive", "   "):
        refused = _create(client, model_id, org, role, kind)
        assert refused.status_code in (400, 422), (kind, refused.text)
    assert client.get(API, params={"model_id": model_id}).json() == []


def test_the_same_name_twice_between_the_same_types_is_refused(client):
    model_id, org, role = _pair(client, "Same Name Twice")
    assert _create(client, model_id, org, role, "zz 123").status_code == 200
    again = _create(client, model_id, org, role, "zz 123")
    assert again.status_code == 400
    assert "already has that relationship" in again.text
    # Another name between the same types is a second relationship.
    assert _create(client, model_id, org, role, "zz 456").status_code == 200
    assert len(client.get(API, params={"model_id": model_id}).json()) == 2


def test_a_relationship_can_be_renamed_to_and_from_its_own_name(client):
    model_id, org, role = _pair(client, "Rename")
    rel = _create(client, model_id, org, role, "governs").json()["relationship_id"]
    payload = {"model_id": model_id, "source_element_id": org, "target_element_id": role, "status": "active"}
    renamed = client.put(f"{API}/{rel}", json={**payload, "relationship_kind": "zz 123", "notes": "n"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["relationship_kind"] == "zz 123"
    back = client.put(f"{API}/{rel}", json={**payload, "relationship_kind": "Governs"})
    assert back.json()["relationship_kind"] == "governs"


def test_global_search_shows_the_name_as_typed(client):
    model_id, org, role = _pair(client, "Searchable Name")
    assert _create(client, model_id, org, role, "zz Custom Link").status_code == 200
    found = client.get("/api/search", params={"q": "zz custom", "types": "relationships"}).json()
    names = [item["name"] for group in found.get("groups", []) for item in group.get("items", [])] or [
        item["name"] for item in found.get("items", [])
    ]
    assert "zz Custom Link" in names, found
