"""
Getting rules in and out of the library as CSV.

Export is the easy half. Import is the half that matters, and it is deliberately
not an import: a file cannot overwrite the library. It is *reconciled* against
it — every row is matched against what is already there, the difference is shown
first, and nothing is written until somebody picks the rows to apply.

Three things are kept apart, and the matching order is what keeps them apart:

  1. `rule_definition_id` — the internal identity. Dependencies point at it.
  2. `code` — the readable business identifier. Issued once, never rewritten.
  3. `version` — bumped by the commit, so a run that cited version 3 still
     resolves to version 3.

A matched rule keeps its id **and** its code, whatever the file says. That is
the whole point: a file that carries somebody else's codes must not be able to
re-label evidence that already exists.
"""
from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from uuid import uuid4

from features.rules.domain.models import SaveRuleCommand
from features.rules.service.rule_service import RuleService

#: The order a person reads them in: identity first, then what the rule says,
#: then how it is checked, then the prose. Import accepts any order and any
#: subset; this is only what export writes.
EXPORT_COLUMNS = (
    "rule_definition_id",
    "code",
    "name",
    "category",
    "status",
    "severity",
    "dimension",
    "data_type",
    "execution_scope",
    "definition_kind",
    "check_type",
    "parameters_json",
    "script",
    "description",
    "rationale",
    "reference",
    "message_template",
    "examples_pass",
    "examples_fail",
    "owner",
    "version",
    "updated_at",
)

#: Written by export for the reader's benefit and ignored by import: they are
#: outcomes of editing a rule, not things a file gets to set.
READ_ONLY_COLUMNS = ("version", "updated_at")

#: The fields a row can actually change, compared to decide unchanged vs changed.
COMPARED = (
    "name", "description", "category", "status", "severity", "dimension",
    "data_type", "execution_scope", "definition_kind", "check_type",
    "parameters", "script", "rationale", "reference", "message_template",
    "owner", "examples_pass", "examples_fail",
)

_STAGE_TTL = timedelta(minutes=20)
_STAGE_LOCK = Lock()
_STAGE_STORE: dict[str, "_Stage"] = {}


@dataclass
class _Stage:
    created_at: datetime
    rows: list[dict] = field(default_factory=list)
    #: row_number → the validated payload ready to write.
    payloads: dict[int, dict] = field(default_factory=dict)


def _sweep(now: datetime) -> None:
    for key in [k for k, v in _STAGE_STORE.items() if now - v.created_at > _STAGE_TTL]:
        del _STAGE_STORE[key]


def _put(rows: list[dict], payloads: dict[int, dict]) -> str:
    with _STAGE_LOCK:
        now = datetime.now(timezone.utc)
        _sweep(now)
        stage_id = f"rulestage_{uuid4().hex[:12]}"
        _STAGE_STORE[stage_id] = _Stage(created_at=now, rows=rows, payloads=payloads)
        return stage_id


def _take(stage_id: str) -> _Stage | None:
    with _STAGE_LOCK:
        _sweep(datetime.now(timezone.utc))
        return _STAGE_STORE.pop(stage_id, None)


# ── text helpers ─────────────────────────────────────────────────────────────

def _lines(cell: str) -> list[str]:
    """
    Examples, one per line inside the cell.

    A separator character would eventually appear inside an example and split
    it in half. A newline inside a quoted CSV field is handled by every reader
    that handles CSV at all, and by Excel.
    """
    return [line.strip() for line in (cell or "").replace("\r\n", "\n").split("\n") if line.strip()]


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


class RuleExportService:
    def __init__(self, db_url: str) -> None:
        self._svc = RuleService(db_url)

    def export_csv(self, *, status: str = "", category: str = "", search: str = "") -> str:
        report = self._svc.list_rules(search=search, status=status, category=category)
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=list(EXPORT_COLUMNS), lineterminator="\n")
        writer.writeheader()
        for rule in report["items"]:
            writer.writerow({
                "rule_definition_id": rule["rule_definition_id"],
                "code": rule.get("code", ""),
                "name": rule["name"],
                "category": rule.get("category", ""),
                "status": rule.get("status", ""),
                "severity": rule.get("severity", ""),
                "dimension": rule.get("dimension", ""),
                "data_type": rule.get("data_type", ""),
                "execution_scope": rule.get("execution_scope", ""),
                "definition_kind": rule.get("definition_kind", ""),
                "check_type": rule.get("check_type", ""),
                "parameters_json": json.dumps(rule.get("parameters") or {}, ensure_ascii=False, sort_keys=True),
                "script": rule.get("script", ""),
                "description": rule.get("description", ""),
                "rationale": rule.get("rationale", ""),
                "reference": rule.get("reference", ""),
                "message_template": rule.get("message_template", ""),
                "examples_pass": "\n".join(rule.get("examples_pass") or []),
                "examples_fail": "\n".join(rule.get("examples_fail") or []),
                "owner": rule.get("owner", ""),
                "version": rule.get("version", ""),
                "updated_at": rule.get("updated_at", ""),
            })
        return buffer.getvalue()

    def template_csv(self) -> str:
        """An empty file with the right header, for a team starting from scratch."""
        buffer = io.StringIO()
        csv.DictWriter(buffer, fieldnames=list(EXPORT_COLUMNS), lineterminator="\n").writeheader()
        return buffer.getvalue()


