"""
Reading governed vocabularies from the Rule Workspace's side of the fence.

A rule configuration may take its accepted values from a Support Domain
element type rather than holding a copy of them. That makes the vocabulary the
single source: adding a voltage class in the Support Domain model changes what
every configuration pointing at it accepts, without anyone editing a rule.

This reads element types and their instances and nothing else. It does not
write, and it does not reach into the Support Domain model's own concerns —
the rules feature is a reader here, not an owner.
"""
from __future__ import annotations

from shared.db import get_connection


class SupportDomainVocabularyRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url

    def get_element_type(self, element_type_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT e.element_id, e.name, e.display_name, e.status, "
                "       e.support_domain_model_id, m.name AS model_name "
                "FROM support_domain_element_type e "
                "JOIN support_domain_model m "
                "  ON m.support_domain_model_id = e.support_domain_model_id "
                "WHERE e.element_id = %s",
                (element_type_id,),
            ).fetchone()
        return dict(row) if row else None

    def list_element_types(self, support_domain_model_id: str = "") -> list[dict]:
        """
        Every vocabulary a configuration could point at, with how many values it
        holds — a type with no instances accepts nothing, and saying so before
        somebody binds to it saves a confusing quality run later.
        """
        where = "WHERE e.support_domain_model_id = %s" if support_domain_model_id else ""
        params = (support_domain_model_id,) if support_domain_model_id else ()
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT e.element_id, e.name, e.display_name, e.status, "
                "       e.support_domain_model_id, m.name AS model_name, "
                "       COUNT(i.instance_id) AS value_count "
                "FROM support_domain_element_type e "
                "JOIN support_domain_model m "
                "  ON m.support_domain_model_id = e.support_domain_model_id "
                "LEFT JOIN support_domain_element_instance i "
                "  ON i.element_type_id = e.element_id AND i.status = 'active' "
                f"{where} "
                "GROUP BY e.element_id, e.name, e.display_name, e.status, "
                "         e.support_domain_model_id, m.name, e.sort_order "
                "ORDER BY LOWER(m.name), e.sort_order, LOWER(e.name)",
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def list_instances(self, element_type_id: str) -> list[dict]:
        """
        The values this vocabulary holds, each with the id a rule selects it by.

        Only active instances, for the same reason `list_instance_names` gives:
        a retired value is one the business has stopped accepting.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT instance_id AS element_instance_id, name AS value_name, "
                "       element_type_id, status "
                "FROM support_domain_element_instance "
                "WHERE element_type_id = %s AND status = 'active' "
                "ORDER BY sort_order, LOWER(name)",
                (element_type_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_instance_names(self, element_type_id: str) -> list[str]:
        """
        The accepted values this vocabulary currently holds.

        Only active instances: a retired value is one the business has stopped
        accepting, and a rule that still accepted it would be reporting the
        opposite of the governance.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT name FROM support_domain_element_instance "
                "WHERE element_type_id = %s AND status = 'active' "
                "ORDER BY sort_order, LOWER(name)",
                (element_type_id,),
            ).fetchall()
        return [dict(row)["name"] for row in rows]
