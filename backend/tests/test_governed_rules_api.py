"""
Rules reach a field through governance, or they do not reach it at all.

The chain under test, end to end:

    rule definition  -> rule configuration    (Rule Workspace)
    Asset Property   -> subject to            (Structure links the configuration)
    Asset Property   -> is governed by        (Structure links the approved values)
    source column    -> Asset Property        (Discover mapping)

The Discover Rules step walks that chain backwards. Two things it must never
do: fall back to the whole library when the chain is broken, and treat a
configuration whose approved values are missing as one that passes. The first
makes governance meaningless; the second makes it a lie.

Nothing in this chain is inherited. A configuration linked to one property says
nothing about the property beside it, and a vocabulary a property draws values
from carries no rules of its own.
"""
import json

from fastapi.testclient import TestClient

from app.config import get_settings
from shared.db import get_connection, utc_now_iso


# ── fixtures built through the API wherever one exists ───────────────────────

def _definition(client: TestClient, name: str, **extra) -> dict:
    payload = {
        "name": name,
        "description": "",
        "category": "Data quality",
        "definition_kind": "builtin",
        "check_type": "allowed_values",
        "parameters": {"allowed_values": ["placeholder"]},
        "severity": "medium",
        "status": "active",
        "dimension": "validity",
        "data_type": "any",
    }
    payload.update(extra)
    created = client.post("/api/rules", json=payload)
    assert created.status_code == 201, created.text
    return created.json()


def _configuration(client: TestClient, definition_id: str, name: str, **extra) -> dict:
    payload = {
        "rule_definition_id": definition_id,
        "name": name,
        "description": "",
        "parameters": {},
        "severity": "",
        "status": "active",
        "reference_element_type_id": "",
    }
    payload.update(extra)
    created = client.post("/api/rules/configurations", json=payload)
    assert created.status_code == 201, created.text
    return created.json()


def _approve(
    client: TestClient,
    configuration: dict,
    element_type_id: str,
    value_ids: list[str],
) -> dict:
    """
    Tell the rule which of its vocabulary's values it accepts.

    This is the one place an approved list is written. It belongs to the rule,
    not to the property the rule is attached to, so the same rule means the
    same thing wherever governance hangs it.
    """
    saved = client.put(
        f"/api/rules/configurations/{configuration['rule_configuration_id']}",
        json={
            "rule_definition_id": configuration["rule_definition_id"],
            "name": configuration["name"],
            "description": configuration.get("description", ""),
            "parameters": {},
            "severity": configuration.get("severity", ""),
            "status": "active",
            "reference_element_type_id": element_type_id,
            "reference_value_ids": list(value_ids),
        },
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


def _support_model(client: TestClient, name: str) -> str:
    created = client.post(
        "/api/model/support-domain-models",
        json={"name": name, "purpose": "Governed vocabulary for tests.", "status": "active"},
    )
    assert created.status_code == 200, created.text
    return created.json()["support_domain_model_id"]


def _element_type(client: TestClient, model_id: str, name: str) -> str:
    created = client.post(
        "/api/model/support-domain-elements",
        json={"model_id": model_id, "name": name, "status": "active"},
    )
    assert created.status_code == 200, created.text
    return created.json()["element_id"]


def _element_instance(client: TestClient, model_id: str, element_type_id: str, name: str) -> str:
    created = client.post(
        "/api/structure/element-instances",
        json={
            "support_domain_model_id": model_id,
            "element_type_id": element_type_id,
            "name": name,
            "status": "active",
        },
    )
    assert created.status_code == 201, created.text
    return created.json().get("instance", created.json())["instance_id"]


def _hierarchy_model(client: TestClient, name: str) -> tuple[str, str]:
    created = client.post(
        "/api/model/hierarchy-models",
        json={"name": name, "purpose": "Concepts for tests.",
              "owning_domain": "information", "status": "active"},
    )
    assert created.status_code == 200, created.text
    model_id = created.json()["model_id"]
    types = client.get("/api/model/node-types", params={"model_id": model_id}).json()
    root = next(t for t in types if not t.get("parent_node_id"))
    return model_id, root["node_id"]


def _node_type(client: TestClient, model_id: str, parent_id: str, name: str, **extra) -> str:
    payload = {"model_id": model_id, "parent_node_id": parent_id, "name": name, "status": "active"}
    payload.update(extra)
    created = client.post("/api/model/hierarchy-nodes", json=payload)
    assert created.status_code == 200, created.text
    return created.json()["node_id"]


def _cross_link(node_instance_id: str, element_instance_id: str) -> None:
    """
    The governed bridge. Written directly: the relationship-type plumbing has
    its own screens and its own tests, and threading them through here would
    test those rather than the resolution this file is about.
    """
    now = utc_now_iso()
    with get_connection(get_settings().database_url) as conn:
        conn.execute(
            "INSERT INTO cross_model_relationship_type "
            "(relationship_type_id, name, source_model_type, target_model_type, status, "
            "created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT DO NOTHING",
            ("crt_test", "governed_by", "HIERARCHY_MODEL", "SUPPORT_DOMAIN_MODEL",
             "active", now, now),
        )
        conn.execute(
            "INSERT INTO cross_model_relationship_instance "
            "(relationship_id, relationship_rule_id, source_instance_id, source_instance_type, "
            "target_instance_id, target_instance_type, status, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (f"cmi_{node_instance_id[-8:]}_{element_instance_id[-8:]}", "crt_test",
             node_instance_id, "HIERARCHY_MODEL",
             element_instance_id, "SUPPORT_DOMAIN_MODEL", "active", now, now),
        )


