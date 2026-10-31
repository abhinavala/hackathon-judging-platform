import { redirect } from "next/navigation";

/** Back to `path` with a message the page shows. Throws (Next redirect). */
export function back(
  path: string,
  message: { ok: string } | { error: string },
): never {
  const [k, v] =
    "ok" in message ? ["ok", message.ok] : ["error", message.error];
  redirect(`${path}?${new URLSearchParams({ [k]: v })}`);
}
