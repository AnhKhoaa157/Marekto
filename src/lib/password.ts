import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, derivedKeyHex] = storedHash.split(":");

  if (!saltHex || !derivedKeyHex) {
    return false;
  }

  try {
    const expectedKey = Buffer.from(derivedKeyHex, "hex");
    const actualKey = scryptSync(
      password,
      Buffer.from(saltHex, "hex"),
      expectedKey.length,
    );

    return (
      actualKey.length === expectedKey.length &&
      timingSafeEqual(actualKey, expectedKey)
    );
  } catch {
    return false;
  }
}
