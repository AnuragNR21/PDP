"""
The Discovery Workspace, end to end: import, profile, map, check.

Each stage is covered where it has actually broken before — files that
vanished from later steps, a preview that waited on a full-table scan, a rule
counted twice because it was attached to two tables, a check that read the
wrong table because another worker moved the session's active one.

These run against a real Postgres through the same app the browser talks to.
Nothing here mocks a repository: the questions being asked are about SQL and
about state shared between requests, and a mock cannot answer either.
"""
import io
import time
import uuid

import pytest
from fastapi.testclient import TestClient

API = "/api/discover"
#: Long enough for a slow machine, short enough that a hang is a failure.
WAIT_SECONDS = 180


# ── helpers ─────────────────────────────────────────────────────────────────

def _uid(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:8]


def _new_session(client: TestClient, name: str = "Test session") -> str:
    created = client.post("/api/discover/sessions", json={"name": name, "source_name": ""})
    assert created.status_code == 201, created.text
    return created.json()["session"]["session_id"]


def _upload(client: TestClient, session_id: str, filename: str, raw: bytes):
    return client.post(
        f"{API}/sessions/{session_id}/files/upload",
        params={"filename": filename},
        content=raw,
    )


def _import_now(client: TestClient, session_id: str) -> dict:
    """Start the import and wait for the workers, the way the screen does."""
    client.post(f"{API}/sessions/{session_id}/import/run")
    deadline = time.time() + WAIT_SECONDS
    state = client.get(f"{API}/sessions/{session_id}/import/progress").json()
    while state["is_working"] and time.time() < deadline:
        time.sleep(0.2)
        state = client.get(f"{API}/sessions/{session_id}/import/progress").json()
    assert not state["is_working"], "the import never settled"
    return state


def _wait_for_checks(client: TestClient, session_id: str) -> dict:
    deadline = time.time() + WAIT_SECONDS
    state = client.get(f"{API}/sessions/{session_id}/quality/progress").json()
    while state["is_working"] and time.time() < deadline:
        time.sleep(0.2)
        state = client.get(f"{API}/sessions/{session_id}/quality/progress").json()
    assert not state["is_working"], "the quality run never settled"
    return state


def _workbook(sheets: dict[str, list[list[str]]]) -> bytes:
    openpyxl = pytest.importorskip("openpyxl", reason="Excel fixtures need openpyxl")
    book = openpyxl.Workbook()
    book.remove(book.active)
    for name, rows in sheets.items():
        sheet = book.create_sheet(name)
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def _map_first_column_of_each_table(client: TestClient, session_id: str, files: list[dict]):
    """
    Map one column of each table to a model field.

    Written through the database rather than the API because the mapping
    endpoints belong to another feature's tests; what this file is about is
    what the checks do once a mapping exists.
    """
    from shared.db import get_connection
    from app.dependencies import get_database_url

    db_url = get_database_url()
    model_id, type_id = _uid("m_"), _uid("t_")
    with get_connection(db_url) as conn:
        conn.execute(
            "INSERT INTO hierarchy_model (model_id, name, purpose, owning_domain, status,"
            " created_at, updated_at) VALUES (%s,%s,'t','t','active',NOW(),NOW())",
            (model_id, "Model " + model_id),
        )
        conn.execute(
            "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description,"
            " status, created_at, updated_at) VALUES (%s,%s,'T','','active',NOW(),NOW())",
            (type_id, model_id),
        )
        for entry in files:
            node_id = _uid("n_")
            conn.execute(
                "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id,"
                " node_type_id, name, status, created_at, updated_at)"
                " VALUES (%s,%s,%s,%s,'active',NOW(),NOW())",
                (node_id, model_id, type_id, "Target " + node_id),
            )
            column = conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s"
                " ORDER BY ordinal LIMIT 1",
                (entry["source_file_id"],),
            ).fetchone()
            assert column is not None, f"{entry['original_filename']} was never profiled"
            conn.execute(
                "INSERT INTO column_mapping (mapping_id, session_id, source_file_id, column_id,"
                " target_node_id, mapping_state, confidence, rationale, created_at, updated_at)"
                " VALUES (%s,%s,%s,%s,%s,'confirmed',1,'test',NOW(),NOW())",
                (_uid("map_"), session_id, entry["source_file_id"], column["column_id"], node_id),
            )


SWITCHES = b"Asset ID,Fuse Rating,Environment\nSW-1,63,outdoor\nSW-1,100,indoor\n,200,both\nSW-4,,outdoor\n"


# ── uploading ───────────────────────────────────────────────────────────────

def test_upload_records_the_file_and_leaves_the_reading_to_a_worker(client: TestClient):
    session_id = _new_session(client)
    uploaded = _upload(client, session_id, "switches.csv", SWITCHES)

    assert uploaded.status_code == 201, uploaded.text
    # Upload used to parse the file inside the request, which meant waiting.
    assert "job" in uploaded.json()
    progress = client.get(f"{API}/sessions/{session_id}/import/progress").json()
    assert progress["tables_created"] == 0
    assert [job["filename"] for job in progress["jobs"]] == ["switches.csv"]


def test_an_empty_file_is_refused_before_a_job_is_written(client: TestClient):
    session_id = _new_session(client)
    assert _upload(client, session_id, "nothing.csv", b"").status_code == 422
    assert client.get(f"{API}/sessions/{session_id}/import/progress").json()["jobs"] == []


def test_several_files_are_imported_together_and_all_survive(client: TestClient):
    session_id = _new_session(client)
    for index in range(4):
        _upload(client, session_id, f"table_{index}.csv", SWITCHES)

    state = _import_now(client, session_id)
    assert state["succeeded"] == 4, state

    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    # Uploading several files and finding only the last one downstream is the
    # bug this guards: every one of them must be a table of the session.
    assert sorted(f["original_filename"] for f in files) == [
        f"table_{i}.csv" for i in range(4)
    ]


def test_a_workbook_becomes_one_table_per_sheet(client: TestClient):
    session_id = _new_session(client)
    book = _workbook({
        "Switches": [["Asset ID", "Rating"], ["SW-1", "63"]],
        "Poles": [["Pole ID", "Material"], ["P-1", "Wood"]],
        "Read me": [["Exported by the asset team"]],
    })
    _upload(client, session_id, "network.xlsx", book)
    _import_now(client, session_id)

    names = sorted(
        f["original_filename"]
        for f in client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    )
    assert names == ["network.xlsx — Poles", "network.xlsx — Switches"]
    # A sheet with no table is not a table, and not an error either.


def test_a_file_with_no_table_fails_with_a_reason_and_does_not_stop_the_others(
    client: TestClient,
):
    session_id = _new_session(client)
    _upload(client, session_id, "good.csv", SWITCHES)
    _upload(client, session_id, "notes.csv", b"just a line of prose")

    state = _import_now(client, session_id)
    assert (state["succeeded"], state["failed"]) == (1, 1), state
    broken = next(j for j in state["jobs"] if j["filename"] == "notes.csv")
    assert "table" in broken["message"].lower()


def test_removing_a_file_takes_its_tables_and_its_status_row_with_it(client: TestClient):
    session_id = _new_session(client)
    _upload(client, session_id, "keep.csv", SWITCHES)
    _upload(client, session_id, "drop.csv", SWITCHES)
    _import_now(client, session_id)

    removed = client.delete(f"{API}/sessions/{session_id}/uploads", params={"filename": "drop.csv"})
    assert removed.status_code == 200, removed.text

    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    assert [f["original_filename"] for f in files] == ["keep.csv"]
    # A removed file leaving its status row behind put a file on the Import
    # step that the session no longer had.
    jobs = client.get(f"{API}/sessions/{session_id}/import/progress").json()["jobs"]
    assert [j["filename"] for j in jobs] == ["keep.csv"]


def test_a_file_that_could_not_be_read_can_still_be_removed(client: TestClient):
    session_id = _new_session(client)
    _upload(client, session_id, "notes.csv", b"just a line of prose")
    _import_now(client, session_id)
    # It produced no table, so there was nothing for the old delete to find.
    assert client.delete(
        f"{API}/sessions/{session_id}/uploads", params={"filename": "notes.csv"}
    ).status_code == 200
    assert client.get(f"{API}/sessions/{session_id}/import/progress").json()["jobs"] == []


# ── the preview ─────────────────────────────────────────────────────────────

def test_the_preview_returns_the_rows_asked_for_and_nothing_heavier(client: TestClient):
    session_id = _new_session(client)
    rows = b"Asset ID,Rating\n" + b"".join(
        f"SW-{n},{n}\n".encode() for n in range(40)
    )
    _upload(client, session_id, "many.csv", rows)
    _import_now(client, session_id)

    preview = client.get(f"{API}/sessions/{session_id}/dataset", params={"limit": 10}).json()
    assert preview["row_count"] == 40
    assert [r["row_number"] for r in preview["rows"]] == list(range(1, 11))
    # The duplicate scan reads every row. Bundling it here made a ten-row
    # preview wait on a full-table scan, so it has a call of its own.
    assert "duplicate_row_count" not in preview


def test_duplicate_rows_are_counted_on_their_own_call(client: TestClient):
    session_id = _new_session(client)
    _upload(
        client, session_id, "dupes.csv",
        b"Asset ID,Rating\nSW-1,63\nSW-1,63\nSW-1,63\nSW-2,100\nSW-2,100\nSW-3,7\n",
    )
    _import_now(client, session_id)

    duplicates = client.get(f"{API}/sessions/{session_id}/dataset/duplicates").json()
    # Three of one and two of another: five rows across two groups.
    assert duplicates == {"duplicate_row_count": 5, "duplicate_groups": 2}


def test_a_session_with_nothing_imported_still_answers(client: TestClient):
    session_id = _new_session(client)
    dataset = client.get(f"{API}/sessions/{session_id}/dataset").json()
    assert dataset["rows"] == [] and dataset["row_count"] == 0
    assert client.get(f"{API}/sessions/{session_id}/dataset/duplicates").json() == {
        "duplicate_row_count": 0,
        "duplicate_groups": 0,
    }


# ── profiling ───────────────────────────────────────────────────────────────

def test_profiling_covers_every_table_not_only_the_one_on_screen(client: TestClient):
    session_id = _new_session(client)
    book = _workbook({
        "Switches": [["Asset ID", "Rating"], ["SW-1", "63"], ["SW-2", "100"]],
        "Poles": [["Pole ID", "Material"], ["P-1", "Wood"]],
        "Spans": [["Span ID", "Length"], ["SP-1", "42"]],
    })
    _upload(client, session_id, "network.xlsx", book)
    _import_now(client, session_id)

    report = client.post(f"{API}/sessions/{session_id}/profile-all")
    assert report.status_code == 200, report.text
    assert report.json()["profiled"] == 3
    # Six unvisited tables reporting nothing reads exactly like nothing wrong.
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    assert all(f["column_count"] for f in files), [f["column_count"] for f in files]


