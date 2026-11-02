import { redirect } from "next/navigation";

/** Back to `path` with a message the page shows. Throws (Next redirect). */
export function back(
  path: string,
  message: { ok: string } | { error: string } | { warn: string },
): never {
  // ok: done. warn: done, but look at this. error: not done.
  const [k, v] =
    "ok" in message
      ? ["ok", message.ok]
      : "warn" in message
        ? ["warn", message.warn]
        : ["error", message.error];
  redirect(`${path}?${new URLSearchParams({ [k]: v })}`);
}
