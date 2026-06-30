const MAX_PROFILE_NAME_LENGTH = 120;
const MAX_PROFILE_PHONE_LENGTH = 40;

export type ProfileUpdate = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionalProfileText(
  body: Record<string, unknown>,
  fieldName: "first_name" | "last_name" | "phone",
  maxLength: number,
): string | null {
  const value = body[fieldName];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Profile fields must be strings");
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  if (trimmedValue.length > maxLength) {
    throw new Error(`${fieldName} is too long`);
  }

  return trimmedValue;
}

export function parseProfileUpdateBody(body: unknown): ProfileUpdate {
  if (!isRecord(body)) {
    throw new Error("Profile payload must be a JSON object");
  }

  return {
    firstName: parseOptionalProfileText(
      body,
      "first_name",
      MAX_PROFILE_NAME_LENGTH,
    ),
    lastName: parseOptionalProfileText(body, "last_name", MAX_PROFILE_NAME_LENGTH),
    phone: parseOptionalProfileText(body, "phone", MAX_PROFILE_PHONE_LENGTH),
  };
}

export function isProfileValidationError(message: string): boolean {
  return [
    "Profile payload must be a JSON object",
    "Profile fields must be strings",
    "first_name is too long",
    "last_name is too long",
    "phone is too long",
  ].includes(message);
}
