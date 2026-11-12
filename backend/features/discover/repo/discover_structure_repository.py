"""
Resolving the two layers together, at read time.

PDP says what *should* be true about a property: which rule configuration it is
subject to, which governed vocabulary it is governed by. Discover says what was
*found* in the data representing it: which source column was mapped onto it,
which run assessed it, what the checks concluded.

Neither is written into the other. A failed check is an observation about data, not a
relationship Structure asserts, and persisting it as one would make the model
claim something nobody modelled. So the join happens here, on the way out, and
this module writes nothing at all.

Two rules the readers below exist to keep:

* **The latest run, or one named run — never a mixture.** Two runs measured
  different bytes, possibly against different rules. Presenting their findings
  together shows a reading nobody ever took.
* **No result is not a pass.** A property with no check comes back with no
  check, and the caller is expected to say so rather than leave it blank.
"""
from __future__ import annotations

import json

from shared.db import get_connection

#: The most findings one page may carry back.
#:
#: A check over a large table can hold thousands of failing records, and the
#: Navigator opens on the branch rather than on the records. The ceiling is
#: what keeps "expand this check" from fetching a table.
MAX_FINDING_PAGE = 200


class DiscoverStructureRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    # ── the quality results around a set of items ───────────────────────────────────

    def search_quality_results_by_structure_instance(self, node_ids: list[str], *, run_id: str = "") -> dict:
        """
        Everything both layers know about the data behind these hubs.

        A hub is whatever the reader put the hub icon on: a hierarchy node, a
        whole hierarchy model (`model:<id>`), or a governed value. Discover
        never maps a column onto a Transformer as such — it maps onto the
        Transformer's *properties* — so a hub's results are read through its
        relevant properties: the hub itself, the nodes it contains, and for a
        governed value the nodes a cross-model relationship joins it to. Each
        of those comes back with the path that reaches it, so the canvas can
        draw hub → property → column → result as one traceable line.

        `run_id` names a run to read instead of the newest one, which is how a
        reader opens an earlier assessment without its findings mixing into the
        current one.
        """
        wanted = [i for i in dict.fromkeys(node_ids) if i]
        if not wanted:
            return _empty()

        with get_connection(self._db_url) as connection:
            reach, truncated = _relevant_nodes(connection, wanted)
            all_nodes = list(dict.fromkeys(node for node, _hub, _path in reach))
            if not all_nodes:
                return {**_empty(), "truncated": truncated}

            mappings = [dict(row) for row in connection.execute(_MAPPINGS, (all_nodes,)).fetchall()]
            runs = [dict(row) for row in connection.execute(_RUNS, (all_nodes,)).fetchall()]

            if run_id:
                checks = [
                    dict(row)
                    for row in connection.execute(_CHECKS_OF_RUN, (all_nodes, run_id)).fetchall()
                ]
            else:
                checks = [dict(row) for row in connection.execute(_LATEST_CHECKS, (all_nodes,)).fetchall()]

            configurations = [
                _configuration(row)
                for row in connection.execute(_CONFIGURATIONS, (all_nodes,)).fetchall()
            ]
            references = [
                dict(row)
                for row in connection.execute(_REFERENCES, (all_nodes,)).fetchall()
            ]
            shaped = [_check(row) for row in checks]
            _resolve_configurations(connection, shaped)
            names = {
                row["node_instance_id"]: row["name"]
                for row in connection.execute(
                    "SELECT node_instance_id, name FROM hierarchy_model_node_instance "
                    "WHERE node_instance_id = ANY(%s)",
                    (all_nodes,),
                ).fetchall()
            }

        # Only properties something is known about are worth naming as links:
        # a Device holds hundreds of nodes, and the reader is asking about the
        # ones with data behind them.
        known = (
            {m["target_node_id"] for m in mappings}
            | {c["target_node_id"] for c in shaped if c.get("target_node_id")}
            | {c["target_node_id"] for c in configurations}
        )
        links = [
            {"hub_id": hub, "node_id": node, "path": path}
            for node, hub, path in reach
            if node in known
        ]

        return {
            "mappings": mappings,
            "runs": runs,
            "checks": shaped,
            "configurations": configurations,
            "references": references,
            "not_assessed": _not_assessed(configurations, mappings, shaped, names),
            "links": links,
            "truncated": truncated,
            # Named so the caller never has to guess which run the checks came
            # from, and so "there were no runs" is distinguishable from "the
            # newest run found nothing".
            "run_id": run_id,
            "run_ids": sorted({c["quality_run_id"] for c in shaped if c.get("quality_run_id")}),
        }

    # ── one check's findings, a page at a time ───────────────────────────────

    def list_findings_for_quality_check(self, quality_check_id: str, *, offset: int = 0, limit: int = 50) -> dict:
        """
        The records a check took exception to.

        Discover stores a check as one row carrying its counts and a sample of
        the values that failed; the sample is what can be shown without
        re-reading the source table. The total is reported from the count, so a
        reader is never told there are five problems when there are five
        hundred.
        """
        offset = max(0, int(offset or 0))
        limit = max(1, min(int(limit or 50), MAX_FINDING_PAGE))

        with get_connection(self._db_url) as connection:
            row = connection.execute(_CHECK_BY_ID, (quality_check_id,)).fetchone()
        if row is None:
            return {"rows": [], "total": 0, "has_more": False, "next_offset": None, "sampled": True}

        record = dict(row)
        detail = _detail(record)
        samples = _samples(detail)
        observed = int(record.get("observed_count") or 0)

        page = samples[offset : offset + limit]
        consumed = offset + len(page)
        return {
            "rows": [
                _finding(record, quality_check_id, offset + index, sample)
                for index, sample in enumerate(page)
            ],
            # The count is the truth; the samples are what can be displayed.
            "total": observed,
            "sampled": len(samples) < observed,
            "has_more": consumed < len(samples),
            "next_offset": consumed if consumed < len(samples) else None,
        }


