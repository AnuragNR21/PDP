from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings for the PDP backend foundation."""

    model_config = SettingsConfigDict(
        env_prefix="PDP_",
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "Power Data Platform API"
    app_version: str = "0.3.0"
    api_prefix: str = "/api"
    environment: str = Field(default="development")
    log_level: str = Field(default="INFO")
    database_url: str = Field(default="postgresql://localhost/pdp")
    allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            # `vite preview`, which the Playwright smoke suite serves the build from.
            "http://localhost:4173",
            "http://127.0.0.1:4173",
            "https://master.d211z5zlnjzk1b.amplifyapp.com",
        ]
    )
    localhost_ip_whitelist: list[str] = Field(
        default_factory=list,
        description="Client IPs allowed to call the API from loopback addresses (e.g. 127.0.0.1).",
    )

    # ── Authentication (PDP-251) ─────────────────────────────────────────
    jwt_secret: str = Field(
        default="pdp-dev-only-secret-change-me-before-deploying-anywhere",
        description="HS256 signing key for access tokens. Set a long random value per deployment.",
    )
    jwt_hours: int = Field(default=8, description="Access token lifetime in hours.")
    bootstrap_superadmin_email: str = Field(
        default="admin@solutionadvisor.com.au",
        description="Seeded as Super Admin on startup when nobody holds that role.",
    )
    bootstrap_superadmin_password: str = Field(
        default="OYmjnBUtEsOS",
        description="First-use password for the seeded Super Admin; changed at first login.",
    )
    # Public address of the frontend, used to build invitation and reset links.
    frontend_base_url: str = Field(default="http://localhost:5173")
    invitation_days: int = Field(default=7, description="Days an invitation link stays valid.")
    password_reset_hours: int = Field(
        default=2, description="Hours a password reset link stays valid."
    )

    # ── Build / deployment information (Admin > Application Information) ──
    build_id: str = Field(
        default="", description="Release or build identifier, e.g. the pipeline build number."
    )
    build_commit: str = Field(default="", description="Git commit the image was built from.")
    build_time: str = Field(default="", description="When the image was built, ISO-8601.")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
