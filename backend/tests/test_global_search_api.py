"""PDP global search: one search across models, types, instances, properties,
relationships, rules and Discover, ranked by how well the name matches."""

import json

from app.dependencies import get_database_url
from shared.db import get_connection
from tests.test_discover_workspace import _new_session
from tests.test_rules_api import _create as _create_rule
from tests.test_sd_element_relationship_instances_api import _element, _instance, _model, _relationship

SEARCH = "/api/search"


def _hierarchy(client):
    """'Asset Information' with Power Transformer (type), TX-001 (instance) and an asset property."""
    created = client.post(
        "/api/model/hierarchy-models",
        json={"name": "Asset Information", "purpose": "Network assets", "owning_domain": "information", "status": "active"},
    )
    assert created.status_code == 200, created.text
    model_id = created.json()["model_id"]
    with get_connection(get_database_url()) as conn:
        def node_type(type_id, name, description="", is_property=False, status="active"):
            conn.execute(
                "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description, status, is_property, created_at, updated_at)"
                " VALUES (%s,%s,%s,%s,%s,%s,NOW(),NOW())",
                (type_id, model_id, name, description, status, is_property),
            )
        node_type("nt_tx", "Power Transformer")
        node_type("nt_sw", "Switchgear", "Indoor switchgear, never a transformer")
        node_type("nt_old", "Transformer (old)", status="retired")
        node_type("nt_mf", "Transformer Manufacturer", is_property=True)
        conn.execute(
            "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, node_type_id, name, status, external_id, created_at, updated_at)"
            " VALUES ('ni_tx1', %s, 'nt_tx', 'TX-001', 'active', 'GIS-TRANS-77', NOW(), NOW())",
            (model_id,),
        )
    return model_id


def _search(client, q, **params):
    response = client.get(SEARCH, params={"q": q, **params})
    assert response.status_code == 200, response.text
    return response.json()


def _found(body):
    return {(item["type"], item["name"]) for group in body["groups"] for item in group["items"]}


def test_trans_finds_transformer_content_where_no_model_is_named_trans(client):
    model_id = _hierarchy(client)
    sd = _model(client, "Asset Classification")
    failure = _element(client, sd, "Failure Mode")
    asset_type = _element(client, sd, "Asset Type")
    _instance(client, sd, asset_type, "Power Transformer")
    _relationship(client, sd, asset_type, failure, kind="categorises")
    _create_rule(client, name="Transformer rating must be filled in")
    _new_session(client, "Transformer extract review")

    body = _search(client, "trans")
    found = _found(body)
    assert ("node_type", "Power Transformer") in found
    assert ("asset_property", "Transformer Manufacturer") in found
    assert ("element_instance", "Power Transformer") in found
    assert ("rule_definition", "Transformer rating must be filled in") in found
    assert ("discover_session", "Transformer extract review") in found
    # Found by its external id: a metadata match, said so.
    tx = next(i for g in body["groups"] for i in g["items"] if i["name"] == "TX-001")
    assert tx["match"] == "property" and tx["snippet"] == "GIS-TRANS-77"
    assert tx["workspace"] == "SWS" and tx["model_name"] == "Asset Information" and tx["detail"] == "Power Transformer"
    assert tx["package"] == "Shared Models"
    # Groups come in the agreed order and say how many each holds.
    order = [g["group"] for g in body["groups"]]
    assert order == sorted(order, key=["models", "types", "instances", "properties", "relationships", "rules", "discover", "quality"].index)
    assert body["counts"]["types"] == 3  # Power Transformer, Transformer (old), Switchgear (by description)
    del model_id


def test_names_rank_ahead_of_descriptions(client):
    _hierarchy(client)
    with get_connection(get_database_url()) as conn:
        model_id = conn.execute("SELECT model_id FROM hierarchy_model WHERE name = 'Asset Information'").fetchone()["model_id"]
        conn.execute(
            "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description, status, created_at, updated_at)"
            " VALUES ('nt_exact', %s, 'Transformer', '', 'active', NOW(), NOW())",
            (model_id,),
        )
    types = next(g for g in _search(client, "transformer")["groups"] if g["group"] == "types")
    assert [(i["name"], i["match"]) for i in types["items"]] == [
        ("Transformer", "exact"),
        ("Transformer (old)", "prefix"),
        ("Power Transformer", "name"),
        ("Switchgear", "description"),
    ]


def test_archived_content_is_found_and_shown_and_can_be_filtered(client):
    _hierarchy(client)
    everything = _found(_search(client, "transformer"))
    assert ("node_type", "Transformer (old)") in everything
    old = next(i for g in _search(client, "transformer (old)")["groups"] for i in g["items"] if i["name"] == "Transformer (old)")
    assert old["status"] == "retired"
    archived_only = _search(client, "transformer", status="retired")
    assert _found(archived_only) == {("node_type", "Transformer (old)")}
    assert ("node_type", "Transformer (old)") not in _found(_search(client, "transformer", status="active"))


