from fastapi.testclient import TestClient

from shared.auth.roles import ADMIN, ANALYST, MODEL_AUTHOR, STRUCTURE_EDITOR, SUPER_ADMIN
from shared.auth.user_repository import UserRepository
from tests.conftest import _test_db_url, create_user_with_roles, login_headers


def _invite(client: TestClient, email: str, roles: list[str], display_name: str = "") -> dict:
    response = client.post(
        "/api/admin/users",
        json={"email": email, "display_name": display_name, "roles": roles},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _token_from(link: str) -> str:
    return link.rsplit("/", 1)[-1]


def test_invite_accept_and_sign_in(client: TestClient) -> None:
    issued = _invite(client, "Jo.Bloggs@Example.com", [MODEL_AUTHOR], "Jo Bloggs")
    user = issued["user"]
    assert user["email"] == "jo.bloggs@example.com"
    assert user["status"] == "INVITED"
    assert user["invitation_status"] == "Invited"
    assert user["roles"] == [MODEL_AUTHOR]
    assert issued["invitation_link"].startswith("http://localhost:5173/accept-invitation/")

    token = _token_from(issued["invitation_link"])
    preview = client.get(f"/api/auth/invitations/{token}")
    assert preview.status_code == 200
    assert preview.json()["email"] == "jo.bloggs@example.com"

    accepted = client.post(
        "/api/auth/accept-invitation",
        json={"token": token, "display_name": "Jo", "password": "A-good-pass-1"},
    )
    assert accepted.status_code == 204

    # The link is single-use.
    assert client.get(f"/api/auth/invitations/{token}").status_code == 400

    headers = login_headers(client, "jo.bloggs@example.com", "A-good-pass-1")
    me = client.get("/api/auth/me", headers=headers).json()["user"]
    assert me["display_name"] == "Jo"
    assert me["roles"] == [MODEL_AUTHOR]

    listed = client.get("/api/admin/users", params={"search": "bloggs"}).json()["items"]
    assert [item["invitation_status"] for item in listed] == ["Active"]


def test_duplicate_email_is_refused(client: TestClient) -> None:
    _invite(client, "dup@example.com", [])
    response = client.post("/api/admin/users", json={"email": "DUP@example.com", "roles": []})
    assert response.status_code == 409


def test_unknown_role_is_refused(client: TestClient) -> None:
    response = client.post("/api/admin/users", json={"email": "x@example.com", "roles": ["king"]})
    assert response.status_code == 400
    assert "king" in response.json()["detail"]


def test_resend_replaces_the_link_and_cancel_removes_the_account(client: TestClient) -> None:
    issued = _invite(client, "pending@example.com", [ANALYST])
    user_id = issued["user"]["user_id"]
    first = _token_from(issued["invitation_link"])

    resent = client.post(f"/api/admin/users/{user_id}/invitation/resend")
    assert resent.status_code == 200
    second = _token_from(resent.json()["invitation_link"])
    assert second != first
    assert client.get(f"/api/auth/invitations/{first}").status_code == 400
    assert client.get(f"/api/auth/invitations/{second}").status_code == 200

    cancelled = client.delete(f"/api/admin/users/{user_id}/invitation")
    assert cancelled.status_code == 204
    assert client.get(f"/api/admin/users/{user_id}").status_code == 404
    assert client.get(f"/api/auth/invitations/{second}").status_code == 400
    # The email is free again.
    _invite(client, "pending@example.com", [])


def test_expired_invitation_shows_as_expired(client: TestClient) -> None:
    issued = _invite(client, "late@example.com", [])
    user_id = issued["user"]["user_id"]
    repository = UserRepository(_test_db_url())
    repository.create_token(
        user_id=user_id,
        kind="invite",
        token_hash="stale",
        expires_at="2000-01-01T00:00:00+00:00",
        created_by="pytest",
    )
    assert (
        client.get(f"/api/admin/users/{user_id}").json()["user"]["invitation_status"] == "Expired"
    )
    listed = client.get("/api/admin/users", params={"status": "expired"}).json()["items"]
    assert [item["user_id"] for item in listed] == [user_id]


def test_roles_change_takes_effect_on_the_next_request(client: TestClient) -> None:
    user_id = create_user_with_roles("worker@example.com", "Worker-pass-1", [ANALYST])
    headers = login_headers(client, "worker@example.com", "Worker-pass-1")

    response = client.put(f"/api/admin/users/{user_id}/roles", json={"roles": [MODEL_AUTHOR]})
    assert response.status_code == 200
    assert response.json()["user"]["roles"] == [MODEL_AUTHOR]
    assert client.get("/api/auth/me", headers=headers).json()["user"]["roles"] == [MODEL_AUTHOR]

    listed = client.get("/api/admin/users", params={"role": MODEL_AUTHOR}).json()["items"]
    assert user_id in [item["user_id"] for item in listed]


def test_deactivate_and_reactivate(client: TestClient) -> None:
    user_id = create_user_with_roles("leaver@example.com", "Leaver-pass-1", [ANALYST])
    headers = login_headers(client, "leaver@example.com", "Leaver-pass-1")

    off = client.post(f"/api/admin/users/{user_id}/deactivate")
    assert off.status_code == 200
    assert off.json()["user"]["invitation_status"] == "Inactive"
    # The existing session stops working at once, and a new one cannot start.
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"email": "leaver@example.com", "password": "Leaver-pass-1"}
        ).status_code
        == 401
    )

    on = client.post(f"/api/admin/users/{user_id}/activate")
    assert on.status_code == 200
    assert on.json()["user"]["status"] == "ACTIVE"
    login_headers(client, "leaver@example.com", "Leaver-pass-1")


