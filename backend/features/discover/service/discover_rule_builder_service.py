"""
DiscoverRuleBuilderService — assembling a session's rules from governance.

This is the only path by which a rule enters a Discover session. A rule is not
chosen from a shelf of pre-written checks and it is not typed free-hand; it is
built from three governed parts:

    Support Domain model      which body of governance this comes from
    cross-model relationship  what that governance binds to — the rule's
                              provenance, recorded on it
    comparator + value        the condition that field must satisfy

The middle part is what keeps it governance rather than opinion: a rule records
which governed relationship it was founded on, so "why does this rule exist?"
has an answer that outlives the person who built it.

It records rather than restricts. The relationship does not decide which field
the rule lands on — an earlier version made it do exactly that, and the step
became unusable the moment a model's relationships bound to types the file had
nothing mapped to. The field may be any the session has mapped; where a chosen
relationship does reach a field, the builder says so.
"""
from features.discover.domain.rule_builder import (
    ALL_COMPARATORS,
    CHECK_KINDS,
    CHECK_KIND_BY_TYPE,
    build_parameters,
    describe,
    infer_check,
)
from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_rule_builder_repository import (
    DiscoverRuleBuilderRepository,
)
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from features.discover.service.discover_governance_service import (
    DiscoverGovernanceService,
)


