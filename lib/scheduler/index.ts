// The judging scheduler: a pure TypeScript port of the validated Python
// reference in scheduler/*.py. No database, no I/O.
//
// solve() is the entry point. The stage functions are exported for the
// parity and property tests in tests/scheduler/.

export type {
  JudgeRoster,
  Pair,
  SolveInput,
  SolveResult,
  SolveStats,
  Sponsor,
} from "./types.ts";
export { solve } from "./solve.ts";
export { candidatePlans } from "./stage0.ts";
export { assignTeams, assignPanelPairs } from "./stage1.ts";
export { edgeColor } from "./color.ts";
export { improveSpacing } from "./spacing.ts";
export { verify } from "./verify.ts";
export {
  coverageCapacity,
  preflight,
  slotsFor,
  type CapacityRow,
  type Preflight,
  type PreflightWarning,
} from "./capacity.ts";
export { PyRandom, pyRound, pySum } from "./python.ts";