# ── the checks ──────────────────────────────────────────────────────────────

def test_the_checks_run_as_a_background_job_per_table(client: TestClient):
    session_id = _new_session(client)
    book = _workbook({
        "Alpha": [["Asset ID", "Note"], ["A-1", "x"], ["", "y"], ["A-1", "z"]],
        "Beta": [["Pole ID", "Note"], ["P-1", "x"], ["", "y"]],
        "Unmapped": [["Span ID", "Note"], ["S-1", "x"]],
    })
    _upload(client, session_id, "three.xlsx", book)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")

    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    mapped = [f for f in files if not f["original_filename"].endswith("Unmapped")]
    _map_first_column_of_each_table(client, session_id, mapped)

    started = client.post(f"{API}/sessions/{session_id}/quality/start")
    assert started.status_code == 200, started.text
    # Pressing Run queues the tables and comes straight back; the work is the
    # server's from here, which is what lets the page be closed and reopened.
    assert started.json()["tables_total"] == 3

    state = _wait_for_checks(client, session_id)
    assert state["percent"] == 100
    assert (state["succeeded"], state["skipped"], state["failed"]) == (2, 1, 0), state
    skipped = next(j for j in state["jobs"] if j["status"] == "skipped")
    # Not mapped is a step not taken, not a fault in the data.
    assert "mapped" in skipped["message"]


def test_a_job_the_pool_is_running_is_never_treated_as_abandoned(client: TestClient):
    """
    A long quiet step is not a dead worker.

    Heartbeats are written when a job reports progress, and one step —
    storing a 60 MB file, scanning 140,000 rows — can outlast the stale
    window with nothing wrong. Reclaiming it there ran the same work twice
    and reset its progress, which is what made the screen flicker between
    "running" and "queued again".
    """
    from shared.db import get_connection
    from app.dependencies import get_database_url
    from features.discover.repo.discover_quality_job_repository import (
        DiscoverQualityJobRepository, STALE_AFTER_SECONDS,
    )

    session_id = _new_session(client, "Held job")
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)

    client.post(f"{API}/sessions/{session_id}/quality/start")
    _wait_for_checks(client, session_id)

    jobs = DiscoverQualityJobRepository(get_database_url())
    job_id = jobs.list_for_session(session_id)[0]["job_id"]

    def make_it_look_dead():
        with get_connection(get_database_url()) as conn:
            conn.execute(
                "UPDATE discovery_quality_job SET status = 'running', progress = 60,"
                f" heartbeat_at = (NOW() - INTERVAL '{STALE_AFTER_SECONDS * 3} seconds')::text"
                " WHERE job_id = %s",
                (job_id,),
            )

    # Nobody is holding it: it is genuinely lost, and goes back in the queue.
    make_it_look_dead()
    assert jobs.reclaim_lost(session_id) == [job_id]

    # Someone is holding it: it stays running, however quiet it has been.
    make_it_look_dead()
    assert jobs.reclaim_lost(session_id, skip_ids={job_id}) == []
    still = next(j for j in jobs.list_for_session(session_id) if j["job_id"] == job_id)
    assert still["status"] == "running"
    assert still["progress"] == 60, "a held job's progress was reset"


def test_a_job_never_reports_less_progress_than_it_already_has(client: TestClient):
    """A bar that goes backwards says the work was undone."""
    from app.dependencies import get_database_url
    from features.discover.repo.discover_quality_job_repository import (
        DiscoverQualityJobRepository,
    )

    session_id = _new_session(client, "Monotonic")
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)
    client.post(f"{API}/sessions/{session_id}/quality/start")
    _wait_for_checks(client, session_id)

    from shared.db import get_connection

    jobs = DiscoverQualityJobRepository(get_database_url())
    job_id = jobs.list_for_session(session_id)[0]["job_id"]

    def percent_of() -> int:
        return next(
            j for j in jobs.list_for_session(session_id) if j["job_id"] == job_id
        )["progress"]

    # The run finished at 100, which already refuses anything lower; wind it
    # back by hand so the climb itself is what is being tested.
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "UPDATE discovery_quality_job SET progress = 0 WHERE job_id = %s", (job_id,)
        )

    jobs.progress(job_id, "Checking", 70, done=7, total=10)
    assert percent_of() == 70
    # An out-of-order or retried update must not be able to lower it. This is
    # the 80 → 85 → 70 → 75 the person saw: three workers each reporting their
    # own share of one bar, and whichever wrote last won.
    jobs.progress(job_id, "Checking", 40, done=4, total=10)
    assert percent_of() == 70
    columns = next(
        j for j in jobs.list_for_session(session_id) if j["job_id"] == job_id
    )["columns_done"]
    assert columns == 7, "the column count went backwards with the bar"
    jobs.progress(job_id, "Checking", 85, done=9, total=10)
    assert percent_of() == 85


def test_the_import_bar_never_goes_backwards_either(client: TestClient):
    """The same guarantee on the other bar, which had the same fault."""
    from app.dependencies import get_database_url
    from features.discover.repo.discover_import_job_repository import (
        DiscoverImportJobRepository,
    )

    session_id = _new_session(client, "Import monotonic")
    _upload(client, session_id, "switches.csv", SWITCHES)

    jobs = DiscoverImportJobRepository(get_database_url())
    job_id = jobs.list_for_session(session_id)[0]["job_id"]
    jobs.mark_queued(session_id)
    jobs.claim(job_id)

    def row() -> dict:
        return next(
            j for j in jobs.list_for_session(session_id) if j["job_id"] == job_id
        )

    jobs.progress(job_id, "Reading rows", 60, rows_done=600, rows_total=1000)
    assert row()["progress"] == 60
    jobs.progress(job_id, "Reading rows", 20, rows_done=200, rows_total=1000)
    assert row()["progress"] == 60, "the import bar fell back"
    assert row()["rows_done"] == 600, "the row count fell back"


def test_a_first_run_reports_progress_before_it_has_any_findings(client: TestClient):
    """
    The two "has_run" flags disagree during a first run, on purpose.

    `/quality` answers about findings, and a first run has none until it
    finishes. `/quality/progress` answers about the run itself. The screen
    has to take the progress panel from the second — it used to sit inside a
    branch gated on the first, so the very first run showed no progress bar
    at all and the button appeared to do nothing until it was over.
    """
    session_id = _new_session(client, "First run")
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)

    # Nothing has ever been checked: both say so.
    assert client.get(f"{API}/sessions/{session_id}/quality").json()["has_run"] is False
    assert client.get(f"{API}/sessions/{session_id}/quality/progress").json()["has_run"] is False

    started = client.post(f"{API}/sessions/{session_id}/quality/start").json()
    # The moment the run is queued the progress endpoint has something to
    # show — and the findings endpoint still has nothing. This is the state
    # the screen was rendering as an empty invitation to press the button.
    assert started["has_run"] is True
    assert started["tables_total"] >= 1
    assert client.get(f"{API}/sessions/{session_id}/quality").json()["has_run"] is False

    state = _wait_for_checks(client, session_id)
    assert state["percent"] == 100
    # Only now do findings exist.
    assert client.get(f"{API}/sessions/{session_id}/quality").json()["has_run"] is True


def test_asking_for_progress_is_enough_to_finish_a_run_the_server_dropped(
    client: TestClient,
):
    from shared.db import get_connection
    from app.dependencies import get_database_url
    from features.discover.repo.discover_quality_job_repository import STALE_AFTER_SECONDS

    session_id = _new_session(client)
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)

    client.post(f"{API}/sessions/{session_id}/quality/start")
    _wait_for_checks(client, session_id)

    # A process that dies mid-run leaves a row saying "running" that nothing
    # is running.
    client.post(f"{API}/sessions/{session_id}/quality/start")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "UPDATE discovery_quality_job SET status = 'running', progress = 40,"
            " started_at = NOW()::text,"
            f" heartbeat_at = (NOW() - INTERVAL '{STALE_AFTER_SECONDS * 3} seconds')::text"
            " WHERE session_id = %s",
            (session_id,),
        )

    state = _wait_for_checks(client, session_id)
    assert state["succeeded"] == 1, state
    assert state["percent"] == 100


def test_a_check_reads_the_table_it_was_given_not_the_one_the_session_has_open(
    client: TestClient,
):
    """
    The property the parallel run rests on.

    Before, a run switched the session's active table and read through the
    `active_…` views. Two tables checked at once would each have been
    overwriting the other's idea of which table it was looking at.
    """
    from app.dependencies import get_database_url
    from features.discover.service.discover_dataset_service import DiscoverDatasetService

    session_id = _new_session(client)
    book = _workbook({
        # Two blanks in Alpha's first column, five in Beta's.
        "Alpha": [["Asset ID", "Note"]] + [["" if i < 2 else f"A-{i}", "x"] for i in range(20)],
        "Beta": [["Asset ID", "Note"]] + [["" if i < 5 else f"B-{i}", "y"] for i in range(20)],
    })
    _upload(client, session_id, "two.xlsx", book)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")

    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)
    by_sheet = {f["original_filename"].rsplit("— ", 1)[-1]: f for f in files}

    service = DiscoverDatasetService(get_database_url())

    def blanks(report: dict) -> int:
        """
        Blanks are a Profile observation now, not a Quality Check finding —
        but they are still produced by the run and still have to come from the
        table the run was pinned to, which is what this test is about.
        """
        observations = service.profile_observations(
            report["session_id"], source_file_id=report["source_file_id"]
        )["observations"]
        return next(
            o["observed_count"] for o in observations if o["check_type"] == "completeness"
        )

    service._imports.set_active_file(session_id, by_sheet["Beta"]["source_file_id"])
    pinned = service.run_quality_checks(
        session_id, source_file_id=by_sheet["Alpha"]["source_file_id"]
    )
    assert blanks(pinned) == 2, "a pinned run read the open table instead of its own"
    assert service._imports.get_active_file_id(session_id) == by_sheet["Beta"]["source_file_id"]

    # Unpinned still follows the open table, which is what every screen wants.
    assert blanks(service.run_quality_checks(session_id)) == 5


def test_a_table_id_that_is_not_one_is_refused_rather_than_used(client: TestClient):
    """The id is interpolated into a FROM clause, so its shape is the defence."""
    from app.dependencies import get_database_url
    from features.discover.repo.discover_dataset_repository import DiscoverDatasetRepository

    with pytest.raises(ValueError, match="Not a source file id"):
        DiscoverDatasetRepository(
            get_database_url(), "sf_x'; DROP TABLE discovery_source_row; --"
        )


