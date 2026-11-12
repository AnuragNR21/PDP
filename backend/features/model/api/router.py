from __future__ import annotations

from collections.abc import Callable, Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.config import get_settings
from shared.model_config import HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL
from shared.db import _DatabaseConnection, get_connection
from shared.query_builders.badge_query_helpers import badge_join, badge_select_columns

from ..domain.commands import (
    CreateCrossModelRelationshipTypeCommand,
    CreateHierarchyModelCommand,
    CreateHierarchyNodeTypeCommand,
    CreateHierarchyNodeTypePropertyCommand,
    CreateHierarchyRuleCommand,
    CreateSupportDomainElementPropertyCommand,
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
    UpdateSupportDomainElementPropertyCommand,
    UpdateSupportDomainElementCommand,
    UpdateSupportDomainElementPositionCommand,
    UpdateSupportDomainModelCommand,
    UpdateSupportDomainRelationshipCommand,
)
from ..domain.invariants import ModelDefinitionError, NotFoundError
from ..repo.badge_store_repo import BadgeStoreRepo
from ..repo.cross_model_relationship_type_repo import CrossModelRelationshipTypeRepo
from ..repo.cross_model_relationship_type_diagram_repo import CrossModelRelationshipTypeDiagramRepo
from ..repo.hierarchy_model_node_type_property_repo import HierarchyModelNodeTypePropertyRepo
from ..repo.hierarchy_model_node_type_repo import HierarchyModelNodeTypeRepo
from ..repo.hierarchy_model_repo import HierarchyModelRepo
from ..repo.hierarchy_rule_repo import HierarchyRuleRepo
from ..repo.support_domain_diagram_node_repo import SupportDomainDiagramNodeRepo
from ..repo.support_domain_element_property_repo import SupportDomainElementPropertyRepo
from ..repo.support_domain_element_repo import SupportDomainElementRepo
from ..repo.support_domain_model_repo import SupportDomainModelRepo
from ..repo.support_domain_relationship_repo import SupportDomainRelationshipRepo
from ..service.model_definition_service import ModelDefinitionService
from ..service.support_domain_model_service import SupportDomainModelService

router = APIRouter(prefix="/model", tags=["model-workspace"])


def get_db() -> Iterator[_DatabaseConnection]:
    db_url = get_settings().database_url
    with get_connection(db_url) as connection:
        yield connection


def get_service(db: _DatabaseConnection = Depends(get_db)) -> ModelDefinitionService:
    return ModelDefinitionService(
        hierarchy_models=HierarchyModelRepo(db),
        structural_nodes=HierarchyModelNodeTypeRepo(db),
        hierarchy_node_type_properties=HierarchyModelNodeTypePropertyRepo(db),
        structural_rules=HierarchyRuleRepo(db),
        support_domain_models=SupportDomainModelRepo(db),
        support_domain_elements=SupportDomainElementRepo(db),
        support_domain_relationships=SupportDomainRelationshipRepo(db),
        support_domain_diagram_nodes=SupportDomainDiagramNodeRepo(db),
        badge_store=BadgeStoreRepo(db),
        cross_model_relationship_types=CrossModelRelationshipTypeRepo(db),
        cross_model_relationship_type_diagrams=CrossModelRelationshipTypeDiagramRepo(db),
    )


def get_support_domain_model_service(db: _DatabaseConnection = Depends(get_db)) -> SupportDomainModelService:
    return SupportDomainModelService(
        support_domain_models=SupportDomainModelRepo(db),
        support_domain_elements=SupportDomainElementRepo(db),
        support_domain_element_properties=SupportDomainElementPropertyRepo(db),
    )


def _wrap(action: Callable[[], object]):
    try:
        return action()
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ModelDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/metadata")
def get_metadata(service: ModelDefinitionService = Depends(get_service)):
    return _wrap(service.get_metadata)


@router.get("/hierarchy-models")
def list_models(service: ModelDefinitionService = Depends(get_service)):
    return _wrap(service.list_models)


@router.get("/hierarchy-models/{model_id}")
def get_model(model_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_model(model_id))


@router.post("/hierarchy-models")
def create_model(command: CreateHierarchyModelCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_model(command))


@router.put("/hierarchy-models/{model_id}")
def update_model(model_id: str, command: UpdateHierarchyModelCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_model(model_id, command))


