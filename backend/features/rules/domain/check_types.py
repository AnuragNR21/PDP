"""
What a rule can check, and what each check needs from the author.

The Rule Workspace is a library: a rule is written here once, on its own, and is
attached to a field later. So a rule has to be describable without a field in
front of it, which is what this catalogue is for — it says what each check does
and which parameters it accepts, and nothing else in the platform has to be
consulted to author one.

The catalogue is deliberately its own copy rather than an import from Discover.
Discover's checks are tied to how its engine reads a parsed file; borrowing them
would tie this workspace's shape to that engine, and a change on either side
would break the other. When the two are wired together, the attachment step is
where they meet.
"""
from __future__ import annotations

#: Parameter kinds the UI knows how to render.
PARAM_NUMBER = "number"
PARAM_TEXT = "text"
PARAM_LIST = "list"
PARAM_SELECT = "select"

#: Offered on every rule: how much failure is tolerated before it is a breach.
TOLERANCE_PARAM = {
    "name": "tolerance_percent",
    "label": "Tolerance (%)",
    "kind": PARAM_NUMBER,
    "required": False,
    "help": "Share of rows allowed to fail before the rule is reported as breached.",
}

#: Offered on every field check: values that mean "nobody answered yet".
#: A source system rarely leaves a cell empty — it writes "unknown" or
#: "not applicable" instead. Counting those as failures turns one missing-data
#: problem into a breach of every rule on the field, so a rule can name them
#: and leave those rows out of the count rather than fail them.
IGNORED_VALUES_PARAM = {
    "name": "ignored_values",
    "label": "Ignore these values",
    "kind": PARAM_LIST,
    "required": False,
    "help": "Left out of the check entirely, e.g. unknown, not applicable.",
}

#: Which shared parameters each scope accepts. Ignoring values reads one field's
#: values, so it means nothing to a check that looks at whole records.
SHARED_PARAMETERS = [TOLERANCE_PARAM, IGNORED_VALUES_PARAM]
SHARED_BY_SCOPE = {
    "field": [TOLERANCE_PARAM["name"], IGNORED_VALUES_PARAM["name"]],
    "dataset": [TOLERANCE_PARAM["name"]],
}

COMPARATORS = [
    {"key": "gt", "symbol": ">", "label": "greater than"},
    {"key": "gte", "symbol": ">=", "label": "at least"},
    {"key": "lt", "symbol": "<", "label": "less than"},
    {"key": "lte", "symbol": "<=", "label": "at most"},
    {"key": "eq", "symbol": "=", "label": "equal to"},
    {"key": "ne", "symbol": "!=", "label": "not equal to"},
]

DATE_FORMATS = [
    {"key": "any", "label": "Any recognised date"},
    {"key": "iso", "label": "ISO (YYYY-MM-DD)"},
    {"key": "dmy", "label": "Day/Month/Year"},
    {"key": "mdy", "label": "Month/Day/Year"},
    {"key": "month_year", "label": "Month and year"},
    {"key": "year", "label": "Year only"},
]

