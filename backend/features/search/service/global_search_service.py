"""PDP global search: one query across governed content, Structure, Rules and Discover.

Everything runs in the database — the browser never loads PDP to search it.
Each source is one SQL query that matches with ILIKE (partial text), ranks its
own rows, counts them, and returns only the top few. Ranking, best first:

    0  name equals the search text
    1  name starts with it
    2  name contains it
    3  the description (or other free text) contains it
    4  a property / metadata value contains it (code, external id, approved value…)

so a property match never pushes a better-named object out of the list.
Results carry the context a reader needs to tell them apart — type, model,
package, workspace, parent — and the ids the UI needs to open the object
itself rather than its workspace.

Lifecycle is shown, never used to hide: Archived content is found too, and the
caller may filter by status. Status is normalised to draft | active | retired
(Archived); Discover content takes its session's state.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from shared.db import get_connection

PACKAGES_SETTING_KEY = "mws_model_packages"
SHARED_PACKAGE_NAME = "Shared Models"
STATUSES = ("draft", "active", "retired")


@dataclass(frozen=True)
class Source:
    group: str
    type: str
    type_label: str
    workspace: str
    sql: str


# Each source selects these columns (in this order) and filters with
# %(like)s. NAME / TEXT / META are SQL expressions over the row.
_COLUMNS = """
    {id} AS id,
    {name} AS name,
    NULLIF(TRIM(COALESCE({desc}, '')), '') AS description,
    {status} AS status,
    {model_id} AS model_id,
    {model_name} AS model_name,
    {model_kind} AS model_kind,
    {parent} AS parent,
    {detail} AS detail,
    {focus_id} AS focus_id,
    {session_id} AS session_id,
    {file_id} AS file_id,
    {snippet} AS snippet,
    CASE
        WHEN lower({name}) = %(q)s THEN 0
        WHEN lower({name}) LIKE %(prefix)s THEN 1
        WHEN {name} ILIKE %(like)s{alt_name} THEN 2
        WHEN COALESCE({desc}, '') ILIKE %(like)s THEN 3
        ELSE 4
    END AS rank
