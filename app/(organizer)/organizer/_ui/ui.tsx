// Plain building blocks for the organizer screens. Phase 4 owns design.

export function Flash({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const error = typeof params.error === "string" ? params.error : null;
  const warn = typeof params.warn === "string" ? params.warn : null;
  const ok = typeof params.ok === "string" ? params.ok : null;
  if (!error && !warn && !ok) return null;
  return (
    <p
      role={error || warn ? "alert" : "status"}
      className={`mb-4 rounded border px-3 py-2 text-sm ${
        error
          ? "border-red-600 text-red-700 dark:text-red-400"
          : warn
            ? "border-2 border-amber-500 bg-amber-50 font-semibold text-amber-950"
            : "border-green-700 text-green-800 dark:text-green-400"
      }`}
    >
      {error ?? warn ?? ok}
    </p>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export const input = "rounded border px-2 py-1 text-sm";
export const button =
  "rounded border px-3 py-1 text-sm font-medium hover:bg-black/5";
/** Irreversible actions: never styled like Save. */
export const danger =
  "rounded border-2 border-red-700 px-3 py-1 text-sm font-semibold text-red-800 hover:bg-red-50 dark:border-red-400 dark:text-red-300 dark:hover:bg-red-950";
export const table =
  "w-full border-collapse text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left";
