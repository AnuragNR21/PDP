"""
One property-to-configuration link as a screen needs it, and whether it is
ready to run.

A configuration says what it checks *against*: a vocabulary of approved values,
named by `reference_element_type_id`. The property says which of those values it
actually approves, through its own `is governed by` links. Resolution is the
meeting of the two, and it happens on every read so that a value retired this
morning stops being accepted this morning.

The part worth being careful about is what happens when they do not meet. A
configuration that needs approved values and finds none must not fall back to
accepting everything, and must not quietly pass. It is incomplete, it says so,
and it does not run. That is a different kind of answer from "this data is
wrong", and the two must never be reported as the same thing.
"""
from __future__ import annotations

#: The one parameter an approved-value set can feed today.
VALUES_PARAMETER = "allowed_values"

#: A configuration either needs governed reference data or it does not.
REFERENCE_NONE = "none"
REFERENCE_APPROVED_VALUES = "approved_values"

#: Checks that are meaningless without governed reference data. Which values
#: they accept is the whole question they ask, so a configuration of one of
#: these that names no vocabulary is unfinished — whatever it happens to carry
#: in its own parameters.
REFERENCE_DEPENDENT_CHECKS = ("allowed_values", "classified_values")

#: Whether this association can execute.
READY = "ready"
INCOMPLETE = "configuration_incomplete"


def present_property_link(
    link: dict,
    approved_values: list[dict] | None = None,
    element_type_names: dict[str, str] | None = None,
) -> dict:
    """
    Resolve one link against the values its *rule* approves.

    The approved list belongs to the rule, not to the property it is linked to.
    That is the whole point of writing a rule once: `Valid Switch Voltage`
    accepts 11kV and 22kV wherever it is attached, and a second property cannot
    quietly widen it. Structure says which checks apply; the Rule Workspace
    says what they check against.

    `approved_values` is the property's own value links. It is read for the
    element-type names in a message and nothing else — resolution does not
    depend on it.
    """
    names = element_type_names or {}
    expected = (link.get("reference_element_type_id") or "").strip()
    parameters = dict(link.get("parameters") or {})
    check_type = (link.get("check_type") or "")

    if check_type not in REFERENCE_DEPENDENT_CHECKS:
        # Required Value, Unique Value, Numeric Value and the rest: the check
        # carries its own parameters and needs nothing from reference data.
        return {
            **link,
            **_display(link),
            "parameters": parameters,
            "reference_requirement": REFERENCE_NONE,
            "expected_reference_type_id": "",
            "expected_reference_type_name": "",
            "approved_values": [],
            "approved_value_ids": [],
            "readiness": READY,
            "readiness_reason": "",
            "selected_by_default": link.get("applicability") == "required",
        }

    expected_name = (
        link.get("reference_element_type_name")
        or names.get(expected)
        or _first_name(approved_values or [], expected)
        or expected
    )
    resolved = [v for v in (link.get("configuration_values") or []) if str(v).strip()]

    common = {
        **link,
        **_display(link),
        "reference_requirement": REFERENCE_APPROVED_VALUES,
        "expected_reference_type_id": expected,
        "expected_reference_type_name": expected_name if expected else "",
        "approved_value_ids": list(link.get("reference_value_ids") or []),
    }

    if not expected:
        # An approved-value check that names no vocabulary. Production held one
        # of these, and because the old test was "has it a vocabulary?" rather
        # than "does it need one?", it was declared ready and ran against the
        # parameters the configuration happened to carry — a single value
        # called "placeholder". A reference check measuring 137,950 rows
        # against a word somebody typed as a stand-in is worse than one that
        # refuses to run: it produces confident, wrong failures.
        parameters.pop(VALUES_PARAMETER, None)
        return {
            **common,
            "parameters": parameters,
            "approved_values": [],
            "readiness": INCOMPLETE,
            "readiness_reason": (
                "This check compares against an approved list, but the rule does not say "
                "which governed vocabulary to use. Open the rule in the Rule Workspace and "
                "choose the vocabulary and the values it approves."
            ),
            "selected_by_default": False,
        }

    if not resolved:
        # Deliberately leave the parameter absent. A check handed an empty list
        # would fail every row; a check handed no list at all cannot run, which
        # is the honest state.
        parameters.pop(VALUES_PARAMETER, None)
        return {
            **common,
            "parameters": parameters,
            "approved_values": [],
            "readiness": INCOMPLETE,
            "readiness_reason": (
                f"This check reads {expected_name}, but none of its values are approved. "
                "Open the rule in the Rule Workspace and tick the values it accepts."
            ),
            "selected_by_default": False,
        }

    parameters[VALUES_PARAMETER] = resolved
    return {
        **common,
        "parameters": parameters,
        "approved_values": resolved,
        "readiness": READY,
        "readiness_reason": "",
        # Required rules are ticked for the analyst, but only when they can
        # actually run. Pre-ticking a check that will refuse to execute reads
        # as governance when it is a gap.
        "selected_by_default": link.get("applicability") == "required",
    }


def _display(link: dict) -> dict:
    """
    The names a screen reads a link by.

    A configuration carries its own name and may carry its own code and
    severity; where it does not, the definition behind it answers. Resolving
    that once here keeps every screen saying the same thing.
    """
    return {
        "name": link.get("configuration_name", ""),
        "code": link.get("configuration_code") or link.get("definition_code") or "",
        "description": link.get("configuration_description") or "",
        "effective_severity": link.get("configuration_severity")
        or link.get("definition_severity", ""),
        "severity": link.get("configuration_severity")
        or link.get("definition_severity", ""),
    }


def _first_name(approved_values: list[dict], element_type_id: str) -> str:
    for value in approved_values:
        if value.get("element_type_id") == element_type_id:
            return value.get("element_type_name", "")
    return ""


#: How strongly governance expects a check to run on this property.
APPLICABILITY_OPTIONS = [
    {
        "key": "required",
        "label": "Required",
        "detail": "Ticked for the analyst by default. Governance expects this to run.",
    },
    {
        "key": "recommended",
        "label": "Recommended",
        "detail": "Offered and not ticked. The analyst decides.",
    },
    {
        "key": "available",
        "label": "Available",
        "detail": "There if they want it. Nothing is implied by leaving it out.",
    },
]
