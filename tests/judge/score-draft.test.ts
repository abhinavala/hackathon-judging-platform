import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialDraft,
  isComplete,
  parseDraft,
  type Criterion,
} from "../../lib/judge/score-draft.ts";

const C: Criterion[] = ["a", "b", "c", "d"].map((id) => ({
  id,
  label: id,
  description: null,
  min: 1,
  max: 5,
}));
const server = {
  values: { a: 3 },
  notes: "server",
  pending: false,
  changedAt: 100,
};

test("an unsynced copy on the phone wins over the server's older one", () => {
  const local = {
    values: { a: 5, b: 2 },
    notes: "typed offline",
    pending: true,
    changedAt: 200,
  };
  assert.deepEqual(initialDraft(server, local), local);
});

test("a confirmed or older local copy doesn't override the server", () => {
  assert.deepEqual(
    initialDraft(server, {
      ...server,
      notes: "old",
      pending: false,
      changedAt: 300,
    }),
    server,
  );
  assert.deepEqual(
    initialDraft(server, {
      ...server,
      notes: "stale",
      pending: true,
      changedAt: 50,
    }),
    server,
  );
});

test("with nothing anywhere, an empty score", () => {
  assert.deepEqual(initialDraft(null, null).values, {});
  const local = { values: { a: 1 }, notes: "", pending: true, changedAt: 1 };
  assert.deepEqual(initialDraft(null, local), local);
});

test("complete means every criterion has a value inside its scale", () => {
  assert.equal(
    isComplete(
      { values: { a: 1, b: 2, c: 3 }, notes: "", pending: false, changedAt: 0 },
      C,
    ),
    false,
  );
  assert.equal(
    isComplete(
      {
        values: { a: 1, b: 2, c: 3, d: 5 },
        notes: "",
        pending: false,
        changedAt: 0,
      },
      C,
    ),
    true,
  );
  assert.equal(
    isComplete(
      {
        values: { a: 1, b: 2, c: 3, d: 6 },
        notes: "",
        pending: false,
        changedAt: 0,
      },
      C,
    ),
    false,
  );
});

test("a stored draft is validated on the way back in", () => {
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft("{nope"), null);
  assert.deepEqual(
    parseDraft(
      '{"values":{"a":3,"b":"x","c":2.5},"notes":7,"pending":true,"changedAt":9}',
    ),
    {
      values: { a: 3 },
      notes: "",
      pending: true,
      changedAt: 9,
    },
  );
});
