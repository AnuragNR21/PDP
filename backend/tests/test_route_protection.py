"""Every API route needs a signed-in user unless it is deliberately public.

Walks the live route table rather than a hand-kept list, so a router added
without a dependency fails here instead of shipping open.
"""

from fastapi.routing import APIRoute

from app.main import create_app
from shared.auth.dependencies import get_current_user

PUBLIC_ROUTES = {
    ("GET", "/api/platform/health"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/forgot-password"),
    ("POST", "/api/auth/reset-password"),
    ("GET", "/api/auth/invitations/{token}"),
    ("POST", "/api/auth/accept-invitation"),
}


def _depends_on_current_user(dependant) -> bool:
    if dependant.call is get_current_user:
        return True
    return any(_depends_on_current_user(sub) for sub in dependant.dependencies)


def test_every_route_requires_a_session_unless_listed_public() -> None:
    app = create_app()
    unprotected = []
    seen_public = set()
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods:
            if method in {"HEAD", "OPTIONS"}:
                continue
            key = (method, route.path)
            protected = _depends_on_current_user(route.dependant)
            if key in PUBLIC_ROUTES:
                seen_public.add(key)
                assert not protected, f"{key} is listed public but requires a session"
            elif not protected:
                unprotected.append(key)
    assert not unprotected, f"routes without a session requirement: {sorted(unprotected)}"
    assert seen_public == PUBLIC_ROUTES, f"public list is stale: {PUBLIC_ROUTES ^ seen_public}"
