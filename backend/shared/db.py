import json
import psycopg2
import psycopg2.extras
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from features.model.domain.badge_constants import (
    DEFAULT_BADGE_COLOR,
    DEFAULT_BADGE_CONTENT_TYPE,
    DEFAULT_BADGE_SHAPE,
    DEFAULT_BADGE_SIZE,
    DEFAULT_BADGE_TEXT,
    DEFAULT_BADGE_TEXT_COLOR,
)

SCHEMA_STATEMENTS: tuple[str, ...] = (
    '''
    CREATE TABLE IF NOT EXISTS hierarchy_model (
        model_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL,
        owning_domain TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    f'''
    CREATE TABLE IF NOT EXISTS badge_store (
        badge_store_id TEXT PRIMARY KEY,
        owner_entity_type TEXT NOT NULL,
        owner_entity_id TEXT NOT NULL UNIQUE,
        badge_text TEXT NOT NULL DEFAULT '{DEFAULT_BADGE_TEXT}',
        badge_shape TEXT NOT NULL DEFAULT '{DEFAULT_BADGE_SHAPE}',
        badge_color TEXT NOT NULL DEFAULT '{DEFAULT_BADGE_COLOR}',
        badge_text_color TEXT NOT NULL DEFAULT '{DEFAULT_BADGE_TEXT_COLOR}',
        badge_icon TEXT,
        badge_size INTEGER NOT NULL DEFAULT {DEFAULT_BADGE_SIZE},
        badge_content_type TEXT NOT NULL DEFAULT '{DEFAULT_BADGE_CONTENT_TYPE}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS hierarchy_model_node_type (
        node_type_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL,
        badge_store_id TEXT UNIQUE,
        is_recursive BOOLEAN NOT NULL DEFAULT FALSE,
        -- A property node type holds a value and nothing beneath it. Nothing
        -- may be added under one, which is why it is a property rather than a
        -- level of the hierarchy.
        is_property BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        parent_node_type_id TEXT REFERENCES hierarchy_model_node_type(node_type_id),
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(model_id, name),
        FOREIGN KEY(model_id) REFERENCES hierarchy_model(model_id),
        FOREIGN KEY(badge_store_id) REFERENCES badge_store(badge_store_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS hierarchy_model_node_type_property (
        property_id TEXT PRIMARY KEY,
        node_type_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        inheritable BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(node_type_id, name),
        FOREIGN KEY(node_type_id) REFERENCES hierarchy_model_node_type(node_type_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS structural_rule (
        rule_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        parent_node_type_id TEXT NOT NULL,
        child_node_type_id TEXT NOT NULL,
        relationship_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(model_id) REFERENCES hierarchy_model(model_id),
        UNIQUE(model_id, parent_node_type_id, child_node_type_id, relationship_kind)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS hierarchy_model_node_instance (
        node_instance_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        node_type_id TEXT NOT NULL,
        external_id TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT NULL,
        parent_node_id TEXT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(model_id) REFERENCES hierarchy_model(model_id),
        FOREIGN KEY(node_type_id) REFERENCES hierarchy_model_node_type(node_type_id),
        FOREIGN KEY(parent_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS hierarchy_model_node_instance_property (
        property_instance_id TEXT PRIMARY KEY,
        node_instance_id TEXT NOT NULL,
        property_type_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(node_instance_id, property_type_id),
        FOREIGN KEY(node_instance_id) REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE,
        FOREIGN KEY(property_type_id) REFERENCES hierarchy_model_node_type_property(property_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- A Node Instance's value for a Property its Node Type defines. MWS owns
    -- the definition (hierarchy_model_node_type_property: name, description,
    -- status, inheritable); SWS only fills in the value, one per instance and
    -- property. Removing the instance or the definition removes the value.
    CREATE TABLE IF NOT EXISTS node_instance_property_value (
        property_value_id TEXT PRIMARY KEY,
        node_instance_id TEXT NOT NULL,
        property_id TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(node_instance_id, property_id),
        FOREIGN KEY(node_instance_id) REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE,
        FOREIGN KEY(property_id) REFERENCES hierarchy_model_node_type_property(property_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- `governance_role` is what makes a relationship mean something to the
    -- rules, rather than only to the diagram. A type left NULL is an ordinary
    -- modelling relationship. 'approves_values' marks the one that says
    -- `Asset Property -> is governed by -> approved value`: the edges drawn
    -- with it ARE the approved set a check runs against. One store, so a value
    -- governed on the diagram and a value picked in the Structure Rules panel
    -- are the same row and can never disagree.
    CREATE TABLE IF NOT EXISTS cross_model_relationship_type (
        relationship_type_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        source_model_type TEXT NOT NULL DEFAULT 'HIERARCHY_MODEL',
        source_model_item_type_id TEXT NULL,
        target_model_type TEXT NOT NULL DEFAULT 'HIERARCHY_MODEL',
        target_model_item_type_id TEXT NULL,
        governance_role TEXT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_instance (
        relationship_id TEXT PRIMARY KEY,
        external_id TEXT UNIQUE,
        relationship_rule_id TEXT NOT NULL,
        source_instance_id TEXT NOT NULL,
        source_instance_type TEXT NOT NULL,
        target_instance_id TEXT NOT NULL,
        target_instance_type TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT current_timestamp,
        UNIQUE(source_instance_id, target_instance_id),
        FOREIGN KEY(relationship_rule_id) REFERENCES cross_model_relationship_type(relationship_type_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_type_diagrams (
        diagram_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_type_diagram_nodes (
        diagram_node_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        item_type_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(diagram_id, item_type_id),
        FOREIGN KEY(diagram_id) REFERENCES cross_model_relationship_type_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_type_diagram_edges (
        diagram_edge_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        edge_key TEXT NOT NULL,
        edge_style TEXT NOT NULL DEFAULT 'curved',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(diagram_id, edge_key),
        FOREIGN KEY(diagram_id) REFERENCES cross_model_relationship_type_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_type_diagram_shapes (
        diagram_shape_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        shape_kind TEXT NOT NULL,
        pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        width DOUBLE PRECISION NOT NULL DEFAULT 200,
        height DOUBLE PRECISION NOT NULL DEFAULT 120,
        text TEXT NOT NULL DEFAULT '',
        stroke_color TEXT NULL,
        text_color TEXT NULL,
        font_size DOUBLE PRECISION NULL,
        z_index INTEGER NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(diagram_id) REFERENCES cross_model_relationship_type_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_instance_diagrams (
        diagram_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    -- Saved Impact knowledge-graph views.
    --
    -- Separate tables from the cross-model diagrams on purpose. The two look
    -- alike and mean different things: a cross-model diagram is governance
    -- somebody authored, an impact diagram is a reading somebody kept. Sharing
    -- one table would put them in each other's lists and make "delete the
    -- impact views" a query nobody could write safely.
    CREATE TABLE IF NOT EXISTS impact_diagrams (
        diagram_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS impact_diagram_nodes (
        diagram_node_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        -- The id of the thing being looked at, and which kind of thing it is.
        -- No foreign key: an impact view is a reading, and it must survive the
        -- node it read being retired — the canvas drops what no longer
        -- resolves and says so, rather than the row vanishing underneath it.
        item_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(diagram_id, item_id),
        FOREIGN KEY(diagram_id) REFERENCES impact_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS impact_diagram_edges (
        diagram_edge_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        edge_key TEXT NOT NULL,
        edge_style TEXT NOT NULL DEFAULT 'curved',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(diagram_id, edge_key),
        FOREIGN KEY(diagram_id) REFERENCES impact_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_instance_diagram_nodes (
        diagram_node_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(diagram_id, item_id),
        FOREIGN KEY(diagram_id) REFERENCES cross_model_relationship_instance_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_instance_diagram_edges (
        diagram_edge_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        edge_key TEXT NOT NULL,
        edge_style TEXT NOT NULL DEFAULT 'curved',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(diagram_id, edge_key),
        FOREIGN KEY(diagram_id) REFERENCES cross_model_relationship_instance_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS cross_model_relationship_instance_diagram_shapes (
        diagram_shape_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        shape_kind TEXT NOT NULL,
        pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        width DOUBLE PRECISION NOT NULL DEFAULT 200,
        height DOUBLE PRECISION NOT NULL DEFAULT 120,
        text TEXT NOT NULL DEFAULT '',
        stroke_color TEXT NULL,
        text_color TEXT NULL,
        font_size DOUBLE PRECISION NULL,
        z_index INTEGER NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(diagram_id) REFERENCES cross_model_relationship_instance_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS discovery_session (
        session_id TEXT PRIMARY KEY,
        active_source_file_id TEXT,
        name TEXT NOT NULL,
        source_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS source_dataset (
        dataset_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_file_id TEXT,
        source_name TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        import_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS source_column (
        column_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_file_id TEXT,
        dataset_id TEXT NOT NULL,
        column_name TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        detected_type TEXT NOT NULL,
        sample_values_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(dataset_id) REFERENCES source_dataset(dataset_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS column_profile_result (
        profile_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        distinct_count INTEGER NOT NULL,
        null_count INTEGER NOT NULL,
        blank_count INTEGER NOT NULL,
        inferred_kind TEXT NOT NULL,
        value_distribution_json TEXT NOT NULL,
        profiled_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(column_id) REFERENCES source_column(column_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS column_mapping (
        mapping_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_file_id TEXT,
        column_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        mapping_state TEXT NOT NULL,
        confidence REAL NOT NULL,
        rationale TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id, column_id),
        UNIQUE(session_id, source_file_id, target_node_id),
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(column_id) REFERENCES source_column(column_id) ON DELETE CASCADE,
        FOREIGN KEY(target_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS check_execution (
        execution_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        execution_status TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS check_result (
        result_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        target_node_id TEXT,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        metric_value REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(execution_id) REFERENCES check_execution(execution_id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(column_id) REFERENCES source_column(column_id) ON DELETE CASCADE,
        FOREIGN KEY(target_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id)
    )
    ''',
    # ── W2-DWS-FEATURE-01: Authoritative Discover tables ──────────────────────
    '''
    CREATE TABLE IF NOT EXISTS discovery_source_file (
        source_file_id   TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_type        TEXT NOT NULL,
        file_size_bytes  BIGINT NOT NULL,
        storage_ref      TEXT NOT NULL,
        uploaded_by      TEXT NOT NULL,
        uploaded_at      TEXT NOT NULL,
        import_status    TEXT NOT NULL DEFAULT 'pending',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- An upload waiting to be structured, and the bytes it arrived as.
    --
    -- Upload stores the file and stops. The work of reading it — splitting a
    -- workbook into its sheets, storing every row, profiling each table — is a
    -- job, so the request that carries 38 MB does not also have to parse it
    -- while the person watches a spinner.
    --
    -- The bytes live here until the job finishes, which is what lets a job be
    -- picked up again after a restart instead of asking for the file back.
    CREATE TABLE IF NOT EXISTS discovery_import_job (
        job_id           TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        filename         TEXT NOT NULL,
        file_size_bytes  BIGINT NOT NULL,
        content_sha256   TEXT NOT NULL,
        content          BYTEA,
        uploaded_by      TEXT NOT NULL,
        -- queued → running → succeeded | failed. 'waiting' is a job that has
        -- been uploaded but not yet sent to work by Start Import.
        status           TEXT NOT NULL DEFAULT 'waiting',
        -- What it is doing right now, in words a person can read.
        stage            TEXT NOT NULL DEFAULT '',
        progress         INTEGER NOT NULL DEFAULT 0,
        rows_done        BIGINT NOT NULL DEFAULT 0,
        rows_total       BIGINT NOT NULL DEFAULT 0,
        tables_created   INTEGER NOT NULL DEFAULT 0,
        table_names_json TEXT NOT NULL DEFAULT '[]',
        message          TEXT NOT NULL DEFAULT '',
        attempts         INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        started_at       TEXT,
        finished_at      TEXT,
        heartbeat_at     TEXT,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE INDEX IF NOT EXISTS idx_import_job_session
        ON discovery_import_job (session_id, created_at)
    ''',
    '''
    CREATE INDEX IF NOT EXISTS idx_import_job_status
        ON discovery_import_job (status)
    ''',
    # ── One quality check per table, so a run can be watched and picked up
    #    again. Same shape as discovery_import_job, and for the same reasons:
    #    the table is the queue, so a worker in another process — or this one
    #    after a restart — can finish what nobody else did.
    '''
    CREATE TABLE IF NOT EXISTS discovery_quality_job (
        job_id           TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        source_file_id   TEXT NOT NULL,
        table_name       TEXT NOT NULL DEFAULT '',
        run_id           TEXT NOT NULL DEFAULT '',
        requested_by     TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'waiting',
        stage            TEXT NOT NULL DEFAULT '',
        progress         INTEGER NOT NULL DEFAULT 0,
        columns_done     INTEGER NOT NULL DEFAULT 0,
        columns_total    INTEGER NOT NULL DEFAULT 0,
        checked_columns  INTEGER NOT NULL DEFAULT 0,
        findings         INTEGER NOT NULL DEFAULT 0,
        failed_count     INTEGER NOT NULL DEFAULT 0,
        warnings         INTEGER NOT NULL DEFAULT 0,
        message          TEXT NOT NULL DEFAULT '',
        attempts         INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        started_at       TEXT,
        finished_at      TEXT,
        heartbeat_at     TEXT,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(source_file_id) REFERENCES discovery_source_file(source_file_id)
            ON DELETE CASCADE
    )
    ''',
    '''
    CREATE INDEX IF NOT EXISTS idx_quality_job_session
        ON discovery_quality_job (session_id, created_at)
    ''',
    '''
    CREATE INDEX IF NOT EXISTS idx_quality_job_status
        ON discovery_quality_job (status)
    ''',
    '''
    CREATE TABLE IF NOT EXISTS discovery_source_context (
        context_id          TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL,
        source_file_id      TEXT,
        source_application  TEXT NOT NULL,
        source_module       TEXT,
        application_ref_id  TEXT,
        module_ref_id       TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE(session_id, source_file_id),
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- Where a Discover table came from: the Application (an instance of a
    -- governed model, e.g. GIS in the Applications model) that produced it.
    -- Separate from discovery_source_context, which is the model the table's
    -- columns are mapped against. One row per table (the level Mapping uses),
    -- so each sheet of a workbook keeps its own; never derived from a file name.
    -- The instance is not a foreign key: it may be a hierarchy node or an SD
    -- element instance, and a deleted one is reported as missing, not dropped.
    CREATE TABLE IF NOT EXISTS discovery_source_application (
        association_id  TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL,
        source_file_id  TEXT NOT NULL,
        model_kind      TEXT NOT NULL CHECK (model_kind IN ('hierarchy', 'support')),
        model_id        TEXT NOT NULL,
        instance_id     TEXT NOT NULL,
        set_by          TEXT NOT NULL DEFAULT 'user',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE(session_id, source_file_id),
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(source_file_id) REFERENCES discovery_source_file(source_file_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS discovery_import_validation_result (
        validation_result_id TEXT PRIMARY KEY,
        session_id           TEXT NOT NULL,
        source_file_id       TEXT NOT NULL,
        validation_status    TEXT NOT NULL DEFAULT 'pending',
        row_count            INTEGER,
        column_count         INTEGER,
        has_header_row       BOOLEAN,
        blocking_failure     BOOLEAN NOT NULL DEFAULT FALSE,
        validated_at         TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(source_file_id) REFERENCES discovery_source_file(source_file_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS discovery_import_validation_issue (
        issue_id             TEXT PRIMARY KEY,
        validation_result_id TEXT NOT NULL,
        session_id           TEXT NOT NULL,
        issue_type           TEXT NOT NULL,
        severity             TEXT NOT NULL DEFAULT 'warning',
        is_blocking          BOOLEAN NOT NULL DEFAULT FALSE,
        column_ordinal       INTEGER,
        original_label       TEXT,
        internal_name        TEXT,
        detail               TEXT NOT NULL,
        created_at           TEXT NOT NULL,
        FOREIGN KEY(validation_result_id) REFERENCES discovery_import_validation_result(validation_result_id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS discovery_column (
        discovery_column_id TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL,
        source_file_id      TEXT NOT NULL,
        source_label        TEXT NOT NULL,
        internal_name       TEXT NOT NULL,
        inferred_datatype   TEXT NOT NULL,
        ordinal             INTEGER NOT NULL,
        is_nullable         BOOLEAN NOT NULL DEFAULT TRUE,
        duplicate_group_key TEXT,
        created_at          TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(source_file_id) REFERENCES discovery_source_file(source_file_id) ON DELETE CASCADE
    )
    ''',
    # Parsed content of the uploaded source file: the header shape plus one
    # JSON object per data row, so columns/rows/profiling are served from
    # Postgres rather than recomputed from client state.
    '''
    CREATE TABLE IF NOT EXISTS discovery_parsed_file (
        parsed_file_id      TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL,
        source_file_id      TEXT NOT NULL,
        column_labels_json  TEXT NOT NULL,
        internal_names_json TEXT NOT NULL,
        row_count           INTEGER NOT NULL DEFAULT 0,
        column_count        INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(source_file_id) REFERENCES discovery_source_file(source_file_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS discovery_source_row (
        row_id         TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL,
        source_file_id TEXT NOT NULL,
        row_number     INTEGER NOT NULL,
        row_data       JSONB NOT NULL,
        created_at     TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(source_file_id) REFERENCES discovery_source_file(source_file_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE INDEX IF NOT EXISTS idx_discovery_source_row_session
        ON discovery_source_row (session_id, row_number)
    ''',
    # Structured data-quality findings: one row per (mapped column, check type),
    # so the Quality step can show what was checked, what was observed, and the
    # offending values — not just a severity label.
    '''
    CREATE TABLE IF NOT EXISTS discovery_quality_check (
        quality_check_id TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        execution_id     TEXT NOT NULL,
        scope            TEXT NOT NULL DEFAULT 'column',
        column_id        TEXT,
        column_name      TEXT NOT NULL,
        target_node_id   TEXT,
        target_name      TEXT,
        check_type       TEXT NOT NULL,
        status           TEXT NOT NULL,
        rule_source      TEXT NOT NULL DEFAULT 'default',
        observed_count   INTEGER NOT NULL DEFAULT 0,
        total_count      INTEGER NOT NULL DEFAULT 0,
        metric_value     DOUBLE PRECISION NOT NULL DEFAULT 0,
        message          TEXT NOT NULL,
        detail_json      TEXT NOT NULL DEFAULT '{}',
        source_file_id   TEXT,
        file_hash        TEXT,
        mapping_version  TEXT,
        rule_version     TEXT,
        created_at       TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- One completed quality run over one table: the evidence event.
    --
    -- A run used to be implicit. Findings were deleted and rewritten in place,
    -- so the only thing the database could say was "here is what is true now",
    -- and a result could never be explained after the mapping or a threshold
    -- moved. A run is now its own record, and findings point at it.
    --
    -- The two snapshots are the point of the table. `rule_version` and
    -- `mapping_version` are content hashes: they prove two runs were measured
    -- the same way, and they cannot say what the measurement WAS. The snapshots
    -- can, because they are the effective configuration copied at the moment it
    -- was used — parameters, severity, target, and the library rule and version
    -- each one came from.
    CREATE TABLE IF NOT EXISTS discovery_quality_run (
        quality_run_id   TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        source_file_id   TEXT NOT NULL,
        table_name       TEXT NOT NULL DEFAULT '',
        -- The id stamped on this run's findings.
        execution_id     TEXT NOT NULL DEFAULT '',
        -- Ties the per-table runs of one "check every table" together.
        run_group_id     TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'completed',
        -- What was measured: the bytes, the mapping, the rule set.
        file_hash        TEXT NOT NULL DEFAULT '',
        mapping_version  TEXT NOT NULL DEFAULT '',
        rule_version     TEXT NOT NULL DEFAULT '',
        -- What the versions above are a hash of, kept verbatim and never edited.
        mapping_snapshot_json TEXT NOT NULL DEFAULT '[]',
        rule_snapshot_json    TEXT NOT NULL DEFAULT '[]',
        checked_columns  INTEGER NOT NULL DEFAULT 0,
        findings_total   INTEGER NOT NULL DEFAULT 0,
        failed_count     INTEGER NOT NULL DEFAULT 0,
        warning_count    INTEGER NOT NULL DEFAULT 0,
        rows_total       BIGINT NOT NULL DEFAULT 0,
        requested_by     TEXT NOT NULL DEFAULT '',
        completed_at     TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- Reading a table's findings means finding its newest run first, on every
    -- Quality page load.
    CREATE INDEX IF NOT EXISTS idx_quality_run_latest
        ON discovery_quality_run (session_id, source_file_id, completed_at DESC)
    ''',
    '''
    CREATE INDEX IF NOT EXISTS idx_discovery_quality_check_session
        ON discovery_quality_check (session_id, created_at)
    ''',
    # ── Governed rules ────────────────────────────────────────────────────────
    # Rule instances are governed: they are defined once and consumed by Discover,
    # never authored inside a session. Admin decides which are operationally
    # available (available_to_discover); a session may only set the parameters a
    # rule permits.
    '''
    CREATE TABLE IF NOT EXISTS governed_rule (
        rule_id                   TEXT PRIMARY KEY,
        model_id                  TEXT,
        rule_kind                 TEXT NOT NULL,
        code                      TEXT NOT NULL UNIQUE,
        name                      TEXT NOT NULL,
        description               TEXT NOT NULL DEFAULT '',
        check_type                TEXT NOT NULL,
        applies_to                TEXT NOT NULL DEFAULT 'field',
        target_node_id            TEXT,
        default_parameters_json   TEXT NOT NULL DEFAULT '{}',
        permitted_parameters_json TEXT NOT NULL DEFAULT '[]',
        severity                  TEXT NOT NULL DEFAULT 'medium',
        requires_parameters       BOOLEAN NOT NULL DEFAULT FALSE,
        available_to_discover     BOOLEAN NOT NULL DEFAULT TRUE,
        status                    TEXT NOT NULL DEFAULT 'active',
        owner_session_id          TEXT,
        source_rule_definition_id TEXT NOT NULL DEFAULT '',
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL
    )
    ''',
    # Value-level classification: a raw source value related to a governed
    # Structure instance, e.g. 'KIOSK' → 'Kiosk Transformer'.
    '''
    CREATE TABLE IF NOT EXISTS discovery_value_classification (
        classification_id TEXT PRIMARY KEY,
        session_id        TEXT NOT NULL,
        source_file_id    TEXT,
        column_id         TEXT NOT NULL,
        column_name       TEXT NOT NULL,
        source_value      TEXT NOT NULL,
        target_node_id    TEXT,
        target_name       TEXT,
        state             TEXT NOT NULL DEFAULT 'suggested',
        confidence        DOUBLE PRECISION NOT NULL DEFAULT 0,
        match_method      TEXT NOT NULL DEFAULT 'none',
        occurrences       INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        UNIQUE(session_id, column_id, source_value),
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    # Which governed rules a session will run, and the parameters it set within
    # what each rule permits.
    '''
    CREATE TABLE IF NOT EXISTS discovery_rule_configuration (
        configuration_id TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        rule_id          TEXT NOT NULL,
        column_id        TEXT NOT NULL DEFAULT '',
        column_name      TEXT NOT NULL DEFAULT '',
        target_node_id   TEXT NOT NULL DEFAULT '',
        target_name      TEXT,
        is_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
        severity         TEXT,
        parameters_json  TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        UNIQUE(session_id, rule_id, target_node_id),
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS discover_audit_event (
        audit_event_id  TEXT PRIMARY KEY,
        session_id      TEXT,
        source_file_id  TEXT,
        actor           TEXT NOT NULL,
        action          TEXT NOT NULL,
        outcome         TEXT NOT NULL,
        correlation_id  TEXT,
        detail_json     TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES discovery_session(session_id) ON DELETE SET NULL
    )
    ''',
    # ── Rule Workspace ────────────────────────────────────────────────────────
    # Rules authored on their own, before any field is in sight. Attaching one
    # to a field is a separate record kept elsewhere, so nothing here points at
    # a model, a session or a column.
    '''
    CREATE TABLE IF NOT EXISTS rule_definition (
        rule_definition_id TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        description        TEXT NOT NULL DEFAULT '',
        category           TEXT NOT NULL DEFAULT 'data_quality',
        scope              TEXT NOT NULL DEFAULT 'field',
        definition_kind    TEXT NOT NULL DEFAULT 'builtin',
        check_type         TEXT NOT NULL,
        parameters_json    TEXT NOT NULL DEFAULT '{}',
        script             TEXT NOT NULL DEFAULT '',
        severity           TEXT NOT NULL DEFAULT 'medium',
        status             TEXT NOT NULL DEFAULT 'draft',
        -- A short stable code. Results cite it, so it outlives renaming.
        code               TEXT NOT NULL DEFAULT '',
        -- The quality dimension measured, so many rules roll up to few numbers.
        dimension          TEXT NOT NULL DEFAULT 'validity',
        -- Which kind of field this may be attached to: any | text | number | date.
        data_type          TEXT NOT NULL DEFAULT 'any',
        -- Why the rule exists, and what it answers to.
        rationale          TEXT NOT NULL DEFAULT '',
        reference          TEXT NOT NULL DEFAULT '',
        -- What a reviewer is told when a row fails.
        message_template   TEXT NOT NULL DEFAULT '',
        -- Values that should pass, and values that must not, kept with the rule
        -- so it can be re-checked without a dataset.
        examples_json      TEXT NOT NULL DEFAULT '{}',
        owner              TEXT NOT NULL DEFAULT '',
        version            INTEGER NOT NULL DEFAULT 1,
        updated_by         TEXT NOT NULL DEFAULT 'user',
        created_by         TEXT NOT NULL DEFAULT 'user',
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
    )
    ''',
    '''
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_definition_name
        ON rule_definition (LOWER(name))
    ''',
    '''
    -- Every version a rule has ever been, kept whole.
    --
    -- `rule_definition.version` counted edits; it could say a result came from
    -- v3 and never say what v3 was. A row is written here on create and on
    -- every edit, so "which rule version did this quality run execute, and
    -- what did it say" has an answer.
    --
    -- No foreign key to rule_definition on purpose. A deleted rule's versions
    -- are still cited by the runs that executed them, and evidence that
    -- resolves to nothing is worse than a few rows nobody lists.
    CREATE TABLE IF NOT EXISTS rule_definition_version (
        rule_version_id    TEXT PRIMARY KEY,
        rule_definition_id TEXT NOT NULL,
        version            INTEGER NOT NULL,
        code               TEXT NOT NULL DEFAULT '',
        name               TEXT NOT NULL,
        description        TEXT NOT NULL DEFAULT '',
        category           TEXT NOT NULL DEFAULT '',
        scope              TEXT NOT NULL DEFAULT 'field',
        execution_scope    TEXT NOT NULL DEFAULT '',
        definition_kind    TEXT NOT NULL DEFAULT 'builtin',
        check_type         TEXT NOT NULL DEFAULT '',
        parameters_json    TEXT NOT NULL DEFAULT '{}',
        script             TEXT NOT NULL DEFAULT '',
        severity           TEXT NOT NULL DEFAULT 'medium',
        status             TEXT NOT NULL DEFAULT 'draft',
        dimension          TEXT NOT NULL DEFAULT 'validity',
        data_type          TEXT NOT NULL DEFAULT 'any',
        rationale          TEXT NOT NULL DEFAULT '',
        reference          TEXT NOT NULL DEFAULT '',
        message_template   TEXT NOT NULL DEFAULT '',
        examples_json      TEXT NOT NULL DEFAULT '{}',
        owner              TEXT NOT NULL DEFAULT '',
        recorded_by        TEXT NOT NULL DEFAULT '',
        recorded_at        TEXT NOT NULL,
        UNIQUE(rule_definition_id, version)
    )
    ''',
    '''
    -- What code family a category hands out, when the team wants to choose it.
    --
    -- A prefix is derived from the category name by default ("Asset register"
    -- gives AR). That is a good guess and a bad rule: every organisation codes
    -- its rules differently, and a guess that cannot be overridden is a guess
    -- imposed. A row here overrides the guess for one category.
    --
    -- Changing a prefix never rewrites a code that has already been issued.
    -- Results cite codes, so a reissued code would re-label old evidence. The
    -- new family applies to rules created from then on.
    -- A named, parameterised use of a rule definition.
    --
    -- The definition says what the check *does*; the configuration says what it
    -- checks *against*. "Value is one of an approved list" is a definition;
    -- "Valid Voltage", "Valid Manufacturer" and "Valid Operational Status" are
    -- three configurations of it. This is what stops the library filling up
    -- with near-identical definitions that differ only in their values.
    --
    -- A configuration may hold its values literally, or point at a governed
    -- vocabulary with `reference_element_type_id`. Pointing is preferred: the
    -- vocabulary stays single-sourced, and the run snapshots the values it
    -- resolved rather than a copy that has quietly drifted.
    CREATE TABLE IF NOT EXISTS rule_configuration (
        rule_configuration_id TEXT PRIMARY KEY,
        rule_definition_id    TEXT NOT NULL,
        code                  TEXT NOT NULL DEFAULT '',
        name                  TEXT NOT NULL,
        description           TEXT NOT NULL DEFAULT '',
        parameters_json       TEXT NOT NULL DEFAULT '{}',
        -- Empty means "whatever the definition says".
        severity              TEXT NOT NULL DEFAULT '',
        status                TEXT NOT NULL DEFAULT 'draft',
        -- The governed vocabulary this configuration takes its values from.
        reference_element_type_id TEXT NOT NULL DEFAULT '',
        -- Which of that vocabulary's values this rule actually approves. Empty
        -- means all of them, which is what a rule bound to a whole vocabulary
        -- means; a subset is how two rules read one vocabulary and accept
        -- different parts of it.
        reference_value_ids_json  TEXT NOT NULL DEFAULT '[]',
        owner                 TEXT NOT NULL DEFAULT '',
        version               INTEGER NOT NULL DEFAULT 1,
        created_by            TEXT NOT NULL DEFAULT 'user',
        updated_by            TEXT NOT NULL DEFAULT 'user',
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        UNIQUE(rule_definition_id, name)
    )
    ''',
    '''
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_configuration_code
        ON rule_configuration (UPPER(code)) WHERE code <> ''
    ''',
    '''
    -- Every version a configuration has been, kept whole — the same bargain the
    -- definitions make. A run cites a configuration at a version; this is what
    -- makes that citation resolve to what it actually said.
    CREATE TABLE IF NOT EXISTS rule_configuration_version (
        configuration_version_id TEXT PRIMARY KEY,
        rule_configuration_id TEXT NOT NULL,
        version               INTEGER NOT NULL,
        rule_definition_id    TEXT NOT NULL,
        code                  TEXT NOT NULL DEFAULT '',
        name                  TEXT NOT NULL,
        description           TEXT NOT NULL DEFAULT '',
        parameters_json       TEXT NOT NULL DEFAULT '{}',
        severity              TEXT NOT NULL DEFAULT '',
        status                TEXT NOT NULL DEFAULT 'draft',
        reference_element_type_id TEXT NOT NULL DEFAULT '',
        reference_value_ids_json  TEXT NOT NULL DEFAULT '[]',
        owner                 TEXT NOT NULL DEFAULT '',
        recorded_by           TEXT NOT NULL DEFAULT '',
        recorded_at           TEXT NOT NULL,
        UNIQUE(rule_configuration_id, version)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS rule_code_prefix (
        -- Lower-cased, so "GIS" and "gis" are one category, not two families.
        category_key TEXT PRIMARY KEY,
        category     TEXT NOT NULL,
        prefix       TEXT NOT NULL,
        updated_by   TEXT NOT NULL DEFAULT '',
        updated_at   TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS impact_analysis_run (
        analysis_id TEXT PRIMARY KEY,
        analysis_status TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS impact_scope (
        analysis_id TEXT PRIMARY KEY,
        max_depth INTEGER NOT NULL,
        include_relationships INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(analysis_id) REFERENCES impact_analysis_run(analysis_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS impact_subject_ref (
        analysis_id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        seed_node_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(analysis_id) REFERENCES impact_analysis_run(analysis_id) ON DELETE CASCADE,
        FOREIGN KEY(seed_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS impact_path (
        path_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        semantic_key TEXT NOT NULL,
        depth INTEGER NOT NULL,
        path_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(analysis_id) REFERENCES impact_analysis_run(analysis_id) ON DELETE CASCADE,
        FOREIGN KEY(from_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id),
        FOREIGN KEY(to_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS affected_item (
        affected_item_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        depth INTEGER NOT NULL,
        reached_via TEXT NOT NULL,
        reached_from_node_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(analysis_id) REFERENCES impact_analysis_run(analysis_id) ON DELETE CASCADE,
        FOREIGN KEY(node_id) REFERENCES hierarchy_model_node_instance(node_instance_id),
        FOREIGN KEY(reached_from_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS impact_finding (
        finding_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        target_node_id TEXT,
        severity TEXT NOT NULL,
        score REAL NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(analysis_id) REFERENCES impact_analysis_run(analysis_id) ON DELETE CASCADE,
        FOREIGN KEY(target_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS improve_candidate (
        candidate_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        target_node_id TEXT,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(analysis_id) REFERENCES impact_analysis_run(analysis_id) ON DELETE CASCADE,
        FOREIGN KEY(finding_id) REFERENCES impact_finding(finding_id) ON DELETE CASCADE,
        FOREIGN KEY(target_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS work_program (
        program_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS remediation_task (
        task_id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL,
        candidate_id TEXT,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL,
        assignee_name TEXT NOT NULL,
        due_date TEXT,
        created_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        FOREIGN KEY(program_id) REFERENCES work_program(program_id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_id) REFERENCES improve_candidate(candidate_id) ON DELETE SET NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS accountability_assignment (
        assignment_id TEXT PRIMARY KEY,
        result_id TEXT,
        candidate_id TEXT,
        node_id TEXT,
        role_code TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        FOREIGN KEY(result_id) REFERENCES check_result(result_id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_id) REFERENCES improve_candidate(candidate_id) ON DELETE CASCADE,
        FOREIGN KEY(node_id) REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS accountability_party (
        party_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        party_type TEXT NOT NULL,
        party_status TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS accountability_scope_assignment (
        assignment_id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        role_code TEXT NOT NULL,
        party_id TEXT NOT NULL,
        assignment_status TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        UNIQUE(scope_type, scope_id, role_code, party_id),
        FOREIGN KEY(party_id) REFERENCES accountability_party(party_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS verification_evidence (
        verification_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        task_id TEXT,
        result_id TEXT,
        outcome TEXT NOT NULL,
        evidence_note TEXT NOT NULL,
        follow_up_required INTEGER NOT NULL,
        verified_by_party_id TEXT,
        verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(candidate_id) REFERENCES improve_candidate(candidate_id) ON DELETE CASCADE,
        FOREIGN KEY(task_id) REFERENCES remediation_task(task_id) ON DELETE SET NULL,
        FOREIGN KEY(result_id) REFERENCES check_result(result_id) ON DELETE SET NULL,
        FOREIGN KEY(verified_by_party_id) REFERENCES accountability_party(party_id) ON DELETE SET NULL
    )
    ''',

    '''
    CREATE TABLE IF NOT EXISTS verification_follow_up_state (
        verification_id TEXT PRIMARY KEY,
        queue_status TEXT NOT NULL,
        due_date TEXT,
        owner_party_id TEXT,
        follow_up_note TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(verification_id) REFERENCES verification_evidence(verification_id) ON DELETE CASCADE,
        FOREIGN KEY(owner_party_id) REFERENCES accountability_party(party_id) ON DELETE SET NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS trial_event (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        scenario_code TEXT NOT NULL,
        user_label TEXT NOT NULL,
        object_ref TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    ''',

    '''
    CREATE TABLE IF NOT EXISTS trial_feedback (
        feedback_id TEXT PRIMARY KEY,
        scenario_code TEXT NOT NULL,
        usefulness_score INTEGER NOT NULL,
        trust_score INTEGER NOT NULL,
        ease_score INTEGER NOT NULL,
        next_step TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS organisation_setting (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    /* One row, id = 'archived_sessions'. What the retention sweep did and
       when, so the Admin page can say when it last ran and the sweep itself
       can tell whether today's run has already happened. Kept out of
       organisation_setting because that table is a list of things a person
       sets, and nobody sets this. */
    CREATE TABLE IF NOT EXISTS retention_sweep_run (
        sweep_id TEXT PRIMARY KEY,
        last_run_at TEXT NOT NULL DEFAULT '',
        last_deleted_count INTEGER NOT NULL DEFAULT 0,
        last_outcome TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS user_preference (
        preference_key TEXT PRIMARY KEY,
        preference_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS permission_assignment (
        permission_id TEXT PRIMARY KEY,
        role_code TEXT NOT NULL,
        action_code TEXT NOT NULL,
        access_level TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(role_code, action_code)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS integration_config (
        integration_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        base_status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS audit_record (
        audit_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        action_code TEXT NOT NULL,
        object_ref TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS node_badge (
        badge_id TEXT PRIMARY KEY,
        node_type_id TEXT NOT NULL,
        badge_text TEXT NOT NULL,
        badge_shape TEXT NOT NULL,
        badge_color TEXT NOT NULL,
        icon_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(node_type_id),
        FOREIGN KEY(node_type_id) REFERENCES hierarchy_model_node_type(node_type_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS structure_diagram (
        diagram_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(model_id, name),
        FOREIGN KEY(model_id) REFERENCES hierarchy_model(model_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS structure_diagram_node (
        diagram_node_instance_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        z_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(diagram_id, node_id),
        FOREIGN KEY(diagram_id) REFERENCES structure_diagram(diagram_id) ON DELETE CASCADE,
        FOREIGN KEY(node_id) REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS structure_diagram_edge (
        diagram_edge_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        relationship_id TEXT,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_kind TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(diagram_id, source_node_id, target_node_id, edge_kind),
        FOREIGN KEY(diagram_id) REFERENCES structure_diagram(diagram_id) ON DELETE CASCADE,
        FOREIGN KEY(relationship_id) REFERENCES cross_model_relationship_instance(relationship_id) ON DELETE SET NULL,
        FOREIGN KEY(source_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE,
        FOREIGN KEY(target_node_id) REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS structure_matrix_view (
        view_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        row_node_type_id TEXT NOT NULL,
        column_node_type_id TEXT NOT NULL,
        relationship_semantic_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(model_id, name),
        FOREIGN KEY(model_id) REFERENCES hierarchy_model(model_id),
        FOREIGN KEY(row_node_type_id) REFERENCES hierarchy_model_node_type(node_type_id),
        FOREIGN KEY(column_node_type_id) REFERENCES hierarchy_model_node_type(node_type_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS structure_import_batch (
        batch_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        batch_name TEXT NOT NULL,
        source_name TEXT NOT NULL,
        import_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(model_id) REFERENCES hierarchy_model(model_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_model (
        support_domain_model_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        badge_code TEXT NOT NULL DEFAULT '',
        purpose TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_element_type (
        element_id TEXT PRIMARY KEY,
        support_domain_model_id TEXT NOT NULL,
        parent_element_id TEXT,
        badge_store_id TEXT UNIQUE,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        badge_code TEXT NOT NULL DEFAULT '',
        element_type TEXT NOT NULL DEFAULT '',
        description TEXT,
        definition TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(support_domain_model_id, name),
        FOREIGN KEY(support_domain_model_id) REFERENCES support_domain_model(support_domain_model_id) ON DELETE CASCADE,
        FOREIGN KEY(parent_element_id) REFERENCES support_domain_element_type(element_id) ON DELETE SET NULL,
        FOREIGN KEY(badge_store_id) REFERENCES badge_store(badge_store_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_element_type_property (
        property_id TEXT PRIMARY KEY,
        element_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(element_id, name),
        FOREIGN KEY(element_id) REFERENCES support_domain_element_type(element_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_badge (
        badge_id TEXT PRIMARY KEY,
        element_id TEXT NOT NULL,
        badge_text TEXT NOT NULL,
        badge_shape TEXT NOT NULL,
        badge_color TEXT NOT NULL,
        icon_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(element_id),
        FOREIGN KEY(element_id) REFERENCES support_domain_element_type(element_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_relationship (
        relationship_id TEXT PRIMARY KEY,
        support_domain_model_id TEXT NOT NULL,
        source_element_id TEXT NOT NULL,
        target_element_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL DEFAULT '',
        cardinality TEXT NOT NULL DEFAULT '',
        name TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(support_domain_model_id, source_element_id, target_element_id, relationship_type),
        FOREIGN KEY(support_domain_model_id) REFERENCES support_domain_model(support_domain_model_id) ON DELETE CASCADE,
        FOREIGN KEY(source_element_id) REFERENCES support_domain_element_type(element_id) ON DELETE CASCADE,
        FOREIGN KEY(target_element_id) REFERENCES support_domain_element_type(element_id) ON DELETE CASCADE,
        CHECK(source_element_id <> target_element_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_rule (
        support_domain_rule_id TEXT PRIMARY KEY,
        support_domain_model_id TEXT NOT NULL,
        source_element_id TEXT NOT NULL,
        target_element_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        cardinality TEXT NOT NULL,
        rule_kind TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(support_domain_model_id, source_element_id, target_element_id, relationship_type, rule_kind),
        FOREIGN KEY(support_domain_model_id) REFERENCES support_domain_model(support_domain_model_id) ON DELETE CASCADE,
        FOREIGN KEY(source_element_id) REFERENCES support_domain_element_type(element_id) ON DELETE CASCADE,
        FOREIGN KEY(target_element_id) REFERENCES support_domain_element_type(element_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_diagram (
        diagram_id TEXT PRIMARY KEY,
        support_domain_model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(support_domain_model_id) REFERENCES support_domain_model(support_domain_model_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_diagram_node (
        diagram_node_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        element_id TEXT NOT NULL,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        width REAL,
        height REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(diagram_id) REFERENCES support_domain_diagram(diagram_id) ON DELETE CASCADE,
        FOREIGN KEY(element_id) REFERENCES support_domain_element_type(element_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_diagram_edge (
        diagram_edge_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        relationship_id TEXT NOT NULL,
        source_diagram_node_id TEXT,
        target_diagram_node_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(diagram_id) REFERENCES support_domain_diagram(diagram_id) ON DELETE CASCADE,
        FOREIGN KEY(relationship_id) REFERENCES support_domain_relationship(relationship_id) ON DELETE CASCADE,
        FOREIGN KEY(source_diagram_node_id) REFERENCES support_domain_diagram_node(diagram_node_id) ON DELETE SET NULL,
        FOREIGN KEY(target_diagram_node_id) REFERENCES support_domain_diagram_node(diagram_node_id) ON DELETE SET NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_element_instance (
        instance_id TEXT PRIMARY KEY,
        support_domain_model_id TEXT NOT NULL,
        element_type_id TEXT NOT NULL,
        external_id TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(support_domain_model_id, element_type_id, name),
        FOREIGN KEY(support_domain_model_id) REFERENCES support_domain_model(support_domain_model_id) ON DELETE CASCADE,
        FOREIGN KEY(element_type_id) REFERENCES support_domain_element_type(element_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_element_instance_property (
        property_instance_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        property_type_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(instance_id, property_type_id),
        FOREIGN KEY(instance_id) REFERENCES support_domain_element_instance(instance_id) ON DELETE CASCADE,
        FOREIGN KEY(property_type_id) REFERENCES support_domain_element_type_property(property_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- Element instance relationship diagrams, one combo of four tables like the
    -- cross_model_relationship_instance_diagram* combo: the diagram, the cards
    -- placed on it (nodes), the edges drawn on it, and free shapes.
    --
    -- Diagram-only storage. It is NOT the relationship logic of PDP: element
    -- instance relationships are inherited from the element types — where
    -- element type A relates to B, every A instance relates to every B
    -- instance — and nothing reads these tables to decide that.
    CREATE TABLE IF NOT EXISTS support_domain_element_instance_relationship_diagrams (
        diagram_id TEXT PRIMARY KEY,
        support_domain_model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(support_domain_model_id) REFERENCES support_domain_model(support_domain_model_id) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE INDEX IF NOT EXISTS idx_sde_instance_rel_diagrams_model
        ON support_domain_element_instance_relationship_diagrams(support_domain_model_id)
    ''',
    '''
    -- Where a card sits on the diagram. item_id is an element type id
    -- (item_kind 'element_type'): the diagram shows one card per element type,
    -- listing its instances.
    CREATE TABLE IF NOT EXISTS support_domain_element_instance_relationship_diagram_nodes (
        diagram_node_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(diagram_id, item_id),
        FOREIGN KEY(diagram_id) REFERENCES support_domain_element_instance_relationship_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- An edge a person drew between two element instances (Diagram drag or
    -- Matrix cell); it round-trips in the Data Exchange CSV. It must follow a
    -- relationship defined between the two instances' element types, in that
    -- direction. edge_key is '<relationship_id>:<source_instance_id>:<target_instance_id>'.
    -- Removing the relationship, either instance, or the diagram removes it.
    CREATE TABLE IF NOT EXISTS support_domain_element_instance_relationship_diagram_edges (
        diagram_edge_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        edge_key TEXT NOT NULL,
        edge_style TEXT NOT NULL DEFAULT 'curved',
        sort_order INTEGER NOT NULL DEFAULT 0,
        support_domain_relationship_id TEXT NOT NULL,
        source_instance_id TEXT NOT NULL,
        target_instance_id TEXT NOT NULL,
        external_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(diagram_id, edge_key),
        FOREIGN KEY(diagram_id) REFERENCES support_domain_element_instance_relationship_diagrams(diagram_id) ON DELETE CASCADE,
        FOREIGN KEY(support_domain_relationship_id) REFERENCES support_domain_relationship(relationship_id) ON DELETE CASCADE,
        FOREIGN KEY(source_instance_id) REFERENCES support_domain_element_instance(instance_id) ON DELETE CASCADE,
        FOREIGN KEY(target_instance_id) REFERENCES support_domain_element_instance(instance_id) ON DELETE CASCADE,
        CHECK(source_instance_id <> target_instance_id)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS support_domain_element_instance_relationship_diagram_shapes (
        diagram_shape_id TEXT PRIMARY KEY,
        diagram_id TEXT NOT NULL,
        shape_kind TEXT NOT NULL,
        pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        width DOUBLE PRECISION NOT NULL DEFAULT 200,
        height DOUBLE PRECISION NOT NULL DEFAULT 120,
        text TEXT NOT NULL DEFAULT '',
        stroke_color TEXT NULL,
        text_color TEXT NULL,
        font_size DOUBLE PRECISION NULL,
        z_index INTEGER NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(diagram_id) REFERENCES support_domain_element_instance_relationship_diagrams(diagram_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- Where governance binds: the Asset Property.
    --
    -- A Rule Configuration is applicable to a *property*, not to a vocabulary.
    -- `Transformer -> Rated Capacity` is assessed by this configuration; the
    -- sibling property beside it is not, unless somebody says so here. That is
    -- the whole of it: applicability is asserted, never inherited.
    --
    -- The earlier design hung rules off the support domain element and let
    -- every member of an element type inherit them. It made one rule reach many
    -- fields cheaply, and it made the reach impossible to state exactly --
    -- which is the thing governance is for.
    CREATE TABLE IF NOT EXISTS node_instance_rule (
        property_rule_id      TEXT PRIMARY KEY,
        node_instance_id      TEXT NOT NULL,
        rule_configuration_id TEXT NOT NULL,
        applicability         TEXT NOT NULL DEFAULT 'recommended',
        notes                 TEXT NOT NULL DEFAULT '',
        status                TEXT NOT NULL DEFAULT 'active',
        created_by            TEXT NOT NULL DEFAULT 'user',
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        UNIQUE(node_instance_id, rule_configuration_id),
        FOREIGN KEY(node_instance_id)
            REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE,
        FOREIGN KEY(rule_configuration_id)
            REFERENCES rule_configuration(rule_configuration_id) ON DELETE CASCADE
    )
    ''',
    '''
    -- The approved values for one property, named one at a time.
    --
    -- Two properties may draw on the same vocabulary and approve different
    -- parts of it: Transformer Manufacturer approves four names, Switch
    -- Manufacturer approves one. A configuration that read the whole element
    -- type could not tell them apart, so the approved set is these links and
    -- nothing else.
    --
    -- Zero links where a configuration needs values is a configuration error,
    -- never an unrestricted pass.
    CREATE TABLE IF NOT EXISTS node_instance_reference_value (
        reference_link_id   TEXT PRIMARY KEY,
        node_instance_id    TEXT NOT NULL,
        element_instance_id TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'active',
        created_by          TEXT NOT NULL DEFAULT 'user',
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE(node_instance_id, element_instance_id),
        FOREIGN KEY(node_instance_id)
            REFERENCES hierarchy_model_node_instance(node_instance_id) ON DELETE CASCADE,
        FOREIGN KEY(element_instance_id)
            REFERENCES support_domain_element_instance(instance_id) ON DELETE CASCADE
    )
    ''',
    # ── Reading scoped to the file being worked on ────────────────────────────
    # A session may hold several files. Rather than thread the active file id
    # through twenty repository methods, each view correlates a row's own
    # session to that session's active file: a query that said
    # `FROM discovery_source_row` says `FROM active_source_row` instead and is
    # otherwise untouched.
    '''
    CREATE OR REPLACE VIEW active_source_row AS
        SELECT t.* FROM discovery_source_row t
        JOIN discovery_session s ON s.session_id = t.session_id
        WHERE t.source_file_id = s.active_source_file_id
    ''',
    '''
    CREATE OR REPLACE VIEW active_discovery_column AS
        SELECT t.* FROM discovery_column t
        JOIN discovery_session s ON s.session_id = t.session_id
        WHERE t.source_file_id = s.active_source_file_id
    ''',
    '''
    CREATE OR REPLACE VIEW active_source_column AS
        SELECT t.* FROM source_column t
        JOIN discovery_session s ON s.session_id = t.session_id
        WHERE t.source_file_id = s.active_source_file_id
    ''',
    '''
    CREATE OR REPLACE VIEW active_parsed_file AS
        SELECT t.* FROM discovery_parsed_file t
        JOIN discovery_session s ON s.session_id = t.session_id
        WHERE t.source_file_id = s.active_source_file_id
    ''',
    # ── Calendar-aware date validation ────────────────────────────────────────
    # A regular expression cannot answer this. `31/02/2026` has the shape of a
    # date and is not one, and neither is `2026-02-30` or `29/02/2025`; a
    # pattern that accepts the shape passes all three. Postgres knows the
    # calendar, so the question is delegated to it — `make_date` raises on a day
    # that does not exist.
    #
    # `to_date` is deliberately not used: it silently rolls `31/02/2026` over
    # into 3 March rather than rejecting it, turning a data error into a
    # plausible date.
    '''
    CREATE OR REPLACE FUNCTION pdp_is_real_date(y int, m int, d int) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE AS $fn$
    BEGIN
        PERFORM make_date(y, m, d);
        RETURN TRUE;
    EXCEPTION WHEN others THEN
        RETURN FALSE;
    END;
    $fn$
    ''',
    # The format matters as much as the calendar. `04/28/2026` is a real date
    # read month-first and nonsense read day-first, so a column has to say which
    # convention it uses; assuming one silently marked every US-style date
    # invalid. `any` accepts a value that is a real date under either reading,
    # which is the honest answer for a column that has not committed.
    '''
    CREATE OR REPLACE FUNCTION pdp_is_valid_date(value text, fmt text DEFAULT 'any')
    RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
    DECLARE
        trimmed text := btrim(coalesce(value, ''));
        style   text := lower(coalesce(nullif(btrim(fmt), ''), 'any'));
        norm    text;
        parts   text[];
        a int; b int; c int;
    BEGIN
        -- A blank is completeness's business, not validity's.
        IF trimmed = '' THEN RETURN TRUE; END IF;
        norm := replace(replace(trimmed, '/', '-'), '.', '-');
        norm := split_part(norm, ' ', 1);          -- drop any time part
        parts := string_to_array(norm, '-');

        IF array_length(parts, 1) = 1 THEN
            IF parts[1] !~ '^[0-9]{4}$' THEN RETURN FALSE; END IF;
            RETURN style IN ('any', 'year');
        END IF;

        IF array_length(parts, 1) = 2 THEN
            IF style NOT IN ('any', 'month_year') THEN RETURN FALSE; END IF;
            IF parts[1] ~ '^[0-9]{4}$' AND parts[2] ~ '^[0-9]{1,2}$' THEN
                RETURN pdp_is_real_date(parts[1]::int, parts[2]::int, 1);
            END IF;
            IF parts[2] ~ '^[0-9]{4}$' AND parts[1] ~ '^[0-9]{1,2}$' THEN
                RETURN pdp_is_real_date(parts[2]::int, parts[1]::int, 1);
            END IF;
            RETURN FALSE;
        END IF;

        IF array_length(parts, 1) <> 3 THEN RETURN FALSE; END IF;
        IF parts[1] !~ '^[0-9]{1,4}$' OR parts[2] !~ '^[0-9]{1,2}$'
           OR parts[3] !~ '^[0-9]{1,4}$' THEN
            RETURN FALSE;
        END IF;
        a := parts[1]::int; b := parts[2]::int; c := parts[3]::int;

        IF style = 'iso' THEN
            RETURN parts[1] ~ '^[0-9]{4}$' AND pdp_is_real_date(a, b, c);
        ELSIF style = 'dmy' THEN
            RETURN parts[3] ~ '^[0-9]{4}$' AND pdp_is_real_date(c, b, a);
        ELSIF style = 'mdy' THEN
            RETURN parts[3] ~ '^[0-9]{4}$' AND pdp_is_real_date(c, a, b);
        ELSIF style IN ('month_year', 'year') THEN
            RETURN FALSE;
        END IF;

        -- `any`: a real date under whichever convention fits.
        IF parts[1] ~ '^[0-9]{4}$' AND pdp_is_real_date(a, b, c) THEN RETURN TRUE; END IF;
        IF parts[3] ~ '^[0-9]{4}$' AND pdp_is_real_date(c, b, a) THEN RETURN TRUE; END IF;
        IF parts[3] ~ '^[0-9]{4}$' AND pdp_is_real_date(c, a, b) THEN RETURN TRUE; END IF;
        RETURN FALSE;
    END;
    $fn$
    ''',
    # ── Users and roles (PDP-251) ─────────────────────────────────────────
    '''
    CREATE TABLE IF NOT EXISTS app_user (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        -- Argon2id hash; empty until the person has accepted their invitation.
        password_hash TEXT NOT NULL DEFAULT '',
        -- INVITED, ACTIVE or INACTIVE.
        status TEXT NOT NULL DEFAULT 'INVITED',
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        failed_login_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT NOT NULL DEFAULT '',
        last_login_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS user_role (
        user_id TEXT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
        role_code TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        assigned_by TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (user_id, role_code)
    )
    ''',
    '''
    CREATE TABLE IF NOT EXISTS user_token (
        token_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
        -- invite or reset. Only the SHA-256 of the link's secret is kept.
        kind TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT ''
    )
    ''',
    '''
    CREATE INDEX IF NOT EXISTS user_token_user_kind_idx ON user_token (user_id, kind)
    ''',

)


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


class _DatabaseConnection:
    """Thin psycopg2 connection wrapper that exposes the SQLite-compatible execute() interface."""

    def __init__(self, conn: psycopg2.extensions.connection) -> None:
        self._conn = conn

    def execute(self, sql: str, params=None):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return cur

    def scalar(self, sql: str, params=None):
        """
        The single value a one-column query asks for.

        Rows here are dictionaries, not tuples, so the familiar
        `execute(...).fetchone()[0]` does not read the first column — it looks
        up the *key* `0`, which no row has, and raises `KeyError: 0`. That
        failure is a 500 from a line that reads like it cannot fail, so the
        safe spelling lives here rather than being remembered at each call.

        Returns None when the query selected no rows; an aggregate such as
        COUNT(*) always returns one.
        """
        row = self.execute(sql, params).fetchone()
        if row is None:
            return None
        return next(iter(row.values()))

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


def connect(db_url: str) -> _DatabaseConnection:
    conn = psycopg2.connect(db_url)
    return _DatabaseConnection(conn)


@contextmanager
def get_connection(db_url: str) -> Iterator[_DatabaseConnection]:
    connection = connect(db_url)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def check_connection(db_url: str) -> bool:
    """Return True if a PostgreSQL connection can be established."""
    try:
        with get_connection(db_url) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


_DISCOVER_SESSION_MIGRATION_COLUMNS: tuple[tuple[str, str], ...] = (
    # (column_name, column_definition) — safe to run multiple times via IF NOT EXISTS workaround
    ('description', "TEXT NOT NULL DEFAULT ''"),
    # When the session was archived. Empty means it is not archived: the
    # retention sweep measures the countdown from this, so it is also what
    # Restore clears.
    ('archived_at', "TEXT NOT NULL DEFAULT ''"),
)

#: (table, column, definition) for columns added to a table that already exists
#: somewhere. CREATE TABLE only builds a new database; an existing one needs the
#: column added, guarded the same way as above.
_TABLE_MIGRATION_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ('rule_definition', 'code', "TEXT NOT NULL DEFAULT ''"),
    # What kind of execution a rule needs — column, row, cross-table and so on.
    # Distinct from `scope`, which is how the engine binds the check. Empty on
    # rules written before it existed; the service derives one from the check.
    ('hierarchy_model_node_type', 'is_property', "BOOLEAN NOT NULL DEFAULT FALSE"),
    ('rule_definition', 'execution_scope', "TEXT NOT NULL DEFAULT ''"),
    ('rule_definition_version', 'execution_scope', "TEXT NOT NULL DEFAULT ''"),
    # Which library rule, at which version, an attached rule was copied from.
    # Without the version a result cites a rule that may since have changed.
    ('governed_rule', 'source_rule_version', "TEXT NOT NULL DEFAULT ''"),
    # Which rule *configuration* a governed attachment came from, and at which
    # version. The definition alone says what kind of check ran; the
    # configuration says what it ran against, and that is the half a result
    # needs to be re-read correctly a year later.
    ('governed_rule', 'source_rule_configuration_id', "TEXT NOT NULL DEFAULT ''"),
    ('governed_rule', 'source_rule_configuration_version', "TEXT NOT NULL DEFAULT ''"),
    # The run a finding belongs to. Empty on rows written before runs existed;
    # those are read as the only run that file has.
    ('discovery_quality_check', 'quality_run_id', "TEXT NOT NULL DEFAULT ''"),
    ('rule_definition', 'dimension', "TEXT NOT NULL DEFAULT 'validity'"),
    ('rule_definition', 'data_type', "TEXT NOT NULL DEFAULT 'any'"),
    ('rule_definition', 'rationale', "TEXT NOT NULL DEFAULT ''"),
    ('rule_definition', 'reference', "TEXT NOT NULL DEFAULT ''"),
    ('rule_definition', 'message_template', "TEXT NOT NULL DEFAULT ''"),
    ('rule_definition', 'examples_json', "TEXT NOT NULL DEFAULT '{}'"),
    ('rule_definition', 'owner', "TEXT NOT NULL DEFAULT ''"),
    ('rule_definition', 'version', "INTEGER NOT NULL DEFAULT 1"),
    ('rule_definition', 'updated_by', "TEXT NOT NULL DEFAULT 'user'"),
    # Which library rule a session rule was attached from, so the attachment can
    # be found again, shown as ticked, and detached.
    ('governed_rule', 'source_rule_definition_id', "TEXT NOT NULL DEFAULT ''"),
    # One upload can hold several tables — a workbook's sheets, a CSV's stacked
    # blocks — and each becomes a source of its own. These say which upload a
    # source came out of, so the Import step can show the files a person
    # actually chose rather than the tables they turned into.
    ('discovery_source_file', 'origin_filename', "TEXT NOT NULL DEFAULT ''"),
    ('discovery_source_file', 'sheet_name', "TEXT NOT NULL DEFAULT ''"),
    # Which relationship type carries governance meaning — see the comment on
    # cross_model_relationship_type above.
    ('cross_model_relationship_type', 'governance_role', "TEXT NULL"),
    # Which values of its vocabulary a rule configuration approves. Empty is
    # "the whole vocabulary", so rules written before the subset existed keep
    # meaning exactly what they meant.
    ('rule_configuration', 'reference_value_ids_json', "TEXT NOT NULL DEFAULT '[]'"),
    ('rule_configuration_version', 'reference_value_ids_json', "TEXT NOT NULL DEFAULT '[]'"),
)

def initialize_database(db_url: str) -> None:
    with get_connection(db_url) as connection:
        for statement in SCHEMA_STATEMENTS:
            connection.execute(statement)
        # ── W2-DWS-FEATURE-01: safe column additions on discovery_session ──────
        # PostgreSQL does not support IF NOT EXISTS for ADD COLUMN directly (pre-PG 9.6).
        # We check information_schema to guard each column addition idempotently.
        for col_name, col_def in _DISCOVER_SESSION_MIGRATION_COLUMNS:
            existing = connection.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'discovery_session' AND column_name = %s
                """,
                (col_name,),
            ).fetchone()
            if existing is None:
                connection.execute(
                    f'ALTER TABLE discovery_session ADD COLUMN {col_name} {col_def}'
                )
        for table, col_name, col_def in _TABLE_MIGRATION_COLUMNS:
            existing = connection.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_name = %s AND column_name = %s
                """,
                (table, col_name),
            ).fetchone()
            if existing is None:
                connection.execute(f'ALTER TABLE {table} ADD COLUMN {col_name} {col_def}')


def reset_database(db_url: str) -> None:
    """Drop and recreate the entire public schema, then re-initialise."""
    with get_connection(db_url) as connection:
        connection.execute("DROP SCHEMA public CASCADE")
        connection.execute("CREATE SCHEMA public")
    initialize_database(db_url)
