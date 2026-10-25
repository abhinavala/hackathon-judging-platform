// Smoke test: the production build starts, /login renders, the public /
// protected split holds, and a role mismatch is a real HTTP 404.
// Run after `next build` (npm run test:smoke does both). Needs local Supabase
// running (npx supabase start); it creates two smoke-test users there.
import { spawn } from "node:child_process";
import { setRole, signIn } from "./lib/session.mjs";

const PORT = 3100;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: ["ignore", "inherit", "inherit"],
  env: process.env,
});

let exitCode = 1;
try {
  const res = await waitFor(`${base}/login`, 30_000);
  const html = await res.text();
  if (res.status !== 200) throw new Error(`/login returned ${res.status}`);
  if (!html.includes("Send sign-in link"))
    throw new Error("/login did not render the form");

  // Anonymous visitors are bounced to /login from protected pages.
  const me = await fetch(`${base}/me`, { redirect: "manual" });
  if (me.status !== 307 || !me.headers.get("location")?.endsWith("/login")) {
    throw new Error(
      `/me for anon: expected 307 -> /login, got ${me.status} ${me.headers.get("location")}`,
    );
  }

  const home = await fetch(`${base}/`, { redirect: "manual" });
  if (home.status !== 200)
    throw new Error(`/ for anon: expected 200, got ${home.status}`);

  // Signing out with no session is a no-op, not a bounce to /login.
  const signout = await fetch(`${base}/auth/signout`, {
    method: "POST",
    redirect: "manual",
  });
  if (signout.status !== 303 || signout.headers.get("location") !== "/") {
    throw new Error(
      `anon sign-out: expected 303 -> /, got ${signout.status} ${signout.headers.get("location")}`,
    );
  }

  // No-JavaScript sign-in: the form must work as plain HTML. The outcome is a
  // redirect to /login?sent=... or ?error=..., and it must appear in the
  // VISIBLE page, not only in React's script payload (a page that seems to
  // do nothing makes people request again, replacing the link they got).
  // Under `next start` the console sender refuses to run, so the expected
  // outcome here is the visible "couldn't send" path.
  const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");
  const loginHtml = await (await fetch(`${base}/login`)).text();
  const loginForm = new FormData();
  for (const m of loginHtml.matchAll(
    /<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g,
  )) {
    loginForm.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"'));
  }
  loginForm.append("email", "nojs-probe@example.test");
  const posted = await fetch(`${base}/login`, {
    method: "POST",
    body: loginForm,
    redirect: "manual",
  });
  const where = new URL(posted.headers.get("location") ?? "/", base);
  if (
    posted.status !== 303 ||
    where.pathname !== "/login" ||
    !(
      where.searchParams.has("sent") ||
      where.searchParams.get("error") === "send-failed"
    )
  ) {
    throw new Error(
      `no-JS login POST: expected 303 to /login?sent|error, got ${posted.status} ${where}`,
    );
  }
  const outcome = visible(await (await fetch(where)).text());
  if (
    !/We sent a sign-in link to|We couldn(&#x27;|')t send your sign-in link/.test(
      outcome,
    )
  ) {
    throw new Error("no-JS login: the outcome is not in the visible page");
  }
  if (!outcome.includes("Send a new link to"))
    throw new Error("no-JS login: no resend button");
  const invalid = visible(
    await (await fetch(`${base}/login?error=invalid-email`)).text(),
  );
  if (!invalid.includes("Enter a valid email address."))
    throw new Error("no-JS login: invalid-email message missing");

  // Role gates: a mismatch must be a 404 STATUS, not a 200 carrying 404
  // content (which is what the layout guards alone produce under Cache
  // Components). The proxy is the gate. Each 404 is paired with a 200 on the
  // role's own route, so a broken session can't pass as a 404.
  const participant = await signIn("smoke-participant@example.test");
  const judge = await signIn("smoke-judge@example.test", "judge");
  const organizer = await signIn("smoke-organizer@example.test", "organizer");
  await expectStatus("/team/none", participant.cookie, 200);
  // /team is a real 307: to the team's view, or to /team/none without a team.
  const teamRedirect = await fetch(`${base}/team`, {
    headers: { cookie: participant.cookie },
    redirect: "manual",
  });
  if (
    teamRedirect.status !== 307 ||
    teamRedirect.headers.get("location") !== "/team/none"
  ) {
    throw new Error(
      `/team without a team: expected 307 -> /team/none, got ${teamRedirect.status} ${teamRedirect.headers.get("location")}`,
    );
  }
  await expectStatus("/judge", participant.cookie, 404);
  await expectStatus("/organizer", participant.cookie, 404);
  await expectStatus("/does-not-exist", participant.cookie, 404);
  await expectStatus("/judge", judge.cookie, 200);
  await expectStatus("/organizer", judge.cookie, 404);
  await expectStatus("/team/none", judge.cookie, 200); // any signed-in user
  await expectStatus("/organizer", organizer.cookie, 200);
  await expectStatus("/judge", organizer.cookie, 404);
  // A POST to a gated route is refused with a 404 too (not Next's 400).
  const post = await fetch(`${base}/organizer`, {
    method: "POST",
    body: new FormData(),
    headers: { cookie: participant.cookie },
    redirect: "manual",
  });
  if (post.status !== 404)
    throw new Error(
      `POST /organizer as participant: expected 404, got ${post.status}`,
    );

  // The role is read live, not from the JWT: promoting someone who is
  // already signed in takes effect on their next request, with the same
  // cookie (the "added as a judge on Saturday morning" case, migration 0003).
  const late = await signIn("smoke-late-judge@example.test");
  await expectStatus("/judge", late.cookie, 404);
  await setRole(late.userId, "judge");
  await expectStatus("/judge", late.cookie, 200);

  console.log(
    "smoke: OK  /login renders; no-JS sign-in shows its outcome in the page; / public; anon /me -> /login; anon sign-out is a no-op; role gates are real 404s and read the role live",
  );
  exitCode = 0;
} catch (err) {
  console.error(`smoke: FAILED  ${err.message}`);
} finally {
  server.kill();
  process.exit(exitCode);
}

async function expectStatus(path, cookie, expected) {
  const res = await fetch(`${base}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (res.status !== expected) {
    throw new Error(`${path}: expected HTTP ${expected}, got ${res.status}`);
  }
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fetch(url);
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