# ── shaping ──────────────────────────────────────────────────────────────────


def _empty() -> dict:
    return {
        "mappings": [],
        "runs": [],
        "checks": [],
        "configurations": [],
        "references": [],
        "not_assessed": [],
        "links": [],
        "truncated": False,
        "run_id": "",
        "run_ids": [],
    }


#: The most nodes one hub may stand for. A whole model can hold thousands;
#: past this the read stops and says so rather than scanning the model.
MAX_RELEVANT_NODES = 5000

#: How deep a containment walk goes. Hierarchies are shallow in practice; the
#: limit is what stops a malformed parent loop from walking forever.
MAX_CONTAINMENT_DEPTH = 16

_MODEL_PREFIX = "model:"


def _relevant_nodes(connection, hub_ids: list[str]) -> tuple[list[tuple[str, str, list[str]]], bool]:
    """
    The nodes each hub stands for, and the path from the hub to each.

    * a hierarchy node: itself and everything it contains;
    * a hierarchy model (`model:<id>`): every node in it, reached from the
      model through its roots — the same way the graph draws it;
    * a governed value: the nodes a cross-model relationship joins it to, and
      what those contain.

    Returns `(node_id, hub_id, path)` triples, shortest path first, plus
    whether the walk stopped at `MAX_RELEVANT_NODES`.
    """
    model_ids = [h[len(_MODEL_PREFIX):] for h in hub_ids if h.startswith(_MODEL_PREFIX)]
    plain = [h for h in hub_ids if not h.startswith(_MODEL_PREFIX)]

    seeds: list[tuple[str, str, list[str]]] = []
    if plain:
        for row in connection.execute(
            "SELECT node_instance_id FROM hierarchy_model_node_instance "
            "WHERE node_instance_id = ANY(%s)",
            (plain,),
        ).fetchall():
            seeds.append((row["node_instance_id"], row["node_instance_id"], [row["node_instance_id"]]))
        # A governed value reaches the nodes it is joined to, in either
        # direction: which end a modeller started from is not a statement
        # about governance.
        for row in connection.execute(
            """
            SELECT x.source_instance_id AS hub_id, x.target_instance_id AS node_id
            FROM cross_model_relationship_instance x
            JOIN hierarchy_model_node_instance n ON n.node_instance_id = x.target_instance_id
            WHERE x.status = 'active' AND x.source_instance_id = ANY(%s)
            UNION
            SELECT x.target_instance_id AS hub_id, x.source_instance_id AS node_id
            FROM cross_model_relationship_instance x
            JOIN hierarchy_model_node_instance n ON n.node_instance_id = x.source_instance_id
            WHERE x.status = 'active' AND x.target_instance_id = ANY(%s)
            """,
            (plain, plain),
        ).fetchall():
            if row["hub_id"] == row["node_id"]:
                continue
            seeds.append((row["node_id"], row["hub_id"], [row["hub_id"], row["node_id"]]))
    if model_ids:
        for row in connection.execute(
            "SELECT node_instance_id, model_id FROM hierarchy_model_node_instance "
            "WHERE parent_node_id IS NULL AND model_id = ANY(%s)",
            (model_ids,),
        ).fetchall():
            hub = f"{_MODEL_PREFIX}{row['model_id']}"
            seeds.append((row["node_instance_id"], hub, [hub, row["node_instance_id"]]))

    found: list[tuple[str, str, list[str]]] = []
    seen: set[tuple[str, str]] = set()
    frontier: list[tuple[str, str, list[str]]] = []
    for node, hub, path in seeds:
        if (node, hub) in seen:
            continue
        seen.add((node, hub))
        found.append((node, hub, path))
        frontier.append((node, hub, path))

    truncated = False
    depth = 0
    while frontier and depth < MAX_CONTAINMENT_DEPTH:
        depth += 1
        parents = list({node for node, _hub, _path in frontier})
        children: dict[str, list[str]] = {}
        for row in connection.execute(
            "SELECT node_instance_id, parent_node_id FROM hierarchy_model_node_instance "
            "WHERE parent_node_id = ANY(%s) ORDER BY sort_order NULLS LAST, name",
            (parents,),
        ).fetchall():
            children.setdefault(row["parent_node_id"], []).append(row["node_instance_id"])
        next_frontier: list[tuple[str, str, list[str]]] = []
        for node, hub, path in frontier:
            for child in children.get(node, []):
                if (child, hub) in seen or child in path:
                    continue
                if len(found) >= MAX_RELEVANT_NODES:
                    truncated = True
                    break
                seen.add((child, hub))
                entry = (child, hub, [*path, child])
                found.append(entry)
                next_frontier.append(entry)
        frontier = next_frontier

    return found, truncated


