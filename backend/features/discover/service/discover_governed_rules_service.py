"""
DiscoverGovernedRulesService -- the Rules step, resolved rather than asked.

The step used to show the whole rule library against every mapped field and ask
the person which ones applied. That made the answer a matter of opinion, and it
made it a matter of opinion again in the next session.

Now the field's own governance answers it, and the path is short:

    source column
      -> the Asset Property it is mapped to            (column_mapping)
      -> the configurations that property is subject to (node_instance_rule)
      -> the values that property approves              (cross_model_relationship_instance,
                                                         governance_role = 'approves_values')

Nothing is inherited and nothing is inferred. A configuration linked to four
properties says nothing about a fifth; a vocabulary a property draws values from
carries no rules of its own. If a rule is not related to this property, this
field is not offered it -- and the step says so rather than falling back to the
library.

The second resolution matters as much as the first. A configuration declares the
vocabulary it checks against; the property declares which of those values it
approves. Where the two meet, the check can run against a real list. Where they
do not, the association is *incomplete*: it is reported, it is explained, and it
does not run. A missing source must never become an unrestricted pass.
"""
from __future__ import annotations

from features.discover.repo.discover_dataset_repository import DiscoverDatasetRepository
from features.discover.repo.discover_governance_repository import DiscoverGovernanceRepository
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from features.rules.repo.support_domain_vocabulary_repository import (
    SupportDomainVocabularyRepository,
)
from features.structure.repo.property_rule_repository import (
    PropertyLookupRepository,
    PropertyRuleRepository,
)
from features.structure.service.property_rule_presentation import (
    INCOMPLETE,
    READY,
    present_property_link,
)

#: Required rules are ticked for the analyst. The other two are offered.
TICKED_BY_DEFAULT = {"required"}


