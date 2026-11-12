from __future__ import annotations

from .hierarchy_model_node_type_repo import HierarchyModelNodeTypeRepo


class NodeTypeRepo(HierarchyModelNodeTypeRepo):
    """Compatibility shim for earlier frontend/backend scaffolding.

    The tabbed Model workspace now uses hierarchy model node types as the
    authoritative tree-authored model definition element. This shim preserves
    import compatibility for older code paths that still reference NodeTypeRepo.
    """