CHECK_TYPES: list[dict] = [
    {
        "check_type": "mandatory",
        "label": "Must be populated",
        "scope": "field",
        "summary": "Every row carries a value.",
        "parameters": [],
    },
    {
        "check_type": "unique",
        "label": "Must be unique",
        "scope": "field",
        "summary": "No value appears twice.",
        "parameters": [],
    },
    {
        "check_type": "allowed_values",
        "label": "One of an approved list",
        "scope": "field",
        "summary": "Values must come from a controlled vocabulary.",
        "parameters": [
            {
                # Not required here, because this is not where the list is
                # written any more. An approved list is chosen from a governed
                # vocabulary on the rule itself, so a rule carrying nothing in
                # this parameter is normal rather than unfinished — and the
                # rule service is what insists one of the two is present.
                "name": "allowed_values",
                "label": "Approved values",
                "kind": PARAM_LIST,
                "required": False,
                "help": "Chosen from a governed vocabulary on the rule.",
            },
        ],
    },
    {
        "check_type": "comparison",
        "label": "Compared against a number",
        "scope": "field",
        "summary": "A numeric value must satisfy an operator, e.g. at least 8.",
        "parameters": [
            {
                "name": "comparator",
                "label": "Operator",
                "kind": PARAM_SELECT,
                "required": True,
                "options": [{"key": c["key"], "label": f"{c['symbol']}  {c['label']}"} for c in COMPARATORS],
            },
            {"name": "value", "label": "Value", "kind": PARAM_NUMBER, "required": True},
        ],
    },
    {
        "check_type": "range",
        "label": "Within a range",
        "scope": "field",
        "summary": "A numeric value must sit between a minimum and a maximum.",
        "parameters": [
            {"name": "min", "label": "Minimum", "kind": PARAM_NUMBER, "required": False},
            {"name": "max", "label": "Maximum", "kind": PARAM_NUMBER, "required": False},
        ],
    },
    {
        "check_type": "format",
        "label": "Matches a pattern",
        "scope": "field",
        "summary": "Values must match a regular expression, e.g. ^[A-Z]{2}\\d{4}$.",
        "parameters": [
            {"name": "pattern", "label": "Pattern", "kind": PARAM_TEXT, "required": True},
        ],
    },
    {
        "check_type": "valid_date",
        "label": "Is a real date",
        "scope": "field",
        "summary": "Values must be dates, optionally in one stated shape.",
        "parameters": [
            {
                "name": "date_format",
                "label": "Date format",
                "kind": PARAM_SELECT,
                "required": False,
                "options": [{"key": f["key"], "label": f["label"]} for f in DATE_FORMATS],
            },
        ],
    },
    {
        "check_type": "duplicate_records",
        "label": "No duplicate records",
        "scope": "dataset",
        "summary": "Looks across the mapped fields together rather than one field.",
        "parameters": [],
    },
]

CHECK_TYPE_BY_KEY = {c["check_type"]: c for c in CHECK_TYPES}

#: The two ways to write a rule. A form covers the checks everyone needs; a
#: script covers the ones only the data team can express.
DEFINITION_KINDS = [
    {"key": "builtin", "label": "Standard check", "detail": "Pick a check and fill in what it needs."},
    {"key": "python", "label": "Custom Python script", "detail": "Write the check yourself, in the shape of an ESRI attribute rule."},
]

#: Categories are the team's own words, not ours. A fixed list would decide for
#: them how their rules are organised, and every organisation groups differently
#: — by system, by asset class, by the standard a rule answers to. So a category
#: is free text, and this is only what a library starts with when it is empty.
DEFAULT_CATEGORY = "Common"

#: The quality dimension a rule measures. Standard vocabulary, so a hundred
#: rules can still be reported as a handful of numbers a business recognises.
DIMENSIONS = [
    {"key": "completeness", "label": "Completeness", "detail": "Is the value there at all?"},
    {"key": "validity", "label": "Validity", "detail": "Is it a permitted value or shape?"},
    {"key": "uniqueness", "label": "Uniqueness", "detail": "Is it recorded only once?"},
    {"key": "consistency", "label": "Consistency", "detail": "Does it agree with the rest of the record?"},
    {"key": "accuracy", "label": "Accuracy", "detail": "Does it match the real world?"},
    {"key": "timeliness", "label": "Timeliness", "detail": "Is it current enough to rely on?"},
]

#: What kind of field a rule can be attached to. This is what lets Discover
#: offer only the rules that make sense for a field instead of the whole
#: library: a date rule has no business being offered for a description.
DATA_TYPES = [
    {"key": "any", "label": "Any field"},
    {"key": "text", "label": "Text"},
    {"key": "number", "label": "Number"},
    {"key": "date", "label": "Date"},
]

#: Which check suits which kind of field. A check that reads whole records is
#: not offered per field at all.
CHECK_DATA_TYPES = {
    "mandatory": ["any"],
    "unique": ["any"],
    "allowed_values": ["text", "number"],
    "comparison": ["number"],
    "range": ["number"],
    "format": ["text"],
    "valid_date": ["date", "text"],
    "duplicate_records": ["any"],
}

#: The dimension each check measures, offered as the default when authoring.
CHECK_DIMENSION = {
    "mandatory": "completeness",
    "unique": "uniqueness",
    "allowed_values": "validity",
    "comparison": "validity",
    "range": "validity",
    "format": "validity",
    "valid_date": "validity",
    "duplicate_records": "uniqueness",
}

