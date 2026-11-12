from __future__ import annotations

from typing import Any


class ModelSchemaRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def ensure_schema(self) -> None:
        self._create_tables()
        self._migrate_columns()
        self._create_indexes()
        self._seed_definitions()
        self._db.commit()

    def _create_tables(self) -> None:
        pass

    def _migrate_columns(self) -> None:
        self._migrate_badge_store_columns()
        self._migrate_support_domain_model_columns()
        self._migrate_support_domain_element_columns()
        self._migrate_support_domain_relationship_columns()

    def _migrate_badge_store_columns(self) -> None:
        if not self._table_exists("badge_store"):
            return
        cols = self._get_column_names("badge_store")
        if "badge_content_type" not in cols:
            self._db.execute(
                "alter table badge_store add column badge_content_type text not null default 'text'"
            )

    def _migrate_support_domain_model_columns(self) -> None:
        if not self._table_exists("support_domain_model"):
            return

        cols = self._get_column_names("support_domain_model")
        if "badge_code" not in cols:
            self._db.execute("alter table support_domain_model add column badge_code text not null default ''")
        if "description" not in cols:
            self._db.execute("alter table support_domain_model add column description text")
        if "sort_order" not in cols:
            self._db.execute("alter table support_domain_model add column sort_order integer not null default 0")

    def _migrate_support_domain_element_columns(self) -> None:
        if not self._table_exists("support_domain_element_type"):
            return

        cols = self._get_column_names("support_domain_element_type")
        if "parent_element_id" not in cols:
            self._db.execute("alter table support_domain_element_type add column parent_element_id text")
        if "display_name" not in cols:
            self._db.execute("alter table support_domain_element_type add column display_name text not null default ''")
        if "badge_code" not in cols:
            self._db.execute("alter table support_domain_element_type add column badge_code text not null default ''")
        if "element_type" not in cols:
            self._db.execute("alter table support_domain_element_type add column element_type text not null default ''")
        if "definition" not in cols:
            self._db.execute("alter table support_domain_element_type add column definition text")
        if "sort_order" not in cols:
            self._db.execute("alter table support_domain_element_type add column sort_order integer not null default 0")

    def _migrate_support_domain_relationship_columns(self) -> None:
        if not self._table_exists("support_domain_relationship"):
            return

        cols = self._get_column_names("support_domain_relationship")
        if "relationship_type" not in cols:
            self._db.execute(
                "alter table support_domain_relationship add column relationship_type text not null default ''"
            )
        if "cardinality" not in cols:
            self._db.execute(
                "alter table support_domain_relationship add column cardinality text not null default ''"
            )
        if "name" not in cols:
            self._db.execute("alter table support_domain_relationship add column name text")
        if "description" not in cols:
            self._db.execute("alter table support_domain_relationship add column description text")

    def _create_indexes(self) -> None:
        node_type_columns = self._get_column_names("hierarchy_model_node_type")
        if {"model_id", "parent_node_type_id", "sort_order", "name"}.issubset(node_type_columns):
            self._db.execute(
                """
                create index if not exists ix_hierarchy_model_node_type_model
                on hierarchy_model_node_type(model_id, parent_node_type_id, sort_order, name)
                """
            )

        structural_rule_columns = self._get_column_names("structural_rule")
        if {"model_id", "parent_node_id", "child_node_id"}.issubset(structural_rule_columns):
            self._db.execute(
                """
                create index if not exists ix_structural_rule_model
                on structural_rule(model_id, parent_node_id, child_node_id)
                """
            )

        support_domain_element_columns = self._get_column_names("support_domain_element_type")
        if {"support_domain_model_id", "name"}.issubset(support_domain_element_columns):
            self._db.execute(
                """
                create index if not exists ix_support_domain_element_model
                on support_domain_element_type(support_domain_model_id, name)
                """
            )

        support_domain_relationship_columns = self._get_column_names("support_domain_relationship")
        if {"support_domain_model_id", "source_element_id", "target_element_id"}.issubset(
            support_domain_relationship_columns
        ):
            self._db.execute(
                """
                create index if not exists ix_support_domain_relationship_model
                on support_domain_relationship(
                    support_domain_model_id,
                    source_element_id,
                    target_element_id
                )
                """
            )

    def _seed_definitions(self) -> None:
        # -- Support Domain Models --
        self._db.execute(
            "insert into support_domain_model values "
            "('sdm_governance_authority','Governance Authority','GovA',"
            "'Support Domain model for governance authority and role semantics.',"
            "'Governance authority definition model.','active',10,"
            "'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing"
        )
        self._db.execute(
            "insert into support_domain_model values "
            "('sdm_data_quality','Data Quality','DQ',"
            "'Support Domain model for data quality rules, thresholds, outcomes, and categories.',"
            "'Data quality definition model.','active',20,"
            "'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing"
        )
        # -- Support Domain Elements --
        elements = [
            ("sde_gova_root", "sdm_governance_authority", None, "Governance Authority", "GovA", "model_root",
             "Governance authority model root.", "Top-level Governance Authority element type.", "active", 10),
            ("sde_gova_authority", "sdm_governance_authority", "sde_gova_root", "Authority", "GA", "authority",
             "Authority element type.", "Authority definition within Governance Authority model.", "active", 20),
            ("sde_gova_role", "sdm_governance_authority", "sde_gova_root", "Role", "GR", "role",
             "Role element type.", "Role definition within Governance Authority model.", "active", 30),
            ("sde_dq_root", "sdm_data_quality", None, "Data Quality", "DQ", "model_root",
             "Data Quality model root.", "Top-level Data Quality element type.", "active", 10),
            ("sde_dq_rule", "sdm_data_quality", "sde_dq_root", "DQ Rule", "DQR", "dq_rule",
             "Data quality rule element type.", "Governed DQ rule definition.", "active", 20),
            ("sde_dq_threshold", "sdm_data_quality", "sde_dq_root", "DQ Threshold", "DQT", "dq_threshold",
             "Data quality threshold element type.", "Threshold used by a DQ Rule.", "active", 30),
            ("sde_dq_outcome", "sdm_data_quality", "sde_dq_root", "DQ Outcome", "DQO", "dq_outcome",
             "Data quality outcome element type.", "Outcome produced by a DQ Rule.", "active", 40),
            ("sde_dq_category", "sdm_data_quality", "sde_dq_root", "DQ Category", "DQC", "dq_category",
             "Data quality category element type.", "Category used to group DQ Rules.", "active", 50),
        ]
        for el in elements:
            self._db.execute(
                "insert into support_domain_element_type"
                "(element_id,support_domain_model_id,parent_element_id,name,display_name,badge_code,element_type,"
                "description,definition,status,sort_order,created_at,updated_at) values "
                "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing",
                (*el[:4], el[3], *el[4:]),
            )
        # -- Support Domain Badges --
        badges = [
            ("sdbg_gova_root", "sde_gova_root", "GovA", "rounded_square", "#1E88E5", "gavel"),
            ("sdbg_gova_authority", "sde_gova_authority", "GA", "circle", "#3949AB", "policy"),
            ("sdbg_gova_role", "sde_gova_role", "GR", "rounded_square", "#00897B", "groups"),
            ("sdbg_dq_root", "sde_dq_root", "DQ", "rounded_square", "#5E35B1", "monitoring"),
            ("sdbg_dq_rule", "sde_dq_rule", "DQR", "hexagon", "#E53935", "rule"),
            ("sdbg_dq_threshold", "sde_dq_threshold", "DQT", "circle", "#FB8C00", "tune"),
            ("sdbg_dq_outcome", "sde_dq_outcome", "DQO", "diamond", "#F4511E", "warning"),
            ("sdbg_dq_category", "sde_dq_category", "DQC", "circle", "#039BE5", "category"),
        ]
        for b in badges:
            self._db.execute(
                "insert into support_domain_badge"
                "(badge_id,element_id,badge_text,badge_shape,badge_color,icon_name,created_at,updated_at) values "
                "(%s, %s, %s, %s, %s, %s,'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing",
                b,
            )
        # -- Support Domain Relationships --
        relationships = [
            ("sdr_gova_01", "sdm_governance_authority", "sde_gova_root", "sde_gova_authority",
             "contains", "1:n", "contains", "Governance Authority contains Authority.", "active"),
            ("sdr_gova_02", "sdm_governance_authority", "sde_gova_authority", "sde_gova_role",
             "contains", "1:n", "contains", "Authority contains Role.", "active"),
            ("sdr_dq_01", "sdm_data_quality", "sde_dq_category", "sde_dq_rule",
             "groups", "1:n", "groups", "DQ Category groups DQ Rule.", "active"),
            ("sdr_dq_02", "sdm_data_quality", "sde_dq_rule", "sde_dq_threshold",
             "uses", "1:1", "uses", "DQ Rule uses DQ Threshold.", "active"),
            ("sdr_dq_03", "sdm_data_quality", "sde_dq_rule", "sde_dq_outcome",
             "produces", "1:n", "produces", "DQ Rule produces DQ Outcome.", "active"),
        ]
        for r in relationships:
            self._db.execute(
                "insert into support_domain_relationship"
                "(relationship_id,support_domain_model_id,source_element_id,target_element_id,"
                "relationship_type,cardinality,name,description,status,created_at,updated_at) values "
                "(%s, %s, %s, %s, %s, %s, %s, %s, %s,'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing",
                r,
            )
        # -- Support Domain Rules --
        rules = [
            ("sdru_gova_01", "sdm_governance_authority", "sde_gova_authority", "sde_gova_role",
             "contains", "1:n", "allowed_relationship", "Authority may contain Role.", "active"),
            ("sdru_dq_01", "sdm_data_quality", "sde_dq_category", "sde_dq_rule",
             "groups", "1:n", "allowed_relationship", "DQ Category may group DQ Rule.", "active"),
            ("sdru_dq_02", "sdm_data_quality", "sde_dq_rule", "sde_dq_threshold",
             "uses", "1:1", "allowed_relationship", "DQ Rule may use one DQ Threshold.", "active"),
            ("sdru_dq_03", "sdm_data_quality", "sde_dq_rule", "sde_dq_outcome",
             "produces", "1:n", "allowed_relationship", "DQ Rule may produce DQ Outcome records.", "active"),
        ]
        for r in rules:
            self._db.execute(
                "insert into support_domain_rule"
                "(support_domain_rule_id,support_domain_model_id,source_element_id,target_element_id,"
                "relationship_type,cardinality,rule_kind,description,status,created_at,updated_at) values "
                "(%s, %s, %s, %s, %s, %s, %s, %s, %s,'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing",
                r,
            )
        # -- Support Domain Diagrams --
        self._db.execute(
            "insert into support_domain_diagram values "
            "('sdd_gova','sdm_governance_authority','Governance Authority Diagram',"
            "'Projection diagram for Governance Authority model.','active',"
            "'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing"
        )
        self._db.execute(
            "insert into support_domain_diagram values "
            "('sdd_dq','sdm_data_quality','Data Quality Diagram',"
            "'Projection diagram for Data Quality model.','active',"
            "'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing"
        )
        # -- Support Domain Diagram Nodes --
        diagram_nodes = [
            ("sddn_gova_root", "sdd_gova", "sde_gova_root", 80, 80, 180, 60),
            ("sddn_gova_authority", "sdd_gova", "sde_gova_authority", 340, 80, 180, 60),
            ("sddn_gova_role", "sdd_gova", "sde_gova_role", 600, 80, 180, 60),
            ("sddn_dq_root", "sdd_dq", "sde_dq_root", 80, 80, 180, 60),
            ("sddn_dq_category", "sdd_dq", "sde_dq_category", 340, 60, 180, 60),
            ("sddn_dq_rule", "sdd_dq", "sde_dq_rule", 340, 180, 180, 60),
            ("sddn_dq_threshold", "sdd_dq", "sde_dq_threshold", 620, 140, 180, 60),
            ("sddn_dq_outcome", "sdd_dq", "sde_dq_outcome", 620, 260, 180, 60),
        ]
        for n in diagram_nodes:
            self._db.execute(
                "insert into support_domain_diagram_node"
                "(diagram_node_id,diagram_id,element_id,x,y,width,height,created_at,updated_at) values "
                "(%s, %s, %s, %s, %s, %s, %s,'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing",
                n,
            )
        # -- Support Domain Diagram Edges --
        diagram_edges = [
            ("sdde_gova_01", "sdd_gova", "sdr_gova_01", "sddn_gova_root", "sddn_gova_authority"),
            ("sdde_gova_02", "sdd_gova", "sdr_gova_02", "sddn_gova_authority", "sddn_gova_role"),
            ("sdde_dq_01", "sdd_dq", "sdr_dq_01", "sddn_dq_category", "sddn_dq_rule"),
            ("sdde_dq_02", "sdd_dq", "sdr_dq_02", "sddn_dq_rule", "sddn_dq_threshold"),
            ("sdde_dq_03", "sdd_dq", "sdr_dq_03", "sddn_dq_rule", "sddn_dq_outcome"),
        ]
        for e in diagram_edges:
            self._db.execute(
                "insert into support_domain_diagram_edge"
                "(diagram_edge_id,diagram_id,relationship_id,source_diagram_node_id,target_diagram_node_id,"
                "created_at,updated_at) values "
                "(%s, %s, %s, %s, %s,'2026-04-16T00:00:00+00:00','2026-04-16T00:00:00+00:00') on conflict do nothing",
                e,
            )

    def _table_exists(self, table_name: str) -> bool:
        row = self._db.execute(
            """
            select table_name
            from information_schema.tables
            where table_schema = 'public' and table_name = %s
            """,
            (table_name,),
        ).fetchone()
        return row is not None

    def _get_column_names(self, table_name: str) -> set[str]:
        if not self._table_exists(table_name):
            return set()

        rows = self._db.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'public' and table_name = %s
            """,
            (table_name,),
        ).fetchall()
        return {str(row["column_name"]) for row in rows}
