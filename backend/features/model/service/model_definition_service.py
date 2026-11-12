from __future__ import annotations

from shared import lifecycle

from ..domain.badge_constants import (
    BADGE_CONTENT_TYPE_LABELS,
    BADGE_CONTENT_TYPES,
    BADGE_ICON_LABELS,
    BADGE_ICONS,
    BADGE_PRESET_COLORS,
    BADGE_SHAPE_LABELS,
    BADGE_SHAPES,
    BADGE_SIZES,
    DEFAULT_BADGE_COLOR,
    DEFAULT_BADGE_CONTENT_TYPE,
    DEFAULT_BADGE_ICON,
    DEFAULT_BADGE_SHAPE,
    DEFAULT_BADGE_SIZE,
    DEFAULT_BADGE_TEXT,
    DEFAULT_BADGE_TEXT_COLOR,
)
from ..domain.commands import (
    CreateCrossModelRelationshipTypeCommand,
    CreateHierarchyModelCommand,
    CreateHierarchyNodeTypeCommand,
    CreateHierarchyNodeTypePropertyCommand,
    CreateHierarchyRuleCommand,
    CreateSupportDomainDiagramNodesCommand,
    CreateSupportDomainElementCommand,
    CreateSupportDomainModelCommand,
    CreateSupportDomainRelationshipCommand,
    ReorderHierarchyNodeTypeCommand,
    SaveBadgeCommand,
    SaveCrossModelRelationshipTypeDiagramCommand,
    UpdateCrossModelRelationshipTypeCommand,
    UpdateHierarchyModelCommand,
    UpdateHierarchyNodeTypeCommand,
    UpdateHierarchyNodeTypePropertyCommand,
    UpdateHierarchyRuleCommand,
    UpdateSupportDomainElementCommand,
    UpdateSupportDomainElementPositionCommand,
    UpdateSupportDomainModelCommand,
    UpdateSupportDomainRelationshipCommand,
)
from ..domain.invariants import ModelDefinitionError, NotFoundError, require
from ..domain.models import (
    LIFECYCLE_STATUSES,
    MODEL_DOMAINS,
    RELATIONSHIP_KINDS,
    TAB_KEYS,
    RelationshipKind,
)
from ..repo.badge_store_repo import BadgeStoreRepo
from ..repo.hierarchy_model_repo import HierarchyModelRepo
from ..repo.cross_model_relationship_type_repo import CrossModelRelationshipTypeRepo
from ..repo.cross_model_relationship_type_diagram_repo import CrossModelRelationshipTypeDiagramRepo
from ..repo.hierarchy_model_node_type_property_repo import HierarchyModelNodeTypePropertyRepo
from ..repo.hierarchy_model_node_type_repo import HierarchyModelNodeTypeRepo
from ..repo.hierarchy_rule_repo import HierarchyRuleRepo
from ..repo.support_domain_diagram_node_repo import SupportDomainDiagramNodeRepo
from ..repo.support_domain_element_repo import SupportDomainElementRepo
from ..repo.support_domain_model_repo import SupportDomainModelRepo
from ..repo.support_domain_relationship_repo import SupportDomainRelationshipRepo