def _resolve_configurations(connection, checks: list[dict]) -> None:
    """
    Which governed rule configuration each check executed.

    A configuration error records it in its own detail. A check that ran
    records the session's rule code, and the session's governed rule says
    which configuration that code was attached from. The configuration's own
    code and name are what a reader recognises from the Rule Workspace.
    """
    codes = sorted({c.get("rule_code") for c in checks if c.get("rule_code")})
    by_code: dict[tuple[str, str], str] = {}
    if codes:
        for row in connection.execute(
            "SELECT code, owner_session_id, source_rule_configuration_id FROM governed_rule "
            "WHERE code = ANY(%s)",
            (codes,),
        ).fetchall():
            by_code[(row["code"], row["owner_session_id"] or "")] = row["source_rule_configuration_id"] or ""
            by_code.setdefault((row["code"], ""), row["source_rule_configuration_id"] or "")

    for check in checks:
        detail = check.get("detail") or {}
        configuration_id = (
            detail.get("rule_configuration_id")
            or by_code.get((check.get("rule_code") or "", check.get("session_id") or ""))
            or by_code.get((check.get("rule_code") or "", ""))
            or ""
        )
        check["rule_configuration_id"] = configuration_id
        check["is_configuration_error"] = bool(
            detail.get("configuration_error") or check.get("check_type") == "configuration_error"
        )

    wanted = sorted({c["rule_configuration_id"] for c in checks if c["rule_configuration_id"]})
    if not wanted:
        for check in checks:
            check["configuration_code"] = None
            check["configuration_name"] = None
        return
    named = {
        row["rule_configuration_id"]: row
        for row in connection.execute(
            "SELECT rule_configuration_id, code, name FROM rule_configuration "
            "WHERE rule_configuration_id = ANY(%s)",
            (wanted,),
        ).fetchall()
    }
    for check in checks:
        row = named.get(check["rule_configuration_id"])
        check["configuration_code"] = row["code"] if row else None
        check["configuration_name"] = row["name"] if row else None