def test_the_checks_are_refused_once_and_clearly_when_nothing_is_mapped(
    client: TestClient,
):
    session_id = _new_session(client)
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)

    refused = client.post(f"{API}/sessions/{session_id}/quality/start")
    assert refused.status_code == 422
    assert "Map at least one column" in refused.json()["detail"]


# ── the results, read by rule ───────────────────────────────────────────────

def _define_library_rule(name: str, check_type: str, severity: str) -> str:
    """A rule as the Rule Workspace writes one, so Discover can attach it."""
    from shared.db import get_connection
    from app.dependencies import get_database_url

    rule_id = _uid("rd_")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO rule_definition (rule_definition_id, name, description, category,"
            " scope, definition_kind, check_type, parameters_json, severity, status, code,"
            " dimension, data_type, rationale, created_at, updated_at)"
            " VALUES (%s,%s,'','Common','field','builtin',%s,'{}',%s,'active',%s,"
            " 'validity','any','',NOW(),NOW())",
            (rule_id, name, check_type, severity, _uid("C-")),
        )
    return rule_id


def test_results_read_by_rule_name_the_table_and_field_each_one_broke_in(
    client: TestClient,
):
    session_id = _new_session(client)
    book = _workbook({
        "Alpha": [["Asset ID", "Note"], ["A-1", "x"], ["A-1", "y"], ["", "z"]],
        "Beta": [["Pole ID", "Note"], ["P-1", "x"], ["P-1", "y"], ["P-3", "z"]],
    })
    _upload(client, session_id, "two.xlsx", book)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")

    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)

    from shared.db import get_connection
    from app.dependencies import get_database_url

    must_have = _define_library_rule(_uid("Must be filled in "), "mandatory", "high")
    must_be_unique = _define_library_rule(_uid("Must not repeat "), "unique", "low")

    # Attach both rules to the mapped field of each table, as the Rules step does.
    for entry in files:
        client.post(f"{API}/sessions/{session_id}/source-files/{entry['source_file_id']}/activate")
        with get_connection(get_database_url()) as conn:
            column = conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s"
                " ORDER BY ordinal LIMIT 1",
                (entry["source_file_id"],),
            ).fetchone()
        client.put(
            f"{API}/sessions/{session_id}/rule-library/fields/{column['column_id']}",
            json={"rule_definition_ids": [must_have, must_be_unique]},
        )

    client.post(f"{API}/sessions/{session_id}/quality/start")
    _wait_for_checks(client, session_id)

    report = client.get(f"{API}/sessions/{session_id}/quality/by-rule").json()
    assert report["has_run"] is True
    assert report["tables_checked"] == 2

    # One library rule attached to two tables makes two governed rules with
    # two codes, because a code is unique session-wide. It is still one rule.
    assert report["governed_rules"] == 2, [r["name"] for r in report["rules"]]

    governed = {r["check_type"]: r for r in report["rules"] if r["kind"] == "governed"}
    assert governed["mandatory"]["severity"] == "high"
    assert governed["unique"]["severity"] == "low"
    assert governed["unique"]["tables_failing_count"] == 2

    # Every target names where it broke, so a finding can be gone and fixed.
    for rule in report["rules"]:
        assert all(t["table_name"] and t["column_name"] for t in rule["targets"])

    # Failing first: the reason someone opens this screen is what is wrong.
    order = [r["status"] for r in report["rules"]]
    assert order == sorted(order, key={"failed": 0, "warning": 1, "passed": 2}.get)

    # Usability is a roll-up of the other checks; counting it as a rule would
    # count every row it read twice.
    assert all(r["check_type"] != "usability" for r in report["rules"])


def test_severity_shown_against_a_rule_is_the_one_set_in_the_rule_workspace(
    client: TestClient,
):
    """Discover never invents a level, and an automatic check is given none."""
    session_id = _new_session(client)
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)

    from shared.db import get_connection
    from app.dependencies import get_database_url

    rule_id = _define_library_rule(_uid("Must be filled in "), "mandatory", "medium")
    with get_connection(get_database_url()) as conn:
        column = conn.execute(
            "SELECT column_id FROM source_column WHERE source_file_id = %s ORDER BY ordinal"
            " LIMIT 1",
            (files[0]["source_file_id"],),
        ).fetchone()
    client.put(
        f"{API}/sessions/{session_id}/rule-library/fields/{column['column_id']}",
        json={"rule_definition_ids": [rule_id]},
    )

    client.post(f"{API}/sessions/{session_id}/quality/start")
    _wait_for_checks(client, session_id)
    report = client.get(f"{API}/sessions/{session_id}/quality/by-rule").json()

    governed = [r for r in report["rules"] if r["kind"] == "governed"]
    assert [r["severity"] for r in governed] == ["medium"]
    assert all(r["severity"] == "" for r in report["rules"] if r["kind"] == "automatic")
    # The roll-up only covers rules that carry a level.
    assert sum(level["rules"] for level in report["by_severity"]) == len(governed)


# ── choosing the model the session is read against ──────────────────────────

def _model(client: TestClient, name: str, fields: int = 2) -> str:
    """
    A Structure application Discover can be pointed at.

    Its *fields* are the descendants of the application node, and a model
    with none of them is refused — so the root gets children.
    """
    from shared.db import get_connection
    from app.dependencies import get_database_url

    model_id, type_id, root_id = _uid("m_"), _uid("t_"), _uid("n_")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO hierarchy_model (model_id, name, purpose, owning_domain, status,"
            " created_at, updated_at) VALUES (%s,%s,'t','t','active',NOW(),NOW())",
            (model_id, name),
        )
        conn.execute(
            "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description,"
            " status, created_at, updated_at) VALUES (%s,%s,'T','','active',NOW(),NOW())",
            (type_id, model_id),
        )
        conn.execute(
            "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id, node_type_id,"
            " name, status, sort_order, created_at, updated_at)"
            " VALUES (%s,%s,%s,%s,'active',0,NOW(),NOW())",
            (root_id, model_id, type_id, name),
        )
        for index in range(fields):
            conn.execute(
                "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id,"
                " node_type_id, parent_node_id, name, status, sort_order, created_at, updated_at)"
                " VALUES (%s,%s,%s,%s,%s,'active',%s,NOW(),NOW())",
                (_uid("n_"), model_id, type_id, root_id, f"{name} field {index}", index),
            )
    return root_id


def test_a_table_may_change_model_without_disturbing_the_others(client: TestClient):
    """
    A model belongs to the table, not the session.

    One upload can hold five files from five source systems. Mapping four of
    them and then choosing a model for the fifth must leave the four alone —
    the guard used to count every mapping in the session, so the four blocked
    a switch that had nothing to do with them.
    """
    session_id = _new_session(client, "Model per table")
    book = _workbook({
        "Alpha": [["Asset ID", "Note"], ["A-1", "x"]],
        "Beta": [["Pole ID", "Note"], ["P-1", "y"]],
    })
    _upload(client, session_id, "two.xlsx", book)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")

    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    by_sheet = {f["original_filename"].rsplit("— ", 1)[-1]: f for f in files}
    _map_first_column_of_each_table(client, session_id, files)

    first_ref = _model(client, _uid("First model "))
    second_ref = _model(client, _uid("Second model "))

    def activate(sheet: str):
        client.post(
            f"{API}/sessions/{session_id}/source-files/{by_sheet[sheet]['source_file_id']}/activate"
        )

    def set_model(name_ref: str, label: str):
        return client.post(
            f"{API}/sessions/{session_id}/context",
            json={"source_application": label, "application_ref_id": name_ref},
        )

    def columns_of(sheet: str) -> set[str]:
        """A mapping names a column, not a table, so the table is its columns."""
        from shared.db import get_connection
        from app.dependencies import get_database_url

        with get_connection(get_database_url()) as conn:
            rows = conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s",
                (by_sheet[sheet]["source_file_id"],),
            ).fetchall()
        return {dict(r)["column_id"] for r in rows}

    def mappings_of(sheet: str) -> int:
        owned = columns_of(sheet)
        return sum(
            1
            for m in client.get(f"{API}/sessions/{session_id}/mappings").json()["items"]
            if m["target_node_id"] and m["column_id"] in owned
        )

    # Alpha is settled on the first model, with its column paired.
    activate("Alpha")
    assert set_model(first_ref, "First model").status_code in (200, 201)
    assert mappings_of("Alpha") == 1

    # Beta now wants a different model. Alpha's pairing must not stand in the
    # way, and Beta's own must — it is Beta's that would be left pointing at
    # fields of a model Beta no longer uses.
    activate("Beta")
    assert set_model(first_ref, "First model").status_code in (200, 201)
    refused = set_model(second_ref, "Second model")
    assert refused.status_code == 409, refused.text
    assert "Remove those pairings" in refused.json()["detail"]

    beta_columns = columns_of("Beta")
    beta_column = next(
        m["column_id"]
        for m in client.get(f"{API}/sessions/{session_id}/mappings").json()["items"]
        if m["target_node_id"] and m["column_id"] in beta_columns
    )
    client.delete(f"{API}/sessions/{session_id}/mappings/{beta_column}")

    switched = set_model(second_ref, "Second model")
    assert switched.status_code in (200, 201), switched.text

    # Beta moved; Alpha kept both its model and its work.
    assert (
        client.get(f"{API}/sessions/{session_id}/context").json()["context"][
            "application_ref_id"
        ]
        == second_ref
    )
    assert mappings_of("Alpha") == 1, "another table's pairings were destroyed"
    activate("Alpha")
    assert (
        client.get(f"{API}/sessions/{session_id}/context").json()["context"][
            "application_ref_id"
        ]
        == first_ref
    ), "another table's model was changed"


def test_the_model_can_always_be_set_when_nothing_is_paired(client: TestClient):
    session_id = _new_session(client, "Fresh model")
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)

    ref = _model(client, _uid("Only model "))
    chosen = client.post(
        f"{API}/sessions/{session_id}/context",
        json={"source_application": "Only model", "application_ref_id": ref},
    )
    assert chosen.status_code in (200, 201), chosen.text
    assert (
        client.get(f"{API}/sessions/{session_id}/context").json()["context"][
            "application_ref_id"
        ]
        == ref
    )


# ── removing a session ──────────────────────────────────────────────────────

def test_deleting_a_session_takes_everything_that_hangs_off_it(client: TestClient):
    from shared.db import get_connection
    from app.dependencies import get_database_url

    session_id = _new_session(client, "To be removed")
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")

    def rows_in(table: str) -> int:
        with get_connection(get_database_url()) as conn:
            return dict(
                conn.execute(
                    f"SELECT COUNT(*) AS n FROM {table} WHERE session_id = %s", (session_id,)
                ).fetchone()
            )["n"]

    assert rows_in("discovery_source_file") > 0
    assert rows_in("discovery_source_row") > 0

    removed = client.delete(f"{API}/sessions/{session_id}")
    assert removed.status_code == 200, removed.text

    assert client.get(f"{API}/sessions/{session_id}").status_code == 404
    # Everything derived from a session goes with it, or the database keeps
    # rows nothing can reach.
    for table in (
        "discovery_source_file",
        "discovery_source_row",
        "discovery_parsed_file",
        "discovery_import_job",
        "discovery_quality_job",
    ):
        assert rows_in(table) == 0, f"{table} kept rows after the session was deleted"


