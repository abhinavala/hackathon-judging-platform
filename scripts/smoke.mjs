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

  // Role gates: a mismatch must be a 404 STATUS, not a 200 carrying 404
  // content (which is what the layout guards alone produce under Cache
  // Components). The proxy is the gate. Each 404 is paired with a 200 on the
  // role's own route, so a broken session can't pass as a 404.
  const participant = await signIn("smoke-participant@example.test");
  const judge = await signIn("smoke-judge@example.test", "judge");
  const organizer = await signIn("smoke-organizer@example.test", "organizer");
  await expectStatus("/team", participant.cookie, 200);
  await expectStatus("/judge", participant.cookie, 404);
  await expectStatus("/organizer", participant.cookie, 404);
  await expectStatus("/does-not-exist", participant.cookie, 404);
  await expectStatus("/judge", judge.cookie, 200);
  await expectStatus("/organizer", judge.cookie, 404);
  await expectStatus("/team", judge.cookie, 200); // any signed-in user
  await expectStatus("/organizer", organizer.cookie, 200);
  await expectStatus("/judge", organizer.cookie, 404);

  // The role is read live, not from the JWT: promoting someone who is
  // already signed in takes effect on their next request, with the same
  // cookie (the "added as a judge on Saturday morning" case, migration 0003).
  const late = await signIn("smoke-late-judge@example.test");
  await expectStatus("/judge", late.cookie, 404);
  await setRole(late.userId, "judge");
  await expectStatus("/judge", late.cookie, 200);

  console.log(
    "smoke: OK  /login renders; / public; anon /me -> /login; anon sign-out is a no-op; role gates are real 404s and read the role live",
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
