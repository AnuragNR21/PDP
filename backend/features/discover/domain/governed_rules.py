"""
The checks a Discover session can run.

There is no rule catalogue here and nothing is seeded into the database. A rule
does not exist until somebody builds one in the Rule Builder out of a Support
Domain model, a cross-model relationship, an operator and a value; what this
module holds is only the *checks* those choices can produce, and the parameters
each of them accepts.

That distinction matters. A pre-seeded catalogue put rules in every session that
nobody had chosen and nobody could account for — "where did this come from?" had
no answer, which is exactly the question an evidence record has to survive. Now
every rule in a session traces back to a person and a governed relationship.

  mandatory          the field carries a value
  unique             no two rows repeat a value
  valid_date         the value is a real calendar date
  duplicate_records  the mapped fields together do not repeat a record
  comparison         a populated value measured against one number
  allowed_values     a populated value drawn from an approved list

The first four need nothing from the person beyond the field they apply to. A
governed rule that says "Pole ID must be unique" has already said everything;
asking for an operator and a number there would be asking a question with no
answer.
"""
from __future__ import annotations

RULE_KIND_PROFILE = "profile"
RULE_KIND_DQ = "dq"
RULE_KIND_BQ = "bq"

#: Scope a rule is evaluated at.
SCOPE_FIELD = "field"
SCOPE_DATASET = "dataset"


def _param(
    key: str,
    label: str,
    kind: str,
    default=None,
    help_text: str = "",
    options: list[dict] | None = None,
) -> dict:
    """
    One thing a session is permitted to set on a rule. `options` turns the
    parameter into a fixed choice, so a convention like an operator is picked
    from the ones the checker actually understands rather than typed freehand.
    """
    return {
        "key": key,
        "label": label,
        "type": kind,
        "default": default,
        "help": help_text,
        "options": options or [],
    }


#: The two checks the Rule Builder can produce, keyed by `check_type`.
#:
#: These are definitions, not rows: nothing here is written to `governed_rule`
#: at start-up. A built rule copies the parameter contract it needs out of the
#: matching entry, so what a session stores is self-contained and keeps working
#: even if this file later changes.
BUILDER_CHECKS: list[dict] = [
    {
        "code": "BUILT-COMPARISON",
        "rule_kind": RULE_KIND_DQ,
        "name": "Value compared against a number",
        "description": (
            "Every populated value must satisfy a comparison against a single number — "
            "at least 8, under 100, not equal to 0."
        ),
        "check_type": "comparison",
        "applies_to": SCOPE_FIELD,
        "severity": "high",
        "requires_parameters": True,
        "permitted_parameters": [
            _param("comparator", "Comparison", "choice", "gte",
                   "Which way the value is compared against the number.",
                   options=[
                       {"value": "gt", "label": "> is greater than"},
                       {"value": "gte", "label": ">= is at least"},
                       {"value": "lt", "label": "< is less than"},
                       {"value": "lte", "label": "<= is at most"},
                       {"value": "eq", "label": "= equals"},
                       {"value": "ne", "label": "!= does not equal"},
                   ]),
            _param("value", "Compared against", "number", None,
                   "The number every populated value is measured against."),
            _param("tolerance_percent", "Tolerance (%)", "number", 0,
                   "Share of values that may fail the comparison before the rule fails."),
        ],
        "default_parameters": {"comparator": "gte", "value": None, "tolerance_percent": 0},
    },
    {
        "code": "BUILT-ALLOWED-VALUES",
        "rule_kind": RULE_KIND_DQ,
        "name": "Value drawn from an approved list",
        "description": "Every populated value must come from an approved list.",
        "check_type": "allowed_values",
        "applies_to": SCOPE_FIELD,
        "severity": "high",
        "requires_parameters": True,
        "permitted_parameters": [
            _param("allowed_values", "Accepted values", "list", [],
                   "Comma-separated list of accepted values, e.g. Metal, Wood, Plastic."),
            _param("case_sensitive", "Case sensitive", "boolean", False),
        ],
        "default_parameters": {"allowed_values": [], "case_sensitive": False},
    },
    {
        "code": "BUILT-MANDATORY",
        "rule_kind": RULE_KIND_DQ,
        "name": "Value must be populated",
        "description": "Every row must carry a value for this field.",
        "check_type": "mandatory",
        "applies_to": SCOPE_FIELD,
        "severity": "high",
        "requires_parameters": False,
        "permitted_parameters": [
            _param("tolerance_percent", "Tolerance (%)", "number", 0,
                   "Share of missing values accepted before the rule fails."),
        ],
        "default_parameters": {"tolerance_percent": 0},
    },
    {
        "code": "BUILT-UNIQUE",
        "rule_kind": RULE_KIND_DQ,
        "name": "Value must be unique",
        "description": "No two rows may repeat a value in this field.",
        "check_type": "unique",
        "applies_to": SCOPE_FIELD,
        "severity": "high",
        "requires_parameters": False,
        "permitted_parameters": [
            _param("tolerance_percent", "Tolerance (%)", "number", 0,
                   "Share of repeated values accepted before the rule fails."),
        ],
        "default_parameters": {"tolerance_percent": 0},
    },
    {
        "code": "BUILT-VALID-DATE",
        "rule_kind": RULE_KIND_DQ,
        "name": "Value must be a real date",
        "description": (
            "Every populated value must be a real calendar date. Judged against the "
            "calendar rather than a pattern, so 31/02/2026 fails even though it has "
            "the shape of a date."
        ),
        "check_type": "valid_date",
        "applies_to": SCOPE_FIELD,
        "severity": "high",
        "requires_parameters": False,
        "permitted_parameters": [
            _param("date_format", "Date format", "choice", "any",
                   "Which convention this field is written in. 04/28/2026 is a real "
                   "date read month-first and nonsense read day-first, so the field "
                   "has to say which it uses.",
                   options=[
                       {"value": "any", "label": "Any recognised format"},
                       {"value": "iso", "label": "YYYY-MM-DD"},
                       {"value": "dmy", "label": "DD-MM-YYYY (day first)"},
                       {"value": "mdy", "label": "MM-DD-YYYY (month first)"},
                       {"value": "month_year", "label": "MM-YYYY or YYYY-MM"},
                       {"value": "year", "label": "YYYY (year only)"},
                   ]),
            _param("tolerance_percent", "Tolerance (%)", "number", 0,
                   "Share of unparseable dates accepted before the rule fails."),
        ],
        "default_parameters": {"date_format": "any", "tolerance_percent": 0},
    },
    {
        "code": "BUILT-DUPLICATE-RECORDS",
        "rule_kind": RULE_KIND_DQ,
        "name": "No duplicate records",
        "description": "The mapped fields together must not repeat the same record.",
        "check_type": "duplicate_records",
        "applies_to": SCOPE_DATASET,
        "severity": "medium",
        "requires_parameters": False,
        "permitted_parameters": [
            _param("tolerance_percent", "Tolerance (%)", "number", 0),
        ],
        "default_parameters": {"tolerance_percent": 0},
    },
]

BUILDER_CHECK_BY_TYPE = {check["check_type"]: check for check in BUILDER_CHECKS}
