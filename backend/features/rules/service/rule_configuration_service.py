"""
RuleConfigurationService — naming and parameterising a rule for a purpose.

The split this service exists for: a **definition** says what a check does, a
**configuration** says what it checks against. "Value is one of an approved
list" is one definition; Valid Voltage, Valid Manufacturer and Valid
Operational Status are three configurations of it.

Without that split, every new list of approved values becomes another rule
definition, and the library fills up with near-identical checks that have to be
maintained separately. With it, the logic is written once and the governance
varies above it.

A configuration takes its values either literally, or from a governed
vocabulary. The second is preferred and this service encourages it: a
configuration pointing at an element type resolves its list at run time, so the
vocabulary stays the single source and nothing drifts.
"""
from __future__ import annotations

from features.rules.domain.check_types import CHECK_TYPE_BY_KEY, describe, validate_parameters
from features.rules.domain.models import SaveRuleConfigurationCommand
from features.rules.repo.rule_configuration_repository import RuleConfigurationRepository
from features.rules.repo.rule_repository import RuleRepository
from features.rules.repo.support_domain_vocabulary_repository import (
    SupportDomainVocabularyRepository,
)

#: Checks whose parameters are a list of accepted values. Only these can draw
#: that list from a governed vocabulary; pointing a range check at a vocabulary
#: would be meaningless, so it is refused rather than quietly ignored.
LIST_PARAMETER = {
    "allowed_values": "allowed_values",
}

SEVERITIES = {"low", "medium", "high"}
STATUSES = {"draft", "active", "retired"}


class PresentLookups:
    """
    What `_present` reads from the database, fetched once for a whole list.

    Presenting a list used to query per row — the vocabulary behind each
    configuration and its link count — so the Rule Workspace ran a few queries
    for every rule it showed. One instance of this is shared by the rows of
    one response: link counts arrive in one query, each vocabulary is read once.
    """

    def __init__(self, service: "RuleConfigurationService", configuration_ids: list[str]) -> None:
        self._service = service
        self._links = service._configurations.link_counts(configuration_ids)
        self._vocabularies: dict[str, list[dict]] = {}

    def vocabulary(self, element_type_id: str) -> list[dict]:
        if element_type_id not in self._vocabularies:
            self._vocabularies[element_type_id] = self._service._vocabulary.list_instances(element_type_id)
        return self._vocabularies[element_type_id]

    def link_count(self, rule_configuration_id: str) -> int:
        return self._links.get(rule_configuration_id, 0)


