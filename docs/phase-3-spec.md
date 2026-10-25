# Phase 3 — Schedule generation

**Goal:** an organizer can load the teams that actually submitted, generate a
conflict-free judging schedule that respects sponsor-track coverage, review it
with real warnings, and publish it — after which participants can see it.

This is the phase with the most novel code and the clearest definition of done:
**the Python reference implementation in `scheduler/` already works and is
validated.** The port is not a redesign. If the TypeScript disagrees with the
Python, the TypeScript is wrong.

---

## Part 1 — The algorithm module

### Rules

- **Pure.** No database calls, no Supabase imports, no I/O. Input is plain data,
  output is plain data. This is what lets the property tests run thousands of
  times in milliseconds.
- Lives in `lib/scheduler/`, exported through one entry point.
- Ported from `scheduler/*.py`. Read those files first — they carry comments
  explaining *why*, which the code alone doesn't show.

### Signature

```ts
type Sponsor = string;                 // "AWS", "A10", …
type JudgeRoster = (Sponsor | null)[]; // null = unaffiliated (alum/faculty)

solve(input: {
  teamTracks: Set<Sponsor>[];   // one entry per team
  judges: JudgeRoster;
  seed?: number;
}): {
  panels: [number, number][];        // judge index pairs
  panelSponsors: Set<Sponsor>[];
  assignments: [number, number][];   // team -> [panelA, panelB]
  slotOf: Map<string, number>;       // `${team}:${panel}` -> slot index
  nSlots: number;
  stats: {
    teamsFullyCovered: number;
    trackSeatsMet: number; trackSeatsWanted: number;
    teamsPerPanel: [number, number];
    overlapRange: [number, number];
    gapRange: [number, number];
    uncoveredTeams: { team: number; missing: Sponsor[] }[];
    winningStrategy: string;
  };
}
```

### The four stages

**Stage 0 — form panels** (`stage0v2.py`). Generate ~70 candidate panel
compositions — spread, mix, hybrid-1..6, and 60 random restarts — score each by
running Stage 1, keep the winner. Do not replace this with a single heuristic.
Spread beats mix when sponsor judges are scarce; mix is required when teams
submit to 3+ tracks. Random restarts won most multi-sponsor cases in testing.

**Stage 1 — assign teams to panels** (`pipeline.py`, `assign_teams`).
Scarcity-aware greedy, hardest teams first, plus a repair pass that swaps
uncovered teams onto panels that cover them without hurting the displaced team.

**Stage 2 — edge colouring** (`scheduler.py`, `edge_color`). König's theorem via
Kempe chains. Each colour is a time slot.

**Stage 3 — spacing repair** (`scheduler.py`, `improve_spacing`). Hill-climb to
maximise the minimum gap between a team's two presentations.

### Three pitfalls that caused real crashes

Carry these across or you will rediscover them:

1. **Stage 1 needs a hard degree cap** of `ceil(2T/D)`. Without it the last few
   teams find every remaining panel pair touches a full panel. Crashed at 12
   panels.
2. **Stage 3 needs SWAP, not just MOVE.** At 8 panels, 15 teams across 15 slots
   is fully saturated — zero empty slots, so MOVE can never fire. Adding SWAP
   took the worst-case gap from 1 slot to 5.
3. **Derive `nSlots` from the actual max degree**, not from `ceil(2T/D)`. When
   track constraints force imbalance a panel can exceed the ideal, and assuming
   the ideal crashes the colourer. One extra slot is the correct outcome.

### Property tests — the definition of done

Port the stress harness, not just the algorithm. Over **≥200 randomised
scenarios** (2–4 sponsors, 40–70 teams, 14–24 judges, random track demand),
assert every time:

- every team has exactly 2 presentations
- at two **distinct** panels
- in two **distinct** slots
- no panel has two teams in one slot
- `teamsPerPanel` max − min ≤ 1
- `nSlots` ≥ max panel degree
- the run completes in < 1s

