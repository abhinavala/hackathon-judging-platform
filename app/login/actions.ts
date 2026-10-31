"use server";

import { redirect } from "next/navigation";
import { normalizeEmail, sendSignInLink } from "@/lib/auth/magic-link";

// Mints a link server-side and hands it to the configured sender. Supabase's
// own mailer is never involved.
//
// Ends in a redirect, never returned state, so the outcome is in the URL and
// rendered as plain HTML: it works when JavaScript fails to load (common on
// venue wifi with 250 phones). A form that appeared to do nothing would make
// people press again, and every new link replaces the one already sent.
export async function requestSignInLink(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  if (!email) redirect("/login?error=invalid-email");

  let sent = true;
  try {
    await sendSignInLink(email);
  } catch (err) {
    console.error("[auth] sign-in link failed", { email, err });
    sent = false;
  }
  // redirect() throws, so it stays outside the try.
  redirect(
    sent
      ? `/login?${new URLSearchParams({ sent: email })}`
      : `/login?${new URLSearchParams({ error: "send-failed", email })}`,
  );
}
