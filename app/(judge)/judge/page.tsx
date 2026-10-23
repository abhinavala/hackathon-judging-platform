import { requireRole } from "@/lib/session";
import { JUDGE_ROLES } from "@/lib/route-guards";

// Placeholder. The real judge view arrives in a later phase.
export default async function JudgingPage() {
  const ctx = await requireRole(...JUDGE_ROLES);
  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <h1 className="text-xl font-semibold">Judging</h1>
      <p>
        Signed in as {ctx.user.email} ({ctx.role}).
      </p>
    </main>
  );
}
