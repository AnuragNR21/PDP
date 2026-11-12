"""
Reading the structure governance graph.

This is a reader and only a reader. Consumers such as the Impact workspace show
what governance already says; nothing here writes, and nothing here invents a relationship that
Structure has not asserted.

The graph has exactly two kinds of asserted instance-level edge, because those
are the only two the database holds:

    hierarchy      a node instance and its parent, inside one hierarchy model
    cross_model    a node instance governed by a Support Domain element instance

A third is *projected*: two element instances whose element types are related in
`support_domain_relationship`. That relationship is authored between types, so
it says nothing about which individual values relate — it is offered as context
and marked as projected, never as an asserted fact.
"""
from __future__ import annotations

from features.structure.domain.governance_graph_kinds import (
    EDGE_CROSS_MODEL,
    EDGE_HIERARCHY,
    EDGE_SUPPORT_DOMAIN,
    MODEL_ITEM_PREFIX,
)
from shared.db import get_connection
from shared.model_config import HIERARCHY_MODEL, HIERARCHY_NODE, SUPPORT_DOMAIN_ELEMENT

#: The most items one expansion may return.
#:
#: A graph walk with no ceiling is a way to hand the browser the whole database
#: because somebody typed 5 into a depth box. The walk stops at this many and
#: says it stopped, which is a far better answer than a canvas that never
#: paints.
MAX_GRAPH_ITEMS = 1500


class StructureGovernanceGraphRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── the catalogue a person picks from ────────────────────────────────────

    _MODEL_SELECT = (
        f"SELECT '{MODEL_ITEM_PREFIX}' || hm.model_id AS item_id, "
        f"       '{HIERARCHY_MODEL}' AS item_kind, "
        "       hm.name AS name, "
        "       'active' AS status, "
        "       hm.model_id AS model_id, "
        "       hm.name AS model_name, "
        "       'Hierarchy model' AS type_name, "
        "       FALSE AS is_property, "
        "       NULL AS parent_id "
        "FROM hierarchy_model hm "
    )

    _NODE_SELECT = (
        "SELECT n.node_instance_id AS item_id, "
        f"       '{HIERARCHY_NODE}' AS item_kind, "
        "       n.name AS name, "
        "       n.status AS status, "
        "       n.model_id AS model_id, "
        "       hm.name AS model_name, "
        "       nt.name AS type_name, "
        "       nt.is_property AS is_property, "
        "       n.parent_node_id AS parent_id "
        "FROM hierarchy_model_node_instance n "
        "JOIN hierarchy_model hm ON hm.model_id = n.model_id "
        "LEFT JOIN hierarchy_model_node_type nt ON nt.node_type_id = n.node_type_id "
    )

    _ELEMENT_SELECT = (
        "SELECT i.instance_id AS item_id, "
        f"       '{SUPPORT_DOMAIN_ELEMENT}' AS item_kind, "
        "       i.name AS name, "
        "       i.status AS status, "
        "       m.support_domain_model_id AS model_id, "
        "       m.name AS model_name, "
        "       et.name AS type_name, "
        "       FALSE AS is_property, "
        "       NULL AS parent_id "
        "FROM support_domain_element_instance i "
        "JOIN support_domain_element_type et ON et.element_id = i.element_type_id "
        "JOIN support_domain_model m ON m.support_domain_model_id = et.support_domain_model_id "
    )

    @property
    def _catalogue(self) -> str:
        return (
            f"(({self._MODEL_SELECT}) UNION ALL ({self._NODE_SELECT}) "
            f"  UNION ALL ({self._ELEMENT_SELECT}))"
        )

    def search_items(
        self,
        *,
        search: str = "",
        kind: str = "",
        model_id: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """
        The items a person can put on the canvas, searched on the server.

        There are tens of thousands of element instances on a real database.
        Sending them all so the browser can filter them is what makes a picker
        take four seconds to open, so the filter runs here and the browser is
        handed a page at a time.
        """
        limit = max(1, min(int(limit or 50), 200))
        offset = max(0, int(offset or 0))
        needle = f"%{search.strip().lower()}%" if search.strip() else ""

        def _where(alias_name: str, alias_model: str) -> tuple[str, list]:
            clauses: list[str] = []
            params: list = []
            if needle:
                clauses.append(f"LOWER({alias_name}) LIKE %s")
                params.append(needle)
            if model_id:
                clauses.append(f"{alias_model} = %s")
                params.append(model_id)
            return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

        parts: list[tuple[str, list]] = []
        if kind in ("", HIERARCHY_MODEL):
            where, params = _where("hm.name", "hm.model_id")
            parts.append((self._MODEL_SELECT + where, params))
        if kind in ("", HIERARCHY_NODE):
            where, params = _where("n.name", "n.model_id")
            parts.append((self._NODE_SELECT + where, params))
        if kind in ("", SUPPORT_DOMAIN_ELEMENT):
            where, params = _where("i.name", "m.support_domain_model_id")
            parts.append((self._ELEMENT_SELECT + where, params))

        if not parts:
            return {"items": [], "total": 0, "limit": limit, "offset": offset}

        union = " UNION ALL ".join(f"({sql})" for sql, _ in parts)
        params: list = [p for _, ps in parts for p in ps]

        with get_connection(self._db_url) as conn:
            total_row = conn.execute(
                f"SELECT COUNT(*) AS n FROM ({union}) catalogue", tuple(params)
            ).fetchone()
            rows = conn.execute(
                f"SELECT * FROM ({union}) catalogue "
                "ORDER BY LOWER(name), item_id LIMIT %s OFFSET %s",
                tuple([*params, limit, offset]),
            ).fetchall()
        return {
            "items": [self._item(row) for row in rows],
            "total": int(dict(total_row)["n"]) if total_row else 0,
            "limit": limit,
            "offset": offset,
        }

    def get_items(self, item_ids: list[str]) -> list[dict]:
        """
        Hydrate items by id — what opening a saved diagram needs.

        Ids that no longer resolve are simply absent from the answer. The
        caller is expected to notice and say so rather than draw a blank box.
        """
        wanted = [i for i in dict.fromkeys(item_ids) if i]
        if not wanted:
            return []
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT * FROM {self._catalogue} catalogue WHERE item_id = ANY(%s)",
                (wanted,),
            ).fetchall()
        return [self._item(row) for row in rows]

    # ── the walk ─────────────────────────────────────────────────────────────

    def neighbourhood(self, seed_ids: list[str], depth: int = 1) -> dict:
        """
        Everything reachable from these items within `depth` asserted hops.

        Breadth-first, one round trip per level rather than per node: a walk
        that queries per node turns a 300-node level into 300 queries, which is
        the difference between a canvas that paints and one that hangs.
        """
        seeds = [i for i in dict.fromkeys(seed_ids) if i]
        depth = max(0, min(int(depth or 0), 5))
        if not seeds:
            return {"items": [], "edges": [], "truncated": False, "seed_ids": []}

        with get_connection(self._db_url) as conn:
            known: dict[str, dict] = {
                item["item_id"]: item for item in self._fetch_items(conn, seeds)
            }
            frontier = [i for i in seeds if i in known]
            edges: dict[str, dict] = {}
            truncated = False

            for _ in range(depth):
                if not frontier or truncated:
                    break
                level_edges = self._edges_touching(conn, frontier)
                discovered: list[str] = []
                for edge in level_edges:
                    edges.setdefault(edge["edge_id"], edge)
                    for side in (edge["source_id"], edge["target_id"]):
                        if side not in known and side not in discovered:
                            discovered.append(side)
                if not discovered:
                    break
                room = MAX_GRAPH_ITEMS - len(known)
                if len(discovered) > room:
                    discovered = discovered[:max(0, room)]
                    truncated = True
                for item in self._fetch_items(conn, discovered):
                    known[item["item_id"]] = item
                frontier = [i for i in discovered if i in known]

            # Every asserted edge *between* items already on the canvas, so the
            # picture is closed: two nodes that are related never sit side by
            # side with the line between them missing.
            for edge in self._edges_within(conn, list(known)):
                edges.setdefault(edge["edge_id"], edge)

        return {
            "items": list(known.values()),
            "edges": list(edges.values()),
            "truncated": truncated,
            "seed_ids": seeds,
        }

    def edges_within(self, item_ids: list[str]) -> list[dict]:
        """Asserted edges among exactly these items, and nothing else."""
        wanted = [i for i in dict.fromkeys(item_ids) if i]
        if not wanted:
            return []
        with get_connection(self._db_url) as conn:
            return self._edges_within(conn, wanted)

    # ── internals ────────────────────────────────────────────────────────────

    def _fetch_items(self, conn, item_ids: list[str]) -> list[dict]:
        if not item_ids:
            return []
        rows = conn.execute(
            f"SELECT * FROM {self._catalogue} catalogue WHERE item_id = ANY(%s)",
            (item_ids,),
        ).fetchall()
        return [self._item(row) for row in rows]

    _HIERARCHY_EDGES = (
        "SELECT 'h:' || child.node_instance_id AS edge_id, "
        f"       '{EDGE_HIERARCHY}' AS edge_kind, "
        "       child.parent_node_id AS source_id, "
        "       child.node_instance_id AS target_id, "
        "       'contains' AS label, "
        "       NULL AS governance_role, "
        "       TRUE AS asserted "
        "FROM hierarchy_model_node_instance child "
        "WHERE child.parent_node_id IS NOT NULL "
    )

    #: A model holds the nodes that sit at the top of it.
    #:
    #: Only the roots. Running a line from the model to every node in it would
    #: draw the same containment twice — once through the model and once down
    #: the tree — and bury the shape of the hierarchy under a fan.
    _MODEL_EDGES = (
        f"SELECT 'm:' || root.node_instance_id AS edge_id, "
        f"       '{EDGE_HIERARCHY}' AS edge_kind, "
        f"       '{MODEL_ITEM_PREFIX}' || root.model_id AS source_id, "
        "       root.node_instance_id AS target_id, "
        "       'contains' AS label, "
        "       NULL AS governance_role, "
        "       TRUE AS asserted "
        "FROM hierarchy_model_node_instance root "
        "WHERE root.parent_node_id IS NULL "
    )

    _CROSS_MODEL_EDGES = (
        "SELECT 'x:' || x.relationship_id AS edge_id, "
        f"       '{EDGE_CROSS_MODEL}' AS edge_kind, "
        "       x.source_instance_id AS source_id, "
        "       x.target_instance_id AS target_id, "
        "       COALESCE(rt.name, 'related to') AS label, "
        "       rt.governance_role AS governance_role, "
        "       TRUE AS asserted "
        "FROM cross_model_relationship_instance x "
        "LEFT JOIN cross_model_relationship_type rt "
        "       ON rt.relationship_type_id = x.relationship_rule_id "
        "WHERE x.status = 'active' "
    )

    #: Projected, not asserted. `support_domain_relationship` is authored
    #: between element *types*; reading it down onto every pair of their
    #: instances would claim a relationship nobody stated, so it is only ever
    #: drawn between instances already on the canvas and is flagged as
    #: projected so the screen can say so.
    _SUPPORT_DOMAIN_EDGES = (
        "SELECT 's:' || r.relationship_id || ':' || a.instance_id || ':' || b.instance_id AS edge_id, "
        f"       '{EDGE_SUPPORT_DOMAIN}' AS edge_kind, "
        "       a.instance_id AS source_id, "
        "       b.instance_id AS target_id, "
        "       COALESCE(NULLIF(r.name, ''), NULLIF(r.relationship_type, ''), 'relates to') AS label, "
        "       NULL AS governance_role, "
        "       FALSE AS asserted "
        "FROM support_domain_relationship r "
        "JOIN support_domain_element_instance a ON a.element_type_id = r.source_element_id "
        "JOIN support_domain_element_instance b ON b.element_type_id = r.target_element_id "
        "WHERE r.status = 'active' "
    )

    def _edges_touching(self, conn, item_ids: list[str]) -> list[dict]:
        """Asserted edges with at least one end on these items — the walk's step."""
        rows = conn.execute(
            f"SELECT * FROM (({self._HIERARCHY_EDGES}) UNION ALL ({self._MODEL_EDGES}) "
            f"              UNION ALL ({self._CROSS_MODEL_EDGES})) e "
            "WHERE e.source_id = ANY(%s) OR e.target_id = ANY(%s)",
            (item_ids, item_ids),
        ).fetchall()
        return [dict(row) for row in rows]

    def _edges_within(self, conn, item_ids: list[str]) -> list[dict]:
        rows = conn.execute(
            f"SELECT * FROM (({self._HIERARCHY_EDGES}) UNION ALL ({self._MODEL_EDGES}) "
            f"              UNION ALL ({self._CROSS_MODEL_EDGES}) "
            f"              UNION ALL ({self._SUPPORT_DOMAIN_EDGES})) e "
            "WHERE e.source_id = ANY(%s) AND e.target_id = ANY(%s)",
            (item_ids, item_ids),
        ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _item(row) -> dict:
        data = dict(row)
        data["is_property"] = bool(data.get("is_property"))
        return data
