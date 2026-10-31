import { fieldsFromFormData } from "@/lib/checkin/form";
import { loadCheckInEvent, submitCheckIn } from "@/lib/checkin/submit";
import { helpPlace } from "@/lib/event/copy";
import { allow, clientIp, LIMITS } from "@/lib/rate-limit";

// The public check-in form posts here. A route handler, not a server action,
// so both paths keep working: with JavaScript the page asks for JSON and an
// error keeps everything typed; without it, the browser gets a 303 to the
// team page or back to the form with the message. No session is involved:
// the write is check_in_team() as the service role (lib/checkin/submit.ts).
export async function POST(req: Request) {
  const wantsJson = (req.headers.get("accept") ?? "").includes(
    "application/json",
  );
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply(wantsJson, {
      ok: false,
      errors: { form: "That wasn't a form submission." },
    });
  }
  // Only stops a flood: see lib/rate-limit.ts for why the limits are loose.
  if (
    !(await allow(
      `checkin:${clientIp(req.headers)}`,
      LIMITS.checkinPerMinute,
      LIMITS.checkinPerHour,
    ))
  ) {
    const event = await loadCheckInEvent().catch(() => null);
    return reply(
      wantsJson,
      {
        ok: false,
        errors: {
          form: `Too many check-ins from this network just now, so nothing was saved. Wait a minute and try again, or find an organizer at ${helpPlace(event?.helpLocation)}.`,
        },
      },
      429,
    );
  }
  const result = await submitCheckIn(fieldsFromFormData(form), Date.now());
  return reply(wantsJson, result);
}

function reply(
  wantsJson: boolean,
  result: Awaited<ReturnType<typeof submitCheckIn>>,
  errorStatus = 422,
): Response {
  const to = result.ok
    ? `/t/${result.joinCode}?${new URLSearchParams({
        welcome: "1",
        receipt: result.receiptSent ? "sent" : "failed",
        invited: String(result.invited),
        inviteFailures: String(result.inviteFailures),
      })}`
    : `/checkin?${new URLSearchParams({
        error: result.errors.form ?? Object.values(result.errors)[0],
      })}`;
  if (wantsJson)
    return Response.json(result.ok ? { ok: true, redirect: to } : result, {
      status: result.ok ? 200 : errorStatus,
      headers: { "cache-control": "no-store" },
    });
  return new Response(null, { status: 303, headers: { Location: to } });
}
