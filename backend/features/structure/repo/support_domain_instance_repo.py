from uuid import uuid4

from shared.db import get_connection, utc_now_iso
from shared.query_builders.cross_model_impact_helpers import (
    build_cross_model_relationship_impact,
    delete_cross_model_relationships,
    list_cross_model_relationship_impacts,
)
from shared.model_config import SUPPORT_DOMAIN_MODEL

_ELEMENT_SELECT = """
    SELECT
        i.instance_id,
        i.support_domain_model_id,
        sdm.name AS support_domain_model_name,
        i.element_type_id,
        et.name AS element_type_name,
        i.name,
        i.description,
        i.status,
        i.sort_order,
        i.created_at,
        i.updated_at
    FROM support_domain_element_instance i
    JOIN support_domain_element_type et ON et.element_id = i.element_type_id
    JOIN support_domain_model sdm ON sdm.support_domain_model_id = i.support_domain_model_id
"""


class SupportDomainInstanceRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def list_instances(self, model_id: str | None = None) -> list[dict]:
        sql = _ELEMENT_SELECT
        params: tuple = ()
        if model_id:
            sql += ' WHERE i.support_domain_model_id = %s'
            params = (model_id,)
        sql += ' ORDER BY sdm.name, et.sort_order, i.sort_order, i.name'
        with get_connection(self._db_url) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def get_instance(self, instance_id: str) -> dict | None:
        sql = _ELEMENT_SELECT + ' WHERE i.instance_id = %s'
        with get_connection(self._db_url) as conn:
            row = conn.execute(sql, (instance_id,)).fetchone()
        return dict(row) if row else None

    def get_instance_delete_impact(self, instance_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                """
                SELECT
                    instance.instance_id,
                    model.support_domain_model_id AS model_id,
                    model.name AS model_name,
                    element.element_id,
                    element.name AS element_type_name,
                    element.display_name,
                    instance.name AS instance_name,
                    (model.name || ' -> ' || element.name || ' -> ' || instance.name)::text AS instance_path
                FROM support_domain_element_instance instance
                JOIN support_domain_element_type element ON element.element_id = instance.element_type_id
                JOIN support_domain_model model
                  ON model.support_domain_model_id = instance.support_domain_model_id
                WHERE instance.instance_id = %s
                """,
                (instance_id,),
            ).fetchone()
            if row is None:
                return None

            cross_model_relationship_rows = list_cross_model_relationship_impacts(
                conn,
                instance_type=SUPPORT_DOMAIN_MODEL,
                instance_ids_query="select %s",
                params=(instance_id,),
            )

        impact = dict(row)
        return {
            'instance_id': str(impact['instance_id']),
            'model_id': str(impact['model_id']),
            'model_name': str(impact['model_name']),
            'instance_count': 1,
            'elements': [{
                'element_id': str(impact['element_id']),
                'name': str(impact['element_type_name']),
                'display_name': impact['display_name'],
            }],
            'element_instances': [{
                'instance_id': str(impact['instance_id']),
                'element_type_id': str(impact['element_id']),
                'instance_name': str(impact['instance_name']),
                'element_type_name': str(impact['element_type_name']),
                'instance_path': str(impact['instance_path']),
            }],
            'cross_model_relationship_impact': build_cross_model_relationship_impact(cross_model_relationship_rows),
        }

    def get_model_delete_impact(self, model_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            model = conn.execute(
                """
                SELECT support_domain_model_id, name
                FROM support_domain_model
                WHERE support_domain_model_id = %s
                """,
                (model_id,),
            ).fetchone()
            if model is None:
                return None

            element_rows = conn.execute(
                """
                SELECT element_id, name, display_name
                FROM support_domain_element_type
                WHERE support_domain_model_id = %s
                ORDER BY sort_order, name
                """,
                (model_id,),
            ).fetchall()
            instance_rows = conn.execute(
                """
                SELECT
                    instance.instance_id,
                    instance.element_type_id,
                    instance.name AS instance_name,
                    element.name AS element_type_name,
                    (model.name || ' -> ' || element.name || ' -> ' || instance.name)::text AS instance_path
                FROM support_domain_element_instance instance
                JOIN support_domain_element_type element ON element.element_id = instance.element_type_id
                JOIN support_domain_model model
                  ON model.support_domain_model_id = instance.support_domain_model_id
                WHERE instance.support_domain_model_id = %s
                ORDER BY instance_path
                """,
                (model_id,),
            ).fetchall()
            cross_model_relationship_rows = list_cross_model_relationship_impacts(
                conn,
                instance_type=SUPPORT_DOMAIN_MODEL,
                instance_ids_query="""
                    SELECT instance_id
                    FROM support_domain_element_instance
                    WHERE support_domain_model_id = %s
                """,
                params=(model_id,),
            )

        return {
            'model_id': str(model['support_domain_model_id']),
            'model_name': str(model['name']),
            'element_count': len(element_rows),
            'instance_count': len(instance_rows),
            'elements': [dict(row) for row in element_rows],
            'element_instances': [dict(row) for row in instance_rows],
            'cross_model_relationship_impact': build_cross_model_relationship_impact(cross_model_relationship_rows),
        }

    def delete_model(self, model_id: str) -> None:
        with get_connection(self._db_url) as conn:
            delete_cross_model_relationships(
                conn,
                instance_type=SUPPORT_DOMAIN_MODEL,
                instance_ids_query="""
                    SELECT instance_id
                    FROM support_domain_element_instance
                    WHERE support_domain_model_id = %s
                """,
                params=(model_id,),
            )
            conn.execute(
                """
                DELETE FROM support_domain_element_instance
                WHERE support_domain_model_id = %s
                """,
                (model_id,),
            )
            conn.execute(
                "DELETE FROM support_domain_model WHERE support_domain_model_id = %s",
                (model_id,),
            )

    def create_instance(
        self,
        support_domain_model_id: str,
        element_type_id: str,
        name: str,
        description: str | None,
    ) -> dict:
        now = utc_now_iso()
        instance_id = str(uuid4())
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                """
                SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
                FROM support_domain_element_instance
                WHERE support_domain_model_id = %s AND element_type_id = %s
                """,
                (support_domain_model_id, element_type_id),
            ).fetchone()
            sort_order = dict(row)['next_order']

            conn.execute(
                """
                INSERT INTO support_domain_element_instance
                    (instance_id, support_domain_model_id, element_type_id,
                     name, description, status, sort_order, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, 'active', %s, %s, %s)
                """,
                (instance_id, support_domain_model_id, element_type_id,
                 name, description, sort_order, now, now),
            )
        return self.get_instance(instance_id)

    def update_instance(self, instance_id: str, name: str, description: str | None, status: str | None = None) -> dict | None:
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                """
                UPDATE support_domain_element_instance
                SET name = %s, description = %s, status = COALESCE(%s, status), updated_at = %s
                WHERE instance_id = %s
                """,
                (name, description, status, now, instance_id),
            )
        return self.get_instance(instance_id)

    def delete_instance(self, instance_id: str) -> None:
        with get_connection(self._db_url) as conn:
            delete_cross_model_relationships(
                conn,
                instance_type=SUPPORT_DOMAIN_MODEL,
                instance_ids_query="select %s",
                params=(instance_id,),
            )
            conn.execute(
                'DELETE FROM support_domain_element_instance WHERE instance_id = %s',
                (instance_id,),
            )

