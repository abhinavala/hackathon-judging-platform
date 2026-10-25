import { loadBoardView } from "@/lib/board/load";

// What the open board polls. serverNow lets it correct for a laptop whose
// clock is wrong.
export async function GET(
  _req: Request,
  { params }: RouteContext<"/board/[slug]/data">,
) {
  const { slug } = await params;
  try {
    const { view, fetchedAt } = await loadBoardView(slug);
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
