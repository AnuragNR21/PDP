from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from fastapi.responses import PlainTextResponse

from app.dependencies import get_database_url
from features.rules.domain.models import (
    SaveRuleCommand,
    SaveRuleConfigurationCommand,
    TestExamplesCommand,
    ValidateScriptCommand,
)
from features.rules.service.rule_configuration_service import RuleConfigurationService
from features.rules.service.rule_service import RuleInUseError, RuleService
from features.rules.service.rule_transfer_service import (
    RuleExportService,
    RuleImportService,
)

router = APIRouter(prefix="/rules", tags=["rules"])


def _service(db_url=Depends(get_database_url)) -> RuleService:
    return RuleService(db_url)


def _configurations(db_url=Depends(get_database_url)) -> RuleConfigurationService:
    return RuleConfigurationService(db_url)


@router.get("/catalogue")
def get_catalogue(svc: RuleService = Depends(_service)):
    """Check types and their parameters — everything the authoring form needs."""
    return svc.get_catalogue()


@router.post("/validate-script")
def validate_script(payload: ValidateScriptCommand, svc: RuleService = Depends(_service)):
    """Check a script without saving it. Never runs the script."""
    return svc.validate_script(payload.script)


@router.post("/test-examples")
def test_examples(payload: TestExamplesCommand, svc: RuleService = Depends(_service)):
    """Hold a draft rule to its worked examples. Reads no data and saves nothing."""
    try:
        return svc.test_examples(payload.check_type, payload.parameters, payload.examples_pass, payload.examples_fail)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── rule configurations ──────────────────────────────────────────────────────
#
# A definition says what a check does; a configuration says what it checks
# against. Declared above `GET /{rule_definition_id}`, or "configurations"
# would be read as a rule id.


@router.get("/configurations")
def list_rule_configurations(
    rule_definition_id: str = Query(default=""),
    search: str = Query(default=""),
    configuration_status: str = Query(default="", alias="status"),
    svc: RuleConfigurationService = Depends(_configurations),
):
    """
    Every named, parameterised use of a definition.

    A configuration that draws its values from a governed vocabulary comes back
    with those values already resolved, so the caller sees what it will actually
    check rather than an empty parameter.
    """
    return svc.list_configurations(
        rule_definition_id=rule_definition_id, search=search, status=configuration_status
    )


@router.get("/configurations/vocabularies")
def list_rule_configuration_vocabularies(
    support_domain_model_id: str = Query(default=""),
    db_url=Depends(get_database_url),
):
    """The governed vocabularies a configuration can take its values from."""
    from features.rules.repo.support_domain_vocabulary_repository import (
        SupportDomainVocabularyRepository,
    )

    items = SupportDomainVocabularyRepository(db_url).list_element_types(support_domain_model_id)
    return {"items": items, "total": len(items)}


@router.get("/configurations/vocabularies/{element_type_id}/values")
def list_rule_configuration_vocabulary_values(
    element_type_id: str,
    db_url=Depends(get_database_url),
):
    """
    The values one governed vocabulary holds, for the rule author to tick.

    Only active ones: a retired value is a value the business has stopped
    accepting, and offering it here would let a rule approve it again.
    """
    from features.rules.repo.support_domain_vocabulary_repository import (
        SupportDomainVocabularyRepository,
    )

    repo = SupportDomainVocabularyRepository(db_url)
    element_type = repo.get_element_type(element_type_id)
    if element_type is None:
        raise HTTPException(status_code=404, detail="That governed vocabulary no longer exists.")
    items = repo.list_instances(element_type_id)
    return {
        "element_type_id": element_type_id,
        "element_type_name": element_type["name"],
        "model_name": element_type.get("model_name", ""),
        "items": items,
        "total": len(items),
    }