def _not_assessed(
    configurations: list[dict],
    mappings: list[dict],
    checks: list[dict],
    names: dict[str, str],
) -> list[dict]:
    """
    What governance says should have been checked and the shown runs did not.

    Absence is a result in its own right, not a blank: a property subject to a
    rule configuration that no shown run executed has *not been assessed*, and
    a screen that leaves it out reads as a pass. Two reasons are kept apart
    because different people fix them — nobody mapped a column onto the
    property, or a column was mapped and the rule did not run.
    """
    ran = {
        (c.get("target_node_id") or "", c.get("rule_configuration_id") or "")
        for c in checks
    }
    checked_targets = {c.get("target_node_id") for c in checks if c.get("target_node_id")}
    mapped = {m["target_node_id"] for m in mappings}
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for config in configurations:
        key = (config["target_node_id"], config["configuration_id"])
        if key in ran or key in seen:
            continue
        seen.add(key)
        out.append({
            "target_node_id": config["target_node_id"],
            "target_name": names.get(config["target_node_id"]),
            "configuration_id": config["configuration_id"],
            "rule_code": config.get("rule_code"),
            "rule_name": config.get("rule_name"),
            "applicability": config.get("applicability"),
            "reason": (
                "mapped_not_run" if config["target_node_id"] in mapped else "not_mapped"
            ),
        })

    for mapping in mappings:
        target = mapping["target_node_id"]
        if target in checked_targets or any(e["target_node_id"] == target for e in out):
            continue
        if (target, "") in seen:
            continue
        seen.add((target, ""))
        out.append({
            "target_node_id": target,
            "target_name": names.get(target) or mapping.get("target_name"),
            "configuration_id": None,
            "rule_code": None,
            "rule_name": None,
            "applicability": None,
            "reason": "mapped_not_run",
            "session_id": mapping.get("session_id"),
            "session_name": mapping.get("session_name"),
            "column_name": mapping.get("column_name"),
        })
    return out


def _detail(record: dict) -> dict:
    try:
        return json.loads(record.get("detail_json") or "{}")
    except (TypeError, ValueError):
        return {}


#: Where each kind of check keeps the records it took exception to.
#:
#: They disagree because they were written at different times for different
#: questions, and the reader should not have to know which. Order matters only
#: in that the first list found wins.
_SAMPLE_KEYS = (
    "invalid_examples",   # governed_rule
    "example_rows",       # completeness
    "values",             # mapped_field_issue
    "failing_examples",
    "samples",
    "examples",
)


def _samples(detail: dict) -> list:
    for key in _SAMPLE_KEYS:
        value = detail.get(key)
        if isinstance(value, list):
            return value
    return []


def _finding(record: dict, quality_check_id: str, index: int, sample) -> dict:
    """
    One sampled record, whatever shape the check stored it in.

    A governed-rule check keeps the offending *values* as bare strings; a
    completeness check keeps whole example *rows* as objects. Both are
    findings to a reader, so the difference is absorbed here rather than
    surfacing as a crash on one check type and not another.
    """
    if isinstance(sample, dict):
        row_reference = sample.get("row") or sample.get("row_reference") or sample.get("row_number") or ""
        value = sample.get("value")
        if value is None:
            # A whole example row: show it as itself rather than as "None".
            value = ", ".join(f"{k}={v}" for k, v in list(sample.items())[:4])
    else:
        row_reference = ""
        value = sample

    return {
        "finding_id": f"{quality_check_id}:{index}",
        "quality_check_id": quality_check_id,
        "quality_run_id": record.get("quality_run_id") or "",
        "severity": record.get("severity"),
        "outcome": "failed" if record.get("status") == "failed" else "attention",
        "row_reference": str(row_reference),
        "observed_value": "" if value is None else str(value),
        "message": record.get("message") or "",
    }


