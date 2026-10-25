import { normalizeCode } from "@/lib/team/view";

// The code-entry form submits here (GET /t/go?code=...). A route handler, so
// the redirect is a real 307 rather than a client-side redirect from a page
// that has already started streaming.
export function GET(request: Request) {
  const url = new URL(request.url);
  const typed = url.searchParams.get("code") ?? "";
  const code = normalizeCode(typed);
  const to = code
    ? `/t/${code}`
    : `/t?${new URLSearchParams({ code: typed, error: "format" })}`;
  return new Response(null, { status: 307, headers: { Location: to } });
}
