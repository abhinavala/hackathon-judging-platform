# Event-week runbook

Operational steps for the week of the AWS x A10 Hack (Saturday-Sunday,
November 7-8, 2026). Deploy-time settings are in
[deploy-checklist.md](deploy-checklist.md).

## Preview deploys are safe during event week

Preview has its own Supabase project (`tcauglluxdmqselpsqjl`), separate from
production, so a preview deploy can't write to real event data and no deploy
freeze is needed. If Preview's variables ever point at the production
project again, stop preview deploys from November 5 until after the event:
remove the Preview-scoped Supabase variables in Vercel, or set Project
Settings, Git, Ignored Build Step to `[ "$VERCEL_ENV" != "production" ]`.

## Check-in morning: email

- [ ] Captains get their join code on screen at once; the receipt and
      invitations follow within seconds. The organizer dashboard's **Check-in
      emails** row counts teams sent, sending and failed, and a **Check-in
      emails not sent** section lists each failed team with its join code
      and the addresses that got nothing. Glance at it every few minutes.
- [ ] Watch the sending account's inbox: Gmail accepts every message and
      bounces bad addresses later, so a typo'd address shows up there as a
      bounce. The captain fixes it on `/team/members`.
- [ ] Don't run `stress:checkin` or a dry run on Friday or Saturday: every
      test send counts against the account's 2,000/day (rolling 24 hours).

## The help desk: what to say

For whoever staffs the help location on Saturday and Sunday. Have the
printed schedule, and a printed **list of every team's join code**. The
site has no screen that lists join codes yet (an organizer only sees a
team's code when its emails failed), so until it does, ask for the list to
be exported from the database after check-in closes. Without it, a team's
code is on its captain's check-in screenshot and in every email the team
was sent.

| They say | Say / do |
|---|---|
| "My link says already used" or "expired" | Normal: a sign-in link works once and for 4 hours, and some email systems open links by themselves. Two fixes, either is fine: on the site's sign-in page, enter their email for a new link; or **give them their team's join code** and send them to the site's home page, where the code box shows their times with no sign-in |
| "I never got an email" | Check the address with them (a typo is the usual cause). Their captain can fix it on the team page under "Fix a teammate's email", which sends a new invitation. Meanwhile, the join code |
| "Where do I go? When am I on?" | The join code on the home page, or the printed schedule: page 1 is every team A to Z with both times and stations |
| "Our team isn't in the schedule" | Before the schedule is published (Saturday), that's expected: their page says so. After it's published: the organizer adds them as a late team |
| "It says I'm not on a team" | They signed in with an address their captain didn't list. The captain adds them on the team page, or use the join code |
| Anything else, or a queue | The join code first; debug later |

## Check-in: the dashboard watcher

**Watcher:** ______________________ (one person, the whole of Saturday
check-in, with a laptop signed in as an organizer)

You're making sure every team's emails actually went out. When a team checks
in, the site emails the captain a receipt and each teammate an invitation, in
the background. Usually this takes a few seconds. If it fails, nobody is told
except this screen.

1. Open the organizer **Overview** (`/organizer`) and reload it every few
   minutes. Look at the **Check-in emails** row: "N team(s) all sent" is
   good.
2. If a section called **Check-in emails not sent** appears, it lists each
   team with its **join code** and the addresses that got nothing:
   - **An address is listed** (often a typo): find that team's captain (the
     team name is on the list; ask at the check-in table), show them the
     address, and have them fix it on their team page under "Fix a
     teammate's email". Fixing it sends a new invitation and the row
     disappears.
   - **It says "possibly everyone" and "still sending"**: the emails were cut
     short. Give the captain the **join code** from the list: it works on any
     phone at the site's `/t` page, no email needed. Then tell the organizer
     running the event.
3. If several teams appear at once, stop checking teams one by one and tell
   the organizer: the email itself may be down. The join codes still work.

Nothing retries a failed email by itself. You are the retry.

## Generate the real schedule with slack

