from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RawContactRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_number: int = Field(ge=1)
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    city: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=50)
    lead_score: int | None = None
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("lead_score")
    @classmethod
    def validate_lead_score(cls, value: int | None) -> int | None:
        if value is not None and (value < 0 or value > 100):
            raise ValueError("lead_score must be between 0 and 100")
        return value


class NormalizeContactsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[RawContactRow] = Field(min_length=1, max_length=1_000)


class NormalizedContactRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_number: int
    email: str
    first_name: str | None
    last_name: str | None
    phone: str | None
    city: str | None
    tags: list[str]
    lead_score: int | None
    properties: dict[str, Any]
    warnings: list[str]


class RejectedContactRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_number: int
    reasons: list[str]


class NormalizeContactsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: list[NormalizedContactRow]
    rejected: list[RejectedContactRow]
    duplicate_emails: list[str]
    total_rows: int