class DiscoverGovernedRulesService:
    def __init__(self, db_url: str) -> None:
        self._sessions = DiscoverSessionRepository(db_url)
        self._datasets = DiscoverDatasetRepository(db_url)
        self._properties = PropertyRuleRepository(db_url)
        self._lookup = PropertyLookupRepository(db_url)
        self._vocabulary = SupportDomainVocabularyRepository(db_url)
        self._governance = DiscoverGovernanceRepository(db_url)

    def list_field_rules(self, session_id: str) -> dict:
        """
        Every mapped field of the session, with the checks its property carries.

        Fields with no governed rules are still listed. Leaving them out would
        hide the gap, and the gap is the thing somebody needs to act on.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        columns = self._datasets.list_mapped_columns_everywhere(session_id)
        node_ids = sorted({c["target_node_id"] for c in columns if c.get("target_node_id")})

        # What this session has actually attached, as opposed to what
        # governance says should apply. The two were never shown apart, so a
        # Required rule rendered as already ticked while nothing was stored,
        # and the run that followed had no governed rule in it at all.
        attached: dict[tuple[str, str], bool] = {}
        for configuration in self._governance.list_configurations(session_id):
            key = (
                configuration.get("column_id") or "",
                configuration.get("source_rule_configuration_id") or "",
            )
            attached[key] = bool(configuration.get("is_enabled"))

        links_by_property: dict[str, list[dict]] = {}
        for link in self._properties.list_for_properties(node_ids):
            links_by_property.setdefault(link["node_instance_id"], []).append(link)

        values_by_property: dict[str, list[dict]] = {}
        for value in self._properties.list_values_for_properties(node_ids):
            values_by_property.setdefault(value["node_instance_id"], []).append(value)

        all_links = [l for group in links_by_property.values() for l in group]
        all_values = [v for group in values_by_property.values() for v in group]
        names = self._element_type_names(all_values, all_links)

        fields = []
        for column in columns:
            node_id = column.get("target_node_id") or ""
            values = values_by_property.get(node_id, [])
            items = [
                present_property_link(link, values, names)
                for link in links_by_property.get(node_id, [])
            ]
            for item in items:
                item["is_attached"] = attached.get(
                    (column["column_id"], item.get("rule_configuration_id") or ""), False
                )
                # Governance says this check applies and it can run, but this
                # session has not stored it yet. The screen has to act on this
                # rather than draw a tick over it.
                item["needs_apply"] = bool(
                    item["selected_by_default"] and not item["is_attached"]
                )
            items.sort(key=lambda e: (_rank(e["applicability"]), e["name"].lower()))

            runnable = [i for i in items if i["readiness"] == READY]
            incomplete = [i for i in items if i["readiness"] == INCOMPLETE]
            fields.append({
                "column_id": column["column_id"],
                "column_name": column["column_name"],
                "table_name": column.get("table_name", ""),
                "target_node_id": node_id,
                "target_name": column.get("target_name"),
                "detected_type": column.get("detected_type", ""),
                "items": items,
                "total": len(items),
                "runnable": len(runnable),
                "attached": sum(1 for i in items if i["is_attached"]),
                # Required and ready, but not stored on this session yet.
                "needs_apply": [i["property_rule_id"] for i in items if i["needs_apply"]],
                "required": sum(1 for i in runnable if i["applicability"] == "required"),
                # Reported apart from data-quality findings, deliberately. One
                # says the governance is unfinished; the other says the data is
                # wrong, and they need different people.
                "configuration_errors": [
                    {
                        "property_rule_id": i["property_rule_id"],
                        "rule_configuration_id": i["rule_configuration_id"],
                        "name": i["name"],
                        "code": i["code"],
                        "expected_reference_type_id": i["expected_reference_type_id"],
                        "expected_reference_type_name": i["expected_reference_type_name"],
                        "reason": i["readiness_reason"],
                    }
                    for i in incomplete
                ],
                # What the rules on this field accept, by vocabulary, so the
                # step can show what is being measured against without a second
                # request. Read from the rules, not from the property: the
                # property's own value links are a store this design no longer
                # resolves against, and showing them beside a rule that ignores
                # them is how somebody reads the wrong approved list.
                "approved_by_vocabulary": [
                    {
                        "element_type_id": item["expected_reference_type_id"],
                        "element_type_name": item["expected_reference_type_name"],
                        "count": len(item["approved_values"]),
                    }
                    for item in items
                    if item["reference_requirement"] == "approved_values"
                    and item["expected_reference_type_name"]
                ],
                "empty_reason": self._empty_reason(column, node_id, items),
            })

        governed = sum(1 for f in fields if f["total"])
        return {
            "session_id": session_id,
            "fields": fields,
            "total_fields": len(fields),
            "governed_fields": governed,
            "ungoverned_fields": len(fields) - governed,
            "configuration_errors": sum(len(f["configuration_errors"]) for f in fields),
        }

    # ── applying the analyst's choice ────────────────────────────────────────

    def set_field_rules(
        self, session_id: str, column_id: str, property_rule_ids: list[str], actor: str = "user"
    ) -> dict:
        """
        Run exactly these governed rules on this field, and no others.

        What is attached is the *configuration*: its parameters, with the
        approved values resolved from this property's own governed-by links.
        Attaching the definition alone would run the check against nothing.

        The attachment records both versions -- the definition's and the
        configuration's -- along with the property and the approved-value
        snapshot, so a finding can be read back as what actually ran rather than
        as whatever the governance says today.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        report = self.list_field_rules(session_id)
        field = next((f for f in report["fields"] if f["column_id"] == column_id), None)
        if field is None:
            raise ValueError("That field is not mapped in this session.")

        offered = {item["property_rule_id"]: item for item in field["items"]}
        unknown = [i for i in property_rule_ids if i not in offered]
        if unknown:
            # Refusing is the point of the step: a rule its governance does not
            # reach must not be runnable on this field by any route.
            raise ValueError(
                "One of those rules is not carried by this field's governance. "
                "Reload the step and choose again."
            )

        blocked = [
            offered[i] for i in property_rule_ids if offered[i]["readiness"] == INCOMPLETE
        ]
        if blocked:
            # Saved for completion in Structure, but not executable here.
            first = blocked[0]
            raise ValueError(
                f"“{first['name']}” cannot run on this field yet. "
                f"{first['readiness_reason']}"
            )

        wanted = list(dict.fromkeys(property_rule_ids))
        current = {
            config.get("source_rule_configuration_id", ""): config
            for config in self._governance.list_configurations(session_id)
            if config.get("column_id") == column_id
            and config.get("source_rule_configuration_id")
        }
        keep = {offered[i]["rule_configuration_id"] for i in wanted}

        for configuration_id, config in current.items():
            if configuration_id not in keep:
                self._governance.delete_attachment(config["configuration_id"])

        added = 0
        refreshed = 0
        for property_rule_id in wanted:
            rule = offered[property_rule_id]
            existing = current.get(rule["rule_configuration_id"])
            if existing is not None:
                # Already attached, but the approved values may have moved
                # since. Re-resolve rather than leave the older list in place:
                # the client's note requires readiness and its reference data to
                # be revalidated before execution, and an attachment that has
                # not run yet is an instruction, not evidence.
                self._refresh(session_id, field, rule, existing)
                refreshed += 1
                continue
            self._attach(session_id, field, rule)
            added += 1

        return {
            "session_id": session_id,
            "column_id": column_id,
            "attached": len(wanted),
            "added": added,
            "refreshed": refreshed,
        }

    def _refresh(self, session_id: str, field: dict, rule: dict, existing: dict) -> None:
        self._governance.refresh_attachment(existing["rule_id"], {
            "severity": rule["effective_severity"],
            "permitted_parameters": list(rule["parameters"].keys()),
            "default_parameters": rule["parameters"],
            "source_rule_version": rule.get("definition_version", ""),
            "source_rule_configuration_version": rule.get("configuration_version", ""),
        })
        self._governance.upsert_configuration(session_id, {
            "rule_id": existing["rule_id"],
            "column_id": field["column_id"],
            "column_name": field["column_name"],
            "target_node_id": field.get("target_node_id") or "",
            "target_name": field.get("target_name"),
            "is_enabled": True,
            "severity": rule["effective_severity"],
            "parameters": rule["parameters"],
        })

    def _attach(self, session_id: str, field: dict, rule: dict) -> None:
        created = self._governance.create_custom_rule(session_id, {
            "rule_kind": "dq",
            "code": self._free_code(rule["code"] or "RULE"),
            "name": rule["name"],
            "description": rule["description"],
            "check_type": rule["check_type"],
            "applies_to": "field" if rule["scope"] == "field" else "dataset",
            "severity": rule["effective_severity"],
            "requires_parameters": False,
            "permitted_parameters": list(rule["parameters"].keys()),
            # Resolved here, frozen on the attachment. A value approved or
            # revoked tomorrow does not quietly change what this run measured.
            "default_parameters": rule["parameters"],
            "source_rule_definition_id": rule["rule_definition_id"],
            "source_rule_version": rule.get("definition_version", ""),
            "source_rule_configuration_id": rule["rule_configuration_id"],
            "source_rule_configuration_version": rule.get("configuration_version", ""),
        })
        self._governance.upsert_configuration(session_id, {
            "rule_id": created["rule_id"],
            "column_id": field["column_id"],
            "column_name": field["column_name"],
            "target_node_id": field.get("target_node_id") or "",
            "target_name": field.get("target_name"),
            "is_enabled": True,
            "severity": rule["effective_severity"],
            "parameters": rule["parameters"],
        })

    def _free_code(self, code: str) -> str:
        from uuid import uuid4

        if not self._governance.code_taken(code):
            return code
        return f"{code}-{uuid4().hex[:4].upper()}"

    # ── internals ────────────────────────────────────────────────────────────

    def _element_type_names(
        self, values: list[dict], links: list[dict]
    ) -> dict[str, str]:
        names = {
            v["element_type_id"]: v.get("element_type_name", "")
            for v in values
            if v.get("element_type_id")
        }
        for link in links:
            expected = (link.get("reference_element_type_id") or "").strip()
            if not expected or expected in names:
                continue
            element_type = self._vocabulary.get_element_type(expected)
            names[expected] = element_type["name"] if element_type else expected
        return names

    @staticmethod
    def _empty_reason(column: dict, node_id: str, items: list[dict]) -> str:
        """
        Why this field has no rules -- named precisely enough to act on.

        Two situations look identical on screen otherwise, and they need two
        different people to fix them.
        """
        if items:
            return ""
        if not node_id:
            return "This column is not mapped to a governed concept yet."
        concept = column.get("target_name") or "this property"
        return (
            f"“{concept}” is not subject to any rule configuration. Link one in "
            "the Structure Workspace: open the property and use its Rules tab."
        )


def _rank(applicability: str) -> int:
    return {"required": 0, "recommended": 1, "available": 2}.get(applicability, 3)
