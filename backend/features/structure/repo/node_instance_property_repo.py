from __future__ import annotations

import uuid
from typing import Any


class NodeInstancePropertyRepo:
    """CRUD for hierarchy_model_node_instance_property."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def list_for_instance(self, node_instance_id: str) -> list[dict]:
        """Return effective property definitions for a node instance (read-only, no values)."""
        rows = self._db.execute(
            """
            with recursive type_chain(node_type_id, depth) as (
                select i.node_type_id, 0
                from hierarchy_model_node_instance i
                where i.node_instance_id = %s
                union all
                select n.parent_node_type_id, type_chain.depth + 1
                from hierarchy_model_node_type n
                join type_chain on n.node_type_id = type_chain.node_type_id
                where n.parent_node_type_id is not null
            )
            select
                pt.property_id,
                pt.name as property_name,
                coalesce(pt.description, '') as property_description,
                pt.status as property_status,
                case when type_chain.depth = 0 then 'defined' else 'inherited' end as origin,
                case when type_chain.depth = 0 then null else coalesce(nullif(src.display_name, ''), src.name) end as inherited_from,
                pt.node_type_id as source_node_type_id,
                coalesce(nullif(src.display_name, ''), src.name) as source_node_type_name,
                type_chain.depth as inheritance_distance,
                pt.inheritable,
                v.value,
                v.updated_at as value_updated_at
            from hierarchy_model_node_type_property pt
            join type_chain on type_chain.node_type_id = pt.node_type_id
            join hierarchy_model_node_type src on src.node_type_id = pt.node_type_id
            left join node_instance_property_value v
                on v.node_instance_id = %s and v.property_id = pt.property_id
            where type_chain.depth = 0
               or (
                    pt.inheritable = true
               )
            order by lower(pt.name), type_chain.depth, src.name
            """,
            (node_instance_id, node_instance_id),
        ).fetchall()
        return [dict(r) for r in rows]

    def get(self, property_instance_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                ip.property_instance_id,
                ip.node_instance_id,
                ip.property_type_id,
                pt.name          as property_name,
                pt.description   as property_description,
                pt.status        as property_status,
                ip.created_at,
                ip.updated_at
            from hierarchy_model_node_instance_property ip
            join hierarchy_model_node_type_property pt
                on pt.property_id = ip.property_type_id
            where ip.property_instance_id = %s
            """,
            (property_instance_id,),
        ).fetchone()
        return dict(row) if row else None

    def upsert(self, node_instance_id: str, property_type_id: str) -> dict:
        """Insert or update the property assignment for a node instance."""
        existing = self._db.execute(
            """
            select property_instance_id
            from hierarchy_model_node_instance_property
            where node_instance_id = %s and property_type_id = %s
            """,
            (node_instance_id, property_type_id),
        ).fetchone()

        if existing:
            pid = dict(existing)["property_instance_id"]
            self._db.execute(
                """
                update hierarchy_model_node_instance_property
                set updated_at = current_timestamp
                where property_instance_id = %s
                """,
                (pid,),
            )
        else:
            pid = str(uuid.uuid4())
            self._db.execute(
                """
                insert into hierarchy_model_node_instance_property
                    (property_instance_id, node_instance_id, property_type_id,
                     created_at, updated_at)
                values (%s, %s, %s, current_timestamp, current_timestamp)
                """,
                (pid, node_instance_id, property_type_id),
            )
        self._db.commit()
        return self.get(pid)

    def delete(self, property_instance_id: str) -> None:
        self._db.execute(
            "delete from hierarchy_model_node_instance_property where property_instance_id = %s",
            (property_instance_id,),
        )
        self._db.commit()

    def set_value(self, node_instance_id: str, property_id: str, value: str | None) -> None:
        """Store (or, with no value, clear) this instance's value for the property."""
        if value is None:
            self._db.execute(
                "delete from node_instance_property_value where node_instance_id = %s and property_id = %s",
                (node_instance_id, property_id),
            )
            return
        self._db.execute(
            """
            insert into node_instance_property_value
                (property_value_id, node_instance_id, property_id, value, created_at, updated_at)
            values (%s, %s, %s, %s, current_timestamp, current_timestamp)
            on conflict (node_instance_id, property_id)
            do update set value = excluded.value, updated_at = current_timestamp
            """,
            (str(uuid.uuid4()), node_instance_id, property_id, value),
        )
