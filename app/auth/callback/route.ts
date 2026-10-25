import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readClaims } from "@/lib/supabase/claims";
import { VERIFIABLE_TYPES } from "@/lib/auth/magic-link";

// Magic-link landing. Two branches, and both must stay:
//
// - token_hash + type: the links we mint with generateLink() and deliver
//   ourselves (lib/auth/magic-link.ts). Consumed with verifyOtp(), so the link
//   works in whatever browser opens it, including a phone that never saw the
//   login page. This is the primary path; the whole delivery mechanism
//   depends on it.
// - code: Supabase's default PKCE template, should a link ever come from
//   Supabase's own mailer. Only works in the browser that requested it.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();
  let error: { code?: string } | null = null;

  if (tokenHash && isVerifiableType(type)) {
    ({ error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    error = { code: "invalid_link" };
  }

  if (!error) return redirectTo(next);

  // A second click on a link that already signed this browser in (or a mail
  // app opening it twice) shouldn't show an error to someone who is in.
  const { status } = await readClaims(supabase);
  if (status === "signed-in") return redirectTo(next);

  // otp_expired covers expired, already used, and superseded by a newer link.
  // Pass the address back so /login can offer a one-click resend.
  const params = new URLSearchParams({
    error: error.code === "otp_expired" ? "expired" : "invalid",
  });
  const email = searchParams.get("email");
  if (email) params.set("email", email);
  return redirectTo(`/login?${params}`);
}

// A relative Location, so the browser stays on whatever host it opened the
// link on. request.nextUrl.origin is the server's configured hostname (in dev,
// "localhost" even when the link said 127.0.0.1), and redirecting there would
// leave the new session cookie behind on the other host. Cookies set through
// next/headers are still attached to this response.
function redirectTo(path: string) {
  return new Response(null, { status: 307, headers: { Location: path } });
}

function isVerifiableType(type: string | null): type is EmailOtpType {
  return VERIFIABLE_TYPES.some((t) => t === type);
}

// Only allow same-origin relative paths, so the link can't bounce a user to
// another site. Browsers treat a backslash like "/", so "/\evil.example" is
// as off-site as "//evil.example"; reject backslashes and control characters.
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/me";
  if (/[\\\x00-\x1f]/.test(next)) return "/me";
  return next;
}