def test_deleting_a_session_that_is_not_there_says_so(client: TestClient):
    assert client.delete(f"{API}/sessions/sess_nothing").status_code == 404


def test_a_session_that_never_ran_says_so_rather_than_erroring(client: TestClient):
    session_id = _new_session(client)
    report = client.get(f"{API}/sessions/{session_id}/quality/by-rule").json()
    assert report["has_run"] is False
    assert report["rules"] == []
    assert report["worst_rule"] is None


# ── how many rows, and how many cells ───────────────────────────────────────
#
# A finding counts offending values in ONE field. Adding those up across a
# rule's fields counts a row once per bad field, and the screen reported
# 8,650,973 "rows flagged" for files holding about 419,000 rows. The two
# quantities are now counted separately and shown under their own names.

#: Four fields. The first five rows keep their id and are blank in the other
#: three, so completeness flags 5 ROWS and 15 CELLS. A row blank in every
#: column is dropped at parse time, which is why the id is always filled.
_BLANK_ROWS, _BLANK_FIELDS, _TOTAL_ROWS = 5, 3, 20
GAPPY = (
    b"Asset ID,Feeder,Material,Voltage\n"
    + b"".join(
        (f"A-{n}," + ",".join(
            "" if n < _BLANK_ROWS else f"v{n}-{i}" for i in range(_BLANK_FIELDS)
        ) + "\n").encode()
        for n in range(_TOTAL_ROWS)
    )
)


def _map_every_column(client: TestClient, session_id: str, files: list[dict]) -> None:
    """Map every column of every table — the case the row counts are about."""
    from shared.db import get_connection
    from app.dependencies import get_database_url

    model_id, type_id = _uid("m_"), _uid("t_")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO hierarchy_model (model_id, name, purpose, owning_domain, status,"
            " created_at, updated_at) VALUES (%s,%s,'t','t','active',NOW(),NOW())",
            (model_id, "Model " + model_id),
        )
        conn.execute(
            "INSERT INTO hierarchy_model_node_type (node_type_id, model_id, name, description,"
            " status, created_at, updated_at) VALUES (%s,%s,'T','','active',NOW(),NOW())",
            (type_id, model_id),
        )
        for entry in files:
            columns = conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s ORDER BY ordinal",
                (entry["source_file_id"],),
            ).fetchall()
            for column in columns:
                node_id = _uid("n_")
                conn.execute(
                    "INSERT INTO hierarchy_model_node_instance (node_instance_id, model_id,"
                    " node_type_id, name, status, created_at, updated_at)"
                    " VALUES (%s,%s,%s,%s,'active',NOW(),NOW())",
                    (node_id, model_id, type_id, "Target " + node_id),
                )
                conn.execute(
                    "INSERT INTO column_mapping (mapping_id, session_id, source_file_id,"
                    " column_id, target_node_id, mapping_state, confidence, rationale,"
                    " created_at, updated_at)"
                    " VALUES (%s,%s,%s,%s,%s,'confirmed',1,'test',NOW(),NOW())",
                    (_uid("map_"), session_id, entry["source_file_id"],
                     column["column_id"], node_id),
                )


def _attach_library_rule(client: TestClient, session_id: str, file_id: str, rule_id: str) -> None:
    """Put one library rule on every column of a table."""
    from shared.db import get_connection
    from app.dependencies import get_database_url

    with get_connection(get_database_url()) as conn:
        columns = [
            row["column_id"]
            for row in conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s ORDER BY ordinal",
                (file_id,),
            ).fetchall()
        ]
    for column_id in columns:
        existing = client.get(
            f"{API}/sessions/{session_id}/rule-library/fields/{column_id}"
        )
        current = (
            [r["rule_definition_id"] for r in existing.json().get("selected", [])]
            if existing.status_code == 200 else []
        )
        client.put(
            f"{API}/sessions/{session_id}/rule-library/fields/{column_id}",
            json={"rule_definition_ids": sorted({*current, rule_id})},
        )


def _run_and_read_by_rule(client: TestClient, session_id: str) -> dict:
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_every_column(client, session_id, files)
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    response = client.get(f"{API}/sessions/{session_id}/quality/by-rule")
    assert response.status_code == 200, response.text[:300]
    return response.json()


def test_a_row_broken_in_three_fields_is_one_row_and_three_cells(client: TestClient):
    """
    The distinction the whole fix rests on.

    Measured on a governed rule, because the Quality Check stage reports
    governed rules and nothing else now: the automatic checks it used to be
    measured on belong to the Profile stage.
    """
    session_id = _new_session(client, "Rows and cells")
    _upload(client, session_id, "gappy.csv", GAPPY)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_every_column(client, session_id, files)
    _attach_library_rule(
        client, session_id, files[0]["source_file_id"],
        _define_library_rule("Must be filled in", "mandatory", "high"),
    )
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    report = client.get(f"{API}/sessions/{session_id}/quality/by-rule").json()

    assert report["rows_total"] == _TOTAL_ROWS, report["rows_total"]

    mandatory = next(r for r in report["rules"] if r["check_type"] == "mandatory")
    assert mandatory["rows_flagged"] == _BLANK_ROWS
    assert mandatory["values_flagged"] == _BLANK_ROWS * _BLANK_FIELDS
    assert mandatory["values_flagged"] > mandatory["rows_flagged"], (
        "rows and cells came out equal — something is counting cells as rows"
    )


def test_no_count_of_rows_can_exceed_the_rows_there_are(client: TestClient):
    """The property that would have caught 8.6 million rows in a 419,000-row file."""
    session_id = _new_session(client, "Within the files")
    _upload(client, session_id, "gappy.csv", GAPPY)
    report = _run_and_read_by_rule(client, session_id)

    assert report["rows_flagged"] <= report["rows_total"], report
    for rule in report["rules"]:
        if not rule["counts_rows"]:
            continue
        assert rule["rows_flagged"] <= rule["rows_total"], rule["name"]
        # A cell count below its row count is impossible: every flagged row
        # holds at least one flagged cell.
        assert rule["values_flagged"] >= rule["rows_flagged"], rule["name"]


def test_the_session_total_counts_a_row_once_however_many_rules_hit_it(client: TestClient):
    """
    Adding the rules' row counts together would count a row once per rule.

    Every blank cell here is caught by two library rules, so the rules' own
    counts add up to more than the rows that exist. The session figure has to
    be the distinct rows. (It used to lean on the automatic completeness check
    for the second rule; that check is a Profile observation now.)
    """
    session_id = _new_session(client, "Counted once")
    _upload(client, session_id, "gappy.csv", GAPPY)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_every_column(client, session_id, files)

    from shared.db import get_connection
    from app.dependencies import get_database_url

    first = _define_library_rule("Must be filled in", "mandatory", "high")
    second = _define_library_rule("Required for handover", "mandatory", "medium")
    with get_connection(get_database_url()) as conn:
        columns = [
            row["column_id"]
            for row in conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s ORDER BY ordinal",
                (files[0]["source_file_id"],),
            ).fetchall()
        ]
    for column_id in columns:
        client.put(
            f"{API}/sessions/{session_id}/rule-library/fields/{column_id}",
            json={"rule_definition_ids": [first, second]},
        )
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    report = client.get(f"{API}/sessions/{session_id}/quality/by-rule").json()

    per_rule_total = sum(r["rows_flagged"] for r in report["rules"])
    assert report["rows_flagged"] == _BLANK_ROWS, report["rows_flagged"]
    assert per_rule_total > report["rows_flagged"], (
        "two rules flagged the same rows and the total did not notice"
    )
    assert report["rows_flagged"] <= report["rows_total"]


def test_a_rule_that_measures_a_share_reports_no_row_count(client: TestClient):
    """
    Not every rule has rows to point at.

    A share, a ratio or a readiness decision is a judgement about a whole
    column or a whole run. Its observed_count is a count of groups or of
    matching values, and adding that into a row total is how a business
    decision came to contribute "3 rows". Such a rule says it counts no rows
    and the screen shows a dash rather than a zero, which would read as clean.
    """
    session_id = _new_session(client, "No rows to point at")
    _upload(client, session_id, "gappy.csv", GAPPY)
    report = _run_and_read_by_rule(client, session_id)

    for rule in report["rules"]:
        assert isinstance(rule["counts_rows"], bool), rule["name"]
        if rule["counts_rows"]:
            assert rule["rows_total"] > 0 or rule["rows_flagged"] == 0, rule["name"]

    # `overlap` compares pairs of fields, so its observed_count is a number of
    # pairs and it must not be feeding the row or the cell total.
    overlap = next((r for r in report["rules"] if r["check_type"] == "overlap"), None)
    if overlap is not None:
        assert overlap["counts_rows"] is False
        assert overlap["values_flagged"] == 0

# ── archiving a finished session, and deleting it later ─────────────────────
#
# Archive is not delete. It retires a session that has been checked, keeps
# everything it holds, and starts a countdown the retention job measures. The
# countdown is computed from the policy on every read, so shortening the
# policy moves every session already waiting — not only the ones archived
# afterwards.


def _checked_session(client: TestClient, name: str) -> str:
    """A session that has been imported, mapped and checked — ready to archive."""
    session_id = _new_session(client, name)
    _upload(client, session_id, "switches.csv", SWITCHES)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_first_column_of_each_table(client, session_id, files)
    return session_id


def test_a_session_cannot_be_archived_before_it_has_been_checked(client: TestClient):
    """
    Archiving retires finished work, and an unchecked session is not finished.

    The rule is enforced at the endpoint, not only hidden in the button: a
    screen can be stale, and this is the step before a permanent deletion.
    """
    session_id = _checked_session(client, "Not yet checked")

    gate = client.get(f"{API}/sessions/{session_id}/archive-eligibility").json()
    assert gate["can_archive"] is False
    assert "quality checks" in gate["reason"]

    refused = client.post(f"{API}/sessions/{session_id}/archive")
    assert refused.status_code == 422, refused.text[:200]

    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    allowed = client.get(f"{API}/sessions/{session_id}/archive-eligibility").json()
    assert allowed["can_archive"] is True, allowed
    assert client.post(f"{API}/sessions/{session_id}/archive").status_code == 200


