import Link from "next/link";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";

// SECOND LINE OF DEFENSE. The real gate is the proxy (lib/supabase/proxy.ts),
// which checks the role against lib/route-guards.ts and answers a mismatch
// with a genuine HTTP 404 before any page code runs. It has to be the proxy:
// with Cache Components the response commits to 200 before this layout's
// notFound() runs, so a mismatch caught HERE is only a "soft" 404 (not-found
// content, 200 status). This guard still withholds the content if a request
// ever gets past the proxy, e.g. a gated prefix missing from route-guards.ts.
// scripts/smoke.mjs asserts the real 404 status codes.
//
// instant = false lets this layout block on the request's cookies; without
// it, Cache Components fails the build for reading cookies outside Suspense.
export const instant = false;

const NAV = [
  ["/organizer", "Overview"],
  ["/organizer/event", "Event"],
  ["/organizer/tracks", "Tracks"],
  ["/organizer/import", "Import teams"],
  ["/organizer/judges", "Judges"],
  ["/organizer/panels", "Stations"],
  ["/organizer/generate", "Generate"],
  ["/organizer/schedules", "Schedules"],
] as const;

export default async function OrganizerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(...ORGANIZER_ROLES);
  return (
    <div className="mx-auto w-full max-w-6xl p-6 print:max-w-none print:p-0">
      <nav className="mb-6 print:hidden flex flex-wrap gap-4 border-b pb-3 text-sm">
        {NAV.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="underline-offset-4 hover:underline"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
