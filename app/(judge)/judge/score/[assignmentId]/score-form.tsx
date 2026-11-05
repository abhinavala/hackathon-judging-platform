"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  draftKey,
  initialDraft,
  isComplete,
  parseDraft,
  type Criterion,
  type ScoreDraft,
} from "@/lib/judge/score-draft";

type Sync = "saved" | "saving" | "unsaved" | "refused";
const SAVE_AFTER_MS = 600;
const RETRY_MS = 5000;

/** When a change happened, read outside render. */
function changedNow() {
  return Date.now();
}

/**
 * Local-first: every change goes to localStorage at once, then to the server.
 * Until the server confirms, the copy on the phone is "pending": it survives
 * a reload and is retried every few seconds and whenever the network comes
 * back. Venue Wi-Fi will drop; a judge's four minutes of notes must not.
 */
export function ScoreForm({
  assignmentId,
  judgeId,
  criteria,
  saved,
  locked,
}: {
  assignmentId: string;
  judgeId: string;
  criteria: Criterion[];
  saved: ScoreDraft | null;
  locked: boolean;
}) {
  const key = draftKey(judgeId, assignmentId);
  const [draft, setDraft] = useState<ScoreDraft>(
    () => saved ?? initialDraft(null, null),
  );
  const [sync, setSync] = useState<Sync>("saved");
  const [refusal, setRefusal] = useState<string | null>(null);
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // push() schedules itself again; the ref lets it do that before it exists.
  const pushRef = useRef<() => Promise<void>>(async () => {});

  const store = (d: ScoreDraft) => {
    latest.current = d;
    try {
      localStorage.setItem(key, JSON.stringify(d));
    } catch {
      // Private mode or full: the server copy is still the backstop.
    }
  };

  const push = useCallback(async () => {
    const sent = latest.current;
    if (!sent.pending || locked) return;
    setSync("saving");
    try {
      const res = await fetch(`/judge/score/${assignmentId}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: sent.values, notes: sent.notes }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        retry?: boolean;
      };
      if (body.ok) {
        // Only clear "pending" if nothing changed while this was in flight.
        if (latest.current.changedAt === sent.changedAt) {
          const done = { ...latest.current, pending: false };
          store(done);
          setDraft(done);
          setSync("saved");
        } else {
          setSync("unsaved");
          timer.current = setTimeout(
            () => void pushRef.current(),
            SAVE_AFTER_MS,
          );
        }
        setRefusal(null);
        return;
      }
      if (body.retry === false) {
        setSync("refused");
        setRefusal(body.error ?? "This score can't be saved.");
        return;
      }
      throw new Error(body.error);
    } catch {
      setSync("unsaved");
      timer.current = setTimeout(() => void pushRef.current(), RETRY_MS);
    }
    // store() and the key are stable for this page; push re-binds per team.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, locked]);

  useEffect(() => {
    pushRef.current = push;
  }, [push]);

  // On load: a pending copy on this phone (Wi-Fi dropped before it was
  // saved) wins over the server's older one, and is sent again.
  useEffect(() => {
    let local: ScoreDraft | null = null;
    try {
      local = parseDraft(localStorage.getItem(key));
    } catch {
      local = null;
    }
    const start = initialDraft(saved, local);
    latest.current = start;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(start);
    if (start.pending) {
      setSync("unsaved");
      void push();
    }
    const online = () => void push();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, saved, push]);

  const change = (next: Partial<ScoreDraft>) => {
    const d = {
      ...latest.current,
      ...next,
      pending: true,
      changedAt: changedNow(),
    };
    store(d);
    setDraft(d);
    setSync("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void pushRef.current(), SAVE_AFTER_MS);
  };

  const complete = isComplete(draft, criteria);
  return (
    <form className="mt-4" onSubmit={(e) => e.preventDefault()}>
      <p
        role="status"
        aria-live="polite"
        className={`sticky top-0 z-10 -mx-4 mb-4 px-4 py-2 text-base font-semibold ${
          locked
            ? "bg-gray-200 text-gray-800"
            : sync === "saved"
              ? "bg-green-100 text-green-900"
              : sync === "saving"
                ? "bg-blue-50 text-blue-900"
                : sync === "refused"
                  ? "bg-red-100 text-red-900"
                  : "bg-amber-100 text-amber-950"
        }`}
      >
        {locked
          ? "Scoring is closed. This is what was recorded."
          : sync === "saved"
            ? complete
              ? "✓ Saved. All criteria scored."
              : "✓ Saved."
            : sync === "saving"
              ? "Saving…"
              : sync === "refused"
                ? refusal
                : "Not saved yet: kept on this phone, retrying."}
      </p>

      {criteria.map((c) => (
        <fieldset key={c.id} className="mb-5" disabled={locked}>
          <legend className="text-xl font-bold">{c.label}</legend>
          {c.description && <p className="mb-2 text-sm">{c.description}</p>}
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: c.max - c.min + 1 }, (_, i) => c.min + i).map(
              (v) => {
                const on = draft.values[c.id] === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${c.label}: ${v}`}
                    onClick={() =>
                      change({
                        values: { ...latest.current.values, [c.id]: v },
                      })
                    }
                    className={`rounded-lg border-2 py-4 text-2xl font-bold ${
                      on
                        ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                        : "border-gray-400"
                    }`}
                  >
                    {v}
                  </button>
                );
              },
            )}
          </div>
        </fieldset>
      ))}

      <label className="mb-2 block text-xl font-bold" htmlFor="notes">
        Notes
      </label>
      <textarea
        id="notes"
        rows={4}
        disabled={locked}
        value={draft.notes}
        onChange={(e) => change({ notes: e.target.value })}
        className="w-full rounded border-2 border-gray-400 p-3 text-base"
        placeholder="What stood out, for deliberation"
      />
    </form>
  );
}