def test_archiving_keeps_everything_and_only_starts_a_clock(client: TestClient):
    session_id = _checked_session(client, "Archive keeps")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    body = client.post(f"{API}/sessions/{session_id}/archive").json()

    assert body["session"]["status"] == "archived"
    assert body["session"]["purge_due_at"], "no deletion date was given"
    # The findings are still readable — archiving deletes nothing today.
    assert client.get(f"{API}/sessions/{session_id}/quality/by-rule").json()["has_run"] is True


def test_archiving_twice_does_not_buy_another_week(client: TestClient):
    """A second click must not restart the countdown."""
    session_id = _checked_session(client, "Archive twice")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    first = client.post(f"{API}/sessions/{session_id}/archive").json()["session"]["purge_due_at"]

    again = client.post(f"{API}/sessions/{session_id}/archive")
    assert again.status_code == 422
    after = client.get(f"{API}/sessions/{session_id}").json()["session"]["purge_due_at"]
    assert after == first


def test_the_two_lists_are_separate_and_together_are_everything(client: TestClient):
    session_id = _checked_session(client, "Two lists")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    client.post(f"{API}/sessions/{session_id}/archive")

    live = client.get(f"{API}/sessions", params={"archived": "false"}).json()["items"]
    filed = client.get(f"{API}/sessions", params={"archived": "true"}).json()["items"]
    everything = client.get(f"{API}/sessions").json()["items"]

    assert session_id not in [s["session_id"] for s in live]
    assert session_id in [s["session_id"] for s in filed]
    assert len(everything) == len(live) + len(filed)


def test_restoring_stops_the_countdown(client: TestClient):
    session_id = _checked_session(client, "Restore me")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    client.post(f"{API}/sessions/{session_id}/archive")

    back = client.post(f"{API}/sessions/{session_id}/restore")
    assert back.status_code == 200, back.text[:200]
    assert back.json()["session"]["purge_due_at"] == ""
    assert back.json()["session"]["status"] == "completed"
    assert session_id in [
        s["session_id"]
        for s in client.get(f"{API}/sessions", params={"archived": "false"}).json()["items"]
    ]
    # Nothing to restore twice.
    assert client.post(f"{API}/sessions/{session_id}/restore").status_code == 422


def test_the_policy_is_clamped_rather_than_refused(client: TestClient):
    """
    A stored value can never put the job outside its own policy.

    Clamping rather than rejecting matters because these values are also read
    on a path nobody is watching — the sweep itself — where a validation error
    would mean the job silently stops running.
    """
    assert client.put(f"{API}/retention", json={"retention_days": 900}).json()["retention_days"] == 31
    assert client.put(f"{API}/retention", json={"retention_days": 0}).json()["retention_days"] == 1
    assert client.put(f"{API}/retention", json={"purge_hour_utc": 99}).json()["purge_hour_utc"] == 23
    assert client.put(f"{API}/retention", json={"purge_hour_utc": -4}).json()["purge_hour_utc"] == 0

    both = client.put(f"{API}/retention", json={"retention_days": 5, "purge_hour_utc": 3}).json()
    assert (both["retention_days"], both["purge_hour_utc"]) == (5, 3)
    # One at a time leaves the other alone.
    only_hour = client.put(f"{API}/retention", json={"purge_hour_utc": 9}).json()
    assert (only_hour["retention_days"], only_hour["purge_hour_utc"]) == (5, 9)


def test_shortening_the_policy_moves_a_countdown_already_running(client: TestClient):
    """The due date is computed on read for exactly this reason."""
    session_id = _checked_session(client, "Countdown moves")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    client.put(f"{API}/retention", json={"retention_days": 30})
    client.post(f"{API}/sessions/{session_id}/archive")
    far = client.get(f"{API}/sessions/{session_id}").json()["session"]["purge_due_at"]

    client.put(f"{API}/retention", json={"retention_days": 1})
    near = client.get(f"{API}/sessions/{session_id}").json()["session"]["purge_due_at"]
    assert near < far, (far, near)


def test_the_sweep_deletes_only_what_has_run_out(client: TestClient):
    from datetime import datetime, timedelta, timezone

    from app.dependencies import get_database_url
    from features.discover.service.retention_sweeper import RetentionSweeper
    from shared.db import get_connection

    client.put(f"{API}/retention", json={"retention_days": 7})

    recent = _checked_session(client, "Archived today")
    client.post(f"{API}/sessions/{recent}/quality/run-all")
    client.post(f"{API}/sessions/{recent}/archive")

    stale = _checked_session(client, "Archived long ago")
    client.post(f"{API}/sessions/{stale}/quality/run-all")
    client.post(f"{API}/sessions/{stale}/archive")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "UPDATE discovery_session SET archived_at = %s WHERE session_id = %s",
            ((datetime.now(timezone.utc) - timedelta(days=10)).isoformat(), stale),
        )

    never = _checked_session(client, "Never archived")

    outcome = RetentionSweeper(get_database_url()).sweep_now()
    assert outcome["deleted"] == 1, outcome
    assert outcome["failed"] == 0, outcome

    remaining = [s["session_id"] for s in client.get(f"{API}/sessions").json()["items"]]
    assert stale not in remaining
    assert recent in remaining, "a session still inside its retention was deleted"
    assert never in remaining, "a session nobody archived was deleted"


def test_the_deletion_leaves_a_record_that_outlives_the_session(client: TestClient):
    """
    `discover_audit_event.session_id` is ON DELETE SET NULL.

    So a record written before the delete loses the very id that makes it
    worth keeping, and one written after with the id set cannot be written at
    all — the id has to travel in the detail.
    """
    from datetime import datetime, timedelta, timezone
    import json

    from app.dependencies import get_database_url
    from features.discover.service.retention_sweeper import RetentionSweeper
    from shared.db import get_connection

    client.put(f"{API}/retention", json={"retention_days": 1})
    session_id = _checked_session(client, "Leaves a trail")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    client.post(f"{API}/sessions/{session_id}/archive")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "UPDATE discovery_session SET archived_at = %s WHERE session_id = %s",
            ((datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), session_id),
        )

    RetentionSweeper(get_database_url()).sweep_now()

    with get_connection(get_database_url()) as conn:
        rows = conn.execute(
            "SELECT detail_json FROM discover_audit_event WHERE action = 'session.purged'"
        ).fetchall()
    named = [json.loads(row["detail_json"]).get("session_id") for row in rows]
    assert session_id in named, "the deletion left no record of what was deleted"


def test_the_sweep_runs_once_a_day_and_catches_up_a_missed_one(client: TestClient):
    """
    The hour is a window, not an instant.

    Asking "has a run happened since the hour last passed" rather than "is it
    that hour now" is what lets a sweep missed at 02:00 — the process asleep,
    the container CPU-throttled — still happen when somebody next opens the
    page. The claim is an UPDATE, so several callers at once still run it once.
    """
    from datetime import datetime, timedelta, timezone

    from app.dependencies import get_database_url
    from features.discover.repo.discover_retention_repository import (
        next_run_after, window_opened_at,
    )
    from features.discover.service.retention_sweeper import RetentionSweeper
    from shared.db import get_connection

    sweeper = RetentionSweeper(get_database_url())
    assert sweeper.sweep_if_due() is not None, "the very first sweep is owed"
    assert sweeper.sweep_if_due() is None, "it ran twice in one day"

    with get_connection(get_database_url()) as conn:
        conn.execute(
            "UPDATE retention_sweep_run SET last_run_at = %s",
            ((datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),),
        )
    assert sweeper.sweep_if_due() is not None, "a missed window was never caught up"
    assert sweeper.sweep_if_due() is None, "two callers both ran the same sweep"

    now = datetime.now(timezone.utc).isoformat()
    assert window_opened_at(2) < now
    assert next_run_after(2) > now


# ── how much of this data can you use ───────────────────────────────────────
#
# The card answering that question used to read `row_usability`, which knows
# only the model's own structure: required, unique, datatype, duplicate rows.
# It had never seen a governed rule. A table where all 18 rows broke two
# approved-values rules reported "100% can be used, 0% needs fixing" directly
# beside those two failures — and those are the rules the person wrote.

#: Two fields, always filled, all distinct, plain text. Nothing the model's own
#: structure can object to; only a governed rule can fault this data.
STRUCTURALLY_CLEAN = (
    b"Asset ID,Load Breaking\n"
    + b"".join(f"A-{i},EM {101 + i}\n".encode() for i in range(18))
)


def _governed_allowed_values(client: TestClient, session_id: str, column_id: str) -> str:
    """Attach a rule saying this field must come from a list it is not in."""
    import json as _json

    from app.dependencies import get_database_url
    from shared.db import get_connection

    rule_id = _uid("rd_")
    tag = _uid("")[:5].upper()
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO rule_definition (rule_definition_id, name, description, category,"
            " scope, definition_kind, check_type, parameters_json, severity, status, code,"
            " dimension, data_type, rationale, created_at, updated_at)"
            " VALUES (%s,%s,'','Common','field','builtin','allowed_values',%s,'high','active',"
            " %s,'validity','any','',NOW(),NOW())",
            (
                rule_id,
                f"Load Breaking is an approved value {tag}",
                _json.dumps({"allowed_values": ["YES", "NO"]}),
                f"CF-{tag}",
            ),
        )
    client.put(
        f"{API}/sessions/{session_id}/rule-library/fields/{column_id}",
        json={"rule_definition_ids": [rule_id]},
    )
    return rule_id


def _usability_of(client: TestClient, session_id: str) -> dict:
    report = client.get(f"{API}/sessions/{session_id}/quality").json()
    return next(f for f in report["findings"] if f["check_type"] == "usability")["detail"]


def test_the_quality_step_reports_governed_rules_and_the_profile_keeps_the_rest(
    client: TestClient,
):
    """
    Two stages, agreed with the client: automatic risk observations at Profile,
    governed DQ and BQ rules at Quality Check. They are never added together,
    which is how "4 rules run / 0 failing" came to sit under "1 check failed".
    """
    session_id = _new_session(client, "Two stages")
    _upload(client, session_id, "gappy.csv", GAPPY)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_every_column(client, session_id, files)
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    report = client.get(f"{API}/sessions/{session_id}/quality").json()
    # The run happened, and says so, even though no rule was governed.
    assert report["has_run"] is True
    assert all(f["check_type"] != "completeness" for f in report["findings"])
    # total_checks counts checks that were MADE. The verdict they add up to,
    # the missing/unknown facts about mapped fields, and the rules that could
    # not run are each reported on their own and none of them is a check.
    not_checks = [
        f for f in report["findings"]
        if f["check_type"] in ("usability", "mapped_field_issue", "configuration_error")
    ]
    assert report["total_checks"] == len(report["findings"]) - len(not_checks)

    # Agreed with the client: the run reports missing and unknown values for
    # the fields somebody mapped, and says nothing about the fields they did
    # not. GAPPY blanks its first five rows in three of four columns, and only
    # the mapped ones may be spoken about here.
    mapped_names = {f["column_name"] for f in report["findings"] if f["column_name"]}
    for issue in report["field_issues"]:
        assert issue["column_name"] in mapped_names
        assert issue["issue"] in ("missing", "unknown")

    observations = client.get(
        f"{API}/sessions/{session_id}/profile-observations"
    ).json()
    assert observations["has_run"] is True
    kinds = {o["check_type"] for o in observations["observations"]}
    assert "completeness" in kinds and "duplicate_records" in kinds

    # GAPPY keeps its id column filled and blanks the other three, so the
    # worst completeness observation is the one to check.
    blanks = max(
        o["observed_count"]
        for o in observations["observations"]
        if o["check_type"] == "completeness"
    )
    assert blanks == _BLANK_ROWS


