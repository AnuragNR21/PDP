from uuid import uuid4

from shared.model_config import HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL
from shared.db import get_connection, utc_now_iso

_LINK_SELECT = f"""
    SELECT
        cmi.relationship_id                                                 AS cross_model_instance_id,
        cmi.relationship_rule_id,
        cmi.source_instance_id,
        cmi.source_instance_type,
        COALESCE(src_node.name,  src_elem.name)                             AS source_instance_name,
        COALESCE(src_node.model_id, src_elem.support_domain_model_id)       AS source_model_id,
        COALESCE(src_hm.name,    src_sdm.name)                              AS source_model_name,
        COALESCE(src_nt.name,    src_et.name)                               AS source_type_name,
        cmi.target_instance_id,
        cmi.target_instance_type,
        COALESCE(tgt_node.name,  tgt_elem.name)                             AS target_instance_name,
        COALESCE(tgt_node.model_id, tgt_elem.support_domain_model_id)       AS target_model_id,
        COALESCE(tgt_hm.name,    tgt_sdm.name)                              AS target_model_name,
        COALESCE(tgt_nt.name,    tgt_et.name)                               AS target_type_name,
        cmi.sort_order,
        cmi.created_at
    FROM cross_model_relationship_instance cmi
    -- Source: hierarchy node
    LEFT JOIN hierarchy_model_node_instance src_node
        ON src_node.node_instance_id = cmi.source_instance_id
        AND cmi.source_instance_type = '{HIERARCHY_MODEL}'
    LEFT JOIN hierarchy_model src_hm
        ON src_hm.model_id = src_node.model_id
    LEFT JOIN hierarchy_model_node_type src_nt
        ON src_nt.node_type_id = src_node.node_type_id
    -- Source: SD element
    LEFT JOIN support_domain_element_instance src_elem
        ON src_elem.instance_id = cmi.source_instance_id
        AND cmi.source_instance_type = '{SUPPORT_DOMAIN_MODEL}'
    LEFT JOIN support_domain_model src_sdm
        ON src_sdm.support_domain_model_id = src_elem.support_domain_model_id
    LEFT JOIN support_domain_element_type src_et
        ON src_et.element_id = src_elem.element_type_id
    -- Target: hierarchy node
    LEFT JOIN hierarchy_model_node_instance tgt_node
        ON tgt_node.node_instance_id = cmi.target_instance_id
        AND cmi.target_instance_type = '{HIERARCHY_MODEL}'
    LEFT JOIN hierarchy_model tgt_hm
        ON tgt_hm.model_id = tgt_node.model_id
    LEFT JOIN hierarchy_model_node_type tgt_nt
        ON tgt_nt.node_type_id = tgt_node.node_type_id
    -- Target: SD element
    LEFT JOIN support_domain_element_instance tgt_elem
        ON tgt_elem.instance_id = cmi.target_instance_id
        AND cmi.target_instance_type = '{SUPPORT_DOMAIN_MODEL}'
    LEFT JOIN support_domain_model tgt_sdm
        ON tgt_sdm.support_domain_model_id = tgt_elem.support_domain_model_id
    LEFT JOIN support_domain_element_type tgt_et
        ON tgt_et.element_id = tgt_elem.element_type_id
    WHERE cmi.source_instance_id IS NOT NULL
      AND cmi.target_instance_id IS NOT NULL
"""


class CrossModelInstanceRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def get_relationship_type(self, relationship_type_id: str) -> dict | None:
        """Look up a governed cross-model relationship type from the model workspace."""
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                """
                SELECT relationship_type_id, name, description,
                       source_model_type, source_model_item_type_id, target_model_type, target_model_item_type_id, status
                FROM cross_model_relationship_type
                WHERE relationship_type_id = %s
                """,
                (relationship_type_id,),
            ).fetchone()
        return dict(row) if row else None

    def list_links_for_source(self, source_instance_id: str) -> list[dict]:
        sql = _LINK_SELECT + ' AND cmi.source_instance_id = %s ORDER BY cmi.sort_order'
        with get_connection(self._db_url) as conn:
            rows = conn.execute(sql, (source_instance_id,)).fetchall()
        return [dict(r) for r in rows]

    def list_links_for_target(self, target_instance_id: str) -> list[dict]:
        sql = _LINK_SELECT + ' AND cmi.target_instance_id = %s ORDER BY cmi.sort_order'
        with get_connection(self._db_url) as conn:
            rows = conn.execute(sql, (target_instance_id,)).fetchall()
        return [dict(r) for r in rows]

    def list_all_links(self) -> list[dict]:
        sql = _LINK_SELECT + ' ORDER BY cmi.created_at DESC'
        with get_connection(self._db_url) as conn:
            rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    def get_link(self, cross_model_instance_id: str) -> dict | None:
        sql = _LINK_SELECT + ' AND cmi.relationship_id = %s'
        with get_connection(self._db_url) as conn:
            row = conn.execute(sql, (cross_model_instance_id,)).fetchone()
        return dict(row) if row else None

    def create_link(
        self,
        relationship_rule_id: str,
        source_instance_id: str,
        source_instance_type: str,
        target_instance_id: str,
        target_instance_type: str,
    ) -> dict:
        now = utc_now_iso()
        link_id = str(uuid4())
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                """
                SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
                FROM cross_model_relationship_instance
                WHERE source_instance_id = %s
                """,
                (source_instance_id,),
            ).fetchone()
            sort_order = dict(row)['next_order']
            conn.execute(
                """
                INSERT INTO cross_model_relationship_instance
                    (relationship_id,
                     relationship_rule_id,
                     source_instance_id, source_instance_type,
                     target_instance_id, target_instance_type,
                     sort_order, status,
                     created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'active', %s, %s)
                """,
                (link_id,
                 relationship_rule_id,
                 source_instance_id, source_instance_type,
                 target_instance_id, target_instance_type,
                 sort_order, now, now),
            )
        return self.get_link(link_id)

    def update_link(self, cross_model_instance_id: str, relationship_rule_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                """
                UPDATE cross_model_relationship_instance
                SET relationship_rule_id = %s, updated_at = %s
                WHERE relationship_id = %s
                """,
                (relationship_rule_id, utc_now_iso(), cross_model_instance_id),
            )
        return self.get_link(cross_model_instance_id)

    def delete_link(self, cross_model_instance_id: str) -> None:
        with get_connection(self._db_url) as conn:
            conn.execute(
                'DELETE FROM cross_model_relationship_instance WHERE relationship_id = %s',
                (cross_model_instance_id,),
            )
