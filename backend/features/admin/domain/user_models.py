"""Admin > Users and Admin > Roles (PDP-251 ADM-02, ADM-03)."""

from pydantic import BaseModel, Field, field_validator

from features.auth.domain.models import _validate_email

# What the Users list shows in its status column. "Expired" is an invitation
# whose link has lapsed; the account still exists and can be re-invited.
INVITATION_INVITED = "Invited"
INVITATION_ACTIVE = "Active"
INVITATION_EXPIRED = "Expired"
INVITATION_INACTIVE = "Inactive"


class AdminUserSummary(BaseModel):
    user_id: str
    email: str
    display_name: str
    status: str
    invitation_status: str
    invitation_expires_at: str
    roles: list[str]
    must_change_password: bool
    last_login_at: str
    created_at: str
    updated_at: str


class AdminUsersResponse(BaseModel):
    items: list[AdminUserSummary]


class AdminUserResponse(BaseModel):
    user: AdminUserSummary


class InvitationIssued(AdminUserResponse):
    """The link is shown to the administrator once; only its hash is kept."""

    invitation_link: str
    expires_at: str


class PasswordResetIssued(AdminUserResponse):
    reset_link: str
    expires_at: str


def _clean_roles(roles: list[str]) -> list[str]:
    return sorted({role.strip() for role in roles if role.strip()})


class InviteUserCommand(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(default="", max_length=120)
    roles: list[str] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: str) -> str:
        return _validate_email(value)

    @field_validator("roles")
    @classmethod
    def _tidy_roles(cls, value: list[str]) -> list[str]:
        return _clean_roles(value)


class CreateUserCommand(InviteUserCommand):
    """Create an active account with a password the administrator chose."""

    password: str = Field(min_length=1)
    # On by default: the password the administrator typed is a first-use one.
    must_change_password: bool = True


class UpdateUserCommand(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class SetRolesCommand(BaseModel):
    roles: list[str] = Field(default_factory=list)

    @field_validator("roles")
    @classmethod
    def _tidy_roles(cls, value: list[str]) -> list[str]:
        return _clean_roles(value)


class RolePermission(BaseModel):
    area: str
    function: str
    roles: list[str]


class RoleDefinition(BaseModel):
    role_code: str
    label: str
    description: str
    active_users: int


class RolesResponse(BaseModel):
    roles: list[RoleDefinition]
    permissions: list[RolePermission]
