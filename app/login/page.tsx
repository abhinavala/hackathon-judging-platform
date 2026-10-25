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
  const sent = normalizeEmail(params.sent);
  const email = normalizeEmail(params.email);

  // A link is on its way. Say so plainly, and say why not to ask again:
  // every new link replaces the one already sent.
  if (sent) {
    return (
      <>
        <div role="status" className="mb-6 rounded border border-green-700 p-3">
          <p className="font-medium">
            We sent a sign-in link to <strong>{sent}</strong>.
          </p>
          <p className="mt-2 text-sm">
            Open it on any device, this one or your phone. It can take a minute
            to arrive. Please don&apos;t request another before then: each new
            link replaces the last one, so the first email stops working.
          </p>
        </div>
        <p className="mb-2 text-sm">
          Still nothing after a few minutes? Check spam, then:
        </p>
        <LoginForm resendTo={sent} />
        <p className="mt-6 text-sm">
          Wrong address?{" "}
          <a href="/login" className="underline">
            Start again
          </a>
          .
        </p>
      </>
    );
  }

  if (!error) return <LoginForm />;

  const message =
    error === "expired"
      ? "That sign-in link has expired or was already used."
      : error === "send-failed"
        ? "We couldn't send your sign-in link. Try again in a minute, or ask an organizer for your team's join code."
        : error === "invalid-email"
          ? "Enter a valid email address."
          : "That sign-in link didn't work.";
  return (
    <>
      <p role="alert" className="mb-4 text-sm text-red-600">
        {message}
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