def _session_with_mapped_column(client: TestClient, column_name: str = "kv_rating"):
    """
    A session with one imported file and one column mapped to a fresh property.

    The mapping is written directly for the same reason the hierarchy is: the
    mapping endpoints belong to another feature, and what this file is about is
    what the Rules step resolves once a mapping exists.
    """
    import time
    import uuid

    created = client.post("/api/discover/sessions", json={"name": "Governed", "source_name": ""})
    assert created.status_code == 201, created.text
    session_id = created.json()["session"]["session_id"]

    uploaded = client.post(
        f"/api/discover/sessions/{session_id}/files/upload",
        params={"filename": "assets.csv"},
        content=f"asset_id,{column_name}\nA-1,66kV\nA-2,900kV\n".encode(),
    )
    assert uploaded.status_code == 201, uploaded.text

    client.post(f"/api/discover/sessions/{session_id}/import/run")
    deadline = time.time() + 180
    state = client.get(f"/api/discover/sessions/{session_id}/import/progress").json()
    while state["is_working"] and time.time() < deadline:
        time.sleep(0.2)
        state = client.get(f"/api/discover/sessions/{session_id}/import/progress").json()
    assert not state["is_working"], "the import never settled"

    model_id, root = _hierarchy_model(client, f"Assets {uuid.uuid4().hex[:6]}")
    node_type = _node_type(client, model_id, root, "Operating Voltage", is_property=True)

    node_instance_id = f"n_{uuid.uuid4().hex[:10]}"
    with get_connection(get_settings().database_url) as conn:
        conn.execute(
            "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, "
            "node_type_id, name, status, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, 'active', NOW(), NOW())",
            (node_instance_id, model_id, node_type, "Operating Voltage"),
        )
        column = conn.execute(
            "SELECT sc.column_id, sc.source_file_id FROM source_column sc "
            "JOIN discovery_source_file f ON f.source_file_id = sc.source_file_id "
            "WHERE f.session_id = %s AND sc.column_name = %s LIMIT 1",
            (session_id, column_name),
        ).fetchone()
        assert column is not None, "the column was never profiled"
        conn.execute(
            "INSERT INTO column_mapping (mapping_id, session_id, source_file_id, column_id, "
            "target_node_id, mapping_state, confidence, rationale, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, 'confirmed', 1, 'test', NOW(), NOW())",
            (f"map_{uuid.uuid4().hex[:8]}", session_id, column["source_file_id"],
             column["column_id"], node_instance_id),
        )
    return session_id, node_instance_id


# ── Rule Configuration ───────────────────────────────────────────────────────

def test_a_configuration_names_and_parameterises_a_definition(client: TestClient) -> None:
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Voltage",
        parameters={"allowed_values": ["66kV", "132kV", "220kV"]},
    )
    assert configuration["name"] == "Valid Voltage"
    assert configuration["parameters"]["allowed_values"] == ["66kV", "132kV", "220kV"]
    assert configuration["values_source"] == "fixed"
    # The code sits under the definition's, so a reader can see what it configures.
    assert configuration["code"].startswith(definition["code"])


def test_one_definition_carries_several_configurations(client: TestClient) -> None:
    """The point of the split: different values must not mean different definitions."""
    definition = _definition(client, "Value is one of an approved list")
    _configuration(client, definition["rule_definition_id"], "Valid Voltage",
                   parameters={"allowed_values": ["66kV", "132kV"]})
    _configuration(client, definition["rule_definition_id"], "Valid Operational Status",
                   parameters={"allowed_values": ["Active", "Retired"]})

    listed = client.get("/api/rules/configurations",
                        params={"rule_definition_id": definition["rule_definition_id"]})
    assert listed.status_code == 200
    assert {c["name"] for c in listed.json()["items"]} == {
        "Valid Voltage", "Valid Operational Status"
    }
    # And the library still holds exactly one definition.
    assert client.get("/api/rules").json()["total"] == 1


def test_a_configuration_can_take_its_values_from_a_vocabulary(client: TestClient) -> None:
    model_id = _support_model(client, "Asset Classification")
    voltage = _element_type(client, model_id, "Voltage Class")
    for name in ("66kV", "132kV", "220kV"):
        _element_instance(client, model_id, voltage, name)

    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Voltage",
        reference_element_type_id=voltage,
    )
    assert configuration["values_source"] == "vocabulary"
    # Resolved on read, never stored — so adding a voltage changes the rule.
    # The modeller's own ordering is kept: 66 / 132 / 220 reads as a scale,
    # where alphabetical would put 132 first and mean nothing.
    assert configuration["parameters"]["allowed_values"] == ["66kV", "132kV", "220kV"]
    assert configuration["resolved_from_vocabulary"] == ["66kV", "132kV", "220kV"]

    _element_instance(client, model_id, voltage, "330kV")
    again = client.get(f"/api/rules/configurations/{configuration['rule_configuration_id']}")
    assert "330kV" in again.json()["parameters"]["allowed_values"]


