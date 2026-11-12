"""ImpactDiagramService — saving and reopening a reading of the graph."""
from __future__ import annotations

from features.impact.repo.impact_diagram_repository import ImpactDiagramRepository

MAX_NAME_LENGTH = 200


class ImpactDiagramService:
    def __init__(self, db_url: str) -> None:
        self._diagrams = ImpactDiagramRepository(db_url)

    def list_diagrams(self) -> dict:
        items = self._diagrams.list_diagrams()
        return {"items": items, "total": len(items)}

    def get_diagram(self, diagram_id: str) -> dict:
        diagram = self._diagrams.get_diagram(diagram_id)
        if diagram is None:
            raise LookupError("That impact diagram no longer exists.")
        return diagram

    def create_diagram(self, command) -> dict:
        name = self._validated_name(command.name)
        return self._diagrams.create_diagram(
            name, [n.model_dump() for n in command.nodes], [e.model_dump() for e in command.edges]
        )

    def update_diagram(self, diagram_id: str, command) -> dict:
        name = self._validated_name(command.name)
        diagram = self._diagrams.update_diagram(
            diagram_id,
            name,
            [n.model_dump() for n in command.nodes],
            [e.model_dump() for e in command.edges],
        )
        if diagram is None:
            raise LookupError("That impact diagram no longer exists.")
        return diagram

    def delete_diagram(self, diagram_id: str) -> None:
        if not self._diagrams.delete_diagram(diagram_id):
            raise LookupError("That impact diagram no longer exists.")

    @staticmethod
    def _validated_name(raw: str) -> str:
        name = (raw or "").strip()
        if not name:
            raise ValueError("Give the diagram a name.")
        if len(name) > MAX_NAME_LENGTH:
            raise ValueError(f"A diagram name is limited to {MAX_NAME_LENGTH} characters.")
        return name
