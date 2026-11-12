from app.config import get_settings
from shared.db import initialize_database


def bootstrap_application() -> None:
    """Initialise schema and baseline seed data for the running environment."""

    settings = get_settings()
    initialize_database(settings.database_url)
    seed_bootstrap_superadmin(settings)
    _start_retention_sweeper(settings.database_url)


def seed_bootstrap_superadmin(settings) -> None:
    """
    Make sure a fresh tenant has someone who can sign in.

    Every tenant runs its own copy of this code, so the first account cannot
    be created through the Admin Workspace: nobody can reach it yet. When no
    user holds Super Admin, the configured bootstrap account is created
    active with that role and told to change its password on first sign-in.

    A database seeded before Super Admin existed has the bootstrap account
    as a plain Admin; it is promoted here, password untouched. A deployment
    that has removed the bootstrap account and runs on other administrators
    is left alone: the account is never recreated beside them.
    """
    from shared.auth.passwords import hash_password
    from shared.auth.roles import ADMIN, SUPER_ADMIN
    from shared.auth.user_repository import STATUS_ACTIVE, UserRepository

    repository = UserRepository(settings.database_url)
    if repository.count_users_with_role(SUPER_ADMIN) > 0:
        return

    user = repository.get_by_email(settings.bootstrap_superadmin_email)
    if user is None:
        if repository.count_users_with_role(ADMIN) > 0:
            return
        user = repository.create_user(
            email=settings.bootstrap_superadmin_email,
            display_name="Administrator",
            status=STATUS_ACTIVE,
            password_hash=hash_password(settings.bootstrap_superadmin_password),
            must_change_password=True,
        )
    roles = sorted({*repository.roles_for(user.user_id), SUPER_ADMIN})
    repository.set_roles(user.user_id, roles, assigned_by="bootstrap")
    repository.insert_audit(
        category="auth",
        action_code="user.bootstrapped",
        object_ref=user.user_id,
        actor_label="bootstrap",
        detail=f"Seeded Super Admin {user.email} because no Super Admin existed.",
    )


def _start_retention_sweeper(database_url: str) -> None:
    """
    Start the thread that deletes archived sessions once their time is up.

    It has to be started here rather than left to the first request. The
    sweeper is created lazily by `get_retention_sweeper`, which only the
    Discover endpoints call, so on a server nobody has touched since it
    started there was no thread at all and the sweep only ever happened when
    somebody opened a page — which is not what "runs once a day at 06:00" says
    on the Admin screen.

    A failure here is logged and swallowed: the request path catches up a
    window that is owed anyway, and an unsweepable database must not stop the
    application from starting.
    """
    from features.discover.service.retention_sweeper import get_retention_sweeper

    try:
        get_retention_sweeper(database_url)
    except Exception:  # pragma: no cover - startup must survive it
        import logging

        logging.getLogger(__name__).exception(
            "Could not start the retention sweeper; the sweep will still catch "
            "up on the next request."
        )
