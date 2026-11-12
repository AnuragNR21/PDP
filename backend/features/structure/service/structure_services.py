
from features.structure.domain.models import (
    CanonicalNodeSummary,
    CreateCanonicalNodeCommand,
    CreateCrossModelInstanceCommand,
    CreateElementInstanceCommand,
    CreateRelationshipCommand,
    DiagramProjectionResponse,
    MatrixProjectionResponse,
    NodeDetail,
    ReorderNodeCommand,
    ReparentNodeCommand,
    StructurePathResponse,
    StructureTreeResponse,
    UpdateCanonicalNodeCommand,
    UpdateElementInstanceCommand,
    UpsertInstancePropertyCommand,
)
from features.structure.repo.cross_model_instance_repo import CrossModelInstanceRepository
from shared import lifecycle
from shared.db import get_connection
from shared.model_config import HIERARCHY_MODEL
from features.structure.repo.cross_model_instance_diagram_repo import CrossModelInstanceDiagramRepository
from features.structure.repo.element_instance_property_repo import ElementInstancePropertyRepo
from features.structure.repo.node_instance_property_repo import NodeInstancePropertyRepo
from features.structure.repo.structure_repository import StructureRepository
from features.structure.repo.support_domain_instance_repo import SupportDomainInstanceRepository
from shared.contracts.refresh import RefreshRequest
from shared.db import get_connection


class ProjectionCoordinationService:
    def build_refresh(self, *, entity_id: str) -> RefreshRequest:
        return RefreshRequest(
            scope='entity',
            reason='Authoritative structure mutation completed.',
            targets=[entity_id],
        )


class CanonicalNodeService:
    def __init__(self, db_url: str):
        self._repository = StructureRepository(db_url)
        self._projection_coordination = ProjectionCoordinationService()

    def list_nodes(self, *, parent_node_id: str | None = None, model_id: str | None = None) -> StructureTreeResponse:
        if model_id is not None:
            return StructureTreeResponse(items=self._repository.list_nodes_for_model(model_id))
        return StructureTreeResponse(items=self._repository.list_nodes(parent_node_id=parent_node_id))

    def ensure_root_instance(self, model_id: str) -> CanonicalNodeSummary:
        """Return the root node instance for a model, creating it if absent."""
        existing = self._repository.get_root_instance_for_model(model_id)
        if existing is not None:
            return existing
        root_node_type = self._repository.get_root_node_type_for_model(model_id)
        if root_node_type is None:
            raise ValueError('No root node type found for this model. Configure the model first.')
        # The root is a new instance like any other: only from an Active model and type.
        with get_connection(self._repository._db_url) as conn:
            lifecycle.require_can_instantiate(conn, "node", model_id, root_node_type['node_type_id'])
        return self._repository.create_root_instance(
            model_id=model_id,
            node_type_id=root_node_type['node_type_id'],
            name=root_node_type['name'],
        )

    def get_node_detail(self, node_id: str) -> NodeDetail:
        node = self._repository.get_node(node_id)
        if node is None:
            raise ValueError('Node was not found.')
        return NodeDetail(
            node=node,
            children=self._repository.list_nodes(parent_node_id=node_id),
            relationships=self._repository.list_relationships_for_node(node_id),
        )

    def create_node(self, command: CreateCanonicalNodeCommand) -> dict[str, object]:
        # Only Active models and node types can be instantiated.
        node_type_status = self._repository.get_node_type_status(command.node_type_id)
        if node_type_status is None:
            raise ValueError('Node type does not exist.')
        with get_connection(self._repository._db_url) as conn:
            lifecycle.require_can_instantiate(conn, "node", command.model_id, command.node_type_id)
            if command.parent_node_id is not None:
                parent_row = conn.execute(
                    "SELECT name, status FROM hierarchy_model_node_instance WHERE node_instance_id = %s", (command.parent_node_id,)
                ).fetchone()
                if parent_row is not None and parent_row["status"] == lifecycle.ARCHIVED:
                    raise lifecycle.LifecycleError(f"'{parent_row['name']}' is Archived, so nothing new can be added beneath it.")

        if command.parent_node_id is None:
            raise ValueError('parent_node_id is required. Use ensure_root_instance to create the root node.')

        parent = self._repository.get_node(command.parent_node_id)
        if parent is None:
            raise ValueError('Parent node was not found.')
        if parent.model_id != command.model_id:
            raise ValueError('Parent node belongs to a different model.')
        # The parent's *type* decides this, not the instance: a property node
        # type is a leaf everywhere, in every model that uses it.
        if self._repository.node_type_is_property(parent.node_type_id):
            raise ValueError(
                "The parent is a property node, so nothing can be placed beneath it. "
                "A property holds a value rather than a level of the hierarchy."
            )
        rule = self._repository.get_active_parent_child_rule(
            model_id=command.model_id,
            parent_node_type_id=parent.node_type_id,
            child_node_type_id=command.node_type_id,
        )
        if rule is None:
            raise ValueError('Active model rules do not permit this parent-child combination.')
        created = self._repository.create_node(command)
        return {
            'node': created,
            'refresh': self._projection_coordination.build_refresh(entity_id=created.node_id),
        }

    def update_node(self, node_id: str, command: UpdateCanonicalNodeCommand) -> dict[str, object]:
        if command.status is not None:
            current = self._repository.get_node(node_id)
            if current is None:
                raise ValueError('Node was not found.')
            if command.status != current.status:
                with get_connection(self._repository._db_url) as conn:
                    lifecycle.require_instance_status(conn, "node", current.model_id, current.node_type_id, command.status, current.name)
        updated = self._repository.update_node(node_id, command)
        return {
            'node': updated,
            'refresh': self._projection_coordination.build_refresh(entity_id=node_id),
        }

    def get_node_delete_impact(self, node_id: str) -> dict:
        impact = self._repository.get_node_delete_impact(node_id)
        if impact is None:
            raise ValueError('Node was not found.')
        return impact

