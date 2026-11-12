"""
The Rule Builder — the only way a rule enters a Discover session.

A rule is not picked off a shelf here and it is not written free-hand. It is
assembled out of governed parts:

    a Support Domain model      which body of governance this comes from
    a cross-model relationship  what that governance binds to, and therefore
                                which mapped field the rule lands on
    a comparator and a value    the condition the field must satisfy

The cross-model relationship is what makes the rule governed rather than
invented. It already says "this governed concept applies to that model type";
Discover has already mapped columns onto instances of that type. So the
relationship, not the user, decides which field a rule may be set on — the user
only says what must be true of it.

Everything a session may build is expressed here, so there is exactly one place
that decides what a comparator means.
"""
from __future__ import annotations

#: Numeric comparators, in the order a person reads them on screen.
#:
#: `symbol` is what the user picks; `sql` is what the check evaluates. They are
#: kept apart because `=` and `!=` are written differently in SQL, and a rule
#: that silently changed meaning between the two would be unauditable.
COMPARATORS: list[dict] = [
    {"key": "gt", "symbol": ">", "label": "is greater than", "sql": ">"},
    {"key": "gte", "symbol": ">=", "label": "is at least", "sql": ">="},
    {"key": "lt", "symbol": "<", "label": "is less than", "sql": "<"},
    {"key": "lte", "symbol": "<=", "label": "is at most", "sql": "<="},
    {"key": "eq", "symbol": "=", "label": "equals", "sql": "="},
    {"key": "ne", "symbol": "!=", "label": "does not equal", "sql": "<>"},
]

COMPARATOR_BY_KEY = {c["key"]: c for c in COMPARATORS}

#: The comparator that is not a comparison at all. A field whose governance is a
#: controlled vocabulary — Metal, Wood, Plastic — is checked against a list, not
#: against a number, so it is offered beside the numeric operators and routed to
#: the allowed-values check instead.
LIST_COMPARATOR = {
    "key": "in",
    "symbol": "in",
    "label": "is one of",
    "sql": None,
}

ALL_COMPARATORS = COMPARATORS + [LIST_COMPARATOR]


def comparator_sql(key: str) -> str:
    """The SQL operator for a numeric comparator, or an error naming the key."""
    entry = COMPARATOR_BY_KEY.get(key)
    if entry is None:
        raise ValueError(f"'{key}' is not a comparator a rule can be built from.")
    return entry["sql"]


def comparator_symbol(key: str) -> str:
    if key == LIST_COMPARATOR["key"]:
        return LIST_COMPARATOR["symbol"]
    entry = COMPARATOR_BY_KEY.get(key)
    return entry["symbol"] if entry else key


