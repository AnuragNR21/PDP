"""
RuleService — authoring rules in the Rule Workspace.

This workspace owns rule definitions and nothing else. A rule written here is
not yet doing anything: it states a condition, and becomes live only when it is
attached to a field, which happens elsewhere. Keeping authoring apart from
attaching is what lets the same rule be written once and reused.
"""
from __future__ import annotations

from features.rules.domain.check_types import (
    CHECK_TYPE_BY_KEY,
    EXECUTION_SCOPE_BY_KEY,
    catalogue,
    default_execution_scope,
    describe,
    execution_scope_label,
    is_executable_scope,
    validate_parameters,
)
from features.rules.domain import evaluate as rule_evaluate
from features.rules.domain import python_rules
from features.rules.domain.check_types import (
    CHECK_DATA_TYPES,
    CHECK_DIMENSION,
    DATA_TYPES,
    DIMENSIONS,
    IGNORED_VALUES_PARAM,
    TOLERANCE_PARAM,
)
from features.rules.domain.models import SaveRuleCommand, SaveRuleConfigurationCommand
from features.rules.repo.rule_configuration_repository import RuleConfigurationRepository
from features.rules.repo.rule_repository import RuleRepository
from features.rules.service.rule_configuration_service import RuleConfigurationService

_DIMENSION_KEYS = {d["key"] for d in DIMENSIONS}
_DATA_TYPE_KEYS = {t["key"] for t in DATA_TYPES}

#: Categories the library shipped with, kept so rules written under them keep
#: their original code family instead of starting a second one.
_LEGACY_PREFIX = {"data quality": "DQ", "business rule": "BR", "conformance": "CF",
                  "data_quality": "DQ", "business": "BR"}

MAX_CATEGORY_LENGTH = 60

#: A prefix has to survive being read aloud, sorted, and typed into a filter.
MAX_PREFIX_LENGTH = 8


def derived_code_prefix(category: str) -> str:
    """
    A short code family guessed from a category the team invented.

    "Data quality" gives DQ, "Asset register" gives AR, "Common" gives COM —
    initials for several words, the first letters for one. A code is only ever
    handed out once, so a category renamed later leaves old codes alone.

    This is only the default. A team that codes its rules differently sets its
    own prefix per category, and that overrides this.
    """
    known = _LEGACY_PREFIX.get(category.strip().lower())
    if known:
        return known
    words = [w for w in "".join(c if c.isalnum() else " " for c in category).split() if w]
    if not words:
        return "R"
    if len(words) == 1:
        return words[0][:3].upper()
    return "".join(w[0] for w in words[:3]).upper()


#: Kept so anything importing the old name still works.
code_prefix = derived_code_prefix


def normalise_prefix(prefix: str) -> str:
    """
    A prefix the code reader can rely on, or a refusal saying why.

    Letters and digits only, starting with a letter, upper-cased. No hyphen:
    the hyphen separates the family from the number, so one inside the prefix
    would make `AR-2-0007` ambiguous about where the family ends.
    """
    cleaned = (prefix or "").strip().upper()
    if not cleaned:
        raise ValueError("Give the category a code prefix, or clear it to go back to the default.")
    if len(cleaned) > MAX_PREFIX_LENGTH:
        raise ValueError(f"A code prefix is limited to {MAX_PREFIX_LENGTH} characters.")
    if not cleaned[0].isalpha():
        raise ValueError("A code prefix has to start with a letter.")
    if not all(c.isalnum() for c in cleaned):
        raise ValueError("A code prefix can only contain letters and digits — no spaces, hyphens or punctuation.")
    return cleaned


def _pick_primary(siblings: list[dict]) -> dict | None:
    """The configuration a rule is edited through: see `RuleService.primary_configuration`."""
    if not siblings:
        return None
    live = [c for c in siblings if c.get("status") != "retired"] or siblings
    return sorted(live, key=lambda c: (c.get("code") or "", c.get("created_at") or ""))[0]


class RuleInUseError(ValueError):
    """The rule is in use and deleting it was not confirmed."""

    def __init__(self, message: str, usage: dict) -> None:
        super().__init__(message)
        self.usage = usage


