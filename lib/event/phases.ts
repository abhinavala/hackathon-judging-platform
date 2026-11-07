// What part of a slot it is: presenting, questions, or switching over to the
// next teams. Display only: the schedule and the generator never read this.
// Fixed this year (4 / 1 / 2 of a 7-minute slot); the switch-over is
// whatever is left of the slot, so a slot of another length still ends on
// time. Pure, so it is tested directly.

/** Minutes, in order. */
export const SLOT_PHASES = {
  presenting: 4,
  questions: 1,
  switchOver: 2,
} as const;

export type SlotPhase = {
  kind: "presenting" | "questions" | "switch";
  /** Seconds until this phase ends. */
  secondsLeft: number;
  /** "Presenting · 3:12 left" */
  text: string;
};

/** 192 -> "3:12" */
export function minSec(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The phase at `now` of the slot [startsAt, endsAt), or null outside it.
 * `nextTeams` says whether anyone presents after this slot.
 */
export function phaseAt(
  startsAt: string,
  endsAt: string,
  now: number,
  nextTeams = true,
): SlotPhase | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!(now >= start && now < end)) return null;
  const presentingEnds = Math.min(end, start + SLOT_PHASES.presenting * 60_000);
  const questionsEnds = Math.min(
    end,
    presentingEnds + SLOT_PHASES.questions * 60_000,
  );
  const left = (until: number) => (until - now) / 1000;
  if (now < presentingEnds) {
    const s = left(presentingEnds);
    return {
      kind: "presenting",
      secondsLeft: Math.ceil(s),
      text: `Presenting · ${minSec(s)} left`,
    };
  }
  if (now < questionsEnds) {
    const s = left(questionsEnds);
    return {
      kind: "questions",
      secondsLeft: Math.ceil(s),
      text: `Questions · ${minSec(s)} left`,
    };
  }
  const s = left(end);
  return {
    kind: "switch",
    secondsLeft: Math.ceil(s),
    text: nextTeams
      ? `Switch over · ${minSec(s)} until next teams`
      : `Wrapping up · ${minSec(s)} left`,
  };
}

/** "4 min presenting, 1 min questions, 2 min switch over" for a slot length. */
export function phaseSummary(slotMinutes: number): string {
  const rest = slotMinutes - SLOT_PHASES.presenting - SLOT_PHASES.questions;
  return `${SLOT_PHASES.presenting} min presenting, ${SLOT_PHASES.questions} min questions, ${rest} min switch over`;
}
