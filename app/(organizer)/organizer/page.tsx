import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";

// Placeholder. The real organizer view arrives in a later phase.
export default async function OrganizerPage() {
  const ctx = await requireRole(...ORGANIZER_ROLES);
  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <h1 className="text-xl font-semibold">Organizer</h1>
      <p>
        Signed in as {ctx.user.email} ({ctx.role}).
      </p>
    </main>
  );
}
