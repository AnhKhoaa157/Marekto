import { getBillingPlanCatalog, type BillingPlan } from "./billing.ts";
import { initializeDatabase, query } from "./db.ts";
import {
  LIMIT_KEYS,
  PLAN_CODES,
  type LimitKey,
  type PlanCode,
} from "./entitlements.ts";

export type BillingPlanUpdateInput = {
  checkoutEnabled: boolean;
  code: PlanCode;
  currency: string;
  description: string;
  features: string[];
  limits: Record<LimitKey, number | null>;
  monthlyAmountCents: number;
  name: string;
};

const MAX_AMOUNT = 99_000_000;
const MAX_LIMIT = 10_000_000;
const MAX_FEATURES = 12;

function firstFormValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parsePlanCode(value: string): PlanCode {
  if (PLAN_CODES.includes(value as PlanCode)) {
    return value as PlanCode;
  }

  throw new Error("Billing plan code is invalid");
}

function parseRequiredText(
  value: string,
  fieldName: string,
  maxLength: number,
): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} is too long`);
  }

  return trimmed;
}

function parseAmount(value: string): number {
  const amount = Number(value);

  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT) {
    throw new Error("Monthly amount must be a non-negative integer");
  }

  return amount;
}

function parseCurrency(value: string): string {
  const currency = value.trim().toLowerCase();

  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error("Currency must be a 3-letter ISO currency code");
  }

  return currency;
}

function parseLimit(value: string, limitKey: LimitKey): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const limit = Number(trimmed);

  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_LIMIT) {
    throw new Error(`${limitKey} must be blank or a non-negative integer`);
  }

  return limit;
}

function parseFeatures(value: string): string[] {
  const features = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_FEATURES);

  if (features.length === 0) {
    throw new Error("At least one plan feature is required");
  }

  for (const feature of features) {
    if (feature.length > 160) {
      throw new Error("Plan feature text is too long");
    }
  }

  return features;
}

export function parseBillingPlanUpdateForm(
  formData: FormData,
): BillingPlanUpdateInput {
  const code = parsePlanCode(firstFormValue(formData, "planCode"));
  const limits = {} as Record<LimitKey, number | null>;

  for (const limitKey of LIMIT_KEYS) {
    limits[limitKey] = parseLimit(
      firstFormValue(formData, `limit:${limitKey}`),
      limitKey,
    );
  }

  return {
    checkoutEnabled: firstFormValue(formData, "checkoutEnabled") === "on",
    code,
    currency: parseCurrency(firstFormValue(formData, "currency")),
    description: parseRequiredText(
      firstFormValue(formData, "description"),
      "Description",
      240,
    ),
    features: parseFeatures(firstFormValue(formData, "features")),
    limits,
    monthlyAmountCents: parseAmount(firstFormValue(formData, "monthlyAmountCents")),
    name: parseRequiredText(firstFormValue(formData, "name"), "Name", 80),
  };
}

export async function loadAdminBillingPlans(): Promise<BillingPlan[]> {
  return getBillingPlanCatalog();
}

export async function updateAdminBillingPlan(
  input: BillingPlanUpdateInput,
): Promise<void> {
  await initializeDatabase();
  await query(
    'UPDATE "Billing_plans" SET name = $2, description = $3, ' +
      "monthly_amount_cents = $4, currency = $5, checkout_enabled = $6, " +
      "limits = $7::jsonb, features = $8::jsonb, updated_at = NOW() " +
      "WHERE plan_code = $1",
    [
      input.code,
      input.name,
      input.description,
      input.monthlyAmountCents,
      input.currency,
      input.checkoutEnabled,
      JSON.stringify(input.limits),
      JSON.stringify(input.features),
    ],
  );
}
