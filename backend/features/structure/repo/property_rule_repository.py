"""
Where a rule applies: the link between an Asset Property and a rule
configuration, and the approved values that property recognises.

Two tables, two different statements:

    node_instance_rule                   property -> subject to     -> configuration
    cross_model_relationship_instance    property -> is governed by -> approved value

The first says this property is assessed by this check. The second says which
values this property accepts. They are independent on purpose: one shared
configuration can be linked to four properties while each of them approves a
different part of the same vocabulary.

Approved values are the SAME rows the Structure diagram draws. They were once
kept in a table of their own, `node_instance_reference_value`, which no diagram
ever wrote to -- so five values governed on the diagram were invisible to the
rule, and the rule ran against whatever the picker had been told separately.
Two stores for one fact is one store too many. The relationship type carries
`governance_role = 'approves_values'`, and that role, not the name a user gave
the type, is what makes an edge count.

Nothing here is inherited. A property carries what has been asserted about it
and nothing more -- not from its parent, not from its node type, not from the
vocabulary its approved values happen to come from.
"""
from __future__ import annotations

import json
from uuid import uuid4

from shared.db import get_connection, utc_now_iso
from shared.model_config import HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL

APPLICABILITY = ("required", "recommended", "available")


class PropertyRuleRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── rule links: property -> subject to -> configuration ──────────────────

    _SELECT = (
        "SELECT r.property_rule_id, r.node_instance_id, r.rule_configuration_id, "
        "       r.applicability, r.notes, r.status, r.created_by, r.created_at, "
        "       r.updated_at, "
        "       c.name AS configuration_name, c.code AS configuration_code, "
        "       c.description AS configuration_description, "
        "       c.parameters_json, c.severity AS configuration_severity, "
        "       c.status AS configuration_status, c.version AS configuration_version, "
        "       c.reference_element_type_id, c.reference_value_ids_json, "
        "       et.name AS reference_element_type_name, "
        "       sdm.name AS reference_model_name, "
        "       rv.value_names AS configuration_values, "
        "       d.rule_definition_id, d.name AS definition_name, d.code AS definition_code, "
        "       d.check_type, d.definition_kind, d.scope, d.execution_scope, "
        "       d.dimension, d.data_type, d.severity AS definition_severity, "
        "       d.version AS definition_version, "
        "       n.name AS property_name, n.model_id, n.node_type_id, "
        "       n.parent_node_id, hm.name AS model_name "
        "FROM node_instance_rule r "
        "JOIN rule_configuration c ON c.rule_configuration_id = r.rule_configuration_id "
        "JOIN rule_definition d ON d.rule_definition_id = c.rule_definition_id "
        "JOIN hierarchy_model_node_instance n ON n.node_instance_id = r.node_instance_id "
        "JOIN hierarchy_model hm ON hm.model_id = n.model_id "
        "LEFT JOIN support_domain_element_type et "
        "       ON et.element_id = c.reference_element_type_id "
        "LEFT JOIN support_domain_model sdm "
        "       ON sdm.support_domain_model_id = et.support_domain_model_id "
        # The values this configuration actually approves, resolved here rather
        # than fetched per row. No selection means the whole vocabulary: that is
        # what binding a rule to one meant before subsets existed, so rules
        # written then keep running against exactly what they ran against.
        "LEFT JOIN LATERAL ("
        "   SELECT COALESCE("
        "     json_agg(i.name ORDER BY i.sort_order, LOWER(i.name)), '[]'"
        "   ) AS value_names "
        "   FROM support_domain_element_instance i "
        "   WHERE i.element_type_id = c.reference_element_type_id "
        "     AND i.status = 'active' "
        "     AND ("
        "       COALESCE(NULLIF(c.reference_value_ids_json, ''), '[]') = '[]' "
        "       OR i.instance_id IN ("
        "         SELECT jsonb_array_elements_text("
        "           COALESCE(NULLIF(c.reference_value_ids_json, ''), '[]')::jsonb)"
        "       )"
        "     )"
        ") rv ON TRUE "
    )

    _ORDER = (
        "ORDER BY CASE r.applicability WHEN 'required' THEN 0 "
        "WHEN 'recommended' THEN 1 ELSE 2 END, LOWER(c.name)"
    )

    def list_for_property(self, node_instance_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                self._SELECT + "WHERE r.node_instance_id = %s " + self._ORDER,
                (node_instance_id,),
            ).fetchall()
        return [self._hydrate(row) for row in rows]

    def list_for_properties(self, node_instance_ids: list[str]) -> list[dict]:
        """The configurations any of these properties is subject to, in one read."""
        if not node_instance_ids:
            return []
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                self._SELECT
                + "WHERE r.node_instance_id = ANY(%s) AND r.status = 'active' "
                + self._ORDER,
                (list(node_instance_ids),),
            ).fetchall()
        return [self._hydrate(row) for row in rows]

    def counts_by_property(self, model_id: str) -> dict[str, int]:
        """How many configurations each property of a model is subject to."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT n.node_instance_id, COUNT(r.property_rule_id) AS n "
                "FROM hierarchy_model_node_instance n "
                "LEFT JOIN node_instance_rule r "
                "       ON r.node_instance_id = n.node_instance_id AND r.status = 'active' "
                "WHERE n.model_id = %s "
                "GROUP BY n.node_instance_id",
                (model_id,),
            ).fetchall()
        return {dict(r)["node_instance_id"]: int(dict(r)["n"]) for r in rows}

    def link(
        self,
        node_instance_id: str,
        rule_configuration_id: str,
        *,
        applicability: str = "recommended",
        notes: str = "",
        actor: str = "user",
    ) -> dict:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO node_instance_rule "
                "(property_rule_id, node_instance_id, rule_configuration_id, applicability, "
                "notes, status, created_by, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, 'active', %s, %s, %s) "
                # Linking something already linked is a correction, not an error.
                "ON CONFLICT (node_instance_id, rule_configuration_id) DO UPDATE SET "
                "applicability = EXCLUDED.applicability, notes = EXCLUDED.notes, "
                "status = 'active', updated_at = EXCLUDED.updated_at",
                (
                    f"pr_{uuid4().hex[:12]}",
                    node_instance_id,
                    rule_configuration_id,
                    applicability,
                    notes,
                    actor,
                    now,
                    now,
                ),
            )
        return self.get_link(node_instance_id, rule_configuration_id) or {}

    def get_link(self, node_instance_id: str, rule_configuration_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                self._SELECT
                + "WHERE r.node_instance_id = %s AND r.rule_configuration_id = %s",
                (node_instance_id, rule_configuration_id),
            ).fetchone()
        return self._hydrate(row) if row else None

    def get_by_id(self, property_rule_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                self._SELECT + "WHERE r.property_rule_id = %s",
                (property_rule_id,),
            ).fetchone()
        return self._hydrate(row) if row else None

    def update_link(self, property_rule_id: str, *, applicability: str, notes: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "UPDATE node_instance_rule "
                "SET applicability = %s, notes = %s, updated_at = %s "
                "WHERE property_rule_id = %s",
                (applicability, notes, utc_now_iso(), property_rule_id),
            )

    def unlink(self, property_rule_id: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM node_instance_rule WHERE property_rule_id = %s",
                (property_rule_id,),
            )

    def link_exists(self, property_rule_id: str) -> bool:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT 1 FROM node_instance_rule WHERE property_rule_id = %s",
                (property_rule_id,),
            ).fetchone()
        return row is not None

    # ── approved values: property -> is governed by -> reference value ───────
    #
    # One store, shared with the diagram. `reference_link_id` is the
    # relationship's own id, so every caller above this layer is unchanged.

    GOVERNANCE_ROLE = "approves_values"

    #: Names a user is likely to have given the governing relationship before
    #: the role existed. Matched once, by the migration and by the lazy
    #: bootstrap below -- never at read time, where a renamed type would
    #: silently change which values a rule runs against.
    _GOVERNING_NAMES = ("is governed by", "governed by", "governs")

    _VALUE_SELECT = (
        "SELECT v.relationship_id AS reference_link_id, "
        "       v.source_instance_id AS node_instance_id, "
        "       v.target_instance_id AS element_instance_id, "
        "       v.status, 'user' AS created_by, v.created_at, v.updated_at, "
        "       i.name AS value_name, i.status AS value_status, "
        "       i.element_type_id, et.name AS element_type_name, "
        "       m.support_domain_model_id, m.name AS model_name "
        "FROM cross_model_relationship_instance v "
        "JOIN cross_model_relationship_type rt "
        "  ON rt.relationship_type_id = v.relationship_rule_id "
        " AND rt.governance_role = 'approves_values' "
        "JOIN support_domain_element_instance i ON i.instance_id = v.target_instance_id "
        "JOIN support_domain_element_type et ON et.element_id = i.element_type_id "
        "JOIN support_domain_model m "
        "  ON m.support_domain_model_id = et.support_domain_model_id "
    )

    def _governing_type_id(self, conn) -> str:
        """
        The relationship type that carries governance meaning.

        Looked up by role. If no type carries the role yet -- a fresh database,
        or one whose relationship types were all drawn for other purposes --
        the role is given to an existing type that is already named for the job
        before a new one is created, so a model authored on the diagram keeps
        the edges it already has.
        """
        row = conn.execute(
            "SELECT relationship_type_id FROM cross_model_relationship_type "
            "WHERE governance_role = %s AND status = 'active' "
            "ORDER BY created_at LIMIT 1",
            (self.GOVERNANCE_ROLE,),
        ).fetchone()
        if row:
            return row["relationship_type_id"]

        row = conn.execute(
            "SELECT relationship_type_id FROM cross_model_relationship_type "
            "WHERE LOWER(TRIM(name)) = ANY(%s) ORDER BY created_at LIMIT 1",
            (list(self._GOVERNING_NAMES),),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE cross_model_relationship_type SET governance_role = %s "
                "WHERE relationship_type_id = %s",
                (self.GOVERNANCE_ROLE, row["relationship_type_id"]),
            )
            return row["relationship_type_id"]

        now = utc_now_iso()
        type_id = f"crt_{uuid4().hex[:12]}"
        conn.execute(
            "INSERT INTO cross_model_relationship_type "
            "(relationship_type_id, name, description, source_model_type, "
            " target_model_type, governance_role, status, created_at, updated_at) "
            "VALUES (%s, 'is governed by', "
            "        'The approved values this Asset Property recognises.', "
            "        'HIERARCHY_MODEL', 'SUPPORT_DOMAIN_MODEL', %s, 'active', %s, %s)",
            (type_id, self.GOVERNANCE_ROLE, now, now),
        )
        return type_id

    def governing_type_id(self) -> str:
        """The governing relationship type, for callers outside a transaction."""
        with get_connection(self._db_url) as conn:
            return self._governing_type_id(conn)

    def list_values_for_property(self, node_instance_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                self._VALUE_SELECT
                + "WHERE v.source_instance_id = %s "
                "ORDER BY LOWER(et.name), i.sort_order, LOWER(i.name)",
                (node_instance_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_values_for_properties(self, node_instance_ids: list[str]) -> list[dict]:
        """
        Every approved value of these properties, in one read.

        Only active links to active value instances: a retired value is one the
        business has stopped accepting, and a check that still accepted it would
        report the opposite of the governance.
        """
        if not node_instance_ids:
            return []
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                self._VALUE_SELECT
                + "WHERE v.source_instance_id = ANY(%s) "
                "  AND v.status = 'active' AND i.status = 'active' "
                "ORDER BY LOWER(et.name), i.sort_order, LOWER(i.name)",
                (list(node_instance_ids),),
            ).fetchall()
        return [dict(row) for row in rows]

    def link_value(
        self, node_instance_id: str, element_instance_id: str, *, actor: str = "user"
    ) -> dict:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            type_id = self._governing_type_id(conn)
            # A pair already joined by some other relationship is re-pointed at
            # the governing type rather than refused: the person has just said,
            # in the panel, that this value governs this property, and the
            # table allows one edge per pair.
            conn.execute(
                "INSERT INTO cross_model_relationship_instance "
                "(relationship_id, relationship_rule_id, source_instance_id, "
                " source_instance_type, target_instance_id, target_instance_type, "
                " sort_order, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, 0, 'active', %s, %s) "
                "ON CONFLICT (source_instance_id, target_instance_id) DO UPDATE SET "
                "relationship_rule_id = EXCLUDED.relationship_rule_id, "
                "status = 'active', updated_at = EXCLUDED.updated_at",
                (
                    f"prv_{uuid4().hex[:12]}",
                    type_id,
                    node_instance_id,
                    HIERARCHY_MODEL,
                    element_instance_id,
                    SUPPORT_DOMAIN_MODEL,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                self._VALUE_SELECT
                + "WHERE v.source_instance_id = %s AND v.target_instance_id = %s",
                (node_instance_id, element_instance_id),
            ).fetchone()
        return dict(row) if row else {}

    def unlink_value(self, reference_link_id: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM cross_model_relationship_instance "
                "WHERE relationship_id = %s",
                (reference_link_id,),
            )

    def value_link_exists(self, reference_link_id: str) -> bool:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT 1 FROM cross_model_relationship_instance v "
                "JOIN cross_model_relationship_type rt "
                "  ON rt.relationship_type_id = v.relationship_rule_id "
                "WHERE v.relationship_id = %s AND rt.governance_role = %s",
                (reference_link_id, self.GOVERNANCE_ROLE),
            ).fetchone()
        return row is not None

    def list_candidate_values(self, element_type_id: str) -> list[dict]:
        """The values of one vocabulary, for the picker to offer."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT i.instance_id AS element_instance_id, i.name AS value_name, "
                "       i.element_type_id, et.name AS element_type_name, "
                "       m.name AS model_name "
                "FROM support_domain_element_instance i "
                "JOIN support_domain_element_type et ON et.element_id = i.element_type_id "
                "JOIN support_domain_model m "
                "  ON m.support_domain_model_id = et.support_domain_model_id "
                "WHERE i.element_type_id = %s AND i.status = 'active' "
                "ORDER BY i.sort_order, LOWER(i.name)",
                (element_type_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _hydrate(row) -> dict:
        data = dict(row)
        data["parameters"] = json.loads(data.pop("parameters_json") or "{}")
        raw_ids = data.pop("reference_value_ids_json", None)
        data["reference_value_ids"] = (
            raw_ids if isinstance(raw_ids, list) else json.loads(raw_ids or "[]")
        )
        resolved = data.get("configuration_values")
        if isinstance(resolved, str):
            resolved = json.loads(resolved or "[]")
        data["configuration_values"] = [v for v in (resolved or []) if v is not None]
        return data


class PropertyLookupRepository:
    """
    Just enough of the hierarchy to name a property and place it.

    Jeff's note is explicit that context comes from the governed node-type path
    and never from a display name, and that the immediate parent is not the
    asset type -- the type model puts Asset between Asset Type and Asset
    Property. So the ancestors are read as a chain of (name, node_type_id)
    pairs and left for the caller to interpret, rather than guessed at here.
    """

    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    def get_property(self, node_instance_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT n.node_instance_id, n.name, n.model_id, n.node_type_id, "
                "       n.parent_node_id, n.status, "
                "       nt.name AS node_type_name, hm.name AS model_name "
                "FROM hierarchy_model_node_instance n "
                "JOIN hierarchy_model hm ON hm.model_id = n.model_id "
                "LEFT JOIN hierarchy_model_node_type nt ON nt.node_type_id = n.node_type_id "
                "WHERE n.node_instance_id = %s",
                (node_instance_id,),
            ).fetchone()
        return dict(row) if row else None

    def ancestors(self, node_instance_id: str) -> list[dict]:
        """
        The governed path from the root down to this property, inclusive.

        Returned nearest-ancestor-last so a caller can read it left to right:
        Asset Information -> Asset Group -> Asset Type -> Asset -> Asset Property.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "WITH RECURSIVE path AS ("
                "  SELECT n.node_instance_id, n.name, n.node_type_id, n.parent_node_id, 0 AS depth"
                "    FROM hierarchy_model_node_instance n WHERE n.node_instance_id = %s"
                "  UNION ALL"
                "  SELECT p.node_instance_id, p.name, p.node_type_id, p.parent_node_id,"
                "         path.depth + 1"
                "    FROM hierarchy_model_node_instance p"
                "    JOIN path ON path.parent_node_id = p.node_instance_id"
                ") "
                "SELECT path.node_instance_id, path.name, path.node_type_id, path.depth, "
                "       nt.name AS node_type_name "
                "FROM path "
                "LEFT JOIN hierarchy_model_node_type nt ON nt.node_type_id = path.node_type_id "
                "ORDER BY path.depth DESC",
                (node_instance_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_properties_for_model(self, model_id: str) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT n.node_instance_id, n.name, n.node_type_id, n.parent_node_id, "
                "       nt.name AS node_type_name "
                "FROM hierarchy_model_node_instance n "
                "LEFT JOIN hierarchy_model_node_type nt ON nt.node_type_id = n.node_type_id "
                "WHERE n.model_id = %s AND n.status = 'active' "
                "ORDER BY n.sort_order, LOWER(n.name)",
                (model_id,),
            ).fetchall()
        return [dict(row) for row in rows]
