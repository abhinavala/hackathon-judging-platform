// Runs supabase/tests/rls_test.sql against the local Supabase database.
//
// The test file builds its own fixture with fixed ids and asserts exact row
// counts ("organizer sees every team" = 2), so it needs an empty database.
// We therefore `supabase db reset` first. That wipes local data, including
// anything `npm run seed` created; re-run the seed afterwards.
//
// Exit 0 only if psql exits 0 AND exactly EXPECTED assertions printed PASS.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EXPECTED = 31;
// RLS_TEST_FILE lets you point the runner at another file (e.g. to check that
// a failing assertion really fails the run).
const TEST_FILE = process.env.RLS_TEST_FILE ?? "supabase/tests/rls_test.sql";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.error) throw res.error;
  return res;
}

function fail(msg) {
  console.error(`\ntest:rls FAILED: ${msg}`);
  process.exit(1);
}

if (!process.argv.includes("--no-reset")) {
  console.log("Resetting local database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset"], { stdio: "inherit" });
  if (reset.status !== 0) fail("supabase db reset failed");
}

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
