"use client";

import { useState } from "react";
import { parseCsvRecords } from "@/lib/csv/csv";
import { emptyCodeImportState, type CodeImportState } from "./state";

/** The run endpoint's limit (run/route.ts). */
const MAX_BYTES = 2_000_000;

const button =
  "rounded border px-3 py-1 text-sm font-medium hover:bg-black/5 disabled:opacity-50";
const table =
  "w-full border-collapse text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left";

// Choose a file or paste, Preview, then Import. A chosen file is read in the
// browser and put into the paste box, so both feed the same preview and the
// same import; nothing is written until Import. Import only appears for the
// text that was previewed: editing the paste clears the preview.
export function CodesImport() {
  const [csv, setCsv] = useState("");
  const [state, setState] = useState<CodeImportState>(emptyCodeImportState);
  const [pending, setPending] = useState(false);
  const [file, setFile] = useState<
    { ok: true; text: string } | { ok: false; text: string } | null
  >(null);

  async function choose(f: File | undefined) {
    setState(emptyCodeImportState);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES)
      return setFile({
        ok: false,
        text: `${f.name} is over 2 MB; is it the right file? Nothing was read. You can still paste below.`,
      });
    let text: string;
    try {
      text = await f.text();
    } catch {
      return setFile({
        ok: false,
        text: `${f.name} couldn't be read. You can still paste the CSV below.`,
      });
    }
    let rows = 0;
    try {
      rows = Math.max(
        0,
        parseCsvRecords(text).filter((r) => r.fields.some((x) => x.trim()))
          .length - 1,
      );
    } catch {
      rows = -1;
    }
    if (!text.trim() || rows === 0)
      return setFile({
        ok: false,
        text: `${f.name} is empty${text.trim() ? " (a header row but no codes)" : ""}. Nothing was read. You can still paste below.`,
      });
    setCsv(text);
    setFile({
      ok: true,
      text:
        rows < 0
          ? `Read ${f.name}, but it isn't valid CSV; Preview will say what's wrong.`
          : `Read ${f.name}: ${rows} row${rows === 1 ? "" : "s"} after the header. It's in the box below; press Preview.`,
    });
  }

  async function run(mode: "preview" | "import") {
    const body = new FormData();
    body.set("csv", csv);
    body.set("mode", mode);
    setPending(true);
    try {
      const res = await fetch("/organizer/codes/run", { method: "POST", body });
      setState(
        res.ok
          ? await res.json()
          : {
              ...emptyCodeImportState,
              error: `The server answered ${res.status}. Nothing was imported.`,
            },
      );
    } catch {
      setState({
        ...emptyCodeImportState,
        error: "Couldn't reach the server. Nothing was imported.",
      });
    } finally {
      setPending(false);
    }
  }

  const label =
    state.kind === "kiro" ? "Kiro credit codes" : "workshop access codes";
  return (
    <div>
      <label htmlFor="codes-file" className="mb-1 block text-sm font-medium">
        Choose the CSV file from AWS (the Kiro file or the workshop file; either
        is recognised by its columns)
      </label>
      <input
        id="codes-file"
        type="file"
        accept=".csv,text/csv,text/plain"
        onChange={(e) => void choose(e.target.files?.[0])}
        className="mb-2 block text-sm"
      />
      {file && (
        <p
          role={file.ok ? "status" : "alert"}
          data-testid="codes-file-status"
          className={`mb-3 text-sm ${file.ok ? "text-green-800 dark:text-green-400" : "font-semibold text-red-700"}`}
        >
          {file.text}
        </p>
      )}
      <label htmlFor="codes-csv" className="mb-1 block text-sm font-medium">
        …or paste it here
      </label>
      <textarea
        id="codes-csv"
        rows={8}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setState(emptyCodeImportState);
          setFile(null);
        }}
        className="mb-2 w-full rounded border p-2 font-mono text-xs"
        spellCheck={false}
      />
      <button
        type="button"
        className={button}
        disabled={pending || !csv.trim()}
        onClick={() => run("preview")}
      >
        Preview
      </button>

      {state.error && (
        <div
          role="alert"
          className="mt-3 rounded border border-red-600 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
          {state.headers.length > 0 && (
            <p className="mt-1">Columns found: {state.headers.join(", ")}</p>
          )}
        </div>
      )}

      {state.kind && state.plan && (
        <div className="mt-4" data-testid="codes-preview">
          <p className="mb-2 font-semibold">
            {state.total} {label}: {state.plan.added} new, {state.plan.updated}{" "}
            updated
            {state.plan.updatedClaimed
              ? `, ${state.plan.updatedClaimed} already handed out (details update; who has them doesn't change)`
              : ""}
            {state.plan.notInFile
              ? `. ${state.plan.notInFile} in the pool aren't in this file and stay as they are`
              : ""}
            .
          </p>
          <h3 className="mb-1 text-sm font-semibold">
            How each column is read
          </h3>
          <table className={`${table} mb-3`}>
            <thead>
              <tr>
                <th>Column</th>
                <th>Used as</th>
              </tr>
            </thead>
            <tbody>
              {state.columns.map((c) => (
                <tr key={c.header}>
                  <td>{c.header}</td>
                  <td className={c.use ? "" : "text-amber-800"}>
                    {c.use ?? "not recognised: not stored"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.warnings.length > 0 && (
            <ul
              role="alert"
              className="mb-3 list-disc rounded border-2 border-amber-500 bg-amber-50 py-2 pr-3 pl-8 text-sm text-amber-950"
            >
              {state.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <h3 className="mb-1 text-sm font-semibold">
            First rows, as they&apos;ll be stored
          </h3>
          <table className={`${table} mb-3`}>
            <thead>
              <tr>
                <th>Line</th>
                <th>Code</th>
                <th>
                  {state.kind === "kiro" ? "Redemption URL" : "Join event URL"}
                </th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {state.sample.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td className="font-mono">{r.code}</td>
                  <td className="break-all">{r.link ?? "none"}</td>
                  <td>{r.info}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!state.done && (
            <button
              type="button"
              className={button}
              disabled={pending}
              onClick={() => run("import")}
            >
              Import {state.total} {label}
            </button>
          )}
        </div>
      )}
      {state.done && (
        <p
          role="status"
          className="mt-3 rounded border border-green-700 px-3 py-2 text-sm text-green-800"
        >
          {state.done} Reload to see the pool.
        </p>
      )}
    </div>
  );
}