def test_a_check_with_no_value_list_cannot_point_at_a_vocabulary(client: TestClient) -> None:
    model_id = _support_model(client, "Asset Classification")
    voltage = _element_type(client, model_id, "Voltage Class")
    definition = _definition(client, "Value is present", check_type="mandatory", parameters={})

    refused = client.post("/api/rules/configurations", json={
        "rule_definition_id": definition["rule_definition_id"],
        "name": "Mandatory voltage",
        "reference_element_type_id": voltage,
    })
    assert refused.status_code == 400, refused.text
    assert "list of values" in refused.json()["detail"]


def test_a_configuration_keeps_a_version_history(client: TestClient) -> None:
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Voltage",
        parameters={"allowed_values": ["66kV"]},
    )
    assert configuration["version"] == 1

    updated = client.put(
        f"/api/rules/configurations/{configuration['rule_configuration_id']}",
        json={
            "rule_definition_id": definition["rule_definition_id"],
            "name": "Valid Voltage",
            "parameters": {"allowed_values": ["66kV", "132kV"]},
            "status": "active",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == 2

    history = client.get(
        f"/api/rules/configurations/{configuration['rule_configuration_id']}/versions"
    ).json()
    assert history["current_version"] == 2
    was = next(v for v in history["items"] if v["version"] == 1)
    assert json.loads(json.dumps(was["parameters"]))["allowed_values"] == ["66kV"]


def test_a_configuration_cannot_be_moved_to_another_definition(client: TestClient) -> None:
    first = _definition(client, "Value is one of an approved list")
    second = _definition(client, "Value is present", check_type="mandatory", parameters={})
    configuration = _configuration(client, first["rule_definition_id"], "Valid Voltage",
                                   parameters={"allowed_values": ["66kV"]})

    refused = client.put(
        f"/api/rules/configurations/{configuration['rule_configuration_id']}",
        json={
            "rule_definition_id": second["rule_definition_id"],
            "name": "Valid Voltage",
            "status": "active",
        },
    )
    assert refused.status_code == 400
    assert "different rule definition" in refused.json()["detail"]


# ── Structure binds a configuration to one Asset Property ────────────────────

def _property(
    client: TestClient, model_id: str, node_type_id: str, name: str, parent: str = ""
) -> str:
    """
    One Asset Property instance.

    Written directly for the same reason the mapping is: the hierarchy
    authoring endpoints have their own screens and their own tests, and
    threading them through here would test those rather than the binding this
    file is about.
    """
    import uuid

    node_instance_id = f"n_{uuid.uuid4().hex[:10]}"
    with get_connection(get_settings().database_url) as conn:
        conn.execute(
            "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, "
            "node_type_id, name, parent_node_id, status, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, 'active', NOW(), NOW())",
            (node_instance_id, model_id, node_type_id, name, parent or None),
        )
    return node_instance_id


def _manufacturers(client: TestClient) -> tuple[str, dict[str, str]]:
    """The Manufacturer vocabulary from the client's own worked example."""
    model_id = _support_model(client, "Asset Reference Data")
    manufacturer = _element_type(client, model_id, "Manufacturer")
    values = {
        name: _element_instance(client, model_id, manufacturer, name)
        for name in ("Tyree", "Wilson", "ABC Transformers", "Schneider Electric", "Civilmart")
    }
    return manufacturer, values


def _asset_properties(client: TestClient) -> tuple[str, dict[str, str]]:
    """Transformer, Switch and Pole, each with a Manufacturer property."""
    import uuid

    model_id, root = _hierarchy_model(client, f"Asset Information {uuid.uuid4().hex[:6]}")
    asset_type = _node_type(client, model_id, root, "Asset Type")
    prop_type = _node_type(client, model_id, asset_type, "Manufacturer", is_property=True)
    properties = {}
    for asset in ("Transformer", "Switch", "Pole"):
        parent = _property(client, model_id, asset_type, asset)
        properties[asset] = _property(client, model_id, prop_type, "Manufacturer", parent)
    return model_id, properties


def test_structure_makes_a_property_subject_to_a_configuration(client: TestClient) -> None:
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        parameters={"allowed_values": ["placeholder"]},
    )

    linked = client.post(
        f"/api/structure/node-instances/{properties['Transformer']}/rules",
        json={
            "rule_configuration_id": configuration["rule_configuration_id"],
            "applicability": "required",
            "notes": "Network standard.",
        },
    )
    assert linked.status_code == 201, linked.text

    listed = client.get(
        f"/api/structure/node-instances/{properties['Transformer']}/rules"
    ).json()
    assert listed["total"] == 1
    assert listed["required"] == 1
    assert listed["items"][0]["name"] == "Valid Reference Value"
    # Linking creates no second rule: the library is untouched.
    assert client.get("/api/rules/configurations").json()["total"] == 1


def test_the_property_beside_it_carries_nothing(client: TestClient) -> None:
    """
    The whole reason applicability binds at the property.

    Transformer Manufacturer and Switch Manufacturer are the same kind of
    thing under the same node type. Making one subject to a check must say
    nothing whatever about the other.
    """
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        parameters={"allowed_values": ["Tyree"]},
    )
    client.post(
        f"/api/structure/node-instances/{properties['Transformer']}/rules",
        json={"rule_configuration_id": configuration["rule_configuration_id"]},
    )

    assert client.get(
        f"/api/structure/node-instances/{properties['Transformer']}/rules"
    ).json()["total"] == 1
    for sibling in ("Switch", "Pole"):
        carried = client.get(
            f"/api/structure/node-instances/{properties[sibling]}/rules"
        ).json()
        assert carried["total"] == 0, f"{sibling} inherited a rule it was never given"


