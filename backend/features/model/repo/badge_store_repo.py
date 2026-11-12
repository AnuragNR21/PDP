from __future__ import annotations

import uuid
from typing import Any

from ..domain.badge_constants import (
    DEFAULT_BADGE_COLOR,
    DEFAULT_BADGE_CONTENT_TYPE,
    DEFAULT_BADGE_ICON,
    DEFAULT_BADGE_SHAPE,
    DEFAULT_BADGE_SIZE,
    DEFAULT_BADGE_TEXT,
    DEFAULT_BADGE_TEXT_COLOR,
    BadgeOwnerType,
)


class BadgeStoreRepo:
    """Manages badge_store entries linked to hierarchy node types and support
    domain element types via owner_entity_type / owner_entity_id."""

    OWNER_HIERARCHY_NODE = BadgeOwnerType.HIERARCHY_NODE
    OWNER_SUPPORT_ELEMENT = BadgeOwnerType.SUPPORT_ELEMENT

    def __init__(self, db: Any) -> None:
        self._db = db

    # ── Queries ────────────────────────────────────────────────────────────────

    def get_by_owner(self, owner_entity_type: str, owner_entity_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                badge_store_id,
                owner_entity_type,
                owner_entity_id,
                badge_text,
                badge_shape,
                badge_color,
                badge_text_color,
                badge_icon,
                badge_size,
                badge_content_type,
                created_at,
                updated_at
            from badge_store
            where owner_entity_type = %s and owner_entity_id = %s
            """,
            (owner_entity_type, owner_entity_id),
        ).fetchone()
        return dict(row) if row else None

    def get_by_id(self, badge_store_id: str) -> dict | None:
        row = self._db.execute(
            """
            select
                badge_store_id,
                owner_entity_type,
                owner_entity_id,
                badge_text,
                badge_shape,
                badge_color,
                badge_text_color,
                badge_icon,
                badge_size,
                badge_content_type,
                created_at,
                updated_at
            from badge_store
            where badge_store_id = %s
            """,
            (badge_store_id,),
        ).fetchone()
        return dict(row) if row else None

    # ── Mutations ──────────────────────────────────────────────────────────────

    def upsert(
        self,
        owner_entity_type: str,
        owner_entity_id: str,
        *,
        badge_text: str = DEFAULT_BADGE_TEXT,
        badge_shape: str = DEFAULT_BADGE_SHAPE,
        badge_color: str = DEFAULT_BADGE_COLOR,
        badge_text_color: str = DEFAULT_BADGE_TEXT_COLOR,
        badge_icon: str | None = DEFAULT_BADGE_ICON,
        badge_size: int = DEFAULT_BADGE_SIZE,
        badge_content_type: str = DEFAULT_BADGE_CONTENT_TYPE,
    ) -> dict:
        """Insert or update the badge_store row for the given owner.

        Returns the persisted row and updates the owner table's badge_store_id FK.
        """
        existing = self.get_by_owner(owner_entity_type, owner_entity_id)
        if existing:
            self._db.execute(
                """
                update badge_store
                set badge_text = %s,
                    badge_shape = %s,
                    badge_color = %s,
                    badge_text_color = %s,
                    badge_icon = %s,
                    badge_size = %s,
                    badge_content_type = %s,
                    updated_at = current_timestamp
                where badge_store_id = %s
                """,
                (
                    badge_text,
                    badge_shape,
                    badge_color,
                    badge_text_color,
                    badge_icon,
                    badge_size,
                    badge_content_type,
                    existing["badge_store_id"],
                ),
            )
            badge_store_id = existing["badge_store_id"]
        else:
            badge_store_id = f"bst_{uuid.uuid4().hex[:16]}"
            self._db.execute(
                """
                insert into badge_store (
                    badge_store_id,
                    owner_entity_type,
                    owner_entity_id,
                    badge_text,
                    badge_shape,
                    badge_color,
                    badge_text_color,
                    badge_icon,
                    badge_size,
                    badge_content_type,
                    created_at,
                    updated_at
                ) values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    current_timestamp, current_timestamp
                )
                """,
                (
                    badge_store_id,
                    owner_entity_type,
                    owner_entity_id,
                    badge_text,
                    badge_shape,
                    badge_color,
                    badge_text_color,
                    badge_icon,
                    badge_size,
                    badge_content_type,
                ),
            )
            # Write FK back to the owner table
            self._link_owner(owner_entity_type, owner_entity_id, badge_store_id)

        self._db.commit()
        return self.get_by_id(badge_store_id)  # type: ignore[return-value]

    def delete_by_owner(self, owner_entity_type: str, owner_entity_id: str) -> None:
        self._db.execute(
            "delete from badge_store where owner_entity_type = %s and owner_entity_id = %s",
            (owner_entity_type, owner_entity_id),
        )
        self._db.commit()

    # ── Private helpers ────────────────────────────────────────────────────────

    def _link_owner(
        self, owner_entity_type: str, owner_entity_id: str, badge_store_id: str
    ) -> None:
        """Write the badge_store_id FK back into the owner table."""
        if owner_entity_type == self.OWNER_HIERARCHY_NODE:
            self._db.execute(
                "update hierarchy_model_node_type set badge_store_id = %s where node_type_id = %s",
                (badge_store_id, owner_entity_id),
            )
        elif owner_entity_type == self.OWNER_SUPPORT_ELEMENT:
            self._db.execute(
                "update support_domain_element_type set badge_store_id = %s where element_id = %s",
                (badge_store_id, owner_entity_id),
            )
