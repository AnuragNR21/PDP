from __future__ import annotations

import uuid
from typing import Any

from ..domain.models import is_standard_relationship_kind


def _own_name(kind: str) -> str | None:
    """A relationship name of the model's own is kept as its name too; a standard kind has none."""
    return None if is_standard_relationship_kind(kind) else kind


class SupportDomainRelationshipRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_relationships(self, *, model_id: str) -> list[dict]:
        rows = self._db.execute(
            """
            select
                sdr.relationship_id,
                sdr.support_domain_model_id,
                -- The same id under the name the write commands use, so a row read
                -- here can be sent straight back (PUT needs model_id).
                sdr.support_domain_model_id as model_id,
                coalesce(sdr.description, '') as notes,
                sdr.source_element_id,
                src.name as source_element_name,
                sdr.target_element_id,
                tgt.name as target_element_name,
                sdr.relationship_type as relationship_kind,
                sdr.status,
                sdr.created_at,
                sdr.updated_at
            from support_domain_relationship sdr
            join support_domain_element_type src on src.element_id = sdr.source_element_id
            join support_domain_element_type tgt on tgt.element_id = sdr.target_element_id
            where sdr.support_domain_model_id = %s
            order by src.name, tgt.name
            """,
            (model_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def list_relationships_for_multiple_models(self, *, model_ids: list[str] | None = None) -> list[dict]:
        """Relationships across several support domain models; every model when no ids given.

        The shared cross-model diagram draws element-type relationships from any model
        the user dropped on the canvas, so it needs them in one read.
        """
        sql = """
            select
                sdr.relationship_id,
                sdr.support_domain_model_id,
                -- The same id under the name the write commands use, so a row read
                -- here can be sent straight back (PUT needs model_id).
                sdr.support_domain_model_id as model_id,
                coalesce(sdr.description, '') as notes,
                sdr.source_element_id,
                src.name as source_element_name,
                sdr.target_element_id,
                tgt.name as target_element_name,
                sdr.relationship_type as relationship_kind,
                sdr.status,
                sdr.created_at,
                sdr.updated_at
            from support_domain_relationship sdr
            join support_domain_element_type src on src.element_id = sdr.source_element_id
            join support_domain_element_type tgt on tgt.element_id = sdr.target_element_id
        """
        params: tuple = ()
        if model_ids:
            sql += " where sdr.support_domain_model_id = ANY(%s)"
            params = (list(model_ids),)
        sql += " order by src.name, tgt.name"
        rows = self._db.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def get_relationship(self, relationship_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                sdr.relationship_id,
                sdr.support_domain_model_id,
                -- The same id under the name the write commands use, so a row read
                -- here can be sent straight back (PUT needs model_id).
                sdr.support_domain_model_id as model_id,
                coalesce(sdr.description, '') as notes,
                sdr.source_element_id,
                src.name as source_element_name,
                sdr.target_element_id,
                tgt.name as target_element_name,
                sdr.relationship_type as relationship_kind,
                sdr.status,
                sdr.created_at,
                sdr.updated_at
            from support_domain_relationship sdr
            join support_domain_element_type src on src.element_id = sdr.source_element_id
            join support_domain_element_type tgt on tgt.element_id = sdr.target_element_id
            where sdr.relationship_id = %s
            """,
            (relationship_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_relationship(self, payload: dict) -> dict:
        relationship_id = payload.get("relationship_id") or str(uuid.uuid4())
        self._db.execute(
            """
            insert into support_domain_relationship (
                relationship_id,
                support_domain_model_id,
                source_element_id,
                target_element_id,
                relationship_type,
                name,
                description,
                status,
                created_at,
                updated_at
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            on conflict(support_domain_model_id, source_element_id, target_element_id, relationship_type)
            do update set status = excluded.status, description = excluded.description, updated_at = current_timestamp
            """,
            (
                relationship_id,
                payload["model_id"],
                payload["source_element_id"],
                payload["target_element_id"],
                payload["relationship_kind"],
                _own_name(payload["relationship_kind"]),
                payload.get("notes") or "",
                payload["status"],
            ),
        )
        self._db.commit()
        existing = self._db.execute(
            """
            select relationship_id
            from support_domain_relationship
            where support_domain_model_id = %s and source_element_id = %s and target_element_id = %s and relationship_type = %s
            """,
            (
                payload["model_id"],
                payload["source_element_id"],
                payload["target_element_id"],
                payload["relationship_kind"],
            ),
        ).fetchone()
        return self.get_relationship(str(existing['relationship_id'])) if existing else None

    def update_relationship(self, relationship_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update support_domain_relationship
            set support_domain_model_id = %s, source_element_id = %s, target_element_id = %s, relationship_type = %s,
                name = %s, description = %s, status = %s, updated_at = current_timestamp
            where relationship_id = %s
            """,
            (
                payload["model_id"],
                payload["source_element_id"],
                payload["target_element_id"],
                payload["relationship_kind"],
                _own_name(payload["relationship_kind"]),
                payload.get("notes") or "",
                payload["status"],
                relationship_id,
            ),
        )
        self._db.commit()
        return self.get_relationship(relationship_id)

    def find_relationship(self, model_id: str, source_element_id: str, target_element_id: str, relationship_kind: str) -> str | None:
        """The id of the relationship with exactly these model, ends and kind, if any."""
        row = self._db.execute(
            """
            select relationship_id from support_domain_relationship
            where support_domain_model_id = %s and source_element_id = %s and target_element_id = %s and relationship_type = %s
            """,
            (model_id, source_element_id, target_element_id, relationship_kind),
        ).fetchone()
        return str(row["relationship_id"]) if row else None

    def delete_relationship(self, relationship_id: str) -> None:
        self._db.execute("delete from support_domain_relationship where relationship_id = %s", (relationship_id,))
        self._db.commit()