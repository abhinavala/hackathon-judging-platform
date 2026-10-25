import { requireSession } from "@/lib/session";

// Placeholder. The real participant view arrives in a later phase.
export default async function TeamPage() {
  const ctx = await requireSession();
  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <h1 className="text-xl font-semibold">Team</h1>
      <p>
        Signed in as {ctx.user.email} ({ctx.role}).
      </p>
    </main>
  );
}
