import os

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from shared.auth.passwords import hash_password
from shared.auth.roles import ALL_ROLES
from shared.auth.user_repository import STATUS_ACTIVE, UserRepository
from shared.db import reset_database

_DEFAULT_TEST_DB_URL = "postgresql://localhost/pdp_test"

# The seeded administrator (app/bootstrap.py) is the one account every fresh
# database has, so it is also how the tests sign in.
BOOTSTRAP_EMAIL = "admin@solutionadvisor.com.au"
BOOTSTRAP_PASSWORD = "OYmjnBUtEsOS"


def _test_db_url() -> str:
    return os.environ.get("PDP_DATABASE_URL", _DEFAULT_TEST_DB_URL)


def login_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_user_with_roles(
    email: str,
    password: str,
    roles: list[str],
    *,
    display_name: str = "",
    status: str = STATUS_ACTIVE,
) -> str:
    """Insert an account directly and return its id. The caller signs in through the API."""
    repository = UserRepository(_test_db_url())
    user = repository.create_user(
        email=email,
        display_name=display_name or email.split("@")[0],
        status=status,
        password_hash=hash_password(password) if password else "",
    )
    repository.set_roles(user.user_id, roles, assigned_by="pytest")
    return user.user_id


@pytest.fixture()
def anon_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """A fresh app on a reset database, with nobody signed in."""
    db_url = _test_db_url()
    monkeypatch.setenv("PDP_DATABASE_URL", db_url)
    get_settings.cache_clear()
    reset_database(db_url)
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
    get_settings.cache_clear()


@pytest.fixture()
def client(anon_client: TestClient) -> TestClient:
    """The usual client: signed in as the bootstrap admin, holding every role.

    Feature tests exercise what the API does, not who may do it; the
    who-may-do-what tests sign in as narrower users themselves.
    """
    repository = UserRepository(_test_db_url())
    admin = repository.get_by_email(BOOTSTRAP_EMAIL)
    assert admin is not None, "bootstrap admin was not seeded"
    repository.set_roles(admin.user_id, list(ALL_ROLES), assigned_by="pytest")
    anon_client.headers.update(login_headers(anon_client, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD))
    return anon_client
