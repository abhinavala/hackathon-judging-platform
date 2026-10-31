import { Suspense } from "react";

// For people who have the code but not the link. A plain GET form to /t/go
// (works without JavaScript), which redirects to /t/ABCD-1234 or back here
// with ?error=format.
export default function CodeEntryPage({ searchParams }: PageProps<"/t">) {
  return (
    <main className="mx-auto w-full max-w-sm p-6">
      <h1 className="mb-2 text-2xl font-semibold">Find your judging times</h1>
      <p className="mb-4">
        Enter your team&apos;s join code. It looks like ABCD-1234.
      </p>
      <Suspense>
        <CodeForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function CodeForm({
  searchParams,
}: Pick<PageProps<"/t">, "searchParams">) {
  const params = await searchParams;
  const typed = typeof params.code === "string" ? params.code : "";
  const showError = params.error === "format";
  return (
    <form action="/t/go" method="get" className="flex flex-col gap-3">
      <label htmlFor="code" className="text-sm">
        Join code
      </label>
      <input
        id="code"
        name="code"
        defaultValue={typed}
        required
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="ABCD-1234"
        className="rounded border px-3 py-3 text-2xl tracking-widest uppercase"
      />
      {showError && (
        <p role="alert" className="text-red-600">
          &ldquo;{typed}&rdquo; isn&apos;t a join code. It&apos;s 4 letters or
          numbers, a dash, then 4 more.
        </p>
      )}
      <button
        type="submit"
        className="rounded border px-3 py-3 text-lg font-medium"
      >
        Show my times
      </button>
    </form>
  );
}
