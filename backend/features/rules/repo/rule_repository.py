"""
Storage for authored rules: `rule_definition` and its version log.

Every write to a rule also writes what the rule was, so a result that cites
version 3 can be shown version 3 rather than whatever the rule says today.
"""
from __future__ import annotations

import json
from uuid import uuid4

from shared.db import get_connection, utc_now_iso

_COLUMNS = (
    "rule_definition_id, code, name, description, category, dimension, data_type, "
    "scope, execution_scope, definition_kind, check_type, parameters_json, script, "
    "severity, status, rationale, reference, message_template, examples_json, owner, "
    "version, created_by, updated_by, created_at, updated_at"
)


_VERSION_COLUMNS = (
    "rule_version_id, rule_definition_id, version, code, name, description, category, "
    "scope, execution_scope, definition_kind, check_type, parameters_json, script, "
    "severity, status, dimension, data_type, rationale, reference, message_template, "
    "examples_json, owner, recorded_by, recorded_at"
)


class RuleRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── reads ────────────────────────────────────────────────────────────────

    def list_rules(self, search: str = "", status: str = "", category: str = "") -> list[dict]:
        where = ["1 = 1"]
        params: list = []
        if search:
            where.append("(LOWER(name) LIKE %s OR LOWER(description) LIKE %s)")
            needle = f"%{search.lower()}%"
            params += [needle, needle]
        if status:
            where.append("status = %s")
            params.append(status)
        if category:
            where.append("category = %s")
            params.append(category)

        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM rule_definition WHERE {' AND '.join(where)} "
                "ORDER BY LOWER(name)",
                tuple(params),
            ).fetchall()
        return [self._hydrate(row) for row in rows]

    def get_rule(self, rule_definition_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM rule_definition WHERE rule_definition_id = %s",
                (rule_definition_id,),
            ).fetchone()
        return self._hydrate(row) if row else None

    def list_categories(self) -> list[str]:
        """Every category the library already uses, so the form can suggest them."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                # Postgres will not order a DISTINCT by an expression that is
                # not selected, so the sort key is grouped rather than ordered on.
                "SELECT category FROM rule_definition WHERE TRIM(category) <> '' "
                "GROUP BY category ORDER BY MIN(LOWER(category))"
            ).fetchall()
        return [dict(row)["category"] for row in rows]

    def next_code(self, prefix: str) -> str:
        """
        The next free code in a family, e.g. DQ-0007.

        Codes are handed out in order and never reused: a result cites the code
        of the rule that produced it, so reusing one would quietly re-label old
        evidence.
        """
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT code FROM rule_definition WHERE code LIKE %s ORDER BY code DESC LIMIT 1",
                (f"{prefix}-%",),
            ).fetchone()
        if row is None:
            return f"{prefix}-0001"
        try:
            nxt = int(str(dict(row)["code"]).rsplit("-", 1)[1]) + 1
        except (IndexError, ValueError):
            nxt = 1
        return f"{prefix}-{nxt:04d}"

    def code_taken(self, code: str, *, excluding_id: str = "") -> bool:
        """Whether a code is already issued. Codes are never reused."""
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT 1 FROM rule_definition "
                "WHERE UPPER(code) = UPPER(%s) AND rule_definition_id <> %s LIMIT 1",
                (code.strip(), excluding_id),
            ).fetchone()
        return row is not None

    def find_by_code(self, code: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM rule_definition WHERE UPPER(code) = UPPER(%s) LIMIT 1",
                (code.strip(),),
            ).fetchone()
        return self._hydrate(row) if row else None

    def find_by_name(self, name: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM rule_definition WHERE LOWER(name) = LOWER(%s) LIMIT 1",
                (name.strip(),),
            ).fetchone()
        return self._hydrate(row) if row else None

    # ── code families ────────────────────────────────────────────────────────

    def list_code_prefixes(self) -> dict[str, str]:
        """Configured prefixes, keyed by lower-cased category."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT category_key, prefix FROM rule_code_prefix"
            ).fetchall()
        return {dict(row)["category_key"]: dict(row)["prefix"] for row in rows}

    def set_code_prefix(self, category: str, prefix: str, actor: str = "user") -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO rule_code_prefix (category_key, category, prefix, updated_by, updated_at) "
                "VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT (category_key) DO UPDATE SET "
                "category = EXCLUDED.category, prefix = EXCLUDED.prefix, "
                "updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at",
                (category.strip().lower(), category.strip(), prefix, actor, utc_now_iso()),
            )

    def clear_code_prefix(self, category: str) -> None:
        """Back to the derived prefix. Codes already issued are untouched."""
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM rule_code_prefix WHERE category_key = %s",
                (category.strip().lower(),),
            )

    def count_codes_in_family(self, prefix: str) -> int:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM rule_definition WHERE code LIKE %s",
                (f"{prefix}-%",),
            ).fetchone()
        return int(dict(row)["n"]) if row else 0

    def name_taken(self, name: str, *, excluding_id: str = "") -> bool:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT 1 FROM rule_definition "
                "WHERE LOWER(name) = LOWER(%s) AND rule_definition_id <> %s LIMIT 1",
                (name.strip(), excluding_id),
            ).fetchone()
        return row is not None

    # ── version history ──────────────────────────────────────────────────────

    def _record_version(self, conn, rule_definition_id: str, actor: str) -> None:
        """
        Copy the rule's row, exactly as it stands, into the version log.

        A SELECT rather than a parameter list: the log has to be what the rule
        *is*, and rebuilding that from the caller's dict is how the two drift.
        `ON CONFLICT DO NOTHING` makes it safe to call twice, which is what
        lets an edit record the version it is replacing even when that version
        was written before this table existed.
        """
        conn.execute(
            f"INSERT INTO rule_definition_version ({_VERSION_COLUMNS}) "
            "SELECT %s, rule_definition_id, version, code, name, description, category, "
            "scope, execution_scope, definition_kind, check_type, parameters_json, script, "
            "severity, status, dimension, data_type, rationale, reference, "
            "message_template, examples_json, owner, %s, %s "
            "FROM rule_definition WHERE rule_definition_id = %s "
            "ON CONFLICT (rule_definition_id, version) DO NOTHING",
            (f"rv_{uuid4().hex[:12]}", actor, utc_now_iso(), rule_definition_id),
        )

    def list_versions(self, rule_definition_id: str) -> list[dict]:
        """Every recorded version of one rule, newest first."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT {_VERSION_COLUMNS} FROM rule_definition_version "
                "WHERE rule_definition_id = %s ORDER BY version DESC",
                (rule_definition_id,),
            ).fetchall()
        return [self._hydrate_version(row) for row in rows]

    def get_version(self, rule_definition_id: str, version: int) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {_VERSION_COLUMNS} FROM rule_definition_version "
                "WHERE rule_definition_id = %s AND version = %s",
                (rule_definition_id, version),
            ).fetchone()
        return self._hydrate_version(row) if row else None

    @staticmethod
    def _hydrate_version(row) -> dict:
        data = dict(row)
        data["parameters"] = json.loads(data.pop("parameters_json") or "{}")
        examples = json.loads(data.pop("examples_json") or "{}")
        data["examples"] = examples
        # Same two keys a rule carries, so one component renders either.
        data["examples_pass"] = examples.get("pass", [])
        data["examples_fail"] = examples.get("fail", [])
        return data

    # ── writes ───────────────────────────────────────────────────────────────

    def insert_rule(self, data: dict, actor: str) -> dict:
        rule_definition_id = f"rule_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO rule_definition (rule_definition_id, code, name, description, "
                "category, dimension, data_type, scope, execution_scope, definition_kind, "
                "check_type, "
                "parameters_json, script, severity, status, rationale, reference, "
                "message_template, examples_json, owner, version, created_by, updated_by, "
                "created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                "%s, %s, %s, 1, %s, %s, %s, %s)",
                (
                    rule_definition_id,
                    data["code"],
                    data["name"].strip(),
                    data["description"].strip(),
                    data["category"],
                    data["dimension"],
                    data["data_type"],
                    data["scope"],
                    data["execution_scope"],
                    data["definition_kind"],
                    data["check_type"],
                    json.dumps(data["parameters"]),
                    data["script"],
                    data["severity"],
                    data["status"],
                    data["rationale"],
                    data["reference"],
                    data["message_template"],
                    json.dumps(data["examples"]),
                    data["owner"],
                    actor,
                    actor,
                    now,
                    now,
                ),
            )
            self._record_version(conn, rule_definition_id, actor)
        return self.get_rule(rule_definition_id)

    def update_rule(self, rule_definition_id: str, data: dict, actor: str = "user") -> dict:
        with get_connection(self._db_url) as conn:
            # The version about to be replaced, first. A rule written before
            # the log existed has no row for its current version, and without
            # this the edit would erase the only copy of it.
            self._record_version(conn, rule_definition_id, actor)
            conn.execute(
                "UPDATE rule_definition SET name = %s, description = %s, category = %s, "
                "dimension = %s, data_type = %s, scope = %s, execution_scope = %s, "
                "definition_kind = %s, "
                "check_type = %s, parameters_json = %s, script = %s, severity = %s, "
                "status = %s, rationale = %s, reference = %s, message_template = %s, "
                "examples_json = %s, owner = %s, version = version + 1, updated_by = %s, "
                "updated_at = %s WHERE rule_definition_id = %s",
                (
                    data["name"].strip(),
                    data["description"].strip(),
                    data["category"],
                    data["dimension"],
                    data["data_type"],
                    data["scope"],
                    data["execution_scope"],
                    data["definition_kind"],
                    data["check_type"],
                    json.dumps(data["parameters"]),
                    data["script"],
                    data["severity"],
                    data["status"],
                    data["rationale"],
                    data["reference"],
                    data["message_template"],
                    json.dumps(data["examples"]),
                    data["owner"],
                    actor,
                    utc_now_iso(),
                    rule_definition_id,
                ),
            )
            # …and the version it has become.
            self._record_version(conn, rule_definition_id, actor)
        return self.get_rule(rule_definition_id)

    def assign_code(self, rule_definition_id: str, code: str) -> None:
        """Give a rule its code. Only ever called when it has none."""
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE rule_definition SET code = %s WHERE rule_definition_id = %s AND code = ''",
                (code, rule_definition_id),
            )

    def usage(self, rule_definition_id: str, examples: int = 5) -> dict:
        """
        Where this rule is in use, through any of its configurations: attached
        to a node instance (SWS) or chosen in a Discover session. The rule's own
        configuration is part of the rule, not a use of it, so it is not counted.
        """
        with get_connection(self._db_url) as conn:
            nodes = conn.execute(
                "SELECT n.node_instance_id AS id, n.name, m.name AS model_name, COUNT(*) OVER () AS total "
                "FROM node_instance_rule nr "
                "JOIN rule_configuration c ON c.rule_configuration_id = nr.rule_configuration_id "
                "JOIN hierarchy_model_node_instance n ON n.node_instance_id = nr.node_instance_id "
                "LEFT JOIN hierarchy_model m ON m.model_id = n.model_id "
                "WHERE c.rule_definition_id = %s "
                "ORDER BY lower(n.name), n.node_instance_id LIMIT %s",
                (rule_definition_id, examples),
            ).fetchall()
            sessions = conn.execute(
                "SELECT s.session_id AS id, s.name, COUNT(*) OVER () AS total "
                "FROM discovery_session s "
                "WHERE s.session_id IN ("
                "  SELECT dc.session_id FROM governed_rule g "
                "  JOIN discovery_rule_configuration dc ON dc.rule_id = g.rule_id "
                "  WHERE g.source_rule_definition_id = %s) "
                "ORDER BY lower(s.name), s.session_id LIMIT %s",
                (rule_definition_id, examples),
            ).fetchall()

        def summary(rows, fields):
            items = [{f: dict(row)[f] for f in fields} for row in rows]
            return {"total": int(dict(rows[0])["total"]) if rows else 0, "items": items}

        node_usage = summary(nodes, ("id", "name", "model_name"))
        session_usage = summary(sessions, ("id", "name"))
        return {
            "in_use": bool(node_usage["total"] or session_usage["total"]),
            "node_instances": node_usage,
            "discover_sessions": session_usage,
        }

    def delete_rule(self, rule_definition_id: str) -> None:
        """
        The rule and its configurations, together, in one transaction. A
        configuration left behind points at nothing and still turned up in
        search. Node-instance attachments go with the configurations (ON DELETE
        CASCADE). The rule's own version history (`rule_definition_version`) is
        kept, so what the rule was can still be traced.
        """
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM rule_configuration_version WHERE rule_configuration_id IN "
                "(SELECT rule_configuration_id FROM rule_configuration WHERE rule_definition_id = %s)",
                (rule_definition_id,),
            )
            conn.execute(
                "DELETE FROM rule_configuration WHERE rule_definition_id = %s",
                (rule_definition_id,),
            )
            conn.execute(
                "DELETE FROM rule_definition WHERE rule_definition_id = %s",
                (rule_definition_id,),
            )

    @staticmethod
    def _hydrate(row) -> dict:
        data = dict(row)
        data["parameters"] = json.loads(data.pop("parameters_json") or "{}")
        examples = json.loads(data.pop("examples_json") or "{}")
        data["examples_pass"] = examples.get("pass", [])
        data["examples_fail"] = examples.get("fail", [])
        return data