class HierarchyService:
    def __init__(self, db_url: str):
        self._repository = StructureRepository(db_url)
        self._projection_coordination = ProjectionCoordinationService()

    def roots(self) -> StructureTreeResponse:
        return StructureTreeResponse(items=self._repository.list_nodes(parent_node_id=None))

    def children(self, parent_node_id: str) -> StructureTreeResponse:
        return StructureTreeResponse(items=self._repository.list_nodes(parent_node_id=parent_node_id))

    def path(self, node_id: str) -> StructurePathResponse:
        if not self._repository.node_exists(node_id):
            raise ValueError('Node was not found.')
        return StructurePathResponse(items=self._repository.get_path(node_id))

    def delete(self, node_id: str) -> None:
        self._repository.delete_node_instance(node_id)

    def reparent(self, command: ReparentNodeCommand) -> dict[str, object]:
        if not self._repository.node_exists(command.node_id):
            raise ValueError('Node was not found.')
        node = self._repository.get_node(command.node_id)
        if node is not None and node.parent_node_id is None:
            raise ValueError('The root node cannot be reparented.')
        if command.new_parent_node_id is not None:
            if not self._repository.node_exists(command.new_parent_node_id):
                raise ValueError('New parent node was not found.')
            # Moving changes a parent → child relationship: both ends must be authorable.
            with get_connection(self._repository._db_url) as conn:
                lifecycle.require_authorable(conn, "node", command.node_id)
                lifecycle.require_authorable(conn, "node", command.new_parent_node_id)
            if self._repository.has_path(command.node_id, command.new_parent_node_id):
                raise ValueError('Reparent would create a cycle.')
            model_id = self._repository.get_model_id(command.node_id)
            parent_model_id = self._repository.get_model_id(command.new_parent_node_id)
            if model_id != parent_model_id:
                raise ValueError('Node and new parent must belong to the same model.')
            child_node_type_id = self._repository.get_node_type_id(command.node_id)
            parent_node_type_id = self._repository.get_node_type_id(command.new_parent_node_id)
            if not model_id or not child_node_type_id or not parent_node_type_id:
                raise ValueError('Canonical context could not be resolved.')
            rule = self._repository.get_active_parent_child_rule(
                model_id=model_id,
                parent_node_type_id=parent_node_type_id,
                child_node_type_id=child_node_type_id,
            )
            if rule is None:
                raise ValueError('Active model rules do not permit this reparent action.')
        node = self._repository.reparent_node(
            node_id=command.node_id,
            new_parent_node_id=command.new_parent_node_id,
            requested_position=command.requested_position,
        )
        return {
            'node': node,
            'refresh': self._projection_coordination.build_refresh(entity_id=node.node_id),
        }

    def reorder(self, command: ReorderNodeCommand) -> dict[str, object]:
        reordered = self._repository.reorder_siblings(command)
        targets = [item.node_id for item in reordered]
        return {
            'items': reordered,
            'refresh': RefreshRequest(
                scope='projection',
                reason='Sibling ordering changed.',
                targets=targets,
            ),
        }


