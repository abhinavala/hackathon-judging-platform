// Smoke test: the production build starts, /login renders, and the public /
// protected split holds.
// Run after `next build` (npm run test:smoke does both).
import { spawn } from "node:child_process";

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

  console.log(
    "smoke: OK  /login renders; / public; anon /me -> /login; anon sign-out is a no-op",
  );
  exitCode = 0;
} catch (err) {
  console.error(`smoke: FAILED  ${err.message}`);
} finally {
  server.kill();
  process.exit(exitCode);
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
