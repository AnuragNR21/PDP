from __future__ import annotations

import uuid
from typing import Any

from shared.query_builders.cross_model_impact_helpers import (
    delete_cross_model_relationships,
    list_cross_model_relationship_impacts,
)
from shared.model_config import SUPPORT_DOMAIN_MODEL


class SupportDomainModelRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_models(self) -> list[dict]:
        rows = self._db.execute(
            """
            select
                sdm.support_domain_model_id,
                sdm.name,
                sdm.purpose,
                sdm.status,
                sdm.created_at,
                sdm.updated_at,
                count(distinct sde.element_id) as element_count,
                count(distinct sdr.relationship_id) as relationship_count
            from support_domain_model sdm
            left join support_domain_element_type sde on sde.support_domain_model_id = sdm.support_domain_model_id
            left join support_domain_relationship sdr on sdr.support_domain_model_id = sdm.support_domain_model_id
            group by sdm.support_domain_model_id, sdm.name, sdm.purpose, sdm.status, sdm.created_at, sdm.updated_at
            order by sdm.name
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_model(self, model_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                sdm.support_domain_model_id,
                sdm.name,
                sdm.purpose,
                sdm.status,
                sdm.created_at,
                sdm.updated_at,
                count(distinct sde.element_id) as element_count,
                count(distinct sdr.relationship_id) as relationship_count
            from support_domain_model sdm
            left join support_domain_element_type sde on sde.support_domain_model_id = sdm.support_domain_model_id
            left join support_domain_relationship sdr on sdr.support_domain_model_id = sdm.support_domain_model_id
            where sdm.support_domain_model_id = %s
            group by sdm.support_domain_model_id, sdm.name, sdm.purpose, sdm.status, sdm.created_at, sdm.updated_at
            """,
            (model_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_model(self, payload: dict) -> dict:
        model_id = payload.get("support_domain_model_id") or str(uuid.uuid4())
        self._db.execute(
            """
            insert into support_domain_model (
                support_domain_model_id,
                name,
                purpose,
                status,
                created_at,
                updated_at
            )
            values (%s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (model_id, payload["name"], payload["purpose"], payload["status"]),
        )
        self._db.commit()
        return self.get_model(model_id)

    def update_model(self, model_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update support_domain_model
            set name = %s, purpose = %s, status = %s, updated_at = current_timestamp
            where support_domain_model_id = %s
            """,
            (payload["name"], payload["purpose"], payload["status"], model_id),
        )
        self._db.commit()
        return self.get_model(model_id)

    def get_delete_impact(self, model_id: str) -> dict | None:
        model = self.get_model(model_id)
        if model is None:
            return None

        element_rows = self._db.execute(
            """
            select
                element_id,
                name,
                display_name
            from support_domain_element_type
            where support_domain_model_id = %s
            order by sort_order, name
            """,
            (model_id,),
        ).fetchall()
        instance_rows = self._db.execute(
            """
            select
                instance.instance_id,
                instance.element_type_id,
                instance.name as instance_name,
                element.name as element_type_name,
                (model.name || ' -> ' || element.name || ' -> ' || instance.name)::text as instance_path
            from support_domain_element_instance instance
            join support_domain_element_type element on element.element_id = instance.element_type_id
            join support_domain_model model
              on model.support_domain_model_id = instance.support_domain_model_id
            where instance.support_domain_model_id = %s
            order by instance_path
            """,
            (model_id,),
        ).fetchall()

        instance_ids_query = """
            select instance_id
            from support_domain_element_instance
            where support_domain_model_id = %s
        """
        cross_model_relationship_rows = list_cross_model_relationship_impacts(
            self._db,
            instance_type=SUPPORT_DOMAIN_MODEL,
            instance_ids_query=instance_ids_query,
            params=(model_id,),
        )

        return {
            "model_id": str(model["support_domain_model_id"]),
            "model_name": str(model["name"]),
            "element_count": len(element_rows),
            "instance_count": len(instance_rows),
            "cross_model_relationship_count": len(cross_model_relationship_rows),
            "elements": [dict(row) for row in element_rows],
            "element_instances": [dict(row) for row in instance_rows],
            "cross_model_relationships": cross_model_relationship_rows,
        }

    def delete_model(self, model_id: str) -> None:
        delete_cross_model_relationships(
            self._db,
            instance_type=SUPPORT_DOMAIN_MODEL,
            instance_ids_query="""
                select instance_id
                from support_domain_element_instance
                where support_domain_model_id = %s
            """,
            params=(model_id,),
        )
        self._db.execute(
            "delete from support_domain_element_instance where support_domain_model_id = %s",
            (model_id,),
        )
        self._db.execute("delete from support_domain_model where support_domain_model_id = %s", (model_id,))
        self._db.commit()
