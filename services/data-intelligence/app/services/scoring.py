from __future__ import annotations

from app.schemas.scoring import LeadScoreFactor, LeadScoreRequest, LeadScoreResponse

MODEL_VERSION = "rules_v1"
HIGH_INTENT_TAGS = {"vip", "high_intent", "demo_requested", "pricing", "trial"}
LOW_QUALITY_TAGS = {"invalid", "unqualified", "do_not_contact"}
KNOWN_CITIES = {"ho chi minh", "hanoi", "da nang"}


def _clamp_score(value: int) -> int:
    return max(0, min(100, value))


def _add_factor(
    factors: list[LeadScoreFactor],
    name: str,
    impact: int,
    reason: str,
) -> int:
    factors.append(LeadScoreFactor(name=name, impact=impact, reason=reason))
    return impact


def score_lead(request: LeadScoreRequest) -> LeadScoreResponse:
    score = 50
    factors: list[LeadScoreFactor] = [
        LeadScoreFactor(
            name="neutral_baseline",
            impact=50,
            reason="Starts from a neutral baseline when conversion evidence is unavailable.",
        )
    ]

    if request.email_valid is True:
        score += _add_factor(factors, "valid_email", 10, "A valid email supports campaign reachability.")
    elif request.email_valid is False:
        score += _add_factor(
            factors,
            "invalid_email",
            -25,
            "Invalid email reduces reachability and should be reviewed.",
        )

    if request.has_phone is True:
        score += _add_factor(factors, "phone_present", 5, "Phone data gives another contact option.")

    normalized_tags = {tag.strip().lower().replace(" ", "_") for tag in request.tags}
    high_intent_matches = sorted(normalized_tags & HIGH_INTENT_TAGS)
    low_quality_matches = sorted(normalized_tags & LOW_QUALITY_TAGS)

    if high_intent_matches:
        score += _add_factor(
            factors,
            "high_intent_tags",
            15,
            f"High-intent tags present: {', '.join(high_intent_matches)}.",
        )

    if low_quality_matches:
        score += _add_factor(
            factors,
            "low_quality_tags",
            -20,
            f"Low-quality tags present: {', '.join(low_quality_matches)}.",
        )

    if request.city and request.city.strip().lower() in KNOWN_CITIES:
        score += _add_factor(factors, "known_city", 3, "Known city can support localized segmentation.")

    if request.prior_sent_count > 0:
        impact = min(15, request.prior_sent_count * 3)
        score += _add_factor(
            factors,
            "campaign_reach_history",
            impact,
            "Prior sent emails provide measured engagement opportunity.",
        )

    if request.prior_failed_count > 0:
        impact = -min(20, request.prior_failed_count * 5)
        score += _add_factor(
            factors,
            "delivery_failures",
            impact,
            "Prior failed emails reduce confidence until data is repaired.",
        )

    bounded_score = _clamp_score(score)
    labels = ["low_data"]
    if bounded_score >= 75:
        labels = ["high_intent"]
    elif bounded_score >= 55:
        labels = ["warm"]

    if request.prior_failed_count > 0:
        labels.append("data_quality_review")

    return LeadScoreResponse(
        score=bounded_score,
        labels=labels,
        factors=factors,
        model_version=MODEL_VERSION,
    )