@router.get("/configurations/{rule_configuration_id}")
def get_rule_configuration(
    rule_configuration_id: str, svc: RuleConfigurationService = Depends(_configurations)
):
    try:
        return svc.get_configuration(rule_configuration_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/configurations/{rule_configuration_id}/versions")
def list_rule_configuration_versions(
    rule_configuration_id: str, svc: RuleConfigurationService = Depends(_configurations)
):
    try:
        return svc.list_versions(rule_configuration_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/configurations", status_code=status.HTTP_201_CREATED)
def create_rule_configuration(
    command: SaveRuleConfigurationCommand,
    actor: str = Query(default="user"),
    svc: RuleConfigurationService = Depends(_configurations),
):
    try:
        return svc.create_configuration(command, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/configurations/{rule_configuration_id}")
def update_rule_configuration(
    rule_configuration_id: str,
    command: SaveRuleConfigurationCommand,
    actor: str = Query(default="user"),
    svc: RuleConfigurationService = Depends(_configurations),
):
    try:
        return svc.update_configuration(rule_configuration_id, command, actor=actor)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/configurations/{rule_configuration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule_configuration(
    rule_configuration_id: str, svc: RuleConfigurationService = Depends(_configurations)
):
    try:
        svc.delete_configuration(rule_configuration_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── code families ────────────────────────────────────────────────────────────
#
# Declared above `GET /{rule_definition_id}`, or "code-prefixes" would be read
# as a rule id and answered with a 404.


@router.get("/code-prefixes")
def list_code_prefixes(svc: RuleService = Depends(_service)):
    """
    Every category and the code family it hands out.

    A category nobody has configured is listed with the prefix derived from its
    name, marked `source: "default"` — so the page shows the whole picture, not
    only the rows somebody has already touched.
    """
    return svc.list_code_prefixes()


@router.put("/code-prefixes/{category}")
def set_code_prefix(
    category: str,
    prefix: str = Body(embed=True),
    actor: str = Query(default="user"),
    svc: RuleService = Depends(_service),
):
    """
    Choose the code family for a category.

    Codes already issued keep the prefix they were issued under: results cite
    codes, so rewriting one would re-label old evidence. The new family starts
    with the next rule created.
    """
    try:
        return svc.set_code_prefix(category, prefix, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/code-prefixes/{category}")
def clear_code_prefix(category: str, svc: RuleService = Depends(_service)):
    """Back to the prefix derived from the category name."""
    return svc.clear_code_prefix(category)


# ── import / export ──────────────────────────────────────────────────────────


@router.get("/export", response_class=PlainTextResponse)
def export_rules(
    rule_status: str = Query(default="", alias="status"),
    category: str = Query(default=""),
    search: str = Query(default=""),
    db_url=Depends(get_database_url),
):
    """
    The library as CSV.

    The internal rule id is the first column on purpose: a file that carries it
    re-imports by identity, so renaming a rule in the spreadsheet updates that
    rule rather than creating a second one.
    """
    body = RuleExportService(db_url).export_csv(
        status=rule_status, category=category, search=search
    )
    return PlainTextResponse(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="rules.csv"'},
    )


@router.get("/export/template", response_class=PlainTextResponse)
def export_rule_template(db_url=Depends(get_database_url)):
    """An empty file with the right headers, for a library starting from scratch."""
    return PlainTextResponse(
        content=RuleExportService(db_url).template_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="rules-template.csv"'},
    )


@router.post("/imports/validate")
def validate_rule_import(
    csv: str = Body(embed=True),
    actor: str = Query(default="user"),
    db_url=Depends(get_database_url),
):
    """
    Reconcile a file against the library. Writes nothing.

    The CSV arrives as text rather than as an upload: the browser has already
    read the file, and sending it as text keeps this endpoint free of a
    multipart dependency the rest of the backend does not carry.

    Returns one row per line, each saying whether it would create, change or
    leave a rule alone, and — when it would change one — which fields, from
    what to what. Nothing happens until those rows are committed.
    """
    try:
        return RuleImportService(db_url).validate(csv, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/imports/commit")
def commit_rule_import(
    stage_id: str = Body(...),
    selected_row_numbers: list[int] | None = Body(default=None),
    actor: str = Query(default="user"),
    db_url=Depends(get_database_url),
):
    """Apply the rows that were ticked in the review, and nothing else."""
    try:
        return RuleImportService(db_url).commit(
            stage_id, selected_row_numbers, actor=actor
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("")
def list_rules(
    search: str = Query(default=""),
    rule_status: str = Query(default="", alias="status"),
    category: str = Query(default=""),
    svc: RuleService = Depends(_service),
):
    return svc.list_rules(search=search, status=rule_status, category=category)


@router.get("/{rule_definition_id}/versions")
def list_rule_versions(rule_definition_id: str, svc: RuleService = Depends(_service)):
    """
    Every version this rule has been, newest first.

    A result cites a version; this is how somebody reads what that version
    said, rather than what the rule says now.
    """
    try:
        return svc.list_versions(rule_definition_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{rule_definition_id}/versions/{version}")
def get_rule_version(
    rule_definition_id: str, version: int, svc: RuleService = Depends(_service)
):
    """One version of a rule, exactly as it was when it was in force."""
    try:
        return svc.get_version(rule_definition_id, version)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{rule_definition_id}")
def get_rule(rule_definition_id: str, svc: RuleService = Depends(_service)):
    try:
        return svc.get_rule(rule_definition_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rule(
    command: SaveRuleCommand,
    actor: str = Query(default="user"),
    svc: RuleService = Depends(_service),
):
    try:
        return svc.create_rule(command, actor=actor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{rule_definition_id}")
def update_rule(
    rule_definition_id: str,
    command: SaveRuleCommand,
    actor: str = Query(default="user"),
    svc: RuleService = Depends(_service),
):
    try:
        return svc.update_rule(rule_definition_id, command, actor=actor)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{rule_definition_id}/usage")
def get_rule_usage(rule_definition_id: str, svc: RuleService = Depends(_service)):
    """Where the rule is in use — what the person is warned about before deleting it."""
    try:
        return svc.rule_usage(rule_definition_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{rule_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_definition_id: str,
    force: bool = Query(default=False, description="Delete even though the rule is in use (the user was warned)."),
    svc: RuleService = Depends(_service),
):
    try:
        svc.delete_rule(rule_definition_id, force=force)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuleInUseError as exc:
        # 409 until the caller confirms with force=true: a warning, not a lock.
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
