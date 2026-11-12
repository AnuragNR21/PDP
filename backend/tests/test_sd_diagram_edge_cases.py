"""Edge cases for the Support Domain diagram combo (diagrams / nodes / edges / shapes)."""

import threading

from app.dependencies import get_database_url
from shared.db import get_connection
from tests.test_sd_element_relationship_instances_api import _element, _instance, _link, _model, _relationship
from tests.test_sd_instance_relationship_round_trip_api import _commit, _links, _row, _setup, _validate

DIAGRAMS = "support_domain_element_instance_relationship_diagrams"
NODES = "support_domain_element_instance_relationship_diagram_nodes"
EDGES = "support_domain_element_instance_relationship_diagram_edges"


def _diagrams(model_id):
    with get_connection(get_database_url()) as conn:
        return [r["diagram_id"] for r in conn.execute(f"SELECT diagram_id FROM {DIAGRAMS} WHERE support_domain_model_id = %s", (model_id,)).fetchall()]


def _edge_keys(model_id):
    with get_connection(get_database_url()) as conn:
        return sorted(
            r["edge_key"]
            for r in conn.execute(
                f"SELECT e.edge_key FROM {EDGES} e JOIN {DIAGRAMS} d ON d.diagram_id = e.diagram_id WHERE d.support_domain_model_id = %s",
                (model_id,),
            ).fetchall()
        )


def test_an_import_into_a_model_without_a_diagram_creates_it(client):
    s = _setup(client)
    assert _diagrams(s["model_id"]) == []
    staged = _validate(client, links=[_row(s, external_id="EXT-A")])
    assert staged["summary"]["accepted"] == 1, staged
    assert _commit(client, staged["stage_id"])["committed"] == 1
    assert len(_diagrams(s["model_id"])) == 1
    assert _edge_keys(s["model_id"]) == [f"{s['works_for']}:{s['fred']}:{s['org1']}"]
    link = _links(client, s["model_id"])[0]
    assert link["external_id"] == "EXT-A" and link["diagram_id"] == _diagrams(s["model_id"])[0]


def test_instances_and_links_created_by_one_file_land_on_one_diagram(client):
    s = _setup(client)
    staged = _validate(
        client,
        elements=[{"action": "CREATE", "support_domain_model_id": s["model_id"], "element_type_id": s["org"], "name": "org2", "external_id": "ORG2"}],
        links=[_row(s, target_instance_id=None, target_instance_name="org2", target_external_id="ORG2")],
    )
    assert staged["summary"]["rejected"] == 0, staged["rows"]
    assert _commit(client, staged["stage_id"])["failed"] == 0
    assert len(_diagrams(s["model_id"])) == 1
    assert [l["target_instance_name"] for l in _links(client, s["model_id"])] == ["org2"]


def test_upsert_moves_an_edge_and_its_key_and_never_onto_another_edge(client):
    s = _setup(client)
    org2 = _instance(client, s["model_id"], s["org"], "org2")
    org3 = _instance(client, s["model_id"], s["org"], "org3")
    first = _link(client, s["works_for"], s["fred"], s["org1"]).json()
    assert _link(client, s["works_for"], s["fred"], org3).status_code == 201

    moved = _validate(client, links=[_row(s, action="UPSERT", pdp_system_id=first["relationship_instance_id"], target_instance_id=org2, target_instance_name="org2")])
    assert moved["summary"]["accepted"] == 1, moved["rows"]
    assert _commit(client, moved["stage_id"])["committed"] == 1
    assert _edge_keys(s["model_id"]) == sorted([f"{s['works_for']}:{s['fred']}:{org2}", f"{s['works_for']}:{s['fred']}:{org3}"])

    # Onto the pair another edge already has: refused, not a 500.
    clash = _validate(client, links=[_row(s, action="UPSERT", pdp_system_id=first["relationship_instance_id"], target_instance_id=org3, target_instance_name="org3")])
    assert clash["summary"]["rejected"] == 1
    assert len(_links(client, s["model_id"])) == 2


def test_mws_refuses_a_type_related_to_itself_so_no_such_edge_exists(client):
    model_id = _model(client, "Self Model")
    person = _element(client, model_id, "Person")
    refused = client.post(
        "/api/model/support-domain-relationships",
        json={"model_id": model_id, "source_element_id": person, "target_element_id": person, "relationship_kind": "reports_to", "status": "active"},
    )
    assert refused.status_code == 400
    assert _edge_keys(model_id) == []