def test_linking_the_same_configuration_twice_corrects_it(client: TestClient) -> None:
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(client, definition["rule_definition_id"], "Valid Voltage",
                                   parameters={"allowed_values": ["66kV"]})
    target = properties["Transformer"]

    client.post(f"/api/structure/node-instances/{target}/rules", json={
        "rule_configuration_id": configuration["rule_configuration_id"],
        "applicability": "available",
    })
    again = client.post(f"/api/structure/node-instances/{target}/rules", json={
        "rule_configuration_id": configuration["rule_configuration_id"],
        "applicability": "required",
    })
    assert again.status_code == 201, again.text

    listed = client.get(f"/api/structure/node-instances/{target}/rules").json()
    assert listed["total"] == 1
    assert listed["items"][0]["applicability"] == "required"


def test_an_unknown_applicability_is_refused(client: TestClient) -> None:
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(client, definition["rule_definition_id"], "Valid Voltage",
                                   parameters={"allowed_values": ["66kV"]})
    refused = client.post(
        f"/api/structure/node-instances/{properties['Transformer']}/rules",
        json={
            "rule_configuration_id": configuration["rule_configuration_id"],
            "applicability": "mandatory-ish",
        },
    )
    assert refused.status_code == 400
    assert "applicability" in refused.json()["detail"]


def test_a_rule_the_library_holds_but_nobody_configured_can_be_linked(
    client: TestClient,
) -> None:
    """Linking a bare definition makes its default configuration first."""
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is present", check_type="mandatory", parameters={})
    assert client.get("/api/rules/configurations").json()["total"] == 0

    linked = client.post(
        f"/api/structure/node-instances/{properties['Transformer']}/rules",
        json={"rule_definition_id": definition["rule_definition_id"]},
    )
    assert linked.status_code == 201, linked.text
    assert linked.json()["rule_definition_id"] == definition["rule_definition_id"]
    assert client.get("/api/rules/configurations").json()["total"] == 1


# ── The approved list belongs to the rule ────────────────────────────────────

def test_one_rule_carries_one_approved_list_everywhere_it_is_attached(
    client: TestClient,
) -> None:
    """
    The decision this design turns on.

    `Valid Switch Manufacturer` accepts the same four names on Transformer, on
    Switch and on Pole, because it is one rule. An approved list that varied by
    the property it happened to be attached to would mean a result citing the
    rule could not be read without also knowing which property produced it —
    and two people reading the same rule would believe different things.

    A property that needs a narrower list gets its own rule, which is also what
    makes that narrowing visible in the library instead of buried under a
    property three screens away.
    """
    manufacturer, values = _manufacturers(client)
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        reference_element_type_id=manufacturer,
    )
    approved = ["Tyree", "Wilson", "ABC Transformers", "Schneider Electric"]
    _approve(client, configuration, manufacturer, [values[n] for n in approved])

    for asset in properties:
        client.post(f"/api/structure/node-instances/{properties[asset]}/rules",
                    json={"rule_configuration_id": configuration["rule_configuration_id"]})

    for asset in properties:
        listed = client.get(f"/api/structure/node-instances/{properties[asset]}/rules").json()
        rule = listed["items"][0]
        assert rule["readiness"] == "ready", asset
        assert sorted(rule["approved_values"]) == sorted(approved), asset
        assert sorted(rule["parameters"]["allowed_values"]) == sorted(approved), asset

    # Civilmart is in the vocabulary and is not approved by this rule.
    assert "Civilmart" not in rule["approved_values"]
    # And the library still holds exactly one rule.
    assert client.get("/api/rules/configurations").json()["total"] == 1


def test_a_rule_bound_to_a_whole_vocabulary_accepts_all_of_it(
    client: TestClient,
) -> None:
    """
    Ticking nothing means the whole vocabulary, not nothing.

    That is what binding a rule to a vocabulary meant before a subset could be
    stored, so rules written then keep accepting exactly what they accepted —
    and it is the only reading of "this rule checks against Manufacturer" that
    does not quietly reject every row.
    """
    manufacturer, values = _manufacturers(client)
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        reference_element_type_id=manufacturer,
    )
    client.post(f"/api/structure/node-instances/{properties['Switch']}/rules",
                json={"rule_configuration_id": configuration["rule_configuration_id"]})

    rule = client.get(
        f"/api/structure/node-instances/{properties['Switch']}/rules"
    ).json()["items"][0]
    assert rule["readiness"] == "ready"
    assert sorted(rule["approved_values"]) == sorted(values)


