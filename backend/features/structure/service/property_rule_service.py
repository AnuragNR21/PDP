"""
PropertyRuleService -- saying which checks apply to an Asset Property, and
which values that property approves.

This is the Structure Workspace's half of the rule story, and the smaller half
on purpose. It creates two kinds of fact and nothing else:

    this property is subject to this configuration
    this property is governed by this approved value

It never creates a rule, never copies one, never edits one. If a configuration
is wrong it is wrong in the Rule Workspace, and fixing it there fixes it
everywhere.

Nothing is inherited. Linking a configuration to four properties does not make
it apply to a fifth, and approving a value for one property says nothing about
its sibling. Every association is asserted, and every association can be read
back as exactly what it is.
"""
from __future__ import annotations

from features.rules.repo.rule_configuration_repository import RuleConfigurationRepository
from features.rules.repo.support_domain_vocabulary_repository import (
    SupportDomainVocabularyRepository,
)
from features.rules.service.rule_configuration_service import RuleConfigurationService
from features.structure.repo.property_rule_repository import (
    APPLICABILITY,
    PropertyLookupRepository,
    PropertyRuleRepository,
)
from features.structure.service.property_rule_presentation import (
    APPLICABILITY_OPTIONS,
    INCOMPLETE,
    present_property_link,
)


