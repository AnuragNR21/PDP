from __future__ import annotations

import uuid
from typing import Any


class HierarchyModelNodeTypePropertyRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_properties(self, *, node_type_id: str) -> list[dict]:
        rows = self._db.execute(
            """
            select
                property_id,
                node_type_id,
                name,
                description,
                inheritable,
                status,
                created_at,
                updated_at
            from hierarchy_model_node_type_property
            where node_type_id = %s
            order by name
            """,
            (node_type_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_property(self, property_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                property_id,
                node_type_id,
                name,
                description,
                inheritable,
                status,
                created_at,
                updated_at
            from hierarchy_model_node_type_property
            where property_id = %s
            """,
            (property_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_property(self, payload: dict) -> dict:
        property_id = payload.get("property_id") or str(uuid.uuid4())
        self._db.execute(
            """
            insert into hierarchy_model_node_type_property (
                property_id,
                node_type_id,
                name,
                description,
                inheritable,
                status,
                created_at,
                updated_at
            ) values (%s, %s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (
                property_id,
                payload["node_type_id"],
                payload["name"],
                payload.get("description", ""),
                payload.get("inheritable", False),
                payload["status"],
            ),
        )
        self._db.commit()
        return self.get_property(property_id)

    def update_property(self, property_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update hierarchy_model_node_type_property
            set node_type_id = %s,
                name = %s,
                description = %s,
                inheritable = %s,
                status = %s,
                updated_at = current_timestamp
            where property_id = %s
            """,
            (
                payload["node_type_id"],
                payload["name"],
                payload.get("description", ""),
                payload.get("inheritable", False),
                payload["status"],
                property_id,
            ),
        )
        self._db.commit()
        return self.get_property(property_id)

    def get_delete_impact(self, property_id: str, *, max_node_types: int = 30) -> dict | None:
        prop = self.get_property(property_id)
        if prop is None:
            return None

        inheritable = bool(prop.get("inheritable"))

        rows = self._db.execute(
            """
            with recursive descendants(node_type_id, depth) as (
                select node_type_id, 0
                from hierarchy_model_node_type
                where node_type_id = %s
                union all
                select child.node_type_id, descendants.depth + 1
                from hierarchy_model_node_type child
                join descendants on child.parent_node_type_id = descendants.node_type_id
            )
            select
                d.node_type_id,
                n.name as node_type_name,
                d.depth,
                (
                    select count(*)
                    from hierarchy_model_node_instance i
                    where i.node_type_id = d.node_type_id
                ) as instance_count
            from descendants d
            join hierarchy_model_node_type n on n.node_type_id = d.node_type_id
            where d.depth = 0
               or (
                    %s = true
               )
            order by d.depth, n.name
            """,
                (prop["node_type_id"], inheritable),
        ).fetchall()
        affected_node_types = [dict(row) for row in rows]

        return {
            "property_id": prop["property_id"],
            "property_name": prop["name"],
            "node_type_id": prop["node_type_id"],
            "inheritable": inheritable,
            "affected_node_type_count": len(affected_node_types),
            "affected_instance_count": sum(int(item.get("instance_count") or 0) for item in affected_node_types),
            "affected_node_types": affected_node_types[:max_node_types],
            "truncated": len(affected_node_types) > max_node_types,
        }

    def delete_property(self, property_id: str) -> None:
        self._db.execute("delete from hierarchy_model_node_type_property where property_id = %s", (property_id,))
        self._db.commit()
