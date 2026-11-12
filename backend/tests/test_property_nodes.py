"""A property node holds a value, not a level of the hierarchy.

Nothing may be placed beneath one. The UI hides "Add Child" for such a type,
but the UI is a courtesy: these tests pin the three places that actually
refuse the write — a child node *type* under a property parent, a child node
*instance* under a property node, and turning a type that already has
children into a property after the fact.

Everything here builds its own model rather than leaning on the demo seed,
so the file stands on its own.
"""

from fastapi.testclient import TestClient


def _model(client: TestClient, name: str) -> str:
    created = client.post(
        "/api/model/hierarchy-models",
        json={
            "name": name,
            "purpose": "Verifies property node behaviour.",
            "owning_domain": "information",
            "status": "active",
        },
    )
    assert created.status_code == 200, created.text
    return created.json()["model_id"]


def _root(client: TestClient, model_id: str) -> dict:
    """The root node type a new hierarchy model is born with."""
    listed = client.get("/api/model/node-types", params={"model_id": model_id})
    assert listed.status_code == 200, listed.text
    roots = [item for item in listed.json() if not item.get("parent_node_id")]
    assert len(roots) == 1, listed.text
    return roots[0]


def _node_type(client: TestClient, model_id: str, name: str, **extra) -> dict:
    payload = {"model_id": model_id, "name": name, "status": "active"}
    payload.update(extra)
    created = client.post("/api/model/hierarchy-nodes", json=payload)
    assert created.status_code == 200, created.text
    return created.json()


def _types(client: TestClient, model_id: str) -> dict[str, dict]:
    listed = client.get("/api/model/node-types", params={"model_id": model_id})
    assert listed.status_code == 200, listed.text
    return {item["name"]: item for item in listed.json()}


# ── Model Workspace: node types ──────────────────────────────────────────────

def test_is_property_round_trips_through_create_and_read(client: TestClient) -> None:
    model_id = _model(client, "Property Round Trip Model")
    root = _root(client, model_id)
    created = _node_type(
        client, model_id, "Install Date", parent_node_id=root["node_id"], is_property=True
    )
    assert created["is_property"] is True

    by_name = _types(client, model_id)
    assert by_name["Install Date"]["is_property"] is True
    # The default must stay False, or every existing type becomes a leaf.
    assert by_name[root["name"]]["is_property"] is False


def test_child_node_type_under_a_property_parent_is_refused(client: TestClient) -> None:
    model_id = _model(client, "Property Parent Model")
    root = _root(client, model_id)
    prop = _node_type(
        client, model_id, "Install Date", parent_node_id=root["node_id"], is_property=True
    )

    refused = client.post(
        "/api/model/hierarchy-nodes",
        json={
            "model_id": model_id,
            "parent_node_id": prop["node_id"],
            "name": "Year",
            "status": "active",
        },
    )
    assert refused.status_code == 400, refused.text
    assert "property node" in refused.json()["detail"].lower()

    # The refusal wrote nothing.
    assert set(_types(client, model_id)) == {root["name"], "Install Date"}


def test_marking_a_type_with_children_as_property_is_refused(client: TestClient) -> None:
    model_id = _model(client, "Late Property Model")
    root = _root(client, model_id)
    material = _node_type(client, model_id, "Material", parent_node_id=root["node_id"])
    _node_type(client, model_id, "Steel", parent_node_id=material["node_id"])

    refused = client.put(
        f"/api/model/node-types/{material['node_id']}",
        json={
            "model_id": model_id,
            "parent_node_id": root["node_id"],
            "name": "Material",
            "status": "active",
            "is_property": True,
        },
    )
    assert refused.status_code == 400, refused.text
    assert "child" in refused.json()["detail"].lower()
    assert _types(client, model_id)["Material"]["is_property"] is False


def test_a_childless_type_can_be_marked_as_property_and_then_unmarked(client: TestClient) -> None:
    model_id = _model(client, "Toggle Property Model")
    root = _root(client, model_id)
    leaf = _node_type(client, model_id, "Install Date", parent_node_id=root["node_id"])

    body = {
        "model_id": model_id,
        "parent_node_id": root["node_id"],
        "name": "Install Date",
        "status": "active",
        "is_property": True,
    }
    marked = client.put(f"/api/model/node-types/{leaf['node_id']}", json=body)
    assert marked.status_code == 200, marked.text
    assert marked.json()["is_property"] is True

    unmarked = client.put(
        f"/api/model/node-types/{leaf['node_id']}", json={**body, "is_property": False}
    )
    assert unmarked.status_code == 200, unmarked.text
    assert unmarked.json()["is_property"] is False

    # Once it is an ordinary type again, children are allowed.
    child = client.post(
        "/api/model/hierarchy-nodes",
        json={
            "model_id": model_id,
            "parent_node_id": leaf["node_id"],
            "name": "Year",
            "status": "active",
        },
    )
    assert child.status_code == 200, child.text


# ── Structure Workspace: node instances ──────────────────────────────────────

def _structure_model(client: TestClient, name: str) -> tuple[str, dict, str]:
    """A hierarchy model, its root node type, and its root node instance."""
    model_id = _model(client, name)
    root_type = _root(client, model_id)
    root_instance = client.post(
        "/api/structure/node-instances/ensure-root", params={"model_id": model_id}
    )
    assert root_instance.status_code == 200, root_instance.text
    return model_id, root_type, root_instance.json()["node_id"]


def test_child_node_instance_under_a_property_node_is_refused(client: TestClient) -> None:
    """The structure workspace refuses it too — the model guard alone is not enough.

    Node types live in the Model Workspace; node *instances* are created in the
    Structure Workspace through a different service. A user who never opens the
    model editor must still be stopped.
    """
    model_id, root_type, root_node_id = _structure_model(client, "Property Instance Model")
    prop_type = _node_type(
        client, model_id, "Install Date", parent_node_id=root_type["node_id"], is_property=True
    )

    parent = client.post(
        "/api/structure/node-instances",
        json={
            "model_id": model_id,
            "node_type_id": prop_type["node_id"],
            "name": "Install Date",
            "parent_node_id": root_node_id,
        },
    )
    assert parent.status_code == 201, parent.text
    parent_id = parent.json()["node"]["node_id"]

    refused = client.post(
        "/api/structure/node-instances",
        json={
            "model_id": model_id,
            "node_type_id": prop_type["node_id"],
            "name": "Year",
            "parent_node_id": parent_id,
        },
    )
    assert refused.status_code == 400, refused.text
    assert "property node" in refused.json()["detail"].lower()

    children = client.get(f"/api/structure/tree/children/{parent_id}")
    assert children.status_code == 200
    assert children.json()["items"] == []


def test_instances_of_an_ordinary_type_still_accept_children(client: TestClient) -> None:
    """Regression guard: the property check must not refuse everything."""
    model_id, root_type, root_node_id = _structure_model(client, "Ordinary Instance Model")
    material = _node_type(client, model_id, "Material", parent_node_id=root_type["node_id"])
    steel = _node_type(client, model_id, "Steel", parent_node_id=material["node_id"])

    parent = client.post(
        "/api/structure/node-instances",
        json={
            "model_id": model_id,
            "node_type_id": material["node_id"],
            "name": "Material",
            "parent_node_id": root_node_id,
        },
    )
    assert parent.status_code == 201, parent.text
    parent_id = parent.json()["node"]["node_id"]

    child = client.post(
        "/api/structure/node-instances",
        json={
            "model_id": model_id,
            "node_type_id": steel["node_id"],
            "name": "Steel",
            "parent_node_id": parent_id,
        },
    )
    assert child.status_code == 201, child.text
