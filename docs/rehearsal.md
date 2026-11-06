# Rehearsal: the full run, a script to follow

You drive this yourself, on Preview, in about **2 to 2½ hours**. It walks
Saturday's check-in (now with AWS codes), Sunday's schedule, judges signing
in and scoring, deliberation and the export, then the things that go wrong.
Screenshots of most screens are in [screens/README.md](screens/README.md):
numbers in brackets, like (23), are the screenshot to compare against.

For every step: **do** what it says, **check** that you see what it says,
and if you don't, look at **if not**. Then decide (see the end): fix now,
note for later, or ignore. Keep a notes file open, and fill in the **Time**
column. Part 4 must fit between Devpost closing and judging starting.

---

## Part 0: what's set up before you start (not by you)

On Preview:

- The AWS x A10 Hack event: judging **Sun 8 Nov 10:00 AM**, check-in window
  **Sat 9:00 AM to Sun 9:00 AM** (you open it early in 2.1), the two tracks,
  8 stations with placeholder locations ("Main hall, table N"), 16 judges.
- **55 synthetic teams, already checked in** (`@scu.example` addresses):
  21 AWS only, 12 A10 only, 11 both, 11 neither.
- **Every one of them already has its codes.** The pool then has
  **3 workshop codes and 10 Kiro codes free**, fake values (`PREVW…`,
  `PREVIEW-KIRO-…`). Part 2's check-ins use them up on purpose.
- Nothing generated, nothing published, no announcements, no scores.
- `aala@scu.edu` is the organizer.
- **Judges you can be:** Test Judge 1 = `abhinav.t.ala+judge1@gmail.com`
  (seated at Station 1 with an AWS judge), Test Judge 2 =
  `abhinav.t.ala+judge2@gmail.com` (Station 2, with an A10 judge). Generate's
  automatic pairing reseats everyone, so after publishing they are wherever
  the published version puts them.
- **Email:** Preview emails only `abhinav.t.ala@gmail.com`, `abhatti@scu.edu`,
  `aala@scu.edu` and their `+anything` aliases. Use
  `abhinav.t.ala+something@gmail.com` for every address you type, and watch
  **abhinav.t.ala@gmail.com**. Anything else is refused and recorded (that's
  how 2.8 makes a "not sent").
- **The rehearsal link** is given to you with this script. Use only that
  link today, never the production address.

Have: a laptop, your phone, the Gmail inbox open on the laptop, and a
private/incognito window for "anonymous" checks.

---

## Part 1: setup check (10 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 1.1 | Laptop: rehearsal link `/login`, `aala@scu.edu`, open the email, tap Sign in | You land on `/me` with one big **Organizer screens** button. Tap it: the overview (01) | No email: wrong link, or the sender. Tell me | |
| 1.2 | Close the tab. Open the rehearsal link again, **just the address** | Straight to `/me`, not the homepage or sign-in | Homepage: the build doesn't have #18 | |
| 1.3 | Overview | Judging start Sun 10:00 AM; Teams checked in 55; **AWS codes: 3 workshop, 10 Kiro free**; a red alarm "Only 3 workshop codes left." | | |
| 1.4 | **Event**, **Tracks**, **Stations**, **Judges** (02–05) | As in Part 0; the pre-flight says every track can be covered | A ⚠️ (06) tells you how many sponsor judges to add | |
| 1.5 | **AWS codes** | The pool table (58 workshop / 55 handed out; Kiro 10 free); "Teams missing codes (0)"; the workshop table shows AWS team name and account ID | | |

---

## Part 2: Saturday morning, check-in and codes (45 min)

