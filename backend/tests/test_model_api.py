from app.config import get_settings
from shared.db import get_connection, utc_now_iso


def test_model_endpoints_create_and_activate_definition(client) -> None:
    overview = client.get("/api/model/overview")
    assert overview.status_code == 200
    assert len(overview.json()["models"]) >= 1

    created = client.post(
        "/api/model/models",
        json={
            "name": "Operations Model",
            "purpose": "Governs operational structure definitions.",
            "owning_domain": "operations",
            "status": "draft",
        },
    )
    assert created.status_code == 201
    model_id = created.json()["model_id"]

    activated = client.post(f"/api/model/definitions/{model_id}/activate")
    assert activated.status_code == 200
    assert activated.json()["status"] == "active"


def test_cross_model_relationship_type_governed_delete_cascades_instances(client) -> None:
    db_url = get_settings().database_url
    now = utc_now_iso()
    with get_connection(db_url) as conn:
        conn.execute(
            """
            INSERT INTO cross_model_relationship_type
                (relationship_type_id, name, source_model_type, target_model_type, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            ("relationship_type_delete", "Depends on", "HIERARCHY_MODEL", "HIERARCHY_MODEL", "active", now, now),
        )
        conn.execute(
            """
            INSERT INTO cross_model_relationship_instance
                (relationship_id, relationship_rule_id, source_instance_id, source_instance_type,
                 target_instance_id, target_instance_type, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            ("relationship_instance_delete", "relationship_type_delete", "source-node", "HIERARCHY_MODEL", "target-node", "HIERARCHY_MODEL", "active", now, now),
        )

    impact = client.get("/api/model/cross-model-relationship-types/relationship_type_delete/delete-impact")
    assert impact.status_code == 200
    impact_body = impact.json()
    assert impact_body["impact_summary"]["relationship_count"] == 1
    assert len(impact_body["impact_list_items"]) == 1

    deleted = client.delete("/api/model/cross-model-relationship-types/relationship_type_delete")
    assert deleted.status_code == 204

    with get_connection(db_url) as conn:
        assert conn.execute(
            "SELECT 1 FROM cross_model_relationship_instance WHERE relationship_id = %s",
            ("relationship_instance_delete",),
        ).fetchone() is None


def test_support_domain_diagram_nodes_are_created_with_element(client) -> None:
    created_model = client.post(
        "/api/model/support-domain-models",
        json={
            "name": "Diagram Action Model",
            "purpose": "Verifies diagram node creation is action based.",
            "status": "draft",
        },
    )
    assert created_model.status_code == 200
    model_id = created_model.json()["support_domain_model_id"]

    created_element = client.post(
        "/api/model/support-domain-elements",
        json={
            "model_id": model_id,
            "name": "Action Element",
            "description": "",
            "status": "draft",
        },
    )
    assert created_element.status_code == 200
    element_id = created_element.json()["element_id"]

    read_nodes = client.get(f"/api/model/support-domain-diagram-nodes?model_id={model_id}")
    assert read_nodes.status_code == 200
    assert len(read_nodes.json()) == 1
    assert read_nodes.json()[0]["element_id"] == element_id

    read_elements = client.get(f"/api/model/support-domain-elements?model_id={model_id}")
    assert read_elements.status_code == 200
    assert len(read_elements.json()) == 1
    assert read_elements.json()[0]["x"] == read_nodes.json()[0]["x"]
    assert read_elements.json()[0]["y"] == read_nodes.json()[0]["y"]

    updated_position = client.patch(
        f"/api/model/support-domain-elements/{element_id}/position",
        json={"x": 321, "y": 654},
    )
    assert updated_position.status_code == 200
    assert updated_position.json()["element_id"] == element_id
    assert updated_position.json()["x"] == 321
    assert updated_position.json()["y"] == 654

    synced_nodes = client.post(
        "/api/model/support-domain-diagram-nodes/sync",
        json={"model_id": model_id},
    )
    assert synced_nodes.status_code == 200
    assert len(synced_nodes.json()) == 1
    assert synced_nodes.json()[0]["element_id"] == element_id

    read_synced_nodes = client.get(f"/api/model/support-domain-diagram-nodes?model_id={model_id}")
    assert read_synced_nodes.status_code == 200
    assert len(read_synced_nodes.json()) == 1


def test_model_metadata_exposes_typed_relationship_catalogue(client) -> None:
    response = client.get("/api/model/metadata")
    assert response.status_code == 200

    relationship_kinds = response.json()["relationship_kinds"]
    relationship_by_key = {item["key"]: item for item in relationship_kinds}

    assert relationship_by_key["categorises"] == {
        "key": "categorises",
        "label": "Categorises",
        "description": "Grouping rules, outcomes, authorities, or roles.",
    }
    assert (
        relationship_by_key["has_threshold"]["description"]
        == "Linking DQ Rules to DQ Thresholds."
    )
    assert relationship_kinds[0]["key"] == "parent_child"
    assert relationship_kinds[1]["key"] == "categorises"


def test_support_domain_relationship_accepts_catalogue_kind(client) -> None:
    created_model = client.post(
        "/api/model/support-domain-models",
        json={
            "name": "Typed Relationship Model",
            "purpose": "Verifies typed relationship catalogue values.",
            "status": "draft",
        },
    )
    assert created_model.status_code == 200
    model_id = created_model.json()["support_domain_model_id"]

    source = client.post(
        "/api/model/support-domain-elements",
        json={"model_id": model_id, "name": "DQ Rule", "description": "", "status": "draft"},
    )
    target = client.post(
        "/api/model/support-domain-elements",
        json={"model_id": model_id, "name": "DQ Threshold", "description": "", "status": "draft"},
    )
    assert source.status_code == 200
    assert target.status_code == 200

    relationship = client.post(
        "/api/model/support-domain-relationships",
        json={
            "model_id": model_id,
            "source_element_id": source.json()["element_id"],
            "target_element_id": target.json()["element_id"],
            "relationship_kind": "has_threshold",
            "status": "draft",
        },
    )
    assert relationship.status_code == 200
    assert relationship.json()["relationship_kind"] == "has_threshold"


def test_hierarchy_node_reorder_persists(client) -> None:
    # Create model
    model = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Reorder Model", "purpose": "Test reorder", "owning_domain": "information", "status": "draft"},
    )
    assert model.status_code == 200
    model_id = model.json()["model_id"]

    # Create root
    root = client.post(
        "/api/model/hierarchy-nodes",
        json={"model_id": model_id, "name": "Root", "status": "draft"},
    )
    assert root.status_code == 200
    root_id = root.json()["node_id"]

    # Create two children (Alpha then Beta — default order 0,1)
    child_a = client.post(
        "/api/model/hierarchy-nodes",
        json={"model_id": model_id, "parent_node_id": root_id, "name": "Alpha", "status": "draft"},
    )
    child_b = client.post(
        "/api/model/hierarchy-nodes",
        json={"model_id": model_id, "parent_node_id": root_id, "name": "Beta", "status": "draft"},
    )
    assert child_a.status_code == 200
    assert child_b.status_code == 200
    child_b_id = child_b.json()["node_id"]

    # Reorder: move Beta to position 0 (before Alpha)
    resp = client.patch(
        f"/api/model/hierarchy-nodes/{child_b_id}/reorder",
        json={"new_parent_node_id": root_id, "position": 0},
    )
    assert resp.status_code == 200

    # Verify persisted order via hierarchy tree
    tree = client.get(f"/api/model/hierarchy-tree/{model_id}")
    assert tree.status_code == 200
    children = tree.json()[0]["children"]
    assert children[0]["name"] == "Beta"
    assert children[1]["name"] == "Alpha"


