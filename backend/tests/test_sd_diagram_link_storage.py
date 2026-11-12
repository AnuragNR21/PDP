"""A Support Domain model's diagram is stored in the
support_domain_element_instance_relationship_diagram* combo: the diagram, its
nodes (card positions), its edges (drawn links) and its shapes."""

from app.dependencies import get_database_url
from shared.db import get_connection
from tests.test_sd_element_relationship_instances_api import _link, _setup

PREFIX = "support_domain_element_instance_relationship_diagram"
DIAGRAMS = f"{PREFIX}s"
NODES = f"{PREFIX}_nodes"
EDGES = f"{PREFIX}_edges"
SHAPES = f"{PREFIX}_shapes"


def _count(conn, table, where="", params=()):
    return conn.execute(f"SELECT COUNT(*) AS n FROM {table} {where}", params).fetchone()["n"]


def test_the_four_tables_exist_and_no_name_carries_structure_or_sws(client):
    with get_connection(get_database_url()) as conn:
        names = {
            row["table_name"]
            for row in conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
            ).fetchall()
        }
    assert {DIAGRAMS, NODES, EDGES, SHAPES} <= names
    assert not any(name.startswith("sws_") for name in names)
    assert "support_domain_element_structure_link" not in names
    assert "support_domain_element_relationship_instance" not in names


def test_a_drawn_link_is_an_edge_of_the_models_diagram(client):
    s = _setup(client)
    # Looking creates nothing.
    assert client.get("/api/structure/sd-diagram", params={"model_id": s["model_id"]}).json()["diagram_id"] is None
    with get_connection(get_database_url()) as conn:
        assert _count(conn, DIAGRAMS) == 0

    created = _link(client, s["rel_id"], s["r1"], s["t1"])
    assert created.status_code == 201, created.text
    second = _link(client, s["rel_id"], s["r2"], s["t1"])
    assert second.status_code == 201, second.text
    link = created.json()
    assert link["support_domain_model_id"] == s["model_id"]

    # The new path and the old one answer the same.
    new = client.get("/api/structure/sd-diagram-links", params={"model_id": s["model_id"]}).json()
    old = client.get("/api/structure/element-instance-relationships", params={"model_id": s["model_id"]}).json()
    assert new == old and len(new) == 2

    with get_connection(get_database_url()) as conn:
        assert _count(conn, DIAGRAMS, "WHERE support_domain_model_id = %s", (s["model_id"],)) == 1
        edge = conn.execute(f"SELECT * FROM {EDGES} WHERE diagram_edge_id = %s", (link["relationship_instance_id"],)).fetchone()
        assert edge["diagram_id"] == link["diagram_id"]
        assert edge["edge_key"] == f"{s['rel_id']}:{s['r1']}:{s['t1']}"

    assert client.delete(f"/api/structure/sd-diagram-links/{link['relationship_instance_id']}").status_code == 204
    with get_connection(get_database_url()) as conn:
        assert _count(conn, EDGES) == 1


def test_card_positions_are_the_diagrams_nodes(client):
    s = _setup(client)
    saved = client.put(
        "/api/structure/sd-diagram/nodes",
        json={
            "support_domain_model_id": s["model_id"],
            "nodes": [
                {"item_id": s["rule"], "pos_x": 10, "pos_y": 20},
                {"item_id": s["threshold"], "pos_x": 400, "pos_y": 20},
                {"item_id": "not-a-type-of-this-model", "pos_x": 0, "pos_y": 0},
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    layout = client.get("/api/structure/sd-diagram", params={"model_id": s["model_id"]}).json()
    assert {(n["item_id"], n["pos_x"], n["pos_y"]) for n in layout["nodes"]} == {(s["rule"], 10, 20), (s["threshold"], 400, 20)}
    assert layout["shapes"] == []

    # A drawn link lands on the same diagram.
    link = _link(client, s["rel_id"], s["r1"], s["t1"]).json()
    assert link["diagram_id"] == layout["diagram_id"]

    # Resetting the layout forgets the positions, not the edges.
    reset = client.put("/api/structure/sd-diagram/nodes", json={"support_domain_model_id": s["model_id"], "nodes": []})
    assert reset.json()["nodes"] == []
    assert len(client.get("/api/structure/sd-diagram-links", params={"model_id": s["model_id"]}).json()) == 1

    assert client.put("/api/structure/sd-diagram/nodes", json={"support_domain_model_id": "nope", "nodes": []}).status_code == 400


def test_an_external_id_is_used_once(client):
    with get_connection(get_database_url()) as conn:
        row = conn.execute(
            "SELECT 1 FROM pg_indexes WHERE tablename = %s AND indexdef ILIKE '%%UNIQUE%%(external_id)%%'", (EDGES,)
        ).fetchone()
    assert row is not None


def test_deleting_the_model_removes_its_diagram(client):
    s = _setup(client)
    assert _link(client, s["rel_id"], s["r1"], s["t1"]).status_code == 201
    with get_connection(get_database_url()) as conn:
        conn.execute("DELETE FROM support_domain_model WHERE support_domain_model_id = %s", (s["model_id"],))
        assert _count(conn, DIAGRAMS) == 0 and _count(conn, EDGES) == 0
