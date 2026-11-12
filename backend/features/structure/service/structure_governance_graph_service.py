"""
StructureGovernanceGraphService — a read of the structure governance graph.

Every item and every asserted edge here belongs to Structure, and consumers
(the Impact workspace) only read it; this service only decides what to fetch and says plainly
when it had to stop fetching.
"""
from __future__ import annotations

from features.structure.domain.governance_graph_kinds import ITEM_KINDS
from features.structure.repo.structure_governance_graph_repository import (
    MAX_GRAPH_ITEMS,
    StructureGovernanceGraphRepository,
)


class StructureGovernanceGraphService:
    def __init__(self, db_url: str) -> None:
        self._graph = StructureGovernanceGraphRepository(db_url)

    def search_items(
        self, *, search: str = "", kind: str = "", model_id: str = "", limit: int = 50, offset: int = 0
    ) -> dict:
        if kind and kind not in ITEM_KINDS:
            raise ValueError(f"'{kind}' is not a kind of item this graph holds.")
        report = self._graph.search_items(
            search=search, kind=kind, model_id=model_id, limit=limit, offset=offset
        )
        report["has_more"] = report["offset"] + len(report["items"]) < report["total"]
        return report

    def get_items(self, item_ids: list[str]) -> dict:
        """
        Items by id, plus the ids that no longer resolve.

        A saved diagram names things that may since have been retired. Saying
        which ones are gone is the difference between a canvas that quietly
        loses nodes and one that tells the reader their view is out of date.
        """
        items = self._graph.get_items(item_ids)
        found = {item["item_id"] for item in items}
        return {
            "items": items,
            "missing_ids": [i for i in dict.fromkeys(item_ids) if i and i not in found],
            "edges": self._graph.edges_within(list(found)),
        }

    def neighbourhood(self, seed_ids: list[str], depth: int = 1) -> dict:
        report = self._graph.neighbourhood(seed_ids, depth)
        report["limit"] = MAX_GRAPH_ITEMS
        report["total"] = len(report["items"])
        if report["truncated"]:
            report["message"] = (
                f"Stopped at {MAX_GRAPH_ITEMS} items. Narrow the starting point or reduce "
                "the depth to see the rest."
            )
        return report
