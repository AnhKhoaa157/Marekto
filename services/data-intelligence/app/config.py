import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str = "marekto-data-intelligence"
    service_version: str = "0.1.0"
    internal_service_secret: str | None = None
    max_request_rows: int = 1_000
    request_skew_seconds: int = 300


def load_settings() -> Settings:
    max_request_rows = int(os.getenv("DATA_INTELLIGENCE_MAX_REQUEST_ROWS", "1000"))
    request_skew_seconds = int(os.getenv("DATA_INTELLIGENCE_REQUEST_SKEW_SECONDS", "300"))

    if max_request_rows < 1 or max_request_rows > 10_000:
        raise ValueError("DATA_INTELLIGENCE_MAX_REQUEST_ROWS must be between 1 and 10000")

    if request_skew_seconds < 30 or request_skew_seconds > 3600:
        raise ValueError("DATA_INTELLIGENCE_REQUEST_SKEW_SECONDS must be between 30 and 3600")

    secret = os.getenv("DATA_INTELLIGENCE_INTERNAL_SECRET", "").strip() or None

    return Settings(
        internal_service_secret=secret,
        max_request_rows=max_request_rows,
        request_skew_seconds=request_skew_seconds,
    )
