# Phase 5 — judge scoring

Build spec. Thursday 5 November is the only build day; Friday is the freeze.
Judging is Sunday 8 November at 10:00 AM.

## Decisions already taken

These were decided rather than asked, because they were blocking. Any of them
can be overridden cheaply before Thursday afternoon.

- **Rubric:** four criteria, each 1–5 — Impact, Technical execution,
  Innovation, Presentation. Judges get four minutes per team; finer scales
  produce noise, not precision.
- **The rubric is data, not code.** It lives in a table. No editor UI this
  year; changing it is one SQL statement. Next year someone adds the screen,
  and because the scoring UI already reads the table, that's a small job.
- **Judges score independently.** Four scores per team: two stations × two
  judges.
- **No automatic normalization.** Compute it, display it beside the raw
  ranking, never let it silently reorder. A team asking "why did we lose"
  deserves better than "the algorithm adjusted for panel harshness".
- **No embedded Devpost.** Most sites block iframing. A link, surfaced at
  deliberation rather than during a four-minute demo.

## The governing principle

**Capture is irreversible; analysis isn't.**

If scores land in the database on Sunday, the deliberation view, the
normalization and the export can be built on Sunday afternoon, Monday, or next
month — the data isn't going anywhere. If scores don't get captured, nothing
built later recovers them.

So the build order below is by irreversibility, not by importance. If Thursday
turns out to be half a day, build items 1 and 2 and stop.

---

## 1. Data model

New migration. Never edit an applied one.

**`rubric_criteria`**

| column | notes |
|---|---|
| `id` | pk |
| `event_id` | fk, so next year's event can differ |
| `key` | stable slug, e.g. `impact` |
| `label` | what the judge sees |
| `description` | one line of guidance, shown under the label |
| `scale_min`, `scale_max` | 1 and 5 for now |
| `sort_order` | display order |

Seed the four criteria for this event.

**`scores`** already exists (`assignment_id`, `judge_id`). Add `notes` and
`submitted_at` if they aren't there. One row per judge per assignment, unique
on `(assignment_id, judge_id)`.

**`score_items`**

| column | notes |
|---|---|
| `score_id` | fk |
| `criterion_id` | fk |
| `value` | integer, checked against the criterion's scale |

Unique on `(score_id, criterion_id)`.

Volume is trivial — 61 teams × 4 judges × 4 criteria is under 1,000 rows.

**RLS.** `scores_insert` already exists and is tested; it's the policy this
whole stack was chosen for. `score_items` inherits: a judge may write items
only for score rows they own. Organizers read everything. Participants read
nothing — **scores must never be readable by a team, at any point.** Assert
that explicitly in the RLS suite.

## 2. Score entry — the only irreplaceable piece

Extends the existing `/judge` view, which already lists the judge's teams in
time order.

- Tapping a team opens score entry for that team.
- Four criteria from the table, each 1–5, plus a free-text notes field.
- The Devpost link, if present.
- **Autosave, local-first.** Write to `localStorage` on every change, then
  sync. A sync indicator shows saved / saving / not saved. Venue Wi-Fi will
  drop, and a judge who loses four minutes of notes will not re-enter them.
- Unsynced scores retry automatically and survive a page reload.
- A judge can revise a score until the event is locked.
- Scoring is only possible for assignments on the **published** schedule and
  only at the judge's own station — RLS already guarantees this; the UI should
  not be the thing enforcing it.

Design for one hand, on a phone, in a loud room, between demos.

## 3. Organizer completion view

The question this answers at 11:45 on Sunday: *who hasn't scored what?*

- Per team: how many of the expected scores are in — "3 of 4".
- Per judge: how many of their teams are done — "12 of 15".
- Sort by what's missing. The default view is the problem list, not a
  celebration of completion.

## 4. Deliberation view

- Ranked overall, and filterable per track.
- Each row: team, mean score, **the number of scores it's based on**, and
  notes expandable inline.
- Normalization (per-judge z-score) in a column beside the raw ranking, never
  as the default sort.
- Ties are resolved by human deliberation. The page states that rather than
  inventing a tiebreak.

## 5. Export and lock

- CSV: one row per team per judge per criterion, plus notes, plus totals.
- A lock on the event that stops further score writes, so the numbers used to
  pick winners can't move afterwards.

Both are cheap and both are insurance against the deliberation view being
wrong.

## 6. Finals

The user's own insight: finals is just **round 2** — a second schedule, one
panel containing every judge, one slot per finalist. It reuses the existing
`round` column and needs no new concepts.

**Risk to check first:** the scheduler assumes every team sees two panels.
A finals round has one panel per team. Check whether `generate` handles that.
**If it doesn't, don't fix the scheduler** — hand-seat five or six finalists,
which takes a minute. Changing the scheduler two days before the event is not
a trade worth making.

## Out of scope

- A rubric editor UI
- Per-track rubrics — one rubric, tracks shown as context
- Automatic normalization applied to the ranking
- Embedded Devpost
- Anything that touches check-in, scheduling or publishing. **Phase 5 must be
  purely additive.** Nothing in the Saturday path may read a table it writes.

## Build order

1. Migration, rubric table, seed, RLS, tests
2. Score entry with autosave
3. Organizer completion view
4. Deliberation view
5. Export and lock
6. Finals

Stop wherever Thursday ends. Items 4 and 5 can be replaced on the day by a
SQL query and a spreadsheet; item 2 cannot be replaced by anything.

## Verification

Not "tests pass" — **a human scores a team**:

- Sign in as a real judge on a phone, open your station, score a team on all
  four criteria, add notes.
- Kill the network mid-entry. Confirm nothing is lost and it syncs on
  reconnect.
- Confirm it appears in the organizer completion view.
- Confirm a participant cannot read it.

That last one gets its own RLS assertion, because it's the failure that would
matter most and the one nobody would notice.
