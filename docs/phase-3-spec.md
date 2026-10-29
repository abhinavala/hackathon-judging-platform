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
- `nSlots` ≥ max panel degree
- the run completes in < 1s

**Panel balance is not a universal invariant.** `teamsPerPanel` max − min ≤ 1
is asserted only on the unconstrained path (no tracks) and on the real
configuration below. In track-aware runs Stage 1 deliberately puts coverage
first: it filters to the best-covering panel pairs, uses load only as a
tie-break, and relaxes the degree cap when the last teams have no legal pair.
Over 600 randomised scenarios the Python's spread ran from 0 to 17, with every
schedule valid. **Operationally: uneven sponsor demand means some panels see
noticeably fewer teams than others.** The preview should show teams per panel.

Then a fixed-seed regression test on the real configuration: 60 teams,
4 AWS + 3 A10 + 9 unaffiliated judges (8 panels). Two team mixes, both
asserted against the Python's actual output:

| Team mix | Covered | Track-seats | Slots | Min gap |
|---|---|---|---|---|
| **Explicit counts** (the real event's shape): AWS 36, A10 24, 12 wanting both, 12 neither | 60/60 | **60/60** | 15 | 5 |
| **Random draw** `make_teams(60, {AWS: 0.6, A10: 0.4}, seed=1)` | 60/60 | **54/54** | 15 | 5 |

The earlier "54/54" figure came from the random draw, not the explicit counts.
Both meet the targets: every team fully covered, every track-seat met, 15
slots, minimum gap ≥ 4. Panels are exactly balanced (15 each) in both.

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

**The recruiting target must be computed iteratively, not with a formula.**
The obvious one-shot answer, `ceil(teams_wanting_S / nSlots) − judges_from_S`,
is wrong, because `nSlots` is not fixed: it is `ceil(2T / D)` with
`D = floor(judges / 2)`, so adding judges can add a panel and cut **every**
judge's slots. Counterexample: 60 teams, 16 judges (8 panels × 15 slots), one
GCP judge, 45 teams wanting GCP. The formula says `ceil(45/15) − 1 = 2`. But
18 judges make 9 panels with only 14 slots, and `3 × 14 = 42 < 45`: still
short. The correct answer is 3 (19 judges, still 9 panels × 14 slots,
`4 × 14 = 56`). `lib/scheduler/capacity.ts` therefore tries `k = 1, 2, …`,
recomputing `nSlots` for each roster size, and returns the first `k` that
clears the shortfall. Do not "simplify" it back to the formula;
`tests/scheduler/preflight.test.ts` fails if you do.

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

**As built.** A late change never edits the published version. It drafts the
next version as a copy of the published one (same slots, seats and times)
with only that change, and the organizer publishes it through the normal
review, so it bumps the version teams see and shows in the diff ("1 added,
0 moved" / "1 removed, 0 moved"). Published and archived versions keep their
diff against the version they replaced.

- Insertion (`lib/admin/late.ts`) tries every station pair with every pair of
  free slots, O(D²×S²): 14,400 checks for 8 stations × 15 slots, still
  instant. The spec's O(D²×S) assumed one slot choice per station, but the
  two slots have to be chosen together (different, and spaced). It ranks by:
  fewest appended slots, then tracks covered, then gap ≥ 3, then least-used
  pair (fewest teams at the two stations, then fewest shared), then the
  earliest finish. Slots starting within 10 minutes are never offered.
- A full schedule (60 teams fill 8 × 15 seats exactly) grows by up to two
  slots at the end rather than moving anyone. A dropped team's seats are
  free for the next late team.
- A late-change draft records the version it copied (`stats.basedOn`). If
  another version is published first, the draft is a structural error and
  can't be published, since publishing it would undo that change.
- Generate, once a version is published, requires an explicit "regenerate
  anyway" acknowledgement and points to late changes instead.
- **Acknowledgements on late-change drafts.** Warnings identical to the
  published version's (same kind, title and every detail line) were accepted
  when it was published: they stay visible as "already accepted in vN" but
  need no new tick. Anything changed at all (spacing 3 -> 2, 14 idle seats
  -> 16) or new needs one, enforced server-side too. Reason: at 10:15 with a
  team waiting, five tick boxes means nobody reads the one that matters
  ("0 moved, 0 added, 1 removed"); fewer, meaningful acknowledgements beat
  complete ones nobody reads. Hiding them was rejected: "you don't need to
  re-tick this" and "we hid this from you" are different things.
- **Pattern: a stale draft must never silently undo real changes.** Two
  instances so far, both blocked as structural errors: a late change
  drafted from a version that's no longer published (`stats.basedOn`), and
  any draft older than the published version (`supersededBy`). Any new way
  of creating or publishing a draft must answer "what if something was
  published after this was drafted?"
- **Generate with slack.** At the minimum slot count every seat is full
  (60 teams on 8 stations: 15 slots, 120 seats), so the first late team adds
  two slots and costs every judge 14 minutes. The generate screen defaults
  to the minimum + 2 (17 slots, 16 spare seats: up to 8 late teams at no
  added time, plus slack for timing drift). See the event-week runbook.

All writes go through the service role, server-side, as with the seed.

---

## Acceptance criteria

1. `npm run test:scheduler` — ≥200 randomised scenarios, zero invalid, < 1s each
2. The fixed-seed regression matches the Python: 60/60 covered, every
   track-seat met (60/60 for the explicit counts, 54/54 for the random draw),
   15 slots, min gap ≥ 4
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
