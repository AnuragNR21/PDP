"""
DiscoverGovernanceService — the governed middle of the Discover flow:

    … → Map → Classify Values → Determine Applicable Governed Rules →
        Configure permitted parameters → Run Quality → …

Two responsibilities, both governed:

  * **Classify values.** Where a mapped field carries values that stand for
    governed types, Discover profiles those values and proposes the matching
    Structure instances. It proposes; the user confirms.

  * **Determine and configure rules.** Discover works out which governed rules
    apply to what has been mapped and classified, and lets the session set only
    the parameters each rule permits. No rule is authored here.
"""
from features.discover.domain.governed_rules import (
    BUILDER_CHECK_BY_TYPE,
    RULE_KIND_BQ,
    RULE_KIND_DQ,
    RULE_KIND_PROFILE,
)
from features.discover.domain.models import UpsertColumnMappingCommand
from features.discover.domain.value_matching import (
    MIN_SUGGESTION_CONFIDENCE,
    score_candidate,
    suggest_match,
)
from features.discover.repo.discover_repository import DiscoverRepository
from features.discover.repo.discover_audit_repository import DiscoverAuditRepository
from features.discover.repo.discover_dataset_repository import DiscoverDatasetRepository
from features.discover.repo.discover_governance_repository import (
    DiscoverGovernanceRepository,
)
from features.discover.repo.discover_import_job_repository import (
    DiscoverImportJobRepository,
)
from features.discover.repo.discover_import_repository import DiscoverImportRepository
from features.discover.repo.discover_session_repository import DiscoverSessionRepository
from features.discover.service.discover_import_service import (
    StructureApplicationContextReadService,
)
from shared.contracts.refresh import RefreshRequest

#: A field with more distinct values than this is treated as data, not as a set
#: of codes standing for governed types, so it is not offered for classification.
MAX_DISTINCT_FOR_CLASSIFICATION = 50
#: A field whose values are nearly all different is an identifier or free text,
#: not a set of codes — classifying it would ask the user to name every row.
MAX_DISTINCT_SHARE_FOR_CLASSIFICATION = 0.5
#: Suggestions at or above this are safe to accept in bulk.
HIGH_CONFIDENCE = 0.9