@router.delete("/hierarchy-models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(model_id: str, service: ModelDefinitionService = Depends(get_service)):
    _wrap(lambda: service.delete_model(model_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/hierarchy-models/{model_id}/delete-impact")
def get_model_delete_impact(model_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_model_delete_impact(model_id))


@router.get("/hierarchy-nodes")
def list_hierarchy_node_types(model_id: str = Query(...), service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.list_structural_nodes(model_id=model_id))


@router.get("/hierarchy-tree/{model_id}")
def get_hierarchy_node_type_tree(model_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_structural_tree(model_id))


@router.get("/hierarchy-nodes/{node_id}")
def get_hierarchy_node_type(node_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_structural_node(node_id))


@router.post("/hierarchy-nodes")
def create_hierarchy_node_type(command: CreateHierarchyNodeTypeCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_structural_node(command))


@router.put("/hierarchy-nodes/{node_id}")
def update_hierarchy_node_type(node_id: str, command: UpdateHierarchyNodeTypeCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_structural_node(node_id, command))


@router.patch("/hierarchy-nodes/{node_id}/reorder")
def reorder_hierarchy_node_type(node_id: str, command: ReorderHierarchyNodeTypeCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.reorder_structural_node(node_id, command))


@router.get("/hierarchy-nodes/{node_id}/delete-impact")
def get_hierarchy_node_type_delete_impact(node_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_structural_node_delete_impact(node_id))


@router.get("/hierarchy-nodes/{node_id}/recursive-disable-impact")
def get_hierarchy_node_type_recursive_disable_impact(node_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_structural_node_recursive_disable_impact(node_id))


@router.get("/hierarchy-nodes/{node_id}/reparent-impact")
def get_hierarchy_node_type_reparent_impact(
    node_id: str,
    new_parent_node_id: str | None = Query(default=None),
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.get_structural_node_reparent_impact(node_id, new_parent_node_id))


@router.get("/hierarchy-models/{model_id}/node-types/{node_id}/properties")
def list_hierarchy_node_type_properties(model_id: str, node_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.list_hierarchy_node_type_properties(node_id=node_id, model_id=model_id))


@router.post("/hierarchy-models/{model_id}/node-types/{node_id}/properties")
def create_hierarchy_node_type_property(
    model_id: str,
    node_id: str,
    command: CreateHierarchyNodeTypePropertyCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.create_hierarchy_node_type_property(node_id, command, model_id=model_id))


@router.put("/hierarchy-models/{model_id}/node-types/{node_id}/properties/{property_id}")
def update_hierarchy_node_type_property(
    model_id: str,
    node_id: str,
    property_id: str,
    command: UpdateHierarchyNodeTypePropertyCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.update_hierarchy_node_type_property(node_id, property_id, command, model_id=model_id))


@router.delete("/hierarchy-models/{model_id}/node-types/{node_id}/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_hierarchy_node_type_property(
    model_id: str,
    node_id: str,
    property_id: str,
    service: ModelDefinitionService = Depends(get_service),
):
    _wrap(lambda: service.delete_hierarchy_node_type_property(node_id, property_id, model_id=model_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/hierarchy-models/{model_id}/node-types/{node_id}/properties/{property_id}/delete-impact")
def get_hierarchy_node_type_property_delete_impact(
    model_id: str,
    node_id: str,
    property_id: str,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.get_hierarchy_node_type_property_delete_impact(node_id, property_id, model_id=model_id))


@router.delete("/hierarchy-nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_hierarchy_node_type(node_id: str, service: ModelDefinitionService = Depends(get_service)):
    _wrap(lambda: service.delete_structural_node(node_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/hierarchy-rules")
def list_hierarchy_rules(
    model_id: str | None = Query(default=None),
    owning_domain: str | None = Query(default=None),
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.list_structural_rules(model_id=model_id, owning_domain=owning_domain))


@router.get("/hierarchy-rules/{rule_id}")
def get_hierarchy_rule(rule_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_structural_rule(rule_id))


@router.post("/hierarchy-rules")
def create_hierarchy_rule(command: CreateHierarchyRuleCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_structural_rule(command))


@router.put("/hierarchy-rules/{rule_id}")
def update_hierarchy_rule(rule_id: str, command: UpdateHierarchyRuleCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_structural_rule(rule_id, command))


@router.delete("/hierarchy-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_hierarchy_rule(rule_id: str, service: ModelDefinitionService = Depends(get_service)):
    _wrap(lambda: service.delete_structural_rule(rule_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/support-domain-models")
def list_support_domain_models(service: ModelDefinitionService = Depends(get_service)):
    return _wrap(service.list_support_domain_models)


@router.get("/support-domain-models/{model_id}")
def get_support_domain_model(model_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_support_domain_model(model_id))


@router.post("/support-domain-models")
def create_support_domain_model(command: CreateSupportDomainModelCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_support_domain_model(command))


@router.put("/support-domain-models/{model_id}")
def update_support_domain_model(model_id: str, command: UpdateSupportDomainModelCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_support_domain_model(model_id, command))


@router.get("/support-domain-models/{model_id}/delete-impact")
def get_support_domain_model_delete_impact(model_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_support_domain_model_delete_impact(model_id))


@router.delete("/support-domain-models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_support_domain_model(model_id: str, service: ModelDefinitionService = Depends(get_service)):
    _wrap(lambda: service.delete_support_domain_model(model_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/support-domain-elements")
def list_support_domain_elements(model_id: str = Query(...), service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.list_support_domain_elements(model_id=model_id))


@router.get("/support-domain-elements/{element_id}")
def get_support_domain_element(element_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_support_domain_element(element_id))


@router.post("/support-domain-elements")
def create_support_domain_element(command: CreateSupportDomainElementCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_support_domain_element(command))


@router.put("/support-domain-elements/{element_id}")
def update_support_domain_element(element_id: str, command: UpdateSupportDomainElementCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_support_domain_element(element_id, command))


@router.patch("/support-domain-elements/{element_id}/position")
def update_support_domain_element_position(element_id: str, command: UpdateSupportDomainElementPositionCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_support_domain_element_position(element_id, command))


@router.get("/support-domain-diagram-nodes")
def list_support_domain_diagram_nodes(model_id: str = Query(...), service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.list_support_domain_diagram_nodes(model_id=model_id))


@router.post("/support-domain-diagram-nodes/sync")
def create_support_domain_diagram_nodes(command: CreateSupportDomainDiagramNodesCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_support_domain_diagram_nodes(command))


@router.get("/support-domain-elements/{element_id}/delete-impact")
def get_support_domain_element_delete_impact(element_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_support_domain_element_delete_impact(element_id))


@router.delete("/support-domain-elements/{element_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_support_domain_element(element_id: str, service: ModelDefinitionService = Depends(get_service)):
    _wrap(lambda: service.delete_support_domain_element(element_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.get("/support-domain-model/{model_id}/elements/{element_id}/properties")
def list_support_domain_element_properties(
    model_id: str,
    element_id: str,
    service: SupportDomainModelService = Depends(get_support_domain_model_service),
):
    return _wrap(
        lambda: service.list_support_domain_element_properties(
            model_id,
            element_id,
        )
    )


@router.post("/support-domain-model/{model_id}/elements/{element_id}/properties")
def create_support_domain_element_property(
    model_id: str,
    element_id: str,
    command: CreateSupportDomainElementPropertyCommand,
    service: SupportDomainModelService = Depends(get_support_domain_model_service),
):
    return _wrap(
        lambda: service.create_support_domain_element_property(
            model_id,
            element_id,
            command,
        )
    )


@router.put("/support-domain-model/{model_id}/elements/{element_id}/properties/{property_id}")
def update_support_domain_element_property(
    model_id: str,
    element_id: str,
    property_id: str,
    command: UpdateSupportDomainElementPropertyCommand,
    service: SupportDomainModelService = Depends(get_support_domain_model_service),
):
    return _wrap(
        lambda: service.update_support_domain_element_property(
            model_id,
            element_id,
            property_id,
            command,
        )
    )

@router.delete(
    "/support-domain-model/{model_id}/elements/{element_id}/properties/{property_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_support_domain_element_property(
    model_id: str,
    element_id: str,
    property_id: str,
    service: SupportDomainModelService = Depends(get_support_domain_model_service),
):
    _wrap(
        lambda: service.delete_support_domain_element_property(
            model_id,
            element_id,
            property_id,
        )
    )

    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
    )


@router.get("/support-domain-model/{model_id}/elements/{element_id}/properties/{property_id}/delete-impact")
def get_support_domain_element_property_delete_impact(
    model_id: str,
    element_id: str,
    property_id: str,
    service: SupportDomainModelService = Depends(get_support_domain_model_service),
):
    return _wrap(
        lambda: service.get_support_domain_element_property_delete_impact(
            model_id,
            element_id,
            property_id,
        )
    )

@router.get("/support-domain-relationships")
def list_support_domain_relationships(model_id: str = Query(...), service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.list_support_domain_relationships(model_id=model_id))


@router.get("/support-domain-relationships/all")
def list_support_domain_relationships_for_multiple_models(
    model_ids: list[str] | None = Query(default=None),
    service: ModelDefinitionService = Depends(get_service),
):
    # Declared before /{relationship_id} so "all" is not read as an id.
    return _wrap(lambda: service.list_support_domain_relationships_for_multiple_models(model_ids=model_ids))


@router.get("/support-domain-relationships/{relationship_id}")
def get_support_domain_relationship(relationship_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_support_domain_relationship(relationship_id))


@router.post("/support-domain-relationships")
def create_support_domain_relationship(command: CreateSupportDomainRelationshipCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_support_domain_relationship(command))


@router.put("/support-domain-relationships/{relationship_id}")
def update_support_domain_relationship(relationship_id: str, command: UpdateSupportDomainRelationshipCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_support_domain_relationship(relationship_id, command))


@router.delete("/support-domain-relationships/{relationship_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_support_domain_relationship(relationship_id: str, service: ModelDefinitionService = Depends(get_service)):
    _wrap(lambda: service.delete_support_domain_relationship(relationship_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Badge customisation ────────────────────────────────────────────────────────

@router.get("/badge-metadata")
def get_badge_metadata(service: ModelDefinitionService = Depends(get_service)):
    return _wrap(service.get_badge_metadata)


@router.get("/hierarchy-nodes/{node_id}/badge")
def get_hierarchy_node_badge(node_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_hierarchy_node_badge(node_id))


@router.put("/hierarchy-nodes/{node_id}/badge")
def save_hierarchy_node_badge(
    node_id: str,
    command: SaveBadgeCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.save_hierarchy_node_badge(node_id, command))


@router.get("/support-domain-elements/{element_id}/badge")
def get_support_domain_element_badge(element_id: str, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.get_support_domain_element_badge(element_id))


@router.put("/support-domain-elements/{element_id}/badge")
def save_support_domain_element_badge(
    element_id: str,
    command: SaveBadgeCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.save_support_domain_element_badge(element_id, command))


# Compatibility aliases for earlier frontend scaffolding.
@router.get("/node-types")
def list_node_types_compat(model_id: str = Query(...), service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.list_structural_nodes(model_id=model_id))


@router.post("/node-types")
def create_node_type_compat(command: CreateHierarchyNodeTypeCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.create_structural_node(command))


@router.put("/node-types/{node_id}")
def update_node_type_compat(node_id: str, command: UpdateHierarchyNodeTypeCommand, service: ModelDefinitionService = Depends(get_service)):
    return _wrap(lambda: service.update_structural_node(node_id, command))


# ── Cross-model relationship types (governance layer) ─────────────────────────

@router.get("/cross-model-relationship-type-templates")
def get_cross_model_relationship_type_templates():
    """Return curated relationship type name/description suggestions."""
    from shared.contracts.cross_model_relationship_type_options import RELATIONSHIP_TYPE_TEMPLATES
    return RELATIONSHIP_TYPE_TEMPLATES


@router.get("/cross-model-type-options")
def get_cross_model_type_options(db: _DatabaseConnection = Depends(get_db)):
    """Return all hierarchy node types and SD element types for use in relationship type governance."""
    node_types = db.execute(
        f"""
        SELECT
            nt.node_type_id         AS id,
            nt.name,
            nt.model_id,
            hm.name                 AS model_name,
            nt.parent_node_type_id  AS parent_id,
            '{HIERARCHY_MODEL}'        AS kind,
            {badge_select_columns("hbs")}
        FROM hierarchy_model_node_type nt
        JOIN hierarchy_model hm ON hm.model_id = nt.model_id
        {badge_join("nt.node_type_id", "hierarchy_model_node_type", "hbs")}
        WHERE nt.status = 'active'
        ORDER BY hm.name, nt.name
        """
    ).fetchall()
    element_types = db.execute(
        f"""
        SELECT
            et.element_id      AS id,
            et.name,
            et.support_domain_model_id AS model_id,
            sdm.name           AS model_name,
            '{SUPPORT_DOMAIN_MODEL}'       AS kind,
            {badge_select_columns("sbs")}
        FROM support_domain_element_type et
        JOIN support_domain_model sdm ON sdm.support_domain_model_id = et.support_domain_model_id
        {badge_join("et.element_id", "support_domain_element_type", "sbs")}
        WHERE et.status = 'active'
        ORDER BY sdm.name, et.name
        """
    ).fetchall()

    def with_badge(row) -> dict:
        item = dict(row)
        badge_store_id = item.pop("badge_store_id", None)
        badge_fields = {
            "badge_store_id": badge_store_id,
            "badge_text": item.pop("badge_text", None),
            "badge_shape": item.pop("badge_shape", None),
            "badge_color": item.pop("badge_color", None),
            "badge_text_color": item.pop("badge_text_color", None),
            "badge_icon": item.pop("badge_icon", None),
            "badge_size": item.pop("badge_size", None),
            "badge_content_type": item.pop("badge_content_type", None),
        }
        item["badge"] = badge_fields if badge_store_id else None
        return item

    return {
        "node_types": [with_badge(row) for row in node_types],
        "element_types": [with_badge(row) for row in element_types],
    }


@router.get("/cross-model-relationship-types")
def list_cross_model_relationship_types(
    status: str | None = Query(default=None),
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.list_cross_model_relationship_types(status=status))


@router.get("/cross-model-relationship-types/{relationship_type_id}")
def get_cross_model_relationship_type(
    relationship_type_id: str,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.get_cross_model_relationship_type(relationship_type_id))


@router.get("/cross-model-relationship-types/{relationship_type_id}/delete-impact")
def get_cross_model_relationship_type_delete_impact(
    relationship_type_id: str,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.get_cross_model_relationship_type_delete_impact(relationship_type_id))


@router.post("/cross-model-relationship-types", status_code=status.HTTP_201_CREATED)
def create_cross_model_relationship_type(
    command: CreateCrossModelRelationshipTypeCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.create_cross_model_relationship_type(command))


@router.put("/cross-model-relationship-types/{relationship_type_id}")
def update_cross_model_relationship_type(
    relationship_type_id: str,
    command: UpdateCrossModelRelationshipTypeCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.update_cross_model_relationship_type(relationship_type_id, command))


@router.delete("/cross-model-relationship-types/{relationship_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cross_model_relationship_type(
    relationship_type_id: str,
    service: ModelDefinitionService = Depends(get_service),
):
    _wrap(lambda: service.delete_cross_model_relationship_type(relationship_type_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/cross-model-relationship-type-diagrams")
def list_cross_model_relationship_type_diagrams(service: ModelDefinitionService = Depends(get_service)):
    return _wrap(service.list_cross_model_relationship_type_diagrams)


@router.get("/cross-model-relationship-type-diagrams/{diagram_id}")
def get_cross_model_relationship_type_diagram(
    diagram_id: str,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.get_cross_model_relationship_type_diagram(diagram_id))


@router.post("/cross-model-relationship-type-diagrams", status_code=status.HTTP_201_CREATED)
def create_cross_model_relationship_type_diagram(
    command: SaveCrossModelRelationshipTypeDiagramCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.create_cross_model_relationship_type_diagram(command))


@router.put("/cross-model-relationship-type-diagrams/{diagram_id}")
def update_cross_model_relationship_type_diagram(
    diagram_id: str,
    command: SaveCrossModelRelationshipTypeDiagramCommand,
    service: ModelDefinitionService = Depends(get_service),
):
    return _wrap(lambda: service.update_cross_model_relationship_type_diagram(diagram_id, command))


@router.delete("/cross-model-relationship-type-diagrams/{diagram_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cross_model_relationship_type_diagram(
    diagram_id: str,
    service: ModelDefinitionService = Depends(get_service),
):
    _wrap(lambda: service.delete_cross_model_relationship_type_diagram(diagram_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