def test_a_reference_check_that_names_no_vocabulary_is_incomplete(client: TestClient) -> None:
    """
    Found on production, and the worst failure this step can produce.

    An approved-value configuration whose `reference_element_type_id` was never
    set used to be declared READY, because the test was "has it a vocabulary?"
    rather than "does it need one?". Having none, it fell through to whatever
    the configuration carried in its own parameters — on production a single
    value called "placeholder" — and measured 137,950 rows against it. A check
    that cannot say what it checks against must refuse to run, not invent a
    list.
    """
    _manufacturers(client)
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        # No reference_element_type_id, and a leftover parameter of its own.
        parameters={"allowed_values": ["placeholder"]},
    )
    client.post(f"/api/structure/node-instances/{properties['Switch']}/rules",
                json={"rule_configuration_id": configuration["rule_configuration_id"]})

    listed = client.get(f"/api/structure/node-instances/{properties['Switch']}/rules").json()
    rule = listed["items"][0]
    assert rule["readiness"] == "configuration_incomplete", rule
    assert listed["incomplete"] == 1
    # The stand-in never reaches the parameters the run would execute with.
    assert "allowed_values" not in rule["parameters"], rule["parameters"]
    assert rule["selected_by_default"] is False
    assert "which governed vocabulary" in rule["readiness_reason"]


def test_a_rule_whose_vocabulary_is_empty_is_incomplete(client: TestClient) -> None:
    """Zero eligible values is a configuration error, never an unrestricted pass."""
    model_id = _support_model(client, "Asset Reference Data")
    empty = _element_type(client, model_id, "Manufacturer")
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        reference_element_type_id=empty,
    )
    client.post(f"/api/structure/node-instances/{properties['Switch']}/rules",
                json={"rule_configuration_id": configuration["rule_configuration_id"]})

    listed = client.get(f"/api/structure/node-instances/{properties['Switch']}/rules").json()
    assert listed["incomplete"] == 1
    rule = listed["items"][0]
    assert rule["readiness"] == "configuration_incomplete"
    assert "Manufacturer" in rule["readiness_reason"]
    # Crucially: no value list at all, rather than an empty one that would
    # fail every row.
    assert "allowed_values" not in rule["parameters"]
    assert rule["approved_values"] == []


def test_values_from_another_vocabulary_cannot_be_approved(client: TestClient) -> None:
    """
    A tick that came from the wrong list is refused where it is made.

    Accepting it would put a Rated Capacity among the approved manufacturers,
    and the rule would then be measuring a column against a list nobody
    believes it is measuring it against.
    """
    manufacturer, _ = _manufacturers(client)
    capacity_model = _support_model(client, "Ratings")
    capacity = _element_type(client, capacity_model, "Rated Capacity")
    ten_kva = _element_instance(client, capacity_model, capacity, "10 kVA")

    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        reference_element_type_id=manufacturer,
    )
    refused = client.put(
        f"/api/rules/configurations/{configuration['rule_configuration_id']}",
        json={
            "rule_definition_id": configuration["rule_definition_id"],
            "name": configuration["name"],
            "description": "",
            "parameters": {},
            "severity": "",
            "status": "active",
            "reference_element_type_id": manufacturer,
            "reference_value_ids": [ten_kva],
        },
    )
    assert refused.status_code == 400, refused.text
    assert "Manufacturer" in refused.json()["detail"]


def test_choosing_the_values_narrows_what_the_rule_accepts(client: TestClient) -> None:
    manufacturer, values = _manufacturers(client)
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        reference_element_type_id=manufacturer,
    )
    target = properties["Switch"]
    client.post(f"/api/structure/node-instances/{target}/rules",
                json={"rule_configuration_id": configuration["rule_configuration_id"]})

    _approve(client, configuration, manufacturer, [values["Schneider Electric"]])

    rule = client.get(f"/api/structure/node-instances/{target}/rules").json()["items"][0]
    assert rule["readiness"] == "ready"
    assert rule["approved_values"] == ["Schneider Electric"]
    assert rule["parameters"]["allowed_values"] == ["Schneider Electric"]


def test_a_check_needing_no_reference_data_is_ready_at_once(client: TestClient) -> None:
    """Required Value and its kind carry their own parameters."""
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is present", check_type="mandatory", parameters={})
    configuration = _configuration(client, definition["rule_definition_id"], "Asset ID present")
    client.post(f"/api/structure/node-instances/{properties['Transformer']}/rules",
                json={"rule_configuration_id": configuration["rule_configuration_id"]})

    rule = client.get(
        f"/api/structure/node-instances/{properties['Transformer']}/rules"
    ).json()["items"][0]
    assert rule["reference_requirement"] == "none"
    assert rule["readiness"] == "ready"
    assert rule["readiness_reason"] == ""


def test_retiring_a_value_removes_it_from_the_approved_set(client: TestClient) -> None:
    """
    A value the business has withdrawn stops being accepted at once, without
    anybody editing the rule. That is the whole reason the list is a reference
    to a vocabulary rather than a copy of one.
    """
    manufacturer, values = _manufacturers(client)
    _, properties = _asset_properties(client)
    definition = _definition(client, "Value is one of an approved list")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Reference Value",
        reference_element_type_id=manufacturer,
    )
    target = properties["Transformer"]
    client.post(f"/api/structure/node-instances/{target}/rules",
                json={"rule_configuration_id": configuration["rule_configuration_id"]})
    _approve(client, configuration, manufacturer, [values["Tyree"], values["Wilson"]])

    # Retiring a value has its own screens in the Support Domain model; it is
    # written directly here so this test stays about resolution.
    with get_connection(get_settings().database_url) as conn:
        conn.execute(
            "UPDATE support_domain_element_instance SET status = 'retired' "
            "WHERE instance_id = %s",
            (values["Wilson"],),
        )

    rule = client.get(f"/api/structure/node-instances/{target}/rules").json()["items"][0]
    assert rule["approved_values"] == ["Tyree"]


