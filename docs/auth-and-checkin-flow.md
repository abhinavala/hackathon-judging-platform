# Auth and check-in flow (finalized)

This supersedes the auth sketch in `docs/phase-1-spec.md`. It covers how people
get signed in, how check-in works, and the edge cases that have to be handled
for it to survive a live event.

---

## The core mechanism

`supabase.auth.admin.generateLink()` mints a real magic link **without sending
anything** — the docs are explicit: *"This will not send links or OTPs to the
end user."* It requires the service-role key, so it is server-only.

That means we control delivery. We send through **Google Apps Script** from the
`scu.edu` Workspace account rather than through Supabase's email service.

**Why Apps Script rather than Resend/SES:**

- Workspace quota is **2,000 recipients/day within your own domain**, 1,500
  outside. We need ~250.
- No SMTP provider, no DNS records, no domain warmup, no monthly cost.
- Supabase's email rate limits stop applying — we never use its sender.
- `scu.edu` → `scu.edu` deliverability is about as good as email gets.
- ACM already runs this exact pipeline for AWS credentials. Proven, not new.

**The limits we're routing around** (for the record, so nobody re-litigates
this): Supabase's built-in sender is **2/hour project-wide** and a plan upgrade
does not raise it. Custom SMTP only raises the default to **30/hour**, and
`rate_limit_email_sent` then has to be raised separately — the step most people
miss. Provider free tiers are all too small for a 250-email burst, and a
brand-new sending domain bursting 250 messages is a textbook spam signal.

---

## Check-in: a public form

The captain opens the site and fills **one form**, signed in to nothing:

> team name · their email · teammates' emails · GitHub · Devpost · tracks ·
> eligibility flags

On submit:

1. The team, members, and track rows are created
2. The **join code is shown on screen immediately**
3. A link is minted per email and handed to Apps Script
4. The captain gets a **receipt + sign-in link**; teammates get
   *"Abhinav invited you to join Team X"*

### Why the form comes before the auth

**Do the durable work before the fragile step.**

Auth-first means that if the captain's email never arrives, *nothing happened* —
no team, no Devpost link, no tracks, no member emails, and the team can't be
scheduled. Form-first means the team is fully checked in the moment the form
submits, and an email failure costs one person a session rather than costing you
a team.

It also collapses two steps into one and makes teammate invites a side effect
rather than a separate action.

### What we deliberately do NOT do

**We do not auto-sign-in the captain** by redirecting their browser to the link
the server just minted, even though it would remove the last wait.

Anyone could type anyone else's email and be signed in as them. With AWS
credentials behind the session, that's disqualifying. **The click on the emailed
link is the proof they control the address.**

The join code on screen is what keeps them unblocked in the meantime.

---

### As built (Phase 2)

- `/checkin` is public. The form posts to `/checkin/submit`, a route handler
  rather than a server action, so it works both ways: with JavaScript an
  error keeps everything typed and is shown by field; without it the
  browser gets a 303 to the team page or back to the form with the message.
- The write is `check_in_team(payload)` (migration 0008), granted to the
  service role only: team, members and tracks in one transaction. It takes
  a per-event advisory lock first, because `enforce_one_team_per_event`
  can't see another transaction's uncommitted rows, so two teammates
  submitting at the same moment would otherwise both get through. It then
  names every address already on a team, surfaced as "someone on your team
  has already checked in". A team name already checked in (any case) is
  refused by field.
- Success redirects to `/t/<join code>` with the code shown large, plus what
  was emailed. No member addresses are ever shown there.
- Then a link is minted per person (creating their accounts, which links
  `team_members.user_id`) and sent as one batch: the captain gets the
  relay's `checkin` receipt, teammates get `invite` ("Riley added you to
  Night Owls"). A send failure is reported on the page; the check-in
  stands.
- Up to **6 people per team** (`MAX_TEAM_SIZE`: captain + 5). **Any email
  domain**: it's a multi-school event (sjsu.edu, berkeley.edu, stanford.edu,
  ucmerced.edu, gmail.com, icloud.com all appeared at H4H), so a domain
  restriction would lock real attendees out. Before `checkin_opens_at` the
  form isn't shown; after `checkin_closes_at` it still accepts check-ins and
  tells the team to find an organizer, since the schedule may be set.
- **Abuse is handled by rate limits** (`lib/rate-limit.ts`, migration 0009),
  counted in Postgres so they hold across serverless instances, keyed by an
  HMAC of the IP or address. Per IP: 90 check-in submissions a minute, 400
  an hour. These are deliberately loose: at the venue every captain may be
  behind one Wi-Fi IP, so they sit above a whole room's traffic and only
  stop a flood. Plus a hidden field for bots. The client IP comes from
  Vercel's `x-vercel-forwarded-for` / `x-real-ip`, which the client can't
  set. If the limiter's database call fails, it fails open.
