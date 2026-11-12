"""
Deleting a rule from the Rule Workspace.

A rule in use — attached to a node instance in SWS, or chosen in a Discover
session — is a warning, not a lock: without `force=true` the delete is refused
(409) and says where the rule is used; with it, the rule is deleted. Either way
it goes together with its configurations, and its version history is kept.
"""
from fastapi.testclient import TestClient

from app.dependencies import get_database_url
from shared.db import get_connection
from tests.test_discover_workspace import _new_session
from tests.test_governed_rules_api import _asset_properties, _configuration, _definition

RULES = "/api/rules"


def _count(sql: str, *params) -> int:
    with get_connection(get_database_url()) as conn:
        return int(dict(conn.execute(sql, params).fetchone())["n"])


def test_a_rule_nobody_uses_is_deleted_with_its_own_configuration(client: TestClient) -> None:
    rule = _definition(client, "Value is one of an approved list")
    rule_id = rule["rule_definition_id"]
    _configuration(client, rule_id, "Valid Voltage", parameters={"allowed_values": ["66kV"]})

    usage = client.get(f"{RULES}/{rule_id}/usage").json()
    assert usage["in_use"] is False
    assert usage["node_instances"]["total"] == 0 and usage["discover_sessions"]["total"] == 0

    assert client.delete(f"{RULES}/{rule_id}").status_code == 204
    # No configuration (or its history) is left behind pointing at nothing.
    assert _count("SELECT COUNT(*) AS n FROM rule_configuration WHERE rule_definition_id = %s", rule_id) == 0
    assert _count(
        "SELECT COUNT(*) AS n FROM rule_configuration_version WHERE rule_definition_id = %s", rule_id
    ) == 0
    assert client.get(f"{RULES}/{rule_id}").status_code == 404


def test_a_rule_attached_to_a_node_instance_is_deleted_only_once_confirmed(client: TestClient) -> None:
    _, properties = _asset_properties(client)
    rule = _definition(client, "Value is one of an approved list")
    rule_id = rule["rule_definition_id"]
    configuration = _configuration(client, rule_id, "Valid Voltage", parameters={"allowed_values": ["66kV"]})
    linked = client.post(
        f"/api/structure/node-instances/{properties['Transformer']}/rules",
        json={"rule_configuration_id": configuration["rule_configuration_id"]},
    )
    assert linked.status_code == 201, linked.text

    usage = client.get(f"{RULES}/{rule_id}/usage").json()
    assert usage["in_use"] is True
    assert usage["node_instances"]["total"] == 1
    assert usage["node_instances"]["items"][0]["id"] == properties["Transformer"]

    # Unconfirmed: refused, with where it is used, and nothing removed.
    refused = client.delete(f"{RULES}/{rule_id}")
    assert refused.status_code == 409
    assert "in use by 1 node instance" in refused.json()["detail"]
    assert client.get(f"{RULES}/{rule_id}").status_code == 200
    assert client.get(f"/api/structure/node-instances/{properties['Transformer']}/rules").json()["total"] == 1

    # Confirmed: deleted. The attachment goes with the configuration; the
    # rule's version history stays, so what it was can still be traced.
    assert client.delete(f"{RULES}/{rule_id}", params={"force": "true"}).status_code == 204
    assert client.get(f"{RULES}/{rule_id}").status_code == 404
    assert client.get(f"/api/structure/node-instances/{properties['Transformer']}/rules").json()["total"] == 0
    assert _count("SELECT COUNT(*) AS n FROM rule_configuration WHERE rule_definition_id = %s", rule_id) == 0
    assert _count("SELECT COUNT(*) AS n FROM rule_definition_version WHERE rule_definition_id = %s", rule_id) >= 1


def test_a_rule_chosen_in_a_discover_session_is_deleted_only_once_confirmed(client: TestClient) -> None:
    rule = _definition(client, "Asset ID must be filled in")
    rule_id = rule["rule_definition_id"]
    session_id = _new_session(client, "Switch review")
    with get_connection(get_database_url()) as conn:
        # What attaching it from the library writes: a session copy and the session's link to it.
        conn.execute(
            "INSERT INTO governed_rule (rule_id, rule_kind, code, name, check_type, owner_session_id,"
            " source_rule_definition_id, created_at, updated_at)"
            " VALUES ('gr_in_use', 'dq', 'GR-IN-USE-1', %s, 'mandatory', %s, %s, NOW(), NOW())",
            (rule["name"], session_id, rule_id),
        )
        conn.execute(
            "INSERT INTO discovery_rule_configuration (configuration_id, session_id, rule_id, is_enabled,"
            " created_at, updated_at) VALUES ('rc_in_use', %s, 'gr_in_use', TRUE, NOW(), NOW())",
            (session_id,),
        )

    usage = client.get(f"{RULES}/{rule_id}/usage").json()
    assert usage["in_use"] is True
    assert usage["discover_sessions"] == {"total": 1, "items": [{"id": session_id, "name": "Switch review"}]}

    refused = client.delete(f"{RULES}/{rule_id}")
    assert refused.status_code == 409
    assert "1 Discover session" in refused.json()["detail"]
    assert client.get(f"{RULES}/{rule_id}").status_code == 200

    # Confirmed: deleted, and the session keeps its own copy of the rule.
    assert client.delete(f"{RULES}/{rule_id}", params={"force": "true"}).status_code == 204
    assert client.get(f"{RULES}/{rule_id}").status_code == 404
    assert _count("SELECT COUNT(*) AS n FROM governed_rule WHERE rule_id = 'gr_in_use'") == 1
    assert _count("SELECT COUNT(*) AS n FROM discovery_rule_configuration WHERE configuration_id = 'rc_in_use'") == 1


def test_usage_of_an_unknown_rule_is_404(client: TestClient) -> None:
    assert client.get(f"{RULES}/rd_nothing/usage").status_code == 404