# ── Discover resolves from the mapped property ───────────────────────────────

def _governed_field(client: TestClient, *, approve: bool = True):
    """
    A mapped column whose property is subject to one reference-based check.

    Returns (session_id, node_instance_id, configuration, element_type_id,
    values) so a test can vary the approved set.
    """
    session_id, node_instance_id = _session_with_mapped_column(client)
    model_id = _support_model(client, "Asset Classification")
    voltage = _element_type(client, model_id, "Voltage Class")
    values = {
        name: _element_instance(client, model_id, voltage, name)
        for name in ("66kV", "132kV", "220kV")
    }
    definition = _definition(client, "Value is one of an approved list")
    # Unapproved means the rule names a vocabulary that holds nothing: a rule
    # that cannot say what it accepts, which is the state the run must refuse
    # rather than guess at.
    empty = _element_type(client, model_id, "Unstated Voltage Class")
    configuration = _configuration(
        client, definition["rule_definition_id"], "Valid Voltage",
        reference_element_type_id=voltage if approve else empty,
    )
    client.post(f"/api/structure/node-instances/{node_instance_id}/rules", json={
        "rule_configuration_id": configuration["rule_configuration_id"],
        "applicability": "required",
    })
    if approve:
        configuration = _approve(
            client, configuration, voltage, [values["66kV"], values["132kV"]]
        )
    return session_id, node_instance_id, configuration, voltage, values


def test_a_field_is_offered_only_what_its_property_is_subject_to(client: TestClient) -> None:
    session_id, node_instance_id, configuration, _, _ = _governed_field(client)
    # A second configuration nobody linked to this property.
    other = _definition(client, "Value is present", check_type="mandatory", parameters={})
    _configuration(client, other["rule_definition_id"], "Asset ID present")

    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    assert field["total"] == 1
    assert field["items"][0]["rule_configuration_id"] == configuration["rule_configuration_id"]
    assert field["items"][0]["parameters"]["allowed_values"] == ["66kV", "132kV"]
    assert report["governed_fields"] == 1


def test_a_cross_model_link_alone_grants_nothing(client: TestClient) -> None:
    """
    The old design's path, now closed.

    A property related to a vocabulary member used to inherit that member's
    rules. It must now grant exactly nothing: applicability is only what has
    been asserted on the property.
    """
    session_id, node_instance_id = _session_with_mapped_column(client)
    model_id = _support_model(client, "Asset Classification")
    voltage = _element_type(client, model_id, "Voltage Class")
    sixty_six = _element_instance(client, model_id, voltage, "66kV")
    definition = _definition(client, "Value is one of an approved list")
    _configuration(client, definition["rule_definition_id"], "Valid Voltage",
                   reference_element_type_id=voltage)
    _cross_link(node_instance_id, sixty_six)

    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    assert field["total"] == 0
    assert "not subject to any rule configuration" in field["empty_reason"]


def test_a_property_with_no_rules_says_so_rather_than_falling_back(
    client: TestClient,
) -> None:
    session_id, node_instance_id = _session_with_mapped_column(client)
    definition = _definition(client, "Value is one of an approved list")
    _configuration(client, definition["rule_definition_id"], "Valid Voltage",
                   parameters={"allowed_values": ["66kV"]})

    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    assert field["total"] == 0
    assert field["items"] == []
    assert "Structure Workspace" in field["empty_reason"]
    assert report["ungoverned_fields"] >= 1


def test_required_rules_come_first_and_are_ticked(client: TestClient) -> None:
    session_id, node_instance_id, _, _, _ = _governed_field(client)
    other = _definition(client, "Value is present", check_type="mandatory", parameters={})
    spare = _configuration(client, other["rule_definition_id"], "Voltage present")
    client.post(f"/api/structure/node-instances/{node_instance_id}/rules", json={
        "rule_configuration_id": spare["rule_configuration_id"],
        "applicability": "available",
    })

    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    assert [i["applicability"] for i in field["items"]] == ["required", "available"]
    assert field["items"][0]["selected_by_default"] is True
    assert field["items"][1]["selected_by_default"] is False


def test_an_incomplete_rule_is_a_configuration_error_not_a_failure(
    client: TestClient,
) -> None:
    """
    Reported, explained, and kept apart from data-quality findings.

    A screen that showed this as a failing check would have somebody chasing
    the data when the governance is what is unfinished.
    """
    session_id, node_instance_id, configuration, _, _ = _governed_field(client, approve=False)

    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    assert field["total"] == 1
    assert field["runnable"] == 0
    assert field["required"] == 0
    assert len(field["configuration_errors"]) == 1
    error = field["configuration_errors"][0]
    assert error["rule_configuration_id"] == configuration["rule_configuration_id"]
    assert error["expected_reference_type_name"] == "Unstated Voltage Class"
    assert "none of its values are approved" in error["reason"]
    assert report["configuration_errors"] == 1
    # Not pre-ticked: a check that cannot run must not read as governance met.
    assert field["items"][0]["selected_by_default"] is False


