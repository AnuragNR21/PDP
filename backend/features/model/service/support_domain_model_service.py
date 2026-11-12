from __future__ import annotations

from ..domain.commands import (
    CreateSupportDomainElementPropertyCommand,
    UpdateSupportDomainElementPropertyCommand,
)
from ..domain.invariants import NotFoundError, require
from ..repo.support_domain_element_property_repo import SupportDomainElementPropertyRepo
from ..repo.support_domain_element_repo import SupportDomainElementRepo
from ..repo.support_domain_model_repo import SupportDomainModelRepo


class SupportDomainModelService:
    """Command handler for Support Domain Model element-level details."""

    def __init__(
        self,
        *,
        support_domain_models: SupportDomainModelRepo,
        support_domain_elements: SupportDomainElementRepo,
        support_domain_element_properties: SupportDomainElementPropertyRepo,
    ) -> None:
        self._support_domain_models = support_domain_models
        self._support_domain_elements = support_domain_elements
        self._support_domain_element_properties = support_domain_element_properties

    def list_support_domain_element_properties(self, model_id: str, element_id: str) -> list[dict]:
        self._require_model_element(model_id, element_id)
        return self._support_domain_element_properties.list_properties(element_id=element_id)

    def create_support_domain_element_property(
        self,
        model_id: str,
        element_id: str,
        command: CreateSupportDomainElementPropertyCommand,
    ) -> dict:
        self._require_model_element(model_id, element_id)
        require(
            command.element_id == element_id,
            "Property payload must belong to selected support domain element.",
        )
        return self._support_domain_element_properties.insert_property(command.model_dump())

    def update_support_domain_element_property(
        self,
        model_id: str,
        element_id: str,
        property_id: str,
        command: UpdateSupportDomainElementPropertyCommand,
    ) -> dict:
        self._require_model_element(model_id, element_id)
        existing = self._require_property(property_id)
        require(
            existing["element_id"] == element_id,
            "Support domain property must belong to selected element.",
        )
        require(
            command.element_id == element_id,
            "Property payload must belong to selected support domain element.",
        )
        return self._support_domain_element_properties.update_property(property_id, command.model_dump())

    def delete_support_domain_element_property(
        self,
        model_id: str,
        element_id: str,
        property_id: str,
    ) -> None:
        self._require_model_element(model_id, element_id)
        existing = self._require_property(property_id)
        require(
            existing["element_id"] == element_id,
            "Support domain property must belong to selected element.",
        )
        self._support_domain_element_properties.delete_property(property_id)

    def get_support_domain_element_property_delete_impact(
        self,
        model_id: str,
        element_id: str,
        property_id: str,
    ) -> dict:
        self._require_model_element(model_id, element_id)
        existing = self._require_property(property_id)
        require(
            existing["element_id"] == element_id,
            "Support domain property must belong to selected element.",
        )
        impact = self._support_domain_element_properties.get_delete_impact(property_id)
        require(impact is not None, "Support domain property not found.")
        return impact

    def _require_model_element(self, model_id: str, element_id: str) -> dict:
        if self._support_domain_models.get_model(model_id) is None:
            raise NotFoundError("Support domain model not found.")

        element = self._support_domain_elements.get_element(element_id)
        if element is None:
            raise NotFoundError("Support domain element not found.")

        require(
            element["support_domain_model_id"] == model_id,
            "Support domain element must belong to selected model.",
        )
        return element

    def _require_property(self, property_id: str) -> dict:
        prop = self._support_domain_element_properties.get_property(property_id)
        if prop is None:
            raise NotFoundError("Support domain property not found.")
        return prop