#: What kind of execution a rule needs, which is a different question from
#: `scope`.
#:
#: `scope` is how the engine binds a check — one field's values, or whole
#: records — and is decided by the check type. This says what the check
#: *requires* in order to run at all, and the author sets it, because a
#: governed rule can be perfectly valid and describe work the engine cannot
#: do yet. Saying so is the point: the alternative is a rule that is silently
#: missing from every picker, which reads as "governance forgot it".
#:
#: `executable` is the engine's current reach, not a property of the rule. It
#: moves when the engine does.
EXECUTION_SCOPES = [
    {
        "key": "column",
        "label": "One column",
        "detail": "Reads the values of a single field.",
        "executable": True,
    },
    {
        "key": "row",
        "label": "One row",
        "detail": "Reads several fields of the same record.",
        "executable": True,
    },
    {
        "key": "multi_column",
        "label": "Several columns together",
        "detail": "Compares a combination of fields across the table.",
        "executable": True,
    },
    {
        "key": "cross_table",
        "label": "Across tables",
        "detail": "Needs another table in the session — a parent, a reference list.",
        "executable": False,
    },
    {
        "key": "cross_source",
        "label": "Across sources",
        "detail": "Needs a matching record in another source system.",
        "executable": False,
    },
    {
        "key": "aggregate",
        "label": "Over the whole population",
        "detail": "A judgement about the dataset rather than about a row.",
        "executable": False,
    },
    {
        "key": "historical",
        "label": "Against an earlier run",
        "detail": "Needs a baseline from a previous load to compare with.",
        "executable": False,
    },
]

EXECUTION_SCOPE_BY_KEY = {e["key"]: e for e in EXECUTION_SCOPES}
DEFAULT_EXECUTION_SCOPE = "column"

#: What each check needs when the author says nothing. Every builtin check the
#: engine has reads one field, except the duplicate check, which reads the
#: mapped fields together.
CHECK_EXECUTION_SCOPE = {
    "mandatory": "column",
    "unique": "column",
    "allowed_values": "column",
    "comparison": "column",
    "range": "column",
    "format": "column",
    "valid_date": "column",
    "duplicate_records": "multi_column",
}


def default_execution_scope(check_type: str, definition_kind: str = "builtin") -> str:
    """
    What a rule needs, before the author has said.

    A script is handed one field's value *and* its row, so it is a row check
    even when it only reads `value`.
    """
    if definition_kind == "python":
        return "row"
    return CHECK_EXECUTION_SCOPE.get(check_type, DEFAULT_EXECUTION_SCOPE)


def is_executable_scope(execution_scope: str) -> bool:
    """Whether the engine can run a rule of this shape today."""
    spec = EXECUTION_SCOPE_BY_KEY.get(execution_scope)
    return bool(spec and spec["executable"])


def execution_scope_label(execution_scope: str) -> str:
    spec = EXECUTION_SCOPE_BY_KEY.get(execution_scope)
    return spec["label"] if spec else execution_scope


SEVERITIES = [
    {"key": "low", "label": "Low"},
    {"key": "medium", "label": "Medium"},
    {"key": "high", "label": "High"},
]

STATUSES = [
    {"key": "draft", "label": "Draft"},
    {"key": "active", "label": "Active"},
    {"key": "retired", "label": "Retired"},
]


def catalogue(categories: list[str] | None = None) -> dict:
    """
    Everything the authoring form needs, in one read.

    `categories` are the ones already in use, offered as suggestions so a
    library does not drift into "GIS", "Gis" and "gis" meaning one thing.
    """
    from features.rules.domain import python_rules

    known = list(categories or [])
    if DEFAULT_CATEGORY not in known:
        known.append(DEFAULT_CATEGORY)

    return {
        "default_category": DEFAULT_CATEGORY,
        "definition_kinds": DEFINITION_KINDS,
        "python": python_rules.authoring_help(),
        "check_types": [
            {
                **check,
                "shared": SHARED_BY_SCOPE.get(check["scope"], []),
                "data_types": CHECK_DATA_TYPES.get(check["check_type"], ["any"]),
                "dimension": CHECK_DIMENSION.get(check["check_type"], "validity"),
                "execution_scope": default_execution_scope(check["check_type"]),
            }
            for check in CHECK_TYPES
        ],
        "dimensions": DIMENSIONS,
        "data_types": DATA_TYPES,
        "execution_scopes": EXECUTION_SCOPES,
        "categories": sorted(known, key=str.lower),
        "shared_parameters": SHARED_PARAMETERS,
        "severities": SEVERITIES,
        "statuses": STATUSES,
        "tolerance_parameter": TOLERANCE_PARAM,
    }