class DiscoverRuleBuilderService:
    def __init__(self, db_url: str) -> None:
        self._catalog = DiscoverRuleBuilderRepository(db_url)
        self._sessions = DiscoverSessionRepository(db_url)
        self._governance = DiscoverGovernanceService(db_url)
        self._audit = DiscoverAuditRepository(db_url)

    # ── step 1 ───────────────────────────────────────────────────────────────

    def list_support_models(self) -> dict:
        return {"models": self._catalog.list_support_models()}

    # ── step 2 ───────────────────────────────────────────────────────────────

    def list_links(self, session_id: str, support_model_id: str) -> dict:
        """
        The cross-model relationships of one Support Domain model, plus the
        fields of this session a rule can be set on.

        Every relationship of the model is selectable. An earlier version only
        let you pick one whose bound model type already had a column mapped to
        it, on the reasoning that governance should decide where a rule may go.
        In practice that reasoning locked the step: a model's relationships
        commonly bind to types this file has nothing mapped to, and the person
        was left with a list they could look at and not touch, and no way
        forward. Governance you cannot apply is not governance.

        So `columns` and `is_usable` stay, but as *information*: they say which
        fields a relationship actually reaches, and the UI surfaces that as a
        hint. What a rule may be set on is `mapped_columns` — everything this
        session has mapped — and the chosen relationships are recorded as the
        rule's provenance.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        by_node_type = self._catalog.mapped_columns_by_node_type(session_id)
        links = []
        for row in self._catalog.list_cross_model_links(support_model_id):
            columns = []
            note = ""
            if row["bound_model_type"] != "HIERARCHY_MODEL":
                note = "Connects two governance models — no field of your data sits under it."
            elif not row.get("bound_item_type_id"):
                note = "No model type on the other side yet."
            else:
                columns = by_node_type.get(row["bound_item_type_id"], [])
                if not columns:
                    note = (
                        f"Nothing in this file is mapped to "
                        f"{row.get('bound_type_name') or 'that model type'}."
                    )
            links.append({
                **row,
                "columns": columns,
                "is_usable": bool(columns),
                "unusable_reason": note,
            })

        return {
            "session_id": session_id,
            "support_model_id": support_model_id,
            "links": links,
            "total": len(links),
            "usable": sum(1 for link in links if link["is_usable"]),
            "mapped_columns": self._catalog.list_mapped_columns(session_id),
            "comparators": ALL_COMPARATORS,
        }

    # ── step 3: the governed rules to apply ──────────────────────────────────

    def list_rules(self, session_id: str, support_model_id: str) -> dict:
        """
        Every governed rule a Support Domain model declares, grouped by the
        element type it belongs to.

        There used to be a picker in front of this — "Rules held under: Rule /
        Threshold / Severity" — and one type came back at a time. It asked the
        person to know the model's internal shape before they could see what was
        in it, and it hid the fact that a threshold and a rule are both things
        you might want to tick in the same visit. So the whole declaration comes
        back at once, under its own category headings, and the person ticks
        across as many as they like.

        Each rule carries the check its wording implies and what that check needs
        from them: nothing at all for most, an operator and a number for a
        threshold, a list for a controlled vocabulary. The inferred check is a
        suggestion they see and can change — a rule that quietly checks something
        nobody chose is worse than one that asks.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        groups: list[dict] = []
        by_type: dict[str, dict] = {}
        total = 0
        for row in self._catalog.list_rule_instances(support_model_id):
            type_id = row["element_type_id"]
            group = by_type.get(type_id)
            if group is None:
                group = {
                    "element_id": type_id,
                    "name": row["element_type_name"],
                    "display_name": (
                        row.get("element_type_display_name") or row["element_type_name"]
                    ),
                    "rules": [],
                }
                by_type[type_id] = group
                groups.append(group)
            group["rules"].append({
                "instance_id": row["instance_id"],
                "name": row["name"],
                "description": row.get("description") or "",
                "status": row.get("status") or "",
                "element_type_id": type_id,
                "element_type_name": row["element_type_name"],
                "suggested_check": infer_check(row["name"], row.get("description") or ""),
            })
            total += 1

        for group in groups:
            group["instance_count"] = len(group["rules"])

        return {
            "support_model_id": support_model_id,
            "groups": groups,
            "total": total,
            "check_kinds": CHECK_KINDS,
            "comparators": ALL_COMPARATORS,
        }

    # ── step 4: Finish ───────────────────────────────────────────────────────

    def build_rules(
        self,
        session_id: str,
        support_model_id: str,
        relationship_type_ids: list[str],
        selections: list[dict],
        actor: str = "user",
    ) -> dict:
        """
        Turn the ticked governed rules into session rules, one for each.

        Every selection names the governed rule it came from, the check it runs,
        and the mapped field it applies to. Whatever a check does not need is
        simply absent: a uniqueness rule carries no operator, because there was
        never a question to answer.

        Nothing is written until every selection has been validated. A half-saved
        batch — four rules in, the fifth missing its number — would leave a
        session in a state the person did not ask for and cannot see, so the
        whole batch is checked first and then applied.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")
        if not relationship_type_ids:
            raise ValueError(
                "Choose at least one cross-model relationship — it is what binds these "
                "rules to governance."
            )
        if not selections:
            raise ValueError("Tick at least one rule to add.")

        catalog = self.list_links(session_id, support_model_id)
        chosen_links = [
            link for link in catalog["links"]
            if link["relationship_type_id"] in set(relationship_type_ids)
        ]
        if len(chosen_links) != len(set(relationship_type_ids)):
            raise ValueError(
                "One of the selected relationships does not belong to this Support Domain model."
            )
        by_column = {c["column_id"]: c for c in catalog["mapped_columns"]}
        model_name = next(
            (m["name"] for m in self._catalog.list_support_models()
             if m["model_id"] == support_model_id),
            support_model_id,
        )
        governance_path = "; ".join(
            f"{link['governed_type_name']} —{link['relationship_name']}→ {link['bound_type_name']}"
            if link["direction"] == "outgoing"
            else f"{link['bound_type_name']} —{link['relationship_name']}→ {link['governed_type_name']}"
            for link in chosen_links
        )

        # ── validate the whole batch before writing any of it ──
        prepared = []
        for selection in selections:
            governed_name = str(selection.get("rule_name") or "").strip()
            if not governed_name:
                raise ValueError("Every selected rule needs its governed name.")

            check_type = str(selection.get("check_type") or "").strip()
            if check_type not in CHECK_KIND_BY_TYPE:
                raise ValueError(
                    f"'{governed_name}' has no check to run. Choose what it should check."
                )

            column_id = str(selection.get("column_id") or "").strip()
            column = by_column.get(column_id)
            if column is None:
                raise ValueError(
                    f"Choose a mapped field for '{governed_name}' — a rule cannot run "
                    "on a column this session has not mapped."
                )

            try:
                parameters = build_parameters(
                    check_type,
                    comparator=str(selection.get("comparator") or ""),
                    value=selection.get("value"),
                    values=selection.get("values"),
                )
            except ValueError as exc:
                # Name the rule the message is about: a batch of twelve with one
                # bare "Enter the number" is a puzzle, not an error.
                raise ValueError(f"{governed_name}: {exc}") from exc

            prepared.append({
                "governed_name": governed_name,
                "instance_id": str(selection.get("rule_instance_id") or ""),
                "check_type": check_type,
                "column": column,
                "parameters": parameters,
                "severity": str(selection.get("severity") or "high"),
            })

        # ── apply ──
        report = {}
        for entry in prepared:
            column = entry["column"]
            statement = describe(column["column_name"], entry["check_type"], entry["parameters"])
            target_label = column.get("target_name") or column["column_name"]
            description = (
                f"{statement}. Governed rule: {entry['governed_name']}"
                + (f" ({entry['instance_id']})" if entry["instance_id"] else "")
                + f". Governed target: {target_label}. "
                f"Built from {model_name} governance via {governance_path}."
            )
            report = self._governance.create_custom_rule(
                session_id,
                # The governed rule's own name, so the results read in the words
                # the model uses; the field and condition are in the description
                # and in the evidence line.
                name=f"{entry['governed_name']} — {statement}",
                check_type=entry["check_type"],
                column_id=column["column_id"],
                description=description,
                severity=entry["severity"],
                parameters=entry["parameters"],
                actor=actor,
            )

        self._audit.record(
            actor=actor,
            action="rules.built_from_governance",
            outcome="success",
            session_id=session_id,
            detail={
                "support_model_id": support_model_id,
                "relationship_type_ids": relationship_type_ids,
                "rules_added": len(prepared),
                "governed_rules": [e["governed_name"] for e in prepared],
            },
        )
        return report