def test_types_filter_narrows_but_counts_stay(client):
    _hierarchy(client)
    _create_rule(client, name="Transformer rating must be filled in")
    body = _search(client, "transformer", types="rules")
    assert [g["group"] for g in body["groups"]] == ["rules"]
    assert body["counts"]["types"] >= 1 and body["counts"]["rules"] == 1


def test_rule_categories_are_found_with_or_without_a_prefix_of_their_own(client):
    """A category the library uses is found even when nobody changed its code prefix."""
    assert _create_rule(client, name="Pole height filled in", category="Vegetation clearance").status_code in (200, 201)
    found = [i for g in _search(client, "vegetation clear", types="rules")["groups"] for i in g["items"] if i["type"] == "dq_category"]
    assert [(i["name"], i["detail"], i["focus_id"], i["rank"]) for i in found] == [
        ("Vegetation clearance", "Rule category", "Vegetation clearance", 1)
    ]
    # Set up in advance with a prefix and used by no rule yet: found too, once.
    assert client.put("/api/rules/code-prefixes/Line%20inspection", json={"prefix": "LI"}).status_code == 200
    assert client.put("/api/rules/code-prefixes/Vegetation%20clearance", json={"prefix": "VC"}).status_code == 200
    found = {i["name"]: i["detail"] for g in _search(client, "inspection", types="rules")["groups"] for i in g["items"] if i["type"] == "dq_category"}
    assert found == {"Line inspection": "Code prefix LI"}
    found = [i["detail"] for g in _search(client, "vegetation", types="rules")["groups"] for i in g["items"] if i["type"] == "dq_category"]
    assert found == ["Code prefix VC"]


def test_a_configuration_whose_rule_is_gone_is_not_offered(client):
    """The Rule Workspace lists configurations through their rule; search must not open on nothing."""
    with get_connection(get_database_url()) as conn:
        # No foreign key on rule_definition_id: deleting a rule left its configuration behind.
        conn.execute(
            "INSERT INTO rule_configuration (rule_configuration_id, rule_definition_id, name, status, created_at, updated_at)"
            " VALUES ('rcfg_orphan', 'rule_gone', 'Orphan voltage range check', 'active', NOW(), NOW())"
        )
    found = {i["name"] for g in _search(client, "orphan voltage")["groups"] for i in g["items"]}
    assert "Orphan voltage range check" not in found


def test_limit_and_short_or_wildcard_queries(client):
    _hierarchy(client)
    assert _search(client, "t")["groups"] == []
    assert _search(client, "%")["groups"] == []  # no "match everything"
    assert _search(client, "__")["groups"] == []
    limited = next(g for g in _search(client, "trans", limit=1)["groups"] if g["group"] == "types")
    assert len(limited["items"]) == 1 and limited["total"] == 3


def test_a_models_package_comes_from_the_package_setting(client):
    model_id = _hierarchy(client)
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO organisation_setting (setting_key, setting_value, updated_at) VALUES ('mws_model_packages', %s, NOW())"
            " ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value",
            (json.dumps({"packages": [{"id": "p1", "name": "Common Models"}], "owner": {f"hierarchy:{model_id}": "p1"}}),),
        )
    model = next(i for g in _search(client, "asset information")["groups"] for i in g["items"] if i["type"] == "hierarchy_model")
    assert model["package"] == "Common Models" and model["match"] == "exact"


def test_relationships_and_discover_tables(client):
    sd = _model(client, "Vocab")
    a = _element(client, sd, "Asset Type")
    b = _element(client, sd, "Failure Mode")
    _relationship(client, sd, a, b, kind="categorises")
    rel = next(i for g in _search(client, "categor")["groups"] for i in g["items"] if i["type"] == "sd_relationship")
    assert rel["name"] == "Categorises" and rel["detail"] == "Asset Type → Failure Mode" and rel["focus_id"] == a
    session_id = _new_session(client, "Switch review")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO discovery_source_file (source_file_id, session_id, original_filename, file_type, file_size_bytes,"
            " storage_ref, uploaded_by, uploaded_at, created_at, updated_at)"
            " VALUES ('sf_t', %s, 'GIS_transformers.xlsx', 'xlsx', 1, 'x', 'user', NOW(), NOW(), NOW())",
            (session_id,),
        )
    table = next(i for g in _search(client, "transformers")["groups"] for i in g["items"] if i["type"] == "source_table")
    assert table["session_id"] == session_id and table["file_id"] == "sf_t" and table["parent"] == "Switch review"
    # A column opens on the Profile step, which selects by discovery_column id.
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO discovery_column (discovery_column_id, session_id, source_file_id, source_label, internal_name,"
            " inferred_datatype, ordinal, created_at) VALUES ('dc_kva', %s, 'sf_t', 'Rated kVA', 'rated_kva', 'Integer', 1, NOW())",
            (session_id,),
        )
    column = next(i for g in _search(client, "rated kva")["groups"] for i in g["items"] if i["type"] == "source_column")
    assert (column["focus_id"], column["file_id"], column["session_id"]) == ("dc_kva", "sf_t", session_id)
