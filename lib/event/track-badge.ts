// The short form of a track for badges: its sponsor ("AWS", "A10"), or the
// track's name when it has no sponsor. The full names stay on the Tracks
// page; in a ranking table and on a phone the short form carries the
// meaning. Pure.

export type BadgeTrack = {
  name: string;
  sponsor: string | null;
  sortOrder: number;
};

/** In the Tracks page's order, one badge per track (a team in both gets two). */
export function trackBadges(tracks: BadgeTrack[]): string[] {
  return [...tracks]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => t.sponsor?.trim() || t.name);
}
