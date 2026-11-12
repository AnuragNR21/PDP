import re

from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: str) -> str:
    value = value.strip().lower()
    if not _EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address.")
    return value


class _EmailCommand(BaseModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: str) -> str:
        return _validate_email(value)


class UserProfile(BaseModel):
    user_id: str
    email: str
    display_name: str
    roles: list[str]
    must_change_password: bool
    last_login_at: str


class LoginCommand(_EmailCommand):
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_seconds: int
    user: UserProfile


class MeResponse(BaseModel):
    user: UserProfile


class UpdateProfileCommand(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class ChangePasswordCommand(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class ForgotPasswordCommand(_EmailCommand):
    pass


class ResetPasswordCommand(BaseModel):
    token: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class AcceptInvitationCommand(BaseModel):
    token: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1)


class InvitationPreview(BaseModel):
    """What the invitation page shows before the person chooses a password."""

    email: str
    display_name: str
    expires_at: str