- [ ] **Generate with 2 slots above the minimum, not at it.** For 60 teams
      on 8 stations the minimum is 15 slots, which is exactly full at 120
      seats. The first late team then needs two new slots at the end,
      costing every judge 14 minutes. 17 slots leave 16 empty seats: room
      for up to 8 late arrivals at no added time, and slack for the per-slot
      timing drift that builds up across a morning. The generate screen
      suggests this by default; don't clear the field. Those spare seats
      don't raise a warning; only more empty seats than that do.
- [ ] **Straight after publishing, post the announcement.** Not optional:
      there is no schedule email (by decision), so this is the message that
      the schedule is out. **Announcements**, level Info, exactly:

      > The judging schedule is live. Your times and station are on your
      > team page.

      Then check it on the board and on one team's page within 25 seconds.
- [ ] A team arrives late or leaves: on **Schedules**, click **"Late team
      or dropped team"** beside the published version. It opens straight on
      **Late changes**, the first section of a published schedule (above the
      coverage, spacing and grid). Add a late team or drop a team; each
      drafts the next version with only that change; review and publish it.
      Never regenerate after publishing: teams have screenshotted their
      times.
- [ ] On a late-change draft, only **new or changed** warnings need a tick.
      Warnings identical to the published version's show as "Already
      accepted in vN" (still visible, no tick box). Read the ticked ones,
      above all "Changes from the published vN: 0 moved, 1 added".
- [ ] An older draft lying around (the list says "superseded by vN", or
      "out of date (made from vN)" for a late change drafted from an earlier
      version) can't be published: it would undo the late changes since.
- [ ] A dropped team is **withdrawn** once the drop is published. If you
      ever regenerate, Generate leaves withdrawn teams unticked and says so;
      tick one only if it really is back.
- [ ] Judges open `/judge` on their phone (they sign in like everyone
      else): their station, their teams in time order, the current one
      highlighted. If a judge sees "not given a station yet", seat them on
      **Stations**.

## Rehearse late changes in the dry run

These screens get used in a hurry at 10:15 when a team turns up late, so
click through them on the Preview dry run before the event, in a real
browser:

- [ ] Add a late team to the published version, review the draft (the
      banner names the seats; the diff shows 0 moved, 1 added), publish, and
      open that team's `/t/<code>` page.
- [ ] Drop a team, publish, and check its page says it isn't scheduled and
      that the board shows its seats empty.
- [ ] Discard an unwanted late-change draft.

## Keep the Supabase project awake

Free-tier projects **pause after about a week without activity**, and a
paused project serves nothing: no sign-in, no schedule, no board.

- [ ] **A week before (by Saturday, October 31):** open the project in the
      Supabase dashboard. If it shows as paused, restore it; restoring can
      take several minutes.
- [ ] **Friday, November 6:** check again, and load the production `/login`
      and an organizer page to confirm the app reaches the database.
- [ ] **Saturday morning before check-in:** check once more. Do not rely on
      Friday's check alone.

## Back up the database (pg_dump)

Free-tier projects have **no downloadable backups**, so take our own. Get the
connection string from the dashboard (Connect, session pooler) and keep the
password out of shell history and out of the repo.

```sh
# schema + data, plain SQL, restorable with psql
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges \
  --schema=public --schema=auth \
  -f "backup-$(date +%Y%m%d-%H%M).sql"
```

`npx supabase db dump --linked -f schema.sql` and `--data-only -f data.sql`
work too if `pg_dump` isn't installed locally.

- [ ] **Before the event (Friday, November 6):** take a dump and confirm it
      restores into a local database (`psql` into the local Supabase on port
      54322).
- [ ] **After check-in closes (Saturday):** dump. This captures every team,
      member and track selection, the data that is hardest to re-collect.
- [ ] **After the schedule is published (Sunday, before judging):** dump.
- [ ] **After judging:** dump, so the final state survives anything that
      happens next.
- [ ] Store dumps outside the laptop that took them (they contain participant
      emails and phone numbers; keep them private).