class RuleImportService:
    """
    Reconcile a CSV against the library, then apply only what was chosen.

    `validate` writes nothing. It returns a plan: one row per line in the file,
    each saying what would happen and — when something would change — exactly
    which fields, from what to what. `commit` takes the row numbers somebody
    ticked and applies those alone.
    """

    def __init__(self, db_url: str) -> None:
        self._svc = RuleService(db_url)
        self._repo = self._svc._rules  # noqa: SLF001 — same feature, same layer.

    # ── plan ─────────────────────────────────────────────────────────────────

    def validate(self, csv_text: str, *, actor: str = "user") -> dict:
        reader = csv.DictReader(io.StringIO(csv_text.lstrip("﻿")))
        if reader.fieldnames is None:
            raise ValueError("That file has no header row, so there is nothing to read.")

        headers = {(h or "").strip().lower() for h in reader.fieldnames}
        # A row has to be able to say which rule it is about. Any one of the
        # three identifiers will do: a file keyed on `code` alone is a normal
        # thing to hand over, and refusing it would force a column nobody
        # needs.
        if not headers & {"name", "code", "rule_definition_id"}:
            raise ValueError(
                "A rule file needs a `name`, a `code` or a `rule_definition_id` column, "
                "so each row can say which rule it is about. Export the library first "
                "to get a file with the right headers."
            )
        unknown = sorted(headers - set(EXPORT_COLUMNS) - {""})

        rows: list[dict] = []
        payloads: dict[int, dict] = {}
        # Nothing is written yet, so two rows claiming the same rule have to be
        # caught here rather than by the database later.
        claimed: dict[str, int] = {}

        # Header is line 1, so the first data row is line 2 — the number a
        # person sees in their spreadsheet.
        for line_number, raw in enumerate(reader, start=2):
            row = self._plan_row(line_number, raw, claimed)
            rows.append(row)
            if row["payload"] is not None:
                payloads[line_number] = row.pop("payload")
            else:
                row.pop("payload")

        summary = {
            "total": len(rows),
            "new": sum(1 for r in rows if r["action"] == "new"),
            "changed": sum(1 for r in rows if r["action"] == "changed"),
            "unchanged": sum(1 for r in rows if r["action"] == "unchanged"),
            "invalid": sum(1 for r in rows if r["action"] == "invalid"),
        }
        return {
            "stage_id": _put(rows, payloads),
            "summary": summary,
            "rows": rows,
            "unknown_columns": unknown,
            # Ticked by default: everything that would do something and can.
            "selected_row_numbers": [
                r["row_number"] for r in rows if r["action"] in ("new", "changed")
            ],
        }

    def _plan_row(self, line_number: int, raw: dict, claimed: dict[str, int]) -> dict:
        cells = {(k or "").strip().lower(): (v or "") for k, v in raw.items() if k}
        name = cells.get("name", "").strip()
        code = cells.get("code", "").strip()
        given_id = cells.get("rule_definition_id", "").strip()

        row: dict = {
            "row_number": line_number,
            "action": "invalid",
            "match_on": "",
            "rule_definition_id": "",
            "code": code,
            "name": name,
            "category": cells.get("category", "").strip(),
            "changes": [],
            "notes": [],
            "errors": [],
            "payload": None,
        }

        if not name and not code and not given_id:
            row["errors"].append("Blank row.")
            return row

        # Identity first, then the readable code, then the name. A file that
        # came out of this library carries the id and matches on it; a file
        # written by hand matches on code or name.
        existing = None
        if given_id:
            existing = self._repo.get_rule(given_id)
            if existing is not None:
                row["match_on"] = "rule_definition_id"
            else:
                row["notes"].append(
                    f"No rule has the id “{given_id}”. Matched on code or name instead, "
                    "and treated as new if neither matched."
                )
        if existing is None and code:
            existing = self._repo.find_by_code(code)
            if existing is not None:
                row["match_on"] = "code"
        if existing is None and name:
            existing = self._repo.find_by_name(name)
            if existing is not None:
                row["match_on"] = "name"

        if existing is not None:
            key = existing["rule_definition_id"]
            if key in claimed:
                row["errors"].append(
                    f"Row {claimed[key]} already matched this same rule. "
                    "Two rows cannot both become one rule."
                )
                return row
            claimed[key] = line_number
            row["rule_definition_id"] = key
            row["name"] = existing["name"] if not name else name
            if code and existing.get("code") and code.upper() != existing["code"].upper():
                row["notes"].append(
                    f"The file says {code}; this rule already has {existing['code']}, "
                    "which is kept. Results cite it."
                )
            row["code"] = existing.get("code", "")
        elif name:
            key = f"name:{name.lower()}"
            if key in claimed:
                row["errors"].append(f"Row {claimed[key]} already creates a rule called “{name}”.")
                return row
            claimed[key] = line_number

        try:
            command = self._command(cells, existing)
            payload = self._svc._validated(  # noqa: SLF001 — one feature, one validator.
                command, excluding_id=existing["rule_definition_id"] if existing else ""
            )
        except ValueError as exc:
            row["errors"].append(str(exc))
            return row
        except Exception as exc:  # a malformed parameters_json, mostly
            row["errors"].append(f"Could not read this row: {exc}")
            return row

        row["payload"] = payload
        if existing is None:
            row["action"] = "new"
            if code and self._repo.code_taken(code):
                row["notes"].append(
                    f"{code} already belongs to another rule, so this one is given the next "
                    "free code in its family."
                )
                row["code"] = ""
            return row

        changes = self._diff(existing, payload)
        row["action"] = "changed" if changes else "unchanged"
        row["changes"] = changes
        return row

    def _command(self, cells: dict[str, str], existing: dict | None) -> SaveRuleCommand:
        """
        One row as a save command, with anything the file left out taken from
        the rule it matched — so a two-column file can change two columns
        without blanking everything else.
        """
        base: dict = existing or {}

        def value(key: str, fallback: Any = "") -> Any:
            if key in cells and cells[key].strip() != "":
                return cells[key].strip()
            if key in base and base.get(key) not in (None, ""):
                return base[key]
            return fallback

        if "parameters_json" in cells and cells["parameters_json"].strip():
            parameters = json.loads(cells["parameters_json"])
            if not isinstance(parameters, dict):
                raise ValueError("`parameters_json` has to be a JSON object, e.g. {\"min\": 0}.")
        else:
            parameters = base.get("parameters") or {}

        if "examples_pass" in cells:
            passes = _lines(cells["examples_pass"])
        else:
            passes = list(base.get("examples_pass") or [])
        if "examples_fail" in cells:
            fails = _lines(cells["examples_fail"])
        else:
            fails = list(base.get("examples_fail") or [])

        return SaveRuleCommand(
            name=value("name"),
            description=value("description"),
            category=value("category", "data_quality"),
            definition_kind=value("definition_kind", "builtin"),
            check_type=value("check_type"),
            # A script spans lines, so it is never stripped of its shape.
            script=cells.get("script") or base.get("script") or "",
            parameters=parameters,
            severity=value("severity", "medium"),
            status=value("status", "draft"),
            execution_scope=value("execution_scope"),
            dimension=value("dimension", "validity"),
            data_type=value("data_type", "any"),
            rationale=value("rationale"),
            reference=value("reference"),
            message_template=value("message_template"),
            examples_pass=passes,
            examples_fail=fails,
            owner=value("owner"),
        )

    @staticmethod
    def _diff(existing: dict, payload: dict) -> list[dict]:
        """
        What this row would change, field by field.

        Compared against the *validated* payload rather than the raw cells, so
        a default the validator filled in does not show up as a change nobody
        asked for.
        """
        changes = []
        for key in COMPARED:
            if key in ("examples_pass", "examples_fail"):
                after = payload.get("examples", {}).get(key.split("_")[1], [])
                before = existing.get(key) or []
            else:
                after = payload.get(key)
                before = existing.get(key)
            if key == "parameters":
                before, after = before or {}, after or {}
            if _as_text(before) != _as_text(after):
                changes.append({"field": key, "from": _as_text(before), "to": _as_text(after)})
        return changes

    # ── apply ────────────────────────────────────────────────────────────────

    def commit(self, stage_id: str, selected_row_numbers: list[int] | None = None,
               *, actor: str = "user") -> dict:
        stage = _take(stage_id)
        if stage is None:
            raise ValueError(
                "That review has expired. Upload the file again — nothing was written."
            )

        wanted = set(selected_row_numbers) if selected_row_numbers is not None else None
        created, updated, skipped, failed = 0, 0, 0, 0
        results = []

        for row in stage.rows:
            number = row["row_number"]
            selected = wanted is None or number in wanted
            payload = stage.payloads.get(number)

            if not selected or payload is None or row["action"] in ("unchanged", "invalid"):
                skipped += 1
                results.append({**row, "outcome": "skipped"})
                continue

            try:
                if row["action"] == "new":
                    saved = self._svc.create_rule_from_payload(
                        payload, actor=actor, code=row.get("code") or ""
                    )
                    created += 1
                else:
                    saved = self._svc.update_rule_from_payload(
                        row["rule_definition_id"], payload, actor=actor
                    )
                    updated += 1
                results.append({
                    **row,
                    "outcome": "applied",
                    "rule_definition_id": saved["rule_definition_id"],
                    "code": saved.get("code", ""),
                    "version": saved.get("version", 0),
                })
            except Exception as exc:
                failed += 1
                results.append({**row, "outcome": "failed", "errors": [str(exc)]})

        return {
            "stage_id": stage_id,
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "failed": failed,
            "rows": results,
        }
