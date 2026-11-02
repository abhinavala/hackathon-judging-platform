# Every screen, in the order you meet them

Captured 2 Nov 2026 against Preview (the seeded fixture: 60 synthetic teams,
16 synthetic judges, 8 stations) on a production build of `main` at `b9c119f`,
except `00`, which is PR #6's build. Organizer and judge screens are laptop
size (1280 wide), participant screens phone size (390 wide), the board
1920×1080. Full pages, not just the first screen.

Names are the seed's (synthetic). Three teams were added during the capture:
Lantern Lab and Kite Theory by the tour, and one called "test" by someone
trying the form on Preview at the same time (it shows up in 39). The long
`…-abhinavtala-7547s-projects.vercel.app` addresses are Preview's; on
production pages they read `hackathon-judging-platform.vercel.app`, and later
`judging.scuacm.com`.

The live screens (29–35) are from a schedule published to start a few
minutes after capture, with 5-minute slots, so the times read "1:34 PM" rather
than Sunday's.

## The front door

| # | Screen | What it's for | On event day |
|---|---|---|---|
| 00 | [Home page](00-home-page.png) | The URL a lost person types: the join-code box first, then check-in, the board, and where to find a person | Point anyone without a link here; the code box is the fastest way to their times |

## Before the event: setting up (organizer)

| # | Screen | What it's for | On event day |
|---|---|---|---|
| 01 | [Organizer overview](01-organizer-dashboard.png) | One table: judging start, help location, teams checked in, check-in emails, judges, stations, the published version, drafts waiting | Your home screen. Glance at "Check-in emails" during check-in |
| 02 | [Event settings](02-event-settings.png) | Judging start, **check-in opens and closes**, help location, and a preview of what participants will read | If check-in needs to open early or stay open late, it's here, not SQL |
| 03 | [Tracks](03-tracks.png) | Prize tracks, their sponsor, whether judged live, how many teams chose each | Deleting a track teams chose asks first |
| 04 | [Stations](04-stations.png) | Each station's name, **location text**, order, and its two judges (the live pairings) | Swapping a judge for a no-show. **Swap like for like** (AWS for AWS): nothing warns if a sponsor's judge leaves a station |
| 05 | [Judges](05-judges.png) | The roster with affiliations, plus the pre-flight capacity check at the top | Adding a walk-in judge; then seat them on Stations |
| 06 | [Judges: pre-flight warning](06-judges-preflight-warning.png) | What it looks like when a sponsor is short: "6 teams cannot be covered. Add 1 AWS judge." (two AWS judges briefly marked unaffiliated) | If you see this after a no-show, it says how many judges to add |
| 07 | [Generate: pre-flight warning](07-generate-preflight-warning.png) | The same shortfall as Generate shows it, above the timing fields | You can still generate; coverage is a soft constraint |

## Saturday: check-in (participants, then you)

| # | Screen | What it's for | On event day |
|---|---|---|---|
| 08 | [Board, nothing published](08-board-not-published.png) | The projector before a schedule exists: when judging starts, and where to look | Fine to leave up from Saturday |
| 09 | [Judge, nothing published](09-judge-not-published.png) | A judge who signs in early | They'll see "isn't published yet" and the start time |
| 10 | [Judge, not seated](10-judge-not-seated.png) | A judge on the roster with no station | Seat them on Stations (04) |
| 11 | [Check-in not open yet](11-checkin-not-open-yet.png) | The form before its opening time: only when it opens | If people are queuing early, move "Check-in opens" on Event settings |
| 12 | [Check-in form](12-checkin-form.png) | One captain per team: names, emails, links, tracks, eligibility | Works without JavaScript; an error keeps what was typed |
| 13 | [Checked in: the join code](13-checkin-success-join-code.png) | The code, huge, "Screenshot this", and the two URLs where it works | **The fallback starts here.** Tell captains to screenshot it |
| 14 | [Team page before publishing](14-team-page-before-publish.png) | What a team sees until the schedule is live | "Check back closer to then", and it updates by itself |
| 15 | [Join-code entry](15-join-code-entry.png) | For someone with the code but not the link | Accepts any spacing or case ("tjfm 2019" works) |
| 16 | [Unknown join code](16-unknown-join-code.png) | A mistyped code | Check the help-desk printout of join codes |
| 17 | [Sign in](17-sign-in.png) | Email in, link out | Most people won't need it: they're signed in from check-in |
| 18 | [Sign-in link sent](18-sign-in-link-sent.png) | The confirmation, rendered without JavaScript too | "Asking again replaces the first email": tell people to wait a minute |
| 19 | [Teammates page (captain)](19-teammates-page-captain.png) | Fix a typo'd address, resend an invitation, add someone | Your answer to "my teammate never got the email" |
| 20 | [Overview during check-in](20-organizer-dashboard-during-checkin.png) | Teams checked in, and how many teams' emails all went out | If a "not sent" section appears, it lists each team with its join code |
| 21 | [Import, empty](21-import-empty.png) | Only if the Google Form fallback is used | Upload the form's CSV |
| 22 | [Import, read](22-import-preview-needs-team-names.png) | How every question was read, every warning, and teams that need a name typed in | Nothing is written until you press Import. Imported teams get **no email and no join code screen**: hand them codes |

