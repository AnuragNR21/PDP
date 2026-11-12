"""Governed links between Support Domain element instances (SWS)."""


def _model(client, name="Instance Link Model"):
    created = client.post(
        "/api/model/support-domain-models",
        json={"name": name, "purpose": "Instance relationship authoring.", "status": "active"},
    )
    assert created.status_code == 200
    return created.json()["support_domain_model_id"]


def _element(client, model_id, name):
    created = client.post(
        "/api/model/support-domain-elements",
        json={"model_id": model_id, "name": name, "description": "", "status": "active"},
    )
    assert created.status_code == 200
    return created.json()["element_id"]


def _relationship(client, model_id, source, target, kind="has_threshold", status="active"):
    created = client.post(
        "/api/model/support-domain-relationships",
        json={
            "model_id": model_id,
            "source_element_id": source,
            "target_element_id": target,
            "relationship_kind": kind,
            "status": status,
        },
    )
    assert created.status_code == 200, created.text
    return created.json()["relationship_id"]


def _instance(client, model_id, element_type_id, name):
    created = client.post(
        "/api/structure/element-instances",
        json={"support_domain_model_id": model_id, "element_type_id": element_type_id, "name": name},
    )
    assert created.status_code == 201, created.text
    return created.json()["instance_id"]


def _setup(client):
    model_id = _model(client)
    rule = _element(client, model_id, "DQ Rule")
    threshold = _element(client, model_id, "DQ Threshold")
    rel_id = _relationship(client, model_id, rule, threshold)
    return {
        "model_id": model_id,
        "rule": rule,
        "threshold": threshold,
        "rel_id": rel_id,
        "r1": _instance(client, model_id, rule, "Completeness"),
        "r2": _instance(client, model_id, rule, "Validity"),
        "t1": _instance(client, model_id, threshold, "95%"),
    }


def _link(client, rel_id, source, target):
    return client.post(
        "/api/structure/element-instance-relationships",
        json={"support_domain_relationship_id": rel_id, "source_instance_id": source, "target_instance_id": target},
    )


def test_create_list_and_delete_link(client):
    s = _setup(client)
    created = _link(client, s["rel_id"], s["r1"], s["t1"])
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["support_domain_relationship_id"] == s["rel_id"]
    assert body["relationship_type"] == "has_threshold"
    assert body["source_instance_name"] == "Completeness"
    assert body["target_instance_name"] == "95%"

    listed = client.get("/api/structure/element-instance-relationships", params={"model_id": s["model_id"]})
    assert listed.status_code == 200
    assert [row["relationship_instance_id"] for row in listed.json()] == [body["relationship_instance_id"]]

    deleted = client.delete(f"/api/structure/element-instance-relationships/{body['relationship_instance_id']}")
    assert deleted.status_code == 204
    assert client.get("/api/structure/element-instance-relationships", params={"model_id": s["model_id"]}).json() == []
    assert client.delete(f"/api/structure/element-instance-relationships/{body['relationship_instance_id']}").status_code == 404


def test_only_model_defined_pairs_can_be_linked(client):
    s = _setup(client)
    # Wrong direction: target type as source.
    assert _link(client, s["rel_id"], s["t1"], s["r1"]).status_code == 400
    # Same type on both ends where the model relates two different types.
    assert _link(client, s["rel_id"], s["r1"], s["r2"]).status_code == 400
    # Self link.
    assert _link(client, s["rel_id"], s["r1"], s["r1"]).status_code == 400
    # Unknown relationship.
    assert _link(client, "missing", s["r1"], s["t1"]).status_code == 400
    # Duplicate.
    assert _link(client, s["rel_id"], s["r1"], s["t1"]).status_code == 201
    duplicate = _link(client, s["rel_id"], s["r1"], s["t1"])
    assert duplicate.status_code == 400
    assert "already linked" in duplicate.json()["detail"]


def test_instances_from_another_model_are_refused(client):
    s = _setup(client)
    other_model = _model(client, "Other Model")
    other_threshold = _element(client, other_model, "DQ Threshold")
    foreign = _instance(client, other_model, other_threshold, "80%")
    assert _link(client, s["rel_id"], s["r1"], foreign).status_code == 400


def test_links_go_with_their_instance_and_their_relationship(client):
    s = _setup(client)
    assert _link(client, s["rel_id"], s["r1"], s["t1"]).status_code == 201
    assert _link(client, s["rel_id"], s["r2"], s["t1"]).status_code == 201

    assert client.delete(f"/api/structure/element-instances/{s['r1']}").status_code == 204
    remaining = client.get("/api/structure/element-instance-relationships", params={"model_id": s["model_id"]}).json()
    assert [row["source_instance_id"] for row in remaining] == [s["r2"]]

    assert client.delete(f"/api/model/support-domain-relationships/{s['rel_id']}").status_code in (200, 204)
    assert client.get("/api/structure/element-instance-relationships", params={"model_id": s["model_id"]}).json() == []