def test_hierarchy_and_support_domain_properties_use_separate_owner_keys(client) -> None:
    hierarchy_model = client.post(
        "/api/model/hierarchy-models",
        json={
            "name": "Property Scope Model",
            "purpose": "Verifies node type property ownership.",
            "owning_domain": "information",
            "status": "draft",
        },
    )
    assert hierarchy_model.status_code == 200
    hierarchy_model_id = hierarchy_model.json()["model_id"]

    node_type = client.post(
        "/api/model/hierarchy-nodes",
        json={"model_id": hierarchy_model_id, "name": "Asset", "status": "draft"},
    )
    assert node_type.status_code == 200
    node_type_id = node_type.json()["node_id"]

    node_type_property = client.post(
        f"/api/model/hierarchy-models/{hierarchy_model_id}/node-types/{node_type_id}/properties",
        json={
            "node_type_id": node_type_id,
            "name": "Serial Number",
            "description": "",
            "status": "draft",
        },
    )
    assert node_type_property.status_code == 200
    node_type_property_body = node_type_property.json()
    assert node_type_property_body["node_type_id"] == node_type_id
    assert "element_id" not in node_type_property_body

    support_domain_model = client.post(
        "/api/model/support-domain-models",
        json={
            "name": "Element Property Scope Model",
            "purpose": "Verifies support domain property ownership.",
            "status": "draft",
        },
    )
    assert support_domain_model.status_code == 200
    support_domain_model_id = support_domain_model.json()["support_domain_model_id"]

    element = client.post(
        "/api/model/support-domain-elements",
        json={
            "model_id": support_domain_model_id,
            "name": "DQ Rule",
            "description": "",
            "status": "draft",
        },
    )
    assert element.status_code == 200
    element_id = element.json()["element_id"]

    support_domain_property = client.post(
        f"/api/model/support-domain-model/{support_domain_model_id}/elements/{element_id}/properties",
        json={
            "element_id": element_id,
            "name": "Threshold",
            "description": "",
            "status": "draft",
        },
    )
    assert support_domain_property.status_code == 200
    support_domain_property_body = support_domain_property.json()
    assert support_domain_property_body["element_id"] == element_id
    assert "node_type_id" not in support_domain_property_body


