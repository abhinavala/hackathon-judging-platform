# Wednesday rehearsal: a script to follow

You drive this yourself, on Preview, with the real event data, in about 90
minutes. It walks Saturday's check-in and Sunday's schedule in the order they
happen, then the things that go wrong. The screens are in
[screens/README.md](screens/README.md): the numbers in brackets below, like
(23), are the screenshot to compare against.

For every step: **do** what it says, **check** that you see what it says,
and if you don't, look at **if not**. Then decide (see the end): fix now,
note for Thursday, or ignore. Keep a notes file open.

The **Time** column is how long the step took you. Fill it in. The Sunday
block (Part 4) is the one that must fit between Devpost closing and judging
starting.

---

## Part 0: before you start (set up Tuesday night, not by you)

On Preview, ready before you sit down:

- An empty AWS x A10 Hack event with the **real judging start**, the real
  **tracks**, **stations with their location text**, and **judges with their
  affiliations**, from your inputs.
- About 55 synthetic teams already checked in (made-up names, made-up
  `@scu.example` addresses), spread across the real tracks the way the
  real form's would be. Your hand check-ins in Part 2 make it ~60.
- Nothing generated, nothing published, no announcements.
- `aala@scu.edu` is an organizer.
- **The rehearsal link**: a preview of `main`. Use only that link today;
  bookmark it. (Not the production address: production stays clean for
  Saturday.)

**Email on Preview:** previews email only `abhinav.t.ala@gmail.com`,
`abhatti@scu.edu` and their `+anything` aliases. Everyone else, including
the real judges' addresses, is refused, and the refusal is recorded. So use
`abhinav.t.ala+something@gmail.com` for every address you type today, and
watch **abhinav.t.ala@gmail.com** for mail.

Have: a laptop, your phone, and the Gmail inbox open on the laptop.

---

## Part 1: setup check (10 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 1.1 | On the laptop, open the rehearsal link `/login`, enter `aala@scu.edu`, open the email, tap Sign in | You land signed in; `/organizer` shows the overview (01) | No email: wrong link (production instead of the rehearsal link), or the sender. Tell me | |
| 1.2 | Overview | Judging start is the real one; Help location is the real one; Teams checked in ≈ 55 | Wrong start or help: fix on Event (02) now, it's what teams read | |
| 1.3 | **Event** (02) | Judging start, check-in opens/closes, help location; "What participants see now" reads right | Times are in the event's zone (Pacific). Fix and save | |
| 1.4 | **Tracks** (03) | Every real track, sponsor set where a sponsor judges it, "judged live" ticked only for tracks judged at the stations | A sponsor typed differently from the judges' affiliation won't match: make them identical | |
| 1.5 | **Stations** (04) | Every station, location text that a stranger could walk to, two judges each | A bare "Station 4" with no location is the thing to fix | |
| 1.6 | **Judges** (05) | Every judge, the right affiliation; the pre-flight says every track can be covered | A ⚠️ (06) tells you how many sponsor judges to add | |

---