def test_an_incomplete_rule_cannot_be_run(client: TestClient) -> None:
    session_id, node_instance_id, _, _, _ = _governed_field(client, approve=False)
    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)

    refused = client.put(
        f"/api/discover/sessions/{session_id}/rule-governance/fields/{field['column_id']}",
        json={"property_rule_ids": [field["items"][0]["property_rule_id"]]},
    )
    assert refused.status_code == 400, refused.text
    assert "cannot run on this field yet" in refused.json()["detail"]


def test_a_rule_outside_the_fields_governance_is_refused(client: TestClient) -> None:
    session_id, node_instance_id, _, _, _ = _governed_field(client)
    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)

    refused = client.put(
        f"/api/discover/sessions/{session_id}/rule-governance/fields/{field['column_id']}",
        json={"property_rule_ids": ["pr_not_a_real_link"]},
    )
    assert refused.status_code == 400
    assert "not carried by this field's governance" in refused.json()["detail"]


def _attachment(session_id: str, rule_configuration_id: str) -> dict | None:
    """
    The run evidence for one attached configuration, read where it is stored.

    Asserting through the Rules step would only prove the step agrees with
    itself; the point of the freeze is what is on disk.
    """
    with get_connection(get_settings().database_url) as conn:
        row = conn.execute(
            "SELECT g.default_parameters_json, g.source_rule_version, "
            "       g.source_rule_configuration_id, g.source_rule_configuration_version, "
            "       c.column_id, c.target_node_id "
            "FROM discovery_rule_configuration c "
            "JOIN governed_rule g ON g.rule_id = c.rule_id "
            "WHERE c.session_id = %s AND g.source_rule_configuration_id = %s",
            (session_id, rule_configuration_id),
        ).fetchone()
    if row is None:
        return None
    data = dict(row)
    data["parameters"] = json.loads(data.pop("default_parameters_json") or "{}")
    return data


