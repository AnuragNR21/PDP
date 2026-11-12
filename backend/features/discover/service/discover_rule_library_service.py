"""
Attaching library rules to mapped fields.

Rules are written once in the Rule Workspace. Here a person only says *which*
of them apply to *which* field — nothing is authored, nothing is re-parameterised.
That separation is the point: the wording of a rule, its threshold and the
values it ignores are decided once, by whoever owns the rule, and every session
that uses it gets exactly that.

Attaching copies the definition into `governed_rule` so the check runs through
the engine that already exists, and records which library rule it came from so
the choice can be shown back, changed, or undone.
"""
from __future__ import annotations

from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_dataset_repository import DiscoverDatasetRepository
from features.discover.repo.discover_governance_repository import (
    DiscoverGovernanceRepository,
)
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from features.rules.domain.check_types import (
    default_execution_scope,
    execution_scope_label,
    is_executable_scope,
)
from features.rules.repo.rule_repository import RuleRepository

#: How a profiled column's datatype answers the rule's "applies to".
_DATA_TYPE_BY_DATATYPE = {
    "integer": "number", "int": "number", "number": "number", "numeric": "number",
    "decimal": "number", "float": "number", "double": "number", "real": "number",
    "date": "date", "datetime": "date", "timestamp": "date",
    "boolean": "text", "string": "text", "text": "text", "varchar": "text",
}


#: Said in one place, so the picker's note and the refusal agree word for word.
SCRIPT_NOT_RUNNABLE = "Custom scripts cannot run yet."

#: What governance says about a rule against a particular field.
#:
#: Four states, not a yes/no, because "this rule does not belong here" and
#: "this rule cannot run anywhere yet" are different facts and a person acts
#: on them differently. None of them hides a rule: the picker marks, it does
#: not filter. Hiding was tried and reversed — the profiler guesses a type
#: from the data, so a date column full of blanks reads as text and the very
#: rule somebody came for was the one missing, with nothing on screen to say
#: it existed.
APPLICABILITY = {
    "applicable": "Applicable",
    "compatible": "Compatible",
    "mismatch": "Mismatch",
    "not_executable": "Not executable",
}


def execution_scope_of(rule: dict) -> str:
    """
    A rule's execution scope, derived when the row does not carry one.

    This service reads `RuleRepository` directly rather than going through
    `RuleService`, so the presented fields that service adds are not here. The
    first version trusted `rule["is_executable"]` with a default of True; the
    repository never sets it, so every rule read as runnable and a cross-table
    rule was offered as "compatible" and attached without complaint.
    """
    return rule.get("execution_scope") or default_execution_scope(
        rule.get("check_type", ""), rule.get("definition_kind", "builtin")
    )


def applicability_of(rule: dict, suits: str) -> dict:
    """
    Whether this rule belongs on a field of this kind, and whether it can run.

    Not executable is decided first and wins outright: whether a rule suits a
    field is moot while nothing can run it, and saying "applicable" of a rule
    that will never produce a finding is the more misleading answer.
    """
    if rule.get("definition_kind") != "builtin":
        return _state("not_executable", SCRIPT_NOT_RUNNABLE)
    scope = execution_scope_of(rule)
    if not is_executable_scope(scope):
        return _state(
            "not_executable",
            "Governed and valid, but it needs execution the engine does not have "
            f"yet ({execution_scope_label(scope).lower()}).",
        )

    written_for = rule.get("data_type") or "any"
    if written_for == "any":
        return _state("compatible", "Written for any kind of field.")
    if suits == "any" or written_for == suits:
        return _state("applicable", f"Written for {written_for} fields.")
    return _state(
        "mismatch",
        f"Written for {written_for} fields; this one profiled as {suits}. "
        "Choose it anyway if the profiler read the column wrongly.",
    )


def _state(state: str, reason: str) -> dict:
    return {"state": state, "label": APPLICABILITY[state], "reason": reason}


def field_data_type(column: dict) -> str:
    """Which kind of field this is, in the rule library's vocabulary."""
    raw = str(column.get("inferred_datatype") or column.get("detected_type") or "").strip().lower()
    return _DATA_TYPE_BY_DATATYPE.get(raw, "text")


def _tables_of(fields: list[dict]) -> list[tuple[str, str, int]]:
    """The tables these fields belong to, in the order they appear."""
    seen: dict[str, list] = {}
    for field in fields:
        key = field["source_file_id"]
        if key not in seen:
            seen[key] = [key, field["table_name"], 0]
        seen[key][2] += 1
    return [tuple(entry) for entry in seen.values()]


