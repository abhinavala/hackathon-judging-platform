import { DRAFT_COOKIE, DRAFT_MAX_AGE, encodeDraft } from "@/lib/checkin/draft";
import { fieldsFromFormData, type FormFields } from "@/lib/checkin/form";
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
  const fields = fieldsFromFormData(form);
  const result = await submitCheckIn(fields, Date.now());
  return reply(wantsJson, result, 422, fields);
}

function reply(
  wantsJson: boolean,
  result: Awaited<ReturnType<typeof submitCheckIn>>,
  errorStatus = 422,
  fields?: FormFields,
): Response {
  const to = result.ok
    ? `/t/${result.joinCode}?${new URLSearchParams({
        welcome: "1",
        invited: String(result.invited),
      })}`
    : `/checkin?${new URLSearchParams({
        error: result.errors.form ?? Object.values(result.errors)[0],
      })}`;
  if (wantsJson)
    return Response.json(result.ok ? { ok: true, redirect: to } : result, {
      status: result.ok ? 200 : errorStatus,
      headers: { "cache-control": "no-store" },
    });
  // Without JavaScript the browser leaves the form: keep what was typed for
  // it to fill back in (lib/checkin/draft.ts), and forget it on success.
  const headers = new Headers({ Location: to });
  const draft = !result.ok && fields ? encodeDraft(fields) : null;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.append(
    "Set-Cookie",
    draft
      ? `${DRAFT_COOKIE}=${draft}; Path=/checkin; Max-Age=${DRAFT_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`
      : `${DRAFT_COOKIE}=; Path=/checkin; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
  );
  return new Response(null, { status: 303, headers });
}
