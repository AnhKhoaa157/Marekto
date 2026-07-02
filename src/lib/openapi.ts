/**
 * OpenAPI 3.0 specification for the Marekto multi-tenant API.
 *
 * This document is served as JSON from `/api/openapi.json` and rendered by the
 * Swagger UI page at `/api-docs`. It mirrors the real route handlers: the auth
 * endpoints are public, while tenant-scoped resource routes are guarded by the
 * `BearerAuth` JWT scheme. The proxy decodes that JWT and injects the
 * integer `x-workspace-id` downstream, so callers authenticate with the token
 * alone rather than supplying the workspace header by hand.
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
          userId: { type: "integer", example: 1 },
          workspaceId: { type: "integer", example: 1 },
        },
        required: ["token", "userId", "workspaceId"],
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
          id: { type: "integer", example: 1 },
          email: { type: "string", format: "email", example: "user@example.com" },
          role: { type: "string", example: "owner" },
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
            type: "integer",
            nullable: true,
            example: 12,
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
          "Validates the requested owner account, stores a pending registration with hashed secrets, and sends a real OTP email. The account is created only after /api/auth/register/verify succeeds.",
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
          "Verifies the emailed OTP, atomically creates the Workspace, User, and owner Workspace_members binding, then returns a signed JWT and sets the auth_token cookie.",
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
            description: "Registered. Returns JWT, userId and workspaceId.",
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
          "Validates credentials, resolves the user's integer workspace id, returns a signed JWT and sets the auth_token cookie.",
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
            description: "Authenticated. Returns JWT, userId and workspaceId.",
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
    "/api/worker/cron": {
      get: {
        tags: ["Worker"],
        summary: "Trigger the campaign-sending worker",
        description:
          "System trigger protected by CRON_SECRET in production. Claims due campaigns atomically per workspace, sends real SMTP email for each matched contact, and records sent or failed Email_logs for actual delivery outcomes.",
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