class RelationshipService:
    def __init__(self, db_url: str):
        self._repository = StructureRepository(db_url)
        self._projection_coordination = ProjectionCoordinationService()

    def create_relationship(self, command: CreateRelationshipCommand) -> dict[str, object]:
        if command.source_node_id == command.target_node_id:
            raise ValueError('A relationship requires distinct source and target nodes.')
        if not self._repository.node_exists(command.source_node_id) or not self._repository.node_exists(
            command.target_node_id
        ):
            raise ValueError('Relationship endpoints must exist.')
        created = self._repository.create_relationship(command)
        return {
            'relationship': created,
            'refresh': self._projection_coordination.build_refresh(entity_id=created.relationship_id),
        }

    def delete_relationship(self, relationship_id: str) -> dict[str, object]:
        self._repository.delete_relationship(relationship_id)
        return {
            'relationship_id': relationship_id,
            'refresh': self._projection_coordination.build_refresh(entity_id=relationship_id),
        }


class ProjectionService:
    def __init__(self, db_url: str):
        self._repository = StructureRepository(db_url)

    def diagram(self, model_id: str) -> DiagramProjectionResponse:
        return DiagramProjectionResponse(projection=self._repository.build_diagram_projection(model_id))

    def matrix(self, model_id: str) -> MatrixProjectionResponse:
        return MatrixProjectionResponse(projection=self._repository.build_matrix_projection(model_id))


class ElementInstanceService:
    def __init__(self, db_url: str):
        self._repo = SupportDomainInstanceRepository(db_url)

    def list_instances(self, model_id: str | None = None) -> list[dict]:
        return self._repo.list_instances(model_id=model_id)

    def get_instance(self, instance_id: str) -> dict | None:
        return self._repo.get_instance(instance_id)

    def get_instance_delete_impact(self, instance_id: str) -> dict:
        impact = self._repo.get_instance_delete_impact(instance_id)
        if impact is None:
            raise ValueError('Instance not found.')
        return impact

    def get_model_delete_impact(self, model_id: str) -> dict:
        impact = self._repo.get_model_delete_impact(model_id)
        if impact is None:
            raise ValueError('Support domain model not found.')
        return impact

    def delete_model(self, model_id: str) -> None:
        if self._repo.get_model_delete_impact(model_id) is None:
            raise ValueError('Support domain model not found.')
        self._repo.delete_model(model_id)

    def create_instance(self, command: CreateElementInstanceCommand) -> dict:
        with get_connection(self._repo._db_url) as conn:
            lifecycle.require_can_instantiate(conn, "element", command.support_domain_model_id, command.element_type_id)
        return self._repo.create_instance(
            support_domain_model_id=command.support_domain_model_id,
            element_type_id=command.element_type_id,
            name=command.name,
            description=command.description,
        )

    def update_instance(self, instance_id: str, command: UpdateElementInstanceCommand) -> dict:
        if command.status is not None:
            current = self._repo.get_instance(instance_id)
            if current is None:
                raise ValueError('Instance not found.')
            if command.status != current['status']:
                with get_connection(self._repo._db_url) as conn:
                    lifecycle.require_instance_status(
                        conn, "element", current['support_domain_model_id'], current['element_type_id'], command.status, current['name']
                    )
        result = self._repo.update_instance(instance_id, command.name, command.description, command.status)
        if result is None:
            raise ValueError('Instance not found.')
        return result

    def delete_instance(self, instance_id: str) -> None:
        existing = self._repo.get_instance(instance_id)
        if existing is None:
            raise ValueError('Instance not found.')
        self._repo.delete_instance(instance_id)


