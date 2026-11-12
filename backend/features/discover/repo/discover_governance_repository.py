"""
DiscoverGovernanceRepository — persistence for the governed layer of a session:
value-level classifications and the session's governed rule configurations.

Governed rules themselves live in `governed_rule` and are read-only here:
Discover consumes them, Admin controls which are available, and a session only
records which apply and what parameters it set.
"""
import json
from uuid import uuid4

from shared.db import get_connection, utc_now_iso


class DiscoverGovernanceRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── governed rules (read-only) ───────────────────────────────────────────

    def get_governed_rule(self, rule_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT rule_id, model_id, rule_kind, code, name, description, check_type, "
                "applies_to, target_node_id, default_parameters_json, permitted_parameters_json, "
                "severity, requires_parameters, available_to_discover, status, owner_session_id, "
                "source_rule_definition_id, source_rule_version "
                "FROM governed_rule WHERE rule_id = %s",
                (rule_id,),
            ).fetchone()
        return None if row is None else self._rule_row(row)

    def create_custom_rule(self, session_id: str, entry: dict) -> dict:
        """
        Store a rule a user built for this session. It runs exactly like a
        governed rule, but is marked session-owned so nobody mistakes it for
        something governance approved.
        """
        now = utc_now_iso()
        rule_id = f"rule_{uuid4().hex[:12]}"
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO governed_rule "
                "(rule_id, model_id, rule_kind, code, name, description, check_type, applies_to, "
                "target_node_id, default_parameters_json, permitted_parameters_json, severity, "
                "requires_parameters, available_to_discover, status, owner_session_id, "
                "source_rule_definition_id, source_rule_version, source_rule_configuration_id, "
                "source_rule_configuration_version, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                "%s, %s, %s, %s, %s)",
                (
                    rule_id,
                    None,
                    entry.get("rule_kind", "dq"),
                    entry.get("code") or f"CUSTOM-{uuid4().hex[:6].upper()}",
                    entry["name"],
                    entry.get("description", ""),
                    entry["check_type"],
                    entry.get("applies_to", "field"),
                    entry.get("target_node_id") or "",
                    json.dumps(entry.get("default_parameters", {}), ensure_ascii=False),
                    json.dumps(entry.get("permitted_parameters", []), ensure_ascii=False),
                    entry.get("severity", "medium"),
                    entry.get("requires_parameters", False),
                    True,
                    "active",
                    session_id,
                    entry.get("source_rule_definition_id", ""),
                    # Which version of that library rule was copied. A result
                    # citing a rule id alone cites something that can change
                    # under it; the version is what makes the citation hold.
                    str(entry.get("source_rule_version", "") or ""),
                    # Empty for a rule attached from the library rather than
                    # through governance; the two paths coexist for now.
                    entry.get("source_rule_configuration_id", ""),
                    str(entry.get("source_rule_configuration_version", "") or ""),
                    now,
                    now,
                ),
            )
        return self.get_governed_rule(rule_id) or {}

    def refresh_attachment(self, rule_id: str, entry: dict) -> None:
        """
        Bring an already-attached rule back into step with its governance.

        Re-ticking a rule whose approved values have moved must run the check
        its governance means *now*, not the one it meant when it was first
        attached. A finished run keeps its own evidence in its own rows; this
        touches only the instruction that has not run yet.
        """
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE governed_rule SET default_parameters_json = %s, "
                "permitted_parameters_json = %s, severity = %s, source_rule_version = %s, "
                "source_rule_configuration_version = %s, updated_at = %s "
                "WHERE rule_id = %s",
                (
                    json.dumps(entry.get("default_parameters", {}), ensure_ascii=False),
                    json.dumps(entry.get("permitted_parameters", []), ensure_ascii=False),
                    entry.get("severity", "medium"),
                    str(entry.get("source_rule_version", "") or ""),
                    str(entry.get("source_rule_configuration_version", "") or ""),
                    utc_now_iso(),
                    rule_id,
                ),
            )

    def code_taken(self, code: str) -> bool:
        """`governed_rule.code` is unique, so an attachment has to check first."""
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT 1 FROM governed_rule WHERE code = %s LIMIT 1", (code,)
            ).fetchone()
        return row is not None

    def delete_attachment(self, configuration_id: str) -> None:
        """
        Detach a library rule: the configuration goes, and so does the session's
        copy of the rule. Leaving the copy behind would keep a rule in the
        session that nothing points at and nobody can see.
        """
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT rule_id FROM discovery_rule_configuration WHERE configuration_id = %s",
                (configuration_id,),
            ).fetchone()
            conn.execute(
                "DELETE FROM discovery_rule_configuration WHERE configuration_id = %s",
                (configuration_id,),
            )
            if row is not None:
                conn.execute(
                    "DELETE FROM governed_rule WHERE rule_id = %s AND owner_session_id IS NOT NULL",
                    (dict(row)["rule_id"],),
                )

    def delete_configuration(self, session_id: str, rule_id: str, target_node_id: str) -> None:
        """Detach one rule from the governed target it was attached to."""
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_rule_configuration "
                "WHERE session_id = %s AND rule_id = %s AND target_node_id = %s",
                (session_id, rule_id, target_node_id or ""),
            )
            # A custom rule exists only to be attached, so detaching it removes
            # it rather than leaving an orphan in the user's rule list.
            conn.execute(
                "DELETE FROM governed_rule r WHERE r.rule_id = %s AND r.owner_session_id = %s "
                "AND NOT EXISTS (SELECT 1 FROM discovery_rule_configuration c "
                "                WHERE c.rule_id = r.rule_id)",
                (rule_id, session_id),
            )

    @staticmethod
    def _rule_row(row) -> dict:
        data = dict(row)
        data["default_parameters"] = json.loads(data.pop("default_parameters_json") or "{}")
        data["permitted_parameters"] = json.loads(data.pop("permitted_parameters_json") or "[]")
        return data

    # ── value classifications ────────────────────────────────────────────────

    def replace_suggestions(self, session_id: str, column_id: str, entries: list[dict]) -> None:
        """
        Store a fresh set of suggestions for one column, preserving whatever the
        user already decided — a confirmed or rejected value is never overwritten
        by a new proposal.
        """
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            decided = {
                r["source_value"]
                for r in conn.execute(
                    "SELECT source_value FROM discovery_value_classification "
                    "WHERE session_id = %s AND column_id = %s AND state <> 'suggested'",
                    (session_id, column_id),
                ).fetchall()
            }
            conn.execute(
                "DELETE FROM discovery_value_classification "
                "WHERE session_id = %s AND column_id = %s AND state = 'suggested'",
                (session_id, column_id),
            )
            for entry in entries:
                if entry["source_value"] in decided:
                    continue
                conn.execute(
                    "INSERT INTO discovery_value_classification "
                    "(classification_id, session_id, source_file_id, column_id, column_name, "
                    "source_value, target_node_id, target_name, state, confidence, "
                    "match_method, occurrences, created_at, updated_at) "
                    "VALUES (%s, %s, (SELECT active_source_file_id FROM discovery_session "
                    "                 WHERE session_id = %s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (session_id, column_id, source_value) DO NOTHING",
                    (
                        f"vc_{uuid4().hex[:12]}",
                        session_id,
                        session_id,
                        column_id,
                        entry["column_name"],
                        entry["source_value"],
                        entry.get("target_node_id") or "",
                        entry.get("target_name"),
                        "suggested",
                        entry.get("confidence", 0.0),
                        entry.get("match_method", "none"),
                        entry.get("occurrences", 0),
                        now,
                        now,
                    ),
                )

    def set_classification(
        self,
        session_id: str,
        column_id: str,
        source_value: str,
        target_node_id: str | None,
        target_name: str | None,
        state: str,
    ) -> None:
        """Record the user's decision for one value."""
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_value_classification "
                "SET target_node_id = %s, target_name = %s, state = %s, updated_at = %s "
                "WHERE session_id = %s AND column_id = %s AND source_value = %s",
                (target_node_id, target_name, state, now, session_id, column_id, source_value),
            )

    def confirm_suggestions_above(
        self, session_id: str, column_id: str | None, min_confidence: float
    ) -> int:
        """
        Accept every suggestion at or above a confidence, so a user only has to
        review the ambiguous ones. Returns how many were confirmed.
        """
        now = utc_now_iso()
        params: list = [now, session_id, min_confidence]
        column_clause = ""
        if column_id:
            column_clause = "AND column_id = %s"
            params.append(column_id)
        with get_connection(self._db_url) as conn:
            cursor = conn.execute(
                "UPDATE discovery_value_classification SET state = 'confirmed', updated_at = %s "
                "WHERE session_id = %s AND state = 'suggested' AND target_node_id IS NOT NULL "
                f"AND confidence >= %s {column_clause}",
                tuple(params),
            )
            return cursor.rowcount or 0

    def list_classifications(self, session_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT c.classification_id, c.session_id, c.column_id, c.column_name, "
                "c.source_value, c.target_node_id, c.target_name, c.state, c.confidence, "
                "c.match_method, c.occurrences "
                "FROM discovery_value_classification c "
                "JOIN discovery_session s ON s.session_id = c.session_id "
                "WHERE c.session_id = %s AND c.source_file_id = s.active_source_file_id "
                "ORDER BY c.column_name, c.occurrences DESC, c.source_value",
                (session_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def clear_for_file(self, source_file_id: str) -> None:
        """Everything the governed layer derived from one file."""
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_value_classification WHERE source_file_id = %s",
                (source_file_id,),
            )

    # ── session rule configurations ──────────────────────────────────────────

    def upsert_configuration(self, session_id: str, entry: dict) -> None:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO discovery_rule_configuration "
                "(configuration_id, session_id, rule_id, column_id, column_name, target_node_id, "
                "target_name, is_enabled, severity, parameters_json, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (session_id, rule_id, target_node_id) DO UPDATE SET "
                "  column_id = EXCLUDED.column_id, "
                "  column_name = EXCLUDED.column_name, "
                "  target_name = EXCLUDED.target_name, "
                "  is_enabled = EXCLUDED.is_enabled, "
                "  severity = EXCLUDED.severity, "
                "  parameters_json = EXCLUDED.parameters_json, "
                "  updated_at = EXCLUDED.updated_at",
                (
                    f"rc_{uuid4().hex[:12]}",
                    session_id,
                    entry["rule_id"],
                    entry.get("column_id", ""),
                    entry.get("column_name", ""),
                    entry.get("target_node_id") or "",
                    entry.get("target_name"),
                    entry.get("is_enabled", False),
                    entry.get("severity"),
                    json.dumps(entry.get("parameters", {}), ensure_ascii=False),
                    now,
                    now,
                ),
            )

    def list_configurations(self, session_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT c.configuration_id, c.session_id, c.rule_id, c.column_id, c.column_name, "
                "c.target_node_id, c.target_name, c.is_enabled, c.severity, c.parameters_json, "
                "r.code, r.name AS rule_name, r.rule_kind, r.check_type, r.applies_to, "
                "r.source_rule_definition_id, r.source_rule_version, "
                "r.source_rule_configuration_id, r.source_rule_configuration_version, "
                "r.severity AS default_severity, r.requires_parameters, "
                "r.permitted_parameters_json, r.default_parameters_json "
                "FROM discovery_rule_configuration c "
                "JOIN governed_rule r ON r.rule_id = c.rule_id "
                "WHERE c.session_id = %s ORDER BY r.rule_kind, r.code, c.column_name",
                (session_id,),
            ).fetchall()
        results = []
        for row in rows:
            data = dict(row)
            data["parameters"] = json.loads(data.pop("parameters_json") or "{}")
            data["permitted_parameters"] = json.loads(data.pop("permitted_parameters_json") or "[]")
            data["default_parameters"] = json.loads(data.pop("default_parameters_json") or "{}")
            results.append(data)
        return results

    def delete_configurations_for_targets(
        self, session_id: str, target_node_ids: list[str]
    ) -> None:
        """
        Drop configurations whose governed target is no longer mapped. A target
        that is still mapped keeps its rules even if the column carrying it was
        re-profiled into a new id.
        """
        if not target_node_ids:
            return
        placeholders = ", ".join(["%s"] * len(target_node_ids))
        with get_connection(self._db_url) as conn:
            conn.execute(
                f"DELETE FROM discovery_rule_configuration WHERE session_id = %s "
                f"AND target_node_id <> '' AND target_node_id NOT IN ({placeholders})",
                (session_id, *target_node_ids),
            )

    def refresh_configuration_columns(self, session_id: str) -> None:
        """
        Re-point each configuration at the column that currently carries its
        governed target. This is what lets a rule set survive a re-upload: the
        binding is to the target, and the column is looked up again from the
        mapping in force now.
        """
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE discovery_rule_configuration c "
                "SET column_id = m.column_id, column_name = sc.column_name "
                "FROM column_mapping m "
                "JOIN active_source_column sc ON sc.column_id = m.column_id "
                "WHERE m.session_id = c.session_id "
                "  AND m.target_node_id = c.target_node_id "
                "  AND c.target_node_id <> ''",
                (),
            )
