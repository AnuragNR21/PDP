"""Request contracts for the Rule Workspace."""
from pydantic import BaseModel, Field


class SaveRuleCommand(BaseModel):
    """
    One authored rule.

    A rule is written on its own here and attached to a field later, so nothing
    in this command names a field, a model or a session.
    """

    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    category: str = Field(default="data_quality", min_length=1)
    #: "builtin" fills in a standard check; "python" carries a script instead.
    definition_kind: str = Field(default="builtin", pattern="^(builtin|python)$")
    #: Ignored for a script rule, which has no check to pick.
    check_type: str = ""
    script: str = ""
    parameters: dict = Field(default_factory=dict)
    severity: str = Field(default="medium", pattern="^(low|medium|high)$")
    status: str = Field(default="draft", pattern="^(draft|active|retired)$")
    #: What kind of execution the rule needs: column, row, multi_column,
    #: cross_table, cross_source, aggregate, historical. Empty means "whatever
    #: this check normally needs", which is what almost every rule wants.
    #:
    #: It is set by the author rather than derived, because a governed rule can
    #: be valid and describe work the engine cannot do yet — and saying so is
    #: better than the rule being silently absent from every picker.
    execution_scope: str = ""
    #: What the rule measures, and where it may be attached.
    dimension: str = Field(default="validity", min_length=1)
    data_type: str = Field(default="any", pattern="^(any|text|number|date)$")
    #: Why it exists and what it answers to — the part that survives a handover.
    rationale: str = ""
    reference: str = ""
    #: What a reviewer is told when a row fails. {field} and {value} are filled in.
    message_template: str = ""
    #: Values that must pass, and values that must not.
    examples_pass: list[str] = Field(default_factory=list)
    examples_fail: list[str] = Field(default_factory=list)
    owner: str = ""
    #: The governed vocabulary an approved-list check reads, and which of its
    #: values this rule accepts. They live on the rule because that is where
    #: the person writing the rule is: asking them to finish the sentence in a
    #: second screen is how half-written governance gets saved.
    #:
    #: Empty `reference_value_ids` means the whole vocabulary.
    reference_element_type_id: str = ""
    reference_value_ids: list[str] = Field(default_factory=list)
    #: True when the caller means to set the two fields above. A payload that
    #: simply omits them — an import, an older client — leaves the rule's
    #: governance alone rather than silently clearing it.
    governs_values: bool = False


class SaveRuleConfigurationCommand(BaseModel):
    """
    One named, parameterised use of a rule definition.

    The definition says what the check does; this says what it checks against.
    One "value is one of an approved list" definition carries a Valid Voltage
    configuration, a Valid Manufacturer configuration and as many more as the
    governance needs, instead of three near-identical definitions.
    """

    rule_definition_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    #: Set only for the parameters the definition's check actually takes. A
    #: configuration pointing at a vocabulary leaves its value list out — the
    #: list is resolved from the vocabulary rather than copied here.
    parameters: dict = Field(default_factory=dict)
    #: Empty means "whatever the definition says".
    severity: str = ""
    status: str = Field(default="draft", pattern="^(draft|active|retired)$")
    #: The Support Domain element type this configuration takes its accepted
    #: values from. Preferred over a literal list: the vocabulary stays the
    #: single source, and the run snapshots what it resolved.
    reference_element_type_id: str = ""
    #: Which of that vocabulary's values this configuration approves. Empty is
    #: the whole vocabulary.
    reference_value_ids: list[str] = Field(default_factory=list)
    owner: str = ""


class ValidateScriptCommand(BaseModel):
    """A script on its way to the editor's error panel, not to the database."""

    script: str = ""


class TestExamplesCommand(BaseModel):
    """A draft rule on its way to the self-test, not to the database."""

    check_type: str = Field(min_length=1)
    parameters: dict = Field(default_factory=dict)
    examples_pass: list[str] = Field(default_factory=list)
    examples_fail: list[str] = Field(default_factory=list)
