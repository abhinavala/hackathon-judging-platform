import {
  isAuthApiError,
  type JwtPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

export type ClaimsResult =
  | { status: "signed-in"; claims: JwtPayload }
  // No session, or a session cookie auth-js couldn't parse (it reports both
  // the same way, without an error).
  | { status: "none"; claims: null }
  // The token was rejected: the cookie is unusable and should be deleted,
  // not carried on every future request.
  | { status: "rejected"; claims: null }
  // The auth server couldn't be reached or failed. Says nothing about the
  // cookie; clearing it would sign everyone out during an auth-server blip.
  | { status: "unavailable"; claims: null };

// Verified claims for the current session, never throwing.
//
// getClaims() verifies the JWT signature against the project's JWKS, or falls
// back to getUser() (a round trip to the auth server) for HS256 tokens. It
// never trusts the cookie unverified, unlike getSession(), which must not be
// used for any authorization decision.
//
// Some malformed tokens make it throw a plain Error rather than return one
// (an unknown `alg`, a key that won't import); those count as rejected.
export async function readClaims(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<ClaimsResult> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) {
      return isRejection(error)
        ? { status: "rejected", claims: null }
        : { status: "unavailable", claims: null };
    }
    return data?.claims?.sub
      ? { status: "signed-in", claims: data.claims }
      : { status: "none", claims: null };
  } catch {
    return { status: "rejected", claims: null };
  }
}

// A local signature/format failure, or a 4xx from the auth server on the
// getUser() fallback (bad_jwt, user or session gone).
function isRejection(error: Error): boolean {
  if (error.name === "AuthInvalidJwtError") return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500;
}

// supabase-js's default session cookie: sb-<first host label>-auth-token,
// split into .0, .1, ... chunks when large. The PKCE code-verifier cookie is
// deliberately excluded, so clearing a bad session can't break a sign-in
// that is in progress.
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

export function isSessionCookie(name: string): boolean {
  if (name === STORAGE_KEY) return true;
  const chunk = `${STORAGE_KEY}.`;
  return name.startsWith(chunk) && /^\d+$/.test(name.slice(chunk.length));
}
