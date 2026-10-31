import { redirect } from "next/navigation";
import { connection } from "next/server";
import { loadTeamView } from "@/lib/team/load";
import { normalizeCode, type TeamView } from "@/lib/team/view";
import { TeamViewClient } from "./team-view";

// Renders on the server first (so the times show even if JavaScript never
// loads), then the client keeps it fresh. Blocks rather than prerendering.
export const instant = false;

export default async function TeamPage({
  params,
  searchParams,
}: PageProps<"/t/[code]">) {
  const query = await searchParams;
  const raw = decodeURIComponent((await params).code);
  const code = normalizeCode(raw);
  if (!code)
    redirect(`/t?${new URLSearchParams({ code: raw, error: "format" })}`);
  if (code !== raw) redirect(`/t/${code}`);
  await connection();

  // If the database can't be reached, the client falls back to the copy it
  // saved on this phone last time (and says how old it is).
  let loaded: { view: TeamView; fetchedAt: number } | null = null;
  try {
    loaded = await loadTeamView(code);
  } catch {
    loaded = null;
  }
  return (
    <TeamViewClient
      code={code}
      initial={loaded?.view ?? null}
      fetchedAt={loaded?.fetchedAt ?? null}
      welcome={
        // Just checked in (the check-in form redirects here). Cosmetic only:
        // anyone can add these parameters, and nothing in them is private.
        query.welcome === "1"
          ? {
              receiptSent: query.receipt === "sent",
              invited: Number(query.invited) || 0,
              inviteFailures: Number(query.inviteFailures) || 0,
            }
          : null
      }
    />
  );
}
