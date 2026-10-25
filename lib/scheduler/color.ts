// Stage 2: decide WHEN each meeting happens. Port of scheduler/scheduler.py
// (edge_color), with one deliberate correction described below.
//
// Graph: teams on one side (degree 2), panels on the other (degree ~2T/D).
// Each edge is one presentation; each COLOUR is one time slot. A proper edge
// colouring means no two edges sharing a vertex share a colour: a team is
// never in two places at once, a panel never faces two teams at once.
//
// Koenig's theorem: a bipartite graph is edge-colourable in exactly Delta
// colours (its maximum degree). This is the constructive proof: when an edge
// (t, p) has no colour free at both ends, take alpha free at t and beta free
// at p, flip the alpha/beta alternating path starting at p, after which alpha
// is free at p too.
//
// THE PATH FLIP (fixed in both the Python and this port): the original
// reference flipped the path by calling recolor() on each edge in turn.
// recolor() deletes the edge's OLD colour key at both ends, but at every
// interior vertex the previous edge has just moved INTO that colour, so the
// delete removed the wrong entry and marked the colour free while an edge
// still held it. A later edge could then take that colour and double-book a
// panel: for 60 teams on 12 panels, seed 206 (unconstrained pairing), panel
// 11 got teams 15 and 19 in slot 0. Every path edge is now uncoloured first
// (and removed from colorOf, so it is re-inserted at the end, exactly as the
// Python's `del color_of[edge]` does; improve_spacing iterates in that
// order) and then recoloured. Over 2,400 unconstrained runs the fix changed
// only that invalid case.

export type EdgeKey = number;

/** Colour (slot) per edge, keyed team * nPanels + panel, in first-coloured order. */
export function edgeColor(
  edges: [number, number][],
  nTeams: number,
  nPanels: number,
  nColors: number,
): Map<EdgeKey, number> {
  const key = (t: number, p: number) => t * nPanels + p;
  const all = () => new Set(Array.from({ length: nColors }, (_, c) => c));
  const freeT = Array.from({ length: nTeams }, all);
  const freeP = Array.from({ length: nPanels }, all);
  // colour -> the edge occupying it, at each vertex
  const atT = Array.from({ length: nTeams }, () => new Map<number, [number, number]>());
  const atP = Array.from({ length: nPanels }, () => new Map<number, [number, number]>());
  const colorOf = new Map<EdgeKey, number>();

  const uncolor = ([t, p]: [number, number]) => {
    const old = colorOf.get(key(t, p))!;
    atT[t].delete(old);
    atP[p].delete(old);
    freeT[t].add(old);
    freeP[p].add(old);
    colorOf.delete(key(t, p));
  };
  const setColor = ([t, p]: [number, number], c: number) => {
    colorOf.set(key(t, p), c);
    atT[t].set(c, [t, p]);
    atP[p].set(c, [t, p]);
    freeT[t].delete(c);
    freeP[p].delete(c);
  };
  const minOf = (s: Set<number>) => {
    let m = Infinity;
    for (const c of s) if (c < m) m = c;
    if (m === Infinity) throw new Error("edge_color: no free colour (nColors below max degree)");
    return m;
  };

  for (const e of edges) {
    const [t, p] = e;
    let common = Infinity;
    for (const c of freeT[t]) if (c < common && freeP[p].has(c)) common = c;
    if (common !== Infinity) {
      setColor(e, common);
      continue;
    }

    // No shared free colour: alpha free at the team, beta free at the panel.
    const alpha = minOf(freeT[t]);
    const beta = minOf(freeP[p]);

    // Walk the alternating alpha/beta path starting at the panel.
    const path: [[number, number], number][] = [];
    let node = p;
    let atPanel = true;
    let want = alpha;
    for (;;) {
      const edge = atPanel ? atP[node].get(want) : atT[node].get(want);
      if (!edge) throw new Error("edge_color: alternating path lost its edge");
      path.push([edge, want]);
      want = want === alpha ? beta : alpha;
      if (atPanel) {
        node = edge[0];
        atPanel = false;
        if (!atT[node].has(want)) break;
      } else {
        node = edge[1];
        atPanel = true;
        if (!atP[node].has(want)) break;
      }
    }

    // Flip it: uncolour every path edge, then recolour (see THE PATH FLIP above).
    for (const [edge] of path) uncolor(edge);
    for (const [edge, c] of path) setColor(edge, c === alpha ? beta : alpha);
    setColor(e, alpha);
  }
  return colorOf;
}
