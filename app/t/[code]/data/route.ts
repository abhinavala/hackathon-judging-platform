import { loadTeamView } from "@/lib/team/load";
import { normalizeCode } from "@/lib/team/view";

// What the open team page polls. serverNow lets the page correct for a phone
// whose clock is wrong.
export async function GET(
  _req: Request,
  { params }: RouteContext<"/t/[code]/data">,
) {
  const code = normalizeCode((await params).code);
  if (!code) return Response.json({ error: "not a code" }, { status: 400 });
  try {
    const { view, fetchedAt } = await loadTeamView(code);
    return Response.json(
      { view, serverNow: fetchedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
