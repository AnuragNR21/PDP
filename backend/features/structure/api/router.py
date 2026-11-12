from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from app.dependencies import get_database_url
from features.structure.domain.models import (
    CreateCanonicalNodeCommand,
    CreateCrossModelInstanceCommand,
    CreateElementInstanceCommand,
    CreateElementRelationshipInstanceCommand,
    SetNodePropertyValueCommand,
    ReplaceSdDiagramNodesCommand,
    CreateRelationshipCommand,
    GovernanceGraphItemsCommand,
    GovernanceGraphNeighbourhoodCommand,
    ReorderNodeCommand,
    ReparentNodeCommand,
    UpdateCanonicalNodeCommand,
    UpdateCrossModelInstanceCommand,
    UpdateElementInstanceCommand,
    UpsertInstancePropertyCommand,
    SaveCrossModelInstanceDiagramCommand,
    StructureImportValidateRequest,
    StructureHierarchyImportValidateRequest,
    StructureSupportDomainImportValidateRequest,
    StructureSupportDomainRelationshipImportValidateRequest,
    StructureImportValidateResponse,
    StructureImportCommitRequest,
    StructureImportCommitResponse,
)
from features.structure.service.property_rule_service import PropertyRuleService
from features.structure.service.structure_services import (
    CanonicalNodeService,
    CrossModelInstanceService,
    CrossModelInstanceDiagramService,
    ElementInstancePropertyService,
    ElementInstanceService,
    HierarchyService,
    NodeInstancePropertyService,
    ProjectionService,
    RelationshipService,
)
from features.structure.service.support_domain_instance_relationship_diagram_service import (
    SupportDomainInstanceRelationshipDiagramService,
)
from features.structure.service.structure_governance_graph_service import (
    StructureGovernanceGraphService,
)
from features.structure.service.structure_import_export_services import (
    StructureExportService,
    StructureImportService,
)

from shared.lifecycle import LifecycleError

router = APIRouter(prefix='/structure', tags=['structure'])


@router.get('/node-instances')
def list_nodes(
    parent_node_id: str | None = Query(default=None),
    model_id: str | None = Query(default=None),
    db_url=Depends(get_database_url),
):
    return CanonicalNodeService(db_url).list_nodes(parent_node_id=parent_node_id, model_id=model_id)


