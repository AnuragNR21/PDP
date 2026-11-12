from __future__ import annotations

import uuid
from typing import Any


class SupportDomainElementPropertyRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_properties(self, *, element_id: str) -> list[dict]:
        rows = self._db.execute(
            """
            select
                property_id,
                element_id,
                name,
                description,
                status,
                created_at,
                updated_at
            from support_domain_element_type_property
            where element_id = %s
            order by name
            """,
            (element_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_property(self, property_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                property_id,
                element_id,
                name,
                description,
                status,
                created_at,
                updated_at
            from support_domain_element_type_property
            where property_id = %s
            """,
            (property_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_property(self, payload: dict) -> dict:
        property_id = payload.get("property_id") or str(uuid.uuid4())
        self._db.execute(
            """
            insert into support_domain_element_type_property (
                property_id,
                element_id,
                name,
                description,
                status,
                created_at,
                updated_at
            )
            values (%s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (
                property_id,
                payload["element_id"],
                payload["name"],
                payload.get("description", ""),
                payload["status"],
            ),
        )
        self._db.commit()
        return self.get_property(property_id)

    def update_property(self, property_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update support_domain_element_type_property
            set element_id = %s,
                name = %s,
                description = %s,
                status = %s,
                updated_at = current_timestamp
            where property_id = %s
            """,
            (
                payload["element_id"],
                payload["name"],
                payload.get("description", ""),
                payload["status"],
                property_id,
            ),
        )
        self._db.commit()
        return self.get_property(property_id)

    def delete_property(self, property_id: str) -> None:
        self._db.execute("delete from support_domain_element_type_property where property_id = %s", (property_id,))
        self._db.commit()

    def get_delete_impact(self, property_id: str) -> dict | None:
        prop = self.get_property(property_id)
        if prop is None:
            return None

        element = self._db.execute(
            """
            select element_id, name
            from support_domain_element_type
            where element_id = %s
            """,
            (prop["element_id"],),
        ).fetchone()

        instance_count_row = self._db.execute(
            """
            select count(*) as instance_count
            from support_domain_element_instance
            where element_type_id = %s
            """,
            (prop["element_id"],),
        ).fetchone()

        return {
            "property_id": prop["property_id"],
            "property_name": prop["name"],
            "element_id": prop["element_id"],
            "element_name": dict(element)["name"] if element else None,
            "affected_instance_count": int(dict(instance_count_row)["instance_count"]) if instance_count_row else 0,
        }