def validate_parameters(check_type: str, parameters: dict) -> dict:
    """
    Keep only the parameters this check declares, and insist on the required ones.

    Unknown keys are dropped rather than rejected: a rule edited after its check
    type changed would otherwise carry parameters nobody can see or remove.
    """
    spec = CHECK_TYPE_BY_KEY.get(check_type)
    if spec is None:
        raise ValueError(f"'{check_type}' is not a check this workspace can run.")

    allowed = {p["name"]: p for p in spec["parameters"]}
    for shared in SHARED_PARAMETERS:
        if shared["name"] in SHARED_BY_SCOPE.get(spec["scope"], []):
            allowed[shared["name"]] = shared

    cleaned: dict = {}
    for name, param in allowed.items():
        value = parameters.get(name)
        if param["kind"] == PARAM_LIST:
            values = value if isinstance(value, list) else []
            values = [str(v).strip() for v in values if str(v).strip()]
            if values:
                cleaned[name] = values
        elif param["kind"] == PARAM_NUMBER:
            if value is not None and str(value).strip() != "":
                try:
                    cleaned[name] = float(value)
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"{param['label']} must be a number.") from exc
        else:
            text = "" if value is None else str(value).strip()
            if text:
                cleaned[name] = text

        if param["required"] and name not in cleaned:
            raise ValueError(f"{param['label']} is required for '{spec['label']}'.")

    tolerance = cleaned.get(TOLERANCE_PARAM["name"])
    if tolerance is not None and not 0 <= tolerance <= 100:
        raise ValueError("Tolerance must be between 0 and 100 percent.")

    if check_type == "range" and "min" not in cleaned and "max" not in cleaned:
        raise ValueError("Set a minimum, a maximum, or both.")
    if check_type == "range" and {"min", "max"} <= cleaned.keys() and cleaned["min"] > cleaned["max"]:
        raise ValueError("The minimum cannot be greater than the maximum.")

    return cleaned


def describe(check_type: str, parameters: dict) -> str:
    """One line stating what the rule requires, for the library list."""
    spec = CHECK_TYPE_BY_KEY.get(check_type)
    if spec is None:
        return check_type
    ignored = parameters.get(IGNORED_VALUES_PARAM["name"]) or []
    suffix = f" · ignores {', '.join(ignored)}" if ignored else ""
    return _statement(check_type, parameters, spec) + suffix


def _statement(check_type: str, parameters: dict, spec: dict) -> str:
    if check_type == "comparison":
        symbol = next(
            (c["symbol"] for c in COMPARATORS if c["key"] == parameters.get("comparator")),
            parameters.get("comparator", ""),
        )
        return f"Value {symbol} {_number(parameters.get('value'))}".strip()
    if check_type == "allowed_values":
        values = parameters.get("allowed_values") or []
        shown = ", ".join(values[:3])
        return f"One of: {shown}" + (f" (+{len(values) - 3} more)" if len(values) > 3 else "")
    if check_type == "range":
        low, high = parameters.get("min"), parameters.get("max")
        if low is not None and high is not None:
            return f"Between {_number(low)} and {_number(high)}"
        if low is not None:
            return f"At least {_number(low)}"
        return f"At most {_number(high)}"
    if check_type == "format":
        return f"Matches {parameters.get('pattern', '')}"
    if check_type == "valid_date":
        shape = parameters.get("date_format") or "any"
        label = next((f["label"] for f in DATE_FORMATS if f["key"] == shape), shape)
        return f"A real date — {label}"
    return spec["summary"]


def _number(value) -> str:
    if value is None:
        return ""
    number = float(value)
    return str(int(number)) if number.is_integer() else str(number)
