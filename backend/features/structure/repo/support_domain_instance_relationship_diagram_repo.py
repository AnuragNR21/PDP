"""The element instance relationship diagram of a Support Domain model.

Four tables, like the cross-model instance diagram combo:
``support_domain_element_instance_relationship_diagrams`` (one per model,
created the first time something is drawn or placed), ``..._diagram_nodes``
(where each element type card sits), ``..._diagram_edges`` (the relationships a person
chose to draw between two instances) and ``..._diagram_shapes``.

Visualisation only. Element instance relationships are not stored anywhere:
they are inferred from the model, where element type A relates to B every
A instance relates to every B instance (``support_domain_relationship``).
These tables only remember how the user chose to show them.

An edge is therefore not a relationship: the relationship between its two
instances exists whether drawn or not. An edge may only be drawn where such
an inferred relationship exists; the service checks the model relationship,
its direction and the instances' types before ``create_edge``.
The edge id is served as ``relationship_instance_id`` because the screens and
the Data Exchange CSV already know it by that name.
"""

from uuid import uuid4

from shared.db import get_connection, utc_now_iso

DIAGRAM_TABLE = "support_domain_element_instance_relationship_diagrams"
DIAGRAM_NODE_TABLE = "support_domain_element_instance_relationship_diagram_nodes"
DIAGRAM_EDGE_TABLE = "support_domain_element_instance_relationship_diagram_edges"
DIAGRAM_SHAPE_TABLE = "support_domain_element_instance_relationship_diagram_shapes"

DEFAULT_DIAGRAM_NAME = "Diagram"

# Drawn edges with the diagram they belong to, and through it the model.
DIAGRAM_EDGES_WITH_DIAGRAM = f"""
    FROM {DIAGRAM_EDGE_TABLE} edge
    JOIN {DIAGRAM_TABLE} diagram ON diagram.diagram_id = edge.diagram_id
"""

# A drawn edge with the names the screens show: ``relationship`` is the model
# relationship it follows, ``source_instance`` and ``target_instance`` its ends.
_SELECT_DRAWN_EDGE = f"""
    SELECT
        edge.diagram_edge_id AS relationship_instance_id,
        edge.diagram_id,
        edge.support_domain_relationship_id,
        diagram.support_domain_model_id,
        relationship.relationship_type,
        edge.source_instance_id,
        source_instance.name AS source_instance_name,
        source_instance.element_type_id AS source_element_type_id,
        edge.target_instance_id,
        target_instance.name AS target_instance_name,
        target_instance.element_type_id AS target_element_type_id,
        edge.external_id,
        edge.status,
        edge.created_at,
        edge.updated_at
    {DIAGRAM_EDGES_WITH_DIAGRAM}
    JOIN support_domain_relationship relationship
      ON relationship.relationship_id = edge.support_domain_relationship_id
    JOIN support_domain_element_instance source_instance
      ON source_instance.instance_id = edge.source_instance_id
    JOIN support_domain_element_instance target_instance
      ON target_instance.instance_id = edge.target_instance_id
"""


def diagram_edge_key(relationship_id: str, source_instance_id: str, target_instance_id: str) -> str:
    """What makes an edge unique on its diagram: which model relationship it
    draws, from which instance, to which."""
    return f"{relationship_id}:{source_instance_id}:{target_instance_id}"


def find_diagram_id(connection, model_id: str) -> str | None:
    """The model's diagram (the oldest, should there ever be more than one)."""
    row = connection.execute(
        f"SELECT diagram_id FROM {DIAGRAM_TABLE} WHERE support_domain_model_id = %s ORDER BY created_at, diagram_id LIMIT 1",
        (model_id,),
    ).fetchone()
    return row["diagram_id"] if row else None


def ensure_diagram_id(connection, model_id: str) -> str:
    """The model's diagram, created on first use — never just for looking.

    Two first drawings at once must not make two diagrams: the model is locked
    for the rest of the transaction before looking.
    """
    connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"{DIAGRAM_TABLE}:{model_id}",))
    existing = find_diagram_id(connection, model_id)
    if existing:
        return existing
    diagram_id = str(uuid4())
    now = utc_now_iso()
    connection.execute(
        f"INSERT INTO {DIAGRAM_TABLE} (diagram_id, support_domain_model_id, name, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)",
        (diagram_id, model_id, DEFAULT_DIAGRAM_NAME, now, now),
    )
    return diagram_id


def mark_diagram_updated(connection, diagram_id: str) -> None:
    connection.execute(f"UPDATE {DIAGRAM_TABLE} SET updated_at = %s WHERE diagram_id = %s", (utc_now_iso(), diagram_id))


