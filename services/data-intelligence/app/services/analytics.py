from __future__ import annotations

from app.schemas.analytics import (
    CampaignAnalyticsRequest,
    CampaignAnalyticsResponse,
    CampaignRecommendation,
    SegmentInsight,
)


def _failure_rate(failed_count: int, total_count: int) -> float:
    if total_count <= 0:
        return 0.0

    return round(failed_count / total_count, 4)


def analyze_campaign(request: CampaignAnalyticsRequest) -> CampaignAnalyticsResponse:
    total_count = request.sent_count + request.failed_count
    failure_rate = _failure_rate(request.failed_count, total_count)
    insufficient_data = total_count < request.min_sample_size
    segments: list[SegmentInsight] = []

    for segment in request.segments:
        segment_total = segment.sent_count + segment.failed_count
        segments.append(
            SegmentInsight(
                dimension=segment.dimension,
                label=segment.label,
                total_count=segment_total,
                sent_count=segment.sent_count,
                failed_count=segment.failed_count,
                failure_rate=_failure_rate(segment.failed_count, segment_total),
                sufficient_sample=segment_total >= request.min_sample_size,
            )
        )

    high_failure_segments = [
        segment
        for segment in segments
        if segment.sufficient_sample and segment.failure_rate >= request.high_failure_threshold
    ]
    high_failure_segments.sort(key=lambda segment: (-segment.failure_rate, -segment.total_count))

    recommendations: list[CampaignRecommendation] = []
    if insufficient_data:
        recommendations.append(
            CampaignRecommendation(
                type="insufficient_data",
                message="Collect more real delivery outcomes before comparing performance.",
                evidence={"total_count": total_count, "min_sample_size": request.min_sample_size},
            )
        )
    elif high_failure_segments:
        worst_segment = high_failure_segments[0]
        recommendations.append(
            CampaignRecommendation(
                type="review_segment_delivery",
                message=(
                    f"Review delivery quality for {worst_segment.dimension} "
                    f"{worst_segment.label}; its failure rate is above threshold."
                ),
                evidence={
                    "dimension": worst_segment.dimension,
                    "label": worst_segment.label,
                    "failure_rate": worst_segment.failure_rate,
                    "threshold": request.high_failure_threshold,
                    "total_count": worst_segment.total_count,
                },
            )
        )

    return CampaignAnalyticsResponse(
        total_count=total_count,
        sent_count=request.sent_count,
        failed_count=request.failed_count,
        failure_rate=failure_rate,
        insufficient_data=insufficient_data,
        segments=segments,
        high_failure_segments=high_failure_segments,
        recommendations=recommendations,
    )

