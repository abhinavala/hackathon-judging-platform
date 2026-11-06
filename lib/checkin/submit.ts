import "server-only";
import { waitUntil } from "@vercel/functions";
import { newJoinCode } from "@/lib/admin/join-code";
import { mintSignInLink } from "@/lib/auth/magic-link";
import { getLinkSender, sendAll } from "@/lib/auth/senders";
import type { LinkMessage } from "@/lib/auth/relay";
import { finishDelivery, startDelivery } from "@/lib/checkin/delivery";
import { helpPlace } from "@/lib/event/copy";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { serviceClient } from "@/lib/supabase/service";
import {
  parseCheckIn,
  TEAM_CAP_REASON,
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
      /** How many teammates are being emailed an invitation. */
      invited: number;
      /** Their addresses: shown to the captain once, so a typo is caught. */
      invitedEmails: string[];
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
 * Validates the form and checks the team in (check_in_team(), one
 * transaction, service role), then answers. Minting a link per person and
 * sending the captain's receipt and the teammates' invitations happen after
 * the response, kept alive by waitUntil: with sixty captains at once they
 * took 5 to 12 seconds, and a captain who taps again in that time is told
 * their team "already checked in". The durable work still comes first, so an
 * email failure costs someone a link, never the team its check-in; the join
 * code is on screen at once; and what happened to the emails is recorded in
 * checkin_emails for organizers (lib/checkin/delivery.ts).
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
    } else if (reply?.error === "team_too_big") {
      errors.form = `${TEAM_CAP_REASON} Nothing was saved.`;
    } else if (reply?.error === "name_taken") {
      errors.teamName = `A team called "${c.teamName}" has already checked in. If that's your team, someone has already checked you in; otherwise choose another name.`;
    } else {
      errors.form = `Something went wrong saving your check-in, so nothing was saved. Try again, or find an organizer at ${help}.`;
    }
    return { ok: false, errors };
  }

  // Checked in. Everything below is best effort, and none of it delays
  // the answer.
  const teamId = String(reply.team_id);
  const people = [
    { email: c.captain.email, captain: true },
    ...c.teammates.map((t) => ({ email: t.email, captain: false })),
  ];
  const data = {
    teamName: c.teamName,
    joinCode,
    captainName: c.captain.name,
    invitedCount: c.teammates.length,
  };
  try {
    // Written before answering: if the background work is cut short, the
    // row stays "sending" and organizers can see it.
    await startDelivery(teamId);
  } catch (e) {
    // The record is bookkeeping: the emails still go out without it.
    console.error(
      `[checkin] couldn't record that emails are sending: ${e instanceof Error ? e.message : e}`,
    );
  }
  waitUntil(deliverCheckInEmails(teamId, people, data));
  return {
    ok: true,
    joinCode,
    invited: c.teammates.length,
    invitedEmails: c.teammates.map((t) => t.email),
  };
}

/** Mints and sends the receipt and invitations, then records the outcome. */
async function deliverCheckInEmails(
  teamId: string,
  people: { email: string; captain: boolean }[],
  d: {
    teamName: string;
    joinCode: string;
    captainName: string;
    invitedCount: number;
  },
): Promise<void> {
  const messages: LinkMessage[] = [];
  const failed = new Set<string>();
  let firstError: string | null = null;
  const note = (email: string, e: unknown) => {
    failed.add(email);
    firstError ??= e instanceof Error ? e.message : String(e);
  };
  for (const p of people) {
    try {
      // Creates the account (and links team_members.user_id by email).
      const link = await mintSignInLink(p.email);
      messages.push({
        email: p.email,
        link,
        template: p.captain ? "checkin" : "invite",
        data: p.captain
          ? {
              teamName: d.teamName,
              joinCode: d.joinCode,
              invitedCount: d.invitedCount,
            }
          : {
              teamName: d.teamName,
              joinCode: d.joinCode,
              inviterName: d.captainName,
            },
      });
    } catch (e) {
      note(p.email, e);
    }
  }
  try {
    const outcome = await sendAll(getLinkSender(), messages);
    for (const f of outcome.failed) note(f.email, f.error);
  } catch (e) {
    // A misconfigured sender: nothing went out.
    for (const p of people) note(p.email, e);
  }
  if (failed.size)
    console.error(
      `[checkin] ${failed.size} email(s) not sent for team ${teamId}: ${firstError}`,
    );
  try {
    await finishDelivery(teamId, [...failed], firstError);
  } catch (e) {
    console.error(
      `[checkin] couldn't record email status: ${e instanceof Error ? e.message : e}`,
    );
  }
}
