import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import { isSessionCookie, readClaims } from "@/lib/supabase/claims";
import { rolesRequiredFor } from "@/lib/route-guards";

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

// Not a route. Rewriting a role mismatch here makes Next render its genuine
// not-found response, status 404 included, indistinguishable from any other
// missing path.
const NOT_FOUND_PATH = "/_not-found-role-gate";

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
    // claim, so a roster change applies on the next request. A failed read
    // throws: fail closed.
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", auth.claims.sub)
      .maybeSingle();
    if (error) throw error;
    if (!data || !required.includes(data.role)) {
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