def test_a_governed_rule_every_row_breaks_makes_none_of_it_usable(client: TestClient):
    """The bug, stated as a test: structurally spotless, and unusable."""
    from app.dependencies import get_database_url
    from shared.db import get_connection

    session_id = _new_session(client, "Usable rows")
    _upload(client, session_id, "assets.csv", STRUCTURALLY_CLEAN)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_every_column(client, session_id, files)

    with get_connection(get_database_url()) as conn:
        columns = [
            row["column_id"]
            for row in conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s ORDER BY ordinal",
                (files[0]["source_file_id"],),
            ).fetchall()
        ]
    _governed_allowed_values(client, session_id, columns[1])
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    usability = _usability_of(client, session_id)
    assert usability["structure_only_unusable_rows"] == 0, (
        "the fixture is wrong — the model's own structure should find nothing"
    )
    assert usability["unusable_rows"] == 18, usability
    assert usability["usable_percent"] == 0.0, usability
    assert usability["usable_rows"] == 0, usability


def test_the_usable_figure_says_what_is_breaking(client: TestClient):
    """
    A percentage on its own cannot be acted on.

    The reasons name the rule as the person wrote it, not the internal check
    type, and a row breaking several rules appears under each — so they do not
    sum to the unusable total, and are not presented as if they did.
    """
    from app.dependencies import get_database_url
    from shared.db import get_connection

    session_id = _new_session(client, "Why unusable")
    _upload(client, session_id, "assets.csv", STRUCTURALLY_CLEAN)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_every_column(client, session_id, files)
    with get_connection(get_database_url()) as conn:
        columns = [
            row["column_id"]
            for row in conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s ORDER BY ordinal",
                (files[0]["source_file_id"],),
            ).fetchall()
        ]
    _governed_allowed_values(client, session_id, columns[1])
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    reasons = _usability_of(client, session_id)["reasons"]
    assert reasons, "no reason was given for rows that cannot be used"
    assert any("approved value" in reason["label"] for reason in reasons), reasons
    # Worst first, and each one bounded by the rows that exist.
    assert reasons == sorted(reasons, key=lambda r: -r["rows"])
    assert all(0 < reason["rows"] <= 18 for reason in reasons), reasons
    assert all(0 < reason["percent"] <= 100 for reason in reasons), reasons


def test_data_that_breaks_nothing_is_still_all_usable(client: TestClient):
    """The fix must not turn a clean table into a false alarm."""
    from app.dependencies import get_database_url
    from shared.db import get_connection

    clean = b"Asset ID,Load Breaking\n" + b"".join(
        f"B-{i},YES\n".encode() for i in range(12)
    )
    session_id = _new_session(client, "All usable")
    _upload(client, session_id, "clean.csv", clean)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    _map_every_column(client, session_id, files)
    with get_connection(get_database_url()) as conn:
        columns = [
            row["column_id"]
            for row in conn.execute(
                "SELECT column_id FROM source_column WHERE source_file_id = %s ORDER BY ordinal",
                (files[0]["source_file_id"],),
            ).fetchall()
        ]
    _governed_allowed_values(client, session_id, columns[1])
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    usability = _usability_of(client, session_id)
    assert usability["usable_percent"] == 100.0, usability
    assert usability["unusable_rows"] == 0, usability
    assert not usability["reasons"], usability["reasons"]


def test_rows_that_cannot_be_used_never_exceed_the_rows_there_are(client: TestClient):
    """Same guarantee as the rows-vs-cells work, on the other counter."""
    session_id = _new_session(client, "Bounded")
    _upload(client, session_id, "gappy.csv", GAPPY)
    _run_and_read_by_rule(client, session_id)

    usability = _usability_of(client, session_id)
    assert usability["unusable_rows"] <= usability["total_rows"], usability
    assert usability["usable_rows"] + usability["unusable_rows"] == usability["total_rows"]
    assert 0 <= usability["usable_percent"] <= 100


def test_the_sweeper_thread_can_be_kept_out_of_a_test_run(monkeypatch):
    """
    A thread deleting rows on its own schedule, during assertions about which
    rows exist, is how a suite goes intermittently red for no reason anybody
    can reproduce. Turning it off must not turn the sweep off — the
    catch-up-on-request path is the one that works on a throttled host anyway.
    """
    from app.dependencies import get_database_url
    from features.discover.service.retention_sweeper import RetentionSweeper

    monkeypatch.setenv("PDP_RETENTION_SWEEPER", "off")
    sweeper = RetentionSweeper(get_database_url())
    sweeper.start()
    assert sweeper._thread is None, "the background thread started anyway"
    # Still sweeps when asked, which is what the request path does.
    assert sweeper.sweep_now()["failed"] == 0

    monkeypatch.setenv("PDP_RETENTION_SWEEPER", "on")
    sweeper.start()
    assert sweeper._thread is not None and sweeper._thread.is_alive()
    sweeper.shutdown()


def test_a_sweep_recorded_just_after_the_hour_does_not_run_again(client: TestClient):
    """
    `last_run_at` and the window are ISO strings compared as text in SQL.

    That works only because both carry the same `+00:00` offset and because
    `+` sorts before `.`, so `02:00:00+00:00` is correctly older than
    `02:00:00.000123+00:00`. It is the kind of thing that silently inverts if
    someone switches one side to a `Z` suffix or a naive timestamp.
    """
    from app.dependencies import get_database_url
    from features.discover.repo.discover_retention_repository import window_opened_at
    from features.discover.service.retention_sweeper import RetentionSweeper
    from shared.db import get_connection

    client.put(f"{API}/retention", json={"purge_hour_utc": 2})
    sweeper = RetentionSweeper(get_database_url())
    sweeper.sweep_if_due()

    opened = window_opened_at(2)
    just_after = opened.replace("+00:00", ".000123+00:00")
    with get_connection(get_database_url()) as conn:
        conn.execute("UPDATE retention_sweep_run SET last_run_at = %s", (just_after,))

    assert sweeper.sweep_if_due() is None, (
        "a sweep recorded microseconds after the window ran a second time"
    )

    # And a run from before the window is still owed.
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "UPDATE retention_sweep_run SET last_run_at = %s",
            (opened.replace("T02:", "T01:"),),
        )
    assert sweeper.sweep_if_due() is not None


def test_the_sweeper_thread_starts_when_the_application_boots(monkeypatch):
    """
    The thread has to exist on a server nobody has touched.

    It is created lazily by `get_retention_sweeper`, and only the Discover
    endpoints call that — so before this, a server that started and was then
    left alone had no thread at all, and the sweep only ever happened when
    somebody opened a page. The screen meanwhile said "runs once a day at
    06:00", which was true only of a server somebody was using.
    """
    from app.bootstrap import bootstrap_application
    from features.discover.service import retention_sweeper as module

    monkeypatch.setenv("PDP_RETENTION_SWEEPER", "on")
    previous = module._sweeper
    module._sweeper = None
    try:
        bootstrap_application()
        assert module._sweeper is not None, "booting the app created no sweeper"
        thread = module._sweeper._thread
        assert thread is not None and thread.is_alive(), (
            "the sweeper exists but its thread was never started"
        )
    finally:
        if module._sweeper is not None:
            module._sweeper.shutdown()
        module._sweeper = previous


def test_booting_still_works_when_the_sweeper_cannot_start(monkeypatch):
    """
    A sweep that cannot start must not stop the application from starting.

    The request path catches up an owed window anyway, so the worst case of
    swallowing this is a sweep that runs late — against an application that
    does not come up at all.
    """
    import app.bootstrap as bootstrap

    def explode(_db_url):
        raise RuntimeError("no database for you")

    monkeypatch.setattr(
        "features.discover.service.retention_sweeper.get_retention_sweeper", explode
    )
    bootstrap._start_retention_sweeper("postgresql://nowhere/nothing")


