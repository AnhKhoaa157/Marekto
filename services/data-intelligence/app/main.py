from fastapi import Depends, FastAPI

from app.config import load_settings
from app.schemas.analytics import CampaignAnalyticsRequest, CampaignAnalyticsResponse
from app.schemas.contacts import NormalizeContactsRequest, NormalizeContactsResponse
from app.schemas.health import HealthResponse
from app.schemas.scoring import LeadScoreRequest, LeadScoreResponse
from app.security import require_internal_request
from app.services.analytics import analyze_campaign
from app.services.normalization import normalize_contacts
from app.services.scoring import score_lead

settings = load_settings()

app = FastAPI(
    title="Marekto Data Intelligence",
    version=settings.service_version,
    docs_url=None,
    redoc_url=None,
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.service_name,
        version=settings.service_version,
        ready=settings.internal_service_secret is not None,
    )


@app.post(
    "/v1/contacts/normalize",
    response_model=NormalizeContactsResponse,
    dependencies=[Depends(require_internal_request)],
)
def normalize_contacts_endpoint(request: NormalizeContactsRequest) -> NormalizeContactsResponse:
    return normalize_contacts(request)


@app.post(
    "/v1/campaigns/analyze",
    response_model=CampaignAnalyticsResponse,
    dependencies=[Depends(require_internal_request)],
)
def analyze_campaign_endpoint(request: CampaignAnalyticsRequest) -> CampaignAnalyticsResponse:
    return analyze_campaign(request)


@app.post(
    "/v1/leads/score",
    response_model=LeadScoreResponse,
    dependencies=[Depends(require_internal_request)],
)
def score_lead_endpoint(request: LeadScoreRequest) -> LeadScoreResponse:
    return score_lead(request)

