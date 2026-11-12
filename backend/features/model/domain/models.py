from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

ModelDomain = Literal["information", "accountability", "measurement"]
LifecycleStatus = Literal["draft", "active", "retired"]
TabKey = Literal["hierarchy_model", "support_domain"]


class RelationshipKind(StrEnum):
    parent_child = (
        "parent_child",
        "Parent of",
        "Derived hierarchy containment relationship: the parent node type is parent of the child.",
    )
    recursive = (
        "recursive",
        "Recursive",
        "Self-referential hierarchy containment allowing a type to nest under itself.",
    )
    categorises = (
        "categorises",
        "Categorises",
        "Grouping rules, outcomes, authorities, or roles.",
    )
    has_threshold = (
        "has_threshold",
        "Has threshold",
        "Linking DQ Rules to DQ Thresholds.",
    )
    produces = ("produces", "Produces", "Linking DQ Rules to DQ Outcomes.")
    classifies = (
        "classifies",
        "Classifies",
        "Linking thresholds to outcome severity/classification.",
    )
    defines = ("defines", "Defines", "Linking Authorities to Roles.")
    reports_to = (
        "reports_to",
        "Reports to",
        "Recursive Role-to-Role governance structure.",
    )
    delegates_to = (
        "delegates_to",
        "Delegates to",
        "Optional recursive Role responsibility delegation.",
    )
    applies_to = (
        "applies_to",
        "Applies to",
        "Cross-model link from DQ Rule to Business Information node types or instances.",
    )
    accountable_for = (
        "accountable_for",
        "Accountable for",
        "Cross-model accountability from Role to governed object.",
    )
    responsible_for = (
        "responsible_for",
        "Responsible for",
        "Cross-model operational responsibility.",
    )
    governs = (
        "governs",
        "Governs",
        "Authority or Role governance over instruments, obligations, requirements, "
        "or business information.",
    )

    def __new__(cls, value: str, label: str, description: str) -> RelationshipKind:
        member = str.__new__(cls, value)
        member._value_ = value
        member.label = label
        member.description = description
        return member

MODEL_DOMAINS: tuple[ModelDomain, ...] = ("information", "accountability", "measurement")
LIFECYCLE_STATUSES: tuple[LifecycleStatus, ...] = ("draft", "active", "retired")
RELATIONSHIP_KINDS: tuple[RelationshipKind, ...] = tuple(RelationshipKind)
TAB_KEYS: tuple[TabKey, ...] = ("hierarchy_model", "support_domain")

# Kinds that only hierarchies use; a Support Domain relationship cannot take them.
HIERARCHY_ONLY_KINDS = frozenset({RelationshipKind.parent_child.value, RelationshipKind.recursive.value})
SUPPORT_DOMAIN_RELATIONSHIP_NAME_MAX = 120


def support_domain_relationship_kind(value: object) -> str:
    """The stored kind of a Support Domain relationship, from what the editor sent.

    A standard kind is sent as its key ("reports_to") or its label ("Reports to")
    and is stored as the key. Any other text is a relationship name of the
    model's own ("zz 123"), stored as typed (spaces collapsed), the same way a
    cross-model relationship type keeps its free name.
    """
    text = " ".join(str(getattr(value, "value", value) or "").split())
    if not text:
        raise ValueError("Relationship name is required.")
    if len(text) > SUPPORT_DOMAIN_RELATIONSHIP_NAME_MAX:
        raise ValueError(f"Relationship name must be at most {SUPPORT_DOMAIN_RELATIONSHIP_NAME_MAX} characters.")
    folded = text.casefold()
    for kind in RELATIONSHIP_KINDS:
        if folded in (kind.value.casefold(), kind.label.casefold()):
            if kind.value in HIERARCHY_ONLY_KINDS:
                raise ValueError(f"“{kind.label}” belongs to hierarchies, not to Support Domain relationships.")
            return kind.value
    return text


def is_standard_relationship_kind(kind: str) -> bool:
    return any(kind == item.value for item in RELATIONSHIP_KINDS)



@dataclass(frozen=True)
class HierarchyModel:
    id: str
    name: str
    purpose: str
    owning_domain: ModelDomain
    status: LifecycleStatus = "draft"


@dataclass(frozen=True)
class HierarchyNode:
    id: str
    model_id: str
    parent_node_id: str | None
    name: str
    description: str
    display_name: str = ""
    badge: str = ""
    sort_order: int = 0
    is_recursive: bool = False
    is_property: bool = False
    status: LifecycleStatus = "draft"


@dataclass(frozen=True)
class HierarchyRule:
    id: str
    model_id: str
    parent_node_id: str
    child_node_id: str
    relationship_kind: RelationshipKind = RelationshipKind.parent_child
    notes: str = ""
    status: LifecycleStatus = "draft"


@dataclass(frozen=True)
class SupportDomainModel:
    id: str
    name: str
    purpose: str
    status: LifecycleStatus = "draft"


@dataclass(frozen=True)
class SupportDomainElement:
    id: str
    model_id: str
    name: str
    description: str
    display_name: str = ""
    badge: str = ""
    status: LifecycleStatus = "draft"


@dataclass(frozen=True)
class SupportDomainRelationship:
    id: str
    model_id: str
    source_element_id: str
    target_element_id: str
    # A standard RelationshipKind key, or the model's own relationship name.
    relationship_kind: str = RelationshipKind.categorises.value
    notes: str = ""
    status: LifecycleStatus = "draft"