Codes left as you go: workshop 3, Kiro 10.

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 2.1 | **Event**: "Check-in opens" a minute ago, save | `/checkin` shows the form (12) | Times are Pacific | |
| 2.2 | **Phone**, `/checkin`, **team of six**: captain `+cap1`, teammates `+m1` … `+m5`, a track | The form says "Teams are capped at 6 people (you plus 5) by AWS Workshop Studio". Within ~2 s: "You're checked in", the join code, the five addresses listed (13) | | |
| 2.3 | **A seventh person.** The form has no seventh row. Sign in as `+cap1` (from the receipt) → **Your team** → "Add a teammate, fix an address…" | The teammates page says "Your team has 6, the most allowed. Teams are capped at 6 … by AWS Workshop Studio…", with no add form | An add form: stop, tell me | |
| 2.4 | Gmail: the receipt and five invitations, from "SCU ACM" | All in the **Inbox** tab within a minute | Promotions or Spam: stop and tell me | |
| 2.5 | **Phone, Gmail app**: open the `+m1` invitation, tap Sign in | Lands on `/me`, button **Your team**. Tap it: `/team` | | |
| 2.6 | `/team` as `+m1` | **Judging**: not published yet, starts Sun 10:00 AM. **AWS workshop access**: the bold "Join with your SCU email…", a black **Join your team's workshop** button, "or enter code PREVW0__ at catalog.us-east-1.prod.workshops.aws/join". **Your Kiro credits**: a `PREVIEW-KIRO-…` code, "Redeem your 1,000 credits", "Expires December 31, 2026". No AWS team name, no account ID | Any code missing: the pool ran out early, check 1.5 | |
| 2.7 | Laptop, private window: sign in as `+m2`, open `/team` | **Same** workshop code as `+m1`, a **different** Kiro code, and not `+m1`'s anywhere | Same Kiro code: stop, tell me | |
| 2.8 | Private window, signed out: `/t/<team 1's code>` | The schedule page, **no** workshop or Kiro code anywhere, and a line pointing to "Your team page" | A code here: stop, tell me | |
| 2.9 | **Team 2** on the phone, three people: captain `+cap2`, `+m6`, and a typo **`abhinav.t.ala+m7@gmial.com`** | Success screen lists `…@gmial.com` | | |
| 2.10 | Overview | "Check-in emails": team 2 **not sent** (the typo is refused on Preview; Gmail would bounce it Saturday). AWS codes: **1 workshop, 1 Kiro free** | | |
| 2.11 | Sign in as `+cap2`, **Your team** → teammates: correct `gmial` → `gmail` | "Changed … Invitation emailed"; it arrives; the overview's "not sent" clears | | |
| 2.12 | **Late teammate**: as `+cap2`, add `abhinav.t.ala+m8@gmail.com` | "Added … Invitation emailed". Sign in as `+m8` (phone or private window): `/team` shows team 2's workshop code and **its own** Kiro code. Kiro free: **0** | No Kiro code: tell me | |
| 2.13 | **Empty pool, Kiro.** Team 3: captain `+cap3`, teammate `+m9` | Check-in **succeeds** as normal. Overview: red "Kiro codes are all claimed…"; **Teams missing AWS codes** lists team 3, "Kiro for …+cap3…, …+m9…", why "pool used up". Workshop free: 0 | Check-in fails: stop, tell me | |
| 2.14 | **Empty pool, workshop.** Team 4: captain `+cap4` alone | Succeeds. The missing table lists team 4 with "workshop code (whole team)". `+cap4`'s `/team` says the workshop code "isn't ready yet" | | |
| 2.15 | **Top up the pool.** AWS codes → paste the **Kiro top-up** CSV (below) → **Preview** | Kiro file recognised; "5 new"; the column table; warnings: "bonusAmount isn't 1000 on line 4" and "1 code is already expired" | Wrong column mapping visible here: the point of the preview | |
| 2.16 | **Import** (here, despite the warnings; on Saturday you'd ask AWS first) | "Imported: 5 new, 0 updated. 3 codes just went to teams and people who were waiting." Reload: team 3 is off the missing list; team 4 is still listed for its workshop code. Note: codes go out in file order, so the 500-credit one went to a person; that's why the warning matters | | |
| 2.17 | Paste the **workshop top-up** CSV → Preview → Import. Then paste it **again** → Preview | First: "2 new", and team 4 gets a workshop code (missing list empty). Second preview: "0 new, 1 updated, 1 already handed out (details update; who has them doesn't change)": a re-import updates, never duplicates | | |
| 2.18 | **Devpost by a non-captain**: as `+m1`, `/team` → Devpost, `devpost.com/software/rehearsal` → Save | "Saved. Judges will see this link." Overview "Devpost links" goes up by one | | |
| 2.19 | `/t` on the phone, team 1's code in lower case with a space | Lands on the team page (15) | | |
| 2.20 | **Unknown join code**: `/t/ZZZZ-9999` | "We don't recognise the code ZZZZ-9999." with a way back | | |
| 2.21 | **Expired link**: in Gmail on the laptop, copy the `+m1` invitation's Sign in link (already used in 2.5) and open it in a **private window** | `/login`: "That sign-in link has expired or was already used.", with a resend. (On the phone where `+m1` is still signed in, the same tap just lands on `/me`: right, they're signed in) | Signed in from the private window: tell me | |
| 2.22 | **Check-in closed**: Event, "Check-in closes" now, save; reload `/checkin` | Amber: "Check-in closed at … You can still check in, but … find an organizer". The form still works | | |

