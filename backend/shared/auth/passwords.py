"""Password hashing with Argon2id via argon2-cffi.

Nothing here is home-grown: the library picks the salt, the parameters and
the encoding, and `verify_password` is the only way a stored hash is checked.
"""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()

# The ticket does not set a policy; this is the floor below which a password
# is refused everywhere a password is set (invitation, reset, change).
MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def password_policy_error(password: str) -> str | None:
    """The reason a password is unacceptable, or None when it is fine."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if password.strip() != password:
        return "Password cannot start or end with a space."
    return None
