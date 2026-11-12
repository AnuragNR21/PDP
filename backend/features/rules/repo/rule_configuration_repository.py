"""
Storage for rule configurations: `rule_configuration` and its version log.

A configuration is a named, parameterised use of a definition. It is written
once in the Rule Workspace and referenced from everywhere it applies, so the
same governance never exists twice under two slightly different names.

Every write records what the configuration was, for the same reason the
definitions do: a run cites a configuration at a version, and that citation has
to resolve to what it actually said rather than what it says now.
"""
from __future__ import annotations

import json
from uuid import uuid4

from shared.db import get_connection, utc_now_iso

_COLUMNS = (
    "rule_configuration_id, rule_definition_id, code, name, description, "
    "parameters_json, severity, status, reference_element_type_id, "
    "reference_value_ids_json, owner, "
    "version, created_by, updated_by, created_at, updated_at"
)

_VERSION_COLUMNS = (
    "configuration_version_id, rule_configuration_id, version, rule_definition_id, "
    "code, name, description, parameters_json, severity, status, "
    "reference_element_type_id, reference_value_ids_json, owner, "
    "recorded_by, recorded_at"
)


class RuleConfigurationRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── reads ────────────────────────────────────────────────────────────────

    def list_configurations(
        self, *, rule_definition_id: str = "", search: str = "", status: str = ""
    ) -> list[dict]:
        where = ["1 = 1"]
        params: list = []
        if rule_definition_id:
            where.append("c.rule_definition_id = %s")
            params.append(rule_definition_id)
        if search:
            where.append("(LOWER(c.name) LIKE %s OR LOWER(c.description) LIKE %s)")
            needle = f"%{search.lower()}%"
            params += [needle, needle]
        if status:
            where.append("c.status = %s")
            params.append(status)

        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                # The definition's own fields come along: a configuration is
                # unreadable without the check it configures, and fetching them
                # separately is how the two end up disagreeing on screen.
                f"SELECT {_prefixed(_COLUMNS, 'c')}, "
                "       d.name AS definition_name, d.check_type, d.definition_kind, "
                "       d.scope, d.execution_scope, d.dimension, d.data_type, "
                "       d.severity AS definition_severity, d.version AS definition_version, "
                "       e.name AS reference_element_type_name, "
                "       m.name AS reference_model_name "
                "FROM rule_configuration c "
                "JOIN rule_definition d ON d.rule_definition_id = c.rule_definition_id "
                "LEFT JOIN support_domain_element_type e "
                "       ON e.element_id = c.reference_element_type_id "
                "LEFT JOIN support_domain_model m "
                "       ON m.support_domain_model_id = e.support_domain_model_id "
                f"WHERE {' AND '.join(where)} "
                "ORDER BY LOWER(d.name), LOWER(c.name)",
                tuple(params),
            ).fetchall()
        return [self._hydrate(row) for row in rows]

    def get_configuration(self, rule_configuration_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {_prefixed(_COLUMNS, 'c')}, "
                "       d.name AS definition_name, d.check_type, d.definition_kind, "
                "       d.scope, d.execution_scope, d.dimension, d.data_type, "
                "       d.severity AS definition_severity, d.version AS definition_version, "
                "       e.name AS reference_element_type_name, "
                "       m.name AS reference_model_name "
                "FROM rule_configuration c "
                "JOIN rule_definition d ON d.rule_definition_id = c.rule_definition_id "
                "LEFT JOIN support_domain_element_type e "
                "       ON e.element_id = c.reference_element_type_id "
                "LEFT JOIN support_domain_model m "
                "       ON m.support_domain_model_id = e.support_domain_model_id "
                "WHERE c.rule_configuration_id = %s",
                (rule_configuration_id,),
            ).fetchone()
        return self._hydrate(row) if row else None

    def name_taken(self, rule_definition_id: str, name: str, *, excluding_id: str = "") -> bool:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT 1 FROM rule_configuration "
                "WHERE rule_definition_id = %s AND LOWER(name) = LOWER(%s) "
                "AND rule_configuration_id <> %s LIMIT 1",
                (rule_definition_id, name.strip(), excluding_id),
            ).fetchone()
        return row is not None

    def next_code(self, prefix: str) -> str:
        """The next free configuration code in a family, e.g. DQ-0007-C02."""
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT code FROM rule_configuration WHERE code LIKE %s "
                "ORDER BY code DESC LIMIT 1",
                (f"{prefix}-C%",),
            ).fetchone()
        if row is None:
            return f"{prefix}-C01"
        try:
            nxt = int(str(dict(row)["code"]).rsplit("-C", 1)[1]) + 1
        except (IndexError, ValueError):
            nxt = 1
        return f"{prefix}-C{nxt:02d}"

    # ── version history ──────────────────────────────────────────────────────

    def _record_version(self, conn, rule_configuration_id: str, actor: str) -> None:
        conn.execute(
            f"INSERT INTO rule_configuration_version ({_VERSION_COLUMNS}) "
            "SELECT %s, rule_configuration_id, version, rule_definition_id, code, name, "
            "description, parameters_json, severity, status, reference_element_type_id, "
            "reference_value_ids_json, owner, %s, %s "
            "FROM rule_configuration WHERE rule_configuration_id = %s "
            "ON CONFLICT (rule_configuration_id, version) DO NOTHING",
            (f"cv_{uuid4().hex[:12]}", actor, utc_now_iso(), rule_configuration_id),
        )

    def list_versions(self, rule_configuration_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT {_VERSION_COLUMNS} FROM rule_configuration_version "
                "WHERE rule_configuration_id = %s ORDER BY version DESC",
                (rule_configuration_id,),
            ).fetchall()
        return [self._hydrate(row) for row in rows]

    def get_version(self, rule_configuration_id: str, version: int) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {_VERSION_COLUMNS} FROM rule_configuration_version "
                "WHERE rule_configuration_id = %s AND version = %s",
                (rule_configuration_id, version),
            ).fetchone()
        return self._hydrate(row) if row else None

    # ── writes ───────────────────────────────────────────────────────────────

    def insert_configuration(self, data: dict, actor: str = "user") -> dict:
        rule_configuration_id = f"rcfg_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO rule_configuration (rule_configuration_id, rule_definition_id, "
                "code, name, description, parameters_json, severity, status, "
                "reference_element_type_id, reference_value_ids_json, owner, version, "
                "created_by, updated_by, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s)",
                (
                    rule_configuration_id,
                    data["rule_definition_id"],
                    data.get("code", ""),
                    data["name"].strip(),
                    data.get("description", "").strip(),
                    json.dumps(data.get("parameters", {})),
                    data.get("severity", ""),
                    data.get("status", "draft"),
                    data.get("reference_element_type_id", ""),
                    json.dumps(list(data.get("reference_value_ids") or [])),
                    data.get("owner", ""),
                    actor,
                    actor,
                    now,
                    now,
                ),
            )
            self._record_version(conn, rule_configuration_id, actor)
        return self.get_configuration(rule_configuration_id)

    def update_configuration(self, rule_configuration_id: str, data: dict, actor: str = "user") -> dict:
        with get_connection(self._db_url) as conn:
            # The version about to be replaced, first — the same ordering the
            # definitions use, and for the same reason.
            self._record_version(conn, rule_configuration_id, actor)
            conn.execute(
                "UPDATE rule_configuration SET name = %s, description = %s, "
                "parameters_json = %s, severity = %s, status = %s, "
                "reference_element_type_id = %s, reference_value_ids_json = %s, "
                "owner = %s, version = version + 1, "
                "updated_by = %s, updated_at = %s WHERE rule_configuration_id = %s",
                (
                    data["name"].strip(),
                    data.get("description", "").strip(),
                    json.dumps(data.get("parameters", {})),
                    data.get("severity", ""),
                    data.get("status", "draft"),
                    data.get("reference_element_type_id", ""),
                    json.dumps(list(data.get("reference_value_ids") or [])),
                    data.get("owner", ""),
                    actor,
                    utc_now_iso(),
                    rule_configuration_id,
                ),
            )
            self._record_version(conn, rule_configuration_id, actor)
        return self.get_configuration(rule_configuration_id)

    def delete_configuration(self, rule_configuration_id: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM rule_configuration WHERE rule_configuration_id = %s",
                (rule_configuration_id,),
            )

    def link_counts(self, rule_configuration_ids: list[str]) -> dict[str, int]:
        """`link_count` for many configurations in one query (lists, not one query per row)."""
        ids = [i for i in dict.fromkeys(rule_configuration_ids) if i]
        if not ids:
            return {}
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT rule_configuration_id, COUNT(*) AS n FROM node_instance_rule "
                "WHERE rule_configuration_id = ANY(%s) GROUP BY rule_configuration_id",
                (ids,),
            ).fetchall()
        return {dict(r)["rule_configuration_id"]: int(dict(r)["n"]) for r in rows}

    def link_count(self, rule_configuration_id: str) -> int:
        """
        How many Asset Properties are subject to this configuration.

        The number a person needs before deleting one: a configuration shared
        by four properties is four pieces of governance, not one.
        """
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM node_instance_rule "
                "WHERE rule_configuration_id = %s",
                (rule_configuration_id,),
            ).fetchone()
        return int(dict(row)["n"]) if row else 0

    # ── internals ────────────────────────────────────────────────────────────

    @staticmethod
    def _hydrate(row) -> dict:
        data = dict(row)
        data["parameters"] = json.loads(data.pop("parameters_json") or "{}")
        # A configuration written before value subsets existed has none, which
        # reads as "the whole vocabulary" — the only thing it could have meant.
        data["reference_value_ids"] = json.loads(
            data.pop("reference_value_ids_json", None) or "[]"
        )
        return data


def _prefixed(columns: str, alias: str) -> str:
    return ", ".join(f"{alias}.{c.strip()}" for c in columns.split(","))