**Kiro top-up** (paste as is):

```
bonusCode,bonusName,bonusAmount,validFrom,validUntil,expirationDate,redemptionUrl
TOPUP-KIRO-01,Rehearsal,1000,2026-11-01,2026-12-31,2026-12-31,https://example.com/kiro-redeem/TOPUP-KIRO-01
TOPUP-KIRO-02,Rehearsal,1000,2026-11-01,2026-12-31,2026-12-31,https://example.com/kiro-redeem/TOPUP-KIRO-02
TOPUP-KIRO-03,Rehearsal,500,2026-11-01,2026-12-31,2026-12-31,https://example.com/kiro-redeem/TOPUP-KIRO-03
TOPUP-KIRO-04,Rehearsal,1000,2026-10-01,2026-10-31,2026-10-31,https://example.com/kiro-redeem/TOPUP-KIRO-04
TOPUP-KIRO-05,Rehearsal,1000,2026-11-01,2026-12-31,2026-12-31,https://example.com/kiro-redeem/TOPUP-KIRO-05
```

**Workshop top-up:**

```
Team name,Team code,Participant count,Participant IDs,State,Deployment duration,AWS account ID,Join event URL,Last joined,Last account login,Last updated
rehearsal-1,TOPW01,0,,Ready,2h,999900000001,https://catalog.us-east-1.prod.workshops.aws/join?access-code=TOPW01,,,2026-11-06
rehearsal-2,TOPW02,0,,Ready,2h,999900000002,https://catalog.us-east-1.prod.workshops.aws/join?access-code=TOPW02,,,2026-11-06
```