@router.post('/node-instances/ensure-root')
def ensure_root_instance(model_id: str = Query(...), db_url=Depends(get_database_url)):
    """Return the root node instance for a model, creating it automatically if absent."""
    try:
        return CanonicalNodeService(db_url).ensure_root_instance(model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/node-instances/{node_id}')
def get_node_detail(node_id: str, db_url=Depends(get_database_url)):
    try:
        return CanonicalNodeService(db_url).get_node_detail(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post('/node-instances', status_code=status.HTTP_201_CREATED)
def create_node(command: CreateCanonicalNodeCommand, db_url=Depends(get_database_url)):
    try:
        return CanonicalNodeService(db_url).create_node(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch('/node-instances/{node_id}')
def update_node(node_id: str, command: UpdateCanonicalNodeCommand, db_url=Depends(get_database_url)):
    try:
        return CanonicalNodeService(db_url).update_node(node_id, command)
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete('/node-instances/{node_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_node(node_id: str, db_url=Depends(get_database_url)):
    try:
        HierarchyService(db_url).delete(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/node-instances/{node_id}/impacts/delete')
def get_node_delete_impact(node_id: str, db_url=Depends(get_database_url)):
    try:
        return CanonicalNodeService(db_url).get_node_delete_impact(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/tree/roots')
def list_root_nodes(db_url=Depends(get_database_url)):
    return HierarchyService(db_url).roots()


@router.get('/tree/children/{parent_node_id}')
def list_child_nodes(parent_node_id: str, db_url=Depends(get_database_url)):
    return HierarchyService(db_url).children(parent_node_id)


@router.get('/tree/path/{node_id}')
def get_path(node_id: str, db_url=Depends(get_database_url)):
    try:
        return HierarchyService(db_url).path(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post('/hierarchy/reparent')
def reparent_node(command: ReparentNodeCommand, db_url=Depends(get_database_url)):
    try:
        return HierarchyService(db_url).reparent(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/hierarchy/reorder')
def reorder_nodes(command: ReorderNodeCommand, db_url=Depends(get_database_url)):
    try:
        return HierarchyService(db_url).reorder(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/projections/diagram')
def diagram_projection(model_id: str = Query(...), db_url=Depends(get_database_url)):
    return ProjectionService(db_url).diagram(model_id)


@router.get('/projections/matrix')
def matrix_projection(model_id: str = Query(...), db_url=Depends(get_database_url)):
    return ProjectionService(db_url).matrix(model_id)


@router.post('/relationships', status_code=status.HTTP_201_CREATED)
def create_relationship(command: CreateRelationshipCommand, db_url=Depends(get_database_url)):
    try:
        return RelationshipService(db_url).create_relationship(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete('/relationships/{relationship_id}')
def delete_relationship(relationship_id: str, db_url=Depends(get_database_url)):
    try:
        return RelationshipService(db_url).delete_relationship(relationship_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# --- Governed rules on an Asset Property -------------------------------------
#
# Applicability binds here, at the property: `Asset Property -> subject to ->
# Rule Configuration`. The Structure Workspace says *where* a rule applies; it
# links to a configuration authored in the Rule Workspace and never creates one,
# so the same governance cannot drift into two near-copies.
#
# Nothing is inherited. A property carries what has been asserted about it, and
# a shared configuration linked to four properties says nothing about a fifth.


def _property_rules(db_url=Depends(get_database_url)) -> PropertyRuleService:
    return PropertyRuleService(db_url)


@router.get('/node-instances/{node_instance_id}/rules')
def list_property_rules(
    node_instance_id: str, svc: PropertyRuleService = Depends(_property_rules)
):
    """
    The configurations this property is subject to, required first, each with
    its approved values resolved and its readiness stated.

    A configuration that needs governed reference data and finds none comes back
    as `configuration_incomplete` with the reason. It is saved, and it will not
    run.
    """
    try:
        return svc.list_rules(node_instance_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/node-instances/{node_instance_id}/rules/available')
def list_available_property_rules(
    node_instance_id: str,
    search: str = Query(default=''),
    svc: PropertyRuleService = Depends(_property_rules),
):
    """Configurations this property could be subject to, with linked ones marked."""
    try:
        return svc.list_available_configurations(node_instance_id, search=search)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post('/node-instances/{node_instance_id}/rules', status_code=status.HTTP_201_CREATED)
def link_property_rule(
    node_instance_id: str,
    rule_configuration_id: str = Body(default=''),
    # A rule the library holds but nobody has configured yet. Linking it makes
    # its default configuration first, so the link still points at one.
    rule_definition_id: str = Body(default=''),
    applicability: str = Body(default='recommended'),
    notes: str = Body(default=''),
    actor: str = Query(default='user'),
    svc: PropertyRuleService = Depends(_property_rules),
):
    try:
        return svc.link_rule(
            node_instance_id, rule_configuration_id,
            rule_definition_id=rule_definition_id,
            applicability=applicability, notes=notes, actor=actor,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch('/property-rules/{property_rule_id}')
def update_property_rule(
    property_rule_id: str,
    applicability: str = Body(...),
    notes: str = Body(default=''),
    svc: PropertyRuleService = Depends(_property_rules),
):
    try:
        svc.update_rule(property_rule_id, applicability=applicability, notes=notes)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {'property_rule_id': property_rule_id, 'applicability': applicability}


@router.delete('/property-rules/{property_rule_id}', status_code=status.HTTP_204_NO_CONTENT)
def unlink_property_rule(
    property_rule_id: str, svc: PropertyRuleService = Depends(_property_rules)
):
    try:
        svc.unlink_rule(property_rule_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return None


@router.get('/hierarchy-models/{model_id}/property-rule-counts')
def get_property_rule_counts(
    model_id: str, svc: PropertyRuleService = Depends(_property_rules)
):
    """How many configurations each property of this model is subject to."""
    return svc.counts_for_model(model_id)


# --- Approved values on an Asset Property ------------------------------------
#
# `Asset Property -> is governed by -> reference value`. The links collectively
# form the approved set for that property, and only for that property: two
# properties may draw on the same vocabulary and approve different parts of it.


@router.get('/node-instances/{node_instance_id}/approved-values')
def list_property_approved_values(
    node_instance_id: str, svc: PropertyRuleService = Depends(_property_rules)
):
    try:
        return svc.list_values(node_instance_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/node-instances/{node_instance_id}/approved-values/candidates')
def list_property_value_candidates(
    node_instance_id: str,
    element_type_id: str = Query(...),
    svc: PropertyRuleService = Depends(_property_rules),
):
    """One vocabulary's values, with the ones this property approves marked."""
    try:
        return svc.list_candidate_values(node_instance_id, element_type_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put('/node-instances/{node_instance_id}/approved-values')
def set_property_approved_values(
    node_instance_id: str,
    element_instance_ids: list[str] = Body(default=[], embed=True),
    actor: str = Query(default='user'),
    svc: PropertyRuleService = Depends(_property_rules),
):
    """Replace this property's approved values with exactly these."""
    try:
        return svc.set_approved_values(node_instance_id, element_instance_ids, actor=actor)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete(
    '/property-reference-values/{reference_link_id}', status_code=status.HTTP_204_NO_CONTENT
)
def revoke_property_approved_value(
    reference_link_id: str, svc: PropertyRuleService = Depends(_property_rules)
):
    try:
        svc.revoke_value(reference_link_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return None


@router.get('/governed-vocabularies')
def list_governed_vocabularies(
    support_domain_model_id: str = Query(default=''),
    svc: PropertyRuleService = Depends(_property_rules),
):
    """Every vocabulary a property could draw approved values from."""
    return svc.list_vocabularies(support_domain_model_id)


# --- Support Domain Element Instances ---

@router.get('/element-instances')
def list_element_instances(
    model_id: str | None = Query(default=None),
    db_url=Depends(get_database_url),
):
    return ElementInstanceService(db_url).list_instances(model_id=model_id)


@router.get('/element-instances/{instance_id}/impacts/delete')
def get_element_instance_delete_impact(instance_id: str, db_url=Depends(get_database_url)):
    try:
        return ElementInstanceService(db_url).get_instance_delete_impact(instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/element-instances/models/{model_id}/impacts/delete')
def get_support_domain_model_delete_impact(model_id: str, db_url=Depends(get_database_url)):
    try:
        return ElementInstanceService(db_url).get_model_delete_impact(model_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete('/element-instances/models/{model_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_support_domain_model(model_id: str, db_url=Depends(get_database_url)):
    try:
        ElementInstanceService(db_url).delete_model(model_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post('/element-instances', status_code=status.HTTP_201_CREATED)
def create_element_instance(command: CreateElementInstanceCommand, db_url=Depends(get_database_url)):
    try:
        return ElementInstanceService(db_url).create_instance(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch('/element-instances/{instance_id}')
def update_element_instance(instance_id: str, command: UpdateElementInstanceCommand, db_url=Depends(get_database_url)):
    try:
        return ElementInstanceService(db_url).update_instance(instance_id, command)
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete('/element-instances/{instance_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_element_instance(instance_id: str, db_url=Depends(get_database_url)):
    try:
        ElementInstanceService(db_url).delete_instance(instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# --- Support Domain diagram (drawn on the diagram / matrix) ---
# Diagram storage only: the support_domain_element_instance_relationship_diagram*
# combo. Element instance relationships are inherited from the element types and
# are not read from here. /sd-diagram-links are the diagram's edges;
# /element-instance-relationships stays as an alias.

@router.get('/sd-diagram')
def get_sd_diagram_layout(model_id: str = Query(...), db_url=Depends(get_database_url)):
    return SupportDomainInstanceRelationshipDiagramService(db_url).get_layout(model_id)


@router.put('/sd-diagram/nodes')
def replace_sd_diagram_nodes(command: ReplaceSdDiagramNodesCommand, db_url=Depends(get_database_url)):
    try:
        return SupportDomainInstanceRelationshipDiagramService(db_url).replace_nodes(command.support_domain_model_id, command.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/sd-diagram-links')
@router.get('/element-instance-relationships')
def list_element_instance_relationships(
    model_id: str | None = Query(default=None),
    db_url=Depends(get_database_url),
):
    return SupportDomainInstanceRelationshipDiagramService(db_url).list_edges(model_id)


@router.post('/sd-diagram-links', status_code=status.HTTP_201_CREATED)
@router.post('/element-instance-relationships', status_code=status.HTTP_201_CREATED)
def create_element_instance_relationship(
    command: CreateElementRelationshipInstanceCommand,
    db_url=Depends(get_database_url),
):
    try:
        return SupportDomainInstanceRelationshipDiagramService(db_url).create_edge(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete('/sd-diagram-links/{relationship_instance_id}', status_code=status.HTTP_204_NO_CONTENT)
@router.delete('/element-instance-relationships/{relationship_instance_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_element_instance_relationship(relationship_instance_id: str, db_url=Depends(get_database_url)):
    try:
        SupportDomainInstanceRelationshipDiagramService(db_url).delete_edge(relationship_instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/cross-model-instances')
def list_cross_model_instances(
    source_instance_id: str | None = Query(default=None),
    target_instance_id: str | None = Query(default=None),
    db_url=Depends(get_database_url),
):
    svc = CrossModelInstanceService(db_url)
    if source_instance_id:
        return svc.list_links_for_source(source_instance_id)
    if target_instance_id:
        return svc.list_links_for_target(target_instance_id)
    return svc.list_all_links()


@router.post('/cross-model-instances', status_code=status.HTTP_201_CREATED)
def create_cross_model_instance(command: CreateCrossModelInstanceCommand, db_url=Depends(get_database_url)):
    try:
        return CrossModelInstanceService(db_url).create_link(command)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch('/cross-model-instances/{cross_model_instance_id}')
def update_cross_model_instance(
    cross_model_instance_id: str,
    command: UpdateCrossModelInstanceCommand,
    db_url=Depends(get_database_url),
):
    try:
        return CrossModelInstanceService(db_url).update_link(cross_model_instance_id, command)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete('/cross-model-instances/{cross_model_instance_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_cross_model_instance(cross_model_instance_id: str, db_url=Depends(get_database_url)):
    try:
        CrossModelInstanceService(db_url).delete_link(cross_model_instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# --- Saved cross-model relationship diagrams (instance level) ---

@router.get('/cross-model-instance-diagrams')
def list_cross_model_instance_diagrams(db_url=Depends(get_database_url)):
    return CrossModelInstanceDiagramService(db_url).list_diagrams()


@router.get('/cross-model-instance-diagrams/{diagram_id}')
def get_cross_model_instance_diagram(diagram_id: str, db_url=Depends(get_database_url)):
    try:
        return CrossModelInstanceDiagramService(db_url).get_diagram(diagram_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post('/cross-model-instance-diagrams', status_code=status.HTTP_201_CREATED)
def create_cross_model_instance_diagram(command: SaveCrossModelInstanceDiagramCommand, db_url=Depends(get_database_url)):
    return CrossModelInstanceDiagramService(db_url).create_diagram(command)


@router.put('/cross-model-instance-diagrams/{diagram_id}')
def update_cross_model_instance_diagram(
    diagram_id: str,
    command: SaveCrossModelInstanceDiagramCommand,
    db_url=Depends(get_database_url),
):
    try:
        return CrossModelInstanceDiagramService(db_url).update_diagram(diagram_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete('/cross-model-instance-diagrams/{diagram_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_cross_model_instance_diagram(diagram_id: str, db_url=Depends(get_database_url)):
    try:
        CrossModelInstanceDiagramService(db_url).delete_diagram(diagram_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# --- Node instance properties ---

@router.get('/node-instances/{node_instance_id}/properties')
def list_node_instance_properties(node_instance_id: str, db_url=Depends(get_database_url)):
    return NodeInstancePropertyService(db_url).list(node_instance_id)


@router.put('/node-instances/{node_instance_id}/properties', status_code=status.HTTP_200_OK)
def upsert_node_instance_property(
    node_instance_id: str,
    command: UpsertInstancePropertyCommand,
    db_url=Depends(get_database_url),
):
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Structure workspace properties are read-only. Manage property definitions in Model workspace.",
    )


@router.put('/node-instances/{node_instance_id}/properties/{property_id}/value')
def set_node_instance_property_value(
    node_instance_id: str,
    property_id: str,
    command: SetNodePropertyValueCommand,
    db_url=Depends(get_database_url),
):
    """Set (or clear, with an empty value) the instance's value for a Node Type Property."""
    try:
        return NodeInstancePropertyService(db_url).set_value(node_instance_id, property_id, command.value)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete('/node-instance-properties/{property_instance_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_node_instance_property(property_instance_id: str, db_url=Depends(get_database_url)):
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Structure workspace properties are read-only. Manage property definitions in Model workspace.",
    )


# --- Element instance properties ---

@router.get('/element-instances/{instance_id}/properties')
def list_element_instance_properties(instance_id: str, db_url=Depends(get_database_url)):
    return ElementInstancePropertyService(db_url).list(instance_id)


@router.put('/element-instances/{instance_id}/properties', status_code=status.HTTP_200_OK)
def upsert_element_instance_property(
    instance_id: str,
    command: UpsertInstancePropertyCommand,
    db_url=Depends(get_database_url),
):
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Structure workspace properties are read-only. Manage property definitions in Model workspace.",
    )


@router.delete('/element-instance-properties/{property_instance_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_element_instance_property(property_instance_id: str, db_url=Depends(get_database_url)):
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Structure workspace properties are read-only. Manage property definitions in Model workspace.",
    )


# --- Governed Structure Import / Export ---

@router.post('/imports/hierarchy/validate', response_model=StructureImportValidateResponse)
def validate_hierarchy_import(request: StructureHierarchyImportValidateRequest, db_url=Depends(get_database_url)):
    payload = {
        'template_metadata': request.template_metadata,
        'load_hierarchy_node_instances': request.load_hierarchy_node_instances,
        'load_support_domain_elements': [],
        'load_support_domain_relationships': [],
    }
    stage_id, summary, rows = StructureImportService(db_url).validate(payload)
    return StructureImportValidateResponse(stage_id=stage_id, summary=summary, rows=rows)


@router.post('/imports/support-domain/validate', response_model=StructureImportValidateResponse)
def validate_support_domain_import(request: StructureSupportDomainImportValidateRequest, db_url=Depends(get_database_url)):
    payload = {
        'template_metadata': request.template_metadata,
        'load_hierarchy_node_instances': [],
        'load_support_domain_elements': request.load_support_domain_elements,
        'load_support_domain_relationships': [],
        'load_support_domain_element_instance_relationships': request.load_support_domain_element_instance_relationships,
    }
    stage_id, summary, rows = StructureImportService(db_url).validate(payload)
    return StructureImportValidateResponse(stage_id=stage_id, summary=summary, rows=rows)


@router.post('/imports/support-domain-relationships/validate', response_model=StructureImportValidateResponse)
def validate_support_domain_relationship_import(request: StructureSupportDomainRelationshipImportValidateRequest, db_url=Depends(get_database_url)):
    payload = {
        'template_metadata': request.template_metadata,
        'load_hierarchy_node_instances': [],
        'load_support_domain_elements': [],
        'load_support_domain_element_relationships': request.load_support_domain_element_relationships,
        'load_support_domain_relationships': [],
    }
    stage_id, summary, rows = StructureImportService(db_url).validate(payload)
    return StructureImportValidateResponse(stage_id=stage_id, summary=summary, rows=rows)


@router.post('/imports/support-domain-relationships/commit', response_model=StructureImportCommitResponse)
def commit_support_domain_relationship_import(request: StructureImportCommitRequest, db_url=Depends(get_database_url)):
    try:
        committed, failed, rows = StructureImportService(db_url).commit(
            request.stage_id,
            request.selected_row_numbers,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StructureImportCommitResponse(
        stage_id=request.stage_id,
        committed=committed,
        failed=failed,
        rows=rows,
    )


@router.post('/imports/hierarchy/commit', response_model=StructureImportCommitResponse)
def commit_hierarchy_import(request: StructureImportCommitRequest, db_url=Depends(get_database_url)):
    try:
        committed, failed, rows = StructureImportService(db_url).commit(
            request.stage_id,
            request.selected_row_numbers,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StructureImportCommitResponse(
        stage_id=request.stage_id,
        committed=committed,
        failed=failed,
        rows=rows,
    )


@router.post('/imports/support-domain/commit', response_model=StructureImportCommitResponse)
def commit_support_domain_import(request: StructureImportCommitRequest, db_url=Depends(get_database_url)):
    try:
        committed, failed, rows = StructureImportService(db_url).commit(
            request.stage_id,
            request.selected_row_numbers,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StructureImportCommitResponse(
        stage_id=request.stage_id,
        committed=committed,
        failed=failed,
        rows=rows,
    )

@router.post('/imports/validate', response_model=StructureImportValidateResponse)
def validate_structure_import(request: StructureImportValidateRequest, db_url=Depends(get_database_url)):
    stage_id, summary, rows = StructureImportService(db_url).validate(request.payload.model_dump())
    return StructureImportValidateResponse(stage_id=stage_id, summary=summary, rows=rows)


@router.post('/imports/commit', response_model=StructureImportCommitResponse)
def commit_structure_import(request: StructureImportCommitRequest, db_url=Depends(get_database_url)):
    try:
        committed, failed, rows = StructureImportService(db_url).commit(
            request.stage_id,
            request.selected_row_numbers,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StructureImportCommitResponse(
        stage_id=request.stage_id,
        committed=committed,
        failed=failed,
        rows=rows,
    )


@router.get('/exports')
def export_structure_data(
    template_type: str = Query(default='all', pattern='^(all|hierarchy|support-domain)$'),
    model_ids: list[str] | None = Query(default=None),
    db_url=Depends(get_database_url),
):
    return StructureExportService(db_url).export(template_type=template_type, model_ids=model_ids)


# ── Governance graph: reading what Structure asserts ─────────────────────────
#
# Read-only, every one of them. Consumers (the Impact workspace) read the graph;
# nothing here creates a node or a relationship.


@router.get('/governance-graph/items')
def search_governance_graph_items(
    search: str = Query(default=''),
    kind: str = Query(default=''),
    model_id: str = Query(default=''),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db_url=Depends(get_database_url),
):
    """
    The items a person can pick from the graph, a page at a time.

    Searched here rather than in the browser: a real database holds tens of
    thousands of element instances, and shipping them all to be filtered is
    what makes a picker unusable.
    """
    try:
        return StructureGovernanceGraphService(db_url).search_items(
            search=search, kind=kind, model_id=model_id, limit=limit, offset=offset
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/governance-graph/items')
def get_governance_graph_items(command: GovernanceGraphItemsCommand, db_url=Depends(get_database_url)):
    """Items by id, with the ids that no longer resolve named explicitly."""
    return StructureGovernanceGraphService(db_url).get_items(command.item_ids)


@router.post('/governance-graph/neighbourhood')
def governance_graph_neighbourhood(
    command: GovernanceGraphNeighbourhoodCommand, db_url=Depends(get_database_url)
):
    """Everything related to these items within a few asserted hops."""
    return StructureGovernanceGraphService(db_url).neighbourhood(command.item_ids, command.depth)