Then a fixed-seed regression test on the real configuration — 60 teams,
`{AWS: 36, A10: 24, both: 12}`, 4 AWS + 3 A10 + 9 unaffiliated — asserting
**60/60 teams fully covered, 54/54 track-seats met, 15 slots, minimum gap ≥ 4.**
The Python produces exactly this; the port should too.

---

## Part 2 — Pre-flight capacity check

Separate, roster-only, and **the highest-value piece of this phase.**

> A judge from sponsor S sits on one panel and sees `nSlots` teams, so S-judges
> collectively produce `judges_from_S × nSlots` sightings. Coverage is possible
> only if that is ≥ the number of teams wanting S.

This depends on nothing but the roster, so it runs the moment judges are
entered — days before the event. Surface it on the judges page:

> ⚠️ **AWS**: 36 teams want this track, but 2 AWS judges × 15 slots = 30
> sightings. **6 teams cannot be covered.** Add 1 AWS judge.

Inverted, it's a recruiting target. This turns a day-of discovery into a
Thursday email, which is the entire point.

---

## Part 3 — Data in and out

**Teams CSV import.** The Google Form is the fallback source, so import must
work from its export. Required: team name, track selections. Optional: Devpost,
GitHub, member emails, eligibility flags. Match existing teams by name; create
missing ones; **report what it will do before doing it.**

**Generate against submitted teams only.** No-show rates run 10–20%. The
generate screen picks which teams are included — default to checked-in, allow
manual exclusion.

**CSV export** in the spreadsheet's layout: stations down the side, time columns
across. This is the printed fallback and the format organizers already read.

---

## Part 4 — Admin screens

Organizer-only, behind the existing proxy guard. Plain is fine; Phase 4 owns
visual design.

1. **Judges** — add/edit name, email, affiliation. Shows the pre-flight check
   live.
2. **Panels/stations** — label, location text, sort order. Panel composition is
   generated by Stage 0, but must be **editable afterwards** — a judge will drop
   out.
3. **Generate** — set slot count, slot length (default 7 min), start time; pick
   included teams; run.
4. **Preview** — see below. Never auto-publish.
5. **Publish** — explicit, creates a new version, flips status.

### The preview must show

| | |
|---|---|
| Coverage | teams fully covered, track-seats met, **uncovered teams by name** with what they're missing |
| Spacing | minimum gap, distribution; **warn if any team has < 3 slots between presentations** |
| Overlap | the panel-pair matrix; warn if any pair shares > 5 of their teams |
| Capacity | unfilled slots, teams per panel |
| Diff | if a published version exists, **what changed** |

Every warning must be overridable. The organizer decides; the system advises.

---

## Part 5 — Publishing

- Generate writes a **draft** (`schedules.status = 'draft'`, next version).
- Publish flips to `'published'`. The partial unique index already enforces one
  published schedule per event per round.
- **Republishing bumps a visible version number.** Teams screenshot their times;
  you need to be able to say "you're looking at v2, current is v3."
- **Late team insertion** (`conventions` in the KB): find the least-used panel
  pair where both panels have free slots that don't collide. O(D²×S), instant.
  **Never re-run the generator after publishing.**
- **Dropped teams** mark their assignments `cancelled`. No re-packing.

All writes go through the service role, server-side, as with the seed.

---

## Acceptance criteria

1. `npm run test:scheduler` — ≥200 randomised scenarios, zero invalid, < 1s each
2. The fixed-seed regression matches the Python: 60/60 covered, 54/54 seats, 15
   slots, min gap ≥ 4
3. Pre-flight check correctly flags an under-staffed sponsor track
4. CSV import round-trips the Google Form export
5. Generate → preview → publish works end to end against seeded data
6. A participant sees the published schedule and not the draft (already covered
   by the RLS suite — confirm it still passes)
7. CSV export opens in Sheets in the station × time layout
8. `npm run test:rls`, `test:smoke`, `typecheck`, `lint`, `build` all pass

---

## Out of scope

Judge scoring (Phase 5). The venue map (Phase 4). Automatic re-generation on
roster change — regeneration is always explicit.
