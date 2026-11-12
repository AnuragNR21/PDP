"""Users, their roles, their one-time tokens, and the audit rows they cause."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from pydantic import BaseModel

from shared.auth.roles import ADMIN_ROLES
from shared.db import get_connection, utc_now_iso

STATUS_INVITED = "INVITED"
STATUS_ACTIVE = "ACTIVE"
STATUS_INACTIVE = "INACTIVE"
USER_STATUSES: tuple[str, ...] = (STATUS_INVITED, STATUS_ACTIVE, STATUS_INACTIVE)

TOKEN_KIND_INVITE = "invite"
TOKEN_KIND_RESET = "reset"

# Five wrong passwords lock the account for fifteen minutes. Recorded on the
# user row so it survives a restart and applies across backend instances.
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

_USER_COLUMNS = (
    "user_id, email, display_name, password_hash, status, must_change_password, "
    "failed_login_count, locked_until, last_login_at, created_at, updated_at"
)


class UserRecord(BaseModel):
    user_id: str
    email: str
    display_name: str
    password_hash: str
    status: str
    must_change_password: bool
    failed_login_count: int
    locked_until: str
    last_login_at: str
    created_at: str
    updated_at: str


class UserTokenRecord(BaseModel):
    token_id: str
    user_id: str
    kind: str
    expires_at: str
    used_at: str
    created_at: str
    created_by: str


def _user_from_row(row) -> UserRecord:
    return UserRecord(
        user_id=row["user_id"],
        email=row["email"],
        display_name=row["display_name"],
        password_hash=row["password_hash"],
        status=row["status"],
        must_change_password=bool(row["must_change_password"]),
        failed_login_count=int(row["failed_login_count"]),
        locked_until=row["locked_until"],
        last_login_at=row["last_login_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def normalise_email(email: str) -> str:
    return email.strip().lower()


class UserRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    # ── users ──────────────────────────────────────────────────────────────

    def get_by_id(self, user_id: str) -> UserRecord | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                f"SELECT {_USER_COLUMNS} FROM app_user WHERE user_id = %s", (user_id,)
            ).fetchone()
        return _user_from_row(row) if row else None

    def get_by_email(self, email: str) -> UserRecord | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                f"SELECT {_USER_COLUMNS} FROM app_user WHERE email = %s", (normalise_email(email),)
            ).fetchone()
        return _user_from_row(row) if row else None

    def list_users(self) -> list[UserRecord]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                f"SELECT {_USER_COLUMNS} FROM app_user ORDER BY lower(display_name), email"
            ).fetchall()
        return [_user_from_row(row) for row in rows]

    def create_user(
        self,
        *,
        email: str,
        display_name: str,
        status: str,
        password_hash: str = "",
        must_change_password: bool = False,
    ) -> UserRecord:
        timestamp = utc_now_iso()
        user_id = f"usr_{uuid4().hex[:12]}"
        with get_connection(self._db_url) as connection:
            connection.execute(
                """
                INSERT INTO app_user (
                    user_id, email, display_name, password_hash, status, must_change_password,
                    failed_login_count, locked_until, last_login_at, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, 0, '', '', %s, %s)
                """,
                (
                    user_id,
                    normalise_email(email),
                    display_name,
                    password_hash,
                    status,
                    must_change_password,
                    timestamp,
                    timestamp,
                ),
            )
        user = self.get_by_id(user_id)
        assert user is not None
        return user

    def update_profile(self, user_id: str, *, display_name: str) -> UserRecord | None:
        with get_connection(self._db_url) as connection:
            connection.execute(
                "UPDATE app_user SET display_name = %s, updated_at = %s WHERE user_id = %s",
                (display_name, utc_now_iso(), user_id),
            )
        return self.get_by_id(user_id)

    def set_password(
        self, user_id: str, password_hash: str, *, must_change_password: bool = False
    ) -> None:
        with get_connection(self._db_url) as connection:
            connection.execute(
                """
                UPDATE app_user
                SET password_hash = %s, must_change_password = %s, failed_login_count = 0,
                    locked_until = '', updated_at = %s
                WHERE user_id = %s
                """,
                (password_hash, must_change_password, utc_now_iso(), user_id),
            )

    def delete_user(self, user_id: str) -> None:
        """Remove an account outright. Used only for invitations that were never
        accepted; roles and tokens go with it (ON DELETE CASCADE)."""
        with get_connection(self._db_url) as connection:
            connection.execute("DELETE FROM app_user WHERE user_id = %s", (user_id,))

    def set_status(self, user_id: str, status: str) -> UserRecord | None:
        with get_connection(self._db_url) as connection:
            connection.execute(
                "UPDATE app_user SET status = %s, updated_at = %s WHERE user_id = %s",
                (status, utc_now_iso(), user_id),
            )
        return self.get_by_id(user_id)

    def record_login_success(self, user_id: str) -> None:
        with get_connection(self._db_url) as connection:
            connection.execute(
                """
                UPDATE app_user
                SET failed_login_count = 0, locked_until = '', last_login_at = %s, updated_at = %s
                WHERE user_id = %s
                """,
                (utc_now_iso(), utc_now_iso(), user_id),
            )

    def record_login_failure(self, user_id: str) -> int:
        """Count the failure; lock the account when the limit is reached. Returns the new count."""
        with get_connection(self._db_url) as connection:
            count = connection.scalar(
                "UPDATE app_user SET failed_login_count = failed_login_count + 1, updated_at = %s "
                "WHERE user_id = %s RETURNING failed_login_count",
                (utc_now_iso(), user_id),
            )
            if count is not None and count >= MAX_FAILED_LOGINS:
                locked_until = (datetime.now(UTC) + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
                connection.execute(
                    "UPDATE app_user SET locked_until = %s WHERE user_id = %s",
                    (locked_until, user_id),
                )
        return int(count or 0)

    # ── roles ──────────────────────────────────────────────────────────────

    def roles_for(self, user_id: str) -> list[str]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                "SELECT role_code FROM user_role WHERE user_id = %s ORDER BY role_code", (user_id,)
            ).fetchall()
        return [row["role_code"] for row in rows]

    def roles_for_many(self, user_ids: list[str]) -> dict[str, list[str]]:
        if not user_ids:
            return {}
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                "SELECT user_id, role_code FROM user_role "
                "WHERE user_id = ANY(%s) ORDER BY role_code",
                (list(user_ids),),
            ).fetchall()
        result: dict[str, list[str]] = {user_id: [] for user_id in user_ids}
        for row in rows:
            result.setdefault(row["user_id"], []).append(row["role_code"])
        return result

    def set_roles(self, user_id: str, role_codes: list[str], *, assigned_by: str) -> list[str]:
        wanted = sorted(set(role_codes))
        timestamp = utc_now_iso()
        with get_connection(self._db_url) as connection:
            connection.execute(
                "DELETE FROM user_role WHERE user_id = %s AND NOT (role_code = ANY(%s))",
                (user_id, wanted),
            )
            for role_code in wanted:
                connection.execute(
                    """
                    INSERT INTO user_role (user_id, role_code, assigned_at, assigned_by)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (user_id, role_code) DO NOTHING
                    """,
                    (user_id, role_code, timestamp, assigned_by),
                )
        return wanted

    def count_users_with_role(self, role_code: str) -> int:
        with get_connection(self._db_url) as connection:
            return int(
                connection.scalar(
                    "SELECT COUNT(*) FROM user_role WHERE role_code = %s", (role_code,)
                )
                or 0
            )

    def count_active_administrators(self) -> int:
        """Active people holding any administrator role (one person counts once)."""
        with get_connection(self._db_url) as connection:
            return int(
                connection.scalar(
                    """
                SELECT COUNT(DISTINCT u.user_id) FROM user_role r
                JOIN app_user u ON u.user_id = r.user_id
                WHERE r.role_code = ANY(%s) AND u.status = %s
                """,
                    (list(ADMIN_ROLES), STATUS_ACTIVE),
                )
                or 0
            )

    def count_active_users_with_role(self, role_code: str) -> int:
        with get_connection(self._db_url) as connection:
            return int(
                connection.scalar(
                    """
                SELECT COUNT(*) FROM user_role r JOIN app_user u ON u.user_id = r.user_id
                WHERE r.role_code = %s AND u.status = %s
                """,
                    (role_code, STATUS_ACTIVE),
                )
                or 0
            )

    # ── one-time tokens (invitations, password resets) ─────────────────────

    def create_token(
        self, *, user_id: str, kind: str, token_hash: str, expires_at: str, created_by: str
    ) -> UserTokenRecord:
        token_id = f"tok_{uuid4().hex[:12]}"
        timestamp = utc_now_iso()
        with get_connection(self._db_url) as connection:
            # One live token of a kind per user: issuing a new one retires the old.
            connection.execute(
                "UPDATE user_token SET used_at = %s "
                "WHERE user_id = %s AND kind = %s AND used_at = ''",
                (timestamp, user_id, kind),
            )
            connection.execute(
                """
                INSERT INTO user_token (
                    token_id, user_id, kind, token_hash, expires_at,
                    used_at, created_at, created_by
                )
                VALUES (%s, %s, %s, %s, %s, '', %s, %s)
                """,
                (token_id, user_id, kind, token_hash, expires_at, timestamp, created_by),
            )
        return UserTokenRecord(
            token_id=token_id,
            user_id=user_id,
            kind=kind,
            expires_at=expires_at,
            used_at="",
            created_at=timestamp,
            created_by=created_by,
        )

    def find_live_token(self, *, kind: str, token_hash: str) -> UserTokenRecord | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                SELECT token_id, user_id, kind, expires_at, used_at, created_at, created_by
                FROM user_token WHERE kind = %s AND token_hash = %s AND used_at = ''
                """,
                (kind, token_hash),
            ).fetchone()
        return UserTokenRecord(**row) if row else None

    def latest_token_for(self, *, user_id: str, kind: str) -> UserTokenRecord | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                SELECT token_id, user_id, kind, expires_at, used_at, created_at, created_by
                FROM user_token WHERE user_id = %s AND kind = %s AND used_at = ''
                ORDER BY created_at DESC LIMIT 1
                """,
                (user_id, kind),
            ).fetchone()
        return UserTokenRecord(**row) if row else None

    def live_tokens_for_many(self, *, user_ids: list[str], kind: str) -> dict[str, UserTokenRecord]:
        """The one unused token of `kind` per user, for the users that have one."""
        if not user_ids:
            return {}
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                """
                SELECT token_id, user_id, kind, expires_at, used_at, created_at, created_by
                FROM user_token WHERE user_id = ANY(%s) AND kind = %s AND used_at = ''
                ORDER BY created_at
                """,
                (list(user_ids), kind),
            ).fetchall()
        return {row["user_id"]: UserTokenRecord(**row) for row in rows}

    def mark_token_used(self, token_id: str) -> None:
        with get_connection(self._db_url) as connection:
            connection.execute(
                "UPDATE user_token SET used_at = %s WHERE token_id = %s", (utc_now_iso(), token_id)
            )

    def revoke_tokens(self, *, user_id: str, kind: str) -> None:
        with get_connection(self._db_url) as connection:
            connection.execute(
                "UPDATE user_token SET used_at = %s "
                "WHERE user_id = %s AND kind = %s AND used_at = ''",
                (utc_now_iso(), user_id, kind),
            )

    # ── audit ──────────────────────────────────────────────────────────────

    def insert_audit(
        self, *, category: str, action_code: str, object_ref: str, actor_label: str, detail: str
    ) -> None:
        with get_connection(self._db_url) as connection:
            connection.execute(
                """
                INSERT INTO audit_record
                    (audit_id, category, action_code, object_ref, actor_label, detail, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    f"audit_{uuid4().hex[:12]}",
                    category,
                    action_code,
                    object_ref,
                    actor_label,
                    detail,
                    utc_now_iso(),
                ),
            )
