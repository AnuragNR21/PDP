from __future__ import annotations

from typing import Any
from uuid import uuid4

from shared.query_builders.badge_query_helpers import (
    badge_coalesce_text,
    badge_join,
    badge_select_columns,
)
from shared.query_builders.cross_model_impact_helpers import (
    delete_cross_model_relationships,
    list_cross_model_relationship_impacts,
)
from shared.model_config import HIERARCHY_MODEL
from ..domain.badge_constants import BadgeOwnerType

_BADGE_OWNER_TYPE = BadgeOwnerType.HIERARCHY_NODE


class HierarchyModelNodeTypeRepo:
    def __init__(self, db: Any) -> None:
        self._db = db

    def list_nodes(self, *, model_id: str) -> list[dict]:
        rows = self._db.execute(
            f"""
            select
                sn.node_type_id as node_id,
                sn.model_id,
                sn.parent_node_type_id as parent_node_id,
                p.name as parent_node_name,
                sn.name,
                sn.display_name,
                {badge_coalesce_text()} as badge,
                sn.description,
                sn.is_recursive,
                sn.is_property,
                sn.sort_order,
                sn.status,
                sn.created_at,
                sn.updated_at,
                {badge_select_columns()}
            from hierarchy_model_node_type sn
            left join hierarchy_model_node_type p on p.node_type_id = sn.parent_node_type_id
            {badge_join('sn.node_type_id', _BADGE_OWNER_TYPE)}
            where sn.model_id = %s
            order by coalesce(sn.parent_node_type_id, ''), sn.sort_order, sn.name
            """,
            (model_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_node(self, node_id: str) -> dict | None:
        row = self._db.execute(
            f"""
            select
                sn.node_type_id as node_id,
                sn.model_id,
                sn.parent_node_type_id as parent_node_id,
                p.name as parent_node_name,
                sn.name,
                sn.display_name,
                {badge_coalesce_text()} as badge,
                sn.description,
                sn.is_recursive,
                sn.is_property,
                sn.sort_order,
                sn.status,
                sn.created_at,
                sn.updated_at,
                {badge_select_columns()}
            from hierarchy_model_node_type sn
            left join hierarchy_model_node_type p on p.node_type_id = sn.parent_node_type_id
            {badge_join('sn.node_type_id', _BADGE_OWNER_TYPE)}
            where sn.node_type_id = %s
            """,
            (node_id,),
        ).fetchone()
        return dict(row) if row else None

    def insert_node(self, payload: dict) -> dict:
        node_id = payload.get("node_id") or str(uuid4())
        self._db.execute(
            """
            insert into hierarchy_model_node_type (
                node_type_id,
                model_id,
                parent_node_type_id,
                name,
                display_name,
                description,
                is_recursive,
                is_property,
                sort_order,
                status,
                created_at,
                updated_at
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, current_timestamp, current_timestamp)
            """,
            (
                node_id,
                payload["model_id"],
                payload.get("parent_node_id"),
                payload["name"],
                payload.get("display_name", ""),
                payload.get("description", ""),
                payload.get("is_recursive", False),
                payload.get("is_property", False),
                payload.get("sort_order", 0),
                payload["status"],
            ),
        )
        self._db.commit()
        return self.get_node(node_id)

    def update_node(self, node_id: str, payload: dict) -> dict:
        self._db.execute(
            """
            update hierarchy_model_node_type
            set model_id = %s, parent_node_type_id = %s, name = %s,
                display_name = %s, description = %s, is_recursive = %s, is_property = %s,
                sort_order = %s, status = %s, updated_at = current_timestamp
            where node_type_id = %s
            """,
            (
                payload["model_id"],
                payload.get("parent_node_id"),
                payload["name"],
                payload.get("display_name", ""),
                payload.get("description", ""),
                payload.get("is_recursive", False),
                payload.get("is_property", False),
                payload.get("sort_order", 0),
                payload["status"],
                node_id,
            ),
        )
        self._db.commit()
        return self.get_node(node_id)

    def delete_node(self, node_id: str) -> None:
        self._db.execute("delete from hierarchy_model_node_type where node_type_id = %s", (node_id,))
        self._db.commit()

    def delete_nodes_for_model(self, model_id: str) -> None:
        self._db.execute("delete from hierarchy_model_node_type where model_id = %s", (model_id,))
        self._db.commit()

    def count_roots(self, model_id: str, *, excluding_node_id: str | None = None) -> int:
        sql = "select count(*) from hierarchy_model_node_type where model_id = %s and parent_node_type_id is null"
        params: list[str] = [model_id]
        if excluding_node_id:
            sql += " and node_type_id <> %s"
            params.append(excluding_node_id)
        return int(self._db.execute(sql, tuple(params)).fetchone()["count"])

    def list_descendant_ids(self, node_id: str) -> list[str]:
        rows = self._db.execute(
            """
            with recursive descendants(node_id) as (
                select node_type_id as node_id from hierarchy_model_node_type where node_type_id = %s
                union all
                select sn.node_type_id as node_id from hierarchy_model_node_type sn
                join descendants d on sn.parent_node_type_id = d.node_id
            )
            select node_id from descendants
            """,
            (node_id,),
        ).fetchall()
        return [str(row['node_id']) for row in rows]

    def reorder_node(
        self,
        node_id: str,
        new_parent_node_id: str | None,
        position: int,
        reparent_plan: list[dict] | None = None,
    ) -> dict:
        """Persist a governed reorder/reparent of a node type.

        Updates parent_node_id, renumbers all sibling sort_orders, re-parents any affected
        Structure Workspace node instances per ``reparent_plan``, and writes an audit record —
        all in a single transaction.
        """
        node = self.get_node(node_id)
        model_id = node["model_id"]

        # Fetch sibling IDs at the target parent, excluding the moved node, in display order.
        if new_parent_node_id is not None:
            sibling_rows = self._db.execute(
                """
                select node_type_id as node_id from hierarchy_model_node_type
                where model_id = %s and parent_node_type_id = %s and node_type_id != %s
                order by sort_order, name
                """,
                (model_id, new_parent_node_id, node_id),
            ).fetchall()
        else:
            sibling_rows = self._db.execute(
                """
                select node_type_id as node_id from hierarchy_model_node_type
                where model_id = %s and parent_node_type_id is null and node_type_id != %s
                order by sort_order, name
                """,
                (model_id, node_id),
            ).fetchall()

        sibling_ids: list[str] = [str(r["node_id"]) for r in sibling_rows]
        clamped = max(0, min(position, len(sibling_ids)))
        ordered = sibling_ids[:clamped] + [node_id] + sibling_ids[clamped:]

        # Update parent and renumber all affected nodes in a single transaction.
        self._db.execute(
            "update hierarchy_model_node_type set parent_node_type_id = %s, updated_at = current_timestamp where node_type_id = %s",
            (new_parent_node_id, node_id),
        )
        for sort_index, nid in enumerate(ordered):
            self._db.execute(
                "update hierarchy_model_node_type set sort_order = %s, updated_at = current_timestamp where node_type_id = %s",
                (sort_index, nid),
            )

        # Re-parent affected Structure Workspace node instances so they stay consistent
        # with the updated type hierarchy (same transaction; instance IDs are preserved).
        migrated = 0
        for move in reparent_plan or []:
            self._db.execute(
                "update hierarchy_model_node_instance set parent_node_id = %s, updated_at = current_timestamp where node_instance_id = %s",
                (move.get("new_parent_instance_id"), move["instance_id"]),
            )
            migrated += 1

        old_parent = node.get("parent_node_id")
        detail = (
            f"Reordered node '{node['name']}' (id={node_id}): "
            f"parent {old_parent!r} → {new_parent_node_id!r}, position {clamped} of {len(ordered)}, "
            f"re-parented {migrated} affected node instance(s)."
        )
        self._db.execute(
            """
            insert into audit_record (audit_id, category, action_code, object_ref, actor_label, detail, created_at)
            values (%s, %s, %s, %s, %s, %s, current_timestamp)
            """,
            (f"audit_{uuid4().hex[:12]}", "model_definition", "hierarchy_node_reorder", node_id, "system", detail),
        )

        self._db.commit()
        return self.get_node(node_id)

    def get_delete_impact(self, node_id: str) -> dict:
        """Return dependency preview for a governed delete of this node type.

        Returns descendants, hierarchy rules, and Structure Workspace instances
        affected by deleting this node type.
        """
        descendant_ids = self.list_descendant_ids(node_id)  # includes node_id itself

        child_rows = self._db.execute(
            "select node_type_id as node_id, name from hierarchy_model_node_type where parent_node_type_id = %s order by name",
            (node_id,),
        ).fetchall()

        if descendant_ids:
            placeholders = ",".join(["%s"] * len(descendant_ids))
            rule_rows = self._db.execute(
                f"""
                select distinct sr.rule_id, sr.relationship_kind,
                    p.name as parent_name, c.name as child_name
                from structural_rule sr
                join hierarchy_model_node_type p on p.node_type_id = sr.parent_node_type_id
                join hierarchy_model_node_type c on c.node_type_id = sr.child_node_type_id
                where sr.parent_node_type_id in ({placeholders})
                   or sr.child_node_type_id in ({placeholders})
                order by p.name, c.name
                """,
                tuple(descendant_ids + descendant_ids),
            ).fetchall()

            instance_rows = self._db.execute(
                f"""
                with recursive affected_instances(node_instance_id) as (
                    select node_instance_id
                    from hierarchy_model_node_instance
                    where node_type_id in ({placeholders})
                    union
                    select child.node_instance_id
                    from hierarchy_model_node_instance child
                    join affected_instances parent on parent.node_instance_id = child.parent_node_id
                ),
                lineage as (
                    select
                        affected.node_instance_id as affected_instance_id,
                        instance.node_instance_id,
                        instance.parent_node_id,
                        instance.name,
                        0 as depth
                    from affected_instances affected
                    join hierarchy_model_node_instance instance
                      on instance.node_instance_id = affected.node_instance_id
                    union all
                    select
                        lineage.affected_instance_id,
                        parent.node_instance_id,
                        parent.parent_node_id,
                        parent.name,
                        lineage.depth + 1
                    from lineage
                    join hierarchy_model_node_instance parent
                      on parent.node_instance_id = lineage.parent_node_id
                )
                select
                    instance.node_instance_id as instance_id,
                    instance.node_type_id as node_id,
                    instance.parent_node_id,
                    instance.name as instance_name,
                    node_type.name as node_name,
                    string_agg(lineage.name, ' -> ' order by lineage.depth desc) as instance_path
                from affected_instances affected
                join hierarchy_model_node_instance instance
                  on instance.node_instance_id = affected.node_instance_id
                join hierarchy_model_node_type node_type
                  on node_type.node_type_id = instance.node_type_id
                join lineage on lineage.affected_instance_id = affected.node_instance_id
                group by
                    instance.node_instance_id,
                    instance.node_type_id,
                    instance.parent_node_id,
                    instance.name,
                    node_type.name
                order by instance_path
                """,
                tuple(descendant_ids),
            ).fetchall()

            affected_instance_ids_query = f"""
                with recursive affected_instances(node_instance_id) as (
                    select node_instance_id
                    from hierarchy_model_node_instance
                    where node_type_id in ({placeholders})
                    union
                    select child.node_instance_id
                    from hierarchy_model_node_instance child
                    join affected_instances parent on parent.node_instance_id = child.parent_node_id
                )
                select node_instance_id from affected_instances
            """
            cross_model_relationship_rows = list_cross_model_relationship_impacts(
                self._db,
                instance_type=HIERARCHY_MODEL,
                instance_ids_query=affected_instance_ids_query,
                params=tuple(descendant_ids),
            )
        else:
            rule_rows = []
            instance_rows = []
            cross_model_relationship_rows = []

        return {
            "node_id": node_id,
            "descendant_count": len(descendant_ids) - 1,  # exclude the node itself
            "child_nodes": [{"node_id": str(r["node_id"]), "name": str(r["name"])} for r in child_rows],
            "affected_rules": [
                {
                    "rule_id": str(r["rule_id"]),
                    "parent_name": str(r["parent_name"]),
                    "child_name": str(r["child_name"]),
                    "relationship_kind": str(r["relationship_kind"]),
                }
                for r in rule_rows
            ],
            "instance_count": len(instance_rows),
            "node_instances": [dict(row) for row in instance_rows],
            "cross_model_relationship_count": len(cross_model_relationship_rows),
            "cross_model_relationships": cross_model_relationship_rows,
        }

    def _instance_paths(self, instance_ids: list[str]) -> dict[str, str]:
        """Return a name-lineage path (root -> ... -> instance) for each instance id."""
        unique_ids = list(dict.fromkeys(instance_ids))
        if not unique_ids:
            return {}
        placeholders = ",".join(["%s"] * len(unique_ids))
        rows = self._db.execute(
            f"""
            with recursive lineage(target_id, node_instance_id, parent_node_id, name, depth) as (
                select node_instance_id as target_id, node_instance_id, parent_node_id, name, 0
                from hierarchy_model_node_instance where node_instance_id in ({placeholders})
                union all
                select lineage.target_id, p.node_instance_id, p.parent_node_id, p.name, lineage.depth + 1
                from lineage
                join hierarchy_model_node_instance p on p.node_instance_id = lineage.parent_node_id
            )
            select target_id, string_agg(name, ' -> ' order by depth desc) as path
            from lineage group by target_id
            """,
            tuple(unique_ids),
        ).fetchall()
        return {str(r["target_id"]): str(r["path"]) for r in rows}

    def get_reparent_impact(self, node_id: str, new_parent_node_id: str | None) -> dict:
        """Preview the Structure Workspace impact of reparenting a node type.

        Identifies existing node instances whose placement would become invalid under the new
        type hierarchy and, for each, the candidate new parent instances (cycle-safe) the user
        can choose from — with a default pre-selected when exactly one candidate exists.
        ``resolvable`` is True when every affected instance has at least one candidate (or becomes
        a root); ``auto_resolvable`` is True when every affected instance has a single default.
        """
        node = self.get_node(node_id)
        model_id = node["model_id"]
        old_parent_type = node.get("parent_node_id")

        # Valid parent node types for this type AFTER the reparent (rules mirror the tree).
        rule_rows = self._db.execute(
            """
            select parent_node_type_id from structural_rule
            where model_id = %s and child_node_type_id = %s and status = 'active'
              and relationship_kind in ('parent_child', 'recursive')
            """,
            (model_id, node_id),
        ).fetchall()
        valid_parent_types = {str(r["parent_node_type_id"]) for r in rule_rows if r["parent_node_type_id"] is not None}
        if old_parent_type and old_parent_type != new_parent_node_id:
            valid_parent_types.discard(str(old_parent_type))
        if new_parent_node_id:
            valid_parent_types.add(new_parent_node_id)

        # Instances of this node type + their current parent instance (name + type).
        instance_rows = self._db.execute(
            """
            select
                i.node_instance_id,
                i.name,
                i.parent_node_id,
                p.node_type_id as parent_type_id,
                p.name as parent_instance_name,
                pt.name as parent_type_name
            from hierarchy_model_node_instance i
            left join hierarchy_model_node_instance p on p.node_instance_id = i.parent_node_id
            left join hierarchy_model_node_type pt on pt.node_type_id = p.node_type_id
            where i.node_type_id = %s and i.model_id = %s
            """,
            (node_id, model_id),
        ).fetchall()

        def is_valid(row) -> bool:
            if row["parent_node_id"] is None:
                # A root instance stays valid only if the type itself becomes a root.
                return new_parent_node_id is None
            return str(row["parent_type_id"]) in valid_parent_types

        affected = [dict(r) for r in instance_rows if not is_valid(r)]
        affected_ids = [str(a["node_instance_id"]) for a in affected]

        # Descendant subtree per affected instance (they travel with their ancestor) + cross-model links.
        subtree_by_root: dict[str, set[str]] = {}
        all_subtree_ids: set[str] = set()
        cross_model_count = 0
        if affected_ids:
            placeholders = ",".join(["%s"] * len(affected_ids))
            subtree_rows = self._db.execute(
                f"""
                with recursive subtree(root_id, node_instance_id) as (
                    select node_instance_id as root_id, node_instance_id
                    from hierarchy_model_node_instance where node_instance_id in ({placeholders})
                    union all
                    select subtree.root_id, child.node_instance_id
                    from hierarchy_model_node_instance child
                    join subtree on subtree.node_instance_id = child.parent_node_id
                )
                select root_id, node_instance_id from subtree
                """,
                tuple(affected_ids),
            ).fetchall()
            for r in subtree_rows:
                root_id = str(r["root_id"])
                nid = str(r["node_instance_id"])
                subtree_by_root.setdefault(root_id, set()).add(nid)
                all_subtree_ids.add(nid)
            if all_subtree_ids:
                ids = list(all_subtree_ids)
                ph2 = ",".join(["%s"] * len(ids))
                cm_row = self._db.execute(
                    f"""
                    select count(*) as c from cross_model_relationship_instance
                    where source_instance_id in ({ph2}) or target_instance_id in ({ph2})
                    """,
                    tuple(ids + ids),
                ).fetchone()
                cross_model_count = int(cm_row["c"]) if cm_row else 0
        descendant_count = len(all_subtree_ids) - len(affected_ids)

        # Candidate parent instances (instances of the new parent type).
        candidates: list[dict] = []
        if new_parent_node_id is not None:
            candidate_rows = self._db.execute(
                "select node_instance_id, name from hierarchy_model_node_instance where node_type_id = %s and model_id = %s order by name",
                (new_parent_node_id, model_id),
            ).fetchall()
            candidates = [{"instance_id": str(c["node_instance_id"]), "instance_name": str(c["name"])} for c in candidate_rows]

        path_by_id = self._instance_paths(affected_ids + [c["instance_id"] for c in candidates])

        # One mapping row per affected instance: cycle-safe candidate parents + a default.
        plan_items: list[dict] = []
        all_resolvable = True
        auto_resolvable = True
        for a in affected:
            aid = str(a["node_instance_id"])
            old_parent_instance_name = str(a["parent_instance_name"]) if a["parent_instance_name"] is not None else None
            old_parent_type_name = str(a["parent_type_name"]) if a["parent_type_name"] is not None else None
            base = {
                "instance_id": aid,
                "instance_name": str(a["name"]),
                "instance_path": path_by_id.get(aid, str(a["name"])),
                "old_parent_instance_id": str(a["parent_node_id"]) if a["parent_node_id"] is not None else None,
                "old_parent_instance_name": old_parent_instance_name,
                "old_parent_type_name": old_parent_type_name,
            }
            if new_parent_node_id is None:
                plan_items.append({
                    **base,
                    "candidate_parents": [],
                    "default_parent_instance_id": None,  # becomes a root
                    "resolvable": True,
                })
                continue
            own_subtree = subtree_by_root.get(aid, {aid})
            valid_candidates = [c for c in candidates if c["instance_id"] not in own_subtree]
            # Default to the first available candidate; the user can change it in the table.
            default_id = valid_candidates[0]["instance_id"] if valid_candidates else None
            resolvable = len(valid_candidates) >= 1
            if not resolvable:
                all_resolvable = False
            if default_id is None:
                auto_resolvable = False
            plan_items.append({
                **base,
                "candidate_parents": [
                    {
                        "instance_id": c["instance_id"],
                        "instance_name": c["instance_name"],
                        "instance_path": path_by_id.get(c["instance_id"], c["instance_name"]),
                    }
                    for c in valid_candidates
                ],
                "default_parent_instance_id": default_id,
                "resolvable": resolvable,
            })

        return {
            "impact_summary": {
                "node_id": node_id,
                "node_name": str(node["name"]),
                "model_id": model_id,
                "old_parent_node_type_id": old_parent_type,
                "new_parent_node_type_id": new_parent_node_id,
                "new_parent_is_root": new_parent_node_id is None,
                "affected_instance_count": len(affected),
                "descendant_instance_count": descendant_count,
                "affected_edge_count": len(affected),
                "affected_cross_model_relationship_count": cross_model_count,
                "resolvable": len(affected) == 0 or all_resolvable,
                "auto_resolvable": len(affected) == 0 or auto_resolvable,
            },
            "impact_reparent_plan_items": plan_items,
        }

    def delete_governed_node(self, node_id: str) -> None:
        descendant_ids = self.list_descendant_ids(node_id)
        placeholders = ",".join(["%s"] * len(descendant_ids))

        delete_cross_model_relationships(
            self._db,
            instance_type=HIERARCHY_MODEL,
            instance_ids_query=f"""
                with recursive affected_instances(node_instance_id) as (
                    select node_instance_id
                    from hierarchy_model_node_instance
                    where node_type_id in ({placeholders})
                    union
                    select child.node_instance_id
                    from hierarchy_model_node_instance child
                    join affected_instances parent
                      on parent.node_instance_id = child.parent_node_id
                )
                select node_instance_id from affected_instances
            """,
            params=tuple(descendant_ids),
        )
        self._db.execute(
            f"""
            with recursive affected_instances(node_instance_id) as (
                select node_instance_id
                from hierarchy_model_node_instance
                where node_type_id in ({placeholders})
                union
                select child.node_instance_id
                from hierarchy_model_node_instance child
                join affected_instances parent on parent.node_instance_id = child.parent_node_id
            )
            delete from hierarchy_model_node_instance
            where node_instance_id in (select node_instance_id from affected_instances)
            """,
            tuple(descendant_ids),
        )
        self._db.execute(
            f"""
            delete from structural_rule
            where parent_node_type_id in ({placeholders})
               or child_node_type_id in ({placeholders})
            """,
            tuple(descendant_ids + descendant_ids),
        )
        self._db.execute(
            f"delete from hierarchy_model_node_type where node_type_id in ({placeholders})",
            tuple(descendant_ids),
        )
        self._db.commit()

    def get_recursive_disable_impact(self, node_id: str, *, max_paths: int = 25) -> dict:
        node = self.get_node(node_id)
        if not node:
            return {
                "node_id": node_id,
                "node_name": None,
                "model_id": None,
                "model_name": None,
                "affected_relationship_count": 0,
                "affected_instance_count": 0,
                "affected_instance_paths": [],
            }

        model_row = self._db.execute(
            "select name from hierarchy_model where model_id = %s",
            (node["model_id"],),
        ).fetchone()
        model_name = str(model_row["name"]) if model_row else None

        count_row = self._db.execute(
            """
            with affected_recursive_instances as (
                select child.node_instance_id as child_id
                from hierarchy_model_node_instance child
                join hierarchy_model_node_instance parent on parent.node_instance_id = child.parent_node_id
                where child.node_type_id = %s
                  and parent.node_type_id = child.node_type_id
            )
            select count(*) as affected_count
            from affected_recursive_instances
            """,
            (node_id,),
        ).fetchone()
        affected_count = int(count_row["affected_count"]) if count_row else 0

        paths: list[str] = []
        if affected_count > 0:
            path_rows = self._db.execute(
                """
                with recursive affected_recursive_instances as (
                    select child.node_instance_id as child_id
                    from hierarchy_model_node_instance child
                    join hierarchy_model_node_instance parent on parent.node_instance_id = child.parent_node_id
                    where child.node_type_id = %s
                      and parent.node_type_id = child.node_type_id
                    order by child.name, child.node_instance_id
                    limit %s
                ),
                lineage as (
                    select
                        ari.child_id as affected_instance_id,
                        n.node_instance_id,
                        n.parent_node_id,
                        n.name,
                        0 as depth
                    from affected_recursive_instances ari
                    join hierarchy_model_node_instance n on n.node_instance_id = ari.child_id

                    union all

                    select
                        l.affected_instance_id,
                        parent.node_instance_id,
                        parent.parent_node_id,
                        parent.name,
                        l.depth + 1
                    from lineage l
                    join hierarchy_model_node_instance parent on parent.node_instance_id = l.parent_node_id
                )
                select
                    affected_instance_id,
                    string_agg(name, ' -> ' order by depth desc) as instance_path
                from lineage
                group by affected_instance_id
                order by instance_path
                """,
                (node_id, max_paths),
            ).fetchall()
            paths = [str(row["instance_path"]) for row in path_rows]

        return {
            "node_id": str(node_id),
            "node_name": str(node["name"]),
            "model_id": str(node["model_id"]),
            "model_name": model_name,
            "affected_relationship_count": affected_count,
            "affected_instance_count": affected_count,
            "affected_instance_paths": paths,
        }

    def remove_recursive_structure_instances(self, node_id: str) -> int:
        deleted = self._db.execute(
            """
            with affected_recursive_instances as (
                select child.node_instance_id as child_id
                from hierarchy_model_node_instance child
                join hierarchy_model_node_instance parent on parent.node_instance_id = child.parent_node_id
                where child.node_type_id = %s
                  and parent.node_type_id = child.node_type_id
            ),
            deleted_links as (
                delete from cross_model_relationship_instance
                where source_instance_id in (select child_id from affected_recursive_instances)
                   or target_instance_id in (select child_id from affected_recursive_instances)
                returning relationship_id
            ),
            deleted_nodes as (
                delete from hierarchy_model_node_instance
                where node_instance_id in (select child_id from affected_recursive_instances)
                returning node_instance_id
            )
            select count(*) as deleted_count from deleted_nodes
            """,
            (node_id,),
        ).fetchone()
        self._db.commit()
        return int(deleted["deleted_count"]) if deleted else 0
