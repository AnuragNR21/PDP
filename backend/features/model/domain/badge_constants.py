"""Centralised constants for badge customisation.

All badge defaults, allowed shapes, palette colours, sizes, icons and content
types live here so that both the database schema and the API share the exact
same values without duplication.
"""
from __future__ import annotations

from enum import StrEnum
from typing import Literal


# ── Badge owner entity types ───────────────────────────────────────────────────

class BadgeOwnerType(StrEnum):
    """Canonical owner_entity_type values stored in badge_store.

    Use these instead of bare string literals so any future entity type is
    defined in one place and benefits from IDE auto-complete and typo safety.
    """
    HIERARCHY_NODE = "hierarchy_model_node_type"
    SUPPORT_ELEMENT = "support_domain_element_type"

# ── Content types ──────────────────────────────────────────────────────────────

BadgeContentType = Literal["text", "icon", "text_icon"]

BADGE_CONTENT_TYPES: tuple[BadgeContentType, ...] = ("text", "icon", "text_icon")

BADGE_CONTENT_TYPE_LABELS: dict[str, str] = {
    "text": "Text",
    "icon": "Icon",
    "text_icon": "Text + Icon",
}

# ── Shapes ─────────────────────────────────────────────────────────────────────

BadgeShape = Literal["circle", "rounded-square", "hexagon", "diamond", "square"]

BADGE_SHAPES: tuple[BadgeShape, ...] = (
    "circle",
    "rounded-square",
    "hexagon",
    "diamond",
    "square",
)

BADGE_SHAPE_LABELS: dict[str, str] = {
    "circle": "Circle",
    "rounded-square": "Rounded Square",
    "hexagon": "Hexagon",
    "diamond": "Diamond",
    "square": "Square",
}

# ── Sizes (px) ─────────────────────────────────────────────────────────────────

BADGE_SIZES: tuple[int, ...] = (20, 24, 28, 32, 36, 40, 42)

# ── Icons ──────────────────────────────────────────────────────────────────────

BADGE_ICONS: tuple[str, ...] = (
    "star",
    "bolt",
    "database",
    "shield",
    "settings",
    "cube",
    "scissors",
    "document",
)

BADGE_ICON_LABELS: dict[str, str] = {
    "star": "Star",
    "bolt": "Bolt",
    "database": "Database",
    "shield": "Shield",
    "settings": "Settings",
    "cube": "Cube",
    "scissors": "Scissors",
    "document": "Document",
}

# ── Preset colour palette ──────────────────────────────────────────────────────

BADGE_PRESET_COLORS: tuple[str, ...] = (
    "#76B7B2",  # teal
    "#1976D2",  # blue
    "#388E3C",  # green
    "#F9A825",  # yellow
    "#E65100",  # orange
    "#C62828",  # red
    "#6A1B9A",  # purple
    "#E91E63",  # pink
    "#757575",  # grey
    "#212121",  # black
)

# ── Defaults ───────────────────────────────────────────────────────────────────

DEFAULT_BADGE_TEXT: str = ""
DEFAULT_BADGE_SHAPE: BadgeShape = "circle"
DEFAULT_BADGE_COLOR: str = "#1976D2"
DEFAULT_BADGE_TEXT_COLOR: str = "#FFFFFF"
DEFAULT_BADGE_ICON: str | None = None
DEFAULT_BADGE_SIZE: int = 24
DEFAULT_BADGE_CONTENT_TYPE: BadgeContentType = "text"