## Sunday morning: the schedule (you)

| # | Screen | What it's for | On event day |
|---|---|---|---|
| 23 | [Generate](23-generate.png) | Start time, slot length, slot count (defaults to two spare slots), pairings, and which teams to include | Leave the suggested slot count. Withdrawn teams show unticked |
| 24 | [Draft review](24-draft-review-and-warnings.png) | Every warning with its own "publish anyway" tick, then coverage, spacing, overlap, capacity, changes, and the full grid | Read the warnings; each one says what it means |
| 25 | [Published](25-published-confirmation.png) | The confirmation, and the published version's page with Late changes at the top | From here: print, and point everyone at the board |
| 26 | [Schedules list](26-schedules-list.png) | Every version: published, archived, drafts | "Late team or dropped team" sits beside the published one |
| 27 | [Printout, page 1: teams A to Z](27-printout-page1-team-index.png) | Every team with both times and stations, station locations, where to get help | **This is the wall.** Print it the morning of, plus the join codes for the help desk |
| 28 | [Printout, page 2: the grid](28-printout-page2-grid.png) | Station × time, the same as the CSV | For organizers and judges; post it beside page 1 |

## During judging (everyone)

| # | Screen | What it's for | On event day |
|---|---|---|---|
| 29 | [Board: first up](29-board-first-up.png) | Before the first slot: who's first at each station, and "starts in N minutes" | On the projector from 9:45 |
| 30 | [Team: minutes away](30-team-countdown-minutes-away.png) | The team's next presentation, location first, with a countdown | What most people will be looking at |
| 31 | [Board: now and next](31-board-now-and-next.png) | The current slot large, every station's team and location, and the next slot below | Advances by itself; nobody touches it |
| 32 | [Team: head there now](32-team-countdown-head-there-now.png) | A few minutes out, the page says go | |
| 33 | [Team page, signed in](33-team-page-signed-in.png) | The same view at `/team`, for someone who signed in | |
| 34 | [Judge: station view](34-judge-station-now-next.png) | The judge's station, their teams in order, **NOW** and **NEXT** marked | Tell judges to open `/judge` on their phone |
| 35 | [Team: on now](35-team-on-now.png) | During their slot: "You're on now" and how long is left | |

## When something changes (you)

| # | Screen | What it's for | On event day |
|---|---|---|---|
| 36 | [Team not in the schedule](36-team-not-in-schedule.png) | A team that checked in after publishing (or was dropped) | It tells them to find you; then 37 |
| 37 | [Late changes](37-late-changes-on-published-schedule.png) | Add a late team or drop one, on the published version | Each change drafts the next version with only that change |
| 38 | [Late team draft](38-late-team-draft-review.png) | "Adds Kite Theory at…; everyone else keeps their seats and times" | Check "0 moved", then publish |
| 39 | [Stale draft: out of date](39-stale-draft-out-of-date.png) | A drop drafted from v3 after v4 went live: refused, and says why | Make the change again from the published version. (Its publish form still shows below, disabled: ignore it) |
| 40 | [Schedules list: out of date](40-schedules-list-out-of-date.png) | The same draft in the list: "draft, out of date (made from v3; v4 is published)" | |
| 41 | [Announcements](41-announcements.png) | Post a banner (info, warning, critical) and clear it | Reaches the board and every team page within 25 seconds |
| 42 | [Board with an announcement](42-board-with-announcement.png) | The banner across the top | |
| 43 | [Team page with an announcement](43-team-page-with-announcement.png) | The banner on a phone | |
| 44 | [Team page offline](44-team-page-offline-last-updated.png) | An already-open page after the network dropped: "Last updated N minutes ago" | Only an **open** tab keeps this; a reload with no signal gets the browser's offline page. The screenshot from check-in is the real fallback |
