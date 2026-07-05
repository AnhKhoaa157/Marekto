from __future__ import annotations

import re
from typing import Any

from app.schemas.contacts import (
    NormalizeContactsRequest,
    NormalizeContactsResponse,
    NormalizedContactRow,
    RejectedContactRow,
)

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_TAG_LENGTH = 40
MAX_TAGS = 20

CITY_ALIASES = {
    "hcm": "Ho Chi Minh",
    "hcmc": "Ho Chi Minh",
    "ho chi minh": "Ho Chi Minh",
    "ho chi minh city": "Ho Chi Minh",
    "saigon": "Ho Chi Minh",
    "sai gon": "Ho Chi Minh",
    "ha noi": "Hanoi",
    "hanoi": "Hanoi",
    "da nang": "Da Nang",
    "danang": "Da Nang",
}


def _clean_text(value: str | None, max_length: int) -> str | None:
    if value is None:
        return None

    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None

    return cleaned[:max_length]


def _normalize_email(value: str | None) -> str | None:
    cleaned = _clean_text(value, 254)
    return cleaned.lower() if cleaned else None


def _normalize_city(value: str | None) -> tuple[str | None, list[str]]:
    cleaned = _clean_text(value, 80)
    if not cleaned:
        return None, []

    normalized_key = cleaned.lower()
    canonical = CITY_ALIASES.get(normalized_key)
    if canonical:
        return canonical, [] if canonical == cleaned else [f"city_normalized:{canonical}"]

    return cleaned, ["city_unrecognized"]


def _normalize_tags(tags: list[str]) -> tuple[list[str], list[str]]:
    normalized: list[str] = []
    seen: set[str] = set()
    warnings: list[str] = []

    for tag in tags:
        cleaned = _clean_text(tag, MAX_TAG_LENGTH)
        if not cleaned:
            continue

        normalized_tag = cleaned.lower().replace(" ", "_")
        if normalized_tag in seen:
            warnings.append(f"duplicate_tag:{normalized_tag}")
            continue

        seen.add(normalized_tag)
        normalized.append(normalized_tag)

        if len(normalized) >= MAX_TAGS:
            if len(tags) > MAX_TAGS:
                warnings.append("tag_limit_applied")
            break

    return normalized, warnings


def _safe_properties(properties: dict[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}

    for key, value in properties.items():
        if len(safe) >= 50:
            break

        cleaned_key = _clean_text(str(key), 80)
        if not cleaned_key:
            continue

        if isinstance(value, str):
            safe[cleaned_key] = _clean_text(value, 500) or ""
        elif isinstance(value, int | float | bool) or value is None:
            safe[cleaned_key] = value

    return safe


def normalize_contacts(request: NormalizeContactsRequest) -> NormalizeContactsResponse:
    accepted: list[NormalizedContactRow] = []
    rejected: list[RejectedContactRow] = []
    seen_emails: set[str] = set()
    duplicate_emails: set[str] = set()

    for row in request.rows:
        reasons: list[str] = []
        warnings: list[str] = []
        email = _normalize_email(row.email)

        if not email or not EMAIL_PATTERN.fullmatch(email):
            reasons.append("invalid_email")

        if email and email in seen_emails:
            reasons.append("duplicate_email")
            duplicate_emails.add(email)

        if reasons:
            rejected.append(RejectedContactRow(row_number=row.row_number, reasons=reasons))
            continue

        assert email is not None
        seen_emails.add(email)
        city, city_warnings = _normalize_city(row.city)
        tags, tag_warnings = _normalize_tags(row.tags)
        warnings.extend(city_warnings)
        warnings.extend(tag_warnings)

        accepted.append(
            NormalizedContactRow(
                row_number=row.row_number,
                email=email,
                first_name=_clean_text(row.first_name, 80),
                last_name=_clean_text(row.last_name, 80),
                phone=_clean_text(row.phone, 40),
                city=city,
                tags=tags,
                lead_score=row.lead_score,
                properties=_safe_properties(row.properties),
                warnings=warnings,
            )
        )

    return NormalizeContactsResponse(
        accepted=accepted,
        rejected=rejected,
        duplicate_emails=sorted(duplicate_emails),
        total_rows=len(request.rows),
    )

