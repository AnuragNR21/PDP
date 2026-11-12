"""
Lifecycle rules between MWS definitions and SWS instances:
Draft → Active → Archived (stored as 'retired').
"""


def _sd_model(client, status="active", name="Lifecycle SD"):
    res = client.post("/api/model/support-domain-models", json={"name": name, "purpose": "Lifecycle.", "status": status})
    assert res.status_code == 200, res.text
    return res.json()["support_domain_model_id"]


def _sd_element(client, model_id, name, status="active"):
    res = client.post("/api/model/support-domain-elements", json={"model_id": model_id, "name": name, "description": "", "status": status})
    assert res.status_code == 200, res.text
    return res.json()["element_id"]


def _sd_instance(client, model_id, type_id, name):
    return client.post("/api/structure/element-instances", json={"support_domain_model_id": model_id, "element_type_id": type_id, "name": name})


def _set_sd_model_status(client, model_id, status, name="Lifecycle SD"):
    return client.put(f"/api/model/support-domain-models/{model_id}", json={"name": name, "purpose": "Lifecycle.", "status": status})


def _set_element_status(client, model_id, element_id, name, status):
    return client.put(f"/api/model/support-domain-elements/{element_id}", json={"model_id": model_id, "name": name, "description": "", "status": status})


def _set_instance_status(client, instance_id, name, status):
    return client.patch(f"/api/structure/element-instances/{instance_id}", json={"name": name, "status": status})


def test_instances_only_from_active_model_and_type(client):
    draft_model = _sd_model(client, status="draft", name="Draft Model")
    draft_model_type = _sd_element(client, draft_model, "Thing")
    refused = _sd_instance(client, draft_model, draft_model_type, "A")
    assert refused.status_code == 400
    assert "Draft" in refused.json()["detail"]

    model = _sd_model(client)
    draft_type = _sd_element(client, model, "Draft Type", status="draft")
    assert _sd_instance(client, model, draft_type, "B").status_code == 400

    archived_type = _sd_element(client, model, "Archived Type", status="retired")
    refused = _sd_instance(client, model, archived_type, "C")
    assert refused.status_code == 400
    assert "Archived" in refused.json()["detail"]

    active_type = _sd_element(client, model, "Active Type")
    assert _sd_instance(client, model, active_type, "D").status_code == 201


def test_instance_status_follows_its_definition(client):
    model = _sd_model(client)
    element = _sd_element(client, model, "Rule")
    instance = _sd_instance(client, model, element, "Completeness").json()["instance_id"]

    for status in ("draft", "active", "retired", "active"):
        res = _set_instance_status(client, instance, "Completeness", status)
        assert res.status_code == 200, res.text
        assert res.json()["status"] == status
    assert _set_instance_status(client, instance, "Completeness", "bogus").status_code == 400


def test_definition_cannot_leave_active_while_instances_depend_on_it(client):
    model = _sd_model(client)
    element = _sd_element(client, model, "Rule")
    instance = _sd_instance(client, model, element, "Completeness").json()["instance_id"]

    refused = _set_element_status(client, model, element, "Rule", "retired")
    assert refused.status_code == 400
    detail = refused.json()["detail"]
    assert "Completeness (Active)" in detail and "Archive or delete" in detail
    assert _set_sd_model_status(client, model, "draft").status_code == 400

    # Archive the instance: now the definition may be archived, and the instance stays.
    assert _set_instance_status(client, instance, "Completeness", "retired").status_code == 200
    assert _set_element_status(client, model, element, "Rule", "retired").status_code == 200
    assert _set_sd_model_status(client, model, "retired").status_code == 200
    listed = client.get("/api/structure/element-instances", params={"model_id": model}).json()
    assert [(row["name"], row["status"]) for row in listed] == [("Completeness", "retired")]

    # Under an archived definition an instance can only stay archived.
    assert _set_instance_status(client, instance, "Completeness", "active").status_code == 400
    assert _set_instance_status(client, instance, "Completeness", "draft").status_code == 400


def test_new_relationships_need_authorable_instances_and_active_relationship(client):
    model = _sd_model(client)
    rule = _sd_element(client, model, "Rule")
    threshold = _sd_element(client, model, "Threshold")
    rel = client.post(
        "/api/model/support-domain-relationships",
        json={"model_id": model, "source_element_id": rule, "target_element_id": threshold, "relationship_kind": "has_threshold", "status": "active"},
    ).json()["relationship_id"]
    draft_rel = client.post(
        "/api/model/support-domain-relationships",
        json={"model_id": model, "source_element_id": rule, "target_element_id": threshold, "relationship_kind": "categorises", "status": "draft"},
    ).json()["relationship_id"]
    r1 = _sd_instance(client, model, rule, "R1").json()["instance_id"]
    t1 = _sd_instance(client, model, threshold, "T1").json()["instance_id"]

    def link(rel_id):
        return client.post(
            "/api/structure/element-instance-relationships",
            json={"support_domain_relationship_id": rel_id, "source_instance_id": r1, "target_instance_id": t1},
        )

    assert link(draft_rel).status_code == 400
    assert _set_instance_status(client, t1, "T1", "retired").status_code == 200
    archived = link(rel)
    assert archived.status_code == 400
    assert "Archived" in archived.json()["detail"]
    # Draft instances can still be related.
    assert _set_instance_status(client, t1, "T1", "draft").status_code == 200
    assert link(rel).status_code == 201


def test_hierarchy_root_and_children_follow_the_rules(client):
    model = client.post("/api/model/hierarchy-models", json={"name": "Draft Tree", "purpose": "t", "owning_domain": "information", "status": "draft"})
    assert model.status_code == 200, model.text
    model_id = model.json()["model_id"]
    refused = client.post("/api/structure/node-instances/ensure-root", params={"model_id": model_id})
    assert refused.status_code == 400
    assert "Draft" in refused.json()["detail"]

    assert client.put(
        f"/api/model/hierarchy-models/{model_id}",
        json={"name": "Draft Tree", "purpose": "t", "owning_domain": "information", "status": "active"},
    ).status_code == 200
    root = client.post("/api/structure/node-instances/ensure-root", params={"model_id": model_id})
    assert root.status_code == 200, root.text

    # The model cannot go back to Draft while its root instance is Active.
    back = client.put(
        f"/api/model/hierarchy-models/{model_id}",
        json={"name": "Draft Tree", "purpose": "t", "owning_domain": "information", "status": "draft"},
    )
    assert back.status_code == 400
    assert "Draft Tree (Active)" in back.json()["detail"]


def test_metadata_shows_archived(client):
    statuses = client.get("/api/model/metadata").json()["lifecycle_statuses"]
    assert {"key": "retired", "label": "Archived"} in statuses