def test_disabling_recursive_node_type_requires_confirmation_and_removes_recursive_instances(client) -> None:
    model = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Recursive Governance Model", "purpose": "Recursive warning test", "owning_domain": "information", "status": "active"},
    )
    assert model.status_code == 200
    model_id = model.json()["model_id"]

    root_type = client.post(
        "/api/model/hierarchy-nodes",
        json={"model_id": model_id, "name": "Root", "status": "active"},
    )
    assert root_type.status_code == 200
    root_type_id = root_type.json()["node_id"]

    recursive_type = client.post(
        "/api/model/hierarchy-nodes",
        json={
            "model_id": model_id,
            "parent_node_id": root_type_id,
            "name": "CH 2 Recursive",
            "display_name": "CH 2 Recursive",
            "description": "",
            "is_recursive": True,
            "status": "active",
        },
    )
    assert recursive_type.status_code == 200
    recursive_type_id = recursive_type.json()["node_id"]

    root_instance = client.post(f"/api/structure/node-instances/ensure-root?model_id={model_id}")
    assert root_instance.status_code == 200
    root_instance_id = root_instance.json()["node_id"]

    recursive_parent = client.post(
        "/api/structure/node-instances",
        json={
            "model_id": model_id,
            "node_type_id": recursive_type_id,
            "name": "CH 2 instance",
            "parent_node_id": root_instance_id,
        },
    )
    assert recursive_parent.status_code == 201
    recursive_parent_id = recursive_parent.json()["node"]["node_id"]

    recursive_child = client.post(
        "/api/structure/node-instances",
        json={
            "model_id": model_id,
            "node_type_id": recursive_type_id,
            "name": "CH 2 recursive child",
            "parent_node_id": recursive_parent_id,
        },
    )
    assert recursive_child.status_code == 201
    recursive_child_id = recursive_child.json()["node"]["node_id"]

    impact = client.get(f"/api/model/hierarchy-nodes/{recursive_type_id}/recursive-disable-impact")
    assert impact.status_code == 200
    impact_body = impact.json()
    assert impact_body["model_id"] == model_id
    assert impact_body["node_id"] == recursive_type_id
    assert impact_body["node_name"] == "CH 2 Recursive"
    assert impact_body["affected_relationship_count"] >= 1
    assert impact_body["affected_instance_count"] >= 1
    assert any("CH 2 recursive child" in path for path in impact_body["affected_instance_paths"])

    blocked_update = client.put(
        f"/api/model/hierarchy-nodes/{recursive_type_id}",
        json={
            "model_id": model_id,
            "parent_node_id": root_type_id,
            "name": "CH 2 Recursive",
            "display_name": "CH 2 Recursive",
            "description": "",
            "is_recursive": False,
            "status": "active",
        },
    )
    assert blocked_update.status_code == 400

    confirmed_update = client.put(
        f"/api/model/hierarchy-nodes/{recursive_type_id}",
        json={
            "model_id": model_id,
            "parent_node_id": root_type_id,
            "name": "CH 2 Recursive",
            "display_name": "CH 2 Recursive",
            "description": "",
            "is_recursive": False,
            "confirm_recursive_removal": True,
            "status": "active",
        },
    )
    assert confirmed_update.status_code == 200
    assert confirmed_update.json()["is_recursive"] is False

    nodes_after = client.get(f"/api/structure/node-instances?model_id={model_id}")
    assert nodes_after.status_code == 200
    remaining_ids = {item["node_id"] for item in nodes_after.json()["items"]}
    assert recursive_parent_id in remaining_ids
    assert recursive_child_id not in remaining_ids