class RuleConfigurationService:
    def __init__(self, db_url: str) -> None:
        self._configurations = RuleConfigurationRepository(db_url)
        self._definitions = RuleRepository(db_url)
        self._vocabulary = SupportDomainVocabularyRepository(db_url)

    # ── reads ────────────────────────────────────────────────────────────────

    def list_configurations(
        self, *, rule_definition_id: str = "", search: str = "", status: str = ""
    ) -> dict:
        rows = self._configurations.list_configurations(
            rule_definition_id=rule_definition_id, search=search, status=status
        )
        lookups = self.lookups_for(rows)
        items = [self._present(c, lookups=lookups) for c in rows]
        return {
            "items": items,
            "total": len(items),
            "active": sum(1 for c in items if c["status"] == "active"),
        }

    def list_linkable(self, search: str = "") -> dict:
        """
        Everything a governance screen can offer: every active configuration,
        plus every active definition that has none yet.

        The library holds far more definitions than configurations, and most of
        them need no configuring — "Asset ID must be populated" takes no
        parameters and admits no second opinion. A picker that showed only
        configurations would therefore show a handful of rules out of thirty,
        and the person linking them would have no way of knowing the rest
        existed.

        So a definition with no configuration is offered as itself. Linking it
        creates its default configuration (see `ensure_default_configuration`)
        and links that, which keeps the attachment pointing at a configuration
        the way everything downstream expects.

        A definition that already has configurations is represented by them
        rather than by itself: the configurations are the choice, and offering
        the bare definition beside them would ask a question with no answer.
        """
        rows = self._configurations.list_configurations(search=search, status="active")
        lookups = self.lookups_for(rows)
        configurations = [{**self._present(c, lookups=lookups), "kind": "configuration"} for c in rows]
        configured = {c["rule_definition_id"] for c in configurations}
        definitions = [
            self._as_offer(d)
            for d in self._definitions.list_rules(search=search, status="active")
            if d["rule_definition_id"] not in configured
        ]
        items = sorted(configurations + definitions, key=lambda i: i["name"].lower())
        return {
            "items": items,
            "total": len(items),
            "configurations": len(configurations),
            "definitions": len(definitions),
        }

    def _as_offer(self, definition: dict) -> dict:
        """A definition shaped like a configuration, so one list renders both."""
        parameters = dict(definition.get("parameters") or {})
        statement = ""
        if definition.get("definition_kind") != "python":
            try:
                statement = describe(definition["check_type"], parameters)
            except Exception:
                statement = ""
        return {
            "kind": "definition",
            # Empty on purpose: there is nothing to link to yet. The link call
            # takes the definition id and makes one.
            "rule_configuration_id": "",
            "rule_definition_id": definition["rule_definition_id"],
            "code": definition.get("code") or "",
            "name": definition["name"],
            "description": definition.get("description") or "",
            "parameters": parameters,
            "severity": "",
            "status": definition.get("status", ""),
            "owner": definition.get("owner") or "",
            "version": definition.get("version", 1),
            "definition_name": definition["name"],
            "check_type": definition.get("check_type", ""),
            "definition_kind": definition.get("definition_kind", ""),
            "scope": definition.get("scope", ""),
            "execution_scope": definition.get("execution_scope", ""),
            "dimension": definition.get("dimension", ""),
            "data_type": definition.get("data_type", "any"),
            "definition_severity": definition.get("severity", ""),
            "definition_version": definition.get("version", 1),
            "reference_element_type_id": "",
            "reference_element_type_name": None,
            "reference_model_name": None,
            "resolved_from_vocabulary": [],
            "values_source": "fixed",
            "effective_severity": definition.get("severity", ""),
            "statement": statement,
            "linked_to": 0,
        }

    def ensure_default_configuration(self, rule_definition_id: str, actor: str = "user") -> dict:
        """
        The configuration a definition gets when somebody links the definition
        itself.

        Same name, same parameters, active. Making a person open the Rule
        Workspace and invent a configuration name before they can link a rule
        that needs no parameters is ceremony with nothing behind it.

        Idempotent: linking the same rule to five elements creates one
        configuration, not five, so the library does not fill with copies of
        the same check under the same name.
        """
        definition = self._definitions.get_rule(rule_definition_id)
        if definition is None:
            raise ValueError("That rule definition is no longer in the library.")
        if definition.get("status") == "retired":
            raise ValueError(
                f"\u201c{definition['name']}\u201d is retired. A retired rule cannot be "
                "attached to new governance."
            )

        name = (definition.get("name") or "").strip()
        siblings = self._configurations.list_configurations(
            rule_definition_id=rule_definition_id
        )
        same_name = [
            c for c in siblings
            if (c.get("name") or "").strip().lower() == name.lower()
        ]
        reusable = next((c for c in same_name if c.get("status") != "retired"), None)
        if reusable is not None:
            return self._present(reusable)
        if same_name:
            # The name is held by a retired configuration. Reviving it would
            # un-retire a decision somebody made; a new one beside it says what
            # happened.
            name = f"{name} (governed)"

        return self.create_configuration(
            SaveRuleConfigurationCommand(
                rule_definition_id=rule_definition_id,
                name=name,
                description=definition.get("description") or "",
                parameters=dict(definition.get("parameters") or {}),
                severity="",
                status="active",
                reference_element_type_id="",
                owner=definition.get("owner") or "",
            ),
            actor,
        )

    def get_configuration(self, rule_configuration_id: str) -> dict:
        configuration = self._configurations.get_configuration(rule_configuration_id)
        if configuration is None:
            raise LookupError("Rule configuration not found.")
        return self._present(configuration)

    def list_versions(self, rule_configuration_id: str) -> dict:
        current = self._configurations.get_configuration(rule_configuration_id)
        versions = self._configurations.list_versions(rule_configuration_id)
        if current is None and not versions:
            raise LookupError("Rule configuration not found.")
        return {
            "rule_configuration_id": rule_configuration_id,
            "name": current["name"] if current else (versions[0]["name"] if versions else ""),
            "current_version": current["version"] if current else 0,
            "items": [{**v, "is_current": bool(current) and v["version"] == current["version"]}
                      for v in versions],
            "total": len(versions),
        }

    # ── writes ───────────────────────────────────────────────────────────────

    def create_configuration(
        self, command: SaveRuleConfigurationCommand, actor: str = "user"
    ) -> dict:
        data = self._validated(command)
        definition = self._definitions.get_rule(command.rule_definition_id)
        # The configuration's code sits under the definition's, so a reader can
        # see at a glance which check a configuration belongs to.
        data["code"] = self._configurations.next_code(
            (definition.get("code") or "RULE").strip()
        )
        return self._present(self._configurations.insert_configuration(data, actor))

    def update_configuration(
        self, rule_configuration_id: str, command: SaveRuleConfigurationCommand, actor: str = "user"
    ) -> dict:
        existing = self._configurations.get_configuration(rule_configuration_id)
        if existing is None:
            raise LookupError("Rule configuration not found.")
        # The definition a configuration belongs to is part of its identity.
        # Changing it would silently turn a value list into a date format, so
        # the command's definition is checked against the stored one.
        if command.rule_definition_id != existing["rule_definition_id"]:
            raise ValueError(
                "A configuration cannot be moved to a different rule definition. "
                "Create a new configuration under that definition instead."
            )
        data = self._validated(command, excluding_id=rule_configuration_id)
        return self._present(
            self._configurations.update_configuration(rule_configuration_id, data, actor)
        )

    def delete_configuration(self, rule_configuration_id: str) -> None:
        if self._configurations.get_configuration(rule_configuration_id) is None:
            raise LookupError("Rule configuration not found.")
        links = self._configurations.link_count(rule_configuration_id)
        if links:
            raise ValueError(
                f"This configuration is linked to {links} governed "
                f"{'vocabulary' if links == 1 else 'vocabularies'}. Remove those links first, "
                "so nothing is left pointing at a rule that no longer exists."
            )
        self._configurations.delete_configuration(rule_configuration_id)

    # ── internals ────────────────────────────────────────────────────────────

    def _validated(
        self, command: SaveRuleConfigurationCommand, *, excluding_id: str = ""
    ) -> dict:
        definition = self._definitions.get_rule(command.rule_definition_id)
        if definition is None:
            raise ValueError("That rule definition is no longer in the library.")

        name = command.name.strip()
        if not name:
            raise ValueError("Give the configuration a name.")
        if self._configurations.name_taken(
            command.rule_definition_id, name, excluding_id=excluding_id
        ):
            raise ValueError(
                f"“{definition['name']}” already has a configuration called “{name}”."
            )
        if command.severity and command.severity not in SEVERITIES:
            raise ValueError(f"'{command.severity}' is not a severity.")
        if command.status not in STATUSES:
            raise ValueError(f"'{command.status}' is not a status.")

        reference = (command.reference_element_type_id or "").strip()
        parameters = dict(command.parameters or {})
        selected = [v for v in dict.fromkeys(command.reference_value_ids or []) if v]

        if reference:
            element_type = self._vocabulary.get_element_type(reference)
            if element_type is None:
                raise ValueError("That governed vocabulary no longer exists.")
            list_param = self._list_parameter(definition)
            if list_param is None:
                raise ValueError(
                    f"“{definition['name']}” does not check against a list of values, "
                    "so it cannot take them from a vocabulary. Set its parameters directly."
                )
            # The list is resolved at read time, never stored. Storing it would
            # make this a copy of the vocabulary that nobody remembers to update.
            parameters.pop(list_param, None)
            # The selection is a filter over that vocabulary, so a value from
            # somewhere else cannot ride in on it. Silently dropping a stray id
            # would leave the author looking at a tick that did nothing.
            known = {
                v["element_instance_id"] for v in self._vocabulary.list_instances(reference)
            }
            unknown = [v for v in selected if v not in known]
            if unknown:
                raise ValueError(
                    f"{len(unknown)} of the chosen values are not in "
                    f"\u201c{element_type['name']}\u201d. Choose them again from that vocabulary."
                )
        else:
            parameters = self._validated_parameters(definition, parameters)
            # Nothing to select from. Keeping the ids would make a rule that
            # reads a literal list look like it reads a vocabulary.
            selected = []

        return {
            "rule_definition_id": command.rule_definition_id,
            "name": name,
            "description": command.description.strip(),
            "parameters": parameters,
            "severity": command.severity or "",
            "status": command.status,
            "reference_element_type_id": reference,
            "reference_value_ids": selected,
            "owner": command.owner.strip(),
        }

    @staticmethod
    def _list_parameter(definition: dict) -> str | None:
        """The parameter that holds a list of accepted values, if this check has one."""
        spec = CHECK_TYPE_BY_KEY.get(definition.get("check_type", ""))
        if spec is None:
            return None
        for parameter in spec["parameters"]:
            if parameter["name"] in LIST_PARAMETER:
                return parameter["name"]
        return None

    @staticmethod
    def _validated_parameters(definition: dict, parameters: dict) -> dict:
        if definition.get("definition_kind") == "python":
            # A script names its own parameters; there is no catalogue to check
            # them against, so they are kept as given.
            return {k: v for k, v in parameters.items()}
        return validate_parameters(definition["check_type"], parameters)

    def lookups_for(self, configurations: list[dict]) -> PresentLookups:
        return PresentLookups(self, [c.get("rule_configuration_id", "") for c in configurations])

    def _present(self, configuration: dict, *, lookups: PresentLookups | None = None) -> dict:
        """
        One configuration as a reader needs it: the values it will actually use,
        and a plain sentence saying what it checks.
        """
        reference = configuration.get("reference_element_type_id") or ""
        parameters = dict(configuration.get("parameters") or {})
        selected_ids = list(configuration.get("reference_value_ids") or [])
        resolved_from_vocabulary: list[str] = []
        vocabulary_size = 0

        if reference:
            list_param = self._list_parameter(configuration)
            instances = (
                lookups.vocabulary(reference) if lookups else self._vocabulary.list_instances(reference)
            )
            vocabulary_size = len(instances)
            # No selection means the whole vocabulary. That is what binding a
            # rule to a vocabulary meant before subsets existed, and what an
            # author who picked a vocabulary and ticked nothing else expects.
            wanted = set(selected_ids)
            resolved_from_vocabulary = [
                v["value_name"]
                for v in instances
                if not wanted or v["element_instance_id"] in wanted
            ]
            # Values ticked and since retired are not in the vocabulary any
            # more, so the stored ids are narrowed to what still exists rather
            # than reported as approved.
            selected_ids = [
                v["element_instance_id"] for v in instances if v["element_instance_id"] in wanted
            ]
            if list_param:
                parameters[list_param] = resolved_from_vocabulary

        statement = ""
        if configuration.get("definition_kind") != "python":
            try:
                statement = describe(configuration["check_type"], parameters)
            except Exception:
                statement = ""

        return {
            **configuration,
            "parameters": parameters,
            # Kept apart from `parameters` so a reader can tell a list that was
            # typed in from one the vocabulary supplied.
            "resolved_from_vocabulary": resolved_from_vocabulary,
            "reference_value_ids": selected_ids,
            "reference_value_count": len(resolved_from_vocabulary),
            "reference_vocabulary_size": vocabulary_size,
            "values_source": "vocabulary" if reference else "fixed",
            "effective_severity": configuration.get("severity")
            or configuration.get("definition_severity", ""),
            "statement": statement,
            "linked_to": (
                lookups.link_count(configuration["rule_configuration_id"])
                if lookups
                else self._configurations.link_count(configuration["rule_configuration_id"])
            ) if configuration.get("rule_configuration_id") else 0,
        }
