"""Source application context: Application → Discover table, kept apart from Mapping."""

from fastapi.testclient import TestClient

from tests.test_discover_workspace import (
    API,
    SWITCHES,
    _import_now,
    _map_first_column_of_each_table,
    _new_session,
    _upload,
    _workbook,
)


def _applications_model(client: TestClient):
    """An Active hierarchy model 'Applications' with GIS, SAP and an Archived one."""
    model = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Applications", "purpose": "Source systems", "owning_domain": "information", "status": "active"},
    )
    assert model.status_code == 200, model.text
    model_id = model.json()["model_id"]
    type_id = "nt_application_" + model_id[-6:]

    from app.dependencies import get_database_url
    from shared.db import get_connection

    ids = {}
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description, status, created_at, updated_at)"
            " VALUES (%s,%s,'Application','','active',NOW(),NOW())",
            (type_id, model_id),
        )
        for name, status in (("GIS", "active"), ("SAP", "active"), ("Legacy", "retired")):
            node_id = "app_" + name.lower()
            conn.execute(
                "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, node_type_id, name, status,"
                " created_at, updated_at) VALUES (%s,%s,%s,%s,%s,NOW(),NOW())",
                (node_id, model_id, type_id, name, status),
            )
            ids[name] = node_id
    return model_id, ids


def _tables(client: TestClient, session_id: str):
    return {f["original_filename"]: f["source_file_id"] for f in client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]}


def _put(client, session_id, source_file_id, model_id, instance_id, confirm=False):
    return client.put(
        f"{API}/sessions/{session_id}/source-files/{source_file_id}/source-application",
        json={"model_kind": "hierarchy", "model_id": model_id, "instance_id": instance_id, "confirm": confirm},
    )


def test_each_table_keeps_its_own_application(client: TestClient):
    model_id, apps = _applications_model(client)
    session_id = _new_session(client)
    _upload(client, session_id, "gis_hv.csv", SWITCHES)
    _upload(client, session_id, "gis_export.xlsx", _workbook({"Switches": [["Id"], ["S1"]], "Poles": [["Id"], ["P1"]]}))
    _upload(client, session_id, "sap_assets.csv", SWITCHES)
    _import_now(client, session_id)
    tables = _tables(client, session_id)
    assert len(tables) == 4

    # Nothing is inferred from the file names.
    listed = client.get(f"{API}/sessions/{session_id}/source-applications").json()["items"]
    assert [item["application"] for item in listed] == [None] * 4

    for name, table_id in tables.items():
        app = apps["SAP"] if name.startswith("sap") else apps["GIS"]
        response = _put(client, session_id, table_id, model_id, app)
        assert response.status_code == 200, response.text

    listed = {item["source_name"]: item for item in client.get(f"{API}/sessions/{session_id}/source-applications").json()["items"]}
    assert listed["gis_hv.csv"]["application"]["instance_name"] == "GIS"
    assert listed["gis_export.xlsx — Poles"]["application"]["instance_name"] == "GIS"
    assert listed["gis_export.xlsx — Switches"]["application"]["instance_name"] == "GIS"
    assert listed["sap_assets.csv"]["application"]["instance_name"] == "SAP"
    assert listed["sap_assets.csv"]["application"]["model_name"] == "Applications"
    assert listed["sap_assets.csv"]["application"]["instance_type_name"] == "Application"



def test_only_valid_application_instances_are_accepted(client: TestClient):
    model_id, apps = _applications_model(client)
    session_id = _new_session(client)
    _upload(client, session_id, "gis_hv.csv", SWITCHES)
    _import_now(client, session_id)
    table_id = next(iter(_tables(client, session_id).values()))

    assert _put(client, session_id, table_id, model_id, apps["Legacy"]).status_code == 400  # Archived
    assert _put(client, session_id, table_id, model_id, "nope").status_code == 404
    other = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Other", "purpose": "x", "owning_domain": "information", "status": "active"},
    ).json()["model_id"]
    assert _put(client, session_id, table_id, other, apps["GIS"]).status_code == 400  # not in that model
    draft = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Draft Apps", "purpose": "x", "owning_domain": "information", "status": "draft"},
    ).json()["model_id"]
    assert _put(client, session_id, table_id, draft, apps["GIS"]).status_code == 400  # model not Active
    assert _put(client, session_id, "missing", model_id, apps["GIS"]).status_code == 404


def test_changing_it_after_mapping_needs_confirmation(client: TestClient):
    model_id, apps = _applications_model(client)
    session_id = _new_session(client)
    _upload(client, session_id, "gis_hv.csv", SWITCHES)
    _import_now(client, session_id)
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    table_id = files[0]["source_file_id"]

    assert _put(client, session_id, table_id, model_id, apps["GIS"]).status_code == 200
    _map_first_column_of_each_table(client, session_id, files)

    refused = _put(client, session_id, table_id, model_id, apps["SAP"])
    assert refused.status_code == 409
    assert refused.json()["detail"]["dependents"]["mappings"] == 1
    assert client.get(f"{API}/sessions/{session_id}/source-files/{table_id}/source-application").json()["application"]["instance_name"] == "GIS"

    changed = _put(client, session_id, table_id, model_id, apps["SAP"], confirm=True)
    assert changed.status_code == 200, changed.text
    assert changed.json()["application"]["instance_name"] == "SAP"
    # The mapping is untouched: provenance and meaning are separate.
    assert changed.json()["dependents"]["mappings"] == 1

    assert client.delete(f"{API}/sessions/{session_id}/source-files/{table_id}/source-application").status_code == 409
    cleared = client.delete(
        f"{API}/sessions/{session_id}/source-files/{table_id}/source-application", params={"confirm": True}
    )
    assert cleared.status_code == 200
    assert cleared.json()["application"] is None

    audit = client.get(f"{API}/sessions/{session_id}/audit", params={"limit": 500}).json()
    events = audit if isinstance(audit, list) else audit.get("items", audit.get("events", []))
    actions = {e["action"] for e in events}
    assert {"source_application.set", "source_application.change", "source_application.clear"} <= actions


def test_it_goes_with_its_table(client: TestClient):
    model_id, apps = _applications_model(client)
    session_id = _new_session(client)
    _upload(client, session_id, "gis_hv.csv", SWITCHES)
    _import_now(client, session_id)
    table_id = next(iter(_tables(client, session_id).values()))
    assert _put(client, session_id, table_id, model_id, apps["GIS"]).status_code == 200

    removed = client.delete(f"{API}/sessions/{session_id}/uploads", params={"filename": "gis_hv.csv"})
    assert removed.status_code in (200, 204), removed.text
    assert client.get(f"{API}/sessions/{session_id}/source-applications").json()["items"] == []
