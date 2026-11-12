"""
The Rule Workspace: writing a rule, and what the workspace refuses.

A rule is authored here on its own and attached to a field in Discover later,
so nothing in this file names a session, a model or a field. What it does
cover is the behaviour the workspace promises: a rule has a name nobody else
has, a category of the person's own choosing, a severity they set, and a code
that never changes once handed out.
"""
from fastapi.testclient import TestClient

RULES = "/api/rules"


def _rule(**overrides) -> dict:
    """A valid rule, so each test states only the part it is about."""
    body = {
        "name": "Asset ID must be filled in",
        "description": "Every switch needs an identifier.",
        "category": "Common",
        "definition_kind": "builtin",
        "check_type": "mandatory",
        "parameters": {},
        "severity": "high",
        "status": "active",
        "dimension": "completeness",
        "data_type": "any",
        "rationale": "An asset without an id cannot be traced.",
    }
    body.update(overrides)
    return body


def _create(client: TestClient, **overrides):
    return client.post(RULES, json=_rule(**overrides))


# ── the catalogue the editor is built from ──────────────────────────────────

def test_catalogue_offers_the_choices_the_editor_shows(client: TestClient):
    catalogue = client.get(f"{RULES}/catalogue")
    assert catalogue.status_code == 200
    body = catalogue.json()

    # Severity is set on the rule here and read everywhere else, so the list
    # of levels is part of the contract rather than an implementation detail.
    assert [level["key"] for level in body["severities"]] == ["low", "medium", "high"]
    assert [state["key"] for state in body["statuses"]] == ["draft", "active", "retired"]
    assert body["check_types"], "the editor needs at least one check to offer"
    # A check offers its own key under `check_type`, plus the words the editor
    # shows and the kinds of field it may be attached to.
    assert all(
        {"check_type", "label", "data_types"} <= set(check)
        for check in body["check_types"]
    )
    assert "mandatory" in {check["check_type"] for check in body["check_types"]}


# ── writing one ─────────────────────────────────────────────────────────────

def test_a_new_rule_keeps_what_was_written_and_is_given_a_code(client: TestClient):
    created = _create(client)
    assert created.status_code == 201, created.text
    rule = created.json()

    assert rule["name"] == "Asset ID must be filled in"
    assert rule["severity"] == "high"
    assert rule["status"] == "active"
    assert rule["category"] == "Common"
    assert rule["code"], "a rule is given a code at creation"

    fetched = client.get(f"{RULES}/{rule['rule_definition_id']}").json()
    assert fetched["code"] == rule["code"]
    assert fetched["severity"] == "high"


def test_the_code_survives_renaming_the_rule(client: TestClient):
    rule = _create(client).json()
    code = rule["code"]

    renamed = client.put(
        f"{RULES}/{rule['rule_definition_id']}",
        json=_rule(name="Asset ID is required", severity="low"),
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Asset ID is required"
    assert renamed.json()["severity"] == "low"
    # Results cite the code, so it has to outlive the wording of the rule.
    assert renamed.json()["code"] == code


def test_two_rules_cannot_share_a_name(client: TestClient):
    assert _create(client).status_code == 201
    clash = _create(client, severity="low")
    assert clash.status_code == 400
    assert "already exists" in clash.json()["detail"]


def test_a_rule_may_be_renamed_to_the_name_it_already_has(client: TestClient):
    rule = _create(client).json()
    # Editing a rule without touching its name must not read as a clash with
    # itself, which is what excluding_id is for.
    same = client.put(
        f"{RULES}/{rule['rule_definition_id']}",
        json=_rule(description="Reworded, same name."),
    )
    assert same.status_code == 200, same.text


def test_a_rule_needs_a_name_and_a_category(client: TestClient):
    assert _create(client, name="   ").status_code in (400, 422)
    assert _create(client, name="No category", category="  ").status_code in (400, 422)


def test_an_unknown_check_type_is_refused_by_name(client: TestClient):
    refused = _create(client, check_type="telepathy")
    assert refused.status_code == 400
    assert "telepathy" in refused.json()["detail"]


def test_severity_outside_the_three_levels_is_refused(client: TestClient):
    # "critical" is not a level this platform has; the editor should never be
    # able to write one the rest of the system cannot read.
    assert _create(client, severity="critical").status_code == 422


# ── categories are the person's own words ───────────────────────────────────

def test_a_category_is_free_text_and_is_listed_back(client: TestClient):
    _create(client, name="Pole height", category="GIS asset data")
    catalogue = client.get(f"{RULES}/catalogue").json()
    assert "GIS asset data" in catalogue["categories"]


def test_a_new_rule_joins_the_spelling_already_in_the_library(client: TestClient):
    _create(client, name="First", category="GIS")
    joined = _create(client, name="Second", category="gis").json()
    # Otherwise "GIS", "Gis" and "gis" become three groups of one rule each.
    assert joined["category"] == "GIS"


def test_editing_a_rule_can_rename_its_category(client: TestClient):
    rule = _create(client, name="First", category="GIS").json()
    renamed = client.put(
        f"{RULES}/{rule['rule_definition_id']}",
        json=_rule(name="First", category="Gis Australia"),
    )
    assert renamed.status_code == 200, renamed.text
    # On an edit the typed spelling has to win, or a category could never be
    # renamed — it would snap straight back to the old one.
    assert renamed.json()["category"] == "Gis Australia"


# ── finding one again ───────────────────────────────────────────────────────

def test_the_library_can_be_searched_and_filtered(client: TestClient):
    _create(client, name="Asset ID must be filled in", category="Common", status="active")
    _create(client, name="Pole height must be a number", category="GIS", status="draft")

    everything = client.get(RULES).json()
    assert everything["total"] == 2
    assert everything["active"] == 1

    by_category = client.get(RULES, params={"category": "GIS"}).json()
    assert [r["name"] for r in by_category["items"]] == ["Pole height must be a number"]

    by_status = client.get(RULES, params={"status": "active"}).json()
    assert [r["name"] for r in by_status["items"]] == ["Asset ID must be filled in"]

    by_search = client.get(RULES, params={"search": "pole"}).json()
    assert [r["name"] for r in by_search["items"]] == ["Pole height must be a number"]


def test_a_rule_that_does_not_exist_says_so(client: TestClient):
    assert client.get(f"{RULES}/rd_nothing").status_code == 404
    assert client.put(f"{RULES}/rd_nothing", json=_rule()).status_code == 404
    assert client.delete(f"{RULES}/rd_nothing").status_code == 404


def test_a_rule_can_be_removed(client: TestClient):
    rule = _create(client).json()
    assert client.delete(f"{RULES}/{rule['rule_definition_id']}").status_code == 204
    assert client.get(f"{RULES}/{rule['rule_definition_id']}").status_code == 404
    assert client.get(RULES).json()["total"] == 0
