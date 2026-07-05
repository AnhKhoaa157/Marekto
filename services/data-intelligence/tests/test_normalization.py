import unittest

from app.schemas.contacts import NormalizeContactsRequest, RawContactRow
from app.services.normalization import normalize_contacts


class ContactNormalizationTests(unittest.TestCase):
    def test_normalizes_contact_rows_and_reports_warnings(self) -> None:
        result = normalize_contacts(
            NormalizeContactsRequest(
                rows=[
                    RawContactRow(
                        row_number=1,
                        email="  USER@Example.COM ",
                        first_name="  Linh   Anh ",
                        city="HCM",
                        tags=[" VIP ", "vip", "Pricing Lead"],
                        lead_score=72,
                        properties={"source": " csv ", "nested": {"ignored": True}},
                    )
                ]
            )
        )

        self.assertEqual(result.total_rows, 1)
        self.assertEqual(len(result.accepted), 1)
        self.assertEqual(result.rejected, [])
        accepted = result.accepted[0]
        self.assertEqual(accepted.email, "user@example.com")
        self.assertEqual(accepted.first_name, "Linh Anh")
        self.assertEqual(accepted.city, "Ho Chi Minh")
        self.assertEqual(accepted.tags, ["vip", "pricing_lead"])
        self.assertEqual(accepted.properties, {"source": "csv"})
        self.assertIn("city_normalized:Ho Chi Minh", accepted.warnings)
        self.assertIn("duplicate_tag:vip", accepted.warnings)

    def test_rejects_invalid_and_duplicate_email_rows(self) -> None:
        result = normalize_contacts(
            NormalizeContactsRequest(
                rows=[
                    RawContactRow(row_number=1, email="first@example.com"),
                    RawContactRow(row_number=2, email="not-an-email"),
                    RawContactRow(row_number=3, email="FIRST@example.com"),
                ]
            )
        )

        self.assertEqual([row.email for row in result.accepted], ["first@example.com"])
        self.assertEqual(
            [(row.row_number, row.reasons) for row in result.rejected],
            [(2, ["invalid_email"]), (3, ["duplicate_email"])],
        )
        self.assertEqual(result.duplicate_emails, ["first@example.com"])


if __name__ == "__main__":
    unittest.main()

