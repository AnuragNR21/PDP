def test_list_and_update_admin_surfaces(client):
    permissions = client.get('/api/admin/permissions')
    assert permissions.status_code == 200
    assert len(permissions.json()['items']) >= 3

    update_permission = client.put(
        '/api/admin/permissions',
        json={
            'role_code': 'trial_admin',
            'action_code': 'admin.integrations',
            'access_level': 'edit',
            'actor_label': 'pytest',
        },
    )
    assert update_permission.status_code == 200
    assert update_permission.json()['permission']['access_level'] == 'edit'

    integrations = client.get('/api/admin/integrations')
    assert integrations.status_code == 200
    assert any(item['integration_key'] == 'telemetry_seed' for item in integrations.json()['items'])

    update_integration = client.put(
        '/api/admin/integrations/export_seed',
        json={
            'base_status': 'healthy',
            'config_json': {'format': 'json', 'safe_mode': 'true'},
            'actor_label': 'pytest',
        },
    )
    assert update_integration.status_code == 200
    assert update_integration.json()['integration']['base_status'] == 'healthy'

    audit = client.get('/api/admin/audit')
    assert audit.status_code == 200
    assert len(audit.json()['items']) >= 3
