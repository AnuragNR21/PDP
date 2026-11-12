"""
Predefined relationship type templates — shared/contracts/cross_model_relationship_type_options.py

These are curated suggestions offered to users when creating a new
cross-model relationship type.  They are returned by the API and used in
the frontend to pre-fill the name and description fields.
"""

RELATIONSHIP_TYPE_TEMPLATES: list[dict] = [
    {
        "name": "Categorises",
        "description": "The source classifies or groups the target into a category.",
    },
    {
        "name": "Classifies",
        "description": "The source assigns a classification scheme or label to the target.",
    },
    {
        "name": "Governs",
        "description": "The source defines governance rules or policies that apply to the target.",
    },
    {
        "name": "Accountable for",
        "description": "The source instance is ultimately accountable for the target.",
    },
    {
        "name": "Responsible for",
        "description": "The source instance is operationally responsible for the target.",
    },
    {
        "name": "Owns",
        "description": "The source has ownership of the target.",
    },
    {
        "name": "Manages",
        "description": "The source manages or oversees the target.",
    },
    {
        "name": "Stewards",
        "description": "The source acts as data steward for the target.",
    },
    {
        "name": "Produces",
        "description": "The source produces or generates the target as an output.",
    },
    {
        "name": "Consumes",
        "description": "The source uses or depends on the target as an input.",
    },
    {
        "name": "Reports to",
        "description": "The source reports metrics or status to the target.",
    },
    {
        "name": "Delegates to",
        "description": "The source delegates a responsibility or task to the target.",
    },
    {
        "name": "Applies to",
        "description": "The source rule, policy, or standard applies to the target.",
    },
    {
        "name": "Has threshold",
        "description": "The source defines a measurable threshold or limit for the target.",
    },
    {
        "name": "Defines",
        "description": "The source provides the authoritative definition for the target.",
    },
    {
        "name": "Maps to",
        "description": "The source is mapped or correlated to the target.",
    },
    {
        "name": "Audits",
        "description": "The source performs auditing or review of the target.",
    },
    {
        "name": "Monitors",
        "description": "The source tracks or monitors the target over time.",
    },
    {
        "name": "Depends on",
        "description": "The source has a dependency on the target.",
    },
    {
        "name": "Supports",
        "description": "The source supports or enables the target.",
    },
]
