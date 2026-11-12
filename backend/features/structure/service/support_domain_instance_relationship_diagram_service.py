from features.structure.domain.models import CreateElementRelationshipInstanceCommand, SdDiagramNode
from features.structure.repo.support_domain_instance_relationship_diagram_repo import (
    SupportDomainInstanceRelationshipDiagramRepository,
)
from shared import lifecycle
from shared.db import get_connection


class SupportDomainInstanceRelationshipDiagramService:
    """A Support Domain model's element instance relationship diagram: where its
    element type cards sit, and the edges drawn between its instances.

    Visualisation only. The relationships between instances are inferred from
    the model (where element type A relates to B, every A instance relates to
    every B instance) and are not read from here. An edge only shows one of
    them, so it may only be drawn where such an inferred relationship exists: the model relationship must be
    Active, both instances must be of its source and target element types, in
    that direction, and both must be authorable.
    """

    def __init__(self, db_url: str):
        self._db_url = db_url
        self._repo = SupportDomainInstanceRelationshipDiagramRepository(db_url)

    # ------------------------------------------------------------- layout

    def get_layout(self, model_id: str) -> dict:
        return self._repo.get_layout(model_id)

    def replace_nodes(self, model_id: str, nodes: list[SdDiagramNode]) -> dict:
        with get_connection(self._db_url) as connection:
            if connection.execute(
                "SELECT 1 FROM support_domain_model WHERE support_domain_model_id = %s", (model_id,)
            ).fetchone() is None:
                raise ValueError('Support domain model not found.')
            known = {
                row["element_id"]
                for row in connection.execute(
                    "SELECT element_id FROM support_domain_element_type WHERE support_domain_model_id = %s", (model_id,)
                ).fetchall()
            }
        # Only the model's own element types have a card; anything else is dropped.
        # A card named twice keeps its last position.
        kept = list({
            node.item_id: node.model_dump() for node in nodes if node.item_kind == "element_type" and node.item_id in known
        }.values())
        return self._repo.replace_nodes(model_id, kept)

    # -------------------------------------------------------- drawn edges

    def list_edges(self, model_id: str | None = None) -> list[dict]:
        return self._repo.list_edges(model_id)

    def create_edge(self, command: CreateElementRelationshipInstanceCommand) -> dict:
        relationship = self._repo.get_relationship(command.support_domain_relationship_id)
        if relationship is None:
            raise ValueError('Relationship not found. Define it in the Model Workspace first.')
        if relationship['status'] != 'active':
            raise ValueError(
                f"This relationship is {lifecycle.label(relationship['status'])} in the Model Workspace. "
                "Only Active relationships can be used to relate instances."
            )
        if command.source_instance_id == command.target_instance_id:
            raise ValueError('An instance cannot be related to itself.')

        source = self._repo.get_instance(command.source_instance_id)
        target = self._repo.get_instance(command.target_instance_id)
        if source is None:
            raise ValueError('Source instance not found.')
        if target is None:
            raise ValueError('Target instance not found.')
        model_id = relationship['support_domain_model_id']
        if source['support_domain_model_id'] != model_id or target['support_domain_model_id'] != model_id:
            raise ValueError('Both instances must belong to the model that defines the relationship.')
        if source['element_type_id'] != relationship['source_element_id']:
            raise ValueError(f"'{source['name']}' is not of the relationship's source element type.")
        if target['element_type_id'] != relationship['target_element_id']:
            raise ValueError(f"'{target['name']}' is not of the relationship's target element type.")
        with get_connection(self._db_url) as connection:
            lifecycle.require_authorable(connection, "element", source['instance_id'])
            lifecycle.require_authorable(connection, "element", target['instance_id'])
        if self._repo.edge_exists(relationship['relationship_id'], source['instance_id'], target['instance_id']):
            raise ValueError(f"'{source['name']}' is already linked to '{target['name']}' by this relationship.")

        return self._repo.create_edge(relationship['relationship_id'], model_id, source['instance_id'], target['instance_id'])

    def delete_edge(self, relationship_instance_id: str) -> None:
        if not self._repo.delete_edge(relationship_instance_id):
            raise ValueError('Edge not found.')