class ModelDefinitionService:
    """Single authoritative command handler for Model workspace configuration."""

    def __init__(
        self,
        *,
        hierarchy_models: HierarchyModelRepo,
        structural_nodes: HierarchyModelNodeTypeRepo,
        hierarchy_node_type_properties: HierarchyModelNodeTypePropertyRepo,
        structural_rules: HierarchyRuleRepo,
        support_domain_models: SupportDomainModelRepo,
        support_domain_elements: SupportDomainElementRepo,
        support_domain_relationships: SupportDomainRelationshipRepo,
        support_domain_diagram_nodes: SupportDomainDiagramNodeRepo,
        badge_store: BadgeStoreRepo,
        cross_model_relationship_types: CrossModelRelationshipTypeRepo | None = None,
        cross_model_relationship_type_diagrams: CrossModelRelationshipTypeDiagramRepo | None = None,
    ) -> None:

        self._hierarchy_models = hierarchy_models
        self._structural_nodes = structural_nodes
        self._hierarchy_node_type_properties = hierarchy_node_type_properties
        self._structural_rules = structural_rules
        self._support_domain_models = support_domain_models
        self._support_domain_elements = support_domain_elements
        self._support_domain_relationships = support_domain_relationships
        self._support_domain_diagram_nodes = support_domain_diagram_nodes
        self._badge_store = badge_store
        self._cross_model_relationship_types = cross_model_relationship_types
        self._cross_model_relationship_type_diagrams = cross_model_relationship_type_diagrams

    def get_metadata(self) -> dict:
        return {
            "tabs": [{"key": key, "label": "Hierarchy Model" if key == "hierarchy_model" else "Support Domain"} for key in TAB_KEYS],
            "owning_domains": [{"key": key, "label": key.replace("_", " ").title()} for key in MODEL_DOMAINS],
            # Stored as "retired", shown as "Archived" (Draft → Active → Archived).
            "lifecycle_statuses": [{"key": key, "label": lifecycle.label(key)} for key in LIFECYCLE_STATUSES],
            "relationship_kinds": [
                {
                    "key": kind.value,
                    "label": kind.label,
                    "description": kind.description,
                }
                for kind in RELATIONSHIP_KINDS
            ],
        }

    def get_badge_metadata(self) -> dict:
        return {
            "shapes": [{"key": s, "label": BADGE_SHAPE_LABELS[s]} for s in BADGE_SHAPES],
            "sizes": list(BADGE_SIZES),
            "icons": [{"key": i, "label": BADGE_ICON_LABELS[i]} for i in BADGE_ICONS],
            "content_types": [{"key": ct, "label": BADGE_CONTENT_TYPE_LABELS[ct]} for ct in BADGE_CONTENT_TYPES],
            "preset_colors": list(BADGE_PRESET_COLORS),
            "defaults": {
                "badge_text": DEFAULT_BADGE_TEXT,
                "badge_shape": DEFAULT_BADGE_SHAPE,
                "badge_color": DEFAULT_BADGE_COLOR,
                "badge_text_color": DEFAULT_BADGE_TEXT_COLOR,
                "badge_icon": DEFAULT_BADGE_ICON,
                "badge_size": DEFAULT_BADGE_SIZE,
                "badge_content_type": DEFAULT_BADGE_CONTENT_TYPE,
            },
        }

    # ── Badge – hierarchy nodes ────────────────────────────────────────────────

    def get_hierarchy_node_badge(self, node_id: str) -> dict:
        node = self._require_structural_node(node_id)
        badge = self._badge_store.get_by_owner(
            BadgeStoreRepo.OWNER_HIERARCHY_NODE, node_id
        )
        if badge:
            return badge
        return self._default_badge(
            BadgeStoreRepo.OWNER_HIERARCHY_NODE,
            node_id,
            fallback_badge_text=self._derive_default_badge_text(node.get("name")),
        )

    def save_hierarchy_node_badge(self, node_id: str, command: SaveBadgeCommand) -> dict:
        node = self._require_structural_node(node_id)
        badge_text = command.badge_text
        if command.badge_content_type == DEFAULT_BADGE_CONTENT_TYPE and not badge_text.strip():
            badge_text = self._derive_default_badge_text(node.get("name"))
        return self._badge_store.upsert(
            BadgeStoreRepo.OWNER_HIERARCHY_NODE,
            node_id,
            badge_text=badge_text,
            badge_shape=command.badge_shape,
            badge_color=command.badge_color,
            badge_text_color=command.badge_text_color,
            badge_icon=command.badge_icon,
            badge_size=command.badge_size,
            badge_content_type=command.badge_content_type,
        )

    # ── Badge – support domain elements ───────────────────────────────────────

    def get_support_domain_element_badge(self, element_id: str) -> dict:
        self._require_support_domain_element(element_id)
        badge = self._badge_store.get_by_owner(
            BadgeStoreRepo.OWNER_SUPPORT_ELEMENT, element_id
        )
        return badge or self._default_badge(BadgeStoreRepo.OWNER_SUPPORT_ELEMENT, element_id)

    def save_support_domain_element_badge(self, element_id: str, command: SaveBadgeCommand) -> dict:
        self._require_support_domain_element(element_id)
        return self._badge_store.upsert(
            BadgeStoreRepo.OWNER_SUPPORT_ELEMENT,
            element_id,
            badge_text=command.badge_text,
            badge_shape=command.badge_shape,
            badge_color=command.badge_color,
            badge_text_color=command.badge_text_color,
            badge_icon=command.badge_icon,
            badge_size=command.badge_size,
            badge_content_type=command.badge_content_type,
        )

    @staticmethod
    def _default_badge(
        owner_entity_type: str,
        owner_entity_id: str,
        *,
        fallback_badge_text: str = DEFAULT_BADGE_TEXT,
    ) -> dict:
        return {
            "badge_store_id": None,
            "owner_entity_type": owner_entity_type,
            "owner_entity_id": owner_entity_id,
            "badge_text": fallback_badge_text,
            "badge_shape": DEFAULT_BADGE_SHAPE,
            "badge_color": DEFAULT_BADGE_COLOR,
            "badge_text_color": DEFAULT_BADGE_TEXT_COLOR,
            "badge_icon": DEFAULT_BADGE_ICON,
            "badge_size": DEFAULT_BADGE_SIZE,
            "badge_content_type": DEFAULT_BADGE_CONTENT_TYPE,
        }

    @staticmethod
    def _derive_default_badge_text(name: str | None) -> str:
        trimmed = (name or "").strip()
        return trimmed[:1].upper() if trimmed else DEFAULT_BADGE_TEXT

    # Hierarchy models
    def list_models(self) -> list[dict]:
        return self._hierarchy_models.list_models()

    def get_model(self, model_id: str) -> dict | None:
        return self._hierarchy_models.get_model(model_id)

    def create_model(self, command: CreateHierarchyModelCommand) -> dict:
        model = self._hierarchy_models.insert_model(command.model_dump())
        self._create_root_node_type(model)
        return model

    def _guard_lifecycle(self, kind: lifecycle.Kind, **kwargs) -> None:
        """A model or type cannot leave Active while Draft or Active instances depend on it."""
        try:
            lifecycle.require_definition_status_change(self._hierarchy_models._db, kind, **kwargs)
        except lifecycle.LifecycleError as exc:
            raise ModelDefinitionError(str(exc)) from exc

    def update_model(self, model_id: str, command: UpdateHierarchyModelCommand) -> dict:
        existing = self._require_hierarchy_model(model_id)
        self._guard_lifecycle("node", what="Hierarchy model", name=existing["name"], current_status=existing.get("status"), new_status=command.status, model_id=model_id)
        updated = self._hierarchy_models.update_model(model_id, command.model_dump())
        if command.name != existing["name"]:
            self._sync_root_node_type_name(model_id, command.name)
            self._sync_root_instance_name(model_id, command.name)
        return updated

    def delete_model(self, model_id: str) -> None:
        self._require_hierarchy_model(model_id)
        self._hierarchy_models.delete_model(model_id)

    def get_model_delete_impact(self, model_id: str) -> dict:
        self._require_hierarchy_model(model_id)
        impact = self._hierarchy_models.get_delete_impact(model_id)
        if impact is None:
            raise NotFoundError("Hierarchy model was not found.")
        return impact

    # Structural nodes
    @staticmethod
    def _nest_node_badge(row: dict) -> dict:
        """Lift flat badge_* columns into a nested 'badge' dict."""
        badge = {
            "badge_store_id": row.pop("badge_store_id", None),
            "badge_text": row.pop("badge_text", "") or "",
            "badge_shape": row.pop("badge_shape", DEFAULT_BADGE_SHAPE) or DEFAULT_BADGE_SHAPE,
            "badge_color": row.pop("badge_color", DEFAULT_BADGE_COLOR) or DEFAULT_BADGE_COLOR,
            "badge_text_color": row.pop("badge_text_color", DEFAULT_BADGE_TEXT_COLOR) or DEFAULT_BADGE_TEXT_COLOR,
            "badge_icon": row.pop("badge_icon", None),
            "badge_size": row.pop("badge_size", DEFAULT_BADGE_SIZE) or DEFAULT_BADGE_SIZE,
            "badge_content_type": row.pop("badge_content_type", DEFAULT_BADGE_CONTENT_TYPE) or DEFAULT_BADGE_CONTENT_TYPE,
        }
        row["badge"] = badge
        return row

    def list_structural_nodes(self, *, model_id: str) -> list[dict]:
        self._require_hierarchy_model(model_id)
        return [self._nest_node_badge(row) for row in self._structural_nodes.list_nodes(model_id=model_id)]

    def get_structural_node(self, node_id: str) -> dict | None:
        row = self._structural_nodes.get_node(node_id)
        return self._nest_node_badge(row) if row else None

    def create_structural_node(self, command: CreateHierarchyNodeTypeCommand) -> dict:
        self._validate_node_payload(command.model_id, command.parent_node_id, None)
        node = self._structural_nodes.insert_node(command.model_dump())
        if node["parent_node_id"]:
            self._sync_parent_child_rule(command.model_id, node["parent_node_id"], node["node_id"], status=node["status"])
        if node.get("is_recursive"):
            self._sync_parent_child_rule(command.model_id, node["node_id"], node["node_id"], status=node["status"])
        return self._nest_node_badge(node)

    def update_structural_node(self, node_id: str, command: UpdateHierarchyNodeTypeCommand) -> dict:
        existing = self._require_structural_node(node_id)
        self._validate_node_payload(command.model_id, command.parent_node_id, node_id)
        self._guard_lifecycle("node", what="Node type", name=existing["name"], current_status=existing.get("status"), new_status=command.status, type_id=node_id)

        if command.is_property and not existing.get("is_property"):
            children = [
                node for node in self._structural_nodes.list_nodes(model_id=command.model_id)
                if node["parent_node_id"] == node_id
            ]
            if children:
                named = ", ".join(sorted(child["name"] for child in children))
                raise ModelDefinitionError(
                    f"“{existing['name']}” already has {len(children)} child node "
                    f"type{'' if len(children) == 1 else 's'} ({named}). A property node "
                    "holds a value rather than a level, so remove or re-parent them before "
                    "marking it as one."
                )

        recursive_disable_impact: dict | None = None
        disabling_recursive_rule = bool(existing.get("is_recursive")) and not command.is_recursive
        if disabling_recursive_rule:
            recursive_disable_impact = self._structural_nodes.get_recursive_disable_impact(node_id)
            if recursive_disable_impact.get("affected_instance_count", 0) > 0 and not command.confirm_recursive_removal:
                raise ModelDefinitionError(
                    "Recursive Structure Workspace usage exists for this node type. "
                    "Review the recursive impact and confirm removal to continue."
                )

        updated = self._structural_nodes.update_node(node_id, command.model_dump())

        if existing["parent_node_id"] and existing["parent_node_id"] != updated["parent_node_id"]:
            self._structural_rules.delete_rule_for_edge(
                model_id=existing["model_id"],
                parent_node_id=existing["parent_node_id"],
                child_node_id=node_id,
            )

        if updated["parent_node_id"]:
            self._sync_parent_child_rule(updated["model_id"], updated["parent_node_id"], updated["node_id"], status=updated["status"])

        # Sync self-referential recursive rule
        if updated.get("is_recursive"):
            self._sync_parent_child_rule(updated["model_id"], updated["node_id"], updated["node_id"], status=updated["status"])
        else:
            if disabling_recursive_rule and recursive_disable_impact and recursive_disable_impact.get("affected_instance_count", 0) > 0:
                self._structural_nodes.remove_recursive_structure_instances(node_id)
            self._structural_rules.delete_rule_for_edge(
                model_id=updated["model_id"],
                parent_node_id=node_id,
                child_node_id=node_id,
            )

        return self._nest_node_badge(updated)

    def delete_structural_node(self, node_id: str) -> None:
        existing = self._require_structural_node(node_id)
        require(existing["parent_node_id"] is not None, "The root node type cannot be deleted.")
        self._structural_nodes.delete_governed_node(node_id)

    def get_structural_node_delete_impact(self, node_id: str) -> dict:
        self._require_structural_node(node_id)
        return self._structural_nodes.get_delete_impact(node_id)

    def get_structural_node_recursive_disable_impact(self, node_id: str) -> dict:
        self._require_structural_node(node_id)
        return self._structural_nodes.get_recursive_disable_impact(node_id)

    def get_structural_node_reparent_impact(self, node_id: str, new_parent_node_id: str | None) -> dict:
        existing = self._require_structural_node(node_id)
        if new_parent_node_id is not None:
            parent = self._require_structural_node(new_parent_node_id)
            require(parent["model_id"] == existing["model_id"], "Target parent must belong to the same hierarchy model.")
        return self._structural_nodes.get_reparent_impact(node_id, new_parent_node_id)

    def list_hierarchy_node_type_properties(self, *, node_id: str, model_id: str | None = None) -> list[dict]:
        self._require_structural_node_in_model(node_id, model_id)
        return self._hierarchy_node_type_properties.list_properties(node_type_id=node_id)

    def create_hierarchy_node_type_property(
        self,
        node_id: str,
        command: CreateHierarchyNodeTypePropertyCommand,
        *,
        model_id: str | None = None,
    ) -> dict:
        self._require_structural_node_in_model(node_id, model_id)
        require(command.node_type_id == node_id, "Property payload must belong to selected node type.")
        return self._hierarchy_node_type_properties.insert_property(command.model_dump())

    def update_hierarchy_node_type_property(
        self,
        node_id: str,
        property_id: str,
        command: UpdateHierarchyNodeTypePropertyCommand,
        *,
        model_id: str | None = None,
    ) -> dict:
        self._require_structural_node_in_model(node_id, model_id)
        existing = self._require_hierarchy_node_type_property(property_id)
        require(existing["node_type_id"] == node_id, "Node type property must belong to selected node type.")
        require(command.node_type_id == node_id, "Property payload must belong to selected node type.")
        return self._hierarchy_node_type_properties.update_property(property_id, command.model_dump())

    def delete_hierarchy_node_type_property(
        self,
        node_id: str,
        property_id: str,
        *,
        model_id: str | None = None,
    ) -> None:
        self._require_structural_node_in_model(node_id, model_id)
        existing = self._require_hierarchy_node_type_property(property_id)
        require(existing["node_type_id"] == node_id, "Node type property must belong to selected node type.")
        self._hierarchy_node_type_properties.delete_property(property_id)

    def get_hierarchy_node_type_property_delete_impact(
        self,
        node_id: str,
        property_id: str,
        *,
        model_id: str | None = None,
    ) -> dict:
        self._require_structural_node_in_model(node_id, model_id)
        existing = self._require_hierarchy_node_type_property(property_id)
        require(existing["node_type_id"] == node_id, "Node type property must belong to selected node type.")
        impact = self._hierarchy_node_type_properties.get_delete_impact(property_id)
        require(impact is not None, "Node type property not found.")
        return impact

    def reorder_structural_node(self, node_id: str, command: ReorderHierarchyNodeTypeCommand) -> dict:
        existing = self._require_structural_node(node_id)

        if command.new_parent_node_id is not None:
            # Target parent must exist and belong to the same model.
            parent = self._require_structural_node(command.new_parent_node_id)
            require(parent["model_id"] == existing["model_id"], "Target parent must belong to the same hierarchy model.")
            # Prevent cycles: target parent cannot be a descendant of the moved node.
            descendant_ids = self._structural_nodes.list_descendant_ids(node_id)
            require(command.new_parent_node_id not in descendant_ids, "A node cannot be reparented beneath one of its own descendants.")
        else:
            # Moving to root: validate a root does not already exist under this model (unless this node is already the root).
            current_root_count = self._structural_nodes.count_roots(existing["model_id"], excluding_node_id=node_id)
            require(current_root_count == 0, "A hierarchy model can only have one root node.")

        old_parent_id = existing["parent_node_id"]

        # Assess and govern the impact on existing Structure Workspace instances.
        reparent_plan: list[dict] = []
        if old_parent_id != command.new_parent_node_id:
            impact = self._structural_nodes.get_reparent_impact(node_id, command.new_parent_node_id)
            summary = impact["impact_summary"]
            if summary["affected_instance_count"] > 0:
                require(
                    command.confirm_instance_reparent,
                    "This reparent affects existing Structure Workspace node instances and requires confirmation.",
                )
                require(
                    summary["resolvable"],
                    "This reparent cannot be resolved: some affected instances have no candidate parent of the "
                    "new type. Resolve them first (for example via Structure Workspace import), then retry.",
                )
                # Validate the user's chosen parent for each affected instance against the offered candidates.
                assignments = {a.instance_id: a.new_parent_instance_id for a in command.instance_parent_assignments}
                for item in impact["impact_reparent_plan_items"]:
                    instance_id = item["instance_id"]
                    if instance_id not in assignments:
                        raise ModelDefinitionError(f"Missing new-parent selection for instance '{item['instance_name']}'.")
                    chosen = assignments[instance_id]
                    if summary["new_parent_is_root"]:
                        require(chosen is None, f"'{item['instance_name']}' must become a root (no parent).")
                    else:
                        valid_parent_ids = {c["instance_id"] for c in item["candidate_parents"]}
                        require(
                            chosen in valid_parent_ids,
                            f"The selected parent for '{item['instance_name']}' is not a valid option.",
                        )
                    reparent_plan.append({"instance_id": instance_id, "new_parent_instance_id": chosen})

        updated = self._structural_nodes.reorder_node(
            node_id, command.new_parent_node_id, command.position, reparent_plan=reparent_plan
        )

        # Sync structural rules when the parent changes (reparent).
        if old_parent_id != command.new_parent_node_id:
            if old_parent_id:
                self._structural_rules.delete_rule_for_edge(
                    model_id=existing["model_id"],
                    parent_node_id=old_parent_id,
                    child_node_id=node_id,
                )
            if command.new_parent_node_id:
                self._sync_parent_child_rule(
                    existing["model_id"],
                    command.new_parent_node_id,
                    node_id,
                    status=updated["status"],
                )

        return updated

    def get_structural_tree(self, model_id: str) -> list[dict]:
        nodes = self.list_structural_nodes(model_id=model_id)
        by_id = {
            node["node_id"]: {
                "id": node["node_id"],
                "model_id": node["model_id"],
                "parent_node_id": node["parent_node_id"],
                "name": node["name"],
                "display_name": node.get("display_name", ""),
                "badge": node.get("badge", ""),
                "description": node["description"],
                "sort_order": node["sort_order"],
                "status": node["status"],
                "children": [],
            }
            for node in nodes
        }
        roots: list[dict] = []
        for node in sorted(by_id.values(), key=lambda item: (item["sort_order"], item["name"])):
            parent_id = node["parent_node_id"]
            if parent_id and parent_id in by_id:
                by_id[parent_id]["children"].append(node)
            else:
                roots.append(node)
        return roots

    # Structural rules
    def list_structural_rules(self, *, model_id: str | None = None, owning_domain: str | None = None) -> list[dict]:
        return self._structural_rules.list_structural_rules(model_id=model_id, owning_domain=owning_domain)

    def get_structural_rule(self, rule_id: str) -> dict | None:
        return self._structural_rules.get_structural_rule(rule_id)

    def create_structural_rule(self, command: CreateHierarchyRuleCommand) -> dict:
        self._validate_rule_references(command.model_id, command.parent_node_id, command.child_node_id)
        return self._structural_rules.insert_structural_rule(command.model_dump())

    def update_structural_rule(self, rule_id: str, command: UpdateHierarchyRuleCommand) -> dict:
        require(self._structural_rules.get_structural_rule(rule_id) is not None, "Hierarchy rule not found.")
        self._validate_rule_references(command.model_id, command.parent_node_id, command.child_node_id)
        return self._structural_rules.update_structural_rule(rule_id, command.model_dump())

    def delete_structural_rule(self, rule_id: str) -> None:
        require(self._structural_rules.get_structural_rule(rule_id) is not None, "Hierarchy rule not found.")
        self._structural_rules.delete_rule(rule_id)

    # Support domain models
    def list_support_domain_models(self) -> list[dict]:
        return self._support_domain_models.list_models()

    def get_support_domain_model(self, model_id: str) -> dict | None:
        return self._support_domain_models.get_model(model_id)

    def create_support_domain_model(self, command: CreateSupportDomainModelCommand) -> dict:
        return self._support_domain_models.insert_model(command.model_dump())

    def update_support_domain_model(self, model_id: str, command: UpdateSupportDomainModelCommand) -> dict:
        existing = self._require_support_domain_model(model_id)
        self._guard_lifecycle("element", what="Support domain model", name=existing["name"], current_status=existing.get("status"), new_status=command.status, model_id=model_id)
        return self._support_domain_models.update_model(model_id, command.model_dump())

    def delete_support_domain_model(self, model_id: str) -> None:
        self._require_support_domain_model(model_id)
        self._support_domain_models.delete_model(model_id)

    def get_support_domain_model_delete_impact(self, model_id: str) -> dict:
        self._require_support_domain_model(model_id)
        impact = self._support_domain_models.get_delete_impact(model_id)
        if impact is None:
            raise NotFoundError("Support domain model not found.")
        return impact

    # Support domain elements
    def list_support_domain_elements(self, *, model_id: str) -> list[dict]:
        self._require_support_domain_model(model_id)
        return [self._nest_node_badge(row) for row in self._support_domain_elements.list_elements(model_id=model_id)]

    def get_support_domain_element(self, element_id: str) -> dict | None:
        row = self._support_domain_elements.get_element(element_id)
        return self._nest_node_badge(row) if row else None

    def create_support_domain_element(self, command: CreateSupportDomainElementCommand) -> dict:
        self._require_support_domain_model(command.model_id)
        element = self._support_domain_elements.insert_element(command.model_dump())
        self._support_domain_diagram_nodes.create_diagram_nodes_for_model(model_id=command.model_id)
        return element

    def update_support_domain_element(self, element_id: str, command: UpdateSupportDomainElementCommand) -> dict:
        existing = self._support_domain_elements.get_element(element_id)
        require(existing is not None, "Support domain element not found.")
        self._require_support_domain_model(command.model_id)
        self._guard_lifecycle("element", what="Element type", name=existing["name"], current_status=existing.get("status"), new_status=command.status, type_id=element_id)
        return self._support_domain_elements.update_element(element_id, command.model_dump())
    
    def update_support_domain_element_position(self, element_id: str, command: UpdateSupportDomainElementPositionCommand) -> dict:
        require(self._support_domain_elements.get_element(element_id) is not None, "Support domain element not found.")
        node = self._support_domain_diagram_nodes.update_element_position(element_id, command.x, command.y)
        require(node is not None, "Support domain diagram node not found.")
        return self._support_domain_elements.get_element(element_id)
    
    def list_support_domain_diagram_nodes(self, *, model_id: str) -> list[dict]:
        self._require_support_domain_model(model_id)
        return self._support_domain_diagram_nodes.list_nodes_for_model(model_id=model_id)

    def create_support_domain_diagram_nodes(self, command: CreateSupportDomainDiagramNodesCommand) -> list[dict]:
        self._require_support_domain_model(command.model_id)
        return self._support_domain_diagram_nodes.create_diagram_nodes_for_model(model_id=command.model_id)

    def delete_support_domain_element(self, element_id: str) -> None:
        self._require_support_domain_element(element_id)
        self._support_domain_elements.delete_element(element_id)

    def get_support_domain_element_delete_impact(self, element_id: str) -> dict:
        self._require_support_domain_element(element_id)
        impact = self._support_domain_elements.get_delete_impact(element_id)
        if impact is None:
            raise NotFoundError("Support domain element not found.")
        return impact

    # Support domain relationships
    def list_support_domain_relationships(self, *, model_id: str) -> list[dict]:
        self._require_support_domain_model(model_id)
        return self._support_domain_relationships.list_relationships(model_id=model_id)

    def list_support_domain_relationships_for_multiple_models(self, *, model_ids: list[str] | None = None) -> list[dict]:
        for model_id in model_ids or []:
            self._require_support_domain_model(model_id)
        return self._support_domain_relationships.list_relationships_for_multiple_models(model_ids=model_ids)

    def get_support_domain_relationship(self, relationship_id: str) -> dict | None:
        return self._support_domain_relationships.get_relationship(relationship_id)

    def create_support_domain_relationship(self, command: CreateSupportDomainRelationshipCommand) -> dict:
        self._validate_support_domain_relationship(command.model_id, command.source_element_id, command.target_element_id)
        # The same name twice between the same element types is one relationship, not two.
        clash = self._support_domain_relationships.find_relationship(
            command.model_id, command.source_element_id, command.target_element_id, command.relationship_kind
        )
        require(clash is None, "This model already has that relationship between these element types.")
        return self._support_domain_relationships.insert_relationship(command.model_dump())

    def update_support_domain_relationship(self, relationship_id: str, command: UpdateSupportDomainRelationshipCommand) -> dict:
        require(self._support_domain_relationships.get_relationship(relationship_id) is not None, "Support domain relationship not found.")
        self._validate_support_domain_relationship(command.model_id, command.source_element_id, command.target_element_id)
        # Changing the ends or the kind onto a relationship that already exists
        # would break the (model, source, target, kind) uniqueness — say so
        # instead of failing in the database.
        clash = self._support_domain_relationships.find_relationship(
            command.model_id, command.source_element_id, command.target_element_id, command.relationship_kind
        )
        require(clash is None or clash == relationship_id, "This model already has that relationship between these element types.")
        payload = command.model_dump(mode="json")
        return self._support_domain_relationships.update_relationship(relationship_id, payload)

    def delete_support_domain_relationship(self, relationship_id: str) -> None:
        require(self._support_domain_relationships.get_relationship(relationship_id) is not None, "Support domain relationship not found.")
        self._support_domain_relationships.delete_relationship(relationship_id)

    # ── Cross-model relationship types (governance layer) ─────────────────────

    def list_cross_model_relationship_types(self, *, status: str | None = None) -> list[dict]:
        require(self._cross_model_relationship_types is not None, "Cross-model relationship type repo not configured.")
        return self._cross_model_relationship_types.list_types(status=status)

    def get_cross_model_relationship_type(self, relationship_type_id: str) -> dict:
        require(self._cross_model_relationship_types is not None, "Cross-model relationship type repo not configured.")
        result = self._cross_model_relationship_types.get_type(relationship_type_id)
        if result is None:
            raise NotFoundError("Cross-model relationship type not found.")
        return result

    def create_cross_model_relationship_type(self, command: CreateCrossModelRelationshipTypeCommand) -> dict:
        require(self._cross_model_relationship_types is not None, "Cross-model relationship type repo not configured.")
        return self._cross_model_relationship_types.insert_type(command.model_dump())

    def update_cross_model_relationship_type(
        self, relationship_type_id: str, command: UpdateCrossModelRelationshipTypeCommand
    ) -> dict:
        require(self._cross_model_relationship_types is not None, "Cross-model relationship type repo not configured.")
        require(
            self._cross_model_relationship_types.get_type(relationship_type_id) is not None,
            "Cross-model relationship type not found.",
        )
        result = self._cross_model_relationship_types.update_type(relationship_type_id, command.model_dump())
        if result is None:
            raise NotFoundError("Cross-model relationship type not found.")
        return result

    def delete_cross_model_relationship_type(self, relationship_type_id: str) -> None:
        require(self._cross_model_relationship_types is not None, "Cross-model relationship type repo not configured.")
        require(
            self._cross_model_relationship_types.get_type(relationship_type_id) is not None,
            "Cross-model relationship type not found.",
        )
        self._cross_model_relationship_types.delete_type(relationship_type_id)

    def get_cross_model_relationship_type_delete_impact(self, relationship_type_id: str) -> dict:
        require(self._cross_model_relationship_types is not None, "Cross-model relationship type repo not configured.")
        result = self._cross_model_relationship_types.get_delete_impact(relationship_type_id)
        if result is None:
            raise NotFoundError("Cross-model relationship type not found.")
        return result

    # ── Saved cross-model relationship diagrams ───────────────────────────────

    def list_cross_model_relationship_type_diagrams(self) -> list[dict]:
        require(self._cross_model_relationship_type_diagrams is not None, "Cross-model diagram repo not configured.")
        return self._cross_model_relationship_type_diagrams.list_diagrams()

    def get_cross_model_relationship_type_diagram(self, diagram_id: str) -> dict:
        require(self._cross_model_relationship_type_diagrams is not None, "Cross-model diagram repo not configured.")
        result = self._cross_model_relationship_type_diagrams.get_diagram(diagram_id)
        if result is None:
            raise NotFoundError("Saved diagram not found.")
        return result

    def create_cross_model_relationship_type_diagram(self, command: SaveCrossModelRelationshipTypeDiagramCommand) -> dict:
        require(self._cross_model_relationship_type_diagrams is not None, "Cross-model diagram repo not configured.")
        return self._cross_model_relationship_type_diagrams.create_diagram(command.model_dump())

    def update_cross_model_relationship_type_diagram(
        self, diagram_id: str, command: SaveCrossModelRelationshipTypeDiagramCommand
    ) -> dict:
        require(self._cross_model_relationship_type_diagrams is not None, "Cross-model diagram repo not configured.")
        require(
            self._cross_model_relationship_type_diagrams.get_diagram(diagram_id) is not None,
            "Saved diagram not found.",
        )
        result = self._cross_model_relationship_type_diagrams.update_diagram(diagram_id, command.model_dump())
        if result is None:
            raise NotFoundError("Saved diagram not found.")
        return result

    def delete_cross_model_relationship_type_diagram(self, diagram_id: str) -> None:
        require(self._cross_model_relationship_type_diagrams is not None, "Cross-model diagram repo not configured.")
        require(
            self._cross_model_relationship_type_diagrams.get_diagram(diagram_id) is not None,
            "Saved diagram not found.",
        )
        self._cross_model_relationship_type_diagrams.delete_diagram(diagram_id)

    # Validation helpers
    def _require_hierarchy_model(self, model_id: str) -> dict:
        model = self._hierarchy_models.get_model(model_id)
        if model is None:
            raise NotFoundError("Hierarchy model not found.")
        return model

    def _require_structural_node(self, node_id: str) -> dict:
        node = self._structural_nodes.get_node(node_id)
        if node is None:
            raise NotFoundError("Hierarchy node not found.")
        return node

    def _require_structural_node_in_model(self, node_id: str, model_id: str | None) -> dict:
        node = self._require_structural_node(node_id)
        if model_id is not None:
            self._require_hierarchy_model(model_id)
            require(node["model_id"] == model_id, "Node type must belong to selected hierarchy model.")
        return node

    def _require_hierarchy_node_type_property(self, property_id: str) -> dict:
        prop = self._hierarchy_node_type_properties.get_property(property_id)
        if prop is None:
            raise NotFoundError("Node type property not found.")
        return prop

    def _require_support_domain_model(self, model_id: str) -> dict:
        model = self._support_domain_models.get_model(model_id)
        if model is None:
            raise NotFoundError("Support domain model not found.")
        return model

    def _require_support_domain_element(self, element_id: str) -> dict:
        element = self._support_domain_elements.get_element(element_id)
        if element is None:
            raise NotFoundError("Support domain element not found.")
        return element

    def _validate_node_payload(self, model_id: str, parent_node_id: str | None, current_node_id: str | None) -> None:
        self._require_hierarchy_model(model_id)
        if parent_node_id is None:
            require(
                self._structural_nodes.count_roots(model_id, excluding_node_id=current_node_id) == 0,
                "A hierarchy model can only have one root node.",
            )
            return

        parent = self._require_structural_node(parent_node_id)
        require(parent["model_id"] == model_id, "Parent node must belong to the selected hierarchy model.")
        # A property node holds a value, not a level. The screen hides "add
        # child" on one, but the screen can be stale and a model is edited
        # from more than one place, so the refusal lives here too.
        require(
            not parent.get("is_property"),
            f"“{parent['name']}” is a property node, so nothing can be placed beneath it. "
            "Clear “Is property node” on that type first if it is meant to have children.",
        )
        if current_node_id is None:
            return
        require(parent_node_id != current_node_id, "A hierarchy node cannot parent itself.")
        descendant_ids = self._structural_nodes.list_descendant_ids(current_node_id)
        require(parent_node_id not in descendant_ids, "A hierarchy node cannot be reparented beneath one of its descendants.")

    # Root node type helpers
    def _create_root_node_type(self, model: dict) -> dict:
        """Create the mandatory root node type for a newly created hierarchy model."""
        model_id = model["model_id"]
        node_id = f"nt_{model_id}_root"
        return self._structural_nodes.insert_node({
            "node_id": node_id,
            "model_id": model_id,
            "parent_node_id": None,
            "name": model["name"],
            "display_name": model["name"],
            "description": f"Root node type for {model['name']} hierarchy.",
            "sort_order": 0,
            "status": "active",
        })

    def _sync_root_node_type_name(self, model_id: str, new_name: str) -> None:
        """Keep root node type name in sync with the model name."""
        nodes = self._structural_nodes.list_nodes(model_id=model_id)
        roots = [n for n in nodes if n["parent_node_id"] is None]
        for root in roots:
            self._structural_nodes.update_node(root["node_id"], {
                **root,
                "name": new_name,
                "display_name": new_name,
            })

    def _sync_root_instance_name(self, model_id: str, new_name: str) -> None:
        """Keep root node instance name in sync with the model name."""
        self._hierarchy_models._db.execute(
            """
            UPDATE hierarchy_model_node_instance
            SET name = %s, updated_at = current_timestamp
            WHERE model_id = %s AND parent_node_id IS NULL
            """,
            (new_name, model_id),
        )

    def _sync_parent_child_rule(self, model_id: str, parent_node_id: str, child_node_id: str, *, status: str) -> dict:
        is_self = parent_node_id == child_node_id
        return self._structural_rules.insert_structural_rule(
            {
                "model_id": model_id,
                "parent_node_type_id": parent_node_id,
                "child_node_type_id": child_node_id,
                "relationship_kind": RelationshipKind.recursive if is_self else RelationshipKind.parent_child,
                "notes": "Derived from hierarchy tree authoring.",
                "status": status,
            }
        )

    def _validate_rule_references(self, model_id: str, parent_node_id: str, child_node_id: str) -> None:
        self._require_hierarchy_model(model_id)
        parent = self._require_structural_node(parent_node_id)
        child = self._require_structural_node(child_node_id)
        require(parent["model_id"] == model_id, "Parent node must belong to selected hierarchy model.")
        require(child["model_id"] == model_id, "Child node must belong to selected hierarchy model.")
        require(parent_node_id != child_node_id, "Parent and child nodes cannot be identical.")

    def _validate_support_domain_relationship(self, model_id: str, source_element_id: str, target_element_id: str) -> None:
        self._require_support_domain_model(model_id)
        source = self._support_domain_elements.get_element(source_element_id)
        target = self._support_domain_elements.get_element(target_element_id)
        require(source is not None, "Source support domain element must exist.")
        require(target is not None, "Target support domain element must exist.")
        require(source["support_domain_model_id"] == model_id, "Source support domain element must belong to selected model.")
        require(target["support_domain_model_id"] == model_id, "Target support domain element must belong to selected model.")
        require(source_element_id != target_element_id, "Source and target support domain elements cannot be identical.")