(Saturday's real imports are the same steps with AWS's files: read the
preview's column table and warnings before pressing Import.)

---

## Part 3: Saturday afternoon (5 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 3.1 | **Import teams** (21): only if you'll use the Google Form as a backup | The preview (22) reads every question; nothing is written until Import | Track names must match exactly | |

---

## Part 4: Sunday morning, the schedule (time this whole part)

Start a stopwatch at 4.1.

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 4.1 | **Generate** (23): leave the start time, slot length, **suggested slot count** and "form automatically" | Pre-flight covers every track; every checked-in team ticked | | |
| 4.2 | Generate | A draft review page (24) within seconds | | |
| 4.3 | Read every ⚠️ | Each says what it means | "N teams not covered": a sponsor is short | |
| 4.4 | Tick each, **Publish** | "Published vN…" (25). Until every box is ticked, the button is disabled and says how many are left | | |
| 4.5 | **Announcements**: Info, exactly: **"The judging schedule is live. Your times and station are on your team page."** | Phone, team page: the banner within 25 s (43), then times and station (30) | | |
| 4.6 | Phone: `/team` as `+m1` | **Judging** lists both presentations: day, time, station, location | | |
| 4.7 | **Printable schedule**, Print to PDF | Page 1 every team A–Z (27); page 2 the grid (28) | | |
| 4.8 | `/board/<event>` full screen | "First up", each station's team and location (29) | | |
| 4.9 | **Judge sign-in, as the judges will do it.** Phone: open the rehearsal link (root), tap **"Already have an account? Sign in"**, enter `abhinav.t.ala+judge1@gmail.com`, open "Sign in to the AWS x A10 Hack" in the Gmail app, tap **Sign in** | `/me` with one big **Your judging station** button. Tap it: their station, its teams in time order, the next one marked (34) | No button: the address isn't on Judges exactly | |
| 4.10 | Same for Judge 2 on the laptop (private window) | Their own station only | | |

**Stop the stopwatch.** Write down the total.

---

## Part 5: Sunday, scoring and deliberation (25 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 5.1 | Judge 1 (phone): tap a team on the station page | The score page: four criteria (Impact, Technical execution, Innovation, Presentation), big 1–5 buttons, Notes, and either "Their Devpost page" or "Devpost: no link provided." | | |
| 5.2 | Tap a value for each criterion | The sticky line goes "Saving…" then "✓ Saved.", and after the fourth "✓ Saved. All criteria scored." Back on the station page: "✓ scored" | | |
| 5.3 | **Offline.** Next team: score two criteria, then **airplane mode**. Change a value and type a note | "Not saved yet: kept on this phone, retrying." | | |
| 5.4 | Airplane mode **off**, wait | Within ~5 s: "✓ Saved." Reload: the change and the note are there | Lost: stop, tell me | |
| 5.5 | Judge 2 (laptop): score one team on **two** criteria only | Station page: "partly scored" | | |
| 5.6 | Organizer: **Scoring** | "N of M scores in"; **Teams missing scores** with who they're waiting on; **Judges with teams left**, the most missing first | | |
| 5.7 | **Deliberation** | Teams by mean, with how many scores each mean rests on; the Normalised column beside it (not the sort); notes inline; the Devpost link or "no Devpost link"; a track filter; "Ties are decided by deliberation" | | |
| 5.8 | **Download every score (CSV)**, open it | Columns: Team, Judge, Criterion, Value, Judge's total, Complete, Notes; one row per criterion | | |
| 5.9 | **Lock scoring** | Judge 1 reloads: "Scoring is closed. This is what was recorded."; buttons disabled. Then **Unlock** (amber note) and confirm a judge can change a value again | | |

---

## Part 6: when things change (20 min)

| # | Do | Check | If not | Time |
|---|---|---|---|---|
| 6.1 | Event: check-in opens a minute ago. Phone: check in a late team. Set it back | Its page says it isn't in the schedule, find an organizer (36) | | |
| 6.2 | Published version → **Late changes** (37): add the late team | "0 moved, 1 added" (38) | Anything moved: stop | |
| 6.3 | From the published version again: drop a different team | A second draft | | |
| 6.4 | Publish 6.2, open 6.3 | Out of date, can't be published (39, 40) | | |
| 6.5 | From the live version: drop again, publish | Dropped team's page: not scheduled; Generate lists it unticked as withdrawn | | |
| 6.6 | **Stations**: remove an AWS judge, save | Amber "N teams here chose AWS and no AWS judge sits here now". Put them back | | |
| 6.7 | Announcements: a warning, then **Clear** | Board and team page within ~25 s (42) | | |
| 6.8 | Phone, a team page open, airplane mode for a minute | "Last updated 1 minute ago. We can't reach the server…" (44) | | |

---

## Easy to get wrong, and order that matters

- **Rehearsal link today, production address Saturday.** A test email's link
  goes back to where it was sent from.
- **Check-in window is Pacific** and doesn't open itself early.
- **Codes are never reassigned.** A deleted team's codes stay used. Import
  real codes on production **after** test teams are gone (they are).
- **Workshop: the team's own Join event URL only**, never the event-wide
  one-click link (it puts people on random teams). The import warns if a URL
  doesn't contain its team's code.
- **Publish in order**; **announce after publishing**; **never brief judges
  on a station before publishing**, and never regenerate after.
- **Lock scoring before deliberating**, unlock only to correct.
- **Database changes go in before code** (for whoever deploys).

---

## When a step fails: fix now, or note, or ignore

- **Tell me straight away:** anything in Parts 2, 4 or 5 that a team or judge
  would hit: a check-in that fails, a code shown to the wrong person or on
  `/t`, a lost score, an email outside the Inbox, a published schedule moving
  someone it shouldn't.
- **Note:** confusing wording, a slow step, anything in Part 6 that worked
  but was unclear. After tonight, nothing changes unless it's broken.
- **Ignore:** Preview-only effects (long `…vercel.app` addresses, refused
  emails to real addresses, fake codes that don't work at AWS).

Afterwards: send me your notes and the Part 4 total.