- **Teammates page** (`/team/members`, session required, captain only;
  teammates see it read-only): correct a mistyped teammate address, resend
  an invitation, or add someone forgotten, up to 6. Only for members who
  have never signed in. Correcting an address deletes the account check-in
  created for the typo (if never used), so its live link stops working.
  Invitations are limited to 12 an hour per team and 3 an hour per address:
  check-in itself can only reach an address once per event, so resends are
  the one way to mail someone repeatedly.
- Linking is done by the database, for every insert path (check-in, the
  CSV importer, the teammates page): `handle_new_user()` links roster rows
  when an account is created, and `link_member_to_existing_user()` (0003, a
  BEFORE INSERT / UPDATE OF email trigger) links a row to an account that
  already exists. Correcting an address on the teammates page sets
  `user_id` to null with the new email, so the same trigger relinks it.
- Not built, by decision: an organizer flag for a bounced captain email.
  Apps Script can't see bounces, and the captain is standing at the
  check-in desk; if no receipt arrives, they'll say so.

## Two sensitivity tiers

| Data | Access |
|---|---|
| Schedule, station, countdown, announcements | Join code **or** session |
| AWS credentials | Authenticated session **only** |

A join code is not acceptable for credentials — codes get screenshotted, pasted
into Discord, read over shoulders. This needs no new mechanism: the join-code
path is already a separate `SECURITY DEFINER` RPC, and it simply never returns
credential fields.

Credentials behind a session is also strictly better than emailing them, which
is what happens today: you get who viewed them and when, per-team rotation, and
nothing living in an inbox forever.

---

## Implementation rules

**The check-in form posts to a route handler (`/checkin/submit`) that writes
with the service-role key.** It was going to be a server action; a route handler
is what keeps it working without JavaScript (a hard requirement since the
`/login` no-JS retraction), and server actions failed us twice on that and on
returning state. Do **not** loosen RLS to allow anonymous inserts on `teams` or
`team_members` — that opens a write path you'd have to defend forever. The
server validates, writes as service role, then mints links. The service role is
already server-only and already needed by the scheduler, so this adds no new
exposure.

**Member linking needs no schema or policy change.** The order works out:

1. Form submit inserts `team_members` with `user_id = null` (nobody has an
   account yet)
2. `generateLink()` creates the `auth.users` row
3. `handle_new_user()` fires and backfills `team_members.user_id` by
   `lower(email)`
4. They click → session → `my_team_ids()` resolves → RLS lets them see their
   team

`teams.created_by` stays null initially. That's fine: `teams_update` keys off
`my_team_ids()`, which reads `team_members.user_id`, so edit rights resolve as
soon as the captain clicks.

**`token_hash` is now load-bearing, not a convenience.** `generateLink()`
produces `token_hash` links that must be consumed with `verifyOtp`, and it has a
known incompatibility with the PKCE code-exchange flow
(`supabase/auth-js#767`). The entire delivery path depends on that branch —
do not simplify it away.

**Apps Script deployment:** a Web App with `doPost`, protected by a shared
secret **in the JSON body**. The server posts `{email, link, template,
secret}`; the script compares `secret` and replies `{"ok": true}` once the mail
is sent (anything else is treated as a failed send). The secret cannot go in a
header: `doPost(e)` receives the body and query string but not the request
headers, so a header secret could never be checked. Implemented in
`lib/auth/senders.ts`.
Execution caps at 6 minutes (30 on Workspace); 250 sends run ~50–125s so it
fits, but chunk in batches of ~50 with progress recorded so a timeout is
resumable rather than ambiguous.

---

## Edge cases that must be handled

| Case | Handling |
|---|---|
| **Link expired** (1h default, 24h max via Management API) | Callback detects `otp_expired` and offers one-click resend. Raise expiry to a few hours during the event. |
| **Link already used** | Links are single-use, and expired, used and superseded links all fail the same way (`otp_expired`). Same resend path. Requesting a new link invalidates the old one for an address that already has an account. For an address that has **never signed in**, the original signup link and a later link can both be live until one of them is used; using either invalidates the other. (Harmless, since both went to the same inbox, and it means a check-in link keeps working after a resend.) |
| **Two teammates both check in** | `enforce_one_team_per_event` already blocks it at the database. Surface it as *"someone on your team has already checked in"*, never a raw constraint violation. |
| **Captain's email bounces** | That's why the captain gets a receipt, not just a link. No automated flag (Apps Script can't see bounces): the captain is at the desk and will say if nothing arrived. |
| **Teammate email typo'd** | Invite never arrives. The captain corrects it and re-sends from `/team/members`. |
| **Person already has an account** | `generateLink` signs them in rather than duplicating; the 0003 trigger links their roster row on insert. |
| **Apps Script throttled or broken** | Keep an SMTP provider configured on the hosted project as a fallback route, so recovery isn't a code change at 9:30am. |
| **Nobody's email works** | Join code, shown on screen at check-in and reprintable by organizers. |
| **Session lapsed before the schedule send** | Most people still hold a live session from check-in (refresh token persists), so later emails are notifications, not fresh logins. |

---

## Open

**Can teammates edit team details, or is editing captain-only?** Defaulting to
**captain-only, members read-only**, with organizers able to edit anything.
Reversible — it's one condition in `teams_update`.
