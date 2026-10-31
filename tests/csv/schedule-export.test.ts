// Schedule export: stations down the side, times across. Round-trips a real
// solve() result on the event's configuration back through the parser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../../lib/csv/csv.ts";
import {
  scheduleToCsv,
  type ExportCell,
} from "../../lib/csv/schedule-export.ts";
import { solve, type Sponsor } from "../../lib/scheduler/index.ts";

const START = "2026-11-08T10:00:00-08:00";
const NAMES = Array.from({ length: 60 }, (_, i) =>
  i === 7
    ? '=HYPERLINK("http://evil.example")'
    : i === 8
      ? "Smith, Jones & Co"
      : `Team ${i + 1}`,
);

function eventSchedule() {
  const teamTracks: Set<Sponsor>[] = [
    ...Array.from({ length: 12 }, () => new Set(["AWS", "A10"])),
    ...Array.from({ length: 24 }, () => new Set(["AWS"])),
    ...Array.from({ length: 12 }, () => new Set(["A10"])),
    ...Array.from({ length: 12 }, () => new Set<Sponsor>()),
  ];
  const judges = [
    ...Array(4).fill("AWS"),
    ...Array(3).fill("A10"),
    ...Array(9).fill(null),
  ];
  const r = solve({ teamTracks, judges, seed: 0 });
  const stations = r.panels.map((_, p) => ({
    id: `panel-${p}`,
    label: `Station ${p + 1}`,
  }));
  const slots = Array.from({ length: r.nSlots }, (_, i) => ({
    id: `slot-${i}`,
    index: i,
    startsAt: new Date(
      new Date(START).getTime() + i * 7 * 60_000,
    ).toISOString(),
  }));
  const cells: ExportCell[] = [...r.slotOf].map(([key, slot]) => {
    const [team, panel] = key.split(":").map(Number);
    return {
      stationId: `panel-${panel}`,
      slotId: `slot-${slot}`,
      teamName: NAMES[team],
    };
  });
  return { stations, slots, cells };
}

test("exports station x time and parses back to the same schedule", () => {
  const { stations, slots, cells } = eventSchedule();
  const rows = parseCsv(
    scheduleToCsv({ stations, slots, cells, timeZone: "America/Los_Angeles" }),
  );

  const [header, ...body] = rows;
  assert.equal(header[0], "Station");
  assert.equal(header[1], "10:00 AM");
  assert.equal(header[2], "10:07 AM");
  assert.equal(header.at(-1), "11:38 AM");
  assert.equal(header.length, 1 + 15);
  assert.deepEqual(
    body.map((r) => r[0]),
    stations.map((s) => s.label),
  );

  // Every cell back, keyed by station and time, formula guard undone.
  const back = new Set<string>();
  body.forEach((row, p) =>
    row.slice(1).forEach((cell, i) => {
      if (cell)
        back.add(
          `${stations[p].id}|${slots[i].id}|${cell.replace(/^'(?=[=+\-@])/, "")}`,
        );
    }),
  );
  assert.deepEqual(
    back,
    new Set(cells.map((c) => `${c.stationId}|${c.slotId}|${c.teamName}`)),
  );
  assert.equal(back.size, 120);
});

test("a formula-looking team name is exported as text", () => {
  const { stations, slots, cells } = eventSchedule();
  const text = scheduleToCsv({
    stations,
    slots,
    cells,
    timeZone: "America/Los_Angeles",
  });
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil.example"")"`));
  assert.ok(!/(^|,)=HYPERLINK/m.test(text));
});

test("judges column appears when stations have judges; cancelled slots stay empty", () => {
  const rows = parseCsv(
    scheduleToCsv({
      stations: [
        { id: "a", label: "Station 1", judges: ["Priya Raman", "Grace Liu"] },
        {
          id: "b",
          label: "Station 2",
          judges: ["Kenji Watanabe", "Thomas Nguyen"],
        },
      ],
      slots: [
        { id: "s1", index: 1, startsAt: "2026-11-08T18:07:00Z" },
        { id: "s0", index: 0, startsAt: "2026-11-08T18:00:00Z" },
      ],
      cells: [{ stationId: "a", slotId: "s0", teamName: "ShelterLink" }],
      timeZone: "America/Los_Angeles",
    }),
  );
  assert.deepEqual(rows, [
    ["Station", "Judges", "10:00 AM", "10:07 AM"],
    ["Station 1", "Priya Raman, Grace Liu", "ShelterLink", ""],
    ["Station 2", "Kenji Watanabe, Thomas Nguyen", "", ""],
  ]);
});

test("two teams in one station-slot is refused", () => {
  assert.throws(
    () =>
      scheduleToCsv({
        stations: [{ id: "a", label: "Station 1" }],
        slots: [{ id: "s0", index: 0, startsAt: START }],
        cells: [
          { stationId: "a", slotId: "s0", teamName: "One" },
          { stationId: "a", slotId: "s0", teamName: "Two" },
        ],
        timeZone: "America/Los_Angeles",
      }),
    /Two teams at one station/,
  );
});
