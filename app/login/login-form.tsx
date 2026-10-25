import { requestSignInLink } from "./actions";
import { SubmitButton } from "./submit-button";

// A plain server-action form: no client state, so it works without
// JavaScript. The outcome comes back as /login?sent=... or ?error=...
//
// With `resendTo`, a single button that sends a fresh link to that address.
export function LoginForm({ resendTo }: { resendTo?: string }) {
  return (
    <form action={requestSignInLink} className="flex flex-col gap-3">
      {resendTo ? (
        <input type="hidden" name="email" value={resendTo} />
      ) : (
        <>
          <label htmlFor="email" className="text-sm">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded border px-3 py-2"
          />
        </>
      )}
      <SubmitButton>
        {resendTo ? `Send a new link to ${resendTo}` : "Send sign-in link"}
      </SubmitButton>
    </form>
  );
}
