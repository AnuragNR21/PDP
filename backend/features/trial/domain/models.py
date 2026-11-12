from pydantic import BaseModel, Field


class TrialScenarioCard(BaseModel):
    scenario_code: str
    title: str
    persona: str
    route: str
    summary: str


class TrialHomePayload(BaseModel):
    guided_mode: bool = True
    scenarios: list[TrialScenarioCard]
    known_limitations: list[str]
    next_steps: list[str]


class TrialEventCommand(BaseModel):
    event_type: str
    scenario_code: str
    user_label: str = Field(default='trial-user')
    object_ref: str | None = None
    metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class TrialFeedbackCommand(BaseModel):
    scenario_code: str
    usefulness_score: int = Field(ge=1, le=5)
    trust_score: int = Field(ge=1, le=5)
    ease_score: int = Field(ge=1, le=5)
    next_step: str
    notes: str = ''


class TrialOpsSummary(BaseModel):
    total_events: int
    total_feedback: int
    next_step_counts: dict[str, int]
    top_scenarios: list[dict[str, int | str]]


class TrialEventRecord(BaseModel):
    event_id: str
    event_type: str
    scenario_code: str
    user_label: str
    object_ref: str | None
    metadata: dict[str, str | int | float | bool | None]
    created_at: str


class TrialFeedbackRecord(BaseModel):
    feedback_id: str
    scenario_code: str
    usefulness_score: int
    trust_score: int
    ease_score: int
    next_step: str
    notes: str
    created_at: str
