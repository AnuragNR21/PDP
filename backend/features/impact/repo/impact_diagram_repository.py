"""
Persistence for saved Impact knowledge-graph views.

A saved impact diagram is a reading somebody kept: which items they had on the
canvas, where they put them, and how the lines between them were drawn. It
asserts no governance, so it holds no relationship of its own — only the ids of
things Structure already owns.

Every save replaces the diagram's whole node and edge set. The canvas is the
source of truth; reconciling row by row would leave a diagram that is half of
one reading and half of another.
"""
from __future__ import annotations

from uuid import uuid4

from shared.db import get_connection, utc_now_iso


class ImpactDiagramRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    def list_diagrams(self) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                """
                SELECT d.diagram_id, d.name, d.created_at, d.updated_at,
                       COUNT(n.diagram_node_id) AS node_count
                FROM impact_diagrams d
                LEFT JOIN impact_diagram_nodes n ON n.diagram_id = d.diagram_id
                GROUP BY d.diagram_id, d.name, d.created_at, d.updated_at
                ORDER BY d.updated_at DESC, d.name
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def get_diagram(self, diagram_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT diagram_id, name, created_at, updated_at "
                "FROM impact_diagrams WHERE diagram_id = %s",
                (diagram_id,),
            ).fetchone()
            if row is None:
                return None
            diagram = dict(row)
            diagram["nodes"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT item_id, item_kind, pos_x, pos_y, sort_order "
                    "FROM impact_diagram_nodes WHERE diagram_id = %s "
                    "ORDER BY sort_order, item_id",
                    (diagram_id,),
                ).fetchall()
            ]
            diagram["edges"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT edge_key, edge_style, sort_order "
                    "FROM impact_diagram_edges WHERE diagram_id = %s "
                    "ORDER BY sort_order, edge_key",
                    (diagram_id,),
                ).fetchall()
            ]
        return diagram

    def create_diagram(self, name: str, nodes: list[dict], edges: list[dict]) -> dict:
        diagram_id = f"impd_{uuid4().hex[:12]}"
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO impact_diagrams (diagram_id, name, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s)",
                (diagram_id, name, now, now),
            )
            self._write_contents(conn, diagram_id, nodes, edges, now)
        return self.get_diagram(diagram_id)

    def update_diagram(
        self, diagram_id: str, name: str, nodes: list[dict], edges: list[dict]
    ) -> dict | None:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            existing = conn.execute(
                "SELECT 1 FROM impact_diagrams WHERE diagram_id = %s", (diagram_id,)
            ).fetchone()
            if existing is None:
                return None
            conn.execute(
                "UPDATE impact_diagrams SET name = %s, updated_at = %s WHERE diagram_id = %s",
                (name, now, diagram_id),
            )
            conn.execute(
                "DELETE FROM impact_diagram_nodes WHERE diagram_id = %s", (diagram_id,)
            )
            conn.execute(
                "DELETE FROM impact_diagram_edges WHERE diagram_id = %s", (diagram_id,)
            )
            self._write_contents(conn, diagram_id, nodes, edges, now)
        return self.get_diagram(diagram_id)

    def delete_diagram(self, diagram_id: str) -> bool:
        with get_connection(self._db_url) as conn:
            existing = conn.execute(
                "SELECT 1 FROM impact_diagrams WHERE diagram_id = %s", (diagram_id,)
            ).fetchone()
            if existing is None:
                return False
            conn.execute("DELETE FROM impact_diagrams WHERE diagram_id = %s", (diagram_id,))
        return True

    # ── internals ────────────────────────────────────────────────────────────

    @staticmethod
    def _write_contents(conn, diagram_id: str, nodes, edges, now: str) -> None:
        seen: set[str] = set()
        order = 0
        for node in nodes:
            item_id = str(node.get("item_id") or "").strip()
            if not item_id or item_id in seen:
                # One canvas position per item. A duplicate would make the
                # saved diagram ambiguous about where the item actually sits.
                continue
            seen.add(item_id)
            conn.execute(
                "INSERT INTO impact_diagram_nodes (diagram_node_id, diagram_id, item_id, "
                "item_kind, pos_x, pos_y, sort_order, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    f"impdn_{uuid4().hex[:12]}",
                    diagram_id,
                    item_id,
                    str(node.get("item_kind") or ""),
                    float(node.get("pos_x") or 0.0),
                    float(node.get("pos_y") or 0.0),
                    order,
                    now,
                ),
            )
            order += 1

        seen_edges: set[str] = set()
        order = 0
        for edge in edges:
            edge_key = str(edge.get("edge_key") or "").strip()
            if not edge_key or edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)
            conn.execute(
                "INSERT INTO impact_diagram_edges (diagram_edge_id, diagram_id, edge_key, "
                "edge_style, sort_order, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    f"impde_{uuid4().hex[:12]}",
                    diagram_id,
                    edge_key,
                    str(edge.get("edge_style") or "curved"),
                    order,
                    now,
                ),
            )
            order += 1
