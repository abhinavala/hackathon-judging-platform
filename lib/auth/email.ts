// Pure: no env, no "server-only", so forms, scripts and tests share it.

// Light validation only; the auth server is the real judge of an address.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}
