import os

from fastapi.testclient import TestClient

from shared.db import get_connection, utc_now_iso


def _seed_structure_import_context(db_url: str) -> dict[str, str]:
    now = utc_now_iso()
    with get_connection(db_url) as conn:
        conn.execute(
            """
            INSERT INTO hierarchy_model (model_id, name, purpose, owning_domain, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            ("hm_import", "Import Hierarchy", "Import testing", "data", "active", now, now),
        )
        conn.execute(
            """
            INSERT INTO hierarchy_model_node_type
                (node_type_id, model_id, name, display_name, description, status, created_at, updated_at, parent_node_type_id, sort_order)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s, %s, NULL, 0),
                (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
            """,
            (
                "nt_root",
                "hm_import",
                "Root",
                "Root",
                "root",
                "active",
                now,
                now,
                "nt_child",
                "hm_import",
                "Child",
                "Child",
                "child",
                "active",
                now,
                now,
                "nt_root",
            ),
        )
        conn.execute(
            """
            INSERT INTO structural_rule
                (rule_id, model_id, parent_node_type_id, child_node_type_id, relationship_kind, status, notes, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            ("rule_root_child", "hm_import", "nt_root", "nt_child", "parent_child", "active", "", now, now),
        )

        conn.execute(
            """
            INSERT INTO hierarchy_model_node_instance
                (node_instance_id, model_id, node_type_id, external_id, name, description, parent_node_id, sort_order, status, created_at, updated_at)
            VALUES
                (%s, %s, %s, %s, %s, %s, NULL, 0, %s, %s, %s),
                (%s, %s, %s, %s, %s, %s, %s, 1, %s, %s, %s)
            """,
            (
                "node_root",
                "hm_import",
                "nt_root",
                "ext-root",
                "Root Instance",
                "",
                "active",
                now,
                now,
                "node_existing",
                "hm_import",
                "nt_child",
                "ext-existing",
                "Existing Node",
                "",
                "node_root",
                "active",
                now,
                now,
            ),
        )

        conn.execute(
            """
            INSERT INTO support_domain_model
                (support_domain_model_id, name, purpose, description, status, sort_order, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, 0, %s, %s)
            """,
            ("sdm_import", "Import Support", "Import testing", "", "active", now, now),
        )
        conn.execute(
            """
            INSERT INTO support_domain_element_type
                (element_id, support_domain_model_id, parent_element_id, badge_store_id, name, display_name, badge_code, element_type, description, definition, status, sort_order, created_at, updated_at)
            VALUES (%s, %s, NULL, NULL, %s, %s, '', '', %s, '', %s, 0, %s, %s)
            """,
            ("et_rule", "sdm_import", "Rule", "Rule", "", "active", now, now),
        )
        conn.execute(
            """
            INSERT INTO support_domain_element_type
                (element_id, support_domain_model_id, parent_element_id, badge_store_id, name, display_name, badge_code, element_type, description, definition, status, sort_order, created_at, updated_at)
            VALUES (%s, %s, NULL, NULL, %s, %s, '', '', %s, '', %s, 1, %s, %s)
            """,
            ("et_policy", "sdm_import", "Policy", "Policy", "", "active", now, now),
        )
        conn.execute(
            """
            INSERT INTO support_domain_element_instance
                (instance_id, support_domain_model_id, element_type_id, external_id, name, description, status, sort_order, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 0, %s, %s)
            """,
            ("sd_existing", "sdm_import", "et_rule", "ext-sd-existing", "Existing SD", "", "active", now, now),
        )

    return {
        "root_node_id": "node_root",
        "existing_node_id": "node_existing",
        "existing_sd_id": "sd_existing",
    }


def test_structure_import_validate_and_commit(client: TestClient):
    db_url = os.environ["PDP_DATABASE_URL"]
    ids = _seed_structure_import_context(db_url)

    payload = {
        "payload": {
            "template_metadata": {"template": "governed-structure"},
            "load_hierarchy_node_instances": [
                {
                    "action": "CREATE",
                    "external_id": "ext-new-node",
                    "model_id": "hm_import",
                    "node_type_id": "nt_child",
                    "name": "Created Node",
                    "parent_pdp_system_id": ids["root_node_id"],
                },
                {
                    "action": "UPSERT",
                    "external_id": "ext-existing",
                    "model_id": "hm_import",
                    "node_type_id": "nt_child",
                    "name": "Existing Node Updated",
                    "parent_pdp_system_id": ids["root_node_id"],
                    "status": "retired",
                },
            ],
            "load_support_domain_elements": [
                {
                    "action": "CREATE",
                    "external_id": "ext-sd-new",
                    "support_domain_model_id": "sdm_import",
                    "element_type_id": "et_rule",
                    "name": "Created SD",
                },
                {
                    "action": "UPSERT",
                    "external_id": "ext-sd-existing",
                    "support_domain_model_id": "sdm_import",
                    "element_type_id": "et_rule",
                    "name": "Existing SD Updated",
                },
            ],
            "load_support_domain_element_relationships": [
                {
                    "action": "CREATE",
                    "support_domain_model_id": "sdm_import",
                    "source_element_type_id": "et_rule",
                    "target_element_type_id": "et_policy",
                    "relationship_type": "applies_to",
                }
            ],
        }
    }

    validate = client.post("/api/structure/imports/validate", json=payload)
    assert validate.status_code == 200
    validate_body = validate.json()
    assert validate_body["summary"]["rejected"] == 0
    assert validate_body["summary"]["accepted"] == 5
    assert any("Locked/system field 'status' is ignored." in row["warnings"] for row in validate_body["rows"])

    commit = client.post("/api/structure/imports/commit", json={"stage_id": validate_body["stage_id"]})
    assert commit.status_code == 200
    commit_body = commit.json()
    assert commit_body["committed"] == 5
    assert commit_body["failed"] == 0

    list_nodes = client.get("/api/structure/node-instances", params={"model_id": "hm_import"})
    assert list_nodes.status_code == 200
    node_names = {item["name"] for item in list_nodes.json()["items"]}
    assert "Created Node" in node_names
    assert "Existing Node Updated" in node_names

    list_elements = client.get("/api/structure/element-instances", params={"model_id": "sdm_import"})
    assert list_elements.status_code == 200
    element_names = {item["name"] for item in list_elements.json()}
    assert "Created SD" in element_names
    assert "Existing SD Updated" in element_names

    with get_connection(db_url) as conn:
        relationship = conn.execute(
            """
            SELECT relationship_type
            FROM support_domain_relationship
            WHERE support_domain_model_id = %s AND source_element_id = %s AND target_element_id = %s
            """,
            ("sdm_import", "et_rule", "et_policy"),
        ).fetchone()
    assert relationship is not None
    assert relationship["relationship_type"] == "applies_to"


def test_structure_import_rejects_duplicate_external_id_and_key_conflict(client: TestClient):
    db_url = os.environ["PDP_DATABASE_URL"]
    ids = _seed_structure_import_context(db_url)

    payload = {
        "payload": {
            "load_hierarchy_node_instances": [
                {
                    "action": "CREATE",
                    "external_id": "ext-dup",
                    "model_id": "hm_import",
                    "node_type_id": "nt_child",
                    "name": "Node One",
                    "parent_pdp_system_id": ids["root_node_id"],
                },
                {
                    "action": "CREATE",
                    "external_id": "ext-dup",
                    "model_id": "hm_import",
                    "node_type_id": "nt_child",
                    "name": "Node Two",
                    "parent_pdp_system_id": ids["root_node_id"],
                },
                {
                    "action": "CREATE",
                    "pdp_system_id": ids["existing_node_id"],
                    "external_id": "ext-root",
                    "model_id": "hm_import",
                    "node_type_id": "nt_child",
                    "name": "Node Three",
                    "parent_pdp_system_id": ids["root_node_id"],
                },
            ],
            "load_support_domain_elements": [],
        }
    }

    validate = client.post("/api/structure/imports/validate", json=payload)
    assert validate.status_code == 200
    body = validate.json()
    assert body["summary"]["accepted"] == 0
    assert body["summary"]["rejected"] == 3
    codes = {row["code"] for row in body["rows"]}
    assert "DUPLICATE_EXTERNAL_ID" in codes
    assert "MISMATCHED_KEYS" in codes


def test_structure_export_includes_instance_sections_and_excludes_projection_fields(client: TestClient):
    db_url = os.environ["PDP_DATABASE_URL"]
    _seed_structure_import_context(db_url)

    export_response = client.get("/api/structure/exports", params={"template_type": "all"})
    assert export_response.status_code == 200
    body = export_response.json()

    assert "Template_Metadata" in body
    assert "Load_Hierarchy_Node_Instances" in body
    assert "Load_Support_Domain_Elements" in body
    assert "Load_Support_Domain_Element_Relationships" in body

    hierarchy_rows = body["Load_Hierarchy_Node_Instances"]
    assert len(hierarchy_rows) >= 1
    assert "pdp_system_id" in hierarchy_rows[0]
    assert "hierarchy_path" in hierarchy_rows[0]
    assert "depth" in hierarchy_rows[0]

    forbidden_projection_keys = {
        "diagram_id",
        "diagram_node_instance_id",
        "view_id",
        "badge_color",
        "x",
        "y",
        "expanded",
    }
    assert forbidden_projection_keys.isdisjoint(set(hierarchy_rows[0].keys()))
