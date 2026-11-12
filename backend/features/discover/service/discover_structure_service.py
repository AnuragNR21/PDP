"""
The quality-results read, with the distinctions the workspace depends on kept intact.

The repository does the joining; this decides what a caller is allowed to ask
for and makes sure two things are never lost on the way out:

* which run the checks came from, so a reader can tell the current assessment
  from an earlier one and never sees the two blended;
* the difference between *passed*, *needs attention* and *never assessed* —
  the last of which is the easiest to misreport as the first.
"""
from __future__ import annotations

from features.discover.repo.discover_structure_repository import (
    MAX_FINDING_PAGE,
    DiscoverStructureRepository,
)

#: The most node instances one read may resolve quality results for.
#:
#: A canvas can hold hundreds of cards, and asking for every one's quality results at
#: once is how a discovery view turns into a table scan.
MAX_STRUCTURE_INSTANCES = 200


class DiscoverStructureService:
    def __init__(self, db_url: str) -> None:
        self._results = DiscoverStructureRepository(db_url)

    def search_quality_results_by_structure_instance(self, node_ids: list[str], *, run_id: str = "") -> dict:
        wanted = [i for i in dict.fromkeys(node_ids) if i]
        if len(wanted) > MAX_STRUCTURE_INSTANCES:
            raise ValueError(
                f"Quality results can be resolved for at most {MAX_STRUCTURE_INSTANCES} items at a time."
            )

        report = self._results.search_quality_results_by_structure_instance(wanted, run_id=run_id)

        # Said plainly rather than inferred from empty lists: a property with
        # no run has not passed, and the screen must be able to say which of
        # the two it is looking at.
        report["assessed"] = bool(report["checks"])
        report["has_runs"] = bool(report["runs"])
        report["item_ids"] = wanted
        return report

    def list_findings_for_quality_check(self, quality_check_id: str, *, offset: int = 0, limit: int = 50) -> dict:
        if not quality_check_id:
            raise ValueError("A quality check must be named before its findings can be read.")
        if limit > MAX_FINDING_PAGE:
            raise ValueError(f"At most {MAX_FINDING_PAGE} findings can be read at a time.")
        return self._results.list_findings_for_quality_check(quality_check_id, offset=offset, limit=limit)
