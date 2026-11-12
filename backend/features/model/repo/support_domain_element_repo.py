from __future__ import annotations

import uuid
from typing import Any

from shared.query_builders.badge_query_helpers import (
    badge_coalesce_text,
    badge_join,
    badge_select_columns,
)
from shared.query_builders.cross_model_impact_helpers import (
    delete_cross_model_relationships,
    list_cross_model_relationship_impacts,
)
from shared.model_config import SUPPORT_DOMAIN_MODEL
from ..domain.badge_constants import BadgeOwnerType

_BADGE_OWNER_TYPE = BadgeOwnerType.SUPPORT_ELEMENT


class SupportDomainElementRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_elements(self, *, model_id: str) -> list[dict]:
        rows = self._db.execute(
            f"""
            select
                sde.element_id,
                sde.support_domain_model_id,
                sde.support_domain_model_id as model_id,
                sde.name,
                sde.display_name,
                {badge_coalesce_text()} as badge,
                sde.description,
                sde.status,
                sddn.x,
                sddn.y,
                sde.created_at,
                sde.updated_at,
                {badge_select_columns()}
            from support_domain_element_type sde
            left join support_domain_diagram sdd
                on sdd.support_domain_model_id = sde.support_domain_model_id
            left join support_domain_diagram_node sddn
                on sddn.diagram_id = sdd.diagram_id
                and sddn.element_id = sde.element_id
            {badge_join('sde.element_id', _BADGE_OWNER_TYPE)}
            where sde.support_domain_model_id = %s
            order by sde.name
            """,
            (model_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_element(self, element_id: str) -> dict | None:
        row = self._db.execute(
            f"""
            select
                sde.element_id,
                sde.support_domain_model_id,
                sde.support_domain_model_id as model_id,
                sde.name,
                sde.display_name,
                {badge_coalesce_text()} as badge,
                sde.description,
                sde.status,
                sddn.x,
                sddn.y,
                sde.created_at,
                sde.updated_at,
                {badge_select_columns()}
            from support_domain_element_type sde
            left join support_domain_diagram sdd
                on sdd.support_domain_model_id = sde.support_domain_model_id
            left join support_domain_diagram_node sddn
                on sddn.diagram_id = sdd.diagram_id
                and sddn.element_id = sde.element_id
            {badge_join('sde.element_id', _BADGE_OWNER_TYPE)}
            where sde.element_id = %s
            """,
            (element_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_element(self, payload: dict) -> dict:
        element_id = payload.get("element_id") or str(uuid.uuid4())
        self._db.execute(
            """
            insert into support_domain_element_type (
                element_id,
                support_domain_model_id,
                name,
                display_name,
                description,
                status,
                created_at,
                updated_at
            )
            values (%s, %s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (
                element_id,
                payload["model_id"],
                payload["name"],
                payload.get("display_name", ""),
                payload.get("description", ""),
                payload["status"],
            ),
        )
        self._db.commit()
        return self.get_element(element_id)

    def update_element(self, element_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update support_domain_element_type
            set support_domain_model_id = %s, name = %s, display_name = %s,
                description = %s, status = %s, updated_at = current_timestamp
            where element_id = %s
            """,
            (
                payload["model_id"],
                payload["name"],
                payload.get("display_name", ""),
                payload.get("description", ""),
                payload["status"],
                element_id,
            ),
        )
        self._db.commit()
        return self.get_element(element_id)

    def get_delete_impact(self, element_id: str) -> dict | None:
        element = self.get_element(element_id)
        if element is None:
            return None

        relationship_rows = self._db.execute(
            """
            select distinct
                relationship.relationship_id,
                source.name as source_name,
                target.name as target_name,
                relationship.relationship_type
            from support_domain_relationship relationship
            join support_domain_element_type source on source.element_id = relationship.source_element_id
            join support_domain_element_type target on target.element_id = relationship.target_element_id
            where relationship.source_element_id = %s
               or relationship.target_element_id = %s
            order by source.name, target.name
            """,
            (element_id, element_id),
        ).fetchall()
        rule_rows = self._db.execute(
            """
            select distinct
                rule.support_domain_rule_id as rule_id,
                source.name as source_name,
                target.name as target_name,
                rule.relationship_type,
                rule.rule_kind
            from support_domain_rule rule
            join support_domain_element_type source on source.element_id = rule.source_element_id
            join support_domain_element_type target on target.element_id = rule.target_element_id
            where rule.source_element_id = %s
               or rule.target_element_id = %s
            order by source.name, target.name
            """,
            (element_id, element_id),
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
            where instance.element_type_id = %s
            order by instance_path
            """,
            (element_id,),
        ).fetchall()

        cross_model_relationship_rows = list_cross_model_relationship_impacts(
            self._db,
            instance_type=SUPPORT_DOMAIN_MODEL,
            instance_ids_query="""
                select instance_id
                from support_domain_element_instance
                where element_type_id = %s
            """,
            params=(element_id,),
        )

        return {
            "element_id": str(element["element_id"]),
            "model_id": str(element["support_domain_model_id"]),
            "element_name": str(element["name"]),
            "affected_relationships": [dict(row) for row in relationship_rows],
            "affected_rules": [dict(row) for row in rule_rows],
            "instance_count": len(instance_rows),
            "element_instances": [dict(row) for row in instance_rows],
            "cross_model_relationship_count": len(cross_model_relationship_rows),
            "cross_model_relationships": cross_model_relationship_rows,
        }

    def delete_element(self, element_id: str) -> None:
        delete_cross_model_relationships(
            self._db,
            instance_type=SUPPORT_DOMAIN_MODEL,
            instance_ids_query="""
                select instance_id
                from support_domain_element_instance
                where element_type_id = %s
            """,
            params=(element_id,),
        )
        self._db.execute(
            "delete from support_domain_element_instance where element_type_id = %s",
            (element_id,),
        )
        self._db.execute("delete from support_domain_element_type where element_id = %s", (element_id,))
        self._db.commit()
