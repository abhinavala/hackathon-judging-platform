# What breaks, how you'll know, what to do

Companion to `event-week-runbook.md`. That one is the sequence of steps; this
one is for when something doesn't go to plan. Merge anything that overlaps.

**The one rule:** if everything else fails, the printed schedule on the wall
still works. Print it the morning of. Nothing below matters more than that.

---

## The architecture in one paragraph

A Next.js app on Vercel talking directly to Postgres on Supabase. There is no
backend of our own — **authorization lives in the database as RLS policies**,
which is why 51 assertions guard it and why a UI bug can't become a data leak.
Sign-in links are minted server-side with `generateLink()` (which sends
nothing) and delivered by our own sender, Gmail SMTP from an scu.edu account,
because Supabase's built-in mailer is capped at 2 messages/hour. The schedule is produced by an exact algorithm
(König edge colouring) and is versioned: regenerating makes a draft, publishing
flips it live, and participants only ever read the published one.

---

## Email

Email is the most likely thing to misbehave, which is why the join code exists.

| Symptom | Likely cause | What to do |
|---|---|---|
| Nobody receives anything | `AUTH_LINK_SENDER` not `smtp`, or the App Password was revoked or changed | Check the Vercel env vars; `npm run mail:dry-run -- --ping` logs in without sending. Meanwhile, join codes |
| Organizer dashboard lists "Check-in emails not sent" | Those addresses got nothing at check-in (the emails go out after the captain is answered) | Read the team's join code out, or the captain fixes the address and resends on `/team/members`, which clears the entry |
| A team stuck at "sending" on the dashboard | The background send was cut short | Same: join code, and the captain can resend |
| One person doesn't receive | Typo'd address, or spam folder | Captain fixes it on the team page (`/team/members`) and resends. Meanwhile give them the join code |
| "Link expired" | Links last 4 hours | One-click resend on the sign-in page |
| "Link already used" | Links are single-use; requesting a new one kills the old | Same resend path |
| Sends start failing with 4xx or "limit" errors | Gmail's 2,000/day (rolling 24 hours) used up, or Gmail throttling a burst | There is no fallback sender, by decision: give out join codes. Gmail doesn't report remaining quota, so don't spend it on test sends on Friday or Saturday |
| Link opens on a phone but doesn't sign in | `SITE_URL` points at the wrong host | Must match the domain people actually visit |

**The escape hatch for all of it:** every team has a join code shaped
`ABCD-1234`, shown on screen at check-in. `/t/ABCD-1234` gives the schedule
with no account at all. Codes are also visible to organizers, so you can read
one out. **Keep a printed list of join codes at the help desk.**

---

## Sign-in and identity

| Symptom | Cause | Fix |
|---|---|---|
| "You're not on a team" | Their address isn't on the roster, or is misspelled | Captain corrects it on `/team/members`. Correcting an address also kills the sign-in link sent to the typo |
| A judge sees nothing | Not seated on a panel, or the schedule isn't published yet | Judges only see teams on **published** schedules at **their own** station |
| A judge added that morning sees nothing | Should work — triggers link them on insert | If it genuinely doesn't, check they were added to a *panel*, not just the judge list |
| Someone can't get in at all | Any of the above | Join code. Don't debug during judging |

---

## The schedule

| Symptom | Cause | Fix |
|---|---|---|
| Generate warns teams can't be covered | Too few judges from a sponsor | Pre-flight check tells you how many to add. Or publish anyway — track coverage is a **soft** constraint and never blocks |
| A team is missing from the schedule | Not included at generate time (default is checked-in only) | Use "Late team" on the published version |
| Published the wrong version | — | Publish the right one. The version number increments and teams see "v4" |
| An old draft is sitting there looking publishable | — | Drafts older than the published version **can't** be published and are marked "superseded" |
| A team shows up late | — | Schedules → **"Late team or dropped team"** (first section of the published schedule) |
| A team doesn't show | — | Same place, drop them. Their seats free up for the next late team |
| Adding a late team added 14 minutes | The schedule was exactly full | **Generate with 17 slots, not 15.** 16 spare seats absorb up to 8 late teams at no added time |

**Late changes never edit the live schedule.** They copy it into a new draft
with one change applied, which you review and publish. Everyone else keeps
their exact station and time — that's asserted by tests.

---

## Infrastructure

| Symptom | Cause | Fix |
|---|---|---|
| Everything 503s with "can't verify your access" | Supabase unreachable | Gated pages fail **closed** by design. Check Supabase status. Public pages and the printed schedule still work |
| Site is up but data is stale | Venue Wi-Fi | Team pages cache the last good copy and say "last updated X ago" |
| Supabase project is paused | Free tier pauses after ~1 week idle | Unpause in the dashboard. **Check this on 31 Oct, 6 Nov, and the morning of** |
| A preview deployment wrote to real data | Env vars pointing at production | Preview has its **own** Supabase project. Also: no preview deploys from 5 Nov |
| Total failure | — | The printed schedule. This is why it exists |

---

## Known quirks that are not bugs

- **`cacheComponents` and status codes.** Any page-level `redirect()` or
  `notFound()` must happen *before* render or it arrives as a 200. This caused
  two real bugs; both are fixed and tested. If you add a guarded route, check
  the status code, not just the page content.
