from uuid import uuid4

from features.model.domain.badge_constants import BadgeOwnerType
from features.structure.domain.models import (
    CreateCanonicalNodeCommand,
    CreateRelationshipCommand,
    ReorderNodeCommand,
    UpdateCanonicalNodeCommand,
)
from shared.contracts.canonical_types import (
    CanonicalNodeSummary,
    DiagramEdgeSummary,
    DiagramNodeSummary,
    DiagramProjectionSummary,
    MatrixAxisItem,
    MatrixCellSummary,
    MatrixProjectionSummary,
    RelationshipInstanceSummary,
    TreePathItem,
)
from shared.db import get_connection, utc_now_iso
from shared.query_builders.badge_query_helpers import badge_coalesce_text, badge_join
from shared.query_builders.cross_model_impact_helpers import (
    build_cross_model_relationship_impact,
    delete_cross_model_relationships,
    list_cross_model_relationship_impacts,
)
from shared.model_config import HIERARCHY_MODEL


_BADGE_OWNER_TYPE = BadgeOwnerType.HIERARCHY_NODE


# Links between two hierarchy node instances, read from the cross-model
# instance links (source/target_instance_id), named by their relationship type.
_NODE_LINK_SELECT = """
    SELECT r.relationship_id,
           COALESCE(t.name, r.relationship_rule_id) AS semantic_key,
           r.source_instance_id AS source_node_id,
           r.target_instance_id AS target_node_id,
           CASE WHEN r.status IN ('draft', 'active', 'retired') THEN r.status ELSE 'active' END AS status
    FROM cross_model_relationship_instance r
    LEFT JOIN cross_model_relationship_type t ON t.relationship_type_id = r.relationship_rule_id
"""
_NODE_LINK_BOTH_NODES = f"r.source_instance_type = '{HIERARCHY_MODEL}' AND r.target_instance_type = '{HIERARCHY_MODEL}'"


class StructureRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def get_node(self, node_id: str) -> CanonicalNodeSummary | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                f"""
                SELECT
                    n.node_instance_id AS node_id,
                    n.model_id,
                    n.node_type_id,
                    n.name,
                    {badge_coalesce_text('n.name')} AS badge,
                    n.status,
                    n.parent_node_id,
                    n.sort_order
                FROM hierarchy_model_node_instance n
                {badge_join('n.node_type_id', _BADGE_OWNER_TYPE)}
                WHERE n.node_instance_id = %s
                """,
                (node_id,),
            ).fetchone()
        return CanonicalNodeSummary.model_validate(dict(row)) if row else None

    def list_nodes(self, *, parent_node_id: str | None = None) -> list[CanonicalNodeSummary]:
        sql = f"""
            SELECT
                n.node_instance_id AS node_id,
                n.model_id,
                n.node_type_id,
                n.name,
                {badge_coalesce_text('n.name')} AS badge,
                n.status,
                n.parent_node_id,
                n.sort_order
            FROM hierarchy_model_node_instance n
            {badge_join('n.node_type_id', _BADGE_OWNER_TYPE)}
        """
        params: list[str] = []
        if parent_node_id is None:
            sql += " WHERE n.parent_node_id IS NULL"
        else:
            sql += " WHERE n.parent_node_id = %s"
            params.append(parent_node_id)
        sql += " ORDER BY n.sort_order, n.name"
        with get_connection(self._db_url) as connection:
            rows = connection.execute(sql, params).fetchall()
        return [CanonicalNodeSummary.model_validate(dict(row)) for row in rows]

    def list_nodes_for_model(self, model_id: str) -> list[CanonicalNodeSummary]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                f"""
                SELECT
                    n.node_instance_id AS node_id,
                    n.model_id,
                    n.node_type_id,
                    n.name,
                    {badge_coalesce_text('n.name')} AS badge,
                    n.status,
                    n.parent_node_id,
                    n.sort_order
                FROM hierarchy_model_node_instance n
                {badge_join('n.node_type_id', _BADGE_OWNER_TYPE)}
                WHERE n.model_id = %s
                ORDER BY n.sort_order, n.name
                """,
                (model_id,),
            ).fetchall()
        return [CanonicalNodeSummary.model_validate(dict(row)) for row in rows]

    def get_path(self, node_id: str) -> list[TreePathItem]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                f"""
                WITH RECURSIVE ancestry(node_id, name, node_type_id, badge, depth, parent_node_id) AS (
                    SELECT n.node_instance_id AS node_id, n.name, n.node_type_id, {badge_coalesce_text('n.name')}, 0, n.parent_node_id
                    FROM hierarchy_model_node_instance n
                    {badge_join('n.node_type_id', _BADGE_OWNER_TYPE)}
                    WHERE n.node_instance_id = %s
                    UNION ALL
                    SELECT parent.node_instance_id AS node_id, parent.name, parent.node_type_id, {badge_coalesce_text('parent.name', 'pbs')}, ancestry.depth + 1, parent.parent_node_id
                    FROM ancestry
                    JOIN hierarchy_model_node_instance parent ON parent.node_instance_id = ancestry.parent_node_id
                    {badge_join('parent.node_type_id', _BADGE_OWNER_TYPE, 'pbs')}
                )
                SELECT node_id, name, node_type_id, badge, depth
                FROM ancestry
                ORDER BY depth DESC
                """,
                (node_id,),
            ).fetchall()
        return [
            TreePathItem(
                node_id=row["node_id"],
                name=row["name"],
                node_type_id=row["node_type_id"],
                badge=row["badge"],
                depth=index,
            )
            for index, row in enumerate(rows)
        ]

    def list_relationships_for_node(self, node_id: str) -> list[RelationshipInstanceSummary]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                f"""
                {_NODE_LINK_SELECT}
                WHERE {_NODE_LINK_BOTH_NODES} AND (r.source_instance_id = %s OR r.target_instance_id = %s)
                ORDER BY r.created_at, r.relationship_id
                """,
                (node_id, node_id),
            ).fetchall()
        return [RelationshipInstanceSummary.model_validate(dict(row)) for row in rows]

    def list_relationships_for_model(self, model_id: str) -> list[RelationshipInstanceSummary]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                f"""
                {_NODE_LINK_SELECT}
                JOIN hierarchy_model_node_instance source ON source.node_instance_id = r.source_instance_id
                JOIN hierarchy_model_node_instance target ON target.node_instance_id = r.target_instance_id
                WHERE {_NODE_LINK_BOTH_NODES} AND source.model_id = %s AND target.model_id = %s
                ORDER BY r.created_at, r.relationship_id
                """,
                (model_id, model_id),
            ).fetchall()
        return [RelationshipInstanceSummary.model_validate(dict(row)) for row in rows]

    def build_diagram_projection(self, model_id: str) -> DiagramProjectionSummary:
        nodes = self.list_nodes_for_model(model_id)
        if not nodes:
            return DiagramProjectionSummary(model_id=model_id, nodes=[], edges=[])

        levels = {node.node_id: len(self.get_path(node.node_id)) - 1 for node in nodes}
        grouped: dict[int, list[CanonicalNodeSummary]] = {}
        for node in nodes:
            grouped.setdefault(levels[node.node_id], []).append(node)
        for group in grouped.values():
            group.sort(key=lambda item: ((item.sort_order or 0), item.name))

        diagram_nodes: list[DiagramNodeSummary] = []
        for level, items in sorted(grouped.items()):
            for index, item in enumerate(items):
                diagram_nodes.append(
                    DiagramNodeSummary(
                        node_id=item.node_id,
                        model_id=item.model_id,
                        node_type_id=item.node_type_id,
                        name=item.name,
                        badge=item.badge,
                        level=level,
                        x=level * 280,
                        y=index * 120,
                    )
                )

        edges: list[DiagramEdgeSummary] = []
        for node in nodes:
            if node.parent_node_id:
                edges.append(
                    DiagramEdgeSummary(
                        edge_id=f"hierarchy::{node.parent_node_id}::{node.node_id}",
                        source_node_id=node.parent_node_id,
                        target_node_id=node.node_id,
                        semantic_key='parent_child',
                        projection_kind='hierarchy',
                    )
                )
        for relationship in self.list_relationships_for_model(model_id):
            edges.append(
                DiagramEdgeSummary(
                    edge_id=relationship.relationship_id,
                    source_node_id=relationship.source_node_id,
                    target_node_id=relationship.target_node_id,
                    semantic_key=relationship.semantic_key,
                    projection_kind='relationship',
                )
            )
        return DiagramProjectionSummary(model_id=model_id, nodes=diagram_nodes, edges=edges)

    def build_matrix_projection(self, model_id: str) -> MatrixProjectionSummary:
        nodes = self.list_nodes_for_model(model_id)
        entity_rows = [
            MatrixAxisItem(node_id=node.node_id, name=node.name, node_type_id=node.node_type_id, badge=node.badge)
            for node in nodes
            if node.node_type_id == 'nt_entity'
        ]
        attribute_columns = [
            MatrixAxisItem(node_id=node.node_id, name=node.name, node_type_id=node.node_type_id, badge=node.badge)
            for node in nodes
            if node.node_type_id == 'nt_attribute'
        ]
        relationship_index: dict[tuple[str, str], RelationshipInstanceSummary] = {}
        for relationship in self.list_relationships_for_model(model_id):
            relationship_index[(relationship.source_node_id, relationship.target_node_id)] = relationship

        hierarchy_children: dict[str, set[str]] = {}
        for node in nodes:
            if node.parent_node_id:
                hierarchy_children.setdefault(node.parent_node_id, set()).add(node.node_id)

        cells: list[MatrixCellSummary] = []
        for row in entity_rows:
            child_attributes = hierarchy_children.get(row.node_id, set())
            for column in attribute_columns:
                relationship = relationship_index.get((row.node_id, column.node_id))
                linked = column.node_id in child_attributes or relationship is not None
                cells.append(
                    MatrixCellSummary(
                        row_node_id=row.node_id,
                        column_node_id=column.node_id,
                        relationship_id=relationship.relationship_id if relationship else None,
                        semantic_key=relationship.semantic_key if relationship else ('parent_child' if column.node_id in child_attributes else None),
                        linked=linked,
                    )
                )
        return MatrixProjectionSummary(model_id=model_id, rows=entity_rows, columns=attribute_columns, cells=cells)

    def create_node(self, command: CreateCanonicalNodeCommand) -> CanonicalNodeSummary:
        now = utc_now_iso()
        node_id = f"node_{uuid4().hex[:12]}"
        
        # Calculate sort_order based on existing siblings
        sort_order = 0
        if command.parent_node_id is not None:
            with get_connection(self._db_url) as connection:
                current_max = connection.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM hierarchy_model_node_instance WHERE parent_node_id = %s",
                    (command.parent_node_id,),
                ).fetchone()["max_sort"]
                sort_order = int(current_max) + 1
        
        with get_connection(self._db_url) as connection:
            connection.execute(
                """
                INSERT INTO hierarchy_model_node_instance (
                    node_instance_id, model_id, node_type_id, name, parent_node_id, sort_order, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, 'active', %s, %s)
                """,
                (node_id, command.model_id, command.node_type_id, command.name.strip(), command.parent_node_id, sort_order, now, now),
            )

        return CanonicalNodeSummary(
            node_id=node_id,
            model_id=command.model_id,
            node_type_id=command.node_type_id,
            name=command.name.strip(),
            badge=self.get_badge_for_node_type(command.node_type_id, fallback=command.name.strip()),
            status='active',
            parent_node_id=command.parent_node_id,
            sort_order=sort_order,
        )

    def update_node(self, node_id: str, command: UpdateCanonicalNodeCommand) -> CanonicalNodeSummary:
        with get_connection(self._db_url) as connection:
            cursor = connection.execute(
                "UPDATE hierarchy_model_node_instance SET name = %s, status = COALESCE(%s, status), updated_at = %s WHERE node_instance_id = %s",
                (command.name.strip(), command.status, utc_now_iso(), node_id),
            )
            if cursor.rowcount == 0:
                raise ValueError('Node was not found.')
        node = self.get_node(node_id)
        if node is None:
            raise ValueError('Node was not found.')
        return node

    def delete_node(self, node_id: str) -> None:
        with get_connection(self._db_url) as connection:
            delete_cross_model_relationships(
                connection,
                instance_type=HIERARCHY_MODEL,
                instance_ids_query="""
                    WITH RECURSIVE affected_instances(node_instance_id) AS (
                        SELECT node_instance_id
                        FROM hierarchy_model_node_instance
                        WHERE node_instance_id = %s
                        UNION ALL
                        SELECT child.node_instance_id
                        FROM hierarchy_model_node_instance child
                        JOIN affected_instances parent
                          ON parent.node_instance_id = child.parent_node_id
                    )
                    SELECT node_instance_id FROM affected_instances
                """,
                params=(node_id,),
            )
            cursor = connection.execute(
                'DELETE FROM hierarchy_model_node_instance WHERE node_instance_id = %s',
                (node_id,),
            )
            if cursor.rowcount == 0:
                raise ValueError('Node was not found.')

    def delete_node_instance(self, node_id: str) -> None:
        with get_connection(self._db_url) as connection:
            selected_row = connection.execute(
                """
                SELECT node_instance_id
                FROM hierarchy_model_node_instance
                WHERE node_instance_id = %s
                """,
                (node_id,),
            ).fetchone()
            if selected_row is None:
                raise ValueError('Node was not found.')

            connection.execute(
                """
                WITH RECURSIVE node_instances_to_delete AS (
                    SELECT node_instance_id
                    FROM hierarchy_model_node_instance
                    WHERE node_instance_id = %s
                    UNION ALL
                    SELECT child.node_instance_id
                    FROM hierarchy_model_node_instance child
                    JOIN node_instances_to_delete parent ON parent.node_instance_id = child.parent_node_id
                )
                DELETE FROM cross_model_relationship_instance
                WHERE source_instance_id IN (SELECT node_instance_id FROM node_instances_to_delete)
                   OR target_instance_id IN (SELECT node_instance_id FROM node_instances_to_delete)
                """,
                (node_id,),
            )
            connection.execute(
                """
                DELETE FROM hierarchy_model_node_instance
                WHERE node_instance_id = %s
                """,
                (node_id,),
            )

    def reparent_node(
        self,
        *,
        node_id: str,
        new_parent_node_id: str | None,
        requested_position: int | None,
    ) -> CanonicalNodeSummary:
        now = utc_now_iso()
        with get_connection(self._db_url) as connection:
            if requested_position is None:
                if new_parent_node_id is not None:
                    current_max = connection.scalar(
                        'SELECT COALESCE(MAX(sort_order), -1) FROM hierarchy_model_node_instance WHERE parent_node_id = %s',
                        (new_parent_node_id,),
                    )
                    requested_position = int(current_max) + 1
                else:
                    requested_position = 0
            
            connection.execute(
                """
                UPDATE hierarchy_model_node_instance
                SET parent_node_id = %s, sort_order = %s, updated_at = %s
                WHERE node_instance_id = %s
                """,
                (new_parent_node_id, requested_position, now, node_id),
            )
        node = self.get_node(node_id)
        if node is None:
            raise ValueError('Node was not found.')
        return node

    def reorder_siblings(self, command: ReorderNodeCommand) -> list[CanonicalNodeSummary]:
        with get_connection(self._db_url) as connection:
            if command.parent_node_id is None:
                raise ValueError('Root reorder is not implemented in Increment 2.')
            rows = connection.execute(
                'SELECT node_instance_id FROM hierarchy_model_node_instance WHERE parent_node_id = %s',
                (command.parent_node_id,),
            ).fetchall()
            existing_child_ids = {row['node_instance_id'] for row in rows}
            if existing_child_ids != set(command.ordered_child_node_ids):
                raise ValueError('Ordered child set does not match current sibling set.')
            for index, child_node_id in enumerate(command.ordered_child_node_ids, start=1):
                connection.execute(
                    """
                    UPDATE hierarchy_model_node_instance
                    SET sort_order = %s
                    WHERE node_instance_id = %s
                    """,
                    (index, child_node_id),
                )
        return self.list_nodes(parent_node_id=command.parent_node_id)

    def create_relationship(self, command: CreateRelationshipCommand) -> RelationshipInstanceSummary:
        relationship_id = f'rel_{uuid4().hex[:12]}'
        with get_connection(self._db_url) as connection:
            connection.execute(
                """
                INSERT INTO cross_model_relationship_instance (
                    relationship_id, semantic_key, source_node_id, target_node_id, status, created_at
                ) VALUES (%s, %s, %s, %s, 'active', %s)
                """,
                (relationship_id, command.semantic_key.strip(), command.source_node_id, command.target_node_id, utc_now_iso()),
            )
        return RelationshipInstanceSummary(
            relationship_id=relationship_id,
            semantic_key=command.semantic_key.strip(),
            source_node_id=command.source_node_id,
            target_node_id=command.target_node_id,
            status='active',
        )

    def delete_relationship(self, relationship_id: str) -> None:
        with get_connection(self._db_url) as connection:
            cursor = connection.execute('DELETE FROM cross_model_relationship_instance WHERE relationship_id = %s', (relationship_id,))
            if cursor.rowcount == 0:
                raise ValueError('Relationship was not found.')

    def node_exists(self, node_id: str) -> bool:
        return self.get_node(node_id) is not None

    def has_path(self, ancestor_node_id: str, descendant_node_id: str) -> bool:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                WITH RECURSIVE traversal(node_id, parent_node_id) AS (
                    SELECT node_instance_id, parent_node_id
                    FROM hierarchy_model_node_instance
                    WHERE parent_node_id = %s
                    UNION ALL
                    SELECT n.node_instance_id, n.parent_node_id
                    FROM hierarchy_model_node_instance n
                    JOIN traversal tr ON tr.node_id = n.parent_node_id
                )
                SELECT 1
                FROM traversal
                WHERE node_id = %s
                LIMIT 1
                """,
                (ancestor_node_id, descendant_node_id),
            ).fetchone()
        return row is not None

    def get_model_id(self, node_id: str) -> str | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT model_id FROM hierarchy_model_node_instance WHERE node_instance_id = %s', (node_id,)).fetchone()
        return None if row is None else str(row['model_id'])

    def get_node_type_id(self, node_id: str) -> str | None:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT node_type_id FROM hierarchy_model_node_instance WHERE node_instance_id = %s', (node_id,)).fetchone()
        return None if row is None else str(row['node_type_id'])

    def get_badge_for_node_type(self, node_type_id: str, *, fallback: str) -> str:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                SELECT badge_text
                FROM badge_store
                WHERE owner_entity_id = %s
                  AND owner_entity_type = %s
                """,
                (node_type_id, _BADGE_OWNER_TYPE),
            ).fetchone()
        return fallback if row is None else str(row['badge_text'])

    def get_node_type_status(self, node_type_id: str) -> str | None:
        """Get the status of a node type. Returns None if node type doesn't exist."""
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                'SELECT status FROM hierarchy_model_node_type WHERE node_type_id = %s',
                (node_type_id,)
            ).fetchone()
        return None if row is None else str(row['status'])

    def node_type_is_property(self, node_type_id: str) -> bool:
        """
        Whether this node type holds a value rather than a level.

        Read from the type rather than carried on the instance: a property
        node type is a leaf everywhere, in every model that uses it, and a
        copy on the instance is a copy that can go stale.
        """
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                'SELECT is_property FROM hierarchy_model_node_type WHERE node_type_id = %s',
                (node_type_id,),
            ).fetchone()
        return bool(row and row['is_property'])

    def get_active_parent_child_rule(
        self,
        *,
        model_id: str,
        parent_node_type_id: str,
        child_node_type_id: str,
    ) -> dict | None:
        with get_connection(self._db_url) as connection:
            return connection.execute(
                """
                SELECT 1
                FROM structural_rule
                WHERE model_id = %s
                  AND parent_node_type_id = %s
                  AND child_node_type_id = %s
                  AND relationship_kind IN ('parent_child', 'recursive')
                  AND status = 'active'
                """,
                (model_id, parent_node_type_id, child_node_type_id),
            ).fetchone()

    def get_root_node_type_for_model(self, model_id: str) -> dict | None:
        """Return the root node type (parent_node_type_id IS NULL) for a model."""
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                """
                SELECT node_type_id, model_id, name
                FROM hierarchy_model_node_type
                WHERE model_id = %s AND parent_node_type_id IS NULL
                LIMIT 1
                """,
                (model_id,),
            ).fetchone()
        return dict(row) if row else None

    def get_root_instance_for_model(self, model_id: str) -> CanonicalNodeSummary | None:
        """Return the root node instance (parent_node_id IS NULL) for a model."""
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                f"""
                SELECT
                    n.node_instance_id AS node_id,
                    n.model_id,
                    n.node_type_id,
                    n.name,
                    {badge_coalesce_text('n.name')} AS badge,
                    n.status,
                    n.parent_node_id,
                    n.sort_order
                FROM hierarchy_model_node_instance n
                {badge_join('n.node_type_id', _BADGE_OWNER_TYPE)}
                WHERE n.model_id = %s AND n.parent_node_id IS NULL
                LIMIT 1
                """,
                (model_id,),
            ).fetchone()
        return CanonicalNodeSummary.model_validate(dict(row)) if row else None

    def get_node_delete_impact(self, node_id: str) -> dict | None:
        with get_connection(self._db_url) as connection:
            selected_row = connection.execute(
                """
                SELECT
                    n.node_instance_id,
                    n.model_id,
                    n.node_type_id,
                    n.name,
                    n.parent_node_id,
                    m.name AS model_name
                FROM hierarchy_model_node_instance n
                JOIN hierarchy_model m ON m.model_id = n.model_id
                WHERE n.node_instance_id = %s
                """,
                (node_id,),
            ).fetchone()
            if selected_row is None:
                return None

            model_id = str(selected_row["model_id"])
            is_root = selected_row["parent_node_id"] is None
            instance_rows = connection.execute(
                """
                with recursive instance_paths as (
                    select
                        i.node_instance_id,
                        i.node_type_id,
                        i.parent_node_id,
                        i.name,
                        nt.name as node_name,
                        i.name::text as instance_path
                    from hierarchy_model_node_instance i
                    join hierarchy_model_node_type nt on nt.node_type_id = i.node_type_id
                    where i.node_instance_id = %s
                    union all
                    select
                        child.node_instance_id,
                        child.node_type_id,
                        child.parent_node_id,
                        child.name,
                        nt.name as node_name,
                        (parent.instance_path || ' -> ' || child.name)::text as instance_path
                    from hierarchy_model_node_instance child
                    join instance_paths parent on parent.node_instance_id = child.parent_node_id
                    join hierarchy_model_node_type nt on nt.node_type_id = child.node_type_id
                )
                select
                    node_instance_id as instance_id,
                    node_type_id as node_id,
                    parent_node_id,
                    name as instance_name,
                    node_name,
                    instance_path
                from instance_paths
                order by instance_path
                """,
                (node_id,),
            ).fetchall()
            node_rows = connection.execute(
                """
                with recursive impacted_instances as (
                    select node_instance_id, node_type_id
                    from hierarchy_model_node_instance
                    where node_instance_id = %s
                    union all
                    select child.node_instance_id, child.node_type_id
                    from hierarchy_model_node_instance child
                    join impacted_instances parent on parent.node_instance_id = child.parent_node_id
                ),
                node_paths as (
                    select
                        n.node_type_id,
                        n.parent_node_type_id,
                        n.name,
                        n.display_name,
                        n.name::text as node_path
                    from hierarchy_model_node_type n
                    where n.model_id = %s
                      and n.parent_node_type_id is null
                    union all
                    select
                        child.node_type_id,
                        child.parent_node_type_id,
                        child.name,
                        child.display_name,
                        (parent.node_path || ' -> ' || child.name)::text as node_path
                    from hierarchy_model_node_type child
                    join node_paths parent on parent.node_type_id = child.parent_node_type_id
                )
                select
                    node_type_id as node_id,
                    parent_node_type_id as parent_node_id,
                    name,
                    display_name,
                    node_path
                from node_paths
                where node_type_id in (select node_type_id from impacted_instances)
                order by node_path
                """,
                (node_id, model_id),
            ).fetchall()
            cross_model_relationship_rows = list_cross_model_relationship_impacts(
                connection,
                instance_type=HIERARCHY_MODEL,
                instance_ids_query="""
                    WITH RECURSIVE affected_instances(node_instance_id) AS (
                        SELECT node_instance_id
                        FROM hierarchy_model_node_instance
                        WHERE node_instance_id = %s
                        UNION ALL
                        SELECT child.node_instance_id
                        FROM hierarchy_model_node_instance child
                        JOIN affected_instances parent
                          ON parent.node_instance_id = child.parent_node_id
                    )
                    SELECT node_instance_id FROM affected_instances
                """,
                params=(node_id,),
            )
            diagram_node_count = int(
                connection.scalar(
                    """
                    with recursive impacted_instances as (
                        select node_instance_id
                        from hierarchy_model_node_instance
                        where node_instance_id = %s
                        union all
                        select child.node_instance_id
                        from hierarchy_model_node_instance child
                        join impacted_instances parent on parent.node_instance_id = child.parent_node_id
                    )
                    select count(*)
                    from structure_diagram_node
                    where node_id in (select node_instance_id from impacted_instances)
                    """,
                    (node_id,),
                )
            )
            diagram_edge_count = int(
                connection.scalar(
                    """
                    with recursive impacted_instances as (
                        select node_instance_id
                        from hierarchy_model_node_instance
                        where node_instance_id = %s
                        union all
                        select child.node_instance_id
                        from hierarchy_model_node_instance child
                        join impacted_instances parent on parent.node_instance_id = child.parent_node_id
                    )
                    select count(*)
                    from structure_diagram_edge
                    where source_node_id in (select node_instance_id from impacted_instances)
                       or target_node_id in (select node_instance_id from impacted_instances)
                    """,
                    (node_id,),
                )
            )

        return {
            "node_instance_id": str(selected_row["node_instance_id"]),
            "is_root": is_root,
            "model_id": model_id,
            "model_name": str(selected_row["model_name"]),
            "node_count": len(node_rows),
            "instance_count": len(instance_rows),
            "relationship_count": len(cross_model_relationship_rows),
            "diagram_node_count": diagram_node_count,
            "diagram_edge_count": diagram_edge_count,
            "nodes": [dict(row) for row in node_rows],
            "node_instances": [dict(row) for row in instance_rows],
            "cross_model_relationship_impact": build_cross_model_relationship_impact(cross_model_relationship_rows),
        }

    def delete_hierarchy_model_by_root_instance(self, node_id: str) -> None:
        with get_connection(self._db_url) as connection:
            root_row = connection.execute(
                """
                SELECT model_id
                FROM hierarchy_model_node_instance
                WHERE node_instance_id = %s
                  AND parent_node_id IS NULL
                """,
                (node_id,),
            ).fetchone()
            if root_row is None:
                raise ValueError('Governed delete is only available for the root node instance.')

            model_id = str(root_row["model_id"])
            delete_cross_model_relationships(
                connection,
                instance_type=HIERARCHY_MODEL,
                instance_ids_query="""
                    SELECT node_instance_id
                    FROM hierarchy_model_node_instance
                    WHERE model_id = %s
                """,
                params=(model_id,),
            )
            connection.execute(
                "DELETE FROM hierarchy_model_node_instance WHERE model_id = %s",
                (model_id,),
            )
            connection.execute(
                "DELETE FROM structural_rule WHERE model_id = %s",
                (model_id,),
            )
            connection.execute(
                "DELETE FROM hierarchy_model_node_type WHERE model_id = %s",
                (model_id,),
            )
            connection.execute(
                "DELETE FROM hierarchy_model WHERE model_id = %s",
                (model_id,),
            )

    def create_root_instance(self, *, model_id: str, node_type_id: str, name: str) -> CanonicalNodeSummary:
        """Insert the root node instance for a model."""
        node_id = f"node_{model_id}_root"
        now = utc_now_iso()
        with get_connection(self._db_url) as connection:
            connection.execute(
                """
                INSERT INTO hierarchy_model_node_instance
                    (node_instance_id, model_id, node_type_id, name, description,
                     parent_node_id, sort_order, status, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, NULL, 0, 'active', %s, %s)
                ON CONFLICT (node_instance_id) DO NOTHING
                """,
                (node_id, model_id, node_type_id, name, "", now, now),
            )
        return self.get_node(node_id)