"""


def _source(group, type_, label, workspace, *, from_, name, desc="NULL", meta="NULL", status="'active'",
            model_id="NULL", model_name="NULL", model_kind="NULL", parent="NULL", detail="NULL",
            focus_id="NULL", session_id="NULL", file_id="NULL", snippet=None, alt_names=(), where=""):
    """One source as a ranked, filtered query. alt_names are other name columns (e.g. display_name)."""
    alt = "".join(f" OR COALESCE({n}, '') ILIKE %(like)s" for n in alt_names)
    # What matched, when it was not the name: shown under the result.
    snippet_sql = snippet or (
        f"CASE WHEN NOT ({name} ILIKE %(like)s{alt}) AND NOT (COALESCE({desc}, '') ILIKE %(like)s) "
        f"THEN NULLIF(TRIM(COALESCE({meta}, '')), '') END"
    )
    columns = _COLUMNS.format(
        id="{id}", name=name, desc=desc, status=status, model_id=model_id, model_name=model_name,
        model_kind=model_kind, parent=parent, detail=detail, focus_id=focus_id, session_id=session_id,
        file_id=file_id, snippet=snippet_sql, alt_name=alt,
    )
    match = f"({name} ILIKE %(like)s{alt} OR COALESCE({desc}, '') ILIKE %(like)s OR COALESCE({meta}, '') ILIKE %(like)s)"
    sql = f"SELECT {columns} FROM {from_} WHERE {match}" + (f" AND ({where})" if where else "")
    return lambda id_: Source(group, type_, label, workspace, sql.replace("{id}", id_))


_SESSION_STATUS = (
    "CASE WHEN COALESCE(s.archived_at, '') <> '' OR s.status = 'archived' THEN 'retired' "
    "WHEN s.status = 'draft' THEN 'draft' ELSE 'active' END"
)
_FILE_NAME = "COALESCE(NULLIF(f.origin_filename, ''), f.original_filename) || CASE WHEN COALESCE(f.sheet_name, '') <> '' THEN ' — ' || f.sheet_name ELSE '' END"

SOURCES: list[Source] = [
    # ── Models ────────────────────────────────────────────────────────────
    _source("models", "hierarchy_model", "Hierarchy Model", "MWS",
            from_="hierarchy_model m", name="m.name", desc="m.purpose", status="m.status",
            model_id="m.model_id", model_name="m.name", model_kind="'hierarchy'")("m.model_id"),
    _source("models", "support_model", "Support Domain Model", "MWS",
            from_="support_domain_model m", name="m.name",
            desc="CONCAT_WS(' ', NULLIF(m.description, ''), m.purpose)", meta="m.badge_code", status="m.status",
            model_id="m.support_domain_model_id", model_name="m.name", model_kind="'support'")("m.support_domain_model_id"),
    # ── Types ─────────────────────────────────────────────────────────────
    _source("types", "node_type", "Node Type", "MWS",
            from_="hierarchy_model_node_type t JOIN hierarchy_model m ON m.model_id = t.model_id "
                  "LEFT JOIN hierarchy_model_node_type p ON p.node_type_id = t.parent_node_type_id",
            name="COALESCE(NULLIF(t.display_name, ''), t.name)", alt_names=("t.name",), desc="t.description",
            status="t.status", model_id="m.model_id", model_name="m.name", model_kind="'hierarchy'",
            parent="COALESCE(NULLIF(p.display_name, ''), p.name)", focus_id="t.node_type_id",
            where="NOT COALESCE(t.is_property, FALSE)")("t.node_type_id"),
    _source("types", "element_type", "Element Type", "MWS",
            from_="support_domain_element_type t JOIN support_domain_model m ON m.support_domain_model_id = t.support_domain_model_id "
                  "LEFT JOIN support_domain_element_type p ON p.element_id = t.parent_element_id",
            name="COALESCE(NULLIF(t.display_name, ''), t.name)", alt_names=("t.name",),
            desc="CONCAT_WS(' ', NULLIF(t.description, ''), NULLIF(t.definition, ''))", meta="CONCAT_WS(' ', t.badge_code, t.element_type)",
            status="t.status", model_id="m.support_domain_model_id", model_name="m.name", model_kind="'support'",
            parent="COALESCE(NULLIF(p.display_name, ''), p.name)", focus_id="t.element_id")("t.element_id"),
    # ── Properties ───────────────────────────────────────────────────────
    _source("properties", "asset_property", "Asset Property", "MWS",
            from_="hierarchy_model_node_type t JOIN hierarchy_model m ON m.model_id = t.model_id "
                  "LEFT JOIN hierarchy_model_node_type p ON p.node_type_id = t.parent_node_type_id",
            name="COALESCE(NULLIF(t.display_name, ''), t.name)", alt_names=("t.name",), desc="t.description",
            status="t.status", model_id="m.model_id", model_name="m.name", model_kind="'hierarchy'",
            parent="COALESCE(NULLIF(p.display_name, ''), p.name)", focus_id="t.node_type_id",
            where="COALESCE(t.is_property, FALSE)")("t.node_type_id"),
    _source("properties", "node_type_property", "Node Type Property", "MWS",
            from_="hierarchy_model_node_type_property pr JOIN hierarchy_model_node_type t ON t.node_type_id = pr.node_type_id "
                  "JOIN hierarchy_model m ON m.model_id = t.model_id",
            name="pr.name", desc="pr.description", status="pr.status", model_id="m.model_id", model_name="m.name",
            model_kind="'hierarchy'", parent="COALESCE(NULLIF(t.display_name, ''), t.name)", focus_id="t.node_type_id")("pr.property_id"),
    _source("properties", "element_type_property", "Element Type Property", "MWS",
            from_="support_domain_element_type_property pr JOIN support_domain_element_type t ON t.element_id = pr.element_id "
                  "JOIN support_domain_model m ON m.support_domain_model_id = t.support_domain_model_id",
            name="pr.name", desc="pr.description", status="pr.status", model_id="m.support_domain_model_id", model_name="m.name",
            model_kind="'support'", parent="COALESCE(NULLIF(t.display_name, ''), t.name)", focus_id="t.element_id")("pr.property_id"),
    # A property's approved value: the governed value it is linked to.
    _source("properties", "property_value", "Approved Value", "SWS",
            from_="node_instance_reference_value rv JOIN hierarchy_model_node_instance i ON i.node_instance_id = rv.node_instance_id "
                  "JOIN hierarchy_model m ON m.model_id = i.model_id "
                  "JOIN support_domain_element_instance v ON v.instance_id = rv.element_instance_id "
                  "LEFT JOIN hierarchy_model_node_instance pi ON pi.node_instance_id = i.parent_node_id",
            name="v.name", desc="NULL", status="rv.status", model_id="m.model_id", model_name="m.name",
            model_kind="'hierarchy'", parent="i.name || COALESCE(' · ' || pi.name, '')",
            detail="'Approved value of ' || i.name", focus_id="i.node_instance_id")("rv.reference_link_id"),
    # A value an instance gives a Node Type Property (set in SWS).
    _source("properties", "node_property_value", "Property Value", "SWS",
            from_="node_instance_property_value pv JOIN hierarchy_model_node_instance i ON i.node_instance_id = pv.node_instance_id "
                  "JOIN hierarchy_model_node_type_property pr ON pr.property_id = pv.property_id "
                  "JOIN hierarchy_model m ON m.model_id = i.model_id",
            name="pv.value", desc="NULL", meta="pr.name", status="i.status", model_id="m.model_id", model_name="m.name",
            model_kind="'hierarchy'", parent="i.name", detail="pr.name || ' of ' || i.name",
            focus_id="i.node_instance_id")("pv.property_value_id"),
    # ── Instances ────────────────────────────────────────────────────────
    _source("instances", "node_instance", "Node Instance", "SWS",
            from_="hierarchy_model_node_instance i JOIN hierarchy_model m ON m.model_id = i.model_id "
                  "LEFT JOIN hierarchy_model_node_type t ON t.node_type_id = i.node_type_id "
                  "LEFT JOIN hierarchy_model_node_instance pi ON pi.node_instance_id = i.parent_node_id",
            name="i.name", desc="i.description", meta="i.external_id", status="i.status", model_id="m.model_id",
            model_name="m.name", model_kind="'hierarchy'", parent="pi.name",
            detail="COALESCE(NULLIF(t.display_name, ''), t.name)", focus_id="i.node_instance_id")("i.node_instance_id"),
    _source("instances", "element_instance", "Element Instance", "SWS",
            from_="support_domain_element_instance i JOIN support_domain_model m ON m.support_domain_model_id = i.support_domain_model_id "
                  "LEFT JOIN support_domain_element_type t ON t.element_id = i.element_type_id",
            name="i.name", desc="i.description", meta="i.external_id", status="i.status",
            model_id="m.support_domain_model_id", model_name="m.name", model_kind="'support'",
            detail="COALESCE(NULLIF(t.display_name, ''), t.name)", focus_id="i.instance_id")("i.instance_id"),
    # ── Relationships ────────────────────────────────────────────────────
    _source("relationships", "sd_relationship", "Relationship", "MWS",
            from_="support_domain_relationship r JOIN support_domain_model m ON m.support_domain_model_id = r.support_domain_model_id "
                  "JOIN support_domain_element_type st ON st.element_id = r.source_element_id "
                  "JOIN support_domain_element_type tt ON tt.element_id = r.target_element_id",
            name="COALESCE(NULLIF(r.name, ''), initcap(replace(r.relationship_type, '_', ' ')))",
            alt_names=("r.relationship_type",), desc="r.description",
            meta="COALESCE(NULLIF(st.display_name, ''), st.name) || ' → ' || COALESCE(NULLIF(tt.display_name, ''), tt.name)",
            status="r.status", model_id="m.support_domain_model_id", model_name="m.name", model_kind="'support'",
            detail="COALESCE(NULLIF(st.display_name, ''), st.name) || ' → ' || COALESCE(NULLIF(tt.display_name, ''), tt.name)",
            focus_id="r.source_element_id",
            snippet="NULL")("r.relationship_id"),
    _source("relationships", "cross_model_relationship", "Cross-Model Relationship", "MWS",
            from_="cross_model_relationship_type r",
            name="r.name", desc="r.description", meta="r.governance_role", status="r.status",
            detail="CASE WHEN r.governance_role = 'approves_values' THEN 'Approves values' END")("r.relationship_type_id"),
    # ── Rules ────────────────────────────────────────────────────────────
    _source("rules", "rule_definition", "Rule Definition", "Rules",
            from_="rule_definition r",
            name="r.name", alt_names=("r.code",),
            desc="CONCAT_WS(' ', NULLIF(r.description, ''), NULLIF(r.rationale, ''))",
            meta="CONCAT_WS(' ', r.code, r.category, r.dimension, r.check_type, r.owner, r.reference)",
            status="r.status", parent="NULLIF(r.code, '')",
            detail="CONCAT_WS(' · ', NULLIF(initcap(replace(r.category, '_', ' ')), ''), NULLIF(initcap(r.dimension), ''))",
            focus_id="r.rule_definition_id")("r.rule_definition_id"),
    _source("rules", "rule_configuration", "Rule Configuration", "Rules",
            # Only configurations whose rule still exists: the Rule Workspace lists
            # them through their rule, so an orphan would open on nothing.
            from_="rule_configuration c JOIN rule_definition r ON r.rule_definition_id = c.rule_definition_id",
            name="c.name", alt_names=("c.code",), desc="c.description", meta="CONCAT_WS(' ', c.code, c.owner)",
            status="c.status", parent="r.name", detail="NULLIF(c.code, '')",
            # Opens in the Rule Workspace on the rule it configures.
            focus_id="c.rule_definition_id")("c.rule_configuration_id"),
    # Every category the library uses, and any set up in advance with a code
    # prefix — not only the ones whose prefix somebody changed.
    _source("rules", "dq_category", "DQ Category", "Rules",
            from_="(SELECT LOWER(TRIM(c.category)) AS category_key, MIN(TRIM(c.category)) AS category, "
                  "MAX(p.prefix) AS prefix "
                  "FROM (SELECT category FROM rule_definition UNION SELECT category FROM rule_code_prefix) c "
                  "LEFT JOIN rule_code_prefix p ON p.category_key = LOWER(TRIM(c.category)) "
                  "WHERE TRIM(COALESCE(c.category, '')) <> '' "
                  "GROUP BY LOWER(TRIM(c.category))) k",
            name="k.category", meta="k.prefix",
            detail="CASE WHEN k.prefix IS NULL THEN 'Rule category' ELSE 'Code prefix ' || k.prefix END",
            focus_id="k.category")("k.category_key"),
    # ── Discover ─────────────────────────────────────────────────────────
    _source("discover", "discover_session", "Discover Session", "Discover",
            from_="discovery_session s", name="s.name", desc="s.description", meta="s.source_name",
            status=_SESSION_STATUS, session_id="s.session_id", detail="NULLIF(s.source_name, '')")("s.session_id"),
    _source("discover", "source_table", "Source Table", "Discover",
            from_="discovery_source_file f JOIN discovery_session s ON s.session_id = f.session_id",
            name=_FILE_NAME, alt_names=("f.original_filename", "f.sheet_name"), status=_SESSION_STATUS,
            parent="s.name", session_id="s.session_id", file_id="f.source_file_id")("f.source_file_id"),
    _source("discover", "source_column", "Source Column", "Discover",
            from_="discovery_column c JOIN discovery_session s ON s.session_id = c.session_id "
                  "LEFT JOIN discovery_source_file f ON f.source_file_id = c.source_file_id",
            name="c.source_label", alt_names=("c.internal_name",), meta="c.inferred_datatype", status=_SESSION_STATUS,
            parent="s.name", detail=_FILE_NAME, session_id="s.session_id", file_id="c.source_file_id",
            # Opens on the Profile step, which selects its columns by discovery_column id.
            focus_id="c.discovery_column_id")("c.discovery_column_id"),
    _source("discover", "mapping", "Mapping", "Discover",
            from_="column_mapping mp JOIN discovery_session s ON s.session_id = mp.session_id "
                  "JOIN source_column sc ON sc.column_id = mp.column_id "
                  "LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = mp.target_node_id "
                  "LEFT JOIN discovery_source_file f ON f.source_file_id = mp.source_file_id",
            name="sc.column_name || ' → ' || COALESCE(n.name, '?')", alt_names=("sc.column_name", "n.name"),
            desc="mp.rationale", status=_SESSION_STATUS, parent="s.name", detail=_FILE_NAME,
            session_id="s.session_id", file_id="mp.source_file_id", focus_id="mp.column_id")("mp.mapping_id"),
]

# Quality findings: one row per (table, column, check) — the latest — rather
# than one per run, so a long history does not flood the results.
_FINDINGS = Source(
    "quality", "quality_finding", "Quality Finding", "Discover",
    """
    SELECT * FROM (
        SELECT DISTINCT ON (qc.session_id, COALESCE(qc.source_file_id, ''), qc.column_name, qc.check_type)
            qc.quality_check_id AS id,
            qc.column_name || ' · ' || initcap(replace(qc.check_type, '_', ' ')) AS name,
            NULLIF(qc.message, '') AS description,
            """ + _SESSION_STATUS + """ AS status,
            NULL AS model_id, NULL AS model_name, NULL AS model_kind,
            s.name AS parent,
            initcap(qc.status) || COALESCE(' · ' || NULLIF(qc.target_name, ''), '') AS detail,
            qc.column_id AS focus_id,
            s.session_id AS session_id,
            qc.source_file_id AS file_id,
            NULL AS snippet,
            CASE
                WHEN lower(qc.column_name) = %(q)s THEN 0
                WHEN lower(qc.column_name) LIKE %(prefix)s THEN 1
                WHEN qc.column_name ILIKE %(like)s OR qc.check_type ILIKE %(like)s THEN 2
                WHEN qc.message ILIKE %(like)s THEN 3
                ELSE 4
            END AS rank
        FROM discovery_quality_check qc JOIN discovery_session s ON s.session_id = qc.session_id
        WHERE qc.column_name ILIKE %(like)s OR qc.check_type ILIKE %(like)s OR qc.message ILIKE %(like)s
              OR COALESCE(qc.target_name, '') ILIKE %(like)s
        ORDER BY qc.session_id, COALESCE(qc.source_file_id, ''), qc.column_name, qc.check_type, qc.created_at DESC
    ) latest
    """,
)
SOURCES.append(_FINDINGS)

GROUPS = [
    ("models", "Models"),
    ("types", "Node / Element Types"),
    ("instances", "Instances"),
    ("properties", "Properties"),
    ("relationships", "Relationships"),
    ("rules", "Rules"),
    ("discover", "Discover"),
    ("quality", "Quality Findings"),
]
GROUP_IDS = [group for group, _ in GROUPS]


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class GlobalSearchService:
    MIN_QUERY = 2

    def __init__(self, db_url: str):
        self._db_url = db_url

    def search(self, q: str, *, groups: list[str] | None = None, status: str | None = None, limit: int = 6) -> dict[str, Any]:
        text = " ".join((q or "").split())
        wanted = [g for g in GROUP_IDS if not groups or g in groups]
        empty = {"query": text, "total": 0, "groups": [], "counts": {g: 0 for g in GROUP_IDS}}
        if len(text) < self.MIN_QUERY:
            return empty
        lowered = text.lower()
        escaped = _escape_like(lowered)
        params = {"q": lowered, "prefix": f"{escaped}%", "like": f"%{escaped}%", "status": status, "limit": limit}
        status_filter = " WHERE status = %(status)s" if status in STATUSES else ""

        counts = {g: 0 for g in GROUP_IDS}
        rows_by_group: dict[str, list[dict[str, Any]]] = {g: [] for g in GROUP_IDS}
        with get_connection(self._db_url) as conn:
            packages = self._packages(conn)
            for source in SOURCES:
                # Counts come for every group, so the filter chips can say how many each would show.
                ranked = (
                    f"SELECT r.*, count(*) OVER () AS total FROM ({source.sql}) r{status_filter} "
                    f"ORDER BY r.rank, lower(r.name), r.id LIMIT %(limit)s"
                )
                found = [dict(row) for row in conn.execute(ranked, params).fetchall()]
                if not found:
                    continue
                counts[source.group] += int(found[0]["total"])
                if source.group not in wanted:
                    continue
                for row in found:
                    row.pop("total", None)
                    row.update(type=source.type, type_label=source.type_label, workspace=source.workspace)
                    kind = row.get("model_kind")
                    row["package"] = packages(kind, row.get("model_id")) if kind and row.get("model_id") else None
                    row["match"] = ("exact", "prefix", "name", "description", "property")[int(row["rank"])]
                    rows_by_group[source.group].append(row)

        result_groups = []
        for group, label in GROUPS:
            if group not in wanted or not rows_by_group[group]:
                continue
            items = sorted(rows_by_group[group], key=lambda r: (r["rank"], (r["name"] or "").lower()))[:limit]
            result_groups.append({"group": group, "label": label, "total": counts[group], "items": items})
        return {"query": text, "total": sum(counts.values()), "groups": result_groups, "counts": counts}

    def _packages(self, conn):
        """The package each model is in, from the MWS package setting (Shared Models by default)."""
        row = conn.execute(
            "SELECT setting_value FROM organisation_setting WHERE setting_key = %s", (PACKAGES_SETTING_KEY,)
        ).fetchone()
        names: dict[str, str] = {}
        owner: dict[str, str] = {}
        if row:
            try:
                state = json.loads(row["setting_value"] or "{}")
                names = {p.get("id"): p.get("name") for p in state.get("packages", []) if isinstance(p, dict)}
                owner = state.get("owner") or {}
            except (ValueError, TypeError, AttributeError):
                pass

        def lookup(kind: str, model_id: str) -> str:
            package_id = owner.get(f"{kind}:{model_id}")
            return names.get(package_id) or SHARED_PACKAGE_NAME

        return lookup
