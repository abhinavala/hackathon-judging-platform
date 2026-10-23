import { requireSession } from "@/lib/session";

// Any signed-in user; no role lookup. What a person sees under /team is
// scoped by RLS, not by role, so every role passes this guard. The proxy
// already sends anonymous visitors to /login before this runs.
//
// instant = false lets this layout block on the request's cookies; without
// it, Cache Components fails the build for reading cookies outside Suspense.
export const instant = false;

export default async function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return <>{children}</>;
}
