// The join-code box, shared by /t and the homepage. A plain GET form to
// /t/go (works without JavaScript), which redirects to /t/ABCD-1234 or back
// to /t with ?error=format.
export function CodeEntryForm({
  typed = "",
  showError = false,
  large = false,
}: {
  typed?: string;
  showError?: boolean;
  /** The homepage's version: the one thing on the page, so bigger. */
  large?: boolean;
}) {
  return (
    <form action="/t/go" method="get" className="flex flex-col gap-3">
      <label htmlFor="code" className={large ? "text-lg" : "text-sm"}>
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
        className={`rounded border px-3 py-3 tracking-widest uppercase ${large ? "text-3xl" : "text-2xl"}`}
      />
      {showError && (
        <p role="alert" className="text-red-600">
          &ldquo;{typed}&rdquo; isn&apos;t a join code. It&apos;s 4 letters or
          numbers, a dash, then 4 more.
        </p>
      )}
      <button
        type="submit"
        className={`rounded px-3 py-3 font-semibold ${large ? "bg-black text-xl text-white dark:bg-white dark:text-black" : "border text-lg font-medium"}`}
      >
        Show my times
      </button>
    </form>
  );
}
