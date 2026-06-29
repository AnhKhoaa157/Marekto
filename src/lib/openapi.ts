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
        summary: "Register a user and provision their workspace",
        description:
          "Atomically creates a Workspace, a User, and an owner Workspace_members binding, then returns a signed JWT and sets the auth_token cookie.",
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
          "201": {
            description: "Registered. Returns JWT, userId and workspaceId.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
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
          "System trigger protected by CRON_SECRET in production. Claims due campaigns atomically per workspace. Until SMTP delivery is implemented, claimed campaigns fail truthfully and no sent email logs are created.",
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
                        delivery_available: { type: "boolean", example: false },
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
