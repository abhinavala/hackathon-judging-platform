"use client";

import { useState } from "react";
import { emptyImportState, type ImportState } from "./state";
import type { ImportedTeam, TeamChanges } from "@/lib/csv/teams-import";

const input = "rounded border px-2 py-1 text-sm";
const button =
  "rounded border px-3 py-1 text-sm font-medium hover:bg-black/5 disabled:opacity-50";
const table =
  "w-full border-collapse text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left";

const when = (t: ImportedTeam) => t.submittedAt?.replace("T", " ") ?? "—";
const people = (t: ImportedTeam) =>
  [
    ...t.memberEmails,
    ...(t.teammateNames.length
      ? [`names only: ${t.teammateNames.join(", ")}`]
      : []),
  ].join("; ");

function describe(c: TeamChanges): string[] {
  const out: string[] = [];
  if (c.tracks?.added.length)
    out.push(`+ tracks: ${c.tracks.added.join(", ")}`);
  if (c.tracks?.removed.length)
    out.push(`− tracks: ${c.tracks.removed.join(", ")}`);
  if (c.devpostUrl)
    out.push(
      `Devpost: ${c.devpostUrl.from ?? "none"} → ${c.devpostUrl.to ?? "none"}`,
    );
  if (c.githubUrls)
    out.push(
      `GitHub: +${c.githubUrls.added.length} −${c.githubUrls.removed.length}`,
    );
  if (c.memberEmails) out.push(`+ members: ${c.memberEmails.added.join(", ")}`);
  if (c.contactPhone)
    out.push(`phone: ${c.contactPhone.from ?? "none"} → ${c.contactPhone.to}`);
  for (const k of [
    "hasGradStudent",
    "allFreshmen",
    "halfOrMoreNonMale",
  ] as const) {
    if (c[k]) out.push(`${k}: ${c[k]!.from} → ${c[k]!.to}`);
  }
  return out;
}

