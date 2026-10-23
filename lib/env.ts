// Public Supabase settings. Both are safe to ship to the browser: the
// publishable key only grants what RLS allows the `anon` / `authenticated`
// roles. The privileged key is deliberately NOT read here; it lives in
// lib/server-env.ts, which is server-only.
export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
export const SUPABASE_PUBLISHABLE_KEY = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// process.env.NEXT_PUBLIC_* must be referenced literally for Next to inline
// it into the browser bundle, which is why the values are passed in rather
// than looked up by name.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