class DiscoverGovernanceService:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url
        self._governance = DiscoverGovernanceRepository(db_url)
        self._datasets = DiscoverDatasetRepository(db_url)
        self._imports = DiscoverImportRepository(db_url)
        self._jobs = DiscoverImportJobRepository(db_url)
        self._sessions = DiscoverSessionRepository(db_url)
        self._audit = DiscoverAuditRepository(db_url)
        self._structure = StructureApplicationContextReadService(db_url)
        # Mapping lives in the legacy repository, which owns the col_… id space
        # that column_mapping.column_id references.
        self._columns = DiscoverRepository(db_url)

    # ── classify values ──────────────────────────────────────────────────────

    def suggest_classifications(self, session_id: str, actor: str = "user") -> dict:
        """
        Profile the values of every mapped field and propose the governed
        Structure instance each value stands for.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        context = self._imports.get_source_context(session_id)
        application_ref_id = context.application_ref_id if context else None
        if not application_ref_id:
            raise ValueError(
                "No model is selected for this session. Choose a model on the Mapping step first."
            )

        nodes = self._structure.list_application_fields(application_ref_id)
        if not nodes:
            raise ValueError(
                "The selected model has no governed instances to classify values against."
            )

        mapped = self._datasets.list_mapped_columns(session_id)
        if not mapped:
            raise ValueError(
                "No columns are mapped yet. Map columns on the Mapping step before classifying values."
            )

        descendants = _descendants_by_node(nodes)

        considered = 0
        for column in mapped:
            # The instances a value can mean are the ones declared *beneath the
            # field it was mapped to* — Steel and Wood under Material. Offering
            # the whole model instead would let the value "Steel" be classified
            # as the field "Pole ID", which means nothing.
            candidates = descendants.get(column.get("target_node_id") or "", [])
            if not candidates:
                continue

            internal_name = column.get("internal_name") or column["column_name"]
            stats = self._datasets.profile_column(session_id, internal_name)
            distinct, filled = stats["distinct_count"], stats["non_blank_count"]
            if distinct == 0 or distinct > MAX_DISTINCT_FOR_CLASSIFICATION:
                # Free text or unique data — nothing here stands for a type.
                continue
            if filled and distinct / filled > MAX_DISTINCT_SHARE_FOR_CLASSIFICATION:
                # Nearly every row has its own value: an identifier or a
                # description, not a code standing for a governed type.
                continue

            considered += 1
            values = self._datasets.column_value_counts(
                session_id, internal_name, MAX_DISTINCT_FOR_CLASSIFICATION
            )
            entries = []
            for entry in values:
                if not entry["value"]:
                    continue
                suggestion = suggest_match(entry["value"], candidates)
                entries.append({
                    "column_name": column["column_name"],
                    "source_value": entry["value"],
                    "occurrences": entry["count"],
                    "target_node_id": suggestion.target_node_id if suggestion else None,
                    "target_name": suggestion.target_name if suggestion else None,
                    "confidence": suggestion.confidence if suggestion else 0.0,
                    "match_method": suggestion.method if suggestion else "none",
                })
            self._governance.replace_suggestions(session_id, column["column_id"], entries)

        self._audit.record(
            actor=actor,
            action="classify.values_suggested",
            outcome="success",
            session_id=session_id,
            detail={"columns_considered": considered},
        )
        return self.get_classifications(session_id)

    def set_classification(
        self,
        session_id: str,
        column_id: str,
        source_value: str,
        target_node_id: str | None,
        state: str,
        actor: str = "user",
    ) -> dict:
        """Confirm, correct or reject one proposed classification."""
        if state not in ("confirmed", "rejected", "suggested"):
            raise ValueError("A classification may only be confirmed, rejected or left suggested.")

        target_name = None
        if target_node_id:
            # Only the instances declared under this column's own mapped field
            # are acceptable — a Material value cannot be classified as a Risk
            # Area instance, however tempting the name.
            candidates = self._candidates_for_column(session_id, column_id)
            match = next((c for c in candidates if c["node_id"] == target_node_id), None)
            if match is None:
                raise ValueError(
                    "That governed instance is not declared under the field this column is "
                    "mapped to."
                )
            target_name = match["name"]
        elif state == "confirmed":
            raise ValueError("Choose a governed instance before confirming this value.")

        self._governance.set_classification(
            session_id, column_id, source_value, target_node_id, target_name, state
        )
        self._audit.record(
            actor=actor,
            action="classify.value_set",
            outcome="success",
            session_id=session_id,
            detail={"value": source_value, "state": state, "target": target_name},
        )
        return self.get_classifications(session_id)

    def confirm_high_confidence(
        self, session_id: str, column_id: str | None = None,
        min_confidence: float = HIGH_CONFIDENCE, actor: str = "user",
    ) -> dict:
        """Accept every strong suggestion at once, leaving only the ambiguous ones."""
        confirmed = self._governance.confirm_suggestions_above(
            session_id, column_id, min_confidence
        )
        self._audit.record(
            actor=actor,
            action="classify.bulk_confirmed",
            outcome="success",
            session_id=session_id,
            detail={"confirmed": confirmed, "min_confidence": min_confidence},
        )
        result = self.get_classifications(session_id)
        result["confirmed_now"] = confirmed
        return result

    def _candidates_for_column(self, session_id: str, column_id: str) -> list[dict]:
        """The governed instances declared beneath this column's mapped field."""
        context = self._imports.get_source_context(session_id)
        if not context or not context.application_ref_id:
            return []
        column = next(
            (m for m in self._datasets.list_mapped_columns(session_id)
             if m["column_id"] == column_id),
            None,
        )
        if column is None or not column.get("target_node_id"):
            return []
        nodes = self._structure.list_application_fields(context.application_ref_id)
        return _descendants_by_node(nodes).get(column["target_node_id"], [])

    def get_classifications(self, session_id: str) -> dict:
        items = self._governance.list_classifications(session_id)
        context = self._imports.get_source_context(session_id)
        nodes = (
            self._structure.list_application_fields(context.application_ref_id)
            if context and context.application_ref_id
            else []
        )
        descendants = _descendants_by_node(nodes)
        mapped = self._datasets.list_mapped_columns(session_id) if nodes else []

        # Each mapped field offers only its own instances, and a field whose
        # model node declares none is named so the user knows why it is absent
        # rather than assuming the step is broken.
        candidates_by_column: dict[str, list[dict]] = {}
        fields_without_instances: list[str] = []
        for column in mapped:
            options = descendants.get(column.get("target_node_id") or "", [])
            candidates_by_column[column["column_id"]] = options
            if not options:
                fields_without_instances.append(
                    f"{column['column_name']} → {column.get('target_name') or 'unmapped'}"
                )

        return {
            "session_id": session_id,
            "items": items,
            "candidates_by_column": candidates_by_column,
            "fields_without_instances": fields_without_instances,
            "columns_with_values": len({i["column_id"] for i in items}),
            "confirmed": sum(1 for i in items if i["state"] == "confirmed"),
            "suggested": sum(1 for i in items if i["state"] == "suggested"),
            "rejected": sum(1 for i in items if i["state"] == "rejected"),
            "unmatched": sum(1 for i in items if not i["target_node_id"] and i["state"] != "rejected"),
            "high_confidence_pending": sum(
                1 for i in items
                if i["state"] == "suggested" and i["target_node_id"] and i["confidence"] >= HIGH_CONFIDENCE
            ),
            "has_run": len(items) > 0,
        }

    # ── assisted mapping ─────────────────────────────────────────────────────

    def suggest_mappings(self, session_id: str, actor: str = "user") -> dict:
        """
        Pair source columns with model fields automatically, then leave every
        pairing open to correction.

        PDP proposes and the user confirms — here the proposal is applied so the
        user reviews a filled-in grid instead of an empty one, which is far less
        work than pairing thirty columns by hand. Mapping is one-to-one, so the
        strongest matches are taken first and a field already claimed by a
        better match is not offered again. Columns the user already mapped are
        left exactly as they are: assistance never overwrites a decision.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        context = self._imports.get_source_context(session_id)
        application_ref_id = context.application_ref_id if context else None
        if not application_ref_id:
            raise ValueError("Choose a model first, then PDP can propose the mapping.")

        # A field that declares its governed instances as children is still a
        # field — Material with Steel/Wood/Concrete beneath it is exactly what a
        # source column maps onto. Filtering to leaves hid those fields from
        # mapping entirely, which is the opposite of what the model intends.
        fields = self._structure.list_application_fields(application_ref_id)
        if not fields:
            raise ValueError("The selected model has no fields to map to.")

        columns = self._columns.list_columns(session_id)
        if not columns:
            raise ValueError("No source columns yet. Run profiling first.")

        existing = self._columns.list_mappings(session_id)
        mapped_columns = {m.column_id for m in existing}
        claimed_targets = {m.target_node_id for m in existing}

        # Score every free column against every free field, then take the
        # strongest pairs first so a good match is never blocked by a weak one
        # that happened to be considered earlier.
        candidates = []
        for column in columns:
            if column.column_id in mapped_columns:
                continue
            for field in fields:
                if field["node_id"] in claimed_targets:
                    continue
                confidence, method = score_candidate(column.column_name, field["name"])
                if confidence >= MIN_SUGGESTION_CONFIDENCE:
                    candidates.append((confidence, method, column, field))

        candidates.sort(key=lambda entry: entry[0], reverse=True)

        applied, taken_columns, taken_targets = [], set(), set()
        for confidence, method, column, field in candidates:
            if column.column_id in taken_columns or field["node_id"] in taken_targets:
                continue
            self._columns.upsert_mapping(
                session_id,
                UpsertColumnMappingCommand(
                    column_id=column.column_id,
                    target_node_id=field["node_id"],
                    mapping_state="confirmed",
                    confidence=round(confidence, 3),
                    rationale=f"Auto-mapped: {method} ({round(confidence * 100)}% confidence)",
                ),
            )
            taken_columns.add(column.column_id)
            taken_targets.add(field["node_id"])
            applied.append({
                "column_id": column.column_id,
                "column_name": column.column_name,
                "target_node_id": field["node_id"],
                "target_name": field["name"],
                "target_path": field["path"],
                "confidence": round(confidence, 3),
                "method": method,
            })

        unmatched = [
            c.column_name for c in columns
            if c.column_id not in mapped_columns and c.column_id not in taken_columns
        ]

        self._audit.record(
            actor=actor,
            action="mapping.auto_mapped",
            outcome="success",
            session_id=session_id,
            detail={"mapped": len(applied), "unmatched": len(unmatched)},
        )
        return {
            "session_id": session_id,
            "mapped": applied,
            "unmatched": unmatched,
            "already_mapped": len(mapped_columns),
            "refresh": RefreshRequest(
                scope="session", reason="Mapping proposed automatically.", targets=[session_id]
            ),
        }

    # ── determine applicable governed rules ──────────────────────────────────

    def determine_applicable_rules(self, session_id: str, actor: str = "user") -> dict:
        """
        Re-point this session's rules at what is mapped now. Adds nothing.

        This step used to seed a starter set — mandatory and unique where the
        model declared them, a date check where the data looked like dates. That
        is no longer how a rule comes into being: every rule is now assembled in
        the Rule Builder out of a governed cross-model relationship, a comparator
        and a value, so a session only ever holds rules somebody deliberately
        built. Seeding here as well would put rules in the list that nobody chose
        and nobody could explain, which is exactly what "no rule from anywhere
        else" rules out.

        What it still does is the housekeeping that keeps built rules honest
        across a re-upload: a rule is bound to a governed target, so it is
        re-pointed at whichever column carries that target now, and dropped when
        the target is no longer mapped at all.
        """
        if not self._sessions.session_exists(session_id):
            raise ValueError("Discovery session not found.")

        mapped = self._datasets.list_mapped_columns(session_id)
        if not mapped:
            raise ValueError(
                "No columns are mapped yet. Rules are set on mapped fields."
            )

        self._governance.refresh_configuration_columns(session_id)
        # A governed target that is no longer mapped should not keep rules.
        self._governance.delete_configurations_for_targets(
            session_id, [m.get("target_node_id") or "" for m in mapped]
        )

        self._audit.record(
            actor=actor,
            action="rules.rebound_to_mapping",
            outcome="success",
            session_id=session_id,
            detail={"mapped_columns": len(mapped)},
        )
        return self.get_rule_configurations(session_id)

    # ── attaching rules to a field ───────────────────────────────────────────

    def attach_rule(
        self,
        session_id: str,
        rule_id: str,
        column_id: str = "",
        parameters: dict | None = None,
        severity: str | None = None,
        actor: str = "user",
    ) -> dict:
        """Add a rule to a field the user picked, with the parameters they set."""
        rule = self._governance.get_governed_rule(rule_id)
        if rule is None:
            raise ValueError("Rule not found.")
        if rule.get("owner_session_id") not in (None, session_id):
            raise ValueError("That rule belongs to another session.")

        column_name, target_node_id, target_name = "All mapped fields", None, None
        if column_id:
            mapped = self._datasets.list_mapped_columns(session_id)
            column = next((m for m in mapped if m["column_id"] == column_id), None)
            if column is None:
                raise ValueError("That field is not mapped, so a rule cannot be attached to it.")
            column_name = column["column_name"]
            target_node_id = column.get("target_node_id")
            target_name = column.get("target_name")

        merged = dict(rule["default_parameters"] or {})
        merged.update(self._validated_parameters(rule, parameters or {}))

        self._governance.upsert_configuration(session_id, {
            "rule_id": rule_id,
            "column_id": column_id,
            "column_name": column_name,
            "target_node_id": target_node_id or "",
            "target_name": target_name,
            "is_enabled": True,
            "severity": severity or rule["severity"],
            "parameters": merged,
        })
        self._audit.record(
            actor=actor,
            action="rules.attached",
            outcome="success",
            session_id=session_id,
            detail={"rule": rule["code"], "field": column_name},
        )
        return self.get_rule_configurations(session_id)

    def remove_rule(
        self, session_id: str, rule_id: str, column_id: str = "", actor: str = "user"
    ) -> dict:
        """
        Take a rule off a field. The caller names the column it can see; the
        rule is detached from the governed target that column carries.
        """
        rule = self._governance.get_governed_rule(rule_id)
        target_node_id = ""
        if column_id:
            mapped = self._datasets.list_mapped_columns(session_id)
            column = next((m for m in mapped if m["column_id"] == column_id), None)
            target_node_id = (column or {}).get("target_node_id") or ""
        self._governance.delete_configuration(session_id, rule_id, target_node_id)
        self._audit.record(
            actor=actor,
            action="rules.removed",
            outcome="success",
            session_id=session_id,
            detail={"rule": rule["code"] if rule else rule_id, "column_id": column_id},
        )
        return self.get_rule_configurations(session_id)

    def create_custom_rule(
        self,
        session_id: str,
        name: str,
        check_type: str,
        column_id: str = "",
        description: str = "",
        severity: str = "medium",
        parameters: dict | None = None,
        actor: str = "user",
    ) -> dict:
        """
        Store a rule the Rule Builder assembled, and attach it to its field.

        The person names the rule and states the condition; they never write new
        check logic. The parameter contract is copied out of the check definition
        so the stored rule is self-contained — its evidence still says exactly
        what was measured, whatever changes around it later.
        """
        template = BUILDER_CHECK_BY_TYPE.get(check_type)
        if template is None:
            raise ValueError("That kind of check is not available.")
        if not name.strip():
            raise ValueError("Give the rule a name so the evidence says what it tests.")

        created = self._governance.create_custom_rule(session_id, {
            "rule_kind": template["rule_kind"],
            "name": name.strip(),
            "description": description.strip() or template["description"],
            "check_type": check_type,
            "applies_to": template["applies_to"],
            "severity": severity,
            "requires_parameters": template["requires_parameters"],
            "permitted_parameters": template["permitted_parameters"],
            "default_parameters": template["default_parameters"],
        })
        self._audit.record(
            actor=actor,
            action="rules.custom_created",
            outcome="success",
            session_id=session_id,
            detail={"name": name, "check_type": check_type},
        )
        return self.attach_rule(
            session_id, created["rule_id"], column_id, parameters, severity, actor
        )

    @staticmethod
    def _validated_parameters(rule: dict, parameters: dict) -> dict:
        """Refuse anything the rule does not permit, rather than storing it."""
        if not parameters:
            return {}
        permitted = {p["key"] for p in rule["permitted_parameters"]}
        unknown = set(parameters) - permitted
        if unknown:
            raise ValueError(
                f"{rule['name']} does not permit the parameter(s): {', '.join(sorted(unknown))}."
            )
        return parameters

    def configure_rule(
        self,
        session_id: str,
        rule_id: str,
        column_id: str = "",
        is_enabled: bool | None = None,
        severity: str | None = None,
        parameters: dict | None = None,
        actor: str = "user",
    ) -> dict:
        """
        Set what a session is permitted to set on a governed rule. Parameters
        outside the rule's permitted list are refused rather than silently
        stored — a session may not invent a rule's behaviour.
        """
        rule = self._governance.get_governed_rule(rule_id)
        if rule is None:
            raise ValueError("Governed rule not found.")

        current = next(
            (
                c for c in self._governance.list_configurations(session_id)
                if c["rule_id"] == rule_id and c["column_id"] == column_id
            ),
            None,
        )
        if current is None:
            raise ValueError(
                "That rule is not applicable to this session. Determine applicable rules first."
            )

        merged = dict(current["parameters"] or {})
        if parameters:
            permitted = {p["key"] for p in rule["permitted_parameters"]}
            unknown = set(parameters) - permitted
            if unknown:
                raise ValueError(
                    f"{rule['name']} does not permit the parameter(s): {', '.join(sorted(unknown))}."
                )
            merged.update(parameters)

        self._governance.upsert_configuration(session_id, {
            "rule_id": rule_id,
            "column_id": column_id,
            "column_name": current["column_name"],
            "target_node_id": current["target_node_id"],
            "target_name": current["target_name"],
            "is_enabled": current["is_enabled"] if is_enabled is None else is_enabled,
            "severity": severity if severity is not None else current["severity"],
            "parameters": merged,
        })
        self._audit.record(
            actor=actor,
            action="rules.configured",
            outcome="success",
            session_id=session_id,
            detail={"rule": rule["code"], "column_id": column_id, "enabled": is_enabled},
        )
        return self.get_rule_configurations(session_id)

    def get_rule_configurations(self, session_id: str) -> dict:
        """
        The session's rules, organised the way they are worked on: one entry per
        mapped field, carrying the rules built for it.

        There is no "rules you could add" list any more, because there is no
        shelf to take one off — a rule comes into being only when somebody
        assembles it in the Rule Builder. The flat list is kept for the evidence
        record, which cares about what ran rather than how it was chosen.
        """
        items = self._governance.list_configurations(session_id)
        needs_parameters = [
            item for item in items
            if item["is_enabled"] and item["requires_parameters"] and not _has_values(item["parameters"])
        ]
        mapped = self._datasets.list_mapped_columns(session_id)

        fields = []
        for column in mapped:
            fields.append({
                "column_id": column["column_id"],
                "column_name": column["column_name"],
                "target_node_id": column.get("target_node_id"),
                "target_name": column.get("target_name"),
                "datatype": column.get("inferred_datatype") or column.get("detected_type") or "String",
                "rules": [i for i in items if i["column_id"] == column["column_id"]],
            })

        dataset_rules = [i for i in items if not i["column_id"]]
        return {
            "session_id": session_id,
            "items": items,
            "fields": fields,
            "dataset_rules": dataset_rules,
            "total": len(items),
            "enabled": sum(1 for i in items if i["is_enabled"]),
            "by_kind": {
                kind: sum(1 for i in items if i["rule_kind"] == kind)
                for kind in (RULE_KIND_PROFILE, RULE_KIND_DQ, RULE_KIND_BQ)
            },
            "needs_parameters": len(needs_parameters),
            "has_run": len(items) > 0,
        }

    # ── housekeeping ─────────────────────────────────────────────────────────

    def list_files(self, session_id: str) -> dict:
        """The session's files, with the one being worked on marked."""
        return {"session_id": session_id, "items": self._imports.list_source_files(session_id)}

    def activate_file(self, session_id: str, source_file_id: str, actor: str = "user") -> dict:
        """
        Switch which file the session is working on. Everything downstream —
        columns, mappings, rules, results — is scoped to that file, so this
        changes what every later step shows without discarding anything.
        """
        files = self._imports.list_source_files(session_id)
        if not any(f["source_file_id"] == source_file_id for f in files):
            raise ValueError("That file does not belong to this session.")
        self._imports.set_active_file(session_id, source_file_id)
        self._audit.record(
            actor=actor,
            action="import.file_activated",
            outcome="success",
            session_id=session_id,
            source_file_id=source_file_id,
            detail={},
        )
        return self.list_files(session_id)

    def remove_upload(self, session_id: str, origin_filename: str, actor: str = "user") -> dict:
        """
        Remove an uploaded file and every table it produced.

        The Import step talks in files, because a file is what the person
        chose; one file can be seven tables, and removing it a table at a time
        would be seven decisions about something they picked once.
        """
        ids = self._imports.list_source_files_from(session_id, origin_filename)
        has_job = any(
            job["filename"] == origin_filename for job in self._jobs.list_for_session(session_id)
        )
        if not ids and not has_job:
            raise ValueError("No upload of that name belongs to this session.")
        for source_file_id in ids:
            self._datasets.delete_for_file(source_file_id)
            # Findings and runs go with the file. Nothing holds them to it by
            # foreign key, so removal that skipped this left evidence about
            # rows the session no longer has — it showed up in the by-rule
            # view as "Unknown table". Re-upload has always cleared them.
            self._datasets.clear_quality_checks(source_file_id)
            self._governance.clear_for_file(source_file_id)
            self._imports.delete_source_file(session_id, source_file_id)
        # The job goes with the file. Leaving it behind would keep a row on the
        # Import step for a file the session no longer has — and a failed one
        # would go on offering to be retried with nothing to retry.
        self._jobs.delete_for_file(session_id, origin_filename)
        self._audit.record(
            actor=actor,
            action="import.upload_removed",
            outcome="success",
            session_id=session_id,
            detail={"file": origin_filename, "tables": len(ids)},
        )
        return self.list_files(session_id)

    def remove_file(self, session_id: str, source_file_id: str, actor: str = "user") -> dict:
        """Remove one file and everything derived from it."""
        files = self._imports.list_source_files(session_id)
        if not any(f["source_file_id"] == source_file_id for f in files):
            raise ValueError("That file does not belong to this session.")
        self._datasets.delete_for_file(source_file_id)
        self._datasets.clear_quality_checks(source_file_id)
        self._governance.clear_for_file(source_file_id)
        self._imports.delete_source_file(session_id, source_file_id)
        self._audit.record(
            actor=actor,
            action="import.file_removed",
            outcome="success",
            session_id=session_id,
            source_file_id=source_file_id,
            detail={},
        )
        return self.list_files(session_id)

def _has_values(parameters: dict | None) -> bool:
    """True when at least one parameter carries a usable value."""
    if not parameters:
        return False
    for value in parameters.values():
        if value in (None, "", [], {}):
            continue
        return True
    return False


def _descendants_by_node(nodes: list[dict]) -> dict[str, list[dict]]:
    """
    For every node in the model, the instances declared beneath it.

    A field says what its values may mean by carrying them as children: Material
    declares Steel, Wood and Concrete. So the candidates for classifying a
    column's values are the descendants of the node it was mapped to — never the
    whole model, which would offer sibling fields as if a value could mean one.
    """
    children: dict[str, list[dict]] = {}
    for node in nodes:
        children.setdefault(node.get("parent_node_id") or "", []).append(node)

    result: dict[str, list[dict]] = {}
    for node in nodes:
        collected: list[dict] = []
        stack = list(children.get(node["node_id"], []))
        while stack:
            current = stack.pop(0)
            collected.append(current)
            stack.extend(children.get(current["node_id"], []))
        result[node["node_id"]] = collected
    return result