def test_admin_cannot_deactivate_or_demote_themselves(client: TestClient) -> None:
    me = client.get("/api/auth/me").json()["user"]
    assert client.post(f"/api/admin/users/{me['user_id']}/deactivate").status_code == 409
    demote = client.put(f"/api/admin/users/{me['user_id']}/roles", json={"roles": [ANALYST]})
    assert demote.status_code == 409
    # Adding or dropping a working role on oneself is fine.
    keep = client.put(f"/api/admin/users/{me['user_id']}/roles", json={"roles": [ADMIN, ANALYST]})
    assert keep.status_code == 200


def test_the_last_active_admin_is_protected(client: TestClient) -> None:
    other_id = create_user_with_roles("second@example.com", "Second-pass-1", [ADMIN])
    other_headers = login_headers(client, "second@example.com", "Second-pass-1")
    me = client.get("/api/auth/me").json()["user"]

    # Two admins: the second may deactivate the first.
    assert (
        client.post(
            f"/api/admin/users/{me['user_id']}/deactivate", headers=other_headers
        ).status_code
        == 200
    )
    # Now the second is the only active admin and may not be demoted or deactivated.
    reactivated = client.post(f"/api/admin/users/{me['user_id']}/activate", headers=other_headers)
    assert reactivated.status_code == 200
    client.post(f"/api/admin/users/{me['user_id']}/deactivate", headers=other_headers)
    assert (
        client.put(
            f"/api/admin/users/{other_id}/roles", json={"roles": []}, headers=other_headers
        ).status_code
        == 409
    )


def test_update_display_name_and_issue_reset_link(client: TestClient) -> None:
    user_id = create_user_with_roles("rename@example.com", "Rename-pass-1", [])
    renamed = client.put(f"/api/admin/users/{user_id}", json={"display_name": "Renamed Person"})
    assert renamed.status_code == 200
    assert renamed.json()["user"]["display_name"] == "Renamed Person"

    issued = client.post(f"/api/admin/users/{user_id}/password-reset")
    assert issued.status_code == 200
    token = _token_from(issued.json()["reset_link"])
    reset = client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "Brand-new-pass-1"}
    )
    assert reset.status_code == 204
    login_headers(client, "rename@example.com", "Brand-new-pass-1")


def test_roles_matrix_is_readable(client: TestClient) -> None:
    body = client.get("/api/admin/roles").json()
    assert [role["role_code"] for role in body["roles"]] == [
        "super_admin",
        "admin",
        "model_author",
        "structure_editor",
        "analyst",
    ]
    assert body["roles"][0]["active_users"] >= 1
    assert any(ADMIN in entry["roles"] for entry in body["permissions"])
    assert all(SUPER_ADMIN in entry["roles"] for entry in body["permissions"])
    assert any(MODEL_AUTHOR in entry["roles"] for entry in body["permissions"])


