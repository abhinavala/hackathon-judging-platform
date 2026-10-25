import { Suspense } from "react";
import { normalizeEmail } from "@/lib/auth/magic-link";
import { LoginForm } from "./login-form";

// The heading is static; everything below depends on the URL (a failed link
// lands here with ?error=&email=), so it sits behind a Suspense boundary.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto w-full max-w-sm p-8">
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      <Suspense>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginBody({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const email = normalizeEmail(params.email);

  if (!error) return <LoginForm />;

  return (
    <>
      <p role="alert" className="mb-4 text-sm text-red-600">
        {error === "expired"
          ? "That sign-in link has expired or was already used."
          : "That sign-in link didn't work."}
      </p>
      {email ? (
        <>
          <LoginForm resendTo={email} />
          <p className="mt-6 text-sm">Not you? Use a different address:</p>
          <div className="mt-2">
            <LoginForm />
          </div>
        </>
      ) : (
        <LoginForm />
      )}
    </>
  );
}
