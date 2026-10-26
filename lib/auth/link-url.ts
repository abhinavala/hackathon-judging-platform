// The sign-in link format, shared by the app (lib/auth/magic-link.ts) and
// scripts that mint links in bulk. Pure.
//
// The link points at our /auth/callback with a token_hash, consumed there by
// verifyOtp(); `email` lets an expired link offer a one-click resend.
export function callbackLink(
  siteUrl: string,
  tokenHash: string,
  type: string,
  email: string,
): string {
  const url = new URL("/auth/callback", siteUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("email", email);
  return url.toString();
}