def test_non_admins_cannot_manage_users(client: TestClient) -> None:
    create_user_with_roles("plain@example.com", "Plain-pass-1", [ANALYST, MODEL_AUTHOR])
    headers = login_headers(client, "plain@example.com", "Plain-pass-1")
    assert client.get("/api/admin/users", headers=headers).status_code == 403
    assert client.get("/api/admin/roles", headers=headers).status_code == 403
    assert (
        client.post(
            "/api/admin/users", json={"email": "new@example.com", "roles": []}, headers=headers
        ).status_code
        == 403
    )


def test_admin_actions_are_audited(client: TestClient) -> None:
    issued = _invite(client, "audited@example.com", [ANALYST])
    user_id = issued["user"]["user_id"]
    client.put(f"/api/admin/users/{user_id}/roles", json={"roles": []})
    records = client.get("/api/admin/audit", params={"limit": 50}).json()["items"]
    actions = {record["action_code"] for record in records if record["object_ref"] == user_id}
    assert {"user.invited", "user.roles_changed"} <= actions


def test_create_user_directly_with_a_password(client: TestClient) -> None:
    response = client.post(
        "/api/admin/users/create",
        json={
            "email": "Direct@Example.com",
            "display_name": "Direct Person",
            "password": "Chosen-pass-1",
            "roles": [ANALYST],
        },
    )
    assert response.status_code == 201, response.text
    user = response.json()["user"]
    assert user["status"] == "ACTIVE"
    assert user["invitation_status"] == "Active"
    assert user["must_change_password"] is True

    headers = login_headers(client, "direct@example.com", "Chosen-pass-1")
    me = client.get("/api/auth/me", headers=headers).json()["user"]
    assert me["roles"] == [ANALYST]
    assert me["must_change_password"] is True

    # The switch off: the password is final.
    settled = client.post(
        "/api/admin/users/create",
        json={
            "email": "settled@example.com",
            "password": "Chosen-pass-2",
            "roles": [],
            "must_change_password": False,
        },
    )
    assert settled.json()["user"]["must_change_password"] is False

    weak = client.post(
        "/api/admin/users/create",
        json={"email": "weak@example.com", "password": "short", "roles": []},
    )
    assert weak.status_code == 400
    duplicate = client.post(
        "/api/admin/users/create",
        json={"email": "direct@example.com", "password": "Chosen-pass-3", "roles": []},
    )
    assert duplicate.status_code == 409


def test_super_admin_passes_every_role_check(client: TestClient) -> None:
    create_user_with_roles("super@example.com", "Super-pass-1", [SUPER_ADMIN])
    headers = login_headers(client, "super@example.com", "Super-pass-1")
    # Administration...
    assert client.get("/api/admin/users", headers=headers).status_code == 200
    # ...and a working-role write, refused to a plain Admin, is allowed.
    create_user_with_roles("plainadmin@example.com", "Plain-pass-1", [ADMIN])
    plain = login_headers(client, "plainadmin@example.com", "Plain-pass-1")
    payload = {
        "name": "ZZ role check",
        "description": "",
        "category": "ZZ Playwright",
        "definition_kind": "builtin",
        "check_type": "mandatory",
        "parameters": {},
        "severity": "high",
        "status": "active",
        "dimension": "completeness",
        "data_type": "any",
        "rationale": "",
    }
    assert client.post("/api/rules", json=payload, headers=plain).status_code == 403
    created = client.post("/api/rules", json=payload, headers=headers)
    assert created.status_code == 201, created.text

    # A Super Admin counts as an administrator for the self-protection rules.
    me = client.get("/api/auth/me", headers=headers).json()["user"]
    demote = client.put(
        f"/api/admin/users/{me['user_id']}/roles",
        json={"roles": [STRUCTURE_EDITOR]},
        headers=headers,
    )
    assert demote.status_code == 409