def test_ticking_a_rule_freezes_the_values_and_both_versions(client: TestClient) -> None:
    """
    Execution evidence. A value revoked tomorrow must not change what this run
    measured today.
    """
    session_id, node_instance_id, configuration, voltage, values = _governed_field(client)
    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    rule = field["items"][0]

    applied = client.put(
        f"/api/discover/sessions/{session_id}/rule-governance/fields/{field['column_id']}",
        json={"property_rule_ids": [rule["property_rule_id"]]},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["added"] == 1

    evidence = _attachment(session_id, configuration["rule_configuration_id"])
    assert evidence is not None, "nothing was attached"
    assert evidence["parameters"]["allowed_values"] == ["66kV", "132kV"]
    assert str(evidence["source_rule_configuration_version"]) == str(configuration["version"])
    assert evidence["source_rule_version"] not in ("", None)
    # The property it was resolved against is on the record too.
    assert evidence["target_node_id"] == node_instance_id

    # Revoke one value on the rule; the attachment keeps what it resolved.
    _approve(client, configuration, voltage, [values["66kV"]])

    # Governance now says one value; the finished attachment still says two.
    live = client.get(
        f"/api/structure/node-instances/{node_instance_id}/rules"
    ).json()["items"][0]
    assert live["approved_values"] == ["66kV"]
    still = _attachment(session_id, configuration["rule_configuration_id"])
    assert still["parameters"]["allowed_values"] == ["66kV", "132kV"]


def test_re_ticking_a_rule_picks_up_the_governance_as_it_now_stands(
    client: TestClient,
) -> None:
    """
    The other half of the freeze.

    An attachment that has already run keeps what it measured. One that has not
    is an instruction, and re-ticking it must run what governance means today --
    the client's note requires reference data to be revalidated before
    execution, so carrying a stale approved set into the next run would be
    exactly the silent wrong answer the readiness check exists to prevent.
    """
    session_id, node_instance_id, configuration, voltage, values = _governed_field(client)
    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    rule = field["items"][0]
    path = f"/api/discover/sessions/{session_id}/rule-governance/fields/{field['column_id']}"

    client.put(path, json={"property_rule_ids": [rule["property_rule_id"]]})
    assert _attachment(session_id, configuration["rule_configuration_id"])[
        "parameters"
    ]["allowed_values"] == ["66kV", "132kV"]

    # Governance changes: the rule approves a third voltage.
    _approve(
        client, configuration, voltage,
        [values["66kV"], values["132kV"], values["220kV"]],
    )
    again = client.put(path, json={"property_rule_ids": [rule["property_rule_id"]]})
    assert again.status_code == 200, again.text
    assert again.json()["refreshed"] == 1
    assert again.json()["added"] == 0

    evidence = _attachment(session_id, configuration["rule_configuration_id"])
    assert evidence["parameters"]["allowed_values"] == ["66kV", "132kV", "220kV"]


def test_unticking_a_rule_detaches_it(client: TestClient) -> None:
    session_id, node_instance_id, configuration, _, _ = _governed_field(client)
    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    field = next(f for f in report["fields"] if f["target_node_id"] == node_instance_id)
    rule = field["items"][0]
    path = f"/api/discover/sessions/{session_id}/rule-governance/fields/{field['column_id']}"

    client.put(path, json={"property_rule_ids": [rule["property_rule_id"]]})
    assert _attachment(session_id, configuration["rule_configuration_id"]) is not None
    client.put(path, json={"property_rule_ids": []})
    assert _attachment(session_id, configuration["rule_configuration_id"]) is None


def test_an_unmapped_column_says_so(client: TestClient) -> None:
    session_id, _ = _session_with_mapped_column(client)
    report = client.get(
        f"/api/discover/sessions/{session_id}/rule-governance/fields"
    ).json()
    unmapped = [f for f in report["fields"] if not f["target_node_id"]]
    for field in unmapped:
        assert "not mapped" in field["empty_reason"]


# ── The client's acceptance table ────────────────────────────────────────────

def test_the_acceptance_table_from_the_governance_note(client: TestClient) -> None:
    """
    The seven expected results in the client's note, read off the resolved
    governance rather than off a quality run.

    One shared `Valid Reference Value` configuration and one `Required Value`
    configuration serve every property; their different governed-by links
    supply different approved sets, and that difference is the whole test.
    """
    manufacturer, manufacturers = _manufacturers(client)
    ratings_model = _support_model(client, "Ratings")
    capacity = _element_type(client, ratings_model, "Rated Capacity")
    capacities = {
        name: _element_instance(client, ratings_model, capacity, name)
        for name in ("10 kVA", "15 kVA", "25 kVA", "100 kVA", "200 kVA", "1000 kVA", "2000 kVA")
    }

    import uuid
    model_id, root = _hierarchy_model(client, f"Asset Information {uuid.uuid4().hex[:6]}")
    asset_type = _node_type(client, model_id, root, "Asset Type")
    man_type = _node_type(client, model_id, asset_type, "Manufacturer", is_property=True)
    cap_type = _node_type(client, model_id, asset_type, "Rated Capacity", is_property=True)

    transformer = _property(client, model_id, asset_type, "Transformer")
    switch = _property(client, model_id, asset_type, "Switch")
    pole = _property(client, model_id, asset_type, "Pole")
    properties = {
        "Transformer Manufacturer": _property(client, model_id, man_type, "Manufacturer",
                                              transformer),
        "Switch Manufacturer": _property(client, model_id, man_type, "Manufacturer", switch),
        "Pole Manufacturer": _property(client, model_id, man_type, "Manufacturer", pole),
        "Transformer Rated Capacity": _property(client, model_id, cap_type, "Rated Capacity",
                                                transformer),
    }

    membership_def = _definition(client, "Value is one of an approved list")
    required_def = _definition(client, "Value is present", check_type="mandatory", parameters={})
    required_value = _configuration(
        client, required_def["rule_definition_id"], "Required Value"
    )

    # Three asset types accept three different sets of manufacturers, so there
    # are three rules. One rule accepting different things in different places
    # is the thing this design refuses: a result citing it would be unreadable
    # without also knowing which property produced it.
    memberships = {
        "Transformer Manufacturer": (
            "Valid Transformer Manufacturer", manufacturer,
            [manufacturers[n] for n in
             ("Tyree", "Wilson", "ABC Transformers", "Schneider Electric")],
        ),
        "Switch Manufacturer": (
            "Valid Switch Manufacturer", manufacturer,
            [manufacturers["Schneider Electric"]],
        ),
        "Pole Manufacturer": (
            "Valid Pole Manufacturer", manufacturer, [manufacturers["Civilmart"]],
        ),
        "Transformer Rated Capacity": (
            "Valid Rated Capacity", capacity, list(capacities.values()),
        ),
    }
    for name, (rule_name, element_type_id, value_ids) in memberships.items():
        configuration = _configuration(
            client, membership_def["rule_definition_id"], rule_name,
            reference_element_type_id=element_type_id,
        )
        _approve(client, configuration, element_type_id, value_ids)
        node = properties[name]
        for config in (configuration, required_value):
            linked = client.post(f"/api/structure/node-instances/{node}/rules", json={
                "rule_configuration_id": config["rule_configuration_id"],
                "applicability": "required",
            })
            assert linked.status_code == 201, linked.text

    resolved = {}
    for name, node in properties.items():
        listed = client.get(f"/api/structure/node-instances/{node}/rules").json()
        assert listed["incomplete"] == 0, f"{name} is not ready: {listed['items']}"
        membership = next(
            i for i in listed["items"] if i["reference_requirement"] == "approved_values"
        )
        presence = next(
            i for i in listed["items"] if i["reference_requirement"] == "none"
        )
        assert presence["readiness"] == "ready"
        resolved[name] = set(membership["approved_values"])

    # Mapped property, source value, expected result -- the client's table.
    cases = [
        ("Transformer Manufacturer", "Tyree", True),
        ("Switch Manufacturer", "Tyree", False),
        ("Switch Manufacturer", "Schneider Electric", True),
        ("Pole Manufacturer", "Civilmart", True),
        ("Transformer Rated Capacity", "100 kVA", True),
        ("Transformer Rated Capacity", "50 kVA", False),
    ]
    for name, value, expected in cases:
        assert (value in resolved[name]) is expected, (
            f"{name} / {value}: expected membership {expected}, "
            f"approved set is {sorted(resolved[name])}"
        )

    # The blank row: Required Value handles it, membership skips it. Both
    # checks are present on the property and neither needs the other.
    transformer_manufacturer = client.get(
        f"/api/structure/node-instances/{properties['Transformer Manufacturer']}/rules"
    ).json()
    assert {i["check_type"] for i in transformer_manufacturer["items"]} == {
        "allowed_values", "mandatory"
    }
