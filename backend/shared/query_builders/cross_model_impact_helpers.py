from collections.abc import Sequence
from typing import Any

from shared.model_config import HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL


_IMPACT_SELECT = f"""
    select
        relationship.relationship_id,
        relationship_type.name as relationship_type_name,
        coalesce(
            source_node.name, source_element.name, relationship.source_instance_id
        ) as source_instance_name,
        coalesce(
            target_node.name, target_element.name, relationship.target_instance_id
        ) as target_instance_name
    from cross_model_relationship_instance relationship
    join cross_model_relationship_type relationship_type
      on relationship_type.relationship_type_id = relationship.relationship_rule_id
    left join hierarchy_model_node_instance source_node
      on source_node.node_instance_id = relationship.source_instance_id
     and relationship.source_instance_type = '{HIERARCHY_MODEL}'
    left join support_domain_element_instance source_element
      on source_element.instance_id = relationship.source_instance_id
     and relationship.source_instance_type = '{SUPPORT_DOMAIN_MODEL}'
    left join hierarchy_model_node_instance target_node
      on target_node.node_instance_id = relationship.target_instance_id
     and relationship.target_instance_type = '{HIERARCHY_MODEL}'
    left join support_domain_element_instance target_element
      on target_element.instance_id = relationship.target_instance_id
     and relationship.target_instance_type = '{SUPPORT_DOMAIN_MODEL}'
"""


def list_cross_model_relationship_impacts(
    db: Any,
    *,
    instance_type: str,
    instance_ids_query: str,
    params: Sequence[object],
) -> list[dict]:
    query_params = (instance_type, *params, instance_type, *params)
    rows = db.execute(
        f"""
        {_IMPACT_SELECT}
        where (
            relationship.source_instance_type = %s
            and relationship.source_instance_id in ({instance_ids_query})
        )
           or (
            relationship.target_instance_type = %s
            and relationship.target_instance_id in ({instance_ids_query})
        )
        order by relationship_type.name, source_instance_name, target_instance_name
        """,
        query_params,
    ).fetchall()
    return [dict(row) for row in rows]


def build_cross_model_relationship_impact(rows: list[dict]) -> dict:
    return {
        "impact_summary": {
            "relationship_count": len(rows),
        },
        "impact_list_items": rows,
    }


def delete_cross_model_relationships(
    db: Any,
    *,
    instance_type: str,
    instance_ids_query: str,
    params: Sequence[object],
) -> None:
    query_params = (instance_type, *params, instance_type, *params)
    db.execute(
        f"""
        delete from cross_model_relationship_instance
        where (
            source_instance_type = %s
            and source_instance_id in ({instance_ids_query})
        )
           or (
            target_instance_type = %s
            and target_instance_id in ({instance_ids_query})
        )
        """,
        query_params,
    )


def list_cross_model_relationship_type_impacts(
    db: Any, *, relationship_type_id: str
) -> list[dict]:
    rows = db.execute(
        f"""
        {_IMPACT_SELECT}
        where relationship.relationship_rule_id = %s
        order by source_instance_name, target_instance_name
        """,
        (relationship_type_id,),
    ).fetchall()
    return [dict(row) for row in rows]