def _check(row: dict) -> dict:
    """
    One check, with the rule it ran under taken from the run itself.

    The live `discovery_rule_configuration` is where a rule is *configured*;
    the check's own detail is where the rule that *executed* was recorded, at
    the moment it executed. They can differ — a configuration can be edited or
    repointed afterwards — and a reader asking "which rule produced this
    result" must be told the second. So the join is a fallback and the
    snapshot wins.
    """
    record = dict(row)
    detail = _detail(record)
    record.pop("detail_json", None)
    record["detail"] = detail

    record["rule_code"] = detail.get("rule_code") or record.get("rule_code")
    record["rule_name"] = detail.get("rule_name") or record.get("rule_name")
    record["rule_id"] = detail.get("rule_definition_id") or record.get("rule_id")
    record["severity"] = detail.get("severity") or record.get("severity")
    record["rule_source"] = detail.get("rule_source") or ("run" if detail.get("rule_code") else "configuration")

    record["observed_count"] = int(record.get("observed_count") or 0)
    record["total_count"] = int(record.get("total_count") or 0)
    return record


def _configuration(row) -> dict:
    record = dict(row)
    try:
        record["parameters"] = json.loads(record.pop("parameters_json", None) or "{}")
    except (TypeError, ValueError):
        record["parameters"] = {}
    record["is_enabled"] = str(record.get("status") or "").lower() == "active"
    return record


# ── queries ──────────────────────────────────────────────────────────────────

#: Discover's mapping: one confirmed source column standing for one PDP target.
_MAPPINGS = """
    SELECT m.mapping_id,
           m.session_id,
           s.name                AS session_name,
           m.source_file_id,
           f.original_filename   AS file_name,
           m.column_id,
           COALESCE(c.column_name, '') AS column_name,
           m.target_node_id,
           n.name                AS target_name,
           m.mapping_state,
           m.confidence
    FROM column_mapping m
    JOIN discovery_session s ON s.session_id = m.session_id
    LEFT JOIN source_column c ON c.column_id = m.column_id
    LEFT JOIN discovery_source_file f ON f.source_file_id = m.source_file_id
    LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = m.target_node_id
    WHERE m.target_node_id = ANY(%s)
      AND m.mapping_state = 'confirmed'
    ORDER BY s.name, c.column_name
"""

#: Every run that assessed one of these targets, newest first, so an earlier
#: assessment can be opened deliberately rather than stumbled into.
_RUNS = """
    SELECT DISTINCT
           r.quality_run_id,
           r.session_id,
           s.name AS session_name,
           r.source_file_id,
           r.table_name,
           r.status,
           r.checked_columns,
           r.findings_total,
           r.failed_count,
           r.warning_count,
           r.rows_total,
           r.completed_at,
           r.created_at
    FROM discovery_quality_run r
    JOIN discovery_session s ON s.session_id = r.session_id
    JOIN discovery_quality_check q ON q.quality_run_id = r.quality_run_id
    WHERE q.target_node_id = ANY(%s)
    ORDER BY r.completed_at DESC, r.created_at DESC, r.quality_run_id DESC
"""

_CHECK_COLUMNS = """
           q.quality_check_id,
           COALESCE(q.quality_run_id, '') AS quality_run_id,
           q.session_id,
           q.source_file_id,
           q.target_node_id,
           q.target_name,
           q.column_id,
           q.column_name,
           q.check_type,
           q.status,
           q.observed_count,
           q.total_count,
           q.message,
           q.detail_json,
           q.created_at,
           cfg.rule_id,
           cfg.configuration_id,
           cfg.severity,
           rd.code AS rule_code,
           rd.name AS rule_name
"""

