const HANDLE_PATTERN = /^[a-z][a-z0-9._]{2,29}$/;

const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "auth",
  "help",
  "moderator",
  "parul",
  "root",
  "security",
  "support",
]);

export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function validateHandle(value: string): {
  valid: boolean;
  normalized: string;
  reason?: "format" | "reserved" | "email_like" | "phone_like";
} {
  const normalized = normalizeHandle(value);

  if (normalized.includes("@")) {
    return { valid: false, normalized, reason: "email_like" };
  }

  if (/^\+?[\d\s()-]+$/.test(normalized)) {
    return { valid: false, normalized, reason: "phone_like" };
  }

  if (!HANDLE_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: "format" };
  }

  if (RESERVED_HANDLES.has(normalized)) {
    return { valid: false, normalized, reason: "reserved" };
  }

  return { valid: true, normalized };
}
