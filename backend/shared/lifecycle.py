"""
Lifecycle rules between MWS definitions and their SWS instances.

Draft → Active → Archived, for Models, Node Types and Element Types (MWS) and
for the node and element instances made from them (SWS). The third state is
stored as ``retired`` and shown as "Archived".

A definition governs its instances:

    MWS definition   Draft inst.   Active inst.   Archived inst.   New instance
    Draft            no            no             historical       no
    Active           yes           yes            yes              yes
    Archived         no            no             yes              no

An instance's governing definition is its model together with its type: if
either is Archived the pair is Archived, otherwise if either is Draft the pair
is Draft. Archived means no longer authored, never deleted or hidden.

Every check takes an open connection (anything with ``execute(sql, params)``
returning dict-like rows), so the Model and Structure services share it.
"""

from __future__ import annotations

from typing import Any, Literal

DRAFT = "draft"
ACTIVE = "active"
ARCHIVED = "retired"
INSTANCE_STATUSES = (DRAFT, ACTIVE, ARCHIVED)

Kind = Literal["node", "element"]

_LABEL = {DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived"}


def label(status: str | None) -> str:
    return _LABEL.get(status or "", (status or "").replace("_", " ").title())


class LifecycleError(ValueError):
    """An action would create an invalid MWS/SWS lifecycle combination."""


def combined_status(model_status: str | None, type_status: str | None) -> str:
    statuses = {model_status or ACTIVE, type_status or ACTIVE}
    if ARCHIVED in statuses:
        return ARCHIVED
    if DRAFT in statuses:
        return DRAFT
    return ACTIVE


def instance_status_allowed(definition_status: str, instance_status: str) -> bool:
    if definition_status == ACTIVE:
        return instance_status in INSTANCE_STATUSES
    return instance_status == ARCHIVED


_NODE_DEFINITION_SQL = """
    SELECT m.name AS model_name, m.status AS model_status, t.name AS type_name, t.status AS type_status
    FROM hierarchy_model m
    JOIN hierarchy_model_node_type t ON t.model_id = m.model_id
    WHERE m.model_id = %s AND t.node_type_id = %s
"""
_ELEMENT_DEFINITION_SQL = """
    SELECT m.name AS model_name, m.status AS model_status, t.name AS type_name, t.status AS type_status
    FROM support_domain_model m
    JOIN support_domain_element_type t ON t.support_domain_model_id = m.support_domain_model_id
    WHERE m.support_domain_model_id = %s AND t.element_id = %s
"""


def _definition(conn: Any, kind: Kind, model_id: str, type_id: str) -> dict | None:
    row = conn.execute(_NODE_DEFINITION_SQL if kind == "node" else _ELEMENT_DEFINITION_SQL, (model_id, type_id)).fetchone()
    return dict(row) if row else None


def _not_active_reason(definition: dict, kind: Kind) -> str | None:
    what = "Node Type" if kind == "node" else "Element Type"
    if definition["model_status"] != ACTIVE:
        return f"model '{definition['model_name']}' is {label(definition['model_status'])}"
    if definition["type_status"] != ACTIVE:
        return f"{what} '{definition['type_name']}' is {label(definition['type_status'])}"
    return None


def instantiate_problem(conn: Any, kind: Kind, model_id: str, type_id: str) -> str | None:
    """Why no new instance may be made from this model and type, or None if one may."""
    definition = _definition(conn, kind, model_id, type_id)
    if definition is None:
        return None  # existence is the caller's check
    reason = _not_active_reason(definition, kind)
    if reason is None:
        return None
    return (
        f"New instances can only be created from Active models and types, and the {reason} in the Model Workspace. "
        "Activate it there first."
    )


def require_can_instantiate(conn: Any, kind: Kind, model_id: str, type_id: str) -> None:
    problem = instantiate_problem(conn, kind, model_id, type_id)
    if problem:
        raise LifecycleError(problem)


_NODE_INSTANCE_SQL = """
    SELECT i.name, i.status, i.model_id, i.node_type_id AS type_id
    FROM hierarchy_model_node_instance i WHERE i.node_instance_id = %s
"""
_ELEMENT_INSTANCE_SQL = """
    SELECT i.name, i.status, i.support_domain_model_id AS model_id, i.element_type_id AS type_id
    FROM support_domain_element_instance i WHERE i.instance_id = %s
"""


def _instance(conn: Any, kind: Kind, instance_id: str) -> dict | None:
    row = conn.execute(_NODE_INSTANCE_SQL if kind == "node" else _ELEMENT_INSTANCE_SQL, (instance_id,)).fetchone()
    return dict(row) if row else None


def require_instance_status(conn: Any, kind: Kind, model_id: str, type_id: str, new_status: str, name: str = "This instance") -> None:
    """An instance may take ``new_status`` only where its definition allows it."""
    if new_status not in INSTANCE_STATUSES:
        raise LifecycleError(f"Status must be Draft, Active or Archived, not '{new_status}'.")
    definition = _definition(conn, kind, model_id, type_id)
    if definition is None:
        return
    governing = combined_status(definition["model_status"], definition["type_status"])
    if instance_status_allowed(governing, new_status):
        return
    reason = _not_active_reason(definition, kind)
    raise LifecycleError(
        f"'{name}' cannot be {label(new_status)}: the {reason} in the Model Workspace, "
        "so its instances can only be Archived. Activate the definition there first."
    )


def require_authorable(conn: Any, kind: Kind, instance_id: str) -> dict:
    """A new relationship (or child) may use this instance: it is Draft or Active, and so is not its definition's problem."""
    instance = _instance(conn, kind, instance_id)
    if instance is None:
        raise LifecycleError("Instance not found.")
    if instance["status"] == ARCHIVED:
        raise LifecycleError(f"'{instance['name']}' is Archived, so it cannot be used in a new relationship. It stays visible in the ones it already has.")
    definition = _definition(conn, kind, instance["model_id"], instance["type_id"])
    if definition is not None:
        reason = _not_active_reason(definition, kind)
        if reason:
            raise LifecycleError(
                f"'{instance['name']}' cannot be used in a new relationship: the {reason} in the Model Workspace. "
                "Only instances of Active models and types can be related."
            )
    return instance


def _dependents(conn: Any, kind: Kind, *, model_id: str | None = None, type_id: str | None = None) -> list[dict]:
    """Draft or Active instances that depend on this model or type."""
    if kind == "node":
        sql = "SELECT name, status FROM hierarchy_model_node_instance WHERE status <> %s AND "
        sql += "model_id = %s" if model_id else "node_type_id = %s"
    else:
        sql = "SELECT name, status FROM support_domain_element_instance WHERE status <> %s AND "
        sql += "support_domain_model_id = %s" if model_id else "element_type_id = %s"
    rows = conn.execute(sql + " ORDER BY name", (ARCHIVED, model_id or type_id)).fetchall()
    return [dict(row) for row in rows]


def require_definition_status_change(
    conn: Any,
    kind: Kind,
    *,
    what: str,
    name: str,
    current_status: str | None,
    new_status: str,
    model_id: str | None = None,
    type_id: str | None = None,
) -> None:
    """
    A model or type leaves Active only once no Draft or Active instance depends
    on it — otherwise those instances would be left in an invalid state.
    """
    if new_status == ACTIVE or new_status == current_status:
        return
    dependents = _dependents(conn, kind, model_id=model_id, type_id=type_id)
    if not dependents:
        return
    names = ", ".join(f"{row['name']} ({label(row['status'])})" for row in dependents[:5])
    more = f", and {len(dependents) - 5} more" if len(dependents) > 5 else ""
    raise LifecycleError(
        f"{what} '{name}' cannot be set to {label(new_status)}: {len(dependents)} instance"
        f"{'' if len(dependents) == 1 else 's'} in the Structure Workspace "
        f"{'is' if len(dependents) == 1 else 'are'} still Draft or Active — {names}{more}. "
        f"Archive or delete {'it' if len(dependents) == 1 else 'them'} first, then change the status."
    )
