def test_list_and_update_settings(client):
    response = client.get('/api/settings/organisation')
    assert response.status_code == 200
    items = response.json()['items']
    assert any(item['setting_key'] == 'guided_mode_enabled' for item in items)

    update = client.put(
        '/api/settings/organisation/guided_mode_enabled',
        json={'setting_value': 'false', 'actor_label': 'pytest'},
    )
    assert update.status_code == 200
    assert update.json()['setting']['setting_value'] == 'false'

    preferences = client.get('/api/settings/preferences')
    assert preferences.status_code == 200
    assert any(item['preference_key'] == 'theme_mode' for item in preferences.json()['items'])