class CrossModelInstanceService:
    def __init__(self, db_url: str):
        self._repo = CrossModelInstanceRepository(db_url)

    def list_links_for_source(self, source_instance_id: str) -> list[dict]:
        return self._repo.list_links_for_source(source_instance_id)

    def list_links_for_target(self, target_instance_id: str) -> list[dict]:
        return self._repo.list_links_for_target(target_instance_id)

    def list_all_links(self) -> list[dict]:
        return self._repo.list_all_links()

    def create_link(self, command: CreateCrossModelInstanceCommand) -> dict:
        # Validate relationship type exists in governance layer
        rel_type = self._repo.get_relationship_type(command.relationship_rule_id)
        if rel_type is None:
            raise ValueError('Relationship type not found. Create a governed cross-model relationship type first.')
        if rel_type['status'] != 'active':
            raise ValueError('Relationship type is not active. Only active types may be used to create instances.')

        # Validate instance types match the governed type's constraints
        allowed_src = rel_type['source_model_type']
        allowed_tgt = rel_type['target_model_type']
        if command.source_instance_type != allowed_src:
            raise ValueError(
                f"Relationship type '{rel_type['name']}' requires source kind '{allowed_src}', "
                f"got '{command.source_instance_type}'."
            )
        if command.target_instance_type != allowed_tgt:
            raise ValueError(
                f"Relationship type '{rel_type['name']}' requires target kind '{allowed_tgt}', "
                f"got '{command.target_instance_type}'."
            )

        # Both instances must be in a state that allows new relationships.
        with get_connection(self._repo._db_url) as conn:
            lifecycle.require_authorable(conn, "node" if command.source_instance_type == HIERARCHY_MODEL else "element", command.source_instance_id)
            lifecycle.require_authorable(conn, "node" if command.target_instance_type == HIERARCHY_MODEL else "element", command.target_instance_id)

        return self._repo.create_link(
            relationship_rule_id=command.relationship_rule_id,
            source_instance_id=command.source_instance_id,
            source_instance_type=command.source_instance_type,
            target_instance_id=command.target_instance_id,
            target_instance_type=command.target_instance_type,
        )

    def update_link(self, cross_model_instance_id: str, command) -> dict:
        # LookupError distinguishes "no such link" (404) from a rejected type
        # change (400); both would otherwise surface as ValueError.
        link = self._repo.get_link(cross_model_instance_id)
        if link is None:
            raise LookupError('Link not found.')

        # Re-pointing at another governed type has to clear the same bar as
        # creating the link did, or the instance could end up violating the type's
        # source/target constraints.
        rel_type = self._repo.get_relationship_type(command.relationship_rule_id)
        if rel_type is None:
            raise ValueError('Relationship type not found. Create a governed cross-model relationship type first.')
        if rel_type['status'] != 'active':
            raise ValueError('Relationship type is not active. Only active types may be used for instances.')
        if link['source_instance_type'] != rel_type['source_model_type']:
            raise ValueError(
                f"Relationship type '{rel_type['name']}' requires source kind "
                f"'{rel_type['source_model_type']}', got '{link['source_instance_type']}'."
            )
        if link['target_instance_type'] != rel_type['target_model_type']:
            raise ValueError(
                f"Relationship type '{rel_type['name']}' requires target kind "
                f"'{rel_type['target_model_type']}', got '{link['target_instance_type']}'."
            )

        result = self._repo.update_link(cross_model_instance_id, command.relationship_rule_id)
        if result is None:
            raise LookupError('Link not found.')
        return result

    def delete_link(self, cross_model_instance_id: str) -> None:
        link = self._repo.get_link(cross_model_instance_id)
        if link is None:
            raise ValueError('Link not found.')
        self._repo.delete_link(cross_model_instance_id)