def test_the_screen_can_say_when_the_first_archived_session_falls_due(client: TestClient):
    """
    Nothing to delete is the normal answer most days, and on its own it looks
    exactly like a job that is not running: two sessions archived, none due,
    no way to tell which. `next_due_at` is what separates the two — it is the
    soonest any archived session can be deleted.
    """
    from datetime import datetime, timedelta, timezone

    from app.dependencies import get_database_url
    from features.discover.service.retention_sweeper import RetentionSweeper
    from shared.db import get_connection

    client.put(f"{API}/retention", json={"retention_days": 7})
    sweeper = RetentionSweeper(get_database_url())

    assert sweeper.status()["next_due_at"] == "", "nothing archived, yet something is due"

    def archive(name: str, days_ago: int) -> str:
        session_id = _checked_session(client, name)
        client.post(f"{API}/sessions/{session_id}/quality/run-all")
        client.post(f"{API}/sessions/{session_id}/archive")
        with get_connection(get_database_url()) as conn:
            conn.execute(
                "UPDATE discovery_session SET archived_at = %s WHERE session_id = %s",
                ((datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat(), session_id),
            )
        return session_id

    archive("Archived three days ago", 3)
    archive("Archived one day ago", 1)

    status = sweeper.status()
    assert status["archived_sessions"] == 2
    assert status["due_now"] == 0, "a session three days old is not past seven days"
    # Seven days after the *older* one, which is the first to fall out.
    assert status["next_due_at"][:10] == (
        datetime.now(timezone.utc) + timedelta(days=4)
    ).date().isoformat(), status["next_due_at"]


# ── a quality run is evidence, not a current-state report ───────────────────
#
# Findings used to be deleted and rewritten on every run, so the only question
# the database could answer was "what is true now". A result could never be
# explained once the mapping or a threshold had moved, because the thing it was
# measured against was gone.

def _library_rule_with_parameters(name: str, parameters: str) -> str:
    """A library rule carrying real parameters, so a snapshot has something to hold."""
    from shared.db import get_connection
    from app.dependencies import get_database_url

    rule_id = _uid("rd_")
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO rule_definition (rule_definition_id, name, description, category,"
            " scope, definition_kind, check_type, parameters_json, severity, status, code,"
            " dimension, data_type, rationale, created_at, updated_at)"
            " VALUES (%s,%s,'','Common','field','builtin','allowed_values',%s,'high','active',"
            " %s,'validity','any','',NOW(),NOW())",
            (rule_id, name, parameters, _uid("C-")),
        )
    return rule_id


def _first_column_id(source_file_id: str) -> str:
    from shared.db import get_connection
    from app.dependencies import get_database_url

    with get_connection(get_database_url()) as conn:
        row = conn.execute(
            "SELECT column_id FROM source_column WHERE source_file_id = %s "
            "ORDER BY ordinal LIMIT 1",
            (source_file_id,),
        ).fetchone()
    return row["column_id"]


def test_a_second_run_does_not_erase_the_first(client: TestClient):
    """
    Two runs, two evidence records, and both keep their findings.

    The Quality step still shows one set of results — the newest — so keeping
    history costs the screen nothing.
    """
    from app.dependencies import get_database_url
    from shared.db import get_connection

    session_id = _checked_session(client, _uid("Two runs "))
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    runs = client.get(f"{API}/sessions/{session_id}/quality/runs").json()
    assert runs["total"] >= 2, runs
    newest, oldest = runs["items"][0], runs["items"][-1]
    assert newest["quality_run_id"] != oldest["quality_run_id"]

    # The earlier run still holds exactly what it found.
    earlier = client.get(
        f"{API}/sessions/{session_id}/quality/runs/{oldest['quality_run_id']}"
    ).json()
    assert len(earlier["findings"]) == oldest["findings_total"] > 0

    # And nothing was deleted: the table holds more rows than one run's worth.
    with get_connection(get_database_url()) as conn:
        stored = conn.execute(
            "SELECT COUNT(*) AS n FROM discovery_quality_check WHERE session_id = %s",
            (session_id,),
        ).fetchone()["n"]
    assert stored > newest["findings_total"], "a run overwrote an earlier one"

    # The Quality step reads the newest run only — its governed half. The run
    # also stored the Profile observations, which that screen never counts.
    report = client.get(f"{API}/sessions/{session_id}/quality").json()
    # Everything the run stored = the checks it made + the verdict they add up
    # to + the Profile observations. Three groups, named apart on purpose.
    not_checks = sum(
        1 for f in report["findings"]
        if f["check_type"] in ("usability", "mapped_field_issue", "configuration_error")
    )
    assert (
        report["total_checks"] + not_checks + report["profile_observations"]
        == newest["findings_total"]
    ), report


def test_a_run_records_what_it_was_measured_against(client: TestClient):
    """
    The fingerprints say two runs agree; the snapshots say what they agreed on.

    Keeping only the fingerprints is what made an old result unexplainable.
    """
    session_id = _checked_session(client, _uid("Evidence "))
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    run = client.get(f"{API}/sessions/{session_id}/quality/runs").json()["items"][0]
    assert run["file_hash"], "the run does not say which bytes it read"
    assert run["mapping_version"].startswith("map:"), run["mapping_version"]
    assert run["rule_version"].startswith("rules:"), run["rule_version"]
    assert run["mapping_snapshot"], "the mapping was not snapshotted"
    assert all(
        entry["column_name"] and entry["target_node_id"]
        for entry in run["mapping_snapshot"]
    ), run["mapping_snapshot"]
    assert run["completed_at"] and run["checked_columns"] > 0


def test_the_rule_snapshot_does_not_move_when_the_library_rule_is_edited(
    client: TestClient,
):
    """
    The whole point of a snapshot: editing a rule tomorrow must not silently
    rewrite what yesterday's result was measured against.
    """
    from app.dependencies import get_database_url
    from shared.db import get_connection

    session_id = _checked_session(client, _uid("Frozen "))
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    column_id = _first_column_id(files[0]["source_file_id"])
    rule_id = _library_rule_with_parameters(
        _uid("Approved values "), '{"allowed_values": ["Wood", "Steel"]}'
    )
    client.put(
        f"{API}/sessions/{session_id}/rule-library/fields/{column_id}",
        json={"rule_definition_ids": [rule_id]},
    )
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    run = client.get(f"{API}/sessions/{session_id}/quality/runs").json()["items"][0]
    snapshot = [r for r in run["rule_snapshot"] if r["source_rule_definition_id"] == rule_id]
    assert snapshot, run["rule_snapshot"]
    assert snapshot[0]["parameters"] == {"allowed_values": ["Wood", "Steel"]}
    assert snapshot[0]["source_rule_version"] == "1", snapshot[0]

    # Somebody rewrites the rule in the Rule Workspace the next day.
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "UPDATE rule_definition SET parameters_json = %s, version = version + 1 "
            "WHERE rule_definition_id = %s",
            ('{"allowed_values": ["Concrete"]}', rule_id),
        )

    after = client.get(
        f"{API}/sessions/{session_id}/quality/runs/{run['quality_run_id']}"
    ).json()
    kept = [r for r in after["rule_snapshot"] if r["source_rule_definition_id"] == rule_id][0]
    assert kept["parameters"] == {"allowed_values": ["Wood", "Steel"]}, kept
    assert kept["source_rule_version"] == "1", "the snapshot followed the library"


def test_an_attached_rule_records_the_library_version_it_came_from(
    client: TestClient,
):
    """
    A result citing a rule id alone cites something that can change under it.
    The version is what makes the citation hold.
    """
    from app.dependencies import get_database_url
    from shared.db import get_connection

    session_id = _checked_session(client, _uid("Versioned "))
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    column_id = _first_column_id(files[0]["source_file_id"])
    rule_id = _define_library_rule(_uid("Must be filled "), "mandatory", "high")
    client.put(
        f"{API}/sessions/{session_id}/rule-library/fields/{column_id}",
        json={"rule_definition_ids": [rule_id]},
    )

    with get_connection(get_database_url()) as conn:
        row = conn.execute(
            "SELECT source_rule_version FROM governed_rule "
            "WHERE source_rule_definition_id = %s AND owner_session_id = %s",
            (rule_id, session_id),
        ).fetchone()
    assert row is not None, "the attached copy was not written"
    assert row["source_rule_version"] == "1", dict(row)


def test_findings_written_before_runs_existed_stay_visible(client: TestClient):
    """
    An older session has findings with no run behind them.

    The reader asks for "the newest run", and for those rows there is none —
    so the join has to keep them rather than blank the Quality step on every
    session that predates this table.
    """
    from app.dependencies import get_database_url
    from shared.db import get_connection
    from features.discover.repo.discover_dataset_repository import (
        DiscoverDatasetRepository,
    )

    session_id = _checked_session(client, _uid("Legacy "))
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    file_id = files[0]["source_file_id"]

    url = get_database_url()
    with get_connection(url) as conn:
        conn.execute(
            "UPDATE discovery_session SET active_source_file_id = %s WHERE session_id = %s",
            (file_id, session_id),
        )
        conn.execute(
            "INSERT INTO discovery_quality_check (quality_check_id, session_id,"
            " source_file_id, execution_id, scope, column_name, check_type, status,"
            " message, created_at, quality_run_id)"
            " VALUES (%s, %s, %s, 'exec_old', 'column', 'Legacy column', 'mandatory',"
            " 'failed', 'written before runs existed', NOW(), '')",
            (_uid("qc_"), session_id, file_id),
        )

    repo = DiscoverDatasetRepository(url)
    assert len(repo.list_quality_checks(session_id)) == 1, "a run-less finding vanished"

    # Once the file has a real run, the newest run is what the screen shows and
    # the older row drops out of view — without being deleted.
    repo.record_quality_run(
        session_id, file_id, "exec_new",
        [{"column_name": "New column", "check_type": "mandatory",
          "status": "passed", "message": "ok"}],
    )
    assert len(repo.list_quality_checks(session_id)) == 1
    assert repo.list_quality_checks(session_id)[0]["column_name"] == "New column"
    with get_connection(url) as conn:
        stored = conn.execute(
            "SELECT COUNT(*) AS n FROM discovery_quality_check WHERE session_id = %s",
            (session_id,),
        ).fetchone()["n"]
    assert stored == 2, "the older finding was deleted rather than superseded"


def test_the_table_list_counts_findings_that_predate_runs(client: TestClient):
    """
    The per-table counters ask for "the newest run", and a file that predates
    runs has none.

    The first version put the COALESCE inside the lateral, where it only fires
    if a row comes back — so a file with no run row compared against NULL and
    reported zero findings on a table that plainly had some.
    """
    from app.dependencies import get_database_url
    from shared.db import get_connection

    session_id = _checked_session(client, _uid("Old counts "))
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    file_id = files[0]["source_file_id"]
    with get_connection(get_database_url()) as conn:
        conn.execute(
            "INSERT INTO discovery_quality_check (quality_check_id, session_id,"
            " source_file_id, execution_id, scope, column_name, check_type, status,"
            " message, created_at, quality_run_id)"
            " VALUES (%s, %s, %s, 'exec_old', 'column', 'Legacy column', 'mandatory',"
            " 'failed', 'written before runs existed', NOW(), '')",
            (_uid("qc_"), session_id, file_id),
        )

    listed = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    table = next(f for f in listed if f["source_file_id"] == file_id)
    assert table["findings"] == 1, table
    assert table["failing_checks"] == 1, table


def test_removing_a_file_takes_its_runs_and_findings_with_it(client: TestClient):
    """
    Nothing holds a finding to its file by foreign key.

    Removal used to leave them, and the by-rule view reported them under
    "Unknown table". With runs kept as well they would also sit in the
    evidence trail describing a table the session no longer has.
    """
    from app.dependencies import get_database_url
    from shared.db import get_connection

    session_id = _checked_session(client, _uid("Removed "))
    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    file_id = files[0]["source_file_id"]
    assert client.get(f"{API}/sessions/{session_id}/quality/runs").json()["total"] >= 1

    removed = client.delete(f"{API}/sessions/{session_id}/source-files/{file_id}")
    assert removed.status_code in (200, 204), removed.text

    with get_connection(get_database_url()) as conn:
        left = conn.execute(
            "SELECT (SELECT COUNT(*) FROM discovery_quality_check WHERE source_file_id = %s)"
            " AS findings,"
            " (SELECT COUNT(*) FROM discovery_quality_run WHERE source_file_id = %s) AS runs",
            (file_id, file_id),
        ).fetchone()
    assert left["findings"] == 0, "findings outlived the file they describe"
    assert left["runs"] == 0, "a run outlived the table it ran on"


# ── reading back the rule a result was measured against ────────────────────

RULES_API = "/api/rules"


