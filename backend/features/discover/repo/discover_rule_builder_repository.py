"""
DiscoverRuleBuilderRepository — the governed catalogue the Rule Builder reads.

Everything here is **read-only**. Support Domain models, their element types and
the cross-model relationships between models are owned by Structure and Model;
Discover consumes them to decide what a session is allowed to build and never
writes to them. Keeping those reads in a Discover-owned file means the Rule
Builder can evolve without reaching into another feature's repositories.
"""
from shared.db import get_connection


class DiscoverRuleBuilderRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── step 1: which body of governance ─────────────────────────────────────

    def list_support_models(self) -> list[dict]:
        """
        The Support Domain models a session may draw rules from.

        Draft models are included and marked rather than hidden: a model being
        drafted is exactly when someone wants to try its rules against real data,
        and the status is shown so nobody mistakes a draft for settled governance.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT m.support_domain_model_id AS model_id, m.name, m.description, m.status, "
                "       COUNT(DISTINCT e.element_id) AS element_count "
                "FROM support_domain_model m "
                "LEFT JOIN support_domain_element_type e "
                "       ON e.support_domain_model_id = m.support_domain_model_id "
                "GROUP BY m.support_domain_model_id, m.name, m.description, m.status "
                "ORDER BY m.name",
                (),
            ).fetchall()
        return [dict(row) for row in rows]

    # ── step 2: what that governance binds to ────────────────────────────────

    def list_cross_model_links(self, support_model_id: str) -> list[dict]:
        """
        Every cross-model relationship with one foot in this Support Domain model.

        A relationship is returned from the *support model's point of view*: the
        `governed_*` columns describe the element inside the chosen model, and the
        `bound_*` columns describe whatever it reaches on the other side. The
        stored row may point either way round, so both directions are read and
        normalised here — a caller should never have to ask which end it is on.

        The bound side is what makes a relationship usable as a rule subject: when
        it names a hierarchy node type, Discover's mappings can resolve it to real
        columns. Relationships whose other end is another Support Domain model are
        still returned, marked, and left unusable rather than hidden, so the list
        matches what the modeller sees.
        """
        sql = """
            SELECT
                t.relationship_type_id,
                t.name                         AS relationship_name,
                t.description                  AS relationship_description,
                t.status,
                '{direction}'                  AS direction,
                {governed_type_id}             AS governed_item_type_id,
                ge.name                        AS governed_type_name,
                ge.display_name                AS governed_type_display_name,
                {bound_model_type}             AS bound_model_type,
                {bound_type_id}                AS bound_item_type_id,
                COALESCE(bn.name, be.name)     AS bound_type_name,
                COALESCE(bhm.name, bsm.name)   AS bound_model_name,
                COALESCE(bn.model_id, bsm.support_domain_model_id) AS bound_model_id
            FROM cross_model_relationship_type t
            JOIN support_domain_element_type ge
              ON ge.element_id = {governed_type_id}
             AND ge.support_domain_model_id = %s
            LEFT JOIN hierarchy_model_node_type bn
              ON {bound_model_type} = 'HIERARCHY_MODEL' AND bn.node_type_id = {bound_type_id}
            LEFT JOIN hierarchy_model bhm
              ON bhm.model_id = bn.model_id
            LEFT JOIN support_domain_element_type be
              ON {bound_model_type} = 'SUPPORT_DOMAIN_MODEL' AND be.element_id = {bound_type_id}
            LEFT JOIN support_domain_model bsm
              ON bsm.support_domain_model_id = be.support_domain_model_id
            WHERE t.status = 'active' AND {governed_model_type} = 'SUPPORT_DOMAIN_MODEL'
        """
        outgoing = sql.format(
            direction="outgoing",
            governed_type_id="t.source_model_item_type_id",
            governed_model_type="t.source_model_type",
            bound_model_type="t.target_model_type",
            bound_type_id="t.target_model_item_type_id",
        )
        incoming = sql.format(
            direction="incoming",
            governed_type_id="t.target_model_item_type_id",
            governed_model_type="t.target_model_type",
            bound_model_type="t.source_model_type",
            bound_type_id="t.source_model_item_type_id",
        )
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"{outgoing} UNION ALL {incoming} ORDER BY 2, 7",
                (support_model_id, support_model_id),
            ).fetchall()
        return [dict(row) for row in rows]

    # ── step 3: the governed rules the model declares ────────────────────────

    def list_rule_instances(self, support_model_id: str) -> list[dict]:
        """
        Every governed rule this model declares, in one read, each carrying the
        element type it belongs to.

        The builder used to ask for one type at a time behind a picker, which
        meant a person had to know that "Threshold" and "Rule" were separate
        drawers before they could see what was in either. They are all rules the
        model states; the type is how they are grouped on screen, not a question
        to answer first. Ordering follows the model's own sort order so the
        groups appear as the modeller arranged them.

        These rows carry a name and a description and nothing executable: a
        Support Domain model states what must be true in prose, not in check
        logic. What that prose means to the engine is decided a layer up, shown,
        and left open to correction.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT i.instance_id, i.name, i.description, i.status, "
                "       et.element_id AS element_type_id, "
                "       et.name AS element_type_name, "
                "       et.display_name AS element_type_display_name "
                "FROM support_domain_element_instance i "
                "JOIN support_domain_element_type et ON et.element_id = i.element_type_id "
                "WHERE i.support_domain_model_id = %s "
                "ORDER BY et.sort_order, et.name, i.sort_order, i.name",
                (support_model_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    # ── step 3: the fields a rule can be set on ──────────────────────────────

    def list_mapped_columns(self, session_id: str) -> list[dict]:
        """
        Every column this session has mapped — the fields a rule can be set on.

        A rule has to land on a mapped column to be checkable at all, so this is
        the outer limit of what the builder may offer. Which of these a chosen
        relationship *reaches* is a narrower question, answered below; that
        answer informs the person rather than restricting them.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT sc.column_id, sc.column_name, m.target_node_id, "
                "       n.name AS target_name, n.node_type_id, "
                "       sc.detected_type, dc.inferred_datatype "
                "FROM column_mapping m "
                "JOIN active_source_column sc ON sc.column_id = m.column_id "
                "LEFT JOIN hierarchy_model_node_instance n "
                "       ON n.node_instance_id = m.target_node_id "
                "LEFT JOIN active_discovery_column dc "
                "       ON dc.session_id = sc.session_id AND dc.source_label = sc.column_name "
                "WHERE m.session_id = %s "
                "ORDER BY sc.ordinal",
                (session_id,),
            ).fetchall()
        columns = []
        for row in rows:
            entry = dict(row)
            entry["datatype"] = (
                entry.pop("inferred_datatype") or entry.get("detected_type") or "String"
            )
            entry["target_name"] = entry.get("target_name") or entry["column_name"]
            columns.append(entry)
        return columns

    def mapped_columns_by_node_type(self, session_id: str) -> dict[str, list[dict]]:
        """
        This session's mapped columns, keyed by the hierarchy node type they were
        mapped onto.

        This is the join that makes a governed relationship actionable. Mapping
        binds a column to a node *instance*; a cross-model relationship names a
        node *type*. Reading the type off each mapped instance is what lets the
        builder say "this relationship reaches your Pole Height column" instead of
        offering a rule with nothing to run on.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT n.node_type_id, m.target_node_id, n.name AS target_name, "
                "       sc.column_id, sc.column_name, sc.detected_type, "
                "       dc.inferred_datatype "
                "FROM column_mapping m "
                "JOIN active_source_column sc ON sc.column_id = m.column_id "
                "JOIN hierarchy_model_node_instance n ON n.node_instance_id = m.target_node_id "
                "LEFT JOIN active_discovery_column dc "
                "       ON dc.session_id = sc.session_id AND dc.source_label = sc.column_name "
                "WHERE m.session_id = %s "
                "ORDER BY sc.ordinal",
                (session_id,),
            ).fetchall()
        grouped: dict[str, list[dict]] = {}
        for row in rows:
            entry = dict(row)
            entry["datatype"] = (
                entry.pop("inferred_datatype") or entry.get("detected_type") or "String"
            )
            grouped.setdefault(entry["node_type_id"], []).append(entry)
        return grouped
