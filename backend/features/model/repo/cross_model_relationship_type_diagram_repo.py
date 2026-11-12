from __future__ import annotations

import uuid
from typing import Any


class CrossModelRelationshipTypeDiagramRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_diagrams(self) -> list[dict]:
        rows = self._db.execute(
            """
            SELECT
                d.diagram_id,
                d.name,
                d.created_at,
                d.updated_at,
                COUNT(n.diagram_node_id) AS node_count
            FROM cross_model_relationship_type_diagrams d
            LEFT JOIN cross_model_relationship_type_diagram_nodes n
                   ON n.diagram_id = d.diagram_id
            GROUP BY d.diagram_id, d.name, d.created_at, d.updated_at
            ORDER BY d.updated_at DESC, d.name
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_diagram(self, diagram_id: str) -> dict | None:
        row = self._db.execute(
            """
            SELECT diagram_id, name, created_at, updated_at
            FROM cross_model_relationship_type_diagrams
            WHERE diagram_id = %s
            """,
            (diagram_id,),
        ).fetchone()
        if row is None:
            return None
        diagram = dict(row)
        diagram["nodes"] = self._list_nodes(diagram_id)
        diagram["edges"] = self._list_edges(diagram_id)
        diagram["shapes"] = self._list_shapes(diagram_id)
        return diagram

    def _list_nodes(self, diagram_id: str) -> list[dict]:
        rows = self._db.execute(
            """
            SELECT item_type_id, item_kind, pos_x, pos_y, sort_order
            FROM cross_model_relationship_type_diagram_nodes
            WHERE diagram_id = %s
            ORDER BY sort_order, item_type_id
            """,
            (diagram_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def _list_edges(self, diagram_id: str) -> list[dict]:
        rows = self._db.execute(
            """
            SELECT edge_key, edge_style, sort_order
            FROM cross_model_relationship_type_diagram_edges
            WHERE diagram_id = %s
            ORDER BY sort_order, edge_key
            """,
            (diagram_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def _list_shapes(self, diagram_id: str) -> list[dict]:
        rows = self._db.execute(
            """
            SELECT shape_kind, pos_x, pos_y, width, height, text,
                   stroke_color, text_color, font_size, z_index, sort_order
            FROM cross_model_relationship_type_diagram_shapes
            WHERE diagram_id = %s
            ORDER BY sort_order
            """,
            (diagram_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def create_diagram(self, payload: dict) -> dict:
        diagram_id = payload.get("diagram_id") or str(uuid.uuid4())
        self._db.execute(
            """
            INSERT INTO cross_model_relationship_type_diagrams (diagram_id, name, created_at, updated_at)
            VALUES (%s, %s, current_timestamp, current_timestamp)
            """,
            (diagram_id, payload["name"]),
        )
        self._replace_nodes(diagram_id, payload.get("nodes") or [])
        self._replace_edges(diagram_id, payload.get("edges") or [])
        self._replace_shapes(diagram_id, payload.get("shapes") or [])
        return self.get_diagram(diagram_id)

    def update_diagram(self, diagram_id: str, payload: dict) -> dict | None:
        self._db.execute(
            """
            UPDATE cross_model_relationship_type_diagrams
            SET name = %s, updated_at = current_timestamp
            WHERE diagram_id = %s
            """,
            (payload["name"], diagram_id),
        )
        self._replace_nodes(diagram_id, payload.get("nodes") or [])
        self._replace_edges(diagram_id, payload.get("edges") or [])
        self._replace_shapes(diagram_id, payload.get("shapes") or [])
        return self.get_diagram(diagram_id)

    def _replace_nodes(self, diagram_id: str, nodes: list[dict]) -> None:
        self._db.execute(
            "DELETE FROM cross_model_relationship_type_diagram_nodes WHERE diagram_id = %s",
            (diagram_id,),
        )
        for index, node in enumerate(nodes):
            self._db.execute(
                """
                INSERT INTO cross_model_relationship_type_diagram_nodes (
                    diagram_node_id, diagram_id, item_type_id, item_kind, pos_x, pos_y, sort_order, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, current_timestamp)
                """,
                (
                    str(uuid.uuid4()),
                    diagram_id,
                    node["item_type_id"],
                    node["item_kind"],
                    node.get("pos_x", 0),
                    node.get("pos_y", 0),
                    index,
                ),
            )

    def _replace_edges(self, diagram_id: str, edges: list[dict]) -> None:
        self._db.execute(
            "DELETE FROM cross_model_relationship_type_diagram_edges WHERE diagram_id = %s",
            (diagram_id,),
        )
        for index, edge in enumerate(edges):
            self._db.execute(
                """
                INSERT INTO cross_model_relationship_type_diagram_edges (
                    diagram_edge_id, diagram_id, edge_key, edge_style, sort_order, created_at
                ) VALUES (%s, %s, %s, %s, %s, current_timestamp)
                """,
                (
                    str(uuid.uuid4()),
                    diagram_id,
                    edge["edge_key"],
                    edge.get("edge_style", "curved"),
                    index,
                ),
            )

    def _replace_shapes(self, diagram_id: str, shapes: list[dict]) -> None:
        self._db.execute(
            "DELETE FROM cross_model_relationship_type_diagram_shapes WHERE diagram_id = %s",
            (diagram_id,),
        )
        # Drawn annotations have no identity of their own — the canvas is the
        # source of truth, so each save replaces the diagram's whole shape set.
        for index, shape in enumerate(shapes):
            self._db.execute(
                """
                INSERT INTO cross_model_relationship_type_diagram_shapes (
                    diagram_shape_id, diagram_id, shape_kind, pos_x, pos_y, width, height, text,
                    stroke_color, text_color, font_size, z_index, sort_order, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, current_timestamp)
                """,
                (
                    str(uuid.uuid4()),
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
                ),
            )

    def delete_diagram(self, diagram_id: str) -> None:
        self._db.execute(
            "DELETE FROM cross_model_relationship_type_diagram_shapes WHERE diagram_id = %s",
            (diagram_id,),
        )
        self._db.execute(
            "DELETE FROM cross_model_relationship_type_diagram_edges WHERE diagram_id = %s",
            (diagram_id,),
        )
        self._db.execute(
            "DELETE FROM cross_model_relationship_type_diagram_nodes WHERE diagram_id = %s",
            (diagram_id,),
        )
        self._db.execute(
            "DELETE FROM cross_model_relationship_type_diagrams WHERE diagram_id = %s",
            (diagram_id,),
        )
