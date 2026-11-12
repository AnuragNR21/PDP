from fastapi.testclient import TestClient

from shared.auth.roles import ADMIN, ANALYST, MODEL_AUTHOR, SUPER_ADMIN
from shared.auth.user_repository import STATUS_INACTIVE, UserRepository
from tests.conftest import (
    BOOTSTRAP_EMAIL,
    BOOTSTRAP_PASSWORD,
    _test_db_url,
    create_user_with_roles,
    login_headers,
)


def test_bootstrap_superadmin_is_seeded_and_must_change_password(anon_client: TestClient) -> None:
    response = anon_client.post(
        "/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": BOOTSTRAP_PASSWORD}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == BOOTSTRAP_EMAIL
    assert body["user"]["roles"] == [SUPER_ADMIN]
    assert body["user"]["must_change_password"] is True


def test_bootstrap_does_not_reseed_once_an_admin_exists(anon_client: TestClient) -> None:
    repository = UserRepository(_test_db_url())
    seeded = repository.get_by_email(BOOTSTRAP_EMAIL)
    assert seeded is not None
    before = repository.list_users()
    from app.bootstrap import seed_bootstrap_superadmin
    from app.config import get_settings

    seed_bootstrap_superadmin(get_settings())
    assert [u.user_id for u in repository.list_users()] == [u.user_id for u in before]


def test_bootstrap_promotes_a_pre_existing_plain_admin_account(anon_client: TestClient) -> None:
    """A database seeded before Super Admin existed is brought up to date."""
    repository = UserRepository(_test_db_url())
    seeded = repository.get_by_email(BOOTSTRAP_EMAIL)
    assert seeded is not None
    repository.set_roles(seeded.user_id, [ADMIN], assigned_by="pytest")
    from app.bootstrap import seed_bootstrap_superadmin
    from app.config import get_settings

    seed_bootstrap_superadmin(get_settings())
    assert repository.roles_for(seeded.user_id) == [ADMIN, SUPER_ADMIN]
    # Password untouched: the old one still signs in.
    anon_client.post(
        "/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": BOOTSTRAP_PASSWORD}
    ).raise_for_status()


def test_bootstrap_never_recreates_a_removed_account_beside_other_admins(
    anon_client: TestClient,
) -> None:
    repository = UserRepository(_test_db_url())
    seeded = repository.get_by_email(BOOTSTRAP_EMAIL)
    assert seeded is not None
    create_user_with_roles("other-admin@example.com", "Other-pass-1", [ADMIN])
    repository.delete_user(seeded.user_id)
    from app.bootstrap import seed_bootstrap_superadmin
    from app.config import get_settings

    seed_bootstrap_superadmin(get_settings())
    assert repository.get_by_email(BOOTSTRAP_EMAIL) is None


def test_login_rejects_wrong_password_and_unknown_email(anon_client: TestClient) -> None:
    wrong = anon_client.post(
        "/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": "nope-nope"}
    )
    assert wrong.status_code == 401
    unknown = anon_client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "nope-nope"}
    )
    assert unknown.status_code == 401
    # Same message either way, so the form cannot be used to find accounts.
    assert wrong.json()["detail"] == unknown.json()["detail"]


def test_login_email_is_case_insensitive(anon_client: TestClient) -> None:
    response = anon_client.post(
        "/api/auth/login", json={"email": BOOTSTRAP_EMAIL.upper(), "password": BOOTSTRAP_PASSWORD}
    )
    assert response.status_code == 200


def test_repeated_failures_lock_the_account(anon_client: TestClient) -> None:
    for _ in range(5):
        anon_client.post(
            "/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": "wrong-password"}
        )
    locked = anon_client.post(
        "/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": BOOTSTRAP_PASSWORD}
    )
    assert locked.status_code == 423


def test_unauthenticated_requests_are_refused(anon_client: TestClient) -> None:
    assert anon_client.get("/api/auth/me").status_code == 401
    assert anon_client.get("/api/model/hierarchy-models").status_code == 401
    assert anon_client.get("/api/admin/audit").status_code == 401
    # Health stays open for the load balancer.
    assert anon_client.get("/api/platform/health").status_code == 200


def test_garbage_and_expired_tokens_are_refused(anon_client: TestClient) -> None:
    assert (
        anon_client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"}).status_code
        == 401
    )
    from app.config import get_settings
    from shared.auth.tokens import issue_access_token

    settings = get_settings()
    stale = issue_access_token("usr_x", "x@example.com", settings.jwt_secret, hours=-1)
    assert (
        anon_client.get("/api/auth/me", headers={"Authorization": f"Bearer {stale}"}).status_code
        == 401
    )
    other_key = issue_access_token("usr_x", "x@example.com", "some-other-secret", hours=1)
    assert (
        anon_client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {other_key}"}
        ).status_code
        == 401
    )


