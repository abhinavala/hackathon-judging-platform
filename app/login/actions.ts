"use server";

import { normalizeEmail, sendSignInLink } from "@/lib/auth/magic-link";

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string; email?: string };

// Mints a link server-side and hands it to the configured sender. Supabase's
// own mailer is never involved.
export async function requestSignInLink(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = normalizeEmail(formData.get("email"));
  if (!email) {
    return { status: "error", message: "Enter a valid email address." };
  }

  try {
    await sendSignInLink(email);
  } catch (err) {
    console.error("[auth] sign-in link failed", { email, err });
    return {
      status: "error",
      email,
      message:
        "We couldn't send your sign-in link. Try again in a minute, or ask an organizer for your team's join code.",
    };
  }
  return { status: "sent", email };
}