class CrossModelInstanceDiagramService:
    """Saved instance-level cross-model relationship diagrams (Structure workspace)."""

    def __init__(self, db_url: str):
        self._repo = CrossModelInstanceDiagramRepository(db_url)

    def list_diagrams(self) -> list[dict]:
        return self._repo.list_diagrams()

    def get_diagram(self, diagram_id: str) -> dict:
        diagram = self._repo.get_diagram(diagram_id)
        if diagram is None:
            raise ValueError('Saved diagram not found.')
        return diagram

    def create_diagram(self, command) -> dict:
        return self._repo.create_diagram(command.model_dump())

    def update_diagram(self, diagram_id: str, command) -> dict:
        diagram = self._repo.update_diagram(diagram_id, command.model_dump())
        if diagram is None:
            raise ValueError('Saved diagram not found.')
        return diagram

    def delete_diagram(self, diagram_id: str) -> None:
        if not self._repo.delete_diagram(diagram_id):
            raise ValueError('Saved diagram not found.')


class NodeInstancePropertyService:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def list(self, node_instance_id: str) -> list[dict]:
        with get_connection(self._db_url) as db:
            return NodeInstancePropertyRepo(db).list_for_instance(node_instance_id)

    def upsert(self, node_instance_id: str, command: UpsertInstancePropertyCommand) -> dict:
        with get_connection(self._db_url) as db:
            return NodeInstancePropertyRepo(db).upsert(node_instance_id, command.property_type_id)

    def set_value(self, node_instance_id: str, property_id: str, value: str) -> dict:
        """Give a Property its Node Type defines a value on this instance.

        Only the value: the definition (name, description, status) belongs to
        the Model Workspace. The Property must apply to this instance — defined
        on its Node Type, or inherited from an ancestor type — and be Active,
        and the instance must not be Archived.
        """
        with get_connection(self._db_url) as db:
            instance = db.execute(
                "select name, status from hierarchy_model_node_instance where node_instance_id = %s", (node_instance_id,)
            ).fetchone()
            if instance is None:
                raise LookupError('Node instance not found.')
            repo = NodeInstancePropertyRepo(db)
            applicable = {row['property_id']: row for row in repo.list_for_instance(node_instance_id)}
            prop = applicable.get(property_id)
            if prop is None:
                raise ValueError(
                    "This property is not defined on this node's type. Properties are defined on the Node Type in the Model Workspace."
                )
            if prop['property_status'] != lifecycle.ACTIVE:
                raise ValueError(
                    f"“{prop['property_name']}” is {lifecycle.label(prop['property_status'])} on its Node Type, so its value cannot be changed. Activate it in the Model Workspace first."
                )
            if instance['status'] == lifecycle.ARCHIVED:
                raise ValueError(f"“{instance['name']}” is Archived, so its property values cannot be changed.")
            text = (value or '').strip()
            repo.set_value(node_instance_id, property_id, text or None)
            return next(row for row in repo.list_for_instance(node_instance_id) if row['property_id'] == property_id)

    def delete(self, property_instance_id: str) -> None:
        with get_connection(self._db_url) as db:
            NodeInstancePropertyRepo(db).delete(property_instance_id)


class ElementInstancePropertyService:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def list(self, instance_id: str) -> list[dict]:
        with get_connection(self._db_url) as db:
            return ElementInstancePropertyRepo(db).list_for_instance(instance_id)

    def upsert(self, instance_id: str, command: UpsertInstancePropertyCommand) -> dict:
        with get_connection(self._db_url) as db:
            return ElementInstancePropertyRepo(db).upsert(instance_id, command.property_type_id)

    def delete(self, property_instance_id: str) -> None:
        with get_connection(self._db_url) as db:
            ElementInstancePropertyRepo(db).delete(property_instance_id)