class DiscoverRuleLibraryService:
    def __init__(self, db_url: str) -> None:
        self._sessions = DiscoverSessionRepository(db_url)
        self._datasets = DiscoverDatasetRepository(db_url)
        self._governance = DiscoverGovernanceRepository(db_url)
        self._library = RuleRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)

    # ── what the step shows ──────────────────────────────────────────────────

    def list_fields(self, session_id: str) -> dict:
        """
        Every mapped field, the rules already on it, and the rules it could have.

        A rule is offered to a field only when the field is the kind the rule
        says it applies to. Offering a date rule for a description is how a
        picker with a hundred rules becomes unusable.
        """
        if not self._sessions.session_exists(session_id):
            raise LookupError("Discovery session not found.")

        library = list(self._library.list_rules(status="active"))
        attached_by_column = self._attached_by_column(session_id)

        field_rules = [r for r in library if r["scope"] == "field"]
        record_rules = [r for r in library if r["scope"] == "dataset"]

        fields = []
        # Every table's mapped fields, not only the open one's.
        #
        # Rules are chosen for what has been mapped, and mapping happens table
        # by table: a person maps three tables, comes here, and would find the
        # other two missing — which reads as "your mapping was lost". The table
        # each field belongs to travels with it so the picker can say where it
        # came from.
        for column in self._datasets.list_mapped_columns_everywhere(session_id):
            data_type = field_data_type(column)
            chosen = attached_by_column.get(column["column_id"], [])
            # The whole library, not a filtered slice of it. Hiding rules whose
            # "applies to" did not match the profiled type sounded tidy and was
            # not: the profiler guesses a type from the data, and a date column
            # full of blanks reads as text, so the very rule the person came for
            # was the one missing, with nothing on screen to say it existed.
            # Every rule is listed under its own category; the ones written for
            # a different kind of field are marked, not withheld.
            fields.append({
                "column_id": column["column_id"],
                "column_name": column["column_name"],
                "target_name": column.get("target_name"),
                "data_type": data_type,
                "source_file_id": column.get("source_file_id") or "",
                "table_name": column.get("table_name") or "",
                "is_active_table": bool(column.get("is_active_table")),
                "rules": [self._offer(rule, suits=data_type) for rule in field_rules],
                "chosen_ids": [c["source_rule_definition_id"] for c in chosen],
            })

        record_chosen = attached_by_column.get("", [])
        return {
            "session_id": session_id,
            "fields": fields,
            "record_rules": [self._offer(rule, suits="any") for rule in record_rules],
            "record_chosen_ids": [c["source_rule_definition_id"] for c in record_chosen],
            "attached_total": sum(len(f["chosen_ids"]) for f in fields) + len(record_chosen),
            # The tables that have mapped fields, in upload order, for grouping.
            "tables": [
                {"source_file_id": key, "name": name, "fields": count}
                for key, name, count in _tables_of(fields)
            ],
            # The categories the library uses, in the order the picker should
            # show them, so every field groups the same way.
            "categories": sorted(
                {(rule["category"] or "Uncategorised") for rule in library}, key=str.lower
            ),
            # Script rules cannot run until the sandbox exists. They are still
            # listed — marked, and refused if ticked — rather than silently
            # missing from every picker.
            # Rules the engine cannot run: a custom script, or a governed rule
            # whose execution scope is not implemented — cross-table, an
            # aggregate, a comparison against an earlier run. They are listed,
            # marked, and refused if ticked, rather than silently missing.
            "not_runnable": [
                {
                    "code": r["code"],
                    "name": r["name"],
                    "execution_scope_label": execution_scope_label(execution_scope_of(r)),
                    "reason": applicability_of(r, "any")["reason"],
                }
                for r in library
                if applicability_of(r, "any")["state"] == "not_executable"
            ],
        }

    # ── choosing ─────────────────────────────────────────────────────────────

    def set_field_rules(
        self, session_id: str, column_id: str, rule_definition_ids: list[str], actor: str = "user"
    ) -> dict:
        """
        Make the rules on one field exactly the ones chosen — no more, no less.

        The whole selection is sent, so unticking is as ordinary as ticking and
        there is no separate "remove" the caller has to remember.
        """
        if not self._sessions.session_exists(session_id):
            raise LookupError("Discovery session not found.")

        if column_id:
            column = next(
                (c for c in self._datasets.list_mapped_columns_everywhere(session_id)
                 if c["column_id"] == column_id),
                None,
            )
            if column is None:
                raise ValueError("That field is not mapped in this session.")
            wanted_scope = "field"
        else:
            # Rules that read whole records belong to no column. They were being
            # looked up as if they did, which is why choosing one always failed.
            column = {"column_id": "", "column_name": "All mapped fields", "target_node_id": "", "target_name": None}
            wanted_scope = "dataset"

        wanted = list(dict.fromkeys(rule_definition_ids))
        attached = self._attached_by_column(session_id).get(column_id, [])
        current = {a["source_rule_definition_id"]: a for a in attached}

        for definition_id, entry in current.items():
            if definition_id not in wanted:
                self._governance.delete_attachment(entry["configuration_id"])

        added = 0
        for definition_id in wanted:
            if definition_id in current:
                continue
            rule = self._library.get_rule(definition_id)
            if rule is None:
                raise ValueError("That rule is no longer in the library.")
            # A rule that cannot run must not be attachable. Attaching one
            # would leave the quality report quietly short of a check somebody
            # believes is in force, which is worse than refusing it here.
            state = applicability_of(rule, "any")
            if state["state"] == "not_executable":
                raise ValueError(f"“{rule['name']}” cannot be attached. {state['reason']}")
            if rule["scope"] != wanted_scope:
                raise ValueError(
                    f"“{rule['name']}” reads {'a single field' if rule['scope'] == 'field' else 'whole records'}, "
                    "so it cannot be chosen here."
                )
            self._attach(session_id, rule, column)
            added += 1

        self._audit.record(
            actor=actor,
            action="rules.attached_from_library",
            outcome="success",
            session_id=session_id,
            detail={"field": column["column_name"], "rules": len(wanted), "added": added},
        )
        return self.list_fields(session_id)

    def set_record_rules(
        self, session_id: str, rule_definition_ids: list[str], actor: str = "user"
    ) -> dict:
        """The same, for rules that read whole records rather than one field."""
        return self.set_field_rules(session_id, "", rule_definition_ids, actor)

    # ── internals ────────────────────────────────────────────────────────────

    def _attach(self, session_id: str, rule: dict, column: dict) -> None:
        parameters = rule["parameters"] or {}
        created = self._governance.create_custom_rule(session_id, {
            "rule_kind": "bq" if "business" in (rule["category"] or "").lower() else "dq",
            # The library code, kept readable in evidence. A suffix is only added
            # when another session already took it, because the column is unique.
            "code": self._free_code(rule["code"] or "RULE"),
            "name": rule["name"],
            "description": rule["description"] or rule["rationale"],
            "check_type": rule["check_type"],
            "applies_to": "field" if rule["scope"] == "field" else "dataset",
            "severity": rule["severity"],
            "requires_parameters": False,
            # The definition decides the parameters. Nothing in Discover may
            # change them, so a rule means the same thing in every session.
            "permitted_parameters": list(parameters.keys()),
            "default_parameters": parameters,
            "source_rule_definition_id": rule["rule_definition_id"],
            # Frozen here. Editing the library rule afterwards bumps its
            # version and leaves this copy — and every result citing it — alone.
            "source_rule_version": rule.get("version", ""),
        })
        self._governance.upsert_configuration(session_id, {
            "rule_id": created["rule_id"],
            "column_id": column.get("column_id", ""),
            "column_name": column.get("column_name", "All mapped fields"),
            "target_node_id": column.get("target_node_id") or "",
            "target_name": column.get("target_name"),
            "is_enabled": True,
            "severity": rule["severity"],
            "parameters": parameters,
        })

    def _free_code(self, code: str) -> str:
        from uuid import uuid4

        if not self._governance.code_taken(code):
            return code
        return f"{code}-{uuid4().hex[:4].upper()}"

    def _attached_by_column(self, session_id: str) -> dict[str, list[dict]]:
        attached: dict[str, list[dict]] = {}
        for config in self._governance.list_configurations(session_id):
            definition_id = config.get("source_rule_definition_id") or ""
            if not definition_id:
                continue
            rule = self._library.get_rule(definition_id)
            if rule is None:
                continue
            attached.setdefault(config["column_id"], []).append({
                "configuration_id": config["configuration_id"],
                "source_rule_definition_id": definition_id,
                "rule": rule,
            })
        return attached

    @staticmethod
    def _offer(rule: dict, configuration_id: str = "", suits: str = "any") -> dict:
        """
        One rule as the picker shows it: what it is, not how to configure it.

        `suits` is the kind of field this rule is being offered for. It never
        removes a rule from the list; it decides which of the four
        applicability states the row carries, so the picker can mark the odd
        ones out while leaving the choice with the person, who can see the
        data and the profiler cannot always read it right.
        """
        from features.rules.domain import python_rules
        from features.rules.domain.check_types import CHECK_TYPE_BY_KEY, describe

        spec = CHECK_TYPE_BY_KEY.get(rule["check_type"])
        written_for = rule["data_type"] or "any"
        script = rule["definition_kind"] != "builtin"
        state = applicability_of(rule, suits)
        scope = execution_scope_of(rule)
        blocked = state["reason"] if state["state"] == "not_executable" else ""
        # A script has no built-in check to describe, so it is summarised the
        # same way the Rule Workspace summarises it — the row must read alike
        # in both places or they look like two different rules.
        if script:
            check_label = "Custom Python script"
            statement = python_rules.summarise(
                python_rules.validate(rule["script"] or "")["row_fields"]
            )
        else:
            check_label = spec["label"] if spec else rule["check_type"]
            statement = describe(rule["check_type"], rule["parameters"])
        return {
            "rule_definition_id": rule["rule_definition_id"],
            "configuration_id": configuration_id,
            "code": rule["code"],
            "name": rule["name"],
            "description": rule["description"],
            "category": rule["category"] or "Uncategorised",
            "dimension": rule["dimension"],
            "data_type": written_for,
            "severity": rule["severity"],
            "check_label": check_label,
            "statement": statement,
            "rationale": rule["rationale"],
            "version": rule["version"],
            "execution_scope": scope,
            "execution_scope_label": execution_scope_label(scope),
            "is_executable": state["state"] != "not_executable",
            # Kept: the picker has read it since before the four states
            # existed, and it still answers the narrower question.
            "suits_field": written_for in ("any", suits) or suits == "any",
            "applicability": state,
            "blocked_reason": blocked,
        }
