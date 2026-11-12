from uuid import uuid4

from shared.db import get_connection, utc_now_iso


class CrossModelInstanceDiagramRepository:
    """Persistence for saved instance-level cross-model relationship diagrams."""

    def __init__(self, db_url: str):
        self._db_url = db_url

    def list_diagrams(self) -> list[dict]:
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                """
                SELECT
                    d.diagram_id,
                    d.name,
                    d.created_at,
                    d.updated_at,
                    COUNT(n.diagram_node_id) AS node_count
                FROM cross_model_relationship_instance_diagrams d
                LEFT JOIN cross_model_relationship_instance_diagram_nodes n
                       ON n.diagram_id = d.diagram_id
                GROUP BY d.diagram_id, d.name, d.created_at, d.updated_at
                ORDER BY d.updated_at DESC, d.name
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def get_diagram(self, diagram_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                """
                SELECT diagram_id, name, created_at, updated_at
                FROM cross_model_relationship_instance_diagrams
                WHERE diagram_id = %s
                """,
                (diagram_id,),
            ).fetchone()
            if row is None:
                return None
            diagram = dict(row)
            diagram["nodes"] = self._list_nodes(conn, diagram_id)
            diagram["edges"] = self._list_edges(conn, diagram_id)
            diagram["shapes"] = self._list_shapes(conn, diagram_id)
        return diagram

    def _list_nodes(self, conn, diagram_id: str) -> list[dict]:
        rows = conn.execute(
            """
            SELECT item_id, item_kind, pos_x, pos_y, sort_order
            FROM cross_model_relationship_instance_diagram_nodes
            WHERE diagram_id = %s
            ORDER BY sort_order, item_id
            """,
            (diagram_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def _list_edges(self, conn, diagram_id: str) -> list[dict]:
        rows = conn.execute(
            """
            SELECT edge_key, edge_style, sort_order
            FROM cross_model_relationship_instance_diagram_edges
            WHERE diagram_id = %s
            ORDER BY sort_order, edge_key
            """,
            (diagram_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def _list_shapes(self, conn, diagram_id: str) -> list[dict]:
        rows = conn.execute(
            """
            SELECT shape_kind, pos_x, pos_y, width, height, text,
                   stroke_color, text_color, font_size, z_index, sort_order
            FROM cross_model_relationship_instance_diagram_shapes
            WHERE diagram_id = %s
            ORDER BY sort_order
            """,
            (diagram_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def create_diagram(self, payload: dict) -> dict:
        diagram_id = payload.get("diagram_id") or str(uuid4())
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                """
                INSERT INTO cross_model_relationship_instance_diagrams (diagram_id, name, created_at, updated_at)
                VALUES (%s, %s, %s, %s)
                """,
                (diagram_id, payload["name"], now, now),
            )
            self._replace_nodes(conn, diagram_id, payload.get("nodes") or [], now)
            self._replace_edges(conn, diagram_id, payload.get("edges") or [], now)
            self._replace_shapes(conn, diagram_id, payload.get("shapes") or [], now)
            diagram = self._get_diagram_in_conn(conn, diagram_id)
        return diagram

    def update_diagram(self, diagram_id: str, payload: dict) -> dict | None:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            existing = conn.execute(
                "SELECT diagram_id FROM cross_model_relationship_instance_diagrams WHERE diagram_id = %s",
                (diagram_id,),
            ).fetchone()
            if existing is None:
                return None
            conn.execute(
                """
                UPDATE cross_model_relationship_instance_diagrams
                SET name = %s, updated_at = %s
                WHERE diagram_id = %s
                """,
                (payload["name"], now, diagram_id),
            )
            self._replace_nodes(conn, diagram_id, payload.get("nodes") or [], now)
            self._replace_edges(conn, diagram_id, payload.get("edges") or [], now)
            self._replace_shapes(conn, diagram_id, payload.get("shapes") or [], now)
            diagram = self._get_diagram_in_conn(conn, diagram_id)
        return diagram

    def _get_diagram_in_conn(self, conn, diagram_id: str) -> dict:
        row = conn.execute(
            """
            SELECT diagram_id, name, created_at, updated_at
            FROM cross_model_relationship_instance_diagrams
            WHERE diagram_id = %s
            """,
            (diagram_id,),
        ).fetchone()
        diagram = dict(row)
        diagram["nodes"] = self._list_nodes(conn, diagram_id)
        diagram["edges"] = self._list_edges(conn, diagram_id)
        diagram["shapes"] = self._list_shapes(conn, diagram_id)
        return diagram

    def _replace_edges(self, conn, diagram_id: str, edges: list[dict], now: str) -> None:
        conn.execute(
            "DELETE FROM cross_model_relationship_instance_diagram_edges WHERE diagram_id = %s",
            (diagram_id,),
        )
        for index, edge in enumerate(edges):
            conn.execute(
                """
                INSERT INTO cross_model_relationship_instance_diagram_edges (
                    diagram_edge_id, diagram_id, edge_key, edge_style, sort_order, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    diagram_id,
                    edge["edge_key"],
                    edge.get("edge_style", "curved"),
                    index,
                    now,
                ),
            )

    def _replace_nodes(self, conn, diagram_id: str, nodes: list[dict], now: str) -> None:
        conn.execute(
            "DELETE FROM cross_model_relationship_instance_diagram_nodes WHERE diagram_id = %s",
            (diagram_id,),
        )
        for index, node in enumerate(nodes):
            conn.execute(
                """
                INSERT INTO cross_model_relationship_instance_diagram_nodes (
                    diagram_node_id, diagram_id, item_id, item_kind, pos_x, pos_y, sort_order, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    diagram_id,
                    node["item_id"],
                    node["item_kind"],
                    node.get("pos_x", 0),
                    node.get("pos_y", 0),
                    index,
                    now,
                ),
            )

    def _replace_shapes(self, conn, diagram_id: str, shapes: list[dict], now: str) -> None:
        conn.execute(
            "DELETE FROM cross_model_relationship_instance_diagram_shapes WHERE diagram_id = %s",
            (diagram_id,),
        )
        # Drawn annotations have no identity of their own — the canvas is the
        # source of truth, so each save replaces the diagram's whole shape set.
        for index, shape in enumerate(shapes):
            conn.execute(
                """
                INSERT INTO cross_model_relationship_instance_diagram_shapes (
                    diagram_shape_id, diagram_id, shape_kind, pos_x, pos_y, width, height, text,
                    stroke_color, text_color, font_size, z_index, sort_order, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    diagram_id,
                    shape["shape_kind"],
                    shape.get("pos_x", 0),
                    shape.get("pos_y", 0),
                    shape.get("width", 200),
                    shape.get("height", 120),
                    shape.get("text", ""),
                    shape.get("stroke_color"),
                    shape.get("text_color"),
                    shape.get("font_size"),
                    shape.get("z_index"),
                    index,
                    now,
                ),
            )

    def delete_diagram(self, diagram_id: str) -> bool:
        with get_connection(self._db_url) as conn:
            existing = conn.execute(
                "SELECT diagram_id FROM cross_model_relationship_instance_diagrams WHERE diagram_id = %s",
                (diagram_id,),
            ).fetchone()
            if existing is None:
                return False
            conn.execute(
                "DELETE FROM cross_model_relationship_instance_diagram_shapes WHERE diagram_id = %s",
                (diagram_id,),
            )
            conn.execute(
                "DELETE FROM cross_model_relationship_instance_diagram_edges WHERE diagram_id = %s",
                (diagram_id,),
            )
            conn.execute(
                "DELETE FROM cross_model_relationship_instance_diagram_nodes WHERE diagram_id = %s",
                (diagram_id,),
            )
            conn.execute(
                "DELETE FROM cross_model_relationship_instance_diagrams WHERE diagram_id = %s",
                (diagram_id,),
            )
        return True
