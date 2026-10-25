import { adminDb, currentEvent, loadTracks } from "@/lib/admin/data";
import { ImportFlow } from "./import-flow";

// Teams CSV import from the Google Form export (the check-in fallback).
export default async function ImportPage() {
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const tracks = await loadTracks(db, event.id);
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">
        Import teams from the form — {event.name}
      </h1>
      <p className="mb-4 max-w-3xl text-sm">
        Upload the CSV exported from the Google Form. Nothing is written until
        you press Import: you see how every question was read, every warning,
        and exactly which teams would be created or changed. Submitting the form
        counts as checking in. The file is read in memory and never stored.
      </p>
      <p className="mb-4 text-sm">
        Prizes are matched against this event&apos;s tracks:{" "}
        {tracks.map((t) => t.name).join(", ") || "none defined yet"}.
      </p>
      <ImportFlow />
    </main>
  );
}
