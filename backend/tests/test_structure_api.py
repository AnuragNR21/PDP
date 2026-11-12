from fastapi.testclient import TestClient


def test_structure_tree_and_mutations(client: TestClient):
    roots = client.get('/api/structure/tree/roots')
    assert roots.status_code == 200
    root_items = roots.json()['items']
    assert root_items[0]['node_id'] == 'node_customer_subject'

    create = client.post(
        '/api/structure/nodes',
        json={
            'model_id': 'mdl_business_information',
            'node_type_id': 'nt_entity',
            'name': 'Service Point',
            'parent_node_id': 'node_customer_subject',
        },
    )
    assert create.status_code == 201
    created_node_id = create.json()['node']['node_id']

    children = client.get('/api/structure/tree/children/node_customer_subject')
    assert children.status_code == 200
    assert {item['node_id'] for item in children.json()['items']} >= {'node_customer_account', created_node_id}

    reparent = client.post(
        '/api/structure/hierarchy/reparent',
        json={'node_id': created_node_id, 'new_parent_node_id': None},
    )
    assert reparent.status_code == 200
    assert reparent.json()['node']['parent_node_id'] is None


def test_structure_diagram_and_matrix_projections(client: TestClient):
    diagram = client.get('/api/structure/projections/diagram', params={'model_id': 'mdl_business_information'})
    assert diagram.status_code == 200
    projection = diagram.json()['projection']
    assert projection['model_id'] == 'mdl_business_information'
    assert len(projection['nodes']) >= 3
    assert any(edge['projection_kind'] == 'hierarchy' for edge in projection['edges'])
    assert any(edge['projection_kind'] == 'relationship' for edge in projection['edges'])

    matrix = client.get('/api/structure/projections/matrix', params={'model_id': 'mdl_business_information'})
    assert matrix.status_code == 200
    matrix_projection = matrix.json()['projection']
    assert len(matrix_projection['rows']) == 1
    assert len(matrix_projection['columns']) == 1
    assert matrix_projection['cells'][0]['linked'] is True


def test_delete_node_instance_keeps_model_definitions_and_removes_runtime_node_instances(client: TestClient):
    create_parent = client.post(
        '/api/structure/node-instances',
        json={
            'model_id': 'mdl_business_information',
            'node_type_id': 'nt_entity',
            'name': 'Runtime Parent',
            'parent_node_id': 'node_customer_subject',
        },
    )
    assert create_parent.status_code == 201
    parent_id = create_parent.json()['node']['node_id']

    create_child = client.post(
        '/api/structure/node-instances',
        json={
            'model_id': 'mdl_business_information',
            'node_type_id': 'nt_attribute',
            'name': 'Runtime Child',
            'parent_node_id': parent_id,
        },
    )
    assert create_child.status_code == 201
    child_id = create_child.json()['node']['node_id']

    impact = client.get(f'/api/structure/node-instances/{parent_id}/impacts/delete')
    assert impact.status_code == 200
    impact_body = impact.json()
    assert impact_body['instance_count'] == 2

    deleted = client.delete(f'/api/structure/node-instances/{parent_id}')
    assert deleted.status_code == 204

    remaining_nodes = client.get('/api/structure/node-instances', params={'model_id': 'mdl_business_information'})
    assert remaining_nodes.status_code == 200
    remaining_ids = {item['node_id'] for item in remaining_nodes.json()['items']}
    assert parent_id not in remaining_ids
    assert child_id not in remaining_ids
    assert 'node_customer_subject' in remaining_ids

    hierarchy_models = client.get('/api/model/hierarchy-models')
    assert hierarchy_models.status_code == 200
    assert any(model['id'] == 'mdl_business_information' for model in hierarchy_models.json())


def test_delete_root_node_removes_runtime_instances_but_not_model_definition(client: TestClient):
    impact = client.get('/api/structure/node-instances/node_customer_subject/impacts/delete')
    assert impact.status_code == 200
    impact_body = impact.json()
    assert impact_body['is_root'] is True
    assert impact_body['instance_count'] >= 1

    deleted = client.delete('/api/structure/node-instances/node_customer_subject')
    assert deleted.status_code == 204

    remaining_nodes = client.get('/api/structure/node-instances', params={'model_id': 'mdl_business_information'})
    assert remaining_nodes.status_code == 200
    assert remaining_nodes.json()['items'] == []

    hierarchy_models = client.get('/api/model/hierarchy-models')
    assert hierarchy_models.status_code == 200
    assert any(model['id'] == 'mdl_business_information' for model in hierarchy_models.json())

    recreated_root = client.post('/api/structure/node-instances/ensure-root', params={'model_id': 'mdl_business_information'})
    assert recreated_root.status_code == 200
    assert recreated_root.json()['node_id'] == 'node_mdl_business_information_root'
