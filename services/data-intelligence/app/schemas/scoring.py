from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
)


class LeadScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email_valid: bool | None = None
    has_phone: bool | None = None
    city: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=50)
    prior_sent_count: int = Field(default=0, ge=0)
    prior_failed_count: int = Field(default=0, ge=0)


class LeadScoreFactor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    impact: int
    reason: str


class LeadScoreResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: int = Field(ge=0, le=100)
    labels: list[str]
    factors: list[LeadScoreFactor]
    model_version: str
