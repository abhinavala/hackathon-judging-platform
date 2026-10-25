import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import { isSessionCookie, readClaims } from "@/lib/supabase/claims";
import { rolesRequiredFor, type Role } from "@/lib/route-guards";
import type { SupabaseClient } from "@supabase/supabase-js";

// Paths an anonymous visitor may load. Everything else requires a session,
// including paths that don't exist, so an anonymous visitor can't tell real
// routes from missing ones.
//
// This list is expected to grow. Phase 4 adds the deliberately anonymous
// surfaces: the join-code schedule lookup, the big-screen board, and
// announcements (backed by the team_schedule_by_code, public_board and
// active_announcements RPCs).
const PUBLIC_EXACT = ["/"];
const PUBLIC_PREFIXES = ["/login", "/auth/callback", "/auth/signout"];

function isPublic(pathname: string) {
  return (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

// Rewrite target for a role mismatch. Next renders its genuine not-found
// response for it (status 404 included), indistinguishable from any other
// missing path, while the browser keeps the original URL.
//
// It MUST stay a path that no route will ever claim: if something is ever
// served here, a role mismatch would render that instead of a 404. The
// leading underscore is what guarantees it: an app/ folder named
// _not-found-role-gate is a private folder, excluded from routing. Do not
// create a folder spelled %5Fnot-found-role-gate (the URL-encoded escape
// hatch for underscore routes), or a rewrite/redirect in next.config.ts that
// matches it.
const NOT_FOUND_PATH = "/_not-found-role-gate";

// What a protected page shows when access can't be checked (auth server or
// database unreachable). Fail closed, but say so in words, not with a 500
// page. Plain HTML: this is the proxy, before any app code runs.
function accessUnavailable() {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Try again in a moment</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">We can't verify your access right now</h1><p>This is usually brief. Wait a few seconds and try again.</p><p><a href="">Try again</a></p></body></html>`,
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "5",
      },
    },
  );
}

// Refreshes the auth cookie on every request, deletes it if it's corrupt,
// bounces anonymous visitors to /login, and is THE gate for role-scoped route
// groups (see lib/route-guards.ts). Data access is still enforced by RLS.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not put code between createServerClient and getClaims(): getClaims()
  // is what triggers the token refresh and the setAll() above.
  const auth = await readClaims(supabase);
  const { status } = auth;

  // A session cookie that still has a value but yields no session is one
  // auth-js couldn't parse; treat it like a rejected token.
  const stale = request.cookies
    .getAll()
    .filter((c) => c.value && isSessionCookie(c.name))
    .map((c) => c.name);
  if (status === "rejected" || (status === "none" && stale.length > 0)) {
    // Strip it from this request (so pages downstream see no session) and
    // expire it in the browser. path "/" matters: without it the deletion is
    // scoped to the current directory and misses the real cookie. Anything
    // setAll() already put on the response is carried over.
    stale.forEach((name) => request.cookies.delete(name));
    const previous = response;
    response = NextResponse.next({ request });
    previous.cookies.getAll().forEach((c) => response.cookies.set(c));
    const cacheControl = previous.headers.get("cache-control");
    if (cacheControl) response.headers.set("cache-control", cacheControl);
    stale.forEach((name) =>
      response.cookies.set(name, "", { path: "/", maxAge: 0 }),
    );
  }

  // Can't tell whether there's a session (auth server unreachable). Sending
  // the person to /login would be wrong: signing in won't work either.
  if (status === "unavailable" && !isPublic(request.nextUrl.pathname)) {
    return accessUnavailable();
  }

  if (status !== "signed-in" && !isPublic(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Carry over any cookie changes (a refreshed, cleared or deleted session).
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  // Role gate. This has to happen here rather than in the route-group
  // layouts: with Cache Components the response commits to 200 before a
  // layout's notFound() runs, turning a role mismatch into a "soft" 404.
  const required = rolesRequiredFor(request.nextUrl.pathname);
  if (required && auth.status === "signed-in") {
    // Read live from profiles through RLS (own row only), never from a JWT
    // claim, so a roster change applies on the next request. If the read
    // fails, fail closed with a "try again" page rather than a crash.
    const role = await readRole(supabase, auth.claims.sub);
    if (role === "unavailable") return accessUnavailable();
    if (!role || !required.includes(role)) {
      // A POST (server action, form, the import endpoint) can't be rewritten
      // to the not-found page: Next treats the rewritten request as a server
      // action and answers 400. Refuse it with a plain 404 instead.
      if (request.method !== "GET" && request.method !== "HEAD") {
        const refused = new NextResponse("Not found", { status: 404 });
        response.cookies.getAll().forEach((c) => refused.cookies.set(c));
        return refused;
      }
      const url = request.nextUrl.clone();
      url.pathname = NOT_FOUND_PATH;
      url.search = "";
      const notFound = NextResponse.rewrite(url);
      response.cookies.getAll().forEach((c) => notFound.cookies.set(c));
      return notFound;
    }
  }

  return response;
}

async function readRole(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Role | null | "unavailable"> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[proxy] role read failed", error);
      return "unavailable";
    }
    return data?.role ?? null;
  } catch (err) {
    console.error("[proxy] role read failed", err);
    return "unavailable";
  }
}
