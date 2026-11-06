import Link from "next/link";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { MAX_TEAM_SIZE } from "@/lib/checkin/form";
import { helpPlace } from "@/lib/event/copy";
import { loadMyTeam } from "@/lib/team/members";
import { loadTeamView } from "@/lib/team/load";
import {
  codesFromRpc,
  expiryLabel,
  WORKSHOP_JOIN_HOST,
  WORKSHOP_JOIN_URL,
} from "@/lib/team/codes";
import { clockWithZone, dayLabel, slotRange } from "@/lib/team/view";
import { saveDevpost } from "./actions";
import NotOnATeamPage from "./none/page";

export const instant = false;

const input = "w-full rounded border px-3 py-2 text-base";
const button = "rounded border px-3 py-2 font-medium hover:bg-black/5";
const section = "mb-6 rounded border p-4";
const h2 = "mb-2 text-xl font-semibold";

// The signed-in team page: everything a member needs in one place. Judging
// times, the AWS workshop code and how to join, their own Kiro code, the
// Devpost link (any member can change it), who's on the team, and the join
// code. The codes are here and NEVER on /t/CODE, which needs no sign-in and
// gets read aloud at the help desk; they come from my_access_codes(), which
// returns only this person's own Kiro code.
export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const params = await searchParams;
  const ctx = await requireSession();
  if (!ctx.teamId) return <NotOnATeamPage />;
  const db = await createClient();
  const [team, codesRes, teamRow] = await Promise.all([
    loadMyTeam(ctx.teamId, ctx.user.id),
    db.rpc("my_access_codes"),
    db.from("teams").select("devpost_url").eq("id", ctx.teamId).maybeSingle(),
  ]);
  if (!team) return <NotOnATeamPage />;
  const loaded = await loadTeamView(team.joinCode).catch(() => null);
  const view = loaded?.view.found ? loaded.view : null;
  const codes = codesFromRpc(codesRes.data);
  const devpost = teamRow.data?.devpost_url ?? null;
  const tz = view?.event.timezone ?? "America/Los_Angeles";
  const help = helpPlace(view?.event.helpLocation);
  const ok = typeof params.ok === "string" ? params.ok : null;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="mx-auto w-full max-w-lg p-5">
      <h1 className="mb-1 text-2xl font-semibold">{team.name}</h1>
      <p className="mb-5 text-sm">Signed in as {ctx.user.email}</p>

      <section className={section} aria-labelledby="judging">
        <h2 id="judging" className={h2}>
          Judging
        </h2>
        {view?.published && view.slots.length > 0 ? (
          <ul className="mb-2 space-y-2">
            {view.slots.map((s) => (
              <li key={s.index}>
                <strong>
                  {dayLabel(s.startsAt, tz)}, {slotRange(s, tz)}
                </strong>
                <br />
                {s.station}
                {s.location ? ` · ${s.location}` : ""}
              </li>
            ))}
          </ul>
        ) : view?.published ? (
          <p className="mb-2">
            Your team isn&apos;t in the judging schedule. Find an organizer at{" "}
            {help}.
          </p>
        ) : (
          <p className="mb-2">
            The judging schedule isn&apos;t published yet
            {view?.event.judgingStartsAt
              ? `. Judging starts ${dayLabel(view.event.judgingStartsAt, tz)} at ${clockWithZone(view.event.judgingStartsAt, tz)}`
              : ""}
            . Your times and station will appear here.
          </p>
        )}
        <Link href={`/t/${team.joinCode}`} className="underline">
          Live schedule and countdown
        </Link>
      </section>

      <section className={section} aria-labelledby="workshop">
        <h2 id="workshop" className={h2}>
          AWS workshop access
        </h2>
        {codes.workshop ? (
          <>
            <p className="mb-3 font-bold">
              Join with your SCU email address (@scu.edu), even if you checked
              in here with a different one. Joining with a personal email puts
              you outside your team.
            </p>
            <a
              href={codes.workshop.joinUrl ?? WORKSHOP_JOIN_URL}
              className="mb-3 block rounded-lg border-2 border-black bg-black px-4 py-3 text-center text-lg font-semibold text-white dark:border-white dark:bg-white dark:text-black"
              data-testid="workshop-join"
            >
              Join your team&apos;s workshop
            </a>
            <p className="mb-2">
              or enter code{" "}
              <strong className="font-mono text-lg" data-testid="workshop-code">
                {codes.workshop.code}
              </strong>{" "}
              at{" "}
              <a href={WORKSHOP_JOIN_URL} className="underline break-all">
                {WORKSHOP_JOIN_HOST}
              </a>
            </p>
            <p className="text-sm">
              Everyone on the team joins individually, each with this same link
              or code. Your AWS credentials are then on your own Workshop Studio
              dashboard; this site never has them.
            </p>
          </>
        ) : (
          <p data-testid="workshop-missing">
            Your team&apos;s workshop code isn&apos;t ready yet. The organizers
            can see that it&apos;s missing; check back soon, or find an
            organizer at {help}.
          </p>
        )}
      </section>

      <section className={section} aria-labelledby="kiro">
        <h2 id="kiro" className={h2}>
          Your Kiro credits
        </h2>
        <p className="mb-2 text-sm">
          Only you see this code; it&apos;s yours, not the team&apos;s.
        </p>
        {codes.kiro ? (
          <>
            {codes.kiro.redemptionUrl && (
              <a
                href={codes.kiro.redemptionUrl}
                className="mb-3 block rounded-lg border-2 px-4 py-3 text-center text-lg font-semibold"
              >
                Redeem your{" "}
                {codes.kiro.amount
                  ? `${codes.kiro.amount.toLocaleString("en-US")} `
                  : ""}
                credits
              </a>
            )}
            <p className="mb-1">
              Code{" "}
              <strong
                className="font-mono text-lg break-all"
                data-testid="kiro-code"
              >
                {codes.kiro.code}
              </strong>
              {codes.kiro.redemptionUrl
                ? " (type it if the link doesn't work)"
                : ""}
            </p>
            {expiryLabel(codes.kiro, tz) && (
              <p className="font-semibold" data-testid="kiro-expiry">
                Expires {expiryLabel(codes.kiro, tz)}. Redeem it before then.
              </p>
            )}
          </>
        ) : (
          <p data-testid="kiro-missing">
            Your Kiro code isn&apos;t ready yet. The organizers can see that
            it&apos;s missing; check back soon, or find an organizer at {help}.
          </p>
        )}
      </section>

      <section id="devpost" className={section} aria-labelledby="devpost-h">
        <h2 id="devpost-h" className={h2}>
          Devpost
        </h2>
        {(ok || error) && (
          <p
            role={error ? "alert" : "status"}
            className={`mb-3 rounded border-2 p-3 ${error ? "border-red-700" : "border-green-700"}`}
          >
            {error ?? ok}
          </p>
        )}
        <p className="mb-2">
          {devpost ? (
            <>
              Judges open:{" "}
              <a
                href={devpost}
                className="underline break-all"
                data-testid="devpost-current"
              >
                {devpost}
              </a>
            </>
          ) : (
            <strong>No Devpost link yet.</strong>
          )}{" "}
          Anyone on the team can add or change it, before judging and after.
        </p>
        <form action={saveDevpost} className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="devpostUrl">
            Your project&apos;s devpost.com link
          </label>
          <input
            id="devpostUrl"
            name="devpostUrl"
            type="url"
            inputMode="url"
            defaultValue={devpost ?? ""}
            placeholder="https://devpost.com/software/…"
            className={input}
          />
          <button className={button}>Save</button>
        </form>
      </section>

      <section className={section} aria-labelledby="members">
        <h2 id="members" className={h2}>
          Team ({team.members.length} of {MAX_TEAM_SIZE})
        </h2>
        <ul className="mb-2 space-y-1">
          {team.members.map((m) => (
            <li key={m.email}>
              {m.name ?? m.email}
              {m.isCaptain ? " · captain" : ""}
              {m.isMe ? " · you" : ""}
              {m.name && <span className="block text-sm">{m.email}</span>}
            </li>
          ))}
        </ul>
        <Link href="/team/members" className="underline">
          {team.iAmCaptain
            ? "Add a teammate, fix an address or resend an invitation"
            : "Who has signed in"}
        </Link>
        {!team.iAmCaptain && (
          <p className="mt-1 text-sm">
            Only your captain changes who&apos;s on the team; an organizer can
            help if they&apos;re not around.
          </p>
        )}
      </section>

      <section className={section} aria-labelledby="joincode">
        <h2 id="joincode" className={h2}>
          Join code
        </h2>
        <p className="font-mono text-3xl font-bold tracking-wider">
          {team.joinCode}
        </p>
        <p className="mt-1 text-sm">
          Shows your schedule to anyone who has it (no codes or credits). Read
          it to an organizer at the help desk.
        </p>
      </section>
    </main>
  );
}
