import unittest

from app.schemas.scoring import LeadScoreRequest
from app.services.scoring import MODEL_VERSION, score_lead


class LeadScoringTests(unittest.TestCase):
    def test_scores_are_bounded_explainable_and_versioned(self) -> None:
        result = score_lead(
            LeadScoreRequest(
                email_valid=True,
                has_phone=True,
                city="Ho Chi Minh",
                tags=["VIP", "trial"],
                prior_sent_count=10,
                prior_failed_count=0,
            )
        )

        self.assertEqual(result.score, 98)
        self.assertEqual(result.labels, ["high_intent"])
        self.assertEqual(result.model_version, MODEL_VERSION)
        self.assertIn("high_intent_tags", [factor.name for factor in result.factors])

    def test_missing_or_bad_data_uses_neutral_and_repairable_factors(self) -> None:
        result = score_lead(
            LeadScoreRequest(
                email_valid=False,
                has_phone=None,
                tags=["do not contact"],
                prior_failed_count=20,
            )
        )

        self.assertEqual(result.score, 0)
        self.assertIn("data_quality_review", result.labels)
        factor_names = [factor.name for factor in result.factors]
        self.assertIn("neutral_baseline", factor_names)
        self.assertIn("invalid_email", factor_names)
        self.assertIn("delivery_failures", factor_names)


if __name__ == "__main__":
    unittest.main()

