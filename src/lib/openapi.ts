/**
 * OpenAPI 3.0 specification for the Marekto multi-tenant API.
 *
 * This document is served as JSON from `/api/openapi.json` and rendered by the
 * Swagger UI page at `/api-docs`. It mirrors the real route handlers: the auth
 * endpoints are public, while tenant-scoped resource routes are guarded by the
 * `BearerAuth` JWT scheme. The proxy decodes that JWT and injects the
 * verified UUID `x-workspace-id` downstream, so callers authenticate with the
 * token alone rather than supplying the workspace header by hand.
 */

const SUCCESS_ENVELOPE_REF = "#/components/schemas/SuccessEnvelope";
const ERROR_ENVELOPE_REF = "#/components/schemas/ErrorEnvelope";

export const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Marekto Multi-Tenant API Documentation",
    version: "1.0.0",
    description:
      "REST API for the Marekto marketing automation platform. Workspaces are the tenant boundary; tenant-scoped routes require a JWT issued by the auth endpoints and the workspace context is resolved server-side from that token.",
  },
  servers: [{ url: "/", description: "Current origin" }],
  tags: [
    { name: "Auth", description: "Registration, login, and logout" },
    { name: "Profile", description: "Authenticated user profile" },
    { name: "AI", description: "Authenticated AI-assisted workflows" },
    { name: "Billing", description: "Workspace billing and subscriptions" },
    { name: "Lists", description: "Contact lists (tenant-scoped)" },
    { name: "Campaigns", description: "Email campaigns (tenant-scoped)" },
    { name: "Worker", description: "Background / system triggers" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "JWT issued by /api/auth/login or /api/auth/register. Send as `Authorization: Bearer <token>` (the auth_token cookie is also accepted).",
      },
    },
    schemas: {
      SuccessEnvelope: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: { type: "object" },
        },
        required: ["success", "data"],
      },
      ErrorEnvelope: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string", example: "Unauthorized: Missing token" },
        },
        required: ["success", "error"],
      },
      AuthData: {
        type: "object",
        properties: {
          token: { type: "string", description: "Signed JWT" },
          userId: { type: "string", format: "uuid" },
          workspaceId: { type: "string", format: "uuid", nullable: true },
          nextPath: { type: "string", example: "/dashboard" },
        },
        required: ["token", "userId", "workspaceId", "nextPath"],
      },
      AuthResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: { $ref: "#/components/schemas/AuthData" },
        },
        required: ["success", "data"],
      },
      RegistrationOtpData: {
        type: "object",
        properties: {
          verificationRequired: { type: "boolean", example: true },
          email: { type: "string", format: "email", example: "owner@acme.com" },
          expiresInSeconds: { type: "integer", example: 600 },
          developmentOtp: {
            type: "string",
            example: "123456",
            description:
              "Development-only verification code. Never returned in production.",
          },
        },
        required: ["verificationRequired", "email", "expiresInSeconds"],
      },
      RegistrationOtpResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: { $ref: "#/components/schemas/RegistrationOtpData" },
        },
        required: ["success", "data"],
      },
      LogoutData: {
        type: "object",
        properties: {
          authenticated: { type: "boolean", example: false },
        },
        required: ["authenticated"],
      },
      LogoutResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: { $ref: "#/components/schemas/LogoutData" },
        },
        required: ["success", "data"],
      },
      ProfileData: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email", example: "user@example.com" },
          role: { type: "string", example: "user" },
          first_name: { type: "string", nullable: true, example: "First" },
          last_name: { type: "string", nullable: true, example: "Last" },
          phone: { type: "string", nullable: true, example: "+84000000000" },
          created_at: { type: "string", format: "date-time" },
        },
        required: ["id", "email", "role", "first_name", "last_name", "phone"],
      },
      ProfileResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: { $ref: "#/components/schemas/ProfileData" },
        },
        required: ["success", "data"],
      },
      UpdateProfileRequest: {
        type: "object",
        properties: {
          first_name: { type: "string", nullable: true, maxLength: 120 },
          last_name: { type: "string", nullable: true, maxLength: 120 },
          phone: { type: "string", nullable: true, maxLength: 40 },
        },
      },
      RegisterRequest: {
        type: "object",
        properties: {
          email: { type: "string", format: "email", example: "owner@acme.com" },
          password: { type: "string", format: "password", example: "s3cret-pass" },
          workspaceName: {
            type: "string",
            example: "Acme Marketing",
            description: "Optional; defaults to \"Workspace of <email>\".",
          },
        },
        required: ["email", "password"],
      },
      VerifyRegistrationRequest: {
        type: "object",
        properties: {
          email: { type: "string", format: "email", example: "owner@acme.com" },
          otp: { type: "string", example: "123456" },
        },
        required: ["email", "otp"],
      },
      LoginRequest: {
        type: "object",
        properties: {
          email: {
            type: "string",
            format: "email",
            example: "admin@marekto.com",
            description: "Either email or username may be supplied.",
          },
          username: { type: "string", example: "admin@marekto.com" },
          password: { type: "string", format: "password", example: "password" },
        },
        required: ["password"],
      },
      CreateListRequest: {
        type: "object",
        properties: {
          name: { type: "string", example: "Newsletter subscribers" },
          description: {
            type: "string",
            nullable: true,
            example: "Opted-in marketing contacts",
          },
        },
        required: ["name"],
      },
      CreateCampaignRequest: {
        type: "object",
        properties: {
          name: { type: "string", example: "Spring launch" },
          template_id: {
            type: "string",
            format: "uuid",
            nullable: true,
            description: "References a Template in the same workspace.",
          },
          status: {
            type: "string",
            enum: ["draft", "pending"],
            default: "draft",
            description:
              "Users may create drafts or pending campaigns. processing, sent, and failed are worker-owned states.",
          },
          target_filters: {
            type: "object",
            additionalProperties: true,
            description:
              "JSONB audience filter. Keys matching Contact columns (email, first_name, last_name, phone) match directly; any other key matches the Contact's JSONB properties.",
            example: { country: "VN", first_name: "Khoa" },
          },
          ai_personalization_enabled: {
            type: "boolean",
            default: false,
            description:
              "When true, the worker personalizes each recipient's email with Gemini before SMTP delivery, falling back to the raw template if Gemini is unavailable. When false, the raw template is sent as-is.",
          },
          ai_context: {
            $ref: "#/components/schemas/CampaignAiContext",
          },
          scheduled_at: {
            type: "string",
            format: "date-time",
            nullable: true,
            example: "2026-07-01T09:00:00.000Z",
          },
        },
        required: ["name"],
      },
      SegmentationRequest: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            maxLength: 500,
            description: "Natural-language description of the intended campaign audience.",
          },
        },
        required: ["prompt"],
      },
      CampaignTargetFilters: {
        type: "object",
        properties: {
          city: { type: "string" },
          lead_score_gt: { type: "number", minimum: 0, maximum: 100 },
          lead_score_gte: { type: "number", minimum: 0, maximum: 100 },
          lead_score_lt: { type: "number", minimum: 0, maximum: 100 },
          lead_score_lte: { type: "number", minimum: 0, maximum: 100 },
          tags_contains: { type: "string" },
        },
        additionalProperties: false,
      },
      CampaignAiContext: {
        type: "object",
        description:
          "Optional campaign-specific guidance for email personalization. These fields guide tone and intent only; they cannot override template/contact facts, URLs, compliance content, or validation.",
        properties: {
          goal: { type: "string", maxLength: 500 },
          tone: { type: "string", maxLength: 100 },
          cta: { type: "string", maxLength: 300 },
          audience_description: { type: "string", maxLength: 500 },
          language: { type: "string", maxLength: 50 },
        },
        additionalProperties: false,
        example: {
          goal: "announce a seasonal offer",
          tone: "friendly",
          cta: "book a demo",
          audience_description: "VIP customers in HCM",
          language: "en",
        },
      },
      SegmentationResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: {
            type: "object",
            properties: {
              target_filters: { $ref: "#/components/schemas/CampaignTargetFilters" },
              source: {
                type: "string",
                enum: ["gemini", "cache"],
                description:
                  "gemini means fresh provider output; cache means a validated exact-match workspace cache was reused because the provider was unavailable.",
              },
            },
            required: ["target_filters", "source"],
          },
        },
        required: ["success", "data"],
      },
      CampaignBuilderRequest: {
        type: "object",
        description:
          "Campaign idea inputs. Only these fields are accepted; workspace_id and any other key is rejected. No contact records are sent to the AI provider.",
        properties: {
          productOrService: { type: "string", maxLength: 200, example: "Online English course for beginners" },
          campaignGoal: { type: "string", maxLength: 300, example: "Increase signups for the July cohort" },
          targetAudiencePrompt: {
            type: "string",
            maxLength: 500,
            description: "Natural-language audience description only; never real contacts.",
            example: "Contacts in HCM with lead score over 70 and interested in education",
          },
          tone: { type: "string", maxLength: 100, example: "Friendly, motivating, professional" },
          offerOrCTA: { type: "string", maxLength: 300, example: "Register now to get 20% off" },
          schedulePreference: { type: "string", maxLength: 200, example: "Send this Friday morning" },
          enablePersonalization: { type: "boolean", default: false },
        },
        required: ["productOrService", "campaignGoal", "targetAudiencePrompt"],
        additionalProperties: false,
      },
      CampaignBuilderResponse: {
        type: "object",
        description:
          "A reviewable draft campaign package. It is not a delivery result and never affects dashboard metrics. Generated content is validated and sanitized before it is returned.",
        properties: {
          success: { type: "boolean", example: true },
          data: {
            type: "object",
            properties: {
              campaignName: { type: "string", example: "July Beginner English Signup Push" },
              brief: { type: "string" },
              audienceExplanation: { type: "string" },
              targetFilters: { $ref: "#/components/schemas/CampaignTargetFilters" },
              filtersValid: {
                type: "boolean",
                description:
                  "false when unsupported suggested filters were dropped; the UI blocks the campaign draft save until the audience is corrected or all contacts are chosen.",
              },
              subjectIdeas: { type: "array", items: { type: "string" }, maxItems: 6 },
              emailHtml: { type: "string", description: "Complete, editable draft HTML email content." },
              aiContext: { $ref: "#/components/schemas/CampaignAiContext" },
              scheduleNotes: { type: "string" },
              warnings: { type: "array", items: { type: "string" }, maxItems: 12 },
            },
            required: [
              "campaignName",
              "brief",
              "audienceExplanation",
              "targetFilters",
              "filtersValid",
              "subjectIdeas",
              "emailHtml",
              "aiContext",
              "scheduleNotes",
              "warnings",
            ],
          },
        },
        required: ["success", "data"],
      },
      BillingCheckoutRequest: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            enum: ["pro", "team"],
            description:
              "Requested paid plan. Price/provider ids are resolved server-side.",
          },
        },
        required: ["plan"],
        additionalProperties: false,
      },
      BillingCheckoutResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: {
            type: "object",
            properties: {
              url: {
                type: "string",
                format: "uri",
                description: "Provider checkout URL or mock checkout URL.",
              },
              order: { type: "object" },
            },
            required: ["url", "order"],
          },
        },
        required: ["success", "data"],
      },
      BillingStatusResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: {
            type: "object",
            properties: {
              provider: { type: "string", enum: ["mock", "stripe", "sepay"] },
              providerConfigured: { type: "boolean" },
              plans: { type: "array", items: { type: "object" } },
              subscription: { type: "object" },
              pendingOrders: { type: "array", items: { type: "object" } },
              usage: { type: "object" },
            },
            required: [
              "provider",
              "providerConfigured",
              "plans",
              "subscription",
              "pendingOrders",
              "usage",
            ],
          },
        },
        required: ["success", "data"],
      },
      BillingPortalResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: {
            type: "object",
            properties: {
              url: { type: "string", format: "uri" },
            },
            required: ["url"],
          },
        },
        required: ["success", "data"],
      },
      BillingWebhookResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: {
            type: "object",
            properties: {
              processed: { type: "boolean" },
              eventId: { type: "string" },
            },
            required: ["processed", "eventId"],
          },
        },
        required: ["success", "data"],
      },
      SepayWebhookRequest: {
        type: "object",
        description:
          "SePay bank transaction webhook payload. In sandbox, include the Marekto payment code (MKT...) in code, content, or description.",
        properties: {
          id: { oneOf: [{ type: "integer" }, { type: "string" }] },
          gateway: { type: "string", example: "Vietcombank" },
          transactionDate: { type: "string", example: "2026-07-07 11:08:33" },
          accountNumber: { type: "string" },
          code: { type: "string", example: "MKT123456789ABC" },
          content: {
            type: "string",
            example: "MKT123456789ABC chuyen tien",
          },
          transferType: { type: "string", enum: ["in", "out"], example: "in" },
          transferAmount: { type: "integer", example: 99000 },
          accumulated: { type: "integer" },
          referenceCode: { type: "string", example: "FT24012345678" },
        },
        required: ["id", "transferType", "transferAmount"],
        additionalProperties: true,
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid JWT.",
        content: {
          "application/json": {
            schema: { $ref: ERROR_ENVELOPE_REF },
          },
        },
      },
      BadRequest: {
        description: "Validation failed.",
        content: {
          "application/json": {
            schema: { $ref: ERROR_ENVELOPE_REF },
          },
        },
      },
      ServerError: {
        description: "Unexpected server error.",
        content: {
          "application/json": {
            schema: { $ref: ERROR_ENVELOPE_REF },
          },
        },
      },
    },
  },
  paths: {
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Start registration and email an OTP",
        description:
          "Validates the requested account, stores a pending registration with hashed secrets, and sends a real OTP email. Workspace creation is optional; the account is created only after /api/auth/register/verify succeeds.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RegisterRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "OTP sent. Verify the code to create the account.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegistrationOtpResponse" },
              },
            },
          },
          "400": {
            description: "Invalid input or email already registered.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/auth/register/verify": {
      post: {
        tags: ["Auth"],
        summary: "Verify registration OTP and create workspace",
        description:
          "Verifies the emailed OTP, creates the User and optionally the first owner Workspace_members binding, then returns a signed JWT and sets the auth_token cookie. If no workspace was requested, workspaceId is null and nextPath points to onboarding.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VerifyRegistrationRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Registered. Returns JWT, userId, workspaceId, and nextPath.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "400": {
            description: "Invalid or expired OTP, invalid input, or email already registered.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Authenticate and receive a JWT",
        description:
          "Validates credentials, resolves the user's default workspace if one exists, returns a signed JWT and sets the auth_token cookie. Users without a workspace receive workspaceId null and an onboarding nextPath.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Authenticated. Returns JWT, userId, workspaceId, and nextPath.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": {
            description: "Invalid credentials.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Clear the authentication cookie",
        description:
          "Expires the auth_token cookie for browser sessions. Bearer tokens already issued remain valid until their normal JWT expiration.",
        security: [],
        responses: {
          "200": {
            description: "Signed out. The auth_token cookie is expired.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LogoutResponse" },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/profile": {
      get: {
        tags: ["Profile"],
        summary: "Fetch the authenticated user profile",
        description:
          "Returns the profile fields for the signed-in user. The route is protected by JWT/cookie authentication.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Authenticated profile.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProfileResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": {
            description: "Profile row not found.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
      patch: {
        tags: ["Profile"],
        summary: "Update the authenticated user profile",
        description:
          "Updates editable personal profile fields for the signed-in user.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateProfileRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated profile.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProfileResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": {
            description: "Profile row not found.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/lists": {
      post: {
        tags: ["Lists"],
        summary: "Create a contact list",
        description:
          "Tenant-scoped. The workspace is resolved from the JWT by the proxy and injected as x-workspace-id.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateListRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "List created.",
            content: {
              "application/json": {
                schema: { $ref: SUCCESS_ENVELOPE_REF },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": { $ref: "#/components/responses/ServerError" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/ai/segmentation": {
      post: {
        tags: ["AI"],
        summary: "Generate campaign audience filters",
        description:
          "Tenant-authenticated. Converts a natural-language audience description into validated campaign target_filters using Gemini 2.5 Flash. No contact records are sent to the AI provider.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SegmentationRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Validated audience filters generated.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SegmentationResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/ai/campaign-builder": {
      post: {
        tags: ["AI"],
        summary: "Generate a reviewable campaign package",
        description:
          "Tenant-authenticated. Turns a campaign idea into a validated, reviewable draft package (name, brief, audience explanation, supported target_filters, subject ideas, editable email HTML, ai_context, and schedule notes) using Gemini 2.5 Flash. No contact records are sent to the provider and no delivery, sending, or scheduling occurs. The generated content is a draft the user edits and then saves through POST /api/templates and POST /api/campaigns.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CampaignBuilderRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Validated reviewable campaign draft package.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CampaignBuilderResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": {
            description: "AI provider is temporarily unavailable.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": {
            description:
              "The provider returned output that could not be validated into a safe draft.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
        },
      },
    },
    "/api/billing/checkout": {
      post: {
        tags: ["Billing"],
        summary: "Create a billing checkout order",
        description:
          "Owner-only. Creates a pending payment order and returns a provider checkout URL. The requested plan is allowlisted server-side; clients cannot submit price ids or workspace ids.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BillingCheckoutRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Checkout order created.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BillingCheckoutResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Workspace owner access required.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "503": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/billing/status": {
      get: {
        tags: ["Billing"],
        summary: "Read workspace billing status",
        description:
          "Owner-only. Returns current subscription, provider readiness, pending orders, plan catalog, and Phase 17 usage/limit data.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Billing status.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BillingStatusResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Workspace owner access required.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
        },
      },
    },
    "/api/billing/portal": {
      post: {
        tags: ["Billing"],
        summary: "Create a billing portal session",
        description:
          "Owner-only. Returns a provider billing portal URL when the configured provider supports one. The mock provider returns a clear unavailable error.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Billing portal session.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BillingPortalResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Workspace owner access required.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "501": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/billing/webhook": {
      post: {
        tags: ["Billing"],
        summary: "Receive provider billing webhooks",
        description:
          "Provider-facing endpoint. Mock verifies x-marekto-billing-signature and processes payment_order.paid/payment_order.failed. SePay sandbox accepts a bank transaction webhook, matches the MKT... payment code in code/content/description, and marks the order paid when transferType is in and transferAmount covers the order.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { type: "object", additionalProperties: true },
                  { $ref: "#/components/schemas/SepayWebhookRequest" },
                ],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Webhook processed or safely ignored as duplicate.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BillingWebhookResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/campaigns": {
      post: {
        tags: ["Campaigns"],
        summary: "Create an email campaign",
        description:
          "Tenant-scoped. Accepts an optional template_id (validated against the workspace) and a validated JSONB target_filters audience definition. Pending campaigns require scheduled_at.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateCampaignRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Campaign created.",
            content: {
              "application/json": {
                schema: { $ref: SUCCESS_ENVELOPE_REF },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": {
            description: "Referenced template not found in this workspace.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/campaigns/{id}/email-logs": {
      get: {
        tags: ["Campaigns"],
        summary: "Read campaign delivery logs and summary",
        description:
          "Tenant-scoped. Returns the campaign basics, a delivery summary derived from real Email_logs rows, and per-recipient log entries joined with workspace contacts. Recipient fields are null when the contact was deleted.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
            description: "Campaign id within the authenticated workspace.",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            description: "Maximum number of log rows to return.",
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
            description:
              "Pagination cursor: the id of the last log row from the previous page. Returns rows older than that entry (logs are ordered by sent time, newest first).",
          },
        ],
        responses: {
          "200": {
            description: "Campaign delivery logs and summary.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        campaign: {
                          type: "object",
                          properties: {
                            id: { type: "string", format: "uuid" },
                            name: { type: "string" },
                            status: { type: "string" },
                            failure_reason: { type: "string", nullable: true },
                            ai_personalization_enabled: { type: "boolean" },
                            ai_context: {
                              $ref: "#/components/schemas/CampaignAiContext",
                            },
                            scheduled_at: {
                              type: "string",
                              format: "date-time",
                              nullable: true,
                            },
                            run_at: {
                              type: "string",
                              format: "date-time",
                              nullable: true,
                            },
                          },
                        },
                        summary: {
                          type: "object",
                          description:
                            "Counts derived from Email_logs rows; zero counts when no logs exist.",
                          properties: {
                            total_recipients: { type: "integer" },
                            sent_count: { type: "integer" },
                            failed_count: { type: "integer" },
                            gemini_personalized_count: { type: "integer" },
                            template_sent_count: { type: "integer" },
                            ai_fallback_count: { type: "integer" },
                            first_sent_at: {
                              type: "string",
                              format: "date-time",
                              nullable: true,
                            },
                            last_sent_at: {
                              type: "string",
                              format: "date-time",
                              nullable: true,
                            },
                          },
                        },
                        logs: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              id: { type: "string", format: "uuid" },
                              contact_id: {
                                type: "string",
                                format: "uuid",
                                nullable: true,
                              },
                              recipient_email: { type: "string", nullable: true },
                              recipient_first_name: { type: "string", nullable: true },
                              recipient_last_name: { type: "string", nullable: true },
                              status: { type: "string", enum: ["sent", "failed"] },
                              error_message: { type: "string", nullable: true },
                              error_category: {
                                type: "string",
                                enum: [
                                  "none",
                                  "ai_fallback",
                                  "smtp_unconfigured",
                                  "smtp_failure",
                                  "template_missing",
                                  "no_recipients",
                                  "unknown",
                                ],
                              },
                              personalization_source: {
                                type: "string",
                                enum: ["gemini", "template"],
                                nullable: true,
                              },
                              personalization_error: {
                                type: "string",
                                nullable: true,
                              },
                              sent_at: {
                                type: "string",
                                format: "date-time",
                                nullable: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": {
            description: "Campaign not found in this workspace.",
            content: {
              "application/json": {
                schema: { $ref: ERROR_ENVELOPE_REF },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/worker/cron": {
      get: {
        tags: ["Worker"],
        summary: "Trigger the campaign-sending worker",
        description:
          "System trigger protected by CRON_SECRET in production. Claims due campaigns atomically per workspace, personalizes recipients with Gemini when the campaign enables it (falling back to the raw template), sends real SMTP email for each matched contact, and records sent or failed Email_logs with personalization_source and personalization_error for actual delivery outcomes.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Worker run summary.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        workspaces_processed: { type: "integer", example: 2 },
                        campaigns_processed: { type: "integer", example: 0 },
                        campaigns_failed: { type: "integer", example: 0 },
                        emails_sent: { type: "integer", example: 0 },
                        emails_failed: { type: "integer", example: 0 },
                        delivery_available: { type: "boolean", example: true },
                        details: { type: "array", items: { type: "object" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;
