"use client";

import { useFormStatus } from "react-dom";

// With JavaScript: disabled and "Sending..." while the request is in flight,
// so an impatient second tap can't mint a second link. Without JavaScript it
// is an ordinary submit button.
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-3 py-2 font-medium disabled:opacity-50"
    >
      {pending ? "Sending…" : children}
    </button>
  );
}
