from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import Header, HTTPException, Request, status

from app.config import Settings, load_settings


def build_signature(secret: str, timestamp: str, body: bytes) -> str:
    digest = hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("utf-8") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    return f"sha256={digest}"


def verify_signature(secret: str, timestamp: str, body: bytes, signature: str) -> bool:
    expected = build_signature(secret, timestamp, body)
    return hmac.compare_digest(expected, signature)


async def require_internal_request(
    request: Request,
    x_marekto_timestamp: str | None = Header(default=None),
    x_marekto_signature: str | None = Header(default=None),
    settings: Settings | None = None,
) -> None:
    resolved_settings = settings or load_settings()

    if not resolved_settings.internal_service_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal service authentication is not configured",
        )

    if not x_marekto_timestamp or not x_marekto_signature:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing internal request signature",
        )

    try:
        request_timestamp = int(x_marekto_timestamp)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal request timestamp",
        ) from exc

    if abs(int(time.time()) - request_timestamp) > resolved_settings.request_skew_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Internal request timestamp is outside the allowed window",
        )

    body = await request.body()
    if not verify_signature(
        resolved_settings.internal_service_secret,
        x_marekto_timestamp,
        body,
        x_marekto_signature,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal request signature",
        )