class PropertyRuleService:
    def __init__(self, db_url: str) -> None:
        self._links = PropertyRuleRepository(db_url)
        self._properties = PropertyLookupRepository(db_url)
        self._configurations = RuleConfigurationRepository(db_url)
        self._configuration_service = RuleConfigurationService(db_url)
        self._vocabulary = SupportDomainVocabularyRepository(db_url)

    # ── reads ────────────────────────────────────────────────────────────────

    def list_rules(self, node_instance_id: str) -> dict:
        prop = self._require_property(node_instance_id)
        values = self._links.list_values_for_property(node_instance_id)
        active = [v for v in values if v["status"] == "active" and v["value_status"] == "active"]
        links = self._links.list_for_property(node_instance_id)
        names = self._element_type_names(active, links)

        items = [present_property_link(link, active, names) for link in links]
        incomplete = [i for i in items if i["readiness"] == INCOMPLETE]
        return {
            "node_instance_id": node_instance_id,
            "property_name": prop["name"],
            "node_type_name": prop.get("node_type_name") or "",
            "model_id": prop["model_id"],
            "model_name": prop.get("model_name", ""),
            "path": [
                {
                    "node_instance_id": a["node_instance_id"],
                    "name": a["name"],
                    "node_type_id": a["node_type_id"],
                    "node_type_name": a.get("node_type_name") or "",
                }
                for a in self._properties.ancestors(node_instance_id)
            ],
            "items": items,
            "total": len(items),
            "required": sum(1 for i in items if i["applicability"] == "required"),
            "incomplete": len(incomplete),
            "approved_values": active,
            "applicability_options": APPLICABILITY_OPTIONS,
        }

    def counts_for_model(self, model_id: str) -> dict:
        return {"counts": self._links.counts_by_property(model_id)}

    def list_available_configurations(self, node_instance_id: str, search: str = "") -> dict:
        """
        The configurations this property could be subject to, with the ones it
        already carries marked rather than removed -- a picker that silently
        drops what is already chosen makes it impossible to see what the choice
        was.
        """
        linked = {
            link["rule_configuration_id"]
            for link in self._links.list_for_property(node_instance_id)
        }
        report = self._configuration_service.list_linkable(search=search)
        items = [
            {
                **c,
                "is_linked": bool(c["rule_configuration_id"])
                and c["rule_configuration_id"] in linked,
            }
            for c in report["items"]
        ]
        return {
            "items": items,
            "total": len(items),
            "configurations": report["configurations"],
            "definitions": report["definitions"],
            "linked": len(linked),
        }

    # ── approved values ──────────────────────────────────────────────────────

    def list_values(self, node_instance_id: str) -> dict:
        self._require_property(node_instance_id)
        values = self._links.list_values_for_property(node_instance_id)
        return {
            "node_instance_id": node_instance_id,
            "items": values,
            "total": len(values),
        }

    def list_candidate_values(self, node_instance_id: str, element_type_id: str) -> dict:
        """
        The values of one vocabulary, with the ones this property already
        approves marked.
        """
        self._require_property(node_instance_id)
        element_type = self._vocabulary.get_element_type(element_type_id)
        if element_type is None:
            raise LookupError("That vocabulary no longer exists.")
        approved = {
            v["element_instance_id"]
            for v in self._links.list_values_for_property(node_instance_id)
            if v["status"] == "active"
        }
        items = [
            {**v, "is_approved": v["element_instance_id"] in approved}
            for v in self._links.list_candidate_values(element_type_id)
        ]
        return {
            "element_type_id": element_type_id,
            "element_type_name": element_type["name"],
            "model_name": element_type.get("model_name", ""),
            "items": items,
            "total": len(items),
            "approved": sum(1 for i in items if i["is_approved"]),
        }

    def list_vocabularies(self, support_domain_model_id: str = "") -> dict:
        return {"items": self._vocabulary.list_element_types(support_domain_model_id)}

    def approve_value(
        self, node_instance_id: str, element_instance_id: str, actor: str = "user"
    ) -> dict:
        self._require_property(node_instance_id)
        link = self._links.link_value(node_instance_id, element_instance_id, actor=actor)
        if not link:
            raise ValueError("That value is no longer in the Support Domain model.")
        return link

    def set_approved_values(
        self, node_instance_id: str, element_instance_ids: list[str], actor: str = "user"
    ) -> dict:
        """
        Replace this property's approved values with exactly these.

        A set rather than one at a time, because that is how an approved list is
        edited: the screen shows the whole list and saves the whole list.
        """
        self._require_property(node_instance_id)
        wanted = list(dict.fromkeys(element_instance_ids))
        current = {
            v["element_instance_id"]: v
            for v in self._links.list_values_for_property(node_instance_id)
        }
        for instance_id, value in current.items():
            if instance_id not in wanted:
                self._links.unlink_value(value["reference_link_id"])
        added = 0
        for instance_id in wanted:
            if instance_id in current:
                continue
            if not self._links.link_value(node_instance_id, instance_id, actor=actor):
                raise ValueError("That value is no longer in the Support Domain model.")
            added += 1
        return {
            "node_instance_id": node_instance_id,
            "approved": len(wanted),
            "added": added,
            "removed": len([i for i in current if i not in wanted]),
        }

    def revoke_value(self, reference_link_id: str) -> None:
        if not self._links.value_link_exists(reference_link_id):
            raise LookupError("That approved value link no longer exists.")
        self._links.unlink_value(reference_link_id)

    # ── writes ───────────────────────────────────────────────────────────────

    def link_rule(
        self,
        node_instance_id: str,
        rule_configuration_id: str = "",
        *,
        rule_definition_id: str = "",
        applicability: str = "recommended",
        notes: str = "",
        actor: str = "user",
    ) -> dict:
        """
        Make this property subject to a configuration, or to a definition that
        has none yet, in which case its default configuration is created and
        that is what is linked.

        An association whose reference source is missing may still be saved --
        Jeff's note is explicit about that -- but it is saved as incomplete and
        the check will not execute until the values are linked.
        """
        self._require_property(node_instance_id)
        if not rule_configuration_id:
            if not rule_definition_id:
                raise ValueError("Choose a rule to link.")
            rule_configuration_id = self._configuration_service.ensure_default_configuration(
                rule_definition_id, actor
            )["rule_configuration_id"]
        configuration = self._configurations.get_configuration(rule_configuration_id)
        if configuration is None:
            raise ValueError("That rule configuration is no longer in the Rule Workspace.")
        if configuration["status"] == "retired":
            raise ValueError(
                f"“{configuration['name']}” is retired. A retired configuration "
                "cannot be attached to new governance."
            )
        applicability = (applicability or "recommended").strip().lower()
        if applicability not in APPLICABILITY:
            raise ValueError(
                f"'{applicability}' is not an applicability. "
                f"Use one of: {', '.join(APPLICABILITY)}."
            )
        link = self._links.link(
            node_instance_id,
            rule_configuration_id,
            applicability=applicability,
            notes=notes.strip(),
            actor=actor,
        )
        values = [
            v
            for v in self._links.list_values_for_property(node_instance_id)
            if v["status"] == "active" and v["value_status"] == "active"
        ]
        return present_property_link(
            link, values, self._element_type_names(values, [link])
        )

    def update_rule(self, property_rule_id: str, *, applicability: str, notes: str = "") -> None:
        if not self._links.link_exists(property_rule_id):
            raise LookupError("That link no longer exists.")
        applicability = (applicability or "recommended").strip().lower()
        if applicability not in APPLICABILITY:
            raise ValueError(f"'{applicability}' is not an applicability.")
        self._links.update_link(
            property_rule_id, applicability=applicability, notes=notes.strip()
        )

    def unlink_rule(self, property_rule_id: str) -> None:
        if not self._links.link_exists(property_rule_id):
            raise LookupError("That link no longer exists.")
        self._links.unlink(property_rule_id)

    # ── internals ────────────────────────────────────────────────────────────

    def _require_property(self, node_instance_id: str) -> dict:
        prop = self._properties.get_property(node_instance_id)
        if prop is None:
            raise LookupError("That property no longer exists.")
        return prop

    def _element_type_names(
        self, values: list[dict], links: list[dict] | None = None
    ) -> dict[str, str]:
        """
        Element type id to name, for every type in play.

        The approved values name their own type for free. A configuration that
        expects a vocabulary this property approves *nothing* from does not, and
        that is exactly the case whose message needs the name -- so those are
        read from the Rule Workspace's side.
        """
        names = {
            v["element_type_id"]: v.get("element_type_name", "")
            for v in values
            if v.get("element_type_id")
        }
        for link in links or []:
            expected = (link.get("reference_element_type_id") or "").strip()
            if not expected or expected in names:
                continue
            element_type = self._vocabulary.get_element_type(expected)
            names[expected] = element_type["name"] if element_type else expected
        return names
