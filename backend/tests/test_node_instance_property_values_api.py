"""Node Instance Property values: MWS defines the Property on the Node Type,
SWS stores each instance's value for it — and nothing more."""

from app.dependencies import get_database_url
from shared.db import get_connection

API = "/api/structure/node-instances"


def _setup(client):
    """Asset Type (Test Suite, active; Old Code, retired) under Asset Group (Owner, inheritable).
    Transformer and Switch are Asset Type instances."""
    model = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Props Model", "purpose": "x", "owning_domain": "information", "status": "active"},
    )
    assert model.status_code == 200, model.text
    model_id = model.json()["model_id"]
    with get_connection(get_database_url()) as conn:
        for type_id, name, parent in (("nt_group", "Asset Group", None), ("nt_type", "Asset Type", "nt_group"), ("nt_other", "Other", None)):
            conn.execute(
                "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description, status, parent_node_type_id, created_at, updated_at)"
                " VALUES (%s,%s,%s,'','active',%s,NOW(),NOW())",
                (type_id, model_id, name, parent),
            )
        for prop_id, type_id, name, status, inheritable in (
            ("p_suite", "nt_type", "Test Suite", "active", False),
            ("p_old", "nt_type", "Old Code", "retired", False),
            ("p_owner", "nt_group", "Owner", "active", True),
            ("p_private", "nt_group", "Group Only", "active", False),
            ("p_other", "nt_other", "Elsewhere", "active", False),
        ):
            conn.execute(
                "INSERT INTO hierarchy_model_node_type_property (property_id, node_type_id, name, description, status, inheritable, created_at, updated_at)"
                " VALUES (%s,%s,%s,'',%s,%s,NOW(),NOW())",
                (prop_id, type_id, name, status, inheritable),
            )
        for node_id, name, status in (("n_tx", "Transformer", "active"), ("n_sw", "Switch", "active"), ("n_arch", "Old Pole", "retired")):
            conn.execute(
                "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, node_type_id, name, status, created_at, updated_at)"
                " VALUES (%s,%s,'nt_type',%s,%s,NOW(),NOW())",
                (node_id, model_id, name, status),
            )
    return model_id


def _props(client, node_id):
    response = client.get(f"{API}/{node_id}/properties")
    assert response.status_code == 200, response.text
    return {row["property_name"]: row for row in response.json()}


def _set(client, node_id, prop_id, value):
    return client.put(f"{API}/{node_id}/properties/{prop_id}/value", json={"value": value})


def test_every_instance_shows_its_types_properties_with_origin_and_no_value_yet(client):
    _setup(client)
    for node_id in ("n_tx", "n_sw"):
        props = _props(client, node_id)
        assert set(props) == {"Test Suite", "Old Code", "Owner"}  # not Group Only (not inheritable), not Elsewhere
        assert props["Test Suite"]["origin"] == "defined" and props["Test Suite"]["source_node_type_name"] == "Asset Type"
        assert props["Owner"]["origin"] == "inherited" and props["Owner"]["inherited_from"] == "Asset Group"
        assert all(row["value"] is None for row in props.values())


def test_a_value_is_stored_per_instance_and_only_the_value(client):
    _setup(client)
    saved = _set(client, "n_tx", "p_suite", "  ABC  ")
    assert saved.status_code == 200, saved.text
    assert saved.json()["value"] == "ABC" and saved.json()["property_name"] == "Test Suite"
    assert _props(client, "n_tx")["Test Suite"]["value"] == "ABC"
    assert _props(client, "n_sw")["Test Suite"]["value"] is None  # its own value, not shared
    # An inherited property takes a value too.
    assert _set(client, "n_sw", "p_owner", "Network Ops").status_code == 200
    assert _props(client, "n_sw")["Owner"]["value"] == "Network Ops"
    # Updating replaces; an empty value clears.
    assert _set(client, "n_tx", "p_suite", "XYZ").json()["value"] == "XYZ"
    assert _set(client, "n_tx", "p_suite", "").json()["value"] is None
    # The definition never changed.
    with get_connection(get_database_url()) as conn:
        row = conn.execute("SELECT name, status FROM hierarchy_model_node_type_property WHERE property_id = 'p_suite'").fetchone()
        assert (row["name"], row["status"]) == ("Test Suite", "active")
        assert conn.execute("SELECT COUNT(*) AS n FROM hierarchy_model_node_type_property").fetchone()["n"] == 5


def test_no_value_for_a_property_the_type_does_not_define(client):
    _setup(client)
    for prop_id in ("p_other", "p_private", "nope"):
        refused = _set(client, "n_tx", prop_id, "x")
        assert refused.status_code == 400, refused.text
        assert "not defined on this node's type" in refused.json()["detail"]
    assert _set(client, "missing", "p_suite", "x").status_code == 404


def test_lifecycle_is_respected(client):
    _setup(client)
    retired_prop = _set(client, "n_tx", "p_old", "x")
    assert retired_prop.status_code == 400 and "Archived" in retired_prop.json()["detail"]
    archived_instance = _set(client, "n_arch", "p_suite", "x")
    assert archived_instance.status_code == 400 and "Archived" in archived_instance.json()["detail"]
    assert _set(client, "n_tx", "p_suite", "x" * 4001).status_code == 422


def test_values_go_with_their_instance_and_their_definition(client):
    _setup(client)
    assert _set(client, "n_tx", "p_suite", "ABC").status_code == 200
    assert _set(client, "n_sw", "p_suite", "DEF").status_code == 200
    with get_connection(get_database_url()) as conn:
        conn.execute("DELETE FROM hierarchy_model_node_instance WHERE node_instance_id = 'n_tx'")
        assert conn.execute("SELECT COUNT(*) AS n FROM node_instance_property_value").fetchone()["n"] == 1
        conn.execute("DELETE FROM hierarchy_model_node_type_property WHERE property_id = 'p_suite'")
        assert conn.execute("SELECT COUNT(*) AS n FROM node_instance_property_value").fetchone()["n"] == 0


def test_values_are_searchable(client):
    model_id = _setup(client)
    assert _set(client, "n_tx", "p_suite", "Suite-ZETA-9").status_code == 200
    body = client.get("/api/search", params={"q": "zeta"}).json()
    hit = next(i for g in body["groups"] for i in g["items"] if i["type"] == "node_property_value")
    assert hit["name"] == "Suite-ZETA-9" and hit["detail"] == "Test Suite of Transformer"
    assert hit["focus_id"] == "n_tx" and hit["model_id"] == model_id