def _in_use_message(name: str, usage: dict) -> str:
    def counted(n: int, one: str, many: str) -> str:
        return f"{n} {one if n == 1 else many}"

    places = []
    if usage["node_instances"]["total"]:
        places.append(counted(usage["node_instances"]["total"], "node instance", "node instances"))
    if usage["discover_sessions"]["total"]:
        places.append(counted(usage["discover_sessions"]["total"], "Discover session", "Discover sessions"))
    return (
        f"“{name}” is in use by {' and '.join(places)}. "
        "Confirm to delete it anyway (force=true), or retire the rule instead."
    )


class RuleService:
    def __init__(self, db_url: str) -> None:
        self._rules = RuleRepository(db_url)
        # A rule and what it checks against are authored together, so the
        # service that owns the second half is held here rather than reached
        # for from a second screen.
        self._configurations = RuleConfigurationRepository(db_url)
        self._configuration_service = RuleConfigurationService(db_url)

    def get_catalogue(self) -> dict:
        return catalogue(self._rules.list_categories())

    def validate_script(self, script: str) -> dict:
        """Check a script without saving or running it — drives the editor."""
        return python_rules.validate(script)

    def test_examples(self, check_type: str, parameters: dict, passes: list[str], fails: list[str]) -> dict:
        """Hold a draft rule to its worked examples, before it is saved."""
        cleaned = validate_parameters(check_type, parameters) if check_type in CHECK_TYPE_BY_KEY else {}
        return rule_evaluate.check_examples(check_type, cleaned, passes, fails)

    def list_rules(self, search: str = "", status: str = "", category: str = "") -> dict:
        # Every rule's configuration in one read rather than one (or three) per
        # rule — the list was seconds long on prod for that reason alone.
        found = self._rules.list_rules(search, status, category)
        by_rule: dict[str, list[dict]] = {}
        for configuration in self._configurations.list_configurations():
            by_rule.setdefault(configuration["rule_definition_id"], []).append(configuration)
        primaries = {rule_id: _pick_primary(siblings) for rule_id, siblings in by_rule.items()}
        lookups = self._configuration_service.lookups_for(list(primaries.values()))
        rules = [
            self._present(
                rule,
                primary=primaries.get(rule["rule_definition_id"]),
                lookups=lookups,
            )
            for rule in found
        ]
        return {
            "items": rules,
            "total": len(rules),
            "active": sum(1 for rule in rules if rule["status"] == "active"),
        }

    def get_rule(self, rule_definition_id: str) -> dict:
        rule = self._rules.get_rule(rule_definition_id)
        if rule is None:
            raise LookupError("Rule not found.")
        return self._present(rule)

    def create_rule(self, command: SaveRuleCommand, actor: str = "user") -> dict:
        rule = self.create_rule_from_payload(self._validated(command), actor=actor)
        self._save_governance(rule, command, actor)
        return self.get_rule(rule["rule_definition_id"])

    def update_rule(self, rule_definition_id: str, command: SaveRuleCommand, actor: str = "user") -> dict:
        if self._rules.get_rule(rule_definition_id) is None:
            raise LookupError("Rule not found.")
        data = self._validated(command, excluding_id=rule_definition_id)
        rule = self.update_rule_from_payload(rule_definition_id, data, actor=actor)
        self._save_governance(rule, command, actor)
        return self.get_rule(rule_definition_id)

    def create_rule_from_payload(self, data: dict, *, actor: str = "user", code: str = "") -> dict:
        """
        Write a rule from a payload `_validated` has already been through.

        The import path needs this: it validated the row when it built the
        review, and validating a second time at commit would let the two
        answers differ. `code` is honoured only when the file supplied one and
        nothing else holds it — otherwise the next code in the family is
        issued, because a code is never shared and never reused.
        """
        wanted = (code or "").strip().upper()
        issued = wanted if wanted and not self._rules.code_taken(wanted) else self._rules.next_code(
            self.code_prefix_for(data["category"])
        )
        # The code is handed out once, at creation, and never changes again.
        return self._present(self._rules.insert_rule({**data, "code": issued}, actor))

    def update_rule_from_payload(self, rule_definition_id: str, data: dict, *, actor: str = "user") -> dict:
        existing = self._rules.get_rule(rule_definition_id)
        if existing is None:
            raise LookupError("Rule not found.")
        # A rule written before codes existed has none; give it one now rather
        # than leaving it unciteable. A code it already has is never touched:
        # results cite it, so changing it would re-label old evidence.
        if not existing.get("code"):
            self._rules.assign_code(
                rule_definition_id, self._rules.next_code(self.code_prefix_for(data["category"]))
            )
        # Editing bumps the version; the code stays. What changed is visible in
        # the version, not in the identity.
        return self._present(self._rules.update_rule(rule_definition_id, data, actor))

    def list_versions(self, rule_definition_id: str) -> dict:
        """
        Every version of a rule, newest first.

        A rule that predates the version log has nothing recorded for the
        version it is on, so the current state is offered in its place and
        marked `recorded: false` — it is the rule as it stands, not a copy
        taken at the time. The next edit records it properly.
        """
        rule = self._rules.get_rule(rule_definition_id)
        versions = self._rules.list_versions(rule_definition_id)
        if rule is None and not versions:
            raise LookupError("Rule not found.")

        items = [{**v, "recorded": True, "is_current": False} for v in versions]
        if rule is not None:
            known = {v["version"] for v in versions}
            if rule["version"] not in known:
                items.insert(0, {
                    **{k: rule.get(k, "") for k in (
                        "code", "name", "description", "category", "scope",
                        "execution_scope",
                        "definition_kind", "check_type", "script", "severity", "status",
                        "dimension", "data_type", "rationale", "reference",
                        "message_template", "owner",
                    )},
                    "rule_version_id": "",
                    "rule_definition_id": rule_definition_id,
                    "version": rule["version"],
                    "parameters": rule.get("parameters", {}),
                    "examples": {
                        "pass": rule.get("examples_pass", []),
                        "fail": rule.get("examples_fail", []),
                    },
                    "recorded_by": rule.get("updated_by", ""),
                    "recorded_at": rule.get("updated_at", ""),
                    "recorded": False,
                    "is_current": True,
                })
            for item in items:
                item["is_current"] = item["version"] == rule["version"]

        return {
            "rule_definition_id": rule_definition_id,
            "name": rule["name"] if rule else (versions[0]["name"] if versions else ""),
            "code": rule["code"] if rule else (versions[0]["code"] if versions else ""),
            "current_version": rule["version"] if rule else 0,
            "rule_deleted": rule is None,
            "items": items,
            "total": len(items),
        }

    def get_version(self, rule_definition_id: str, version: int) -> dict:
        """
        One version as it was written.

        This is what a quality run's evidence points at: the run records which
        version it executed, and this answers what that version said.
        """
        stored = self._rules.get_version(rule_definition_id, version)
        if stored is not None:
            return {**stored, "recorded": True}
        rule = self._rules.get_rule(rule_definition_id)
        if rule is not None and rule["version"] == version:
            return {**rule, "recorded": False}
        raise LookupError("That version of the rule was not recorded.")

    # ── code families ────────────────────────────────────────────────────────

    def code_prefix_for(self, category: str) -> str:
        """
        The code family a category hands out: configured first, guessed second.
        """
        configured = self._rules.list_code_prefixes().get(category.strip().lower())
        return configured or derived_code_prefix(category)

    def list_code_prefixes(self) -> dict:
        """
        Every category in the library and the code family it hands out.

        A category with no row of its own is shown with its derived prefix and
        `source: "default"`, so the list is the whole picture rather than only
        the parts somebody has already touched.
        """
        configured = self._rules.list_code_prefixes()
        categories = self._rules.list_categories()
        # A prefix can be configured for a category no rule uses yet — someone
        # set it up in advance. Those belong in the list too.
        known = {c.strip().lower() for c in categories}
        for key in configured:
            if key not in known:
                categories.append(key)

        items = []
        for category in sorted(categories, key=lambda c: c.lower()):
            key = category.strip().lower()
            prefix = configured.get(key) or derived_code_prefix(category)
            items.append({
                "category": category,
                "prefix": prefix,
                "default_prefix": derived_code_prefix(category),
                "source": "configured" if key in configured else "default",
                "issued": self._rules.count_codes_in_family(prefix),
                "next_code": self._rules.next_code(prefix),
            })

        # Two categories may share a family. That is allowed — codes stay
        # unique because the counter is per family, not per category — but it
        # is worth saying out loud rather than discovering later.
        by_prefix: dict[str, list[str]] = {}
        for item in items:
            by_prefix.setdefault(item["prefix"], []).append(item["category"])
        for item in items:
            item["shared_with"] = [c for c in by_prefix[item["prefix"]] if c != item["category"]]

        return {"items": items, "total": len(items), "max_length": MAX_PREFIX_LENGTH}

    def set_code_prefix(self, category: str, prefix: str, actor: str = "user") -> dict:
        """
        Choose the code family for a category.

        Codes already issued keep the prefix they were issued under. Results
        cite codes, so rewriting one would quietly re-label old evidence; the
        new family starts with the next rule created.
        """
        category = (category or "").strip()
        if not category:
            raise ValueError("Name the category this prefix belongs to.")
        if len(category) > MAX_CATEGORY_LENGTH:
            raise ValueError(f"A category is limited to {MAX_CATEGORY_LENGTH} characters.")
        self._rules.set_code_prefix(category, normalise_prefix(prefix), actor)
        return self.list_code_prefixes()

    def clear_code_prefix(self, category: str) -> dict:
        """Back to the prefix derived from the category name."""
        self._rules.clear_code_prefix(category)
        return self.list_code_prefixes()

    def rule_usage(self, rule_definition_id: str) -> dict:
        if self._rules.get_rule(rule_definition_id) is None:
            raise LookupError("Rule not found.")
        return self._rules.usage(rule_definition_id)

    def delete_rule(self, rule_definition_id: str, *, force: bool = False) -> None:
        rule = self._rules.get_rule(rule_definition_id)
        if rule is None:
            raise LookupError("Rule not found.")
        # A rule in use is a warning, not a lock: the person is told where it is
        # used (the Rule Workspace shows it) and may still delete it. Without
        # `force` the request is refused, so no caller deletes one unknowingly.
        # What deleting it does: its attachments to node instances go with its
        # configurations; Discover sessions keep their own copy and their run
        # snapshots, and the rule's version history is kept.
        if not force:
            usage = self._rules.usage(rule_definition_id)
            if usage["in_use"]:
                raise RuleInUseError(_in_use_message(rule["name"], usage), usage)
        self._rules.delete_rule(rule_definition_id)

    # ── internals ────────────────────────────────────────────────────────────

    def _validated(self, command: SaveRuleCommand, *, excluding_id: str = "") -> dict:
        name = command.name.strip()
        if not name:
            raise ValueError("Give the rule a name.")
        if self._rules.name_taken(name, excluding_id=excluding_id):
            raise ValueError(f"A rule called “{name}” already exists.")

        category = command.category.strip()
        if not category:
            raise ValueError("Give the rule a category so the library stays organised.")
        if len(category) > MAX_CATEGORY_LENGTH:
            raise ValueError(f"A category is limited to {MAX_CATEGORY_LENGTH} characters.")
        # On a new rule, reuse the spelling already in the library so "GIS",
        # "Gis" and "gis" do not become three groups of one thing. On an edit
        # the typed spelling wins: that is how a category gets renamed, and
        # snapping back to the old one would make renaming impossible.
        if not excluding_id:
            category = next(
                (known for known in self._rules.list_categories() if known.lower() == category.lower()),
                category,
            )
        if command.dimension not in _DIMENSION_KEYS:
            raise ValueError(f"'{command.dimension}' is not a known quality dimension.")
        if command.data_type not in _DATA_TYPE_KEYS:
            raise ValueError(f"'{command.data_type}' is not a kind of field a rule can be attached to.")
        # Left empty, a rule needs whatever its check normally needs. Set, it
        # can describe execution the engine does not have yet — which is the
        # reason the field exists.
        execution_scope = (command.execution_scope or "").strip() or default_execution_scope(
            command.check_type, command.definition_kind
        )
        if execution_scope not in EXECUTION_SCOPE_BY_KEY:
            raise ValueError(f"'{execution_scope}' is not a kind of execution this platform knows.")

        common = {
            "name": name,
            "description": command.description.strip(),
            "category": category,
            "definition_kind": command.definition_kind,
            "dimension": command.dimension,
            "data_type": command.data_type,
            "rationale": command.rationale.strip(),
            "reference": command.reference.strip(),
            "message_template": command.message_template.strip(),
            "owner": command.owner.strip(),
            "examples": {
                "pass": [v.strip() for v in command.examples_pass if v.strip()],
                "fail": [v.strip() for v in command.examples_fail if v.strip()],
            },
            "severity": command.severity,
            "status": command.status,
            "execution_scope": execution_scope,
        }

        if command.definition_kind == "python":
            report = python_rules.validate(command.script)
            if not report["ok"]:
                first = report["errors"][0]
                raise ValueError(f"Line {first['line']}: {first['message']}")
            return {
                **common,
                # A script is handed one field's value plus its row, so it is a
                # field rule however much of the row it reads.
                "scope": "field",
                "check_type": "python",
                "script": command.script.strip("\n"),
                # Only the shared parameters are validated here. Anything else
                # the script reads through `params` is the author's own, and
                # the check catalogue knows nothing about it.
                "parameters": _script_parameters(command.parameters),
            }

        spec = CHECK_TYPE_BY_KEY.get(command.check_type)
        if spec is None:
            raise ValueError(f"'{command.check_type}' is not a check this workspace can run.")
        if command.check_type == "allowed_values" and command.governs_values:
            # The whole question an approved-list rule asks is which values it
            # accepts. Saved without an answer it would run against nothing and
            # report every row as wrong, so the author is stopped here instead.
            if not command.reference_element_type_id.strip():
                raise ValueError(
                    "Choose the governed vocabulary this rule checks against, and tick the "
                    "values it approves."
                )
        return {
            **common,
            # The check decides whether a rule reads one field or the whole
            # record, so the author never has to state it.
            "scope": spec["scope"],
            "check_type": command.check_type,
            "script": "",
            "parameters": validate_parameters(command.check_type, command.parameters),
        }

    _UNSET = object()

    def _present(self, rule: dict, *, primary=_UNSET, lookups=None) -> dict:
        return {**self._describe(rule), **self._governance_of(rule, primary=primary, lookups=lookups)}

    # ── governance carried on the rule ───────────────────────────────────────

    def primary_configuration(self, rule_definition_id: str) -> dict | None:
        """
        The one configuration a rule is edited through.

        The Rule Workspace shows a rule as a single thing, so a rule has one
        configuration and that is the one every screen reads. Databases written
        before the two were merged may hold several; the active one with the
        lowest code is chosen, deterministically, so the same rule never
        resolves to a different half of itself on two screens.
        """
        return _pick_primary(
            self._configurations.list_configurations(rule_definition_id=rule_definition_id)
        )

    def _governance_of(self, rule: dict, *, primary=_UNSET, lookups=None) -> dict:
        """What this rule checks against, read from its configuration."""
        rule_id = rule.get("rule_definition_id") or ""
        if primary is not RuleService._UNSET:
            configuration = primary
        else:
            configuration = self.primary_configuration(rule_id) if rule_id else None
        if configuration is None:
            return {
                "rule_configuration_id": "",
                "reference_element_type_id": "",
                "reference_element_type_name": "",
                "reference_model_name": "",
                "reference_value_ids": [],
                "reference_values": [],
            }
        presented = self._configuration_service._present(configuration, lookups=lookups)
        return {
            "rule_configuration_id": presented.get("rule_configuration_id", ""),
            "reference_element_type_id": presented.get("reference_element_type_id") or "",
            "reference_element_type_name": presented.get("reference_element_type_name") or "",
            "reference_model_name": presented.get("reference_model_name") or "",
            "reference_value_ids": presented.get("reference_value_ids") or [],
            "reference_values": presented.get("resolved_from_vocabulary") or [],
        }

    def _save_governance(self, rule: dict, command: SaveRuleCommand, actor: str) -> None:
        """
        Write the vocabulary and the approved values the author chose, onto the
        rule's own configuration — creating it if the rule had none.

        A payload that does not mean to say anything about governance leaves it
        untouched: an import and an older client both omit these fields, and
        reading that as "approve nothing" would quietly disarm a live rule.
        """
        if not command.governs_values:
            return
        rule_id = rule["rule_definition_id"]
        existing = self.primary_configuration(rule_id)
        payload = SaveRuleConfigurationCommand(
            rule_definition_id=rule_id,
            name=(existing or {}).get("name") or rule["name"],
            description=(existing or {}).get("description") or "",
            parameters=dict((existing or {}).get("parameters") or {}),
            severity=(existing or {}).get("severity") or "",
            # The configuration is the rule, so it is live exactly when the
            # rule is. A draft rule with an active configuration would be
            # offered by governance while reading as unfinished.
            status="active" if rule.get("status") == "active" else "draft",
            reference_element_type_id=command.reference_element_type_id.strip(),
            reference_value_ids=list(command.reference_value_ids or []),
            owner=rule.get("owner") or "",
        )
        if existing is None:
            self._configuration_service.create_configuration(payload, actor)
        else:
            self._configuration_service.update_configuration(
                existing["rule_configuration_id"], payload, actor
            )

    @staticmethod
    def _describe(rule: dict) -> dict:
        # A rule written before execution scope existed carries none. Deriving
        # it on read rather than migrating the table means the answer follows
        # the check type, which is where it came from in the first place.
        scope = rule.get("execution_scope") or default_execution_scope(
            rule.get("check_type", ""), rule.get("definition_kind", "builtin")
        )
        rule = {
            **rule,
            "execution_scope": scope,
            "execution_scope_label": execution_scope_label(scope),
            # The engine's current reach, not a property of the rule. A script
            # is a separate limit: validated and stored, but nothing runs it.
            "is_executable": is_executable_scope(scope)
            and rule.get("definition_kind") != "python",
            # A script reads the row itself, so it is offered on any field.
            "applies_to_label": next(
                (t["label"] for t in DATA_TYPES if t["key"] == rule.get("data_type", "any")),
                rule.get("data_type", "any"),
            ),
            "dimension_label": next(
                (d["label"] for d in DIMENSIONS if d["key"] == rule.get("dimension")),
                rule.get("dimension", ""),
            ),
        }
        if rule.get("definition_kind") == "python":
            report = python_rules.validate(rule.get("script") or "")
            ignored = rule["parameters"].get(IGNORED_VALUES_PARAM["name"]) or []
            statement = python_rules.summarise(report["row_fields"])
            return {
                **rule,
                "check_label": "Custom Python script",
                "statement": statement + (f" · ignores {', '.join(ignored)}" if ignored else ""),
                "script_sha256": python_rules.sha256(rule.get("script") or ""),
            }

        spec = CHECK_TYPE_BY_KEY.get(rule["check_type"])
        return {
            **rule,
            "check_label": spec["label"] if spec else rule["check_type"],
            "statement": describe(rule["check_type"], rule["parameters"]),
            "script_sha256": "",
        }


def _script_parameters(parameters: dict) -> dict:
    """
    Keep the shared parameters, and whatever else the script reads.

    A script names its own parameters, so this cannot check them against a
    catalogue. It does keep them clean: text in, text out, nothing nested.
    """
    cleaned: dict = {}
    for name, value in (parameters or {}).items():
        if name == TOLERANCE_PARAM["name"]:
            if value is None or str(value).strip() == "":
                continue
            tolerance = float(value)
            if not 0 <= tolerance <= 100:
                raise ValueError("Tolerance must be between 0 and 100 percent.")
            cleaned[name] = tolerance
        elif name == IGNORED_VALUES_PARAM["name"]:
            values = [str(v).strip() for v in (value or []) if str(v).strip()]
            if values:
                cleaned[name] = values
        elif isinstance(value, (str, int, float, bool)):
            cleaned[name] = value
        elif isinstance(value, list):
            cleaned[name] = [str(v) for v in value]
    return cleaned