def parse_value_list(raw) -> list[str]:
    """
    Read a controlled vocabulary the way a person types one: `Metal, Wood,
    Plastic`. A list that arrives already split is respected as-is, so the
    frontend may send either.

    Splitting happens once, here, at save time — never on every keystroke, which
    is what made the comma impossible to type in the first place.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        items = [str(item).strip() for item in raw]
    else:
        items = [item.strip() for item in str(raw).split(",")]
    seen, result = set(), []
    for item in items:
        if not item or item.lower() in seen:
            continue
        seen.add(item.lower())
        result.append(item)
    return result


#: What each check needs from the person before it can run.
#:
#: This is the table that makes the builder usable. A governed rule named
#: "Pole ID must be unique" needs nothing beyond the field — asking for an
#: operator and a number there is asking a question with no answer, and that is
#: exactly what the earlier builder did to every rule alike. So each check
#: declares its own input, and the form shows only that.
NEEDS_NOTHING = "none"
NEEDS_NUMBER = "number"
NEEDS_LIST = "list"

CHECK_KINDS: list[dict] = [
    {"check_type": "mandatory", "label": "Must be populated",
     "needs": NEEDS_NOTHING,
     "help": "Every row must carry a value for this field."},
    {"check_type": "unique", "label": "Must be unique",
     "needs": NEEDS_NOTHING,
     "help": "No two rows may repeat a value in this field."},
    {"check_type": "valid_date", "label": "Must be a real date",
     "needs": NEEDS_NOTHING,
     "help": "Judged against the calendar, so 31/02/2026 fails."},
    {"check_type": "duplicate_records", "label": "No duplicate records",
     "needs": NEEDS_NOTHING,
     "help": "The mapped fields together must not repeat the same record."},
    {"check_type": "comparison", "label": "Compared against a number",
     "needs": NEEDS_NUMBER,
     "help": "Pick an operator and enter the number, e.g. >= 8."},
    {"check_type": "allowed_values", "label": "One of an approved list",
     "needs": NEEDS_LIST,
     "help": "List the accepted values, e.g. Metal, Wood, Plastic."},
]

CHECK_KIND_BY_TYPE = {kind["check_type"]: kind for kind in CHECK_KINDS}


#: How a governed rule's wording maps onto a check this engine can run.
#:
#: Support Domain models name their rules in prose — "Validate mandatory field
#: is populated", "Validate Pole ID uniqueness" — and carry no executable
#: definition at all. Something has to decide what "uniqueness" means to the
#: checker, and the only evidence available is the wording. So the wording is
#: read, in the order below, first match wins.
#:
#: This is a *suggestion*, never a silent decision: the builder shows the check
#: it inferred for every rule and lets the person change it. A guess the user
#: can see and correct is honest; one they cannot is a rule that quietly checks
#: something nobody asked for.
_INFERENCE: list[tuple[tuple[str, ...], str]] = [
    (("uniqueness", "unique", "distinct identifier"), "unique"),
    (("duplicate",), "duplicate_records"),
    (("allowed value", "allowed domain", "domain value", "reference list",
      "value set", "approved value", "permitted value", "code system",
      "controlled vocabulary", "classification is valid", "allowed"), "allowed_values"),
    (("date", "parseable", "timeframe", "overdue", "currency", "stale"), "valid_date"),
    (("threshold", "percentage", "percent", "ratio", "count", "at least",
      "at most", "within required", "interval", "volume", "confidence"), "comparison"),
    (("mandatory", "populated", "required", "must exist", "is assigned",
      "has ", "present", "exists"), "mandatory"),
]

#: Where the wording says nothing decisive. "Must be populated" is the most
#: common thing governance asserts about a field and needs no input, so an
#: unrecognised rule starts there rather than demanding a number nobody has.
DEFAULT_CHECK = "mandatory"


def infer_check(name: str, description: str = "") -> str:
    """Suggest the check a governed rule's wording implies. Always overridable."""
    text = f"{name} {description}".lower()
    for needles, check_type in _INFERENCE:
        if any(needle in text for needle in needles):
            return check_type
    return DEFAULT_CHECK


def build_parameters(check_type: str, comparator: str = "", value=None, values=None) -> dict:
    """
    The stored parameters for one built rule.

    Raises with a plain-language message when the person has not supplied what
    the chosen check needs, so an unusable rule is refused at the door rather
    than saved and found inert at the next quality run.
    """
    kind = CHECK_KIND_BY_TYPE.get(check_type)
    if kind is None:
        raise ValueError(f"'{check_type}' is not a check this builder can produce.")

    if kind["needs"] == NEEDS_NOTHING:
        # A tolerance is still permitted later on the Rule Parameters step; it
        # starts at zero so the rule means what its name says today.
        return {"tolerance_percent": 0}

    if kind["needs"] == NEEDS_LIST:
        approved = parse_value_list(values if values is not None else value)
        if not approved:
            raise ValueError(
                "List at least one accepted value, separated by commas — for example "
                "Metal, Wood, Plastic."
            )
        return {"allowed_values": approved, "case_sensitive": False}

    comparator_sql(comparator)  # rejects an unknown operator before anything is stored
    if value is None or str(value).strip() == "":
        raise ValueError("Enter the number the field is compared against.")
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("The comparison value must be a number.") from exc

    # The operator is stored by key, not as SQL. The engine resolves it again
    # through `comparator_sql`, so a stored rule can never carry an operator the
    # builder would refuse today.
    return {"comparator": comparator, "value": numeric, "tolerance_percent": 0}


def describe(field_name: str, check_type: str, parameters: dict) -> str:
    """
    The rule as a sentence, used for the rule's name and its evidence line.

    A rule that reads "Pole Height >= 8" in the results is one a reviewer can
    check against the policy without opening anything else.
    """
    if check_type == "allowed_values":
        approved = parameters.get("allowed_values") or []
        return f"{field_name} is one of: {', '.join(approved)}"
    if check_type == "comparison":
        symbol = comparator_symbol(str(parameters.get("comparator") or ""))
        return f"{field_name} {symbol} {_plain_number(parameters.get('value'))}"
    if check_type == "unique":
        return f"{field_name} is unique"
    if check_type == "valid_date":
        return f"{field_name} is a real date"
    if check_type == "duplicate_records":
        return "No duplicate records across the mapped fields"
    return f"{field_name} is populated"


def _plain_number(value) -> str:
    """8.0 reads as 8; 8.5 stays 8.5."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(int(number)) if number.is_integer() else str(number)
