def test_list_parties_and_assignments(client):
    parties = client.get('/api/accountability/parties')
    assert parties.status_code == 200
    payload = parties.json()
    assert len(payload['items']) >= 3

    assignments = client.get('/api/accountability/assignments?scope_type=candidate&scope_id=candidate_seed_1')
    assert assignments.status_code == 200
    items = assignments.json()['items']
    assert len(items) == 1
    assert items[0]['role_code'] == 'owner'


def test_create_assignment(client):
    response = client.post(
        '/api/accountability/assignments',
        json={
            'scope_type': 'task',
            'scope_id': 'task_seed_2',
            'role_code': 'reviewer',
            'party_id': 'party_manager',
        },
    )
    assert response.status_code == 201
    created = response.json()['assignment']
    assert created['scope_id'] == 'task_seed_2'
    assert created['party_id'] == 'party_manager'
