"""Access tokens (JWT, HS256) and the one-time tokens used by invitations and
password resets.

The access token carries only the user id and email. Roles and status are
read from the database on every request, so deactivating a user or changing
their roles takes effect immediately rather than when the token expires.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt

ALGORITHM = "HS256"


class TokenError(Exception):
    """The token is missing, malformed, expired or signed with another key."""


def issue_access_token(user_id: str, email: str, secret: str, hours: int) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=hours)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> dict:
    try:
        return jwt.decode(
            token, secret, algorithms=[ALGORITHM], options={"require": ["sub", "exp"]}
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc


def new_one_time_token() -> str:
    """A URL-safe secret for an invitation or reset link. Only its hash is stored."""
    return secrets.token_urlsafe(32)


def hash_one_time_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
