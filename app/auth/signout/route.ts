import { createClient } from "@/lib/supabase/server";

// POST only, so a prefetch or an <img src> can't sign someone out.
//
// Public in the proxy and idempotent: with no session it does nothing and
// lands on the same page. scope "local" ends this browser's session only;
// signing out of a shared laptop shouldn't also sign the person out on their
// phone.
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  // 303 so the browser follows with a GET. Relative, to stay on this host
  // (see the note in app/auth/callback/route.ts).
  return new Response(null, { status: 303, headers: { Location: "/" } });
}