def test_lifecycle_still_guards_drawing(client):
    model_id = _model(client, "Lifecycle Draw")
    a = _element(client, model_id, "A")
    b = _element(client, model_id, "B")
    draft_rel = _relationship(client, model_id, a, b, kind="produces", status="draft")
    rel = _relationship(client, model_id, a, b, kind="has_threshold")
    a1 = _instance(client, model_id, a, "a1")
    b1 = _instance(client, model_id, b, "b1")
    b2 = _instance(client, model_id, b, "b2")
    assert _link(client, draft_rel, a1, b1).status_code == 400
    assert client.patch(f"/api/structure/element-instances/{b2}", json={"name": "b2", "status": "retired"}).status_code == 200
    assert _link(client, rel, a1, b2).status_code == 400
    assert _link(client, rel, a1, b1).status_code == 201
    # Nothing refused left a diagram row behind beyond the one real edge.
    assert len(_diagrams(model_id)) == 1 and len(_edge_keys(model_id)) == 1


def test_deleting_a_link_twice(client):
    s = _setup(client)
    link = _link(client, s["works_for"], s["fred"], s["org1"]).json()
    assert client.delete(f"/api/structure/sd-diagram-links/{link['relationship_instance_id']}").status_code == 204
    assert client.delete(f"/api/structure/sd-diagram-links/{link['relationship_instance_id']}").status_code == 404
    # The diagram stays; only its edge went.
    assert len(_diagrams(s["model_id"])) == 1


def test_layout_with_a_repeated_card_is_not_a_server_error(client):
    s = _setup(client)
    saved = client.put(
        "/api/structure/sd-diagram/nodes",
        json={"support_domain_model_id": s["model_id"], "nodes": [
            {"item_id": s["person"], "pos_x": 1, "pos_y": 1},
            {"item_id": s["person"], "pos_x": 2, "pos_y": 2},
        ]},
    )
    assert saved.status_code == 200, saved.text
    assert [(n["item_id"], n["pos_x"]) for n in saved.json()["nodes"]] == [(s["person"], 2)]


def test_a_removed_element_type_leaves_no_card_position(client):
    s = _setup(client)
    client.put(
        "/api/structure/sd-diagram/nodes",
        json={"support_domain_model_id": s["model_id"], "nodes": [
            {"item_id": s["person"], "pos_x": 1, "pos_y": 1},
            {"item_id": s["org"], "pos_x": 300, "pos_y": 1},
        ]},
    )
    removed = client.delete(f"/api/model/support-domain-elements/{s['org']}")
    assert removed.status_code in (200, 204), removed.text
    layout = client.get("/api/structure/sd-diagram", params={"model_id": s["model_id"]}).json()
    assert [n["item_id"] for n in layout["nodes"]] == [s["person"]]


def test_two_first_drawings_at_once_make_one_diagram(client):
    model_id = _model(client, "Race Model")
    a = _element(client, model_id, "A")
    b = _element(client, model_id, "B")
    rel = _relationship(client, model_id, a, b)
    sources = [_instance(client, model_id, a, f"a{i}") for i in range(6)]
    target = _instance(client, model_id, b, "b")
    from features.structure.domain.models import CreateElementRelationshipInstanceCommand
    from features.structure.service.support_domain_instance_relationship_diagram_service import (
        SupportDomainInstanceRelationshipDiagramService,
    )

    statuses = []
    errors = []
    barrier = threading.Barrier(len(sources))

    def draw(source):
        barrier.wait()
        try:
            SupportDomainInstanceRelationshipDiagramService(get_database_url()).create_edge(
                CreateElementRelationshipInstanceCommand(
                    support_domain_relationship_id=rel, source_instance_id=source, target_instance_id=target
                )
            )
            statuses.append(201)
        except Exception as exc:  # noqa: BLE001 - recorded for the assertion
            errors.append(repr(exc))

    threads = [threading.Thread(target=draw, args=(source,)) for source in sources]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    assert statuses == [201] * len(sources)
    assert len(_diagrams(model_id)) == 1
    assert len(_links(client, model_id)) == len(sources)


def test_exports_keep_to_their_models_and_templates(client):
    s = _setup(client)
    other = _setup(client, "Second Round Trip Model")
    assert _link(client, s["works_for"], s["fred"], s["org1"]).status_code == 201
    assert _link(client, other["works_for"], other["fred"], other["org1"]).status_code == 201
    one = client.get("/api/structure/exports", params={"template_type": "support-domain", "model_ids": s["model_id"]}).json()
    assert [r["support_domain_model_id"] for r in one["Load_Support_Domain_Element_Instance_Relationships"]] == [s["model_id"]]
    both = client.get("/api/structure/exports", params={"template_type": "all"}).json()
    assert len(both["Load_Support_Domain_Element_Instance_Relationships"]) == 2
    hierarchy = client.get("/api/structure/exports", params={"template_type": "hierarchy"}).json()
    assert not hierarchy.get("Load_Support_Domain_Element_Instance_Relationships")
