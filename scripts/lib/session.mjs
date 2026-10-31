// Test helpers: sign real users in against LOCAL Supabase the way the app
// does (generateLink, then verifyOtp on the token_hash). Never point these at
// hosted Supabase: they create users and set roles with the service role.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error("Supabase env missing (.env.local); is it set up?");
  }
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error(
      `Refusing to run test sign-ins against ${host}: local Supabase only.`,
    );
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Sets profiles.role with the service role. No JWT, so the role-guard
// trigger allows it, exactly like bootstrapping an organizer.
export async function setRole(userId, role) {
  const { error } = await admin()
    .from("profiles")
    .update({ role })
    .eq("user_id", userId);
  if (error) throw new Error(`set role: ${error.message}`);
}

/**
 * Signs `email` in and returns { cookie, userId, client }: the auth cookies
 * as a Cookie header for HTTP requests, and a Supabase client holding the
 * same session for reading through RLS as that user.
 */
export async function signIn(email, role = "participant") {
  const { data, error } = await admin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    throw new Error(`generateLink: ${error.message} (npx supabase start?)`);
  }
  // Explicit, so a re-run starts from a known role.
  await setRole(data.user.id, role);

  const jar = new Map();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) =>
          cookies.forEach(({ name, value }) =>
            value ? jar.set(name, value) : jar.delete(name),
          ),
      },
    },
  );
  const { error: verifyError } = await client.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: data.properties.verification_type,
  });
  if (verifyError) throw new Error(`verifyOtp: ${verifyError.message}`);
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return { cookie, userId: data.user.id, client };
}
