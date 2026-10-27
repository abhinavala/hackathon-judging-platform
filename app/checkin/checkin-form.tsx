"use client";

import { useState } from "react";
import type { CheckInTrack, FieldErrors } from "@/lib/checkin/form";
import { TEAMMATE_ROWS } from "@/lib/checkin/form";

const input = "w-full rounded border px-3 py-2 text-base";
const label = "mb-1 block font-medium";

/**
 * The check-in form. A plain HTML form that posts to /checkin/submit, so it
 * works without JavaScript (an error then comes back as a message at the
 * top). With JavaScript it submits in the background, keeps everything typed
 * when something needs fixing, and shows each message next to its field.
 */
export function CheckInForm({
  tracks,
  initialError,
}: {
  tracks: CheckInTrack[];
  initialError: string | null;
}) {
  const [errors, setErrors] = useState<FieldErrors>(
    initialError ? { form: initialError } : {},
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/checkin/submit", {
        method: "POST",
        body: new FormData(e.currentTarget),
        headers: { accept: "application/json" },
      });
      const body = (await res.json()) as
        { ok: true; redirect: string } | { ok: false; errors: FieldErrors };
      if (body.ok) {
        window.location.assign(body.redirect);
        return; // keep the button disabled while the team page loads
      }
      setErrors(body.errors);
      // Focus the first field with a problem (in page order); the summary
      // at the top says how many there are.
      const form = document.querySelector<HTMLFormElement>("#checkin-form");
      const first = [...(form?.elements ?? [])].find(
        (el) => (el as HTMLInputElement).name in body.errors,
      ) as HTMLElement | undefined;
      if (first) first.focus();
      else window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrors({
        form: "We couldn't reach the server, so nothing was saved. Check your connection and try again.",
      });
    }
    setBusy(false);
  }

  const err = (name: string) =>
    errors[name] ? (
      <p
        id={`${name}-error`}
        className="mt-1 text-sm font-medium text-red-700 dark:text-red-400"
      >
        {errors[name]}
      </p>
    ) : null;
  const aria = (name: string) =>
    errors[name]
      ? { "aria-invalid": true, "aria-describedby": `${name}-error` }
      : {};

  return (
    <form
      action="/checkin/submit"
      method="post"
      id="checkin-form"
      onSubmit={onSubmit}
      noValidate
      className="space-y-6"
    >
      {!errors.form && Object.keys(errors).length > 0 && (
        <p
          role="alert"
          className="rounded border-2 border-red-700 bg-red-50 p-3 font-medium text-red-900"
        >
          {Object.keys(errors).length === 1
            ? "One answer needs fixing; it's marked below."
            : `${Object.keys(errors).length} answers need fixing; they're marked below.`}{" "}
          Nothing has been saved yet.
        </p>
      )}
      {errors.form && (
        <p
          role="alert"
          className="rounded border-2 border-red-700 bg-red-50 p-3 font-medium text-red-900"
        >
          {errors.form}
        </p>
      )}

      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" className="hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold">Your team</legend>
        <div>
          <label htmlFor="teamName" className={label}>
            Team name
          </label>
          <input
            id="teamName"
            name="teamName"
            maxLength={60}
            required
            className={input}
            {...aria("teamName")}
          />
          {err("teamName")}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold">
          You (the captain)
        </legend>
        <div>
          <label htmlFor="captainName" className={label}>
            Full name
          </label>
          <input
            id="captainName"
            name="captainName"
            autoComplete="name"
            required
            className={input}
            {...aria("captainName")}
          />
          {err("captainName")}
        </div>
        <div>
          <label htmlFor="captainEmail" className={label}>
            Email
          </label>
          <input
            id="captainEmail"
            name="captainEmail"
            type="email"
            autoComplete="email"
            required
            className={input}
            {...aria("captainEmail")}
          />
          <p className="mt-1 text-sm">
            We send your receipt and a sign-in link here.
          </p>
          {err("captainEmail")}
        </div>
        <div>
          <label htmlFor="phone" className={label}>
            Phone (optional, for emergencies)
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            className={input}
            {...aria("phone")}
          />
          {err("phone")}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold">Teammates</legend>
        <p className="text-sm">
          Up to {TEAMMATE_ROWS} besides you. Each gets an email inviting them to
          join your team. Leave rows blank if your team is smaller.
        </p>
        {Array.from({ length: TEAMMATE_ROWS }, (_, i) => i + 1).map((n) => (
          <div key={n} className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`teammateName${n}`} className={label}>
                Teammate {n}: name
              </label>
              <input
                id={`teammateName${n}`}
                name={`teammateName${n}`}
                className={input}
                {...aria(`teammateName${n}`)}
              />
              {err(`teammateName${n}`)}
            </div>
            <div>
              <label htmlFor={`teammateEmail${n}`} className={label}>
                Teammate {n}: email
              </label>
              <input
                id={`teammateEmail${n}`}
                name={`teammateEmail${n}`}
                type="email"
                className={input}
                {...aria(`teammateEmail${n}`)}
              />
              {err(`teammateEmail${n}`)}
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold">Your project</legend>
        <div>
          <label htmlFor="devpostUrl" className={label}>
            Devpost link (optional now; add it before judging)
          </label>
          <input
            id="devpostUrl"
            name="devpostUrl"
            type="url"
            inputMode="url"
            placeholder="https://devpost.com/software/…"
            className={input}
            {...aria("devpostUrl")}
          />
          {err("devpostUrl")}
        </div>
        <div>
          <label htmlFor="githubUrls" className={label}>
            Public GitHub repositories (optional; separate with commas)
          </label>
          <input
            id="githubUrls"
            name="githubUrls"
            placeholder="https://github.com/you/project"
            className={input}
            {...aria("githubUrls")}
          />
          {err("githubUrls")}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-lg font-semibold">Tracks</legend>
        <p className="mb-2 text-sm">
          Besides the grand prizes, which prizes is your team competing for?
          Pick any, or none.
        </p>
        <div className="space-y-2">
          {tracks.map((t) => (
            <label key={t.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                name="track"
                value={t.id}
                className="mt-1 h-5 w-5"
              />
              <span>{t.name}</span>
            </label>
          ))}
        </div>
        {err("track")}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold">
          Prize eligibility
        </legend>
        {(
          [
            [
              "hasGradStudent",
              "Does your team have at least one graduate student?",
            ],
            ["allFreshmen", "Is your team entirely freshmen?"],
            ["halfOrMoreNonMale", "Is half or more of your team non-male?"],
          ] as const
        ).map(([name, question]) => (
          <div key={name} role="radiogroup" aria-labelledby={`${name}-q`}>
            <p id={`${name}-q`} className={label}>
              {question}
            </p>
            <div className="flex gap-6">
              {(["yes", "no"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={name}
                    value={v}
                    required
                    className="h-5 w-5"
                  />
                  {v === "yes" ? "Yes" : "No"}
                </label>
              ))}
            </div>
            {err(name)}
          </div>
        ))}
      </fieldset>

      <div>
        <label htmlFor="notes" className={label}>
          Questions or comments (optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={1000}
          className={input}
          {...aria("notes")}
        />
        {err("notes")}
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-black px-4 py-3 text-lg font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {busy ? "Checking in…" : "Check in"}
      </button>
    </form>
  );
}
