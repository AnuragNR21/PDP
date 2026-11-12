"""The fixed roles PDP-251 defines, and the feature each one unlocks.

Admin is administration only: it does not imply any of the three working
roles, so a person who both administers and models holds two roles. Super
Admin is the exception: it passes every role check, and is what the seeded
first account holds so a fresh tenant can do anything from the start.
"""

SUPER_ADMIN = "super_admin"
ADMIN = "admin"
MODEL_AUTHOR = "model_author"
STRUCTURE_EDITOR = "structure_editor"
ANALYST = "analyst"

ALL_ROLES: tuple[str, ...] = (SUPER_ADMIN, ADMIN, MODEL_AUTHOR, STRUCTURE_EDITOR, ANALYST)

# Either of these makes someone an administrator.
ADMIN_ROLES: tuple[str, ...] = (SUPER_ADMIN, ADMIN)

ROLE_LABELS: dict[str, str] = {
    SUPER_ADMIN: "Super Admin",
    ADMIN: "Admin",
    MODEL_AUTHOR: "Model Author",
    STRUCTURE_EDITOR: "Structure Editor",
    ANALYST: "Analyst",
}

ROLE_DESCRIPTIONS: dict[str, str] = {
    SUPER_ADMIN: "Every permission: administration plus all of the working roles.",
    ADMIN: "Manage users, roles and application administration.",
    MODEL_AUTHOR: "Create and maintain model definitions in the Model Workspace.",
    STRUCTURE_EDITOR: "Create and maintain instances and relationships in the Structure Workspace.",
    ANALYST: "Perform data profiling, mapping and quality assessment in the Discover Workspace.",
}


def is_known_role(role_code: str) -> bool:
    return role_code in ALL_ROLES


def grants(held: list[str], role_code: str) -> bool:
    """Whether the roles someone holds satisfy a check for `role_code`."""
    return SUPER_ADMIN in held or role_code in held


def is_administrator(held: list[str]) -> bool:
    return any(role in held for role in ADMIN_ROLES)


# The read-only permissions matrix (ADM-03). Each function names the roles
# that may change it; every active user may view all of them. This mirrors
# how app/router.py gates the routers, and is what Admin > Roles displays.
PERMISSION_MATRIX: tuple[dict[str, object], ...] = (
    {
        "area": "Model Workspace (MWS)",
        "function": "Create, edit and delete model definitions",
        "roles": (MODEL_AUTHOR,),
    },
    {
        "area": "Structure Workspace (SWS)",
        "function": "Create, edit and delete instances and relationships",
        "roles": (STRUCTURE_EDITOR,),
    },
    {
        "area": "Discover Workspace (DWS)",
        "function": "Run data profiling, mapping and quality assessment",
        "roles": (ANALYST,),
    },
    {
        "area": "Rules, Impact and Improve",
        "function": "Create and edit rules, assessments and work programs",
        "roles": (ANALYST,),
    },
    {
        "area": "Export",
        "function": "Produce exports and summaries",
        "roles": (ANALYST,),
    },
    {
        "area": "Organisation settings",
        "function": "Change organisation-wide defaults and ownership",
        "roles": (ADMIN,),
    },
    {
        "area": "Admin Workspace",
        "function": "Invite, edit, activate and deactivate users; assign roles",
        "roles": (ADMIN,),
    },
    {
        "area": "Admin Workspace",
        "function": "View the audit log and application information",
        "roles": (ADMIN,),
    },
)
