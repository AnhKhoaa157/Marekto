import unittest

from app.schemas.analytics import CampaignAnalyticsRequest, SegmentOutcomeInput
from app.services.analytics import analyze_campaign


class CampaignAnalyticsTests(unittest.TestCase):
    def test_reports_insufficient_data_without_inventing_recommendations(self) -> None:
        result = analyze_campaign(
            CampaignAnalyticsRequest(sent_count=3, failed_count=1, min_sample_size=10)
        )

        self.assertTrue(result.insufficient_data)
        self.assertEqual(result.failure_rate, 0.25)
        self.assertEqual(result.recommendations[0].type, "insufficient_data")

    def test_identifies_high_failure_segments_from_measured_data(self) -> None:
        result = analyze_campaign(
            CampaignAnalyticsRequest(
                sent_count=80,
                failed_count=20,
                min_sample_size=10,
                high_failure_threshold=0.25,
                segments=[
                    SegmentOutcomeInput(
                        dimension="city",
                        label="Ho Chi Minh",
                        sent_count=20,
                        failed_count=10,
                    ),
                    SegmentOutcomeInput(
                        dimension="tag",
                        label="vip",
                        sent_count=30,
                        failed_count=1,
                    ),
                ],
            )
        )

        self.assertFalse(result.insufficient_data)
        self.assertEqual(result.total_count, 100)
        self.assertEqual(len(result.high_failure_segments), 1)
        self.assertEqual(result.high_failure_segments[0].label, "Ho Chi Minh")
        self.assertEqual(result.recommendations[0].type, "review_segment_delivery")


if __name__ == "__main__":
    unittest.main()

