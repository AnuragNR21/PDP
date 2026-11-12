from __future__ import annotations

import uuid
from typing import Any

from shared.query_builders.cross_model_impact_helpers import (
    list_cross_model_relationship_type_impacts,
)
from shared.model_config import HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL

_TYPE_SELECT = f"""
    SELECT
        t.relationship_type_id,
        t.name,
        t.description,
        t.source_model_type,
        t.source_model_item_type_id,
        COALESCE(nt_s.name, et_s.name)                                 AS source_type_name,
        COALESCE(hm_s.name, sdm_s.name)                                AS source_model_name,
        COALESCE(nt_s.model_id, et_s.support_domain_model_id)          AS source_model_id,
        t.target_model_type,
        t.target_model_item_type_id,
        COALESCE(nt_t.name, et_t.name)                                 AS target_type_name,
        COALESCE(hm_t.name, sdm_t.name)                                AS target_model_name,
        COALESCE(nt_t.model_id, et_t.support_domain_model_id)          AS target_model_id,
        t.governance_role,
        t.status,
        t.created_at,
        t.updated_at
    FROM cross_model_relationship_type t
    LEFT JOIN hierarchy_model_node_type nt_s
           ON t.source_model_type = '{HIERARCHY_MODEL}' AND t.source_model_item_type_id = nt_s.node_type_id
    LEFT JOIN hierarchy_model hm_s
           ON nt_s.model_id = hm_s.model_id
    LEFT JOIN support_domain_element_type et_s
           ON t.source_model_type = '{SUPPORT_DOMAIN_MODEL}' AND t.source_model_item_type_id = et_s.element_id
    LEFT JOIN support_domain_model sdm_s
           ON et_s.support_domain_model_id = sdm_s.support_domain_model_id
    LEFT JOIN hierarchy_model_node_type nt_t
           ON t.target_model_type = '{HIERARCHY_MODEL}' AND t.target_model_item_type_id = nt_t.node_type_id
    LEFT JOIN hierarchy_model hm_t
           ON nt_t.model_id = hm_t.model_id
    LEFT JOIN support_domain_element_type et_t
           ON t.target_model_type = '{SUPPORT_DOMAIN_MODEL}' AND t.target_model_item_type_id = et_t.element_id
    LEFT JOIN support_domain_model sdm_t
           ON et_t.support_domain_model_id = sdm_t.support_domain_model_id
"""


class CrossModelRelationshipTypeRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_types(self, *, status: str | None = None) -> list[dict]:
        sql = _TYPE_SELECT + " WHERE 1=1"
        params: list[str] = []
        if status:
            sql += " AND t.status = %s"
            params.append(status)
        sql += " ORDER BY t.name"
        rows = self._db.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def get_type(self, relationship_type_id: str) -> dict | None:
        row = self._db.execute(
            _TYPE_SELECT + " WHERE t.relationship_type_id = %s",
            (relationship_type_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_type(self, payload: dict) -> dict:
        type_id = payload.get("relationship_type_id") or str(uuid.uuid4())
        self._db.execute(
            """
            INSERT INTO cross_model_relationship_type (
                relationship_type_id,
                name,
                description,
                source_model_type,
                source_model_item_type_id,
                target_model_type,
                target_model_item_type_id,
                governance_role,
                status,
                created_at,
                updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (
                type_id,
                payload["name"],
                payload.get("description"),
                payload.get("source_model_type", HIERARCHY_MODEL),
                payload.get("source_model_item_type_id"),
                payload.get("target_model_type", HIERARCHY_MODEL),
                payload.get("target_model_item_type_id"),
                payload.get("governance_role") or None,
                payload.get("status", "active"),
            ),
        )
        return self.get_type(type_id)

    def update_type(self, relationship_type_id: str, payload: dict) -> dict | None:
        self._db.execute(
            """
            UPDATE cross_model_relationship_type
            SET name = %s,
                description = %s,
                source_model_type = %s,
                source_model_item_type_id = %s,
                target_model_type = %s,
                target_model_item_type_id = %s,
                governance_role = %s,
                status = %s,
                updated_at = current_timestamp
            WHERE relationship_type_id = %s
            """,
            (
                payload["name"],
                payload.get("description"),
                payload.get("source_model_type", HIERARCHY_MODEL),
                payload.get("source_model_item_type_id"),
                payload.get("target_model_type", HIERARCHY_MODEL),
                payload.get("target_model_item_type_id"),
                payload.get("governance_role") or None,
                payload.get("status", "active"),
                relationship_type_id,
            ),
        )
        return self.get_type(relationship_type_id)

    def delete_type(self, relationship_type_id: str) -> None:
        self._db.execute(
            "DELETE FROM cross_model_relationship_instance WHERE relationship_rule_id = %s",
            (relationship_type_id,),
        )
        self._db.execute(
            "DELETE FROM cross_model_relationship_type WHERE relationship_type_id = %s",
            (relationship_type_id,),
        )
        self._db.commit()

    def get_delete_impact(self, relationship_type_id: str) -> dict | None:
        relationship_type = self.get_type(relationship_type_id)
        if relationship_type is None:
            return None
        relationships = list_cross_model_relationship_type_impacts(
            self._db, relationship_type_id=relationship_type_id
        )
        return {
            "impact_summary": {
                "relationship_type_id": relationship_type_id,
                "relationship_type_name": relationship_type["name"],
                "relationship_count": len(relationships),
            },
            "impact_list_items": relationships,
        }
