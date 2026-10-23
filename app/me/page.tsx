import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readClaims } from "@/lib/supabase/claims";
import { SignOutButton } from "@/app/sign-out-button";

// Reads the session, so it blocks on the server instead of prerendering a
// static shell. Without this, Cache Components fails the build for reading
// cookies outside a <Suspense> boundary.
export const instant = false;

// Deliberately plain: this page exists to prove auth and roles work.
export default async function MePage() {
  const supabase = await createClient();
  const { claims } = await readClaims(supabase);
  if (!claims) redirect("/login");

  // Read through RLS as the signed-in user.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", claims.sub)
    .maybeSingle();
  if (error) throw error;

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <h1 className="mb-4 text-xl font-semibold">Me</h1>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
        <dt>Email</dt>
        <dd data-testid="email">{claims.email}</dd>
        <dt>Role</dt>
        <dd data-testid="role">{profile?.role ?? "no profile"}</dd>
      </dl>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
