"use client";

import { useActionState } from "react";
import { requestSignInLink, type SignInState } from "./actions";

// With `resendTo`, renders a single button that sends a fresh link to that
// address (the expired / used link path). Otherwise, the email form.
export function LoginForm({ resendTo }: { resendTo?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(
    requestSignInLink,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <p role="status">
        We sent a sign-in link to <strong>{state.email}</strong>. Open it on any
        device, this one or your phone. Each link works once, and requesting a
        new one replaces the old one.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
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
            defaultValue={state.status === "error" ? state.email : undefined}
            className="rounded border px-3 py-2"
          />
        </>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded border px-3 py-2 font-medium disabled:opacity-50"
      >
        {pending
          ? "Sending…"
          : resendTo
            ? `Send a new link to ${resendTo}`
            : "Send sign-in link"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}
    </form>
  );
}
