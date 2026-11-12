"""
The Impact workspace's Data quality results, read through a hub's properties.

impact_feedback_1.docx, requirement 4: for each selected hub, identify the
Discover quality-check results linked through its *relevant properties*,
confirmed source-column mappings and rule execution evidence — and distinguish
failed, passed, not assessed and configuration error, never presenting the
absence of a result as a pass.

A hub is whatever the reader put the hub icon on. Discover maps columns onto
*properties*, never onto a Transformer as such, so a Transformer's results are
the results of the properties it contains. Each result comes back with the path
from the hub to its property, so the canvas can draw the chain.

The Discover rows are written directly: running a real import and quality run
would test Discover, not the read this file is about.
"""
import json
import uuid

from fastapi.testclient import TestClient

from app.config import get_settings
from shared.db import get_connection, utc_now_iso

ENDPOINT = "/api/discover/structure-instances/quality-results"


# ── fixtures ─────────────────────────────────────────────────────────────────


def _db():
    return get_connection(get_settings().database_url)


def _hierarchy(client: TestClient) -> dict:
    """Transformer (an Asset) holding Voltage and Name; Switch holding Rating."""
    created = client.post(
        "/api/model/hierarchy-models",
        json={"name": f"Assets {uuid.uuid4().hex[:6]}", "purpose": "Impact tests.",
              "owning_domain": "information", "status": "active"},
    )
    assert created.status_code == 200, created.text
    model_id = created.json()["model_id"]
    types = client.get("/api/model/node-types", params={"model_id": model_id}).json()
    root = next(t for t in types if not t.get("parent_node_id"))["node_id"]

    def node_type(parent: str, name: str, **extra) -> str:
        made = client.post(
            "/api/model/hierarchy-nodes",
            json={"model_id": model_id, "parent_node_id": parent, "name": name,
                  "status": "active", **extra},
        )
        assert made.status_code == 200, made.text
        return made.json()["node_id"]

    asset_type = node_type(root, "Asset")
    property_type = node_type(asset_type, "Asset Property", is_property=True)

    def instance(type_id: str, name: str, parent: str | None = None) -> str:
        node_id = f"n_{uuid.uuid4().hex[:10]}"
        with _db() as conn:
            conn.execute(
                "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, "
                "node_type_id, name, parent_node_id, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, 'active', NOW(), NOW())",
                (node_id, model_id, type_id, name, parent),
            )
        return node_id

    transformer = instance(asset_type, "Transformer")
    switch = instance(asset_type, "Switch")
    return {
        "model_id": model_id,
        "transformer": transformer,
        "voltage": instance(property_type, "Voltage", transformer),
        "name": instance(property_type, "Name", transformer),
        "switch": switch,
        "rating": instance(property_type, "Rating", switch),
    }


def _configuration(client: TestClient, name: str) -> dict:
    definition = client.post(
        "/api/rules",
        json={"name": f"{name} check", "description": "", "category": "Data quality",
              "definition_kind": "builtin", "check_type": "mandatory", "parameters": {},
              "severity": "medium", "status": "active", "dimension": "completeness",
              "data_type": "any"},
    )
    assert definition.status_code == 201, definition.text
    created = client.post(
        "/api/rules/configurations",
        json={"rule_definition_id": definition.json()["rule_definition_id"], "name": name,
              "description": "", "parameters": {}, "severity": "", "status": "active",
              "reference_element_type_id": ""},
    )
    assert created.status_code == 201, created.text
    return created.json()


def _bind(node_id: str, configuration_id: str) -> None:
    """The property is subject to the configuration (Structure's link)."""
    now = utc_now_iso()
    with _db() as conn:
        conn.execute(
            "INSERT INTO node_instance_rule (property_rule_id, node_instance_id, "
            "rule_configuration_id, applicability, status, created_at, updated_at) "
            "VALUES (%s, %s, %s, 'required', 'active', %s, %s)",
            (f"pr_{uuid.uuid4().hex[:8]}", node_id, configuration_id, now, now),
        )


def _session(name: str) -> dict:
    """A Discover session with one dataset, as the quality read sees it."""
    session_id = f"sess_{uuid.uuid4().hex[:8]}"
    file_id = f"file_{uuid.uuid4().hex[:8]}"
    dataset_id = f"ds_{uuid.uuid4().hex[:8]}"
    now = utc_now_iso()
    with _db() as conn:
        conn.execute(
            "INSERT INTO discovery_session (session_id, active_source_file_id, name, source_name, "
            "status, created_at, updated_at) VALUES (%s, %s, %s, '', 'ready', %s, %s)",
            (session_id, file_id, name, now, now),
        )
        conn.execute(
            "INSERT INTO source_dataset (dataset_id, session_id, source_file_id, source_name, "
            "row_count, import_status, created_at) VALUES (%s, %s, %s, 'assets.csv', 10, 'imported', %s)",
            (dataset_id, session_id, file_id, now),
        )
    return {"session_id": session_id, "file_id": file_id, "dataset_id": dataset_id}


