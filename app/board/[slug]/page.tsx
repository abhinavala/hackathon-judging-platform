import { connection } from "next/server";
import { headers } from "next/headers";
import { loadBoardView } from "@/lib/board/load";
import type { BoardView } from "@/lib/board/view";
import { BoardClient } from "./board";

// The projector. Renders on the server first, then the client keeps it
// fresh and moves to the next slot on its own. Blocks rather than
// prerendering.
export const instant = false;

export default async function BoardPage({
  params,
}: PageProps<"/board/[slug]">) {
  const slug = decodeURIComponent((await params).slug);
  await connection();
  // Shown on screen so teams can look up their own times.
  const host = (await headers()).get("host") ?? "";

  let loaded: { view: BoardView; fetchedAt: number } | null = null;
  try {
    loaded = await loadBoardView(slug);
  } catch {
    loaded = null;
  }
  return (
    <BoardClient
      slug={slug}
      host={host}
      initial={loaded?.view ?? null}
      fetchedAt={loaded?.fetchedAt ?? null}
    />
  );
}
