from __future__ import annotations

import uuid


DEFAULT_DIAGRAM_NAME = "Support Domain Diagram"
DEFAULT_DIAGRAM_DESCRIPTION = "Projection diagram for support domain model."
DEFAULT_DIAGRAM_STATUS = "active"

DEFAULT_NODE_WIDTH = 180
DEFAULT_NODE_HEIGHT = 60
DEFAULT_LAYOUT_START_X = 80
DEFAULT_LAYOUT_START_Y = 80
DEFAULT_LAYOUT_COLUMNS = 4
DEFAULT_LAYOUT_COLUMN_SPACING = 240
DEFAULT_LAYOUT_ROW_SPACING = 140


class SupportDomainDiagramNodeRepo:
    """Repository for support domain diagram node persistence."""

    def __init__(self, db):
        self._db = db

    def list_nodes_for_model(self, model_id: str) -> list[dict]:
        diagram_id = self._get_diagram_id(model_id)
        if diagram_id is None:
            return []

        return self.list_nodes(diagram_id=diagram_id)

    def get_node(self, diagram_node_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                diagram_node_id,
                diagram_id,
                element_id,
                x,
                y,
                width,
                height,
                created_at,
                updated_at
            from support_domain_diagram_node
            where diagram_node_id = %s
            """,
            (diagram_node_id,),
        ).fetchone()

        return dict(row) if row else None

    def get_diagram_node_by_element_id(self, element_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                diagram_node_id,
                diagram_id,
                element_id,
                x,
                y,
                width,
                height,
                created_at,
                updated_at
            from support_domain_diagram_node
            where element_id = %s
            """,
            (element_id,),
        ).fetchone()

        return dict(row) if row else None

    def list_nodes(self, diagram_id: str) -> list[dict]:
        rows = self._db.execute(
            """
            select
                diagram_node_id,
                diagram_id,
                element_id,
                x,
                y,
                width,
                height,
                created_at,
                updated_at
            from support_domain_diagram_node
            where diagram_id = %s
            order by created_at asc
            """,
            (diagram_id,),
        ).fetchall()

        return [dict(row) for row in rows]

    def create_diagram_nodes_for_model(self, model_id: str) -> list[dict]:
        diagram_id = self._get_diagram_id(model_id)
        if diagram_id is None:
            diagram_id = self._create_diagram(model_id)

        self._create_missing_nodes_for_diagram(diagram_id, model_id)
        return self.list_nodes(diagram_id=diagram_id)

    def _get_diagram_id(self, model_id: str) -> str | None:
        row = self._db.execute(
            """
            select diagram_id
            from support_domain_diagram
            where support_domain_model_id = %s
            order by created_at asc
            limit 1
            """,
            (model_id,),
        ).fetchone()
        return str(row["diagram_id"]) if row else None

    def _create_diagram(self, model_id: str) -> str:
        diagram_id = str(uuid.uuid4())
        self._db.execute(
            """
            insert into support_domain_diagram (
                diagram_id,
                support_domain_model_id,
                name,
                description,
                status,
                created_at,
                updated_at
            )
            values (%s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (
                diagram_id,
                model_id,
                DEFAULT_DIAGRAM_NAME,
                DEFAULT_DIAGRAM_DESCRIPTION,
                DEFAULT_DIAGRAM_STATUS,
            ),
        )
        self._db.commit()
        return diagram_id

    def _create_missing_nodes_for_diagram(self, diagram_id: str, model_id: str) -> None:
        rows = self._db.execute(
            """
            select element_id
            from support_domain_element_type
            where support_domain_model_id = %s
              and not exists (
                  select 1
                  from support_domain_diagram_node sddn
                  where sddn.diagram_id = %s
                    and sddn.element_id = support_domain_element_type.element_id
              )
            order by name
            """,
            (model_id, diagram_id),
        ).fetchall()

        if not rows:
            return

        existing_count_row = self._db.execute(
            """
            select count(*) as node_count
            from support_domain_diagram_node
            where diagram_id = %s
            """,
            (diagram_id,),
        ).fetchone()
        existing_count = int(existing_count_row["node_count"]) if existing_count_row else 0

        for offset, row in enumerate(rows):
            index = existing_count + offset
            self._db.execute(
                """
                insert into support_domain_diagram_node (
                    diagram_node_id,
                    diagram_id,
                    element_id,
                    x,
                    y,
                    width,
                    height,
                    created_at,
                    updated_at
                )
                values (%s, %s, %s, %s, %s, %s, %s, current_timestamp, current_timestamp)
                """,
                (
                    str(uuid.uuid4()),
                    diagram_id,
                    row["element_id"],
                    DEFAULT_LAYOUT_START_X
                    + (index % DEFAULT_LAYOUT_COLUMNS) * DEFAULT_LAYOUT_COLUMN_SPACING,
                    DEFAULT_LAYOUT_START_Y
                    + (index // DEFAULT_LAYOUT_COLUMNS) * DEFAULT_LAYOUT_ROW_SPACING,
                    DEFAULT_NODE_WIDTH,
                    DEFAULT_NODE_HEIGHT,
                ),
            )

        self._db.commit()

    def update_node_position(
        self,
        diagram_node_id: str,
        x: float,
        y: float,
    ) -> dict:

        self._db.execute(
            """
            update support_domain_diagram_node
            set
                x = %s,
                y = %s,
                updated_at = current_timestamp
            where diagram_node_id = %s
            """,
            (x, y, diagram_node_id),
        )

        self._db.commit()

        return self.get_node(diagram_node_id)

    def update_element_position(
        self,
        element_id: str,
        x: float,
        y: float,
    ) -> dict:
        node = self.get_diagram_node_by_element_id(element_id)
        if node is None:
            return None

        return self.update_node_position(node["diagram_node_id"], x, y)
