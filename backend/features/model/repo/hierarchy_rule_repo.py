from __future__ import annotations

import uuid
from typing import Any


class HierarchyRuleRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_structural_rules(self, *, model_id: str | None = None, owning_domain: str | None = None) -> list[dict]:
        sql = """
            select
                sr.rule_id,
                sr.model_id,
                sr.parent_node_type_id,
                p.name as parent_node_name,
                sr.child_node_type_id,
                c.name as child_node_name,
                sr.relationship_kind,
                sr.notes,
                sr.status,
                sr.created_at,
                sr.updated_at
            from structural_rule sr
            join hierarchy_model_node_type p on p.node_type_id = sr.parent_node_type_id
            join hierarchy_model_node_type c on c.node_type_id = sr.child_node_type_id
            join hierarchy_model sm on sm.model_id = sr.model_id
            where 1=1
        """
        params: list[str] = []
        if model_id:
            sql += " and sr.model_id = %s"
            params.append(model_id)
        if owning_domain:
            sql += " and sm.owning_domain = %s"
            params.append(owning_domain)
        sql += " order by p.name, c.name"
        rows = self._db.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def get_structural_rule(self, rule_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                sr.rule_id,
                sr.model_id,
                sr.parent_node_type_id,
                p.name as parent_node_name,
                sr.child_node_type_id,
                c.name as child_node_name,
                sr.relationship_kind,
                sr.notes,
                sr.status,
                sr.created_at,
                sr.updated_at
            from structural_rule sr
            join hierarchy_model_node_type p on p.node_type_id = sr.parent_node_type_id
            join hierarchy_model_node_type c on c.node_type_id = sr.child_node_type_id
            where sr.rule_id = %s
            """,
            (rule_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_structural_rule(self, payload: dict) -> dict:
        rule_id = payload.get("rule_id") or str(uuid.uuid4())
        self._db.execute(
            """
            insert into structural_rule (
                rule_id,
                model_id,
                parent_node_type_id,
                child_node_type_id,
                relationship_kind,
                notes,
                status,
                created_at,
                updated_at
            ) values (%s, %s, %s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            on conflict(model_id, parent_node_type_id, child_node_type_id, relationship_kind)
            do update set notes = excluded.notes, status = excluded.status, updated_at = current_timestamp
            """,
            (
                rule_id,
                payload["model_id"],
                payload["parent_node_type_id"],
                payload["child_node_type_id"],
                payload["relationship_kind"],
                payload.get("notes", ""),
                payload["status"],
            ),
        )
        self._db.commit()
        existing = self._db.execute(
            """
            select rule_id
            from structural_rule
            where model_id = %s and parent_node_type_id = %s and child_node_type_id = %s and relationship_kind = %s
            """,
            (
                payload["model_id"],
                payload["parent_node_type_id"],
                payload["child_node_type_id"],
                payload["relationship_kind"],
            ),
        ).fetchone()
        return self.get_structural_rule(str(existing["rule_id"])) if existing else None

    def update_structural_rule(self, rule_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update structural_rule
            set model_id = %s, parent_node_type_id = %s, child_node_type_id = %s, relationship_kind = %s, notes = %s, status = %s, updated_at = current_timestamp
            where rule_id = %s
            """,
            (
                payload["model_id"],
                payload["parent_node_type_id"],
                payload["child_node_type_id"],
                payload["relationship_kind"],
                payload.get("notes", ""),
                payload["status"],
                rule_id,
            ),
        )
        self._db.commit()
        return self.get_structural_rule(rule_id)

    def delete_rule(self, rule_id: str) -> None:
        self._db.execute("delete from structural_rule where rule_id = %s", (rule_id,))
        self._db.commit()

    def delete_rules_for_node(self, node_id: str) -> None:
        self._db.execute(
            "delete from structural_rule where parent_node_type_id = %s or child_node_type_id = %s",
            (node_id, node_id),
        )
        self._db.commit()

    def delete_rules_for_model(self, model_id: str) -> None:
        self._db.execute("delete from structural_rule where model_id = %s", (model_id,))
        self._db.commit()

    def delete_rule_for_edge(self, *, model_id: str, parent_node_id: str, child_node_id: str) -> None:
        self._db.execute(
            """
            delete from structural_rule
            where model_id = %s and parent_node_type_id = %s and child_node_type_id = %s
              and relationship_kind IN ('parent_child', 'recursive')
            """,
            (model_id, parent_node_id, child_node_id),
        )
        self._db.commit()
