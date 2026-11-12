"""
Evaluating a standard check against a single value.

This exists for the worked examples on a rule definition: the author states a
value that should pass and one that must fail, and the rule is held to it. It
answers "does this rule do what its author says?" without a dataset, and it is
the only way a rule can be wrong *and provably so* before anyone attaches it.

It deliberately handles one value at a time. Checks that read a whole column
(uniqueness) or a whole record cannot be judged from a single value, and say so
rather than guessing.
"""
from __future__ import annotations

import re
from datetime import date

#: Checks that need more than one value to mean anything.
NEEDS_CONTEXT = {"unique", "duplicate_records"}

_DATE_PATTERNS = {
    "iso": ("%Y-%m-%d",),
    "dmy": ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"),
    "mdy": ("%m/%d/%Y", "%m-%d-%Y"),
    "month_year": ("%m/%Y", "%Y-%m", "%b %Y", "%B %Y"),
    "year": ("%Y",),
}
_ANY_FORMATS = tuple(fmt for formats in _DATE_PATTERNS.values() for fmt in formats)


def as_number(value: str):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def is_real_date(value: str, date_format: str = "any") -> bool:
    from datetime import datetime

    text = str(value).strip()
    formats = _ANY_FORMATS if date_format in ("", "any") else _DATE_PATTERNS.get(date_format, _ANY_FORMATS)
    for fmt in formats:
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if isinstance(parsed.date(), date):
            return True
    return False


def evaluate(check_type: str, parameters: dict, value: str) -> dict:
    """
    Judge one value.

    Returns `{"verdict": "pass" | "fail" | "skipped", "reason": ...}`. "skipped"
    is not a pass: it means the rule left this value out, which is what an
    ignored value or a blank does.
    """
    params = parameters or {}
    text = "" if value is None else str(value)
    ignored = {str(v).strip().lower() for v in (params.get("ignored_values") or [])}

    if text.strip().lower() in ignored and text.strip():
        return {"verdict": "skipped", "reason": "This value is on the rule's ignore list."}

    if check_type in NEEDS_CONTEXT:
        return {"verdict": "skipped", "reason": "This check reads the whole column, so one value cannot be judged."}

    if check_type == "mandatory":
        return _verdict(text.strip() != "", "A value is present.", "The value is missing.")

    # Every other check judges values that are there; a blank is a completeness
    # problem, which is the mandatory rule's job, not this one's.
    if text.strip() == "":
        return {"verdict": "skipped", "reason": "Blank — completeness is a separate rule."}

    if check_type == "allowed_values":
        allowed = [str(a).strip().lower() for a in (params.get("allowed_values") or [])]
        return _verdict(text.strip().lower() in allowed, "On the approved list.", "Not on the approved list.")

    if check_type == "format":
        pattern = str(params.get("pattern") or "")
        if not pattern:
            return {"verdict": "skipped", "reason": "No pattern is set."}
        try:
            matched = re.fullmatch(pattern, text.strip()) is not None
        except re.error as exc:
            return {"verdict": "fail", "reason": f"The pattern itself is not valid: {exc}"}
        return _verdict(matched, "Matches the pattern.", "Does not match the pattern.")

    if check_type == "valid_date":
        shape = str(params.get("date_format") or "any")
        return _verdict(is_real_date(text, shape), "A real date.", "Not a real date in that format.")

    number = as_number(text)
    if check_type in ("range", "comparison") and number is None:
        return {"verdict": "fail", "reason": "Not a number, so it cannot be compared."}

    if check_type == "range":
        low, high = params.get("min"), params.get("max")
        if low is not None and number < float(low):
            return {"verdict": "fail", "reason": f"Below the minimum of {low}."}
        if high is not None and number > float(high):
            return {"verdict": "fail", "reason": f"Above the maximum of {high}."}
        return {"verdict": "pass", "reason": "Within range."}

    if check_type == "comparison":
        threshold = params.get("value")
        comparator = str(params.get("comparator") or "")
        if threshold is None or not comparator:
            return {"verdict": "skipped", "reason": "No comparison is set."}
        ok = {
            "gt": number > float(threshold),
            "gte": number >= float(threshold),
            "lt": number < float(threshold),
            "lte": number <= float(threshold),
            "eq": number == float(threshold),
            "ne": number != float(threshold),
        }.get(comparator)
        if ok is None:
            return {"verdict": "skipped", "reason": f"'{comparator}' is not a comparison this workspace runs."}
        return _verdict(ok, "Satisfies the comparison.", "Does not satisfy the comparison.")

    return {"verdict": "skipped", "reason": f"'{check_type}' cannot be judged one value at a time."}


def _verdict(passed: bool, yes: str, no: str) -> dict:
    return {"verdict": "pass" if passed else "fail", "reason": yes if passed else no}


def check_examples(check_type: str, parameters: dict, should_pass: list[str], should_fail: list[str]) -> dict:
    """
    Hold the rule to its own worked examples.

    Disagreements are reported, never corrected: the example may be wrong, or
    the rule may be — only the author knows which, and quietly "fixing" either
    would hide the thing worth seeing.
    """
    results = []
    disagreements = 0
    for value, expected in [(v, "pass") for v in should_pass] + [(v, "fail") for v in should_fail]:
        outcome = evaluate(check_type, parameters, value)
        agrees = outcome["verdict"] == expected
        if not agrees:
            disagreements += 1
        results.append({
            "value": value,
            "expected": expected,
            "verdict": outcome["verdict"],
            "reason": outcome["reason"],
            "agrees": agrees,
        })
    return {
        "checked": len(results),
        "disagreements": disagreements,
        "results": results,
        "testable": check_type not in NEEDS_CONTEXT,
    }
