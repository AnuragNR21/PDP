"""
Getting rules in and out of the library, and choosing their code families.

The point of these tests is the promise the import makes: a file never
overwrites the library. It is reconciled against it — matched by identity
first, then by code, then by name — and a matched rule keeps its internal id
*and* its code whatever the file says, because results cite codes and a
reissued code would re-label old evidence.
"""
import csv
import io

from fastapi.testclient import TestClient


def _rule(client: TestClient, name: str, **extra) -> dict:
    payload = {
        "name": name,
        "description": "",
        "category": "Data quality",
        "definition_kind": "builtin",
        "check_type": "mandatory",
        "parameters": {},
        "severity": "medium",
        "status": "draft",
        "dimension": "completeness",
        "data_type": "any",
    }
    payload.update(extra)
    created = client.post("/api/rules", json=payload)
    assert created.status_code == 201, created.text
    return created.json()


def _export(client: TestClient, **params) -> list[dict]:
    response = client.get("/api/rules/export", params=params)
    assert response.status_code == 200, response.text
    assert "text/csv" in response.headers["content-type"]
    return list(csv.DictReader(io.StringIO(response.text)))


def _csv(rows: list[dict], columns: list[str]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()


def _validate(client: TestClient, csv_text: str) -> dict:
    response = client.post("/api/rules/imports/validate", json={"csv": csv_text})
    assert response.status_code == 200, response.text
    return response.json()


def _commit(client: TestClient, plan: dict, rows: list[int] | None = None) -> dict:
    response = client.post(
        "/api/rules/imports/commit",
        json={
            "stage_id": plan["stage_id"],
            "selected_row_numbers": plan["selected_row_numbers"] if rows is None else rows,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


# ── export ───────────────────────────────────────────────────────────────────

def test_export_carries_the_internal_id_so_a_re_import_matches_on_identity(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    rows = _export(client)
    assert len(rows) == 1
    assert rows[0]["rule_definition_id"] == rule["rule_definition_id"]
    assert rows[0]["code"] == rule["code"]
    assert rows[0]["name"] == "Meter number present"


def test_export_round_trips_with_no_changes(client: TestClient) -> None:
    """The file the library produced, fed straight back, changes nothing."""
    _rule(client, "Meter number present", examples_pass=["A-1"], examples_fail=[""])
    _rule(client, "Voltage in range", check_type="range",
          parameters={"min": 0, "max": 500}, dimension="validity")

    exported = client.get("/api/rules/export")
    plan = _validate(client, exported.text)
    assert plan["summary"]["total"] == 2
    assert plan["summary"]["unchanged"] == 2, [r["changes"] for r in plan["rows"]]
    assert plan["summary"]["changed"] == 0
    assert plan["summary"]["new"] == 0
    assert plan["selected_row_numbers"] == []


def test_export_honours_the_status_filter(client: TestClient) -> None:
    _rule(client, "Draft rule", status="draft")
    _rule(client, "Active rule", status="active")
    assert [r["name"] for r in _export(client, status="active")] == ["Active rule"]


# ── the plan ─────────────────────────────────────────────────────────────────

def test_a_row_that_matches_nothing_is_planned_as_new(client: TestClient) -> None:
    plan = _validate(client, _csv(
        [{"name": "Transformer age recorded", "category": "Asset register", "check_type": "mandatory"}],
        ["name", "category", "check_type"],
    ))
    assert plan["summary"] == {"total": 1, "new": 1, "changed": 0, "unchanged": 0, "invalid": 0}
    assert plan["rows"][0]["match_on"] == ""
    # The row number is the line in the spreadsheet, header included.
    assert plan["rows"][0]["row_number"] == 2


def test_the_plan_writes_nothing_until_it_is_committed(client: TestClient) -> None:
    _validate(client, _csv([{"name": "Nothing yet"}], ["name"]))
    assert client.get("/api/rules").json()["total"] == 0


def test_matching_prefers_the_internal_id_over_the_code_and_the_name(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    other = _rule(client, "Voltage in range")

    # The id points at the first rule; the code and name point at the second.
    plan = _validate(client, _csv(
        [{
            "rule_definition_id": rule["rule_definition_id"],
            "code": other["code"],
            "name": other["name"],
            "severity": "high",
        }],
        ["rule_definition_id", "code", "name", "severity"],
    ))
    row = plan["rows"][0]
    assert row["match_on"] == "rule_definition_id"
    assert row["rule_definition_id"] == rule["rule_definition_id"]
    # And the code stays the one this rule was issued, not the one in the file.
    assert row["code"] == rule["code"]
    assert any("is kept" in note for note in row["notes"]), row["notes"]


def test_a_row_matches_on_code_when_the_name_was_changed(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    plan = _validate(client, _csv(
        [{"code": rule["code"], "name": "Meter number must be present"}],
        ["code", "name"],
    ))
    row = plan["rows"][0]
    assert row["match_on"] == "code"
    assert row["action"] == "changed"
    assert [c["field"] for c in row["changes"]] == ["name"]

    _commit(client, plan)
    after = client.get(f"/api/rules/{rule['rule_definition_id']}").json()
    assert after["name"] == "Meter number must be present"
    assert after["code"] == rule["code"]


def test_a_row_matches_on_name_when_there_is_no_id_or_code(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    plan = _validate(client, _csv(
        [{"name": "meter NUMBER present", "severity": "high"}], ["name", "severity"],
    ))
    row = plan["rows"][0]
    assert row["match_on"] == "name"
    assert row["rule_definition_id"] == rule["rule_definition_id"]
    # Matching ignores case; the file's spelling is still a change, and the
    # plan says so rather than quietly applying or quietly dropping it.
    changes = {c["field"]: (c["from"], c["to"]) for c in row["changes"]}
    assert changes["severity"] == ("medium", "high")
    assert changes["name"] == ("Meter number present", "meter NUMBER present")


def test_the_plan_names_every_field_it_would_change(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    plan = _validate(client, _csv(
        [{
            "rule_definition_id": rule["rule_definition_id"],
            "name": "Meter number present",
            "severity": "high",
            "status": "active",
            "description": "Every meter carries a number.",
        }],
        ["rule_definition_id", "name", "severity", "status", "description"],
    ))
    changes = {c["field"]: (c["from"], c["to"]) for c in plan["rows"][0]["changes"]}
    assert changes["severity"] == ("medium", "high")
    assert changes["status"] == ("draft", "active")
    assert changes["description"] == ("", "Every meter carries a number.")


def test_a_column_the_file_leaves_out_is_left_alone(client: TestClient) -> None:
    """A two-column file changes two columns, not everything else to blank."""
    rule = _rule(client, "Meter number present", description="Kept", owner="Ops")
    plan = _validate(client, _csv(
        [{"code": rule["code"], "severity": "high"}], ["code", "severity"],
    ))
    assert [c["field"] for c in plan["rows"][0]["changes"]] == ["severity"]
    _commit(client, plan)
    after = client.get(f"/api/rules/{rule['rule_definition_id']}").json()
    assert after["description"] == "Kept"
    assert after["owner"] == "Ops"


def test_two_rows_claiming_the_same_rule_are_refused(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    plan = _validate(client, _csv(
        [
            {"code": rule["code"], "severity": "high"},
            {"code": rule["code"], "severity": "low"},
        ],
        ["code", "severity"],
    ))
    assert plan["rows"][0]["action"] == "changed"
    assert plan["rows"][1]["action"] == "invalid"
    assert "Row 2" in plan["rows"][1]["errors"][0]


def test_an_unreadable_row_is_marked_invalid_and_the_rest_still_planned(client: TestClient) -> None:
    plan = _validate(client, _csv(
        [
            {"name": "Good rule", "check_type": "mandatory", "dimension": "completeness"},
            {"name": "Bad dimension", "check_type": "mandatory", "dimension": "wishful"},
            {"name": "Bad check", "check_type": "telepathy", "dimension": "validity"},
        ],
        ["name", "check_type", "dimension"],
    ))
    assert plan["summary"]["new"] == 1
    assert plan["summary"]["invalid"] == 2
    assert "wishful" in plan["rows"][1]["errors"][0]
    assert "telepathy" in plan["rows"][2]["errors"][0]


def test_a_file_with_no_identifier_column_at_all_is_refused(client: TestClient) -> None:
    """A row has to be able to say which rule it is about."""
    response = client.post(
        "/api/rules/imports/validate", json={"csv": "severity,status\nhigh,active\n"}
    )
    assert response.status_code == 400
    assert "rule_definition_id" in response.json()["detail"]


def test_a_file_keyed_on_code_alone_is_accepted(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    plan = _validate(client, f"code,severity\n{rule['code']},high\n")
    assert plan["rows"][0]["action"] == "changed"
    assert plan["rows"][0]["match_on"] == "code"


def test_a_column_nobody_recognises_is_reported_rather_than_silently_dropped(client: TestClient) -> None:
    plan = _validate(client, _csv(
        [{"name": "Something", "check_type": "mandatory", "my_own_column": "x"}],
        ["name", "check_type", "my_own_column"],
    ))
    assert plan["unknown_columns"] == ["my_own_column"]
    assert plan["rows"][0]["action"] == "new"


# ── the commit ───────────────────────────────────────────────────────────────

def test_commit_applies_only_the_rows_that_were_ticked(client: TestClient) -> None:
    plan = _validate(client, _csv(
        [
            {"name": "First", "check_type": "mandatory"},
            {"name": "Second", "check_type": "mandatory"},
        ],
        ["name", "check_type"],
    ))
    report = _commit(client, plan, rows=[2])
    assert (report["created"], report["updated"], report["skipped"]) == (1, 0, 1)
    assert [r["name"] for r in client.get("/api/rules").json()["items"]] == ["First"]


def test_a_changed_rule_keeps_its_id_and_code_and_gains_a_version(client: TestClient) -> None:
    rule = _rule(client, "Meter number present")
    assert rule["version"] == 1

    plan = _validate(client, _csv(
        [{"rule_definition_id": rule["rule_definition_id"], "name": "Meter number present",
          "severity": "high"}],
        ["rule_definition_id", "name", "severity"],
    ))
    _commit(client, plan)

    after = client.get(f"/api/rules/{rule['rule_definition_id']}").json()
    assert after["rule_definition_id"] == rule["rule_definition_id"]
    assert after["code"] == rule["code"]
    assert after["severity"] == "high"
    assert after["version"] == 2

    # The version that was in force before the import is still readable, which
    # is what makes a past run's evidence resolve.
    was = client.get(f"/api/rules/{rule['rule_definition_id']}/versions/1").json()
    assert was["severity"] == "medium"


def test_a_new_rule_keeps_the_code_in_the_file_when_it_is_free(client: TestClient) -> None:
    plan = _validate(client, _csv(
        [{"code": "ACME-0042", "name": "House rule", "check_type": "mandatory"}],
        ["code", "name", "check_type"],
    ))
    _commit(client, plan)
    created = client.get("/api/rules").json()["items"][0]
    assert created["code"] == "ACME-0042"


def test_a_new_rule_is_given_a_free_code_when_the_file_reuses_one(client: TestClient) -> None:
    existing = _rule(client, "Meter number present")
    plan = _validate(client, _csv(
        [{"code": existing["code"], "name": "A different rule", "check_type": "mandatory"}],
        ["code", "name", "check_type"],
    ))
    row = plan["rows"][0]
    # It matched the existing rule on code, so this is a change, not a new rule.
    assert row["action"] == "changed"

    # With no code at all it is new, and gets its own.
    plan = _validate(client, _csv(
        [{"name": "A different rule", "check_type": "mandatory"}], ["name", "check_type"],
    ))
    _commit(client, plan)
    codes = {r["code"] for r in client.get("/api/rules").json()["items"]}
    assert len(codes) == 2


def test_committing_the_same_review_twice_is_refused(client: TestClient) -> None:
    plan = _validate(client, _csv([{"name": "Once", "check_type": "mandatory"}], ["name", "check_type"]))
    _commit(client, plan)
    again = client.post(
        "/api/rules/imports/commit",
        json={"stage_id": plan["stage_id"], "selected_row_numbers": [2]},
    )
    assert again.status_code == 400
    assert "expired" in again.json()["detail"]
    assert client.get("/api/rules").json()["total"] == 1


# ── code families ────────────────────────────────────────────────────────────

def test_a_category_falls_back_to_a_prefix_derived_from_its_name(client: TestClient) -> None:
    _rule(client, "Transformer age", category="Asset register")
    listed = client.get("/api/rules/code-prefixes").json()
    by_category = {item["category"]: item for item in listed["items"]}
    assert by_category["Asset register"]["prefix"] == "AR"
    assert by_category["Asset register"]["source"] == "default"
    assert by_category["Asset register"]["issued"] == 1


def test_a_team_can_choose_its_own_prefix_and_new_rules_use_it(client: TestClient) -> None:
    first = _rule(client, "Transformer age", category="Asset register")
    assert first["code"].startswith("AR-")

    set_it = client.put("/api/rules/code-prefixes/Asset register", json={"prefix": "asset"})
    assert set_it.status_code == 200, set_it.text
    by_category = {item["category"]: item for item in set_it.json()["items"]}
    assert by_category["Asset register"]["prefix"] == "ASSET"
    assert by_category["Asset register"]["source"] == "configured"

    second = _rule(client, "Transformer rating", category="Asset register")
    assert second["code"] == "ASSET-0001"

    # The rule issued before the change keeps the code it was issued. Results
    # cite it, so rewriting it would re-label evidence.
    assert client.get(f"/api/rules/{first['rule_definition_id']}").json()["code"] == first["code"]


def test_clearing_a_prefix_goes_back_to_the_derived_one(client: TestClient) -> None:
    _rule(client, "Transformer age", category="Asset register")
    client.put("/api/rules/code-prefixes/Asset register", json={"prefix": "ASSET"})
    cleared = client.delete("/api/rules/code-prefixes/Asset register")
    assert cleared.status_code == 200
    by_category = {item["category"]: item for item in cleared.json()["items"]}
    assert by_category["Asset register"]["prefix"] == "AR"
    assert by_category["Asset register"]["source"] == "default"


def test_a_prefix_has_to_be_something_a_code_reader_can_rely_on(client: TestClient) -> None:
    _rule(client, "Transformer age", category="Asset register")
    for bad in ("", "1AB", "A B", "AS-SET", "TOOLONGPREFIX"):
        refused = client.put("/api/rules/code-prefixes/Asset register", json={"prefix": bad})
        assert refused.status_code == 400, f"{bad!r} was accepted"


def test_two_categories_sharing_a_family_are_told_so(client: TestClient) -> None:
    _rule(client, "One", category="Asset register")
    _rule(client, "Two", category="Access rights")
    listed = client.get("/api/rules/code-prefixes").json()
    by_category = {item["category"]: item for item in listed["items"]}
    assert by_category["Asset register"]["prefix"] == "AR"
    assert by_category["Access rights"]["prefix"] == "AR"
    assert by_category["Asset register"]["shared_with"] == ["Access rights"]


def test_code_prefixes_is_not_read_as_a_rule_id(client: TestClient) -> None:
    """The route order matters: `/code-prefixes` sits above `/{rule_id}`."""
    assert client.get("/api/rules/code-prefixes").status_code == 200
    assert client.get("/api/rules/export").status_code == 200