def test_me_profile_update_and_logout(client: TestClient) -> None:
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == BOOTSTRAP_EMAIL

    renamed = client.put("/api/auth/me", json={"display_name": "Casey Admin"})
    assert renamed.status_code == 200
    assert renamed.json()["user"]["display_name"] == "Casey Admin"

    blank = client.put("/api/auth/me", json={"display_name": "   "})
    assert blank.status_code == 400

    assert client.post("/api/auth/logout").status_code == 204
    audit = client.get("/api/admin/audit").json()["items"]
    actions = {record["action_code"] for record in audit}
    assert {"login.success", "profile.updated", "logout"} <= actions


def test_change_password_clears_must_change_and_old_password_stops_working(
    anon_client: TestClient,
) -> None:
    headers = login_headers(anon_client, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD)

    too_short = anon_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": BOOTSTRAP_PASSWORD, "new_password": "short"},
    )
    assert too_short.status_code == 400

    wrong_current = anon_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": "not-it", "new_password": "a-new-password-1"},
    )
    assert wrong_current.status_code == 400

    changed = anon_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": BOOTSTRAP_PASSWORD, "new_password": "a-new-password-1"},
    )
    assert changed.status_code == 204

    assert (
        anon_client.get("/api/auth/me", headers=headers).json()["user"]["must_change_password"]
        is False
    )
    assert (
        anon_client.post(
            "/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": BOOTSTRAP_PASSWORD}
        ).status_code
        == 401
    )
    assert (
        anon_client.post(
            "/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": "a-new-password-1"}
        ).status_code
        == 200
    )


def test_deactivated_user_loses_access_immediately(anon_client: TestClient) -> None:
    user_id = create_user_with_roles("sam@example.com", "sams-password-1", [ANALYST])
    headers = login_headers(anon_client, "sam@example.com", "sams-password-1")
    assert anon_client.get("/api/auth/me", headers=headers).status_code == 200

    UserRepository(_test_db_url()).set_status(user_id, STATUS_INACTIVE)
    # The token is still within its lifetime; the account status wins.
    assert anon_client.get("/api/auth/me", headers=headers).status_code == 401
    assert (
        anon_client.post(
            "/api/auth/login", json={"email": "sam@example.com", "password": "sams-password-1"}
        ).status_code
        == 401
    )


def test_roles_gate_writes_but_not_reads(anon_client: TestClient) -> None:
    create_user_with_roles("mo@example.com", "mos-password-1", [MODEL_AUTHOR])
    create_user_with_roles("ana@example.com", "anas-password-1", [ANALYST])
    create_user_with_roles("adm@example.com", "adms-password-1", [ADMIN])
    author = login_headers(anon_client, "mo@example.com", "mos-password-1")
    analyst = login_headers(anon_client, "ana@example.com", "anas-password-1")
    admin = login_headers(anon_client, "adm@example.com", "adms-password-1")

    model_payload = {"name": "Gated model", "purpose": "pytest", "owning_domain": "information"}

    # Everyone signed in may read models.
    assert anon_client.get("/api/model/hierarchy-models", headers=analyst).status_code == 200
    # Only a Model Author may create one; the Analyst and the Admin may not.
    assert (
        anon_client.post(
            "/api/model/hierarchy-models", json=model_payload, headers=analyst
        ).status_code
        == 403
    )
    assert (
        anon_client.post(
            "/api/model/hierarchy-models", json=model_payload, headers=admin
        ).status_code
        == 403
    )
    created = anon_client.post("/api/model/hierarchy-models", json=model_payload, headers=author)
    assert created.status_code in (200, 201), created.text

    # The Admin Workspace is for admins, reads included.
    assert anon_client.get("/api/admin/audit", headers=author).status_code == 403
    assert anon_client.get("/api/admin/audit", headers=admin).status_code == 200

    # Organisation settings are admin-only writes, readable by anyone.
    assert anon_client.get("/api/settings/organisation", headers=author).status_code == 200
    update = {"setting_value": "21", "actor_label": "pytest"}
    assert (
        anon_client.put(
            "/api/settings/organisation/default_due_days", json=update, headers=author
        ).status_code
        == 403
    )
    assert (
        anon_client.put(
            "/api/settings/organisation/default_due_days", json=update, headers=admin
        ).status_code
        == 200
    )


def test_roles_combine(anon_client: TestClient) -> None:
    create_user_with_roles("both@example.com", "boths-password-1", [ADMIN, MODEL_AUTHOR])
    both = login_headers(anon_client, "both@example.com", "boths-password-1")
    assert anon_client.get("/api/admin/audit", headers=both).status_code == 200
    created = anon_client.post(
        "/api/model/hierarchy-models",
        headers=both,
        json={"name": "Combined", "purpose": "pytest", "owning_domain": "information"},
    )
    assert created.status_code in (200, 201), created.text
