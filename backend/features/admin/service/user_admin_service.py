"""What an administrator does to other people's accounts (PDP-251 ADM-02, ADM-03).

Invitations and reset links are handed back to the administrator to pass on
rather than emailed: the platform has no mail sender yet, and the link is the
only copy — the database keeps its hash.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.config import Settings
from features.admin.domain.user_models import (
    INVITATION_ACTIVE,
    INVITATION_EXPIRED,
    INVITATION_INACTIVE,
    INVITATION_INVITED,
    AdminUserSummary,
    RoleDefinition,
    RolePermission,
    RolesResponse,
)
from features.auth.service.auth_service import AuthError, _is_expired
from shared.auth.dependencies import CurrentUser
from shared.auth.passwords import hash_password, password_policy_error
from shared.auth.roles import (
    ALL_ROLES,
    PERMISSION_MATRIX,
    ROLE_DESCRIPTIONS,
    ROLE_LABELS,
    SUPER_ADMIN,
    is_administrator,
    is_known_role,
)
from shared.auth.tokens import hash_one_time_token, new_one_time_token
from shared.auth.user_repository import (
    STATUS_ACTIVE,
    STATUS_INACTIVE,
    STATUS_INVITED,
    TOKEN_KIND_INVITE,
    TOKEN_KIND_RESET,
    UserRecord,
    UserRepository,
    UserTokenRecord,
    normalise_email,
)

AUDIT_CATEGORY = "admin"


def _invitation_status(user: UserRecord, token: UserTokenRecord | None) -> tuple[str, str]:
    """(status label, expiry) for the Users list."""
    if user.status == STATUS_ACTIVE:
        return INVITATION_ACTIVE, ""
    if user.status == STATUS_INACTIVE:
        return INVITATION_INACTIVE, ""
    if token is None or _is_expired(token.expires_at):
        return INVITATION_EXPIRED, token.expires_at if token else ""
    return INVITATION_INVITED, token.expires_at


class UserAdminService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._repository = UserRepository(settings.database_url)

    # ── reading ────────────────────────────────────────────────────────────

    def list_users(
        self, *, search: str = "", status: str = "", role: str = ""
    ) -> list[AdminUserSummary]:
        users = self._repository.list_users()
        roles = self._repository.roles_for_many([user.user_id for user in users])
        tokens = self._repository.live_tokens_for_many(
            user_ids=[user.user_id for user in users], kind=TOKEN_KIND_INVITE
        )
        needle = search.strip().lower()
        items: list[AdminUserSummary] = []
        for user in users:
            summary = self._summary(user, roles.get(user.user_id, []), tokens.get(user.user_id))
            if needle and needle not in user.email and needle not in user.display_name.lower():
                continue
            if status and summary.invitation_status.lower() != status.strip().lower():
                continue
            if role and role not in summary.roles:
                continue
            items.append(summary)
        return items

    def get_user(self, user_id: str) -> AdminUserSummary:
        user = self._require_user(user_id)
        return self._summary(
            user,
            self._repository.roles_for(user.user_id),
            self._repository.latest_token_for(user_id=user.user_id, kind=TOKEN_KIND_INVITE),
        )

    def roles(self) -> RolesResponse:
        return RolesResponse(
            roles=[
                RoleDefinition(
                    role_code=code,
                    label=ROLE_LABELS[code],
                    description=ROLE_DESCRIPTIONS[code],
                    active_users=self._repository.count_active_users_with_role(code),
                )
                for code in ALL_ROLES
            ],
            permissions=[
                RolePermission(
                    area=str(entry["area"]),
                    function=str(entry["function"]),
                    # Super Admin may do everything, so it ticks every row.
                    roles=[SUPER_ADMIN, *entry["roles"]],  # type: ignore[list-item]
                )
                for entry in PERMISSION_MATRIX
            ],
        )

    # ── invitations ────────────────────────────────────────────────────────

    def invite(
        self, actor: CurrentUser, *, email: str, display_name: str, roles: list[str]
    ) -> tuple[AdminUserSummary, str, str]:
        email = normalise_email(email)
        self._check_roles(roles)
        existing = self._repository.get_by_email(email)
        if existing is not None:
            raise AuthError(f"{email} already has an account.", 409)
        user = self._repository.create_user(
            email=email,
            display_name=display_name.strip() or email.split("@")[0],
            status=STATUS_INVITED,
        )
        self._repository.set_roles(user.user_id, roles, assigned_by=actor.actor_label)
        link, expires_at = self._issue_invitation(user, actor)
        self._audit(
            "user.invited",
            user.user_id,
            actor,
            f"{actor.actor_label} invited {email} with roles {self._role_text(roles)}.",
        )
        return self.get_user(user.user_id), link, expires_at

    def create_user(
        self,
        actor: CurrentUser,
        *,
        email: str,
        display_name: str,
        password: str,
        roles: list[str],
        must_change_password: bool,
    ) -> AdminUserSummary:
        email = normalise_email(email)
        self._check_roles(roles)
        problem = password_policy_error(password)
        if problem:
            raise AuthError(problem)
        if self._repository.get_by_email(email) is not None:
            raise AuthError(f"{email} already has an account.", 409)
        user = self._repository.create_user(
            email=email,
            display_name=display_name.strip() or email.split("@")[0],
            status=STATUS_ACTIVE,
            password_hash=hash_password(password),
            must_change_password=must_change_password,
        )
        self._repository.set_roles(user.user_id, roles, assigned_by=actor.actor_label)
        self._audit(
            "user.created",
            user.user_id,
            actor,
            f"{actor.actor_label} created {email} with roles {self._role_text(roles)}"
            + (" (must change password at first sign-in)." if must_change_password else "."),
        )
        return self.get_user(user.user_id)

    def resend_invitation(
        self, actor: CurrentUser, user_id: str
    ) -> tuple[AdminUserSummary, str, str]:
        user = self._require_user(user_id)
        if user.status != STATUS_INVITED:
            raise AuthError("Only an account that has not yet signed in can be re-invited.", 409)
        link, expires_at = self._issue_invitation(user, actor)
        self._audit(
            "user.invitation_resent",
            user.user_id,
            actor,
            f"{actor.actor_label} issued a new invitation link for {user.email}.",
        )
        return self.get_user(user.user_id), link, expires_at

    def cancel_invitation(self, actor: CurrentUser, user_id: str) -> None:
        user = self._require_user(user_id)
        if user.status != STATUS_INVITED:
            raise AuthError("Only an outstanding invitation can be cancelled.", 409)
        # The person never signed in, so there is nothing of theirs to keep;
        # removing the row frees the email for a later invitation.
        self._repository.delete_user(user.user_id)
        self._audit(
            "user.invitation_cancelled",
            user.user_id,
            actor,
            f"{actor.actor_label} cancelled the invitation for {user.email}.",
        )

    def issue_password_reset(
        self, actor: CurrentUser, user_id: str
    ) -> tuple[AdminUserSummary, str, str]:
        user = self._require_user(user_id)
        if user.status != STATUS_ACTIVE:
            raise AuthError("Only an active account can have its password reset.", 409)
        raw = new_one_time_token()
        expires_at = (
            datetime.now(UTC) + timedelta(hours=self._settings.password_reset_hours)
        ).isoformat()
        self._repository.create_token(
            user_id=user.user_id,
            kind=TOKEN_KIND_RESET,
            token_hash=hash_one_time_token(raw),
            expires_at=expires_at,
            created_by=actor.actor_label,
        )
        self._audit(
            "password.reset_issued",
            user.user_id,
            actor,
            f"{actor.actor_label} issued a password reset link for {user.email}.",
        )
        link = f"{self._settings.frontend_base_url.rstrip('/')}/reset-password/{raw}"
        return self.get_user(user.user_id), link, expires_at

    # ── editing ────────────────────────────────────────────────────────────

    def update_user(
        self, actor: CurrentUser, user_id: str, *, display_name: str
    ) -> AdminUserSummary:
        user = self._require_user(user_id)
        display_name = display_name.strip()
        if not display_name:
            raise AuthError("Display name cannot be empty.")
        if display_name != user.display_name:
            self._repository.update_profile(user.user_id, display_name=display_name)
            self._audit(
                "user.updated",
                user.user_id,
                actor,
                f"{actor.actor_label} renamed {user.email} from "
                f"'{user.display_name}' to '{display_name}'.",
            )
        return self.get_user(user.user_id)

    def set_roles(self, actor: CurrentUser, user_id: str, roles: list[str]) -> AdminUserSummary:
        user = self._require_user(user_id)
        self._check_roles(roles)
        before = self._repository.roles_for(user.user_id)
        if is_administrator(before) and not is_administrator(roles):
            if user.user_id == actor.user_id:
                raise AuthError("You cannot remove your own administrator role.", 409)
            self._check_not_last_admin(user)
        if sorted(before) != sorted(roles):
            self._repository.set_roles(user.user_id, roles, assigned_by=actor.actor_label)
            self._audit(
                "user.roles_changed",
                user.user_id,
                actor,
                f"{actor.actor_label} changed {user.email}'s roles from "
                f"{self._role_text(before)} to {self._role_text(roles)}.",
            )
        return self.get_user(user.user_id)

    def activate(self, actor: CurrentUser, user_id: str) -> AdminUserSummary:
        user = self._require_user(user_id)
        if user.status == STATUS_INVITED:
            raise AuthError(
                "This person has not accepted their invitation yet. Resend it instead.", 409
            )
        if user.status != STATUS_ACTIVE:
            self._repository.set_status(user.user_id, STATUS_ACTIVE)
            self._audit(
                "user.activated",
                user.user_id,
                actor,
                f"{actor.actor_label} activated {user.email}.",
            )
        return self.get_user(user.user_id)

    def deactivate(self, actor: CurrentUser, user_id: str) -> AdminUserSummary:
        user = self._require_user(user_id)
        if user.user_id == actor.user_id:
            raise AuthError("You cannot deactivate your own account.", 409)
        if user.status == STATUS_INVITED:
            raise AuthError("Cancel the invitation instead of deactivating it.", 409)
        if user.status == STATUS_ACTIVE:
            if is_administrator(self._repository.roles_for(user.user_id)):
                self._check_not_last_admin(user)
            self._repository.set_status(user.user_id, STATUS_INACTIVE)
            # A deactivated person cannot use a reset link either.
            self._repository.revoke_tokens(user_id=user.user_id, kind=TOKEN_KIND_RESET)
            self._audit(
                "user.deactivated",
                user.user_id,
                actor,
                f"{actor.actor_label} deactivated {user.email}.",
            )
        return self.get_user(user.user_id)

    # ── helpers ────────────────────────────────────────────────────────────

    def _issue_invitation(self, user: UserRecord, actor: CurrentUser) -> tuple[str, str]:
        raw = new_one_time_token()
        expires_at = (
            datetime.now(UTC) + timedelta(days=self._settings.invitation_days)
        ).isoformat()
        self._repository.create_token(
            user_id=user.user_id,
            kind=TOKEN_KIND_INVITE,
            token_hash=hash_one_time_token(raw),
            expires_at=expires_at,
            created_by=actor.actor_label,
        )
        link = f"{self._settings.frontend_base_url.rstrip('/')}/accept-invitation/{raw}"
        return link, expires_at

    def _summary(
        self, user: UserRecord, roles: list[str], token: UserTokenRecord | None
    ) -> AdminUserSummary:
        invitation_status, expires_at = _invitation_status(user, token)
        return AdminUserSummary(
            user_id=user.user_id,
            email=user.email,
            display_name=user.display_name,
            status=user.status,
            invitation_status=invitation_status,
            invitation_expires_at=expires_at,
            roles=roles,
            must_change_password=user.must_change_password,
            last_login_at=user.last_login_at,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )

    def _require_user(self, user_id: str) -> UserRecord:
        user = self._repository.get_by_id(user_id)
        if user is None:
            raise AuthError("No such user.", 404)
        return user

    def _check_roles(self, roles: list[str]) -> None:
        unknown = [role for role in roles if not is_known_role(role)]
        if unknown:
            raise AuthError(f"Unknown role: {', '.join(unknown)}.")

    def _check_not_last_admin(self, user: UserRecord) -> None:
        if user.status == STATUS_ACTIVE and self._repository.count_active_administrators() <= 1:
            raise AuthError("This is the only active administrator; add another first.", 409)

    @staticmethod
    def _role_text(roles: list[str]) -> str:
        return ", ".join(ROLE_LABELS.get(role, role) for role in sorted(roles)) or "none"

    def _audit(self, action_code: str, object_ref: str, actor: CurrentUser, detail: str) -> None:
        self._repository.insert_audit(
            category=AUDIT_CATEGORY,
            action_code=action_code,
            object_ref=object_ref,
            actor_label=actor.actor_label,
            detail=detail,
        )
