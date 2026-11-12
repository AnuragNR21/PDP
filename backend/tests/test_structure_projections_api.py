"""Node detail and the Structure Diagram / Matrix projections read today's link table."""

from app.dependencies import get_database_url
from shared.db import get_connection


def _model_with_nodes(client):
    model = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Projection Test", "purpose": "x", "owning_domain": "information", "status": "active"},
    )
    assert model.status_code == 200, model.text
    model_id = model.json()["model_id"]
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description, status, created_at, updated_at)"
            " VALUES ('nt_proj', %s, 'Asset', '', 'active', NOW(), NOW())",
            (model_id,),
        )
        conn.execute(
            "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, node_type_id, name, status, created_at, updated_at)"
            " VALUES ('n_root', %s, 'nt_proj', 'Root', 'active', NOW(), NOW())",
            (model_id,),
        )
        for node_id, name in (("n_a", "A"), ("n_b", "B")):
            conn.execute(
                "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, node_type_id, name, status, parent_node_id,"
                " created_at, updated_at) VALUES (%s, %s, 'nt_proj', %s, 'active', 'n_root', NOW(), NOW())",
                (node_id, model_id, name),
            )
        conn.execute(
            "INSERT INTO cross_model_relationship_type (relationship_type_id, name, status, created_at, updated_at)"
            " VALUES ('rt_feeds', 'Feeds', 'active', NOW(), NOW())"
        )
        conn.execute(
            "INSERT INTO cross_model_relationship_instance (relationship_id, relationship_rule_id, source_instance_id,"
            " source_instance_type, target_instance_id, target_instance_type, status, created_at)"
            " VALUES ('cmi_ab', 'rt_feeds', 'n_a', 'HIERARCHY_MODEL', 'n_b', 'HIERARCHY_MODEL', 'active', NOW())"
        )
    return model_id


def test_node_detail_lists_its_links(client):
    _model_with_nodes(client)
    detail = client.get("/api/structure/node-instances/n_a")
    assert detail.status_code == 200, detail.text
    assert [(r["relationship_id"], r["semantic_key"], r["target_node_id"]) for r in detail.json()["relationships"]] == [
        ("cmi_ab", "Feeds", "n_b")
    ]


def test_diagram_and_matrix_projections_answer(client):
    model_id = _model_with_nodes(client)
    diagram = client.get("/api/structure/projections/diagram", params={"model_id": model_id})
    assert diagram.status_code == 200, diagram.text
    edges = {(e["source_node_id"], e["target_node_id"], e["projection_kind"]) for e in diagram.json()["projection"]["edges"]}
    assert edges == {("n_root", "n_a", "hierarchy"), ("n_root", "n_b", "hierarchy"), ("n_a", "n_b", "relationship")}
    matrix = client.get("/api/structure/projections/matrix", params={"model_id": model_id})
    assert matrix.status_code == 200, matrix.text
