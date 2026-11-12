"""
The delete dialog's impact call, end to end, on a model this test builds itself.

Why a test that creates its own model rather than leaning on the seed: the two
existing delete tests in `test_structure_api.py` already assert this endpoint
returns 200, and both have been failing for other reasons — one gets a 400 from
a seeded node type, the other a 404 from a seed node that no longer exists — so
neither ever reached the assertion. A 500 from this endpoint shipped to
production underneath them, and the Structure delete dialog could not be opened
for any node in any model.

Rows from this database are dictionaries, so `cursor.fetchone()[0]` looks up the
*key* `0` and raises `KeyError: 0`. These tests pin the three places that used
to spell it that way.
"""
from fastapi.testclient import TestClient


def _build_model(client: TestClient, name: str) -> dict:
    model = client.post(
        '/api/model/hierarchy-models',
        json={'name': name, 'purpose': 'test', 'owning_domain': 'information', 'status': 'active'},
    )
    assert model.status_code == 200, model.text
    model_id = model.json()['model_id']

    types = client.get('/api/model/node-types', params={'model_id': model_id})
    assert types.status_code == 200, types.text
    root_type_id = types.json()[0]['node_id']

    branch = client.post(
        '/api/model/node-types',
        json={'model_id': model_id, 'parent_node_id': root_type_id, 'name': 'Branch', 'status': 'active'},
    )
    assert branch.status_code == 200, branch.text
    branch_type_id = branch.json()['node_id']

    root_instance = client.post('/api/structure/node-instances/ensure-root', params={'model_id': model_id})
    assert root_instance.status_code == 200, root_instance.text
    root_instance_id = root_instance.json()['node_id']

    child = client.post(
        '/api/structure/node-instances',
        json={
            'model_id': model_id,
            'node_type_id': branch_type_id,
            'name': 'Branch',
            'parent_node_id': root_instance_id,
        },
    )
    assert child.status_code == 201, child.text

    return {
        'model_id': model_id,
        'root_instance_id': root_instance_id,
        'child_instance_id': child.json()['node']['node_id'],
    }


def test_delete_impact_opens_for_a_child_node(client: TestClient):
    built = _build_model(client, 'Delete impact child')

    impact = client.get(f"/api/structure/node-instances/{built['child_instance_id']}/impacts/delete")
    assert impact.status_code == 200, impact.text

    body = impact.json()
    assert body['is_root'] is False
    assert body['instance_count'] == 1
    # The two counts that used to raise `KeyError: 0` before anything was
    # returned. Their value matters less than their presence as numbers.
    assert body['diagram_node_count'] == 0
    assert body['diagram_edge_count'] == 0


def test_delete_impact_opens_for_the_root_node(client: TestClient):
    built = _build_model(client, 'Delete impact root')

    impact = client.get(f"/api/structure/node-instances/{built['root_instance_id']}/impacts/delete")
    assert impact.status_code == 200, impact.text

    body = impact.json()
    assert body['is_root'] is True
    assert body['instance_count'] >= 2
    assert isinstance(body['diagram_node_count'], int)
    assert isinstance(body['diagram_edge_count'], int)


def test_delete_impact_is_404_for_a_node_that_is_not_there(client: TestClient):
    missing = client.get('/api/structure/node-instances/node_not_here/impacts/delete')
    assert missing.status_code == 404
    # A string, not a list of validation objects: the browser renders this.
    assert isinstance(missing.json()['detail'], str)


def test_reparent_without_a_position_lands_the_node_last(client: TestClient):
    """The third place that read a dict row by index, reached only when the
    caller leaves the position out — which is what a drag onto a parent does."""
    built = _build_model(client, 'Reparent without position')

    moved = client.post(
        '/api/structure/hierarchy/reparent',
        json={'node_id': built['child_instance_id'], 'new_parent_node_id': built['root_instance_id']},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()['node']['node_id'] == built['child_instance_id']