def _map(session: dict, column_name: str, target: str, state: str = "confirmed") -> str:
    column_id = f"col_{uuid.uuid4().hex[:8]}"
    now = utc_now_iso()
    with _db() as conn:
        conn.execute(
            "INSERT INTO source_column (column_id, session_id, source_file_id, dataset_id, "
            "column_name, ordinal, detected_type, sample_values_json, created_at) "
            "VALUES (%s, %s, %s, %s, %s, 0, 'text', '[]', %s)",
            (column_id, session["session_id"], session["file_id"], session["dataset_id"],
             column_name, now),
        )
        conn.execute(
            "INSERT INTO column_mapping (mapping_id, session_id, source_file_id, column_id, "
            "target_node_id, mapping_state, confidence, rationale, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, 1, 'test', %s, %s)",
            (f"map_{uuid.uuid4().hex[:8]}", session["session_id"], session["file_id"],
             column_id, target, state, now, now),
        )
    return column_id


def _run(session: dict, completed_at: str) -> str:
    run_id = f"qr_{uuid.uuid4().hex[:8]}"
    with _db() as conn:
        conn.execute(
            "INSERT INTO discovery_quality_run (quality_run_id, session_id, source_file_id, "
            "table_name, status, completed_at, created_at) "
            "VALUES (%s, %s, %s, 'assets.csv', 'completed', %s, %s)",
            (run_id, session["session_id"], session["file_id"], completed_at, completed_at),
        )
    return run_id


def _check(
    session: dict,
    run_id: str,
    target: str,
    *,
    status: str = "passed",
    observed: int = 0,
    total: int = 10,
    check_type: str = "governed_rule",
    detail: dict | None = None,
) -> str:
    check_id = f"qc_{uuid.uuid4().hex[:8]}"
    with _db() as conn:
        conn.execute(
            "INSERT INTO discovery_quality_check (quality_check_id, session_id, execution_id, "
            "column_name, target_node_id, target_name, check_type, status, observed_count, "
            "total_count, message, detail_json, source_file_id, quality_run_id, created_at) "
            "VALUES (%s, %s, 'exec', 'col', %s, '', %s, %s, %s, %s, 'm', %s, %s, %s, %s)",
            (check_id, session["session_id"], target, check_type, status, observed, total,
             json.dumps(detail or {}), session["file_id"], run_id, utc_now_iso()),
        )
    return check_id


def _governed_rule(session: dict, code: str, configuration_id: str) -> None:
    """The session's copy of a rule, which records the configuration it came from."""
    now = utc_now_iso()
    with _db() as conn:
        conn.execute(
            "INSERT INTO governed_rule (rule_id, rule_kind, code, name, check_type, "
            "owner_session_id, source_rule_configuration_id, created_at, updated_at) "
            "VALUES (%s, 'dq', %s, %s, 'mandatory', %s, %s, %s, %s)",
            (f"gr_{uuid.uuid4().hex[:8]}", code, code, session["session_id"],
             configuration_id, now, now),
        )


def _read(client: TestClient, item_ids: list[str], run_id: str = "") -> dict:
    response = client.post(ENDPOINT, json={"item_ids": item_ids, "run_id": run_id})
    assert response.status_code == 200, response.text
    return response.json()


# ── through the hub's properties ─────────────────────────────────────────────


