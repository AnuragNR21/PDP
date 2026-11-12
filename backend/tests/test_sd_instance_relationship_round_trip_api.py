"""SD instance relationships in the SWS round-trip export / import."""

from tests.test_sd_element_relationship_instances_api import _element, _instance, _link, _model, _relationship

LINK = "support_domain_model_element_instance_relationship"


def _setup(client, name="Round Trip Model"):
    model_id = _model(client, name)
    person = _element(client, model_id, "Person")
    org = _element(client, model_id, "Organisation")
    works_for = _relationship(client, model_id, person, org, kind="accountable_for")
    reports_to = _relationship(client, model_id, person, org, kind="reports_to")
    return {
        "model_id": model_id,
        "person": person,
        "org": org,
        "works_for": works_for,
        "reports_to": reports_to,
        "fred": _instance(client, model_id, person, "Fred"),
        "org1": _instance(client, model_id, org, "org1"),
    }


def _validate(client, elements=(), links=()):
    response = client.post(
        "/api/structure/imports/support-domain/validate",
        json={"load_support_domain_elements": list(elements), "load_support_domain_element_instance_relationships": list(links)},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _commit(client, stage_id, rows=None):
    body = {"stage_id": stage_id}
    if rows is not None:
        body["selected_row_numbers"] = rows
    response = client.post("/api/structure/imports/support-domain/commit", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _links(client, model_id):
    return client.get("/api/structure/element-instance-relationships", params={"model_id": model_id}).json()


def _row(s, **overrides):
    row = {
        "action": "CREATE",
        "support_domain_model_id": s["model_id"],
        "relationship_type_id": s["works_for"],
        "relationship_name": "Accountable for",
        "source_element_type_id": s["person"],
        "source_instance_id": s["fred"],
        "source_instance_name": "Fred",
        "target_element_type_id": s["org"],
        "target_instance_id": s["org1"],
        "target_instance_name": "org1",
    }
    row.update(overrides)
    return {key: value for key, value in row.items() if value is not None}


def test_export_includes_links_with_governed_name_and_ids(client):
    s = _setup(client)
    assert _link(client, s["works_for"], s["fred"], s["org1"]).status_code == 201
    exported = client.get("/api/structure/exports", params={"template_type": "support-domain", "model_ids": s["model_id"]}).json()
    rows = exported["Load_Support_Domain_Element_Instance_Relationships"]
    assert len(rows) == 1
    row = rows[0]
    assert row["action"] == "UPSERT"
    assert row["relationship_type_id"] == s["works_for"]
    assert row["relationship_name"] == "Accountable for"
    assert (row["source_instance_id"], row["source_instance_name"], row["source_element_type_id"]) == (s["fred"], "Fred", s["person"])
    assert (row["target_instance_id"], row["target_instance_name"], row["target_element_type_id"]) == (s["org1"], "org1", s["org"])
    assert row["pdp_system_id"]

    # Another model's export does not carry it.
    other = _model(client, "Elsewhere")
    elsewhere = client.get("/api/structure/exports", params={"template_type": "support-domain", "model_ids": other}).json()
    assert elsewhere["Load_Support_Domain_Element_Instance_Relationships"] == []


def test_round_trip_upsert_of_exported_rows_changes_nothing(client):
    s = _setup(client)
    assert _link(client, s["works_for"], s["fred"], s["org1"]).status_code == 201
    exported = client.get("/api/structure/exports", params={"template_type": "support-domain", "model_ids": s["model_id"]}).json()
    result = _validate(client, exported["Load_Support_Domain_Elements"], exported["Load_Support_Domain_Element_Instance_Relationships"])
    assert result["summary"]["rejected"] == 0, result["rows"]
    committed = _commit(client, result["stage_id"])
    assert committed["committed"] == 3
    assert len(_links(client, s["model_id"])) == 1


def test_create_picks_the_relationship_the_file_names(client):
    s = _setup(client)
    result = _validate(client, links=[_row(s, relationship_type_id=s["reports_to"], relationship_name="Reports to")])
    assert result["summary"]["accepted"] == 1, result["rows"]
    _commit(client, result["stage_id"])
    [link] = _links(client, s["model_id"])
    assert link["support_domain_relationship_id"] == s["reports_to"]


def test_name_only_resolves_exactly_one_allowable_relationship(client):
    s = _setup(client)
    result = _validate(client, links=[_row(s, relationship_type_id=None, relationship_name="accountable for")])
    assert result["summary"]["accepted"] == 1, result["rows"]
    _commit(client, result["stage_id"])
    assert _links(client, s["model_id"])[0]["support_domain_relationship_id"] == s["works_for"]

    missing = _validate(client, links=[_row(s, relationship_type_id=None, relationship_name=None)])
    assert missing["rows"][0]["code"] == "MISSING_REQUIRED"


def test_not_allowable_relationship_is_rejected_with_a_clear_reason(client):
    s = _setup(client)
    result = _validate(client, links=[_row(s, relationship_type_id=None, relationship_name="owns")])
    row = result["rows"][0]
    assert row["status"] == "rejected"
    assert row["code"] == "NOT_ALLOWABLE"
    assert row["message"] == (
        "Relationship rejected: Fred → owns → org1. Relationship owns is not an allowable relationship "
        "between Person and Organisation in the selected Support Domain model."
    )
    assert _links(client, s["model_id"]) == []


def test_wrong_direction_and_wrong_types_are_rejected(client):
    s = _setup(client)
    reversed_row = _row(
        s,
        source_element_type_id=s["org"], source_instance_id=s["org1"], source_instance_name="org1",
        target_element_type_id=s["person"], target_instance_id=s["fred"], target_instance_name="Fred",
    )
    assert _validate(client, links=[reversed_row])["rows"][0]["code"] == "WRONG_DIRECTION"
    by_name = dict(reversed_row)
    by_name.pop("relationship_type_id")
    assert _validate(client, links=[by_name])["rows"][0]["code"] == "WRONG_DIRECTION"

    wrong_type = _validate(client, links=[_row(s, source_element_type_id=s["org"])])
    assert wrong_type["rows"][0]["code"] == "SOURCE_INVALID"
    mismatch = _validate(client, links=[_row(s, relationship_name="Reports to")])
    assert mismatch["rows"][0]["code"] == "RELATIONSHIP_NAME_MISMATCH"
    unknown = _validate(client, links=[_row(s, relationship_type_id="nope")])
    assert unknown["rows"][0]["code"] == "RELATIONSHIP_NOT_FOUND"
    missing = _validate(client, links=[_row(s, target_instance_id="nope")])
    assert missing["rows"][0]["code"] == "TARGET_NOT_FOUND"


def test_duplicates_are_not_created(client):
    s = _setup(client)
    assert _link(client, s["works_for"], s["fred"], s["org1"]).status_code == 201
    existing = _validate(client, links=[_row(s)])
    assert existing["rows"][0]["code"] == "DUPLICATE_RELATIONSHIP"

    s2 = _setup(client, "Round Trip Model 2")
    twice = _validate(client, links=[_row(s2), _row(s2)])
    assert [row["status"] for row in twice["rows"]] == ["accepted", "rejected"]
    assert twice["rows"][1]["code"] == "DUPLICATE_RELATIONSHIP"


def test_links_to_instances_created_by_the_same_file(client):
    s = _setup(client)
    elements = [
        {"action": "CREATE", "external_id": "P-ANNA", "support_domain_model_id": s["model_id"], "element_type_id": s["person"], "name": "Anna"},
        {"action": "CREATE", "support_domain_model_id": s["model_id"], "element_type_id": s["org"], "name": "org2"},
    ]
    links = [
        _row(s, source_instance_id=None, source_external_id="P-ANNA", source_instance_name="Anna",
             target_instance_id=None, target_instance_name="org2", external_id="L-1"),
    ]
    result = _validate(client, elements, links)
    assert result["summary"]["rejected"] == 0, result["rows"]
    assert result["rows"][2]["row_number"] == 3  # continues after the two instance rows
    _commit(client, result["stage_id"])
    [link] = _links(client, s["model_id"])
    assert (link["source_instance_name"], link["target_instance_name"]) == ("Anna", "org2")
    assert link["external_id"] == "L-1"

    # Without its instance row selected, the link is not committed.
    s2 = _setup(client, "Round Trip Model 2")
    elements[0] = {**elements[0], "external_id": "P-BEN", "name": "Ben", "support_domain_model_id": s2["model_id"], "element_type_id": s2["person"]}
    result = _validate(client, elements[:1], [_row(s2, source_instance_id=None, source_external_id="P-BEN", source_instance_name="Ben")])
    assert result["summary"]["rejected"] == 0, result["rows"]
    committed = _commit(client, result["stage_id"], rows=[2])
    assert committed["committed"] == 0 and committed["failed"] == 1
    assert _links(client, s2["model_id"]) == []


def test_upsert_requires_an_existing_link_and_archived_instances_take_no_new_links(client):
    s = _setup(client)
    assert _validate(client, links=[_row(s, action="UPSERT")])["rows"][0]["code"] == "UPSERT_NOT_FOUND"

    archived = client.patch(f"/api/structure/element-instances/{s['fred']}", json={"name": "Fred", "status": "retired"})
    assert archived.status_code == 200, archived.text
    assert _validate(client, links=[_row(s)])["rows"][0]["code"] == "INSTANCE_NOT_AUTHORABLE"
