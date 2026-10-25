// Participant-facing copy that comes from event settings (migration 0006),
// shared by the team page, the board and the printed schedule. Pure.

/** Used only when the organizers haven't set a help location. */
export const HELP_FALLBACK = "the help desk";

/** "the check-in table by the main entrance", or the fallback. */
export function helpPlace(helpLocation: string | null | undefined): string {
  const place = helpLocation?.trim();
  return place ? place : HELP_FALLBACK;
}
