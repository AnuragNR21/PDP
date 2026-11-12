from __future__ import annotations

import uuid
from typing import Any

from shared.query_builders.cross_model_impact_helpers import (
    delete_cross_model_relationships,
    list_cross_model_relationship_impacts,
)
from shared.model_config import HIERARCHY_MODEL


class HierarchyModelRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_models(self) -> list[dict]:
        rows = self._db.execute(
            """
            select
                sm.model_id,
                sm.name,
                sm.purpose,
                sm.owning_domain,
                sm.status,
                sm.created_at,
                sm.updated_at,
                count(distinct sn.node_type_id) as node_count,
                count(distinct sr.rule_id) as rule_count
            from hierarchy_model sm
            left join hierarchy_model_node_type sn on sn.model_id = sm.model_id
            left join structural_rule sr on sr.model_id = sm.model_id
            group by sm.model_id, sm.name, sm.purpose, sm.owning_domain, sm.status, sm.created_at, sm.updated_at
            order by sm.name
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_model(self, model_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                sm.model_id,
                sm.name,
                sm.purpose,
                sm.owning_domain,
                sm.status,
                sm.created_at,
                sm.updated_at,
                count(distinct sn.node_type_id) as node_count,
                count(distinct sr.rule_id) as rule_count
            from hierarchy_model sm
            left join hierarchy_model_node_type sn on sn.model_id = sm.model_id
            left join structural_rule sr on sr.model_id = sm.model_id
            where sm.model_id = %s
            group by sm.model_id, sm.name, sm.purpose, sm.owning_domain, sm.status, sm.created_at, sm.updated_at
            """,
            (model_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_model(self, payload: dict) -> dict:
        model_id = payload.get("model_id") or str(uuid.uuid4())
        self._db.execute(
            """
            insert into hierarchy_model (
                model_id,
                name,
                purpose,
                owning_domain,
                status,
                created_at,
                updated_at
            )
            values (%s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (
                model_id,
                payload["name"],
                payload["purpose"],
                payload["owning_domain"],
                payload["status"],
            ),
        )
        self._db.commit()
        return self.get_model(model_id)

    def update_model(self, model_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update hierarchy_model
            set name = %s, purpose = %s, owning_domain = %s, status = %s, updated_at = current_timestamp
            where model_id = %s
            """,
            (payload["name"], payload["purpose"], payload["owning_domain"], payload["status"], model_id),
        )
        self._db.commit()
        return self.get_model(model_id)

    def get_delete_impact(self, model_id: str) -> dict | None:
        model = self.get_model(model_id)
        if model is None:
            return None

        node_rows = self._db.execute(
            """
            with recursive node_paths as (
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
            order by node_path
            """,
            (model_id,),
        ).fetchall()

        instance_rows = self._db.execute(
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
                where i.model_id = %s
                  and i.parent_node_id is null
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
            (model_id,),
        ).fetchall()

        instance_ids_query = """
            select node_instance_id
            from hierarchy_model_node_instance
            where model_id = %s
        """
        cross_model_relationship_rows = list_cross_model_relationship_impacts(
            self._db,
            instance_type=HIERARCHY_MODEL,
            instance_ids_query=instance_ids_query,
            params=(model_id,),
        )

        return {
            "model_id": str(model["model_id"]),
            "model_name": str(model["name"]),
            "node_count": len(node_rows),
            "instance_count": len(instance_rows),
            "cross_model_relationship_count": len(cross_model_relationship_rows),
            "nodes": [dict(row) for row in node_rows],
            "node_instances": [dict(row) for row in instance_rows],
            "cross_model_relationships": cross_model_relationship_rows,
        }

    def delete_model(self, model_id: str) -> None:
        delete_cross_model_relationships(
            self._db,
            instance_type=HIERARCHY_MODEL,
            instance_ids_query="""
                select node_instance_id
                from hierarchy_model_node_instance
                where model_id = %s
            """,
            params=(model_id,),
        )
        self._db.execute(
            "delete from hierarchy_model_node_instance where model_id = %s",
            (model_id,),
        )
        self._db.execute(
            "delete from structural_rule where model_id = %s",
            (model_id,),
        )
        self._db.execute(
            "delete from hierarchy_model_node_type where model_id = %s",
            (model_id,),
        )
        self._db.execute("delete from hierarchy_model where model_id = %s", (model_id,))
        self._db.commit()
