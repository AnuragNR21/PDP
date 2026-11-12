"""
Data-quality rule resolution — pure domain logic, no I/O.

A mapped column is checked against the model field it was mapped to. What
"correct" means comes from the model structure itself:

  * properties declared on the structure node (e.g. a property named
    "Required" or "Unique") become rules, and
  * the field's datatype, recorded when the file was profiled, defines the
    shape every value must have.

When the structure declares nothing, the checks still run but report findings
as observations rather than failures — so an unconstrained model never
manufactures false alarms.
"""
from __future__ import annotations

from dataclasses import dataclass

# Property names (lower-cased, punctuation stripped) that a modeller may have
# attached to a structure node to mean "this must always have a value".
REQUIRED_PROPERTY_NAMES = {
    "required",
    "mandatory",
    "notnull",
    "nonnull",
    "isrequired",
    "key",
    "primarykey",
    "businesskey",
    "identifier",
    "id",
}

# …and to mean "no two rows may repeat a value".
UNIQUE_PROPERTY_NAMES = {
    "unique",
    "distinct",
    "key",
    "primarykey",
    "businesskey",
    "identifier",
    "uniquekey",
}

# Regex each datatype's values must match, evaluated by Postgres.
# String accepts anything, so it has no pattern.
TYPE_PATTERNS: dict[str, str] = {
    "Integer": r"^-?\d+$",
    "Decimal": r"^-?\d+(\.\d+)?$",
    "Boolean": r"^(true|false|yes|no)$",
    "DateTime": r"^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$",
}

# Boolean values are compared case-insensitively; the others are not.
CASE_INSENSITIVE_TYPES = {"Boolean"}


def _normalise(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


@dataclass
class FieldRules:
    """The rules that apply to one mapped column."""

    required: bool
    unique: bool
    datatype: str
    #: Where each rule came from, for display: "model structure" or "default".
    required_source: str
    unique_source: str

    @property
    def type_pattern(self) -> str | None:
        return TYPE_PATTERNS.get(self.datatype)

    @property
    def type_case_insensitive(self) -> bool:
        return self.datatype in CASE_INSENSITIVE_TYPES


def resolve_field_rules(
    structure_properties: list[str],
    node_type: str | None,
    field_name: str,
    datatype: str,
) -> FieldRules:
    """
    Work out what the model structure demands of a field.

    `structure_properties` are the property names declared on the structure
    node; `node_type` is its type name. Both are matched against the well-known
    names above, so a model that declares "Required" or "Primary Key" is
    honoured without any Discover-side configuration.
    """
    declared = {_normalise(p) for p in structure_properties}
    if node_type:
        declared.add(_normalise(node_type))

    required = bool(declared & REQUIRED_PROPERTY_NAMES)
    unique = bool(declared & UNIQUE_PROPERTY_NAMES)

    required_source = "model structure" if required else "default"
    unique_source = "model structure" if unique else "default"

    # A field the model calls an identifier is implicitly both, even when the
    # modeller only named it (e.g. a node named "Customer ID").
    if not required or not unique:
        implied = _normalise(field_name)
        if implied.endswith("id") or implied.endswith("key") or implied.endswith("code"):
            if not required:
                required, required_source = True, "field name"
            if not unique:
                unique, unique_source = True, "field name"

    return FieldRules(
        required=required,
        unique=unique,
        datatype=datatype or "String",
        required_source=required_source,
        unique_source=unique_source,
    )
