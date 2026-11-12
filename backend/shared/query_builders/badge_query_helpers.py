"""
badge_query_helpers
===================
Centralised SQL fragments for joining and selecting badge_store data.

Usage
-----
Import the three helpers and compose them into your SELECT:

    from shared.query_builders.badge_query_helpers import (
        badge_select_columns,
        badge_join,
        badge_coalesce_text,
    )

    sql = f\"\"\"
        select
            t.my_id,
            t.name,
            {badge_coalesce_text('t.legacy_text_col')} as badge,
            {badge_select_columns()}
        from my_table t
        {badge_join('t.my_id', 'my_entity_type')}
        where t.model_id = %s
    \"\"\"

All three functions accept an optional ``alias`` parameter (default ``'bs'``)
so you can avoid conflicts when joining multiple badge stores in one query.
"""

from __future__ import annotations


def badge_select_columns(alias: str = "bs") -> str:
    """Return the comma-separated SELECT fragment for all badge_store columns.

    Example output (default alias)::

        bs.badge_store_id,
        bs.badge_text,
        bs.badge_shape,
        bs.badge_color,
        bs.badge_text_color,
        bs.badge_icon,
        bs.badge_size,
        bs.badge_content_type
    """
    a = alias
    return (
        f"{a}.badge_store_id,\n"
        f"                {a}.badge_text,\n"
        f"                {a}.badge_shape,\n"
        f"                {a}.badge_color,\n"
        f"                {a}.badge_text_color,\n"
        f"                {a}.badge_icon,\n"
        f"                {a}.badge_size,\n"
        f"                {a}.badge_content_type"
    )


def badge_join(owner_id_expr: str, owner_entity_type: str, alias: str = "bs") -> str:
    """Return the LEFT JOIN clause to attach badge_store rows.

    Parameters
    ----------
    owner_id_expr:
        SQL expression that evaluates to the owner's primary key,
        e.g. ``'sn.node_type_id'`` or ``'sde.element_id'``.
    owner_entity_type:
        The literal string stored in ``badge_store.owner_entity_type``,
        e.g. ``'hierarchy_model_node_type'`` or ``'support_domain_element_type'``.
    alias:
        Table alias for the joined badge_store (default ``'bs'``).

    Example output::

        left join badge_store bs
            on bs.owner_entity_id = sn.node_type_id
            and bs.owner_entity_type = 'hierarchy_model_node_type'
    """
    return (
        f"left join badge_store {alias}\n"
        f"            on {alias}.owner_entity_id = {owner_id_expr}\n"
        f"            and {alias}.owner_entity_type = '{owner_entity_type}'"
    )


def badge_coalesce_text(legacy_expr: str | None = None, alias: str = "bs") -> str:
    """Return a COALESCE expression that resolves the display badge text.

    When a ``legacy_expr`` is supplied (e.g. ``'nb.badge_text'`` or
    ``'sde.badge_code'``) the result falls back to that column when no
    badge_store row exists.  When omitted the result is just
    ``COALESCE(bs.badge_text, '')``.

    Parameters
    ----------
    legacy_expr:
        Optional SQL expression for the legacy text fallback.
    alias:
        Table alias for badge_store (default ``'bs'``).

    Examples
    --------
    No legacy column::

        coalesce(bs.badge_text, '')

    With a legacy column::

        coalesce(bs.badge_text, nb.badge_text, '')
    """
    if legacy_expr:
        return f"coalesce({alias}.badge_text, {legacy_expr}, '')"
    return f"coalesce({alias}.badge_text, '')"