def test_editing_a_rule_keeps_the_version_it_replaced(client: TestClient):
    """
    `version` counted edits and kept none of them. A result citing v1 could
    never be shown v1.
    """
    created = client.post(RULES_API, json={
        "name": _uid("Versioned rule "), "category": "Common",
        "check_type": "allowed_values",
        "parameters": {"allowed_values": ["Wood", "Steel"]},
        "severity": "high", "status": "active",
    })
    assert created.status_code == 201, created.text
    rule = created.json()

    history = client.get(f"{RULES_API}/{rule['rule_definition_id']}/versions").json()
    assert history["current_version"] == 1
    assert [v["version"] for v in history["items"]] == [1]
    assert history["items"][0]["recorded"] is True

    client.put(f"{RULES_API}/{rule['rule_definition_id']}", json={
        "name": rule["name"], "category": "Common",
        "check_type": "allowed_values",
        "parameters": {"allowed_values": ["Concrete"]},
        "severity": "low", "status": "active",
    })

    history = client.get(f"{RULES_API}/{rule['rule_definition_id']}/versions").json()
    assert history["current_version"] == 2
    assert [v["version"] for v in history["items"]] == [2, 1]
    first = client.get(f"{RULES_API}/{rule['rule_definition_id']}/versions/1").json()
    assert first["parameters"] == {"allowed_values": ["Wood", "Steel"]}
    assert first["severity"] == "high"
    second = client.get(f"{RULES_API}/{rule['rule_definition_id']}/versions/2").json()
    assert second["parameters"] == {"allowed_values": ["Concrete"]}
    assert second["severity"] == "low"


def test_a_rule_written_before_the_log_keeps_its_last_version_on_first_edit(
    client: TestClient,
):
    """
    The 80 seeded rules have no recorded version. Their current state is
    offered as the head of the history, marked as not a recorded copy — and
    the first edit writes it properly rather than erasing it.
    """
    rule_id = _define_library_rule(_uid("Predates the log "), "mandatory", "medium")

    history = client.get(f"{RULES_API}/{rule_id}/versions").json()
    assert [v["version"] for v in history["items"]] == [1]
    assert history["items"][0]["recorded"] is False, history["items"][0]
    assert history["items"][0]["is_current"] is True

    name = history["items"][0]["name"]
    client.put(f"{RULES_API}/{rule_id}", json={
        "name": name, "category": "Common", "check_type": "unique",
        "severity": "high", "status": "active",
    })

    history = client.get(f"{RULES_API}/{rule_id}/versions").json()
    assert [v["version"] for v in history["items"]] == [2, 1]
    assert all(v["recorded"] for v in history["items"]), history["items"]
    kept = client.get(f"{RULES_API}/{rule_id}/versions/1").json()
    assert kept["check_type"] == "mandatory", "the replaced version was lost"


def test_a_run_says_which_rule_versions_it_executed(client: TestClient):
    """
    From a result to the rule that produced it, at the version that produced
    it — without trusting what the library says today.
    """
    session_id = _checked_session(client, _uid("Versions used "))
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    column_id = _first_column_id(files[0]["source_file_id"])
    rule_id = _define_library_rule(_uid("Cited rule "), "mandatory", "high")
    client.put(
        f"{API}/sessions/{session_id}/rule-library/fields/{column_id}",
        json={"rule_definition_ids": [rule_id]},
    )
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    run = client.get(f"{API}/sessions/{session_id}/quality/runs").json()["items"][0]
    used = [u for u in run["rule_versions"] if u["rule_definition_id"] == rule_id]
    assert used, run["rule_versions"]
    assert used[0]["version"] == "1"

    # The version the run cites is readable, and stays readable after an edit.
    client.put(f"{RULES_API}/{rule_id}", json={
        "name": _uid("Renamed "), "category": "Common", "check_type": "unique",
        "severity": "low", "status": "active",
    })
    cited = client.get(f"{RULES_API}/{rule_id}/versions/1").json()
    assert cited["check_type"] == "mandatory"
    assert cited["severity"] == "high"


def test_a_session_can_say_how_many_times_it_has_been_checked(client: TestClient):
    """
    A run is one table, so checking a three-table session once writes three
    records. Reporting that as three runs is as wrong as reporting one.
    """
    session_id = _new_session(client, _uid("Counted "))
    book = _workbook({
        "Poles": [["Pole ID", "Material"], ["P1", "Wood"], ["P2", "Steel"]],
        "Spans": [["Span ID", "Length"], ["S1", "40"], ["S2", "55"]],
    })
    _upload(client, session_id, "network.xlsx", book)
    _import_now(client, session_id)
    client.post(f"{API}/sessions/{session_id}/profile-all")
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    assert len(files) == 2
    _map_first_column_of_each_table(client, session_id, files)

    client.post(f"{API}/sessions/{session_id}/quality/run-all")
    client.post(f"{API}/sessions/{session_id}/quality/run-all")

    history = client.get(f"{API}/sessions/{session_id}/quality/runs").json()
    assert history["total"] == 4, "two checks over two tables is four records"
    assert history["run_count"] == 2, history["run_count"]
    assert [g["tables"] for g in history["groups"]] == [2, 2]
    newest = history["groups"][0]
    assert newest["findings_total"] == sum(r["findings_total"] for r in newest["runs"])
    assert newest["completed_at"] >= history["groups"][1]["completed_at"]


# ── execution scope, and applicability as four states ──────────────────────

def _library_rule(client: TestClient, **overrides) -> dict:
    payload = {
        "name": _uid("Scoped rule "), "category": "Common",
        "check_type": "mandatory", "severity": "medium", "status": "active",
        **overrides,
    }
    created = client.post(RULES_API, json=payload)
    assert created.status_code == 201, created.text
    return created.json()


def test_a_rule_declares_what_execution_it_needs(client: TestClient):
    """
    A governed rule can be valid and describe work the engine cannot do yet.
    Saying so is the point — the alternative is a rule silently missing from
    every picker, which reads as "governance forgot it".
    """
    catalogue = client.get(f"{RULES_API}/catalogue").json()
    assert [s["key"] for s in catalogue["execution_scopes"]] == [
        "column", "row", "multi_column", "cross_table", "cross_source",
        "aggregate", "historical",
    ]
    runnable = {s["key"] for s in catalogue["execution_scopes"] if s["executable"]}
    assert runnable == {"column", "row", "multi_column"}

    # Left unsaid, it is whatever the check normally needs.
    plain = _library_rule(client, check_type="mandatory")
    assert plain["execution_scope"] == "column"
    assert plain["is_executable"] is True
    records = _library_rule(client, check_type="duplicate_records")
    assert records["execution_scope"] == "multi_column"

    # Said, it can name execution that does not exist yet.
    governed = _library_rule(client, check_type="mandatory", execution_scope="cross_table")
    assert governed["execution_scope"] == "cross_table"
    assert governed["execution_scope_label"] == "Across tables"
    assert governed["is_executable"] is False

    refused = client.post(RULES_API, json={
        "name": _uid("Nonsense scope "), "category": "Common",
        "check_type": "mandatory", "execution_scope": "telepathy",
    })
    assert refused.status_code == 400, refused.text


def test_a_rule_written_before_execution_scope_still_has_one(client: TestClient):
    """Derived from the check type on read, rather than migrating the table."""
    rule_id = _define_library_rule(_uid("No scope stored "), "unique", "medium")
    rule = client.get(f"{RULES_API}/{rule_id}").json()
    assert rule["execution_scope"] == "column"
    assert rule["is_executable"] is True


def test_the_picker_marks_a_rule_it_cannot_run_rather_than_hiding_it(
    client: TestClient,
):
    """
    Four states, and none of them filters. Hiding was tried and reversed: the
    profiler guesses a type, so the rule somebody came for was the one missing.
    """
    session_id = _checked_session(client, _uid("Four states "))
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    column_id = _first_column_id(files[0]["source_file_id"])

    anywhere = _library_rule(client, data_type="any")
    for_text = _library_rule(client, data_type="text", check_type="format",
                             parameters={"pattern": "^.+$"})
    for_dates = _library_rule(client, data_type="date", check_type="valid_date")
    cross = _library_rule(client, execution_scope="cross_table")

    fields = client.get(f"{API}/sessions/{session_id}/rule-library/fields").json()
    field = next(f for f in fields["fields"] if f["column_id"] == column_id)
    assert field["data_type"] == "text", field["data_type"]
    state = {r["rule_definition_id"]: r["applicability"]["state"] for r in field["rules"]}

    assert state[anywhere["rule_definition_id"]] == "compatible"
    assert state[for_text["rule_definition_id"]] == "applicable"
    assert state[for_dates["rule_definition_id"]] == "mismatch"
    assert state[cross["rule_definition_id"]] == "not_executable"

    # Every one of them is still on the list.
    listed = {r["rule_definition_id"] for r in field["rules"]}
    assert {anywhere["rule_definition_id"], for_text["rule_definition_id"],
            for_dates["rule_definition_id"], cross["rule_definition_id"]} <= listed

    # And the one that cannot run says why, in the same words twice.
    offered = next(r for r in field["rules"]
                   if r["rule_definition_id"] == cross["rule_definition_id"])
    assert "across tables" in offered["applicability"]["reason"].lower()
    assert offered["blocked_reason"] == offered["applicability"]["reason"]
    named = {r["code"] for r in fields["not_runnable"]}
    assert cross["code"] in named


def test_a_rule_the_engine_cannot_run_is_refused_at_attach(client: TestClient):
    """
    Marked in the picker, refused on the way in. Attaching it would leave the
    quality report quietly short of a check somebody believes is in force.
    """
    session_id = _checked_session(client, _uid("Refused "))
    files = client.get(f"{API}/sessions/{session_id}/source-files").json()["items"]
    column_id = _first_column_id(files[0]["source_file_id"])
    cross = _library_rule(client, execution_scope="aggregate")

    refused = client.put(
        f"{API}/sessions/{session_id}/rule-library/fields/{column_id}",
        json={"rule_definition_ids": [cross["rule_definition_id"]]},
    )
    assert refused.status_code == 400, refused.text
    assert "cannot be attached" in refused.json()["detail"]
    assert "whole population" in refused.json()["detail"].lower()


def test_a_versioned_rule_keeps_the_execution_scope_it_had(client: TestClient):
    """The version log carries it, so an old result can be read in its terms."""
    rule = _library_rule(client, check_type="mandatory", execution_scope="row")
    client.put(f"{RULES_API}/{rule['rule_definition_id']}", json={
        "name": rule["name"], "category": "Common", "check_type": "mandatory",
        "execution_scope": "cross_source", "severity": "medium", "status": "active",
    })
    first = client.get(f"{RULES_API}/{rule['rule_definition_id']}/versions/1").json()
    second = client.get(f"{RULES_API}/{rule['rule_definition_id']}/versions/2").json()
    assert first["execution_scope"] == "row"
    assert second["execution_scope"] == "cross_source"
