"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { parseDevpostUrl, parseGithubUrls } from "@/lib/checkin/form";

const PATH = "/team";

function back(
  message: { ok: string } | { error: string },
  section: "devpost" | "github" = "devpost",
): never {
  const [k, v] =
    "ok" in message ? ["ok", message.ok] : ["error", message.error];
  redirect(`${PATH}?${new URLSearchParams({ [k]: v, section })}#${section}`);
}

/**
 * Any member may set the team's Devpost link, not just the captain: the
 * person who submits is often someone else, and at 11pm the captain may be
 * asleep. set_team_devpost() (0015) checks membership and touches nothing
 * else on the team; teams_update stays captain-only.
 */
export async function saveDevpost(form: FormData) {
  const ctx = await requireSession();
  if (!ctx.teamId) back({ error: "You're not on a team." });
  const parsed = parseDevpostUrl(String(form.get("devpostUrl") ?? ""));
  if (!parsed.ok) back({ error: parsed.error });
  const db = await createClient();
  const { error } = await db.rpc("set_team_devpost", {
    p_team: ctx.teamId,
    p_url: parsed.value ?? "",
  });
  if (error) back({ error: `Not saved: ${error.message}` });
  revalidatePath(PATH);
  back({
    ok: parsed.value
      ? "Saved. Judges will see this link."
      : "Removed your Devpost link.",
  });
}

/**
 * Any member may set the team's GitHub repositories, like the Devpost link:
 * set_team_github() (0016) checks membership and touches nothing else.
 * Same rules as check-in.
 */
export async function saveGithub(form: FormData) {
  const ctx = await requireSession();
  if (!ctx.teamId) back({ error: "You're not on a team." }, "github");
  const parsed = parseGithubUrls(String(form.get("githubUrls") ?? ""));
  if (!parsed.ok) back({ error: parsed.error }, "github");
  const db = await createClient();
  const { error } = await db.rpc("set_team_github", {
    p_team: ctx.teamId,
    p_urls: parsed.value,
  });
  if (error) back({ error: `Not saved: ${error.message}` }, "github");
  revalidatePath(PATH);
  back(
    {
      ok: parsed.value.length
        ? `Saved ${parsed.value.length} repositor${parsed.value.length === 1 ? "y" : "ies"}.`
        : "Removed your GitHub links.",
    },
    "github",
  );
}