def test_an_asset_hub_reads_the_results_of_the_properties_it_contains(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    run = _run(s, "2026-10-01T00:00:00+00:00")
    check = _check(s, run, h["voltage"], status="failed", observed=3)

    report = _read(client, [h["transformer"]])

    assert [c["quality_check_id"] for c in report["checks"]] == [check]
    link = next(l for l in report["links"] if l["node_id"] == h["voltage"])
    assert link["hub_id"] == h["transformer"]
    assert link["path"] == [h["transformer"], h["voltage"]], "the chain the canvas draws"


def test_a_property_hub_reads_its_own_results(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    run = _run(s, "2026-10-01T00:00:00+00:00")
    _check(s, run, h["voltage"])

    report = _read(client, [h["voltage"]])

    assert len(report["checks"]) == 1
    assert report["links"] == [{"hub_id": h["voltage"], "node_id": h["voltage"], "path": [h["voltage"]]}]


def test_a_model_hub_reaches_its_properties_through_the_roots(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    _check(s, _run(s, "2026-10-01T00:00:00+00:00"), h["voltage"])
    hub = f"model:{h['model_id']}"

    report = _read(client, [hub])

    link = next(l for l in report["links"] if l["node_id"] == h["voltage"])
    assert link["path"] == [hub, h["transformer"], h["voltage"]]


def test_a_governed_value_reaches_the_properties_it_is_joined_to(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    _check(s, _run(s, "2026-10-01T00:00:00+00:00"), h["voltage"])
    value = f"v_{uuid.uuid4().hex[:8]}"
    now = utc_now_iso()
    with _db() as conn:
        conn.execute(
            "INSERT INTO cross_model_relationship_type (relationship_type_id, name, "
            "source_model_type, target_model_type, status, created_at, updated_at) "
            "VALUES ('crt', 'governed_by', 'HIERARCHY_MODEL', 'SUPPORT_DOMAIN_MODEL', 'active', %s, %s) "
            "ON CONFLICT DO NOTHING",
            (now, now),
        )
        conn.execute(
            "INSERT INTO cross_model_relationship_instance (relationship_id, relationship_rule_id, "
            "source_instance_id, source_instance_type, target_instance_id, target_instance_type, "
            "status, created_at, updated_at) VALUES (%s, 'crt', %s, 'HIERARCHY_MODEL', %s, "
            "'SUPPORT_DOMAIN_MODEL', 'active', %s, %s)",
            (f"x_{uuid.uuid4().hex[:8]}", h["voltage"], value, now, now),
        )

    report = _read(client, [value])

    assert len(report["checks"]) == 1
    assert report["links"][0]["path"] == [value, h["voltage"]]


def test_a_sibling_assets_results_are_not_this_hubs(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "rating", h["rating"])
    _check(s, _run(s, "2026-10-01T00:00:00+00:00"), h["rating"])

    report = _read(client, [h["transformer"]])

    assert report["checks"] == []


# ── the four states ──────────────────────────────────────────────────────────


def test_a_rule_governance_expects_and_no_run_executed_is_not_assessed(client: TestClient) -> None:
    h = _hierarchy(client)
    unmapped = _configuration(client, "Name is populated")
    unrun = _configuration(client, "Voltage is approved")
    _bind(h["name"], unmapped["rule_configuration_id"])
    _bind(h["voltage"], unrun["rule_configuration_id"])
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    _run(s, "2026-10-01T00:00:00+00:00")

    report = _read(client, [h["transformer"]])

    by_target = {e["target_node_id"]: e for e in report["not_assessed"]}
    assert by_target[h["name"]]["reason"] == "not_mapped"
    assert by_target[h["voltage"]]["reason"] == "mapped_not_run"
    assert report["assessed"] is False, "nothing ran, so nothing passed"


def test_a_rule_that_ran_is_not_also_listed_as_not_assessed(client: TestClient) -> None:
    h = _hierarchy(client)
    configuration = _configuration(client, "Voltage is approved")
    _bind(h["voltage"], configuration["rule_configuration_id"])
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    _governed_rule(s, "G-0001", configuration["rule_configuration_id"])
    _check(s, _run(s, "2026-10-01T00:00:00+00:00"), h["voltage"], detail={"rule_code": "G-0001"})

    report = _read(client, [h["transformer"]])

    assert report["not_assessed"] == []
    check = report["checks"][0]
    assert check["rule_configuration_id"] == configuration["rule_configuration_id"]
    assert check["configuration_name"] == "Voltage is approved", "named as the Rule Workspace names it"


def test_a_configuration_error_is_flagged_as_one(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    _check(
        s,
        _run(s, "2026-10-01T00:00:00+00:00"),
        h["voltage"],
        status="warning",
        check_type="configuration_error",
        total=0,
        detail={"configuration_error": True, "rule_configuration_id": "cfg_x"},
    )

    check = _read(client, [h["transformer"]])["checks"][0]

    assert check["is_configuration_error"] is True
    assert check["rule_configuration_id"] == "cfg_x"


def test_only_confirmed_mappings_count(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "maybe voltage", h["voltage"], state="suggested")

    report = _read(client, [h["transformer"]])

    assert report["mappings"] == []


# ── runs are never mixed ─────────────────────────────────────────────────────


def test_each_datasets_newest_run_is_read_and_an_older_one_is_not(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    old = _run(s, "2026-09-01T00:00:00+00:00")
    new = _run(s, "2026-10-01T00:00:00+00:00")
    _check(s, old, h["voltage"], status="failed", observed=9)
    newest = _check(s, new, h["voltage"])

    report = _read(client, [h["transformer"]])

    assert [c["quality_check_id"] for c in report["checks"]] == [newest]
    assert report["run_ids"] == [new]
    assert {r["quality_run_id"] for r in report["runs"]} == {old, new}, "both offered to choose from"


def test_a_named_run_is_read_on_its_own(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    old = _run(s, "2026-09-01T00:00:00+00:00")
    new = _run(s, "2026-10-01T00:00:00+00:00")
    earlier = _check(s, old, h["voltage"], status="failed", observed=9)
    _check(s, new, h["voltage"])

    report = _read(client, [h["transformer"]], run_id=old)

    assert [c["quality_check_id"] for c in report["checks"]] == [earlier]
    assert report["run_id"] == old


def test_two_hubs_each_get_their_own_links(client: TestClient) -> None:
    h = _hierarchy(client)
    s = _session("January load")
    _map(s, "voltage", h["voltage"])
    _map(s, "rating", h["rating"])
    run = _run(s, "2026-10-01T00:00:00+00:00")
    _check(s, run, h["voltage"])
    _check(s, run, h["rating"])

    report = _read(client, [h["transformer"], h["switch"]])

    hubs_of = {}
    for link in report["links"]:
        hubs_of.setdefault(link["node_id"], set()).add(link["hub_id"])
    assert hubs_of[h["voltage"]] == {h["transformer"]}
    assert hubs_of[h["rating"]] == {h["switch"]}
