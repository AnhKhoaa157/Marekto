from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
)


SegmentDimension = Literal["city", "tag", "lead_score_band"]


class SegmentOutcomeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: SegmentDimension
    label: str = Field(min_length=1, max_length=80)
    sent_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)


class CampaignAnalyticsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sent_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)
    segments: list[SegmentOutcomeInput] = Field(default_factory=list, max_length=200)
    min_sample_size: int = Field(default=10, ge=1, le=10_000)
    high_failure_threshold: float = Field(default=0.2, ge=0, le=1)


class SegmentInsight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: SegmentDimension
    label: str
    total_count: int
    sent_count: int
    failed_count: int
    failure_rate: float
    sufficient_sample: bool


class CampaignRecommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    message: str
    evidence: dict[str, str | int | float]


class CampaignAnalyticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_count: int
    sent_count: int
    failed_count: int
    failure_rate: float
    insufficient_data: bool
    segments: list[SegmentInsight]
    high_failure_segments: list[SegmentInsight]
    recommendations: list[CampaignRecommendation]