## Part 2: Saturday morning, check-in (20 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 2.1 | **Event**: set "Check-in opens" to a minute ago, save | `/checkin` shows the form (12), not "opens at" (11) | The time is Pacific; check the date too | |
| 2.2 | On your **phone**, rehearsal link `/checkin`. Check in a team: captain `abhinav.t.ala+cap1@gmail.com`, teammates `abhinav.t.ala+m1@gmail.com` and `abhinav.t.ala+m2@gmail.com`, a track | Within ~2 s: "You're checked in", the join code large, the link once, **the two teammate addresses listed** (13); below it "The judging schedule isn't published yet" (14), not "isn't in the judging schedule" | If it says "isn't in the judging schedule", a schedule is already published: stop and tell me | |
| 2.3 | **Screenshot it**, as teams are told to | | | |
| 2.4 | **Email path, the important one.** In Gmail, find the receipt (to `+cap1`) and the two invitations (to `+m1`, `+m2`), from "SCU ACM" | All three within a minute, and **in the Inbox tab**, not Promotions or Spam. Each has the join code and one plain address | Promotions or Spam: **stop and tell me**; it changes Saturday | |
| 2.5 | On the phone, in the **Gmail app**, open the `+m1` invitation and tap Sign in | It opens (in Gmail's in-app browser) signed in as `+m1`, on the team's page | "Link expired" or the sign-in page: note exactly what you saw. This is the phone test from Monday | |
| 2.6 | Check in a second team with a deliberate typo: teammate `abhinav.t.ala+m3@gmial.com` | The success screen lists `…@gmial.com`; you can see the typo | | |
| 2.7 | Overview on the laptop | "Check-in emails": the first team "all sent"; the second shows **not sent** (the typo'd address is refused here: on Saturday Gmail would bounce it instead) | | |
| 2.8 | Sign in as the second team's captain (from its receipt), **Teammates** page (19): correct `gmial` to `gmail` | "Changed … Invitation emailed"; the invitation arrives; the overview's "not sent" for that team clears | | |
| 2.9 | Check in a third team on the phone **with JavaScript off** if you can, or skip | Same success screen | | |
| 2.10 | `/t` on the phone, type the first team's code in lower case with a space | Lands on the team page (15) | | |
| 2.11 | **Event**: set "Check-in closes" to now, save. Reload `/checkin` | The form still works but warns that check-in has closed | | |

**The dashboard watcher** (see the runbook): in 2.7 you did their job. That's
what they do for the whole of Saturday check-in.

---

## Part 3: Saturday afternoon (5 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 3.1 | **Import** (21): only if you'll use the Google Form as a backup. Upload the form's CSV export | The preview (22) reads every question; nothing is written until you press Import | Track names in the form must match the Tracks screen exactly | |

---

## Part 4: Sunday morning, the schedule (time this whole part)

This is the block that has to fit between Devpost closing and judging
starting. Start a stopwatch at 4.1.

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 4.1 | **Generate** (23). Leave the start time (the event's judging start), the slot length, and **the suggested slot count (two above the minimum)**. Leave pairings on "form automatically" | Pre-flight says every track can be covered; the team list has every checked-in team ticked | A team that shouldn't be there: untick it. A withdrawn team shows unticked with a reason | |
| 4.2 | Press Generate | A draft review page (24) within a few seconds | | |
| 4.3 | Read every ⚠️ warning | Each says what it means. Expected: none about empty seats (the spare slots are recommended); possibly overlap or uneven load | "N teams not covered": a sponsor is short, see 1.6 | |
| 4.4 | Tick each "I've reviewed this", **Publish** | "Published vN. Participants now see this version." (25) | The button does nothing: an unticked warning. Tick it | |
| 4.5 | **Announcements** (41): post, Info level, exactly: **"The judging schedule is live. Your times and station are on your team page."** | On the phone, the team page shows the banner within 25 s (43) and now shows the team's times and station (30) | | |
| 4.6 | Phone: the first team's page | Its first presentation large: day, station, **location**, time; both presentations listed | | |
| 4.7 | **Printable schedule** (from the published version's page). Print to PDF | Page 1: every team A to Z with both times and stations (27). Page 2: the grid (28). Station locations and the help line on page 1 | Page 1 runs to a second sheet past ~68 teams: that's fine | |
| 4.8 | Open `/board/<event>` on the laptop, full screen | "First up" and each station's team and location (29) | | |
| 4.9 | Borrow a judge for a minute: on **Judges**, note one judge's real email, change it to `abhinav.t.ala+judge@gmail.com`, save. On the phone, `/login` with that alias, sign in from the email, open `/judge` | Their station, its teams in time order, the next one marked (34) | Then **put the real email back** on Judges |

**Stop the stopwatch.** Write down the total. Compare it with the gap
between Devpost closing and the judging start.

---

## Part 5: when things change (20 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 5.1 | **Event**: set check-in opens to a minute ago. Phone: check in a late team (aliases). Then set it back | The late team's page says it isn't in the schedule and to find an organizer (36); that's right *after* publishing | | |
| 5.2 | Published version → **Late changes** (37): add the late team | A draft: "adds … at Station N …; everyone else keeps their seats and times" (38), "0 moved, 1 added" | Anything moved: stop, tell me | |
| 5.3 | Before publishing it, from the published version again: **drop** a different team | A second draft | | |
| 5.4 | Publish the late-team draft (5.2). Then open the drop draft (5.3) | The drop draft says it's out of date and can't be published, with a link to the live version (39); the list says "out of date" (40) | | |
| 5.5 | From the live version, drop the team again; publish | The dropped team's page says it isn't scheduled; **Generate** now lists it unticked as withdrawn | | |
| 5.6 | **Stations**: remove an AWS judge from a station, save | An **amber warning**: "N teams here chose AWS and no AWS judge sits here now", naming them. The published version's coverage figure drops | Put the judge back; the warning is the point | |
| 5.7 | **Announcements**: post a warning-level message, check the board (42) and a team page, then **Clear** it | Appears and disappears within ~25 s | | |
| 5.8 | Phone, a team page open: turn on airplane mode for a minute | "Last updated 1 minute ago. We can't reach the server…" (44). Then **reload** in airplane mode: the browser's offline page. That's expected; the screenshot from check-in is the fallback | | |

---

## Easy to get wrong, and order that matters

- **Use the rehearsal link today, the production address on Saturday.** A
  test email's link always goes back to where it was sent from.
- **Check-in window**: times are Pacific. It doesn't open itself early: if
  people queue early on Saturday, move "Check-in opens" on Event.
- **Spare slots**: leave Generate's suggested count. At the minimum, the first
  late team adds slots to the end and costs every judge 14 minutes.
- **Publish in order**: a late change made from v5 can't be published after
  v6. Make it again from the live version.
- **Announce after publishing**, every time (4.5). It's the only "your
  schedule is out" message: there is no schedule email.
- **Swap judges like for like**: the amber warning tells you when you didn't.
- **Database changes go in before code** (for whoever deploys): a migration is
  applied to production before the pull request that needs it is merged.
  Nothing on Wednesday needs one.

---

## When a step fails: fix now, Thursday, or ignore

- **Fix now (tell me straight away):** anything in Part 2 or Part 4. A team
  can't check in, the code or link is wrong, an email lands outside the
  Inbox, a published schedule moves a team it shouldn't, the printout or
  board is wrong. These are Saturday and Sunday.
- **Note for Thursday:** wording that would confuse someone, a step that
  took far longer than it should, anything in Part 5 that worked but was
  unclear.
- **Ignore:** anything that only happens because this is Preview (the long
  `…vercel.app` addresses, refused emails to real addresses).

After the run: send me your notes file and the Part 4 total. I'll reset
Preview.
