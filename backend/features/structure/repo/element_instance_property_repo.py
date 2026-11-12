from __future__ import annotations

import uuid
from typing import Any


class ElementInstancePropertyRepo:
    """CRUD for support_domain_element_instance_property."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def list_for_instance(self, instance_id: str) -> list[dict]:
        """Return effective property definitions for an element instance (read-only, no values)."""
        rows = self._db.execute(
            """
            select
                pt.property_id,
                pt.name as property_name,
                coalesce(pt.description, '') as property_description,
                pt.status as property_status,
                'defined' as origin,
                et.element_id as source_element_type_id,
                et.name as source_element_type_name
            from support_domain_element_type_property pt
            join support_domain_element_type et on et.element_id = pt.element_id
            where pt.element_id = (
                select element_type_id
                from support_domain_element_instance
                where instance_id = %s
            )
            order by pt.name
            """,
            (instance_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get(self, property_instance_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                ip.property_instance_id,
                ip.instance_id,
                ip.property_type_id,
                pt.name          as property_name,
                pt.description   as property_description,
                pt.status        as property_status,
                ip.created_at,
                ip.updated_at
            from support_domain_element_instance_property ip
            join support_domain_element_type_property pt
                on pt.property_id = ip.property_type_id
            where ip.property_instance_id = %s
            """,
            (property_instance_id,),
        ).fetchone()
        return dict(row) if row else None

    def upsert(self, instance_id: str, property_type_id: str) -> dict:
        """Insert or update the property assignment for an element instance."""
        existing = self._db.execute(
            """
            select property_instance_id
            from support_domain_element_instance_property
            where instance_id = %s and property_type_id = %s
            """,
            (instance_id, property_type_id),
        ).fetchone()

        if existing:
            pid = dict(existing)["property_instance_id"]
            self._db.execute(
                """
                update support_domain_element_instance_property
                set updated_at = current_timestamp
                where property_instance_id = %s
                """,
                (pid,),
            )
        else:
            pid = str(uuid.uuid4())
            self._db.execute(
                """
                insert into support_domain_element_instance_property
                    (property_instance_id, instance_id, property_type_id,
                     created_at, updated_at)
                values (%s, %s, %s, current_timestamp, current_timestamp)
                """,
                (pid, instance_id, property_type_id),
            )
        self._db.commit()
        return self.get(pid)

    def delete(self, property_instance_id: str) -> None:
        self._db.execute(
            "delete from support_domain_element_instance_property where property_instance_id = %s",
            (property_instance_id,),
        )
        self._db.commit()
