const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 20_000;
const FALLBACK_STATUS_CODES = new Set([401, 403, 429]);

type GeminiEnvironment = Record<string, string | undefined>;

type GeminiConfig = {
  apiKeys: string[];
  model: typeof GEMINI_MODEL;
  timeoutMs: number;
};

type GeminiContentPart = {
  text?: unknown;
};

type GeminiResponsePayload = {
  candidates?: Array<{
    content?: {
      parts?: GeminiContentPart[];
    };
  }>;
};

export type GeminiJsonRequest = {
  prompt: string;
  systemInstruction?: string;
  responseSchema?: Record<string, unknown>;
};

type GeminiDependencies = {
  env?: GeminiEnvironment;
  fetchImpl?: typeof fetch;
};

function parseFallbackKeys(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;,\r\n]+/)
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeoutMs = Number(value);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("GEMINI_TIMEOUT_MS must be an integer between 1000 and 120000");
  }

  return timeoutMs;
}

export function resolveGeminiConfig(
  env: GeminiEnvironment = process.env,
): GeminiConfig {
  const primaryKey = env.GEMINI_API_KEY?.trim();

  if (!primaryKey) {
    throw new Error("GEMINI_API_KEY is required");
  }

  const apiKeys = [primaryKey, ...parseFallbackKeys(env.GEMINI_FALLBACK_API_KEYS)]
    .filter((key, index, keys) => keys.indexOf(key) === index);

  return {
    apiKeys,
    model: GEMINI_MODEL,
    timeoutMs: parseTimeout(env.GEMINI_TIMEOUT_MS),
  };
}

function sanitizeGeminiError(message: string, apiKeys: string[]): string {
  return apiKeys.reduce(
    (sanitized, apiKey) => sanitized.replaceAll(apiKey, "***"),
    message,
  );
}

function extractResponseText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Gemini returned an invalid response");
  }

  const response = payload as GeminiResponsePayload;
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (text.length === 0) {
    throw new Error("Gemini returned an empty response");
  }

  return text;
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.text()).trim();

  if (body.length === 0) {
    return `Gemini request failed with status ${response.status}`;
  }

  return `Gemini request failed with status ${response.status}: ${body.slice(0, 500)}`;
}

function buildRequestBody(request: GeminiJsonRequest): Record<string, unknown> {
  const prompt = request.prompt.trim();

  if (prompt.length === 0) {
    throw new Error("Gemini prompt is required");
  }

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      ...(request.responseSchema
        ? { responseSchema: request.responseSchema }
        : {}),
    },
  };

  const systemInstruction = request.systemInstruction?.trim();

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  return body;
}

export async function generateGeminiJson(
  request: GeminiJsonRequest,
  dependencies: GeminiDependencies = {},
): Promise<unknown> {
  const config = resolveGeminiConfig(dependencies.env);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const requestBody = buildRequestBody(request);
  const endpoint = `${GEMINI_API_BASE_URL}/models/${config.model}:generateContent`;
  let lastFallbackError = "Gemini API is temporarily unavailable";

  for (const [index, apiKey] of config.apiKeys.entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorMessage = sanitizeGeminiError(
          await readErrorMessage(response),
          config.apiKeys,
        );

        if (FALLBACK_STATUS_CODES.has(response.status)) {
          lastFallbackError = errorMessage;

          if (index < config.apiKeys.length - 1) {
            continue;
          }

          throw new Error(
            `All configured Gemini API keys were rejected or rate-limited. ${lastFallbackError}`,
          );
        }

        throw new Error(errorMessage);
      }

      const payload: unknown = await response.json();
      return parseJsonResponse(extractResponseText(payload));
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Gemini request timed out after ${config.timeoutMs}ms`);
      }

      const message = sanitizeGeminiError(
        error instanceof Error ? error.message : "Gemini request failed",
        config.apiKeys,
      );
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastFallbackError);
}