#: The configuration a check ran under is matched on session and target, which
#: is the grain Discover stores it at.
_CHECK_JOINS = """
    FROM discovery_quality_check q
    LEFT JOIN discovery_rule_configuration cfg
           ON cfg.session_id = q.session_id
          AND cfg.target_node_id = q.target_node_id
    LEFT JOIN rule_definition rd ON rd.rule_definition_id = cfg.rule_id
"""

#: Only the newest run's checks. The lateral is the pattern the Discover
#: readers already use; the COALESCE sits on the comparison rather than inside
#: it, because with no run row at all the lateral returns no row and a
#: COALESCE in there would never fire.
_LATEST_CHECKS = f"""
    SELECT {_CHECK_COLUMNS}
    {_CHECK_JOINS}
    LEFT JOIN LATERAL (
        SELECT r.quality_run_id
        FROM discovery_quality_run r
        WHERE r.session_id = q.session_id
          AND r.source_file_id = q.source_file_id
        ORDER BY r.completed_at DESC, r.created_at DESC, r.quality_run_id DESC
        LIMIT 1
    ) latest ON TRUE
    WHERE q.target_node_id = ANY(%s)
      AND COALESCE(q.quality_run_id, '') = COALESCE(latest.quality_run_id, '')
    ORDER BY q.column_name, q.check_type
"""

_CHECKS_OF_RUN = f"""
    SELECT {_CHECK_COLUMNS}
    {_CHECK_JOINS}
    WHERE q.target_node_id = ANY(%s)
      AND COALESCE(q.quality_run_id, '') = %s
    ORDER BY q.column_name, q.check_type
"""

_CHECK_BY_ID = """
    SELECT q.quality_check_id,
           COALESCE(q.quality_run_id, '') AS quality_run_id,
           q.status,
           q.message,
           q.observed_count,
           q.total_count,
           q.detail_json,
           cfg.severity
    FROM discovery_quality_check q
    LEFT JOIN discovery_rule_configuration cfg
           ON cfg.session_id = q.session_id
          AND cfg.target_node_id = q.target_node_id
    WHERE q.quality_check_id = %s
"""

#: The model layer: what governance says this property is subject to. These are
#: the governed rule configurations bound to the node instance, not Discover's
#: session copies.
_CONFIGURATIONS = """
    SELECT c.rule_configuration_id AS configuration_id,
           c.rule_definition_id    AS rule_id,
           c.code                  AS rule_code,
           c.name                  AS rule_name,
           nir.node_instance_id    AS target_node_id,
           NULLIF(c.severity, '')  AS severity,
           c.status,
           c.parameters_json,
           nir.applicability
    FROM node_instance_rule nir
    JOIN rule_configuration c ON c.rule_configuration_id = nir.rule_configuration_id
    WHERE nir.node_instance_id = ANY(%s)
      AND nir.status = 'active'
    ORDER BY c.code, c.name
"""

#: The governed vocabulary a bound rule reads. An empty selection means the
#: whole vocabulary, which is why the second branch exists.
_REFERENCES = """
    SELECT DISTINCT
           i.instance_id     AS reference_id,
           i.name            AS name,
           et.name           AS element_type_name,
           m.name            AS model_name,
           nir.node_instance_id AS target_node_id,
           c.rule_configuration_id AS configuration_id
    FROM node_instance_rule nir
    JOIN rule_configuration c ON c.rule_configuration_id = nir.rule_configuration_id
    JOIN support_domain_element_instance i
      ON i.element_type_id = c.reference_element_type_id
     AND i.status = 'active'
    JOIN support_domain_element_type et ON et.element_id = i.element_type_id
    JOIN support_domain_model m ON m.support_domain_model_id = et.support_domain_model_id
    WHERE nir.node_instance_id = ANY(%s)
      AND nir.status = 'active'
      AND c.reference_element_type_id <> ''
      AND (
            COALESCE(NULLIF(c.reference_value_ids_json, ''), '[]') = '[]'
            OR i.instance_id IN (
                SELECT jsonb_array_elements_text(
                    COALESCE(NULLIF(c.reference_value_ids_json, ''), '[]')::jsonb
                )
            )
      )
    ORDER BY i.name
"""
