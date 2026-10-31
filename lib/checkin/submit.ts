import "server-only";
import { newJoinCode } from "@/lib/admin/join-code";
import { mintSignInLink } from "@/lib/auth/magic-link";
import { getLinkSender, sendAll } from "@/lib/auth/senders";
import type { LinkMessage } from "@/lib/auth/relay";
import { helpPlace } from "@/lib/event/copy";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { serviceClient } from "@/lib/supabase/service";
import {
  parseCheckIn,
  TEAMMATE_ROWS,
  type CheckInTrack,
  type FieldErrors,
  type FormFields,
} from "@/lib/checkin/form";

export type CheckInEvent = {
  id: string;
  name: string;
  timezone: string;
  helpLocation: string | null;
  opensAt: string | null;
  closesAt: string | null;
  tracks: CheckInTrack[];
};

export type CheckInResult =
  | {
      ok: true;
      joinCode: string;
      /** false if the receipt couldn't be sent (the check-in still stands). */
      receiptSent: boolean;
      invited: number;
      inviteFailures: number;
    }
  | { ok: false; errors: FieldErrors };

/**
 * The event the form checks into (the newest, as the organizer screens pick
 * it) and its tracks. Read with the service role: anonymous visitors can't
 * read events or tracks, and the form only needs names.
 */