class SupportDomainInstanceRelationshipDiagramRepository:
    """One model's diagram: its layout (where the element type cards sit, and
    its free shapes) and the edges drawn on it."""

    def __init__(self, db_url: str):
        self._db_url = db_url

    # ------------------------------------------------------------- layout

    def get_layout(self, model_id: str) -> dict:
        with get_connection(self._db_url) as connection:
            diagram_id = find_diagram_id(connection, model_id)
            if diagram_id is None:
                return {"diagram_id": None, "support_domain_model_id": model_id, "nodes": [], "shapes": []}
            nodes = connection.execute(
                f"""
                SELECT node.item_id, node.item_kind, node.pos_x, node.pos_y, node.sort_order
                FROM {DIAGRAM_NODE_TABLE} node
                -- A card is an element type of the model; one since removed has no card.
                JOIN support_domain_element_type element_type
                  ON element_type.element_id = node.item_id AND element_type.support_domain_model_id = %s
                WHERE node.diagram_id = %s
                ORDER BY node.sort_order, node.item_id
                """,
                (model_id, diagram_id),
            ).fetchall()
            shapes = connection.execute(
                f"""
                SELECT diagram_shape_id AS id, shape_kind, pos_x, pos_y, width, height, text,
                       stroke_color, text_color, font_size, z_index, sort_order
                FROM {DIAGRAM_SHAPE_TABLE} WHERE diagram_id = %s ORDER BY sort_order, diagram_shape_id
                """,
                (diagram_id,),
            ).fetchall()
        return {
            "diagram_id": diagram_id,
            "support_domain_model_id": model_id,
            "nodes": [dict(row) for row in nodes],
            "shapes": [dict(row) for row in shapes],
        }

    def replace_nodes(self, model_id: str, nodes: list[dict]) -> dict:
        """Replace where the cards sit. An empty list forgets the layout."""
        with get_connection(self._db_url) as connection:
            diagram_id = find_diagram_id(connection, model_id) if not nodes else ensure_diagram_id(connection, model_id)
            if diagram_id is not None:
                connection.execute(f"DELETE FROM {DIAGRAM_NODE_TABLE} WHERE diagram_id = %s", (diagram_id,))
                now = utc_now_iso()
                for index, node in enumerate(nodes):
                    connection.execute(
                        f"""
                        INSERT INTO {DIAGRAM_NODE_TABLE} (
                            diagram_node_id, diagram_id, item_id, item_kind, pos_x, pos_y, sort_order, created_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (str(uuid4()), diagram_id, node["item_id"], node.get("item_kind") or "element_type",
                         float(node["pos_x"]), float(node["pos_y"]), index, now),
                    )
                mark_diagram_updated(connection, diagram_id)
        return self.get_layout(model_id)

    # -------------------------------------------------------- drawn edges

    def list_edges(self, model_id: str | None = None) -> list[dict]:
        sql = _SELECT_DRAWN_EDGE
        params: tuple = ()
        if model_id:
            sql += " WHERE diagram.support_domain_model_id = %s"
            params = (model_id,)
        sql += " ORDER BY edge.created_at, edge.diagram_edge_id"
        with get_connection(self._db_url) as connection:
            return [dict(row) for row in connection.execute(sql, params).fetchall()]

    def get_edge(self, relationship_instance_id: str) -> dict | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                _SELECT_DRAWN_EDGE + " WHERE edge.diagram_edge_id = %s", (relationship_instance_id,)
            ).fetchone()
        return dict(row) if row else None

    def get_relationship(self, relationship_id: str) -> dict | None:
        """The model relationship between element types an edge must draw."""
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                SELECT relationship_id, support_domain_model_id, source_element_id,
                       target_element_id, relationship_type, status
                FROM support_domain_relationship WHERE relationship_id = %s
                """,
                (relationship_id,),
            ).fetchone()
        return dict(row) if row else None

    def get_instance(self, instance_id: str) -> dict | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                SELECT instance_id, support_domain_model_id, element_type_id, name
                FROM support_domain_element_instance WHERE instance_id = %s
                """,
                (instance_id,),
            ).fetchone()
        return dict(row) if row else None

    def edge_exists(self, relationship_id: str, source_instance_id: str, target_instance_id: str) -> bool:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                f"""
                SELECT 1 FROM {DIAGRAM_EDGE_TABLE}
                WHERE support_domain_relationship_id = %s AND source_instance_id = %s AND target_instance_id = %s
                """,
                (relationship_id, source_instance_id, target_instance_id),
            ).fetchone()
        return row is not None

    def create_edge(self, relationship_id: str, model_id: str, source_instance_id: str, target_instance_id: str) -> dict:
        """Draw an edge on the model's diagram, creating the diagram on first use."""
        edge_id = str(uuid4())
        now = utc_now_iso()
        with get_connection(self._db_url) as connection:
            diagram_id = ensure_diagram_id(connection, model_id)
            connection.execute(
                f"""
                INSERT INTO {DIAGRAM_EDGE_TABLE} (
                    diagram_edge_id, diagram_id, edge_key, support_domain_relationship_id,
                    source_instance_id, target_instance_id, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, 'active', %s, %s)
                """,
                (edge_id, diagram_id, diagram_edge_key(relationship_id, source_instance_id, target_instance_id),
                 relationship_id, source_instance_id, target_instance_id, now, now),
            )
            mark_diagram_updated(connection, diagram_id)
        created = self.get_edge(edge_id)
        assert created is not None
        return created

    def delete_edge(self, relationship_instance_id: str) -> bool:
        """Erase an edge. The diagram, and the inferred relationship, stay."""
        with get_connection(self._db_url) as connection:
            cursor = connection.execute(
                f"DELETE FROM {DIAGRAM_EDGE_TABLE} WHERE diagram_edge_id = %s RETURNING diagram_id",
                (relationship_instance_id,),
            )
            removed = cursor.fetchone()
            if removed is not None:
                mark_diagram_updated(connection, removed["diagram_id"])
                return True
            return False