- **`improve_spacing` is order-sensitive.** It iterates a map and `sort` is
  stable, so insertion order breaks ties. Don't "clean up" the scheduler
  without re-running the golden tests.
- **Production builds catch what dev doesn't.** Three bugs so far appeared
  only in a production build (the import 500, redirects arriving as 200s,
  and the nodemailer bundling bug below). Any change touching server-only
  modules gets `npm run build && next start` and a look at the rendered page.
- **Email failures at check-in are on the organizer dashboard, not the
  captain's screen.** The captain is answered first; the emails follow.
- **The Apps Script relay's redeploy trap**, if it's ever used instead of
  SMTP: new deployment = new URL = silent failure.
- **Email OTP codes are 8 digits**, not 6, if anyone ever builds code entry.
- **Supabase's built-in mailer is locked at 2/hour.** These calls would use it
  and must never appear: `signUp`, `signInWithOtp`, `resetPasswordForEmail`,
  `inviteUserByEmail`, `updateUser({email})`, `reauthenticate`.

---

## Problems we hit and how they were solved

Worth knowing because the reasoning generalises.

**A bug in the scheduler itself.** Flipping a Kempe path corrupted the
occupancy maps, producing an invalid schedule about 1 run in 2,400 — two teams
at one station in one slot. Found during the TypeScript port, confirmed
independently across 2,400 runs, fixed in both implementations.
*Lesson: 800 validation runs weren't enough; the bug lived outside the seeds we
happened to test.*

**Judges could see draft schedules**, including team phone numbers, before
anything was published. A `SECURITY DEFINER` helper bypassed RLS and didn't
filter on status.
*Lesson: `SECURITY DEFINER` means every filter must be written explicitly.*

**Judges added after they already had an account were never linked** — the
"alum signs in Friday, added as a judge Saturday" case. Fixed with triggers
that link on roster insert, not just at signup.

**A race condition in check-in.** The one-team-per-event trigger used
`SELECT COUNT`, which can't see another transaction's uncommitted rows, so two
teammates submitting simultaneously would *both* succeed. Fixed with a
per-event advisory lock.
*Lesson: this only appears under real concurrency — exactly what you get when a
keynote ends.*

**A 500 on the import screen** that 58 passing server-side tests couldn't see,
because the failure was in Next's handling of an action returning data.
*Lesson: screens used once, live, with no fallback get a real browser pass
against a production build.*

**A verification claim that was wrong.** "Works without JavaScript" had been
confirmed by matching text inside React's data payload rather than the rendered
page. The no-JS path genuinely didn't work.
*Lesson: verify what the user sees, not what the framework serialised.*

**Stale drafts silently undoing work** — twice. Two late changes drafted from
one version; and an old draft still publishable after newer ones went live.
Both now blocked.
*Lesson: any new way to create or publish a draft needs this question asked of
it.*

**nodemailer bundled into the wrong module.** In a production build, Next's
bundler merged nodemailer with `lib/server-env.ts` and mixed up their exports:
the check-in welcome box rendered "undefined/t". Dev was fine. Fixed by
loading nodemailer at runtime (`serverExternalPackages`) and keeping
`server-env.ts` free of heavy imports.
*Lesson: the third production-only bug; build and look.*

**Check-in made captains wait for email.** Measured on Preview: 4.8 s per
check-in with SMTP, 12.4 s inside a 70-request burst before any email. Long
enough to tap again and be told your own team "already checked in". Now the
captain is answered first (1.5 s; 4.1 s under the burst) and the emails go
out behind `waitUntil`, with the outcome recorded for organizers.
*Lesson: measure the real path under the real burst before trusting it.*

**A diagnosis that was wrong.** A "linking bug" was reported, and a fix
written, for something that worked fine — the RLS suite had been asserting it
since migration 0003.
*Lesson: check the test suite before writing the fix.*

---

## Deliberately not built

So nobody adds them later thinking they were forgotten:

- **A fallback email sender.** The join code is the fallback: no account, no
  inbox, tested.
- **A "schedule is published" email.** Everyone holds a session from
  check-in, the board announces it, and the announcement banner covers the
  rest. It would also have been the only large batch send. The `schedule`
  template exists; nothing sends it.
- **AWS credential distribution.** ACM's existing script still sends
  credentials. The `credentials` template is unused.

---

## Before the event

- [ ] **Print the schedule.** Non-negotiable
- [ ] Print the join codes for the help desk
- [ ] Unpause Supabase (31 Oct, 6 Nov, morning of)
- [ ] `pg_dump` on 6 Nov — free tier has no backups
- [ ] Generate with **slack slots** (17, not 15)
- [ ] Set judging start time and help-desk location in Event settings
- [ ] Enter station **location text** — "blue section, back wall", not just a number
- [ ] Confirm the board renders on the actual projector from the back of the room
- [ ] No preview deploys from 5 Nov
- [ ] Re-enable Vercel preview protection if it was turned off
- [ ] Add one other officer to Vercel and GitHub, so you're not the only person who can deploy
- [ ] After the event: revoke the sending account's App Password and remove `SMTP_PASSWORD` from Vercel

---

## If you have thirty seconds and someone is standing in front of you

1. Can't see their schedule → **give them the join code**
2. Team missing → **Late team** on the published schedule
3. Nothing works at all → **point at the printed schedule on the wall**
