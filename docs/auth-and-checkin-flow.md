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

**The check-in form posts to a server action that writes with the service-role
key.** Do **not** loosen RLS to allow anonymous inserts on `teams` or
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
| **Captain's email bounces** | That's why the captain gets a receipt, not just a link. Organizer dashboard flags it **before credentials are sent**. |
| **Teammate email typo'd** | Invite never arrives. Captain can correct it and re-send from the team page. |
| **Person already has an account** | `generateLink` handles it — signs them in rather than duplicating. |
| **Apps Script throttled or broken** | Keep an SMTP provider configured on the hosted project as a fallback route, so recovery isn't a code change at 9:30am. |
| **Nobody's email works** | Join code, shown on screen at check-in and reprintable by organizers. |
| **Session lapsed before the schedule send** | Most people still hold a live session from check-in (refresh token persists), so later emails are notifications, not fresh logins. |

---

## Open

**Can teammates edit team details, or is editing captain-only?** Defaulting to
**captain-only, members read-only**, with organizers able to edit anything.
Reversible — it's one condition in `teams_update`.
