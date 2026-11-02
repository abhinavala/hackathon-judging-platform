import { Suspense } from "react";
import { CodeEntryForm } from "./code-form";

// For people who have the code but not the link (app/t/code-form.tsx).
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
  return (
    <CodeEntryForm
      typed={typeof params.code === "string" ? params.code : ""}
      showError={params.error === "format"}
    />
  );
}