// Posts to ./run (a JSON route handler, see run/route.ts) and keeps the
// state here. Organizer-only, so it relies on JavaScript.
export function ImportFlow() {
  const [state, setState] = useState<ImportState>(emptyImportState);
  const [pending, setPending] = useState(false);
  const { read, plan, result } = state;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const body = new FormData(event.currentTarget);
    if (submitter?.name) body.set(submitter.name, submitter.value);
    if (state.fileName) body.set("fileName", state.fileName);
    setPending(true);
    try {
      const res = await fetch("/organizer/import/run", {
        method: "POST",
        body,
      });
      setState(
        res.ok
          ? await res.json()
          : {
              ...state,
              error: `The server answered ${res.status}. Nothing was imported.`,
            },
      );
    } catch {
      setState({
        ...state,
        error: "Couldn't reach the server. Nothing was imported.",
      });
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-2 text-sm">
        <p role="status" className="rounded border border-green-700 px-3 py-2">
          Imported: {result.created.length} created, {result.updated.length}{" "}
          updated.
        </p>
        {result.failed.length > 0 && (
          <div role="alert" className="rounded border border-red-600 px-3 py-2">
            <p className="font-semibold">Needs attention:</p>
            <ul className="list-disc pl-6">
              {result.failed.map((f) => (
                <li key={f.name}>
                  {f.name}: {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={() => setState(emptyImportState)}
          className={button}
        >
          Import another file
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {state.csv && <input type="hidden" name="csv" value={state.csv} />}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          className={input}
          aria-label="CSV file"
        />
        <button
          name="intent"
          value="preview"
          className={button}
          disabled={pending}
        >
          {state.csv ? "Re-check" : "Read file"}
        </button>
        {state.fileName && <span>Reading: {state.fileName}</span>}
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded border border-red-600 px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}

      {read && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">
            What the file contains (
            {read.columns.shape === "new"
              ? "new form, with team names"
              : "old form, no team names"}
            )
          </h2>
          <table className={`${table} w-auto`}>
            <thead>
              <tr>
                <th>Question</th>
                <th>Read as</th>
              </tr>
            </thead>
            <tbody>
              {read.columns.mapped.map((m) => (
                <tr key={m.header}>
                  <td>{m.header}</td>
                  <td>{m.field}</td>
                </tr>
              ))}
              {read.columns.ignored.map((h) => (
                <tr key={h}>
                  <td>{h}</td>
                  <td className="text-amber-700">ignored</td>
                </tr>
              ))}
            </tbody>
          </table>
          {[...read.errors, ...read.warnings].length > 0 && (
            <ul className="mt-2 list-disc pl-6 text-sm">
              {read.errors.map((e, i) => (
                <li key={`e${i}`} className="text-red-700">
                  {e.line ? `Line ${e.line}: ` : ""}
                  {e.message}
                </li>
              ))}
              {read.warnings.map((w, i) => (
                <li key={`w${i}`} className="text-amber-800">
                  {w.line ? `Line ${w.line}: ` : ""}
                  {w.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {plan && plan.needsName.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">
            Needs a team name ({plan.needsName.length})
          </h2>
          <p className="mb-2 text-sm">
            This form didn&apos;t ask for a team name, and these submitters
            aren&apos;t on any existing team. Type each team&apos;s name;
            nothing is guessed.
          </p>
          <table className={table}>
            <thead>
              <tr>
                <th>Line</th>
                <th>Team name</th>
                <th>Submitted by</th>
                <th>Teammates</th>
                <th>Tracks</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {plan.needsName.map((t) => (
                <tr key={t.line}>
                  <td>{t.line}</td>
                  <td>
                    <input
                      name={`name:${t.line}`}
                      defaultValue={state.names[t.line] ?? ""}
                      aria-label={`Team name for line ${t.line}`}
                      className={input}
                    />
                  </td>
                  <td>
                    {t.submitter.fullName} &lt;{t.submitter.email}&gt;
                  </td>
                  <td>{t.teammateNames.join(", ") || "—"}</td>
                  <td>{t.tracks.join(", ") || "grand prize only"}</td>
                  <td>{when(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {plan && plan.conflicts.length > 0 && (
        <ul role="alert" className="list-disc pl-6 text-sm text-red-700">
          {plan.conflicts.map((c) => (
            <li key={c.line}>
              Line {c.line}: {c.message}
            </li>
          ))}
        </ul>
      )}

      {plan && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">
            The import would: create {plan.create.length}, update{" "}
            {plan.update.length}, leave {plan.unchanged.length} unchanged
          </h2>
          {plan.create.length > 0 && (
            <table className={`${table} mb-4`}>
              <thead>
                <tr>
                  <th>New team</th>
                  <th>Members</th>
                  <th>Tracks</th>
                  <th>GitHub / Devpost</th>
                  <th>Checked in</th>
                </tr>
              </thead>
              <tbody>
                {plan.create.map((t) => (
                  <tr key={t.line}>
                    <td>
                      {t.name}
                      {/* names typed for old-form rows ride along */}
                      {state.names[t.line] && (
                        <input
                          type="hidden"
                          name={`name:${t.line}`}
                          value={state.names[t.line]}
                        />
                      )}
                    </td>
                    <td>{people(t)}</td>
                    <td>{t.tracks.join(", ") || "grand prize only"}</td>
                    <td>
                      {[...t.githubUrls, t.devpostUrl]
                        .filter(Boolean)
                        .join(" ")}
                    </td>
                    <td>{when(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {plan.update.length > 0 && (
            <table className={`${table} mb-4`}>
              <thead>
                <tr>
                  <th>Existing team</th>
                  <th>Matched by</th>
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {plan.update.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.matchedBy}</td>
                    <td>{describe(u.changes).join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {plan.notInCsv.length > 0 && (
            <p className="text-sm">
              {plan.notInCsv.length} existing team
              {plan.notInCsv.length === 1 ? " isn't" : "s aren't"} in this file
              and will be left alone.
            </p>
          )}
          <button
            name="intent"
            value="apply"
            className={`${button} mt-3`}
            disabled={
              pending ||
              plan.needsName.length > 0 ||
              plan.conflicts.length > 0 ||
              plan.create.length + plan.update.length === 0
            }
          >
            Import {plan.create.length + plan.update.length} team
            {plan.create.length + plan.update.length === 1 ? "" : "s"}
          </button>
        </section>
      )}
    </form>
  );
}