export async function loadCheckInEvent(): Promise<CheckInEvent | null> {
  const db = serviceClient();
  const { data: e, error } = await db
    .from("events")
    .select(
      "id, name, timezone, help_location, checkin_opens_at, checkin_closes_at",
    )
    .order("year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`events: ${error.message}`);
  if (!e) return null;
  const { data: tracks, error: tError } = await db
    .from("tracks")
    .select("id, name")
    .eq("event_id", e.id)
    .order("sort_order")
    .order("name");
  if (tError) throw new Error(`tracks: ${tError.message}`);
  return {
    id: e.id,
    name: e.name,
    timezone: e.timezone,
    helpLocation: e.help_location,
    opensAt: e.checkin_opens_at,
    closesAt: e.checkin_closes_at,
    tracks: tracks ?? [],
  };
}

/**
 * Validates the form, checks the team in (check_in_team(), one transaction,
 * service role), then mints a link per person and sends the captain's
 * receipt and the teammates' invitations. In that order on purpose: the
 * durable work happens before the fragile step, so an email failure costs
 * someone a link, never the team its check-in. The join code is the
 * fallback, and the page shows it at once.
 */
export async function submitCheckIn(
  fields: FormFields,
  now: number,
): Promise<CheckInResult> {
  const event = await loadCheckInEvent();
  if (!event)
    return {
      ok: false,
      errors: { form: "Check-in isn't open: there's no event yet." },
    };
  if (event.opensAt && now < Date.parse(event.opensAt))
    return {
      ok: false,
      errors: {
        form: `Check-in opens at ${clockWithZone(event.opensAt, event.timezone)} on ${dayLabel(event.opensAt, event.timezone)}.`,
      },
    };

  const parsed = parseCheckIn(fields, event.tracks);
  if (!parsed.ok) return parsed;
  const c = parsed.value;
  const help = helpPlace(event.helpLocation);

  const db = serviceClient();
  let joinCode = "";
  let reply: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    joinCode = newJoinCode(new Set());
    const { data, error } = await db.rpc("check_in_team", {
      p: {
        event_id: event.id,
        name: c.teamName,
        join_code: joinCode,
        contact_email: c.captain.email,
        contact_phone: c.captain.phone ?? "",
        devpost_url: c.devpostUrl ?? "",
        github_urls: c.githubUrls,
        has_grad_student: c.hasGradStudent,
        all_freshmen: c.allFreshmen,
        half_or_more_non_male: c.halfOrMoreNonMale,
        notes: c.notes ?? "",
        track_ids: c.trackIds,
        members: [
          {
            email: c.captain.email,
            full_name: c.captain.name,
            is_captain: true,
          },
          ...c.teammates.map((t) => ({
            email: t.email,
            full_name: t.name ?? "",
            is_captain: false,
          })),
        ],
      },
    });
    if (error) {
      // The trigger is the backstop for anything the up-front check missed.
      if (/already_on_a_team/.test(error.message)) {
        reply = { ok: false, error: "already_on_a_team", emails: [] };
        break;
      }
      console.error(`[checkin] check_in_team failed: ${error.message}`);
      return {
        ok: false,
        errors: {
          form: `Something went wrong saving your check-in, so nothing was saved. Try again, or find an organizer at ${help}.`,
        },
      };
    }
    reply = data as Record<string, unknown>;
    if (reply.error !== "join_code_taken") break;
  }
  if (!reply || reply.ok !== true) {
    const errors: FieldErrors = {};
    if (reply?.error === "already_on_a_team") {
      const emails = (reply.emails as string[] | undefined) ?? [];
      const listed = [c.captain.email, ...c.teammates.map((t) => t.email)];
      for (const email of emails) {
        const i = listed.indexOf(email);
        if (i === 0)
          errors.captainEmail =
            "This address is already on a team that has checked in.";
        else if (i > 0) {
          const row = Array.from(
            { length: TEAMMATE_ROWS },
            (_, k) => k + 1,
          ).find(
            (n) =>
              (fields[`teammateEmail${n}`] as string | undefined)
                ?.trim()
                .toLowerCase() === email,
          );
          if (row)
            errors[`teammateEmail${row}`] =
              "This address is already on a team that has checked in.";
        }
      }
      errors.form = `Someone on your team has already checked in${
        emails.length
          ? ` (${emails.join(", ")} ${emails.length === 1 ? "is" : "are"} already on a checked-in team)`
          : ""
      }. Look for the confirmation email, or find an organizer at ${help}. Nothing was saved.`;
    } else if (reply?.error === "name_taken") {
      errors.teamName = `A team called "${c.teamName}" has already checked in. If that's your team, someone has already checked you in; otherwise choose another name.`;
    } else {
      errors.form = `Something went wrong saving your check-in, so nothing was saved. Try again, or find an organizer at ${help}.`;
    }
    return { ok: false, errors };
  }

  // Checked in. Everything below is best effort.
  const people = [
    { email: c.captain.email, captain: true },
    ...c.teammates.map((t) => ({ email: t.email, captain: false })),
  ];
  const messages: LinkMessage[] = [];
  const mintFailed = new Set<string>();
  for (const p of people) {
    try {
      // Creates the account (and links team_members.user_id by email).
      const link = await mintSignInLink(p.email);
      messages.push({
        email: p.email,
        link,
        template: p.captain ? "checkin" : "invite",
        data: p.captain
          ? { teamName: c.teamName, joinCode, invitedCount: c.teammates.length }
          : { teamName: c.teamName, joinCode, inviterName: c.captain.name },
      });
    } catch (e) {
      mintFailed.add(p.email);
      console.error(
        `[checkin] couldn't mint a link: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  let failed = new Set(mintFailed);
  try {
    const outcome = await sendAll(getLinkSender(), messages);
    for (const f of outcome.failed) failed.add(f.email);
    if (outcome.failed.length)
      console.error(
        `[checkin] ${outcome.failed.length} email(s) not sent: ${outcome.failed[0].error}`,
      );
  } catch (e) {
    // A misconfigured sender: nothing went out.
    failed = new Set(people.map((p) => p.email));
    console.error(`[checkin] no sender: ${e instanceof Error ? e.message : e}`);
  }
  return {
    ok: true,
    joinCode,
    receiptSent: !failed.has(c.captain.email),
    invited: c.teammates.length,
    inviteFailures: c.teammates.filter((t) => failed.has(t.email)).length,
  };
}
