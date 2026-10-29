// Runs supabase/tests/rls_test.sql against the local Supabase database.
//
// The test file builds its own fixture with fixed ids and asserts exact row
// counts ("organizer sees every team" = 2), so it needs an empty database.
// We therefore `supabase db reset` first, which wipes local data.
//
// Outside CI, a passing run then restores the dev fixture: reset again (the
// test fixture is committed, and seeding on top of it would mix test rows
// into dev data) and run `npm run seed`. Skipped when CI=true, with
// --no-reset, after a failing run (the fixture is left for debugging), and,
// with a note, while scripts/seed.mts doesn't exist yet.
//
// Exit 0 only if psql exits 0 AND exactly EXPECTED assertions printed PASS.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const EXPECTED = 51;
// RLS_TEST_FILE lets you point the runner at another file (e.g. to check that
// a failing assertion really fails the run).
const TEST_FILE = process.env.RLS_TEST_FILE ?? "supabase/tests/rls_test.sql";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.error) throw res.error;
  return res;
}

const SEED_SCRIPT = "scripts/seed.mts";
const reset = !process.argv.includes("--no-reset");
const reseed = reset && process.env.CI !== "true";

function resetDatabase() {
  console.log("Resetting local database (supabase db reset)...");
  const res = run("npx", ["supabase", "db", "reset"], { stdio: "inherit" });
  if (res.status !== 0) fail("supabase db reset failed");
}

function fail(msg) {
  console.error(`\ntest:rls FAILED: ${msg}`);
  if (reseed) {
    console.error(
      "The test fixture is left in the database for debugging; run `npm run db:reset && npm run seed` to restore dev data.",
    );
  }
  process.exit(1);
}

if (reset) resetDatabase();

// Run psql inside the Supabase db container, so no local psql is needed.
const status = run("npx", ["supabase", "status", "-o", "json"]);
if (status.status !== 0) fail("supabase is not running (npx supabase start)");
const projectId = /project_id\s*=\s*"([^"]+)"/.exec(
  readFileSync("supabase/config.toml", "utf8"),
)?.[1];
if (!projectId) fail("could not read project_id from supabase/config.toml");

const psql = run(
  "docker",
  [
    "exec",
    "-i",
    `supabase_db_${projectId}`,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "-",
  ],
  { input: readFileSync(TEST_FILE, "utf8") },
);

const output = `${psql.stdout}\n${psql.stderr}`;
const passes = output.split("\n").filter((l) => /NOTICE:\s+PASS\b/.test(l));
const failures = output.split("\n").filter((l) => /\bFAIL\b|ERROR:/.test(l));

for (const line of passes) console.log(line.replace(/^.*NOTICE:\s+/, ""));
for (const line of failures) console.error(line);

if (psql.status !== 0) fail(`psql exited ${psql.status}`);
if (failures.length > 0) fail(`${failures.length} failure line(s)`);
if (passes.length !== EXPECTED)
  fail(`expected ${EXPECTED} PASS lines, got ${passes.length}`);

console.log(`\n${passes.length}/${EXPECTED} PASS`);

if (reseed) {
  if (!existsSync(SEED_SCRIPT)) {
    console.log(
      `\nNote: ${SEED_SCRIPT} doesn't exist yet (Phase 1 Step 4), so the dev fixture was not restored. The database holds the RLS test fixture.`,
    );
  } else {
    console.log("\nRestoring dev data: reset, then npm run seed...");
    resetDatabase();
    const seed = run("npm", ["run", "seed"], { stdio: "inherit" });
    if (seed.status !== 0) {
      console.error(
        "\ntest:rls: the tests PASSED, but npm run seed failed afterwards.",
      );
      process.exit(1);
    }
  }
}
