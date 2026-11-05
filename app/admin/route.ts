// /admin is the address people guess. It used to send a signed-out visitor
// to sign in and a signed-in one to a 404, which looked like a broken site.
// It now goes to /organizer, which does the real gating (sign-in, or a 404
// for anyone who isn't an organizer). Public in the proxy for that reason.
export function GET() {
  return new Response(null, {
    status: 307,
    headers: { Location: "/organizer" },
  });
}
