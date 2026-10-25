"""
Hackathon judging scheduler.

Two-stage exact algorithm:
  Stage 1 (PAIRING):  decide WHICH two panels judge each team.
  Stage 2 (COLORING): decide WHEN each of those meetings happens.
"""
import random
from itertools import combinations
from collections import defaultdict


# ---------------------------------------------------------------- STAGE 1
def assign_panel_pairs(n_teams, n_panels, seed=0):
    """
    Model: panels are VERTICES, teams are EDGES.
    A team assigned to panels (i, j) is an edge joining vertex i and vertex j.

    We want:
      - every vertex to have (near) equal degree   -> panels have equal workload
      - every possible edge used (near) equally    -> no two panels see the same team set
    """
    rng = random.Random(seed)
    pairs = list(combinations(range(n_panels), 2))

    multiplicity = {p: 0 for p in pairs}   # how many teams on this panel-pair
    degree = [0] * n_panels                # how many presentations this panel hosts
    assignment = []

    cap = -(-2 * n_teams // n_panels)  # no panel may exceed ceil(2T/D) presentations

    for _ in range(n_teams):
        # Greedy: least-used panel-pair, tie-broken by least-loaded panels.
        # The cap is load-bearing: without it greedy can paint itself into a
        # corner where the last few teams have no legal pair left.
        legal = [p for p in pairs if degree[p[0]] < cap and degree[p[1]] < cap]
        best = min(
            legal,
            key=lambda p: (multiplicity[p], degree[p[0]] + degree[p[1]], rng.random()),
        )
        multiplicity[best] += 1
        degree[best[0]] += 1
        degree[best[1]] += 1
        assignment.append(best)

    return assignment, multiplicity, degree


# ---------------------------------------------------------------- STAGE 2
def edge_color(edges, n_teams, n_panels, n_colors):
    """
    Bipartite edge colouring.

    Graph: teams on the left (degree 2), panels on the right (degree ~2T/D).
    Each edge is one presentation. Each COLOUR is one time slot.
    A proper edge colouring means no two edges sharing a vertex share a colour:
      - at a team vertex  -> the team is never in two places at once
      - at a panel vertex -> the panel never faces two teams at once

    Koenig's theorem: a bipartite graph is edge-colourable in exactly
    Delta colours, where Delta is the maximum degree. So n_colors = Delta
    always suffices. This implements the constructive proof (alternating paths).
    """
    free_t = [set(range(n_colors)) for _ in range(n_teams)]
    free_p = [set(range(n_colors)) for _ in range(n_panels)]
    # colour -> which edge occupies it at this vertex
    at_t = [dict() for _ in range(n_teams)]
    at_p = [dict() for _ in range(n_panels)]
    color_of = {}

    def recolor(e, c):
        t, p = e
        old = color_of.get(e)
        if old is not None:
            del at_t[t][old]; del at_p[p][old]
            free_t[t].add(old); free_p[p].add(old)
        color_of[e] = c
        at_t[t][c] = e; at_p[p][c] = e
        free_t[t].discard(c); free_p[p].discard(c)

    for e in edges:
        t, p = e
        common = free_t[t] & free_p[p]
        if common:
            recolor(e, min(common))
            continue

        # No shared free colour. Pick alpha free at the team, beta free at the panel.
        alpha = min(free_t[t])
        beta = min(free_p[p])

        # Walk the alternating alpha/beta path starting at the panel, then flip it.
        path, node, kind, want = [], p, "p", alpha
        while True:
            edge = at_p[node][want] if kind == "p" else at_t[node][want]
            if edge is None:
                break
            path.append((edge, want))
            if kind == "p":
                node, kind, want = edge[0], "t", (beta if want == alpha else alpha)
                if want not in at_t[node]:
                    break
            else:
                node, kind, want = edge[1], "p", (beta if want == alpha else alpha)
                if want not in at_p[node]:
                    break

        # Clear every edge on the path BEFORE recolouring any of them.
        # Recolouring in sequence corrupts the occupancy maps: edge N moves
        # into a colour, overwriting edge N+1's entry, and edge N+1's own
        # recolour then deletes edge N's entry and marks the colour free
        # while it is still in use.
        for edge, c in path:
            t2, p2 = edge
            old_c = color_of.get(edge)
            if old_c is not None:
                at_t[t2].pop(old_c, None); at_p[p2].pop(old_c, None)
                free_t[t2].add(old_c); free_p[p2].add(old_c)
                del color_of[edge]
        for edge, c in path:
            recolor(edge, beta if c == alpha else alpha)
        recolor(e, alpha)

    return color_of


# ---------------------------------------------------------------- STAGE 3
def improve_spacing(color_of, n_colors, n_panels, target=None, passes=60):
    """
    A valid colouring may still hand a team slots 4 and 5. Two repair moves:

      MOVE: shift a presentation into a slot that is empty at that panel.
      SWAP: trade slots with the team currently sitting in the slot we want.

    SWAP is the important one. When a panel is saturated (e.g. 15 teams in 15
    slots) there are no empty slots at all, so MOVE can never fire and only
    SWAP can improve anything. Both moves preserve validity by construction:
    we only accept a slot that does not collide with the team's other slot.
    """
    if target is None:
        target = n_colors // 3

    slots_of = defaultdict(dict)          # team -> {panel: slot}
    occupant = defaultdict(dict)          # panel -> {slot: team}
    for (t, p), c in color_of.items():
        slots_of[t][p] = c
        occupant[p][c] = t

    def gap(t):
        s = list(slots_of[t].values())
        return abs(s[0] - s[1])

    def other_slot(t, p):
        return next(c for q, c in slots_of[t].items() if q != p)

    def apply(t, p, new_c):
        old = slots_of[t][p]
        del occupant[p][old]
        slots_of[t][p] = new_c
        occupant[p][new_c] = t

    for _ in range(passes):
        changed = False
        for t in sorted(slots_of, key=gap):
            if gap(t) >= target:
                continue
            for p in list(slots_of[t]):
                cur, oth = slots_of[t][p], other_slot(t, p)
                best, best_gain = None, 0
                for cand in range(n_colors):
                    if cand == cur or cand == oth:
                        continue
                    gain = abs(cand - oth) - abs(cur - oth)
                    if gain <= best_gain:
                        continue
                    u = occupant[p].get(cand)
                    if u is None:                       # MOVE
                        best, best_gain = (cand, None), gain
                    else:                               # SWAP
                        u_oth = other_slot(u, p)
                        if cur == u_oth:
                            continue                    # would double-book u
                        # only swap if u is not badly hurt
                        if abs(cur - u_oth) >= min(target, abs(cand - u_oth)):
                            best, best_gain = (cand, u), gain
                if best:
                    cand, u = best
                    if u is None:
                        apply(t, p, cand)
                    else:
                        del occupant[p][cur]; del occupant[p][cand]
                        slots_of[t][p] = cand; occupant[p][cand] = t
                        slots_of[u][p] = cur; occupant[p][cur] = u
                    changed = True
                    break
        if not changed:
            break

    return {(t, p): c for t, d in slots_of.items() for p, c in d.items()}


# ---------------------------------------------------------------- VERIFY
def verify(color_of, n_teams, n_panels, n_colors):
    errs = []
    by_team = defaultdict(list)
    by_panel_slot = defaultdict(list)
    for (t, p), c in color_of.items():
        by_team[t].append((p, c))
        by_panel_slot[(p, c)].append(t)

    for t in range(n_teams):
        s = by_team[t]
        if len(s) != 2:
            errs.append(f"team {t} has {len(s)} presentations")
        elif s[0][0] == s[1][0]:
            errs.append(f"team {t} sees the same panel twice")
        elif s[0][1] == s[1][1]:
            errs.append(f"team {t} double-booked at slot {s[0][1]}")
    for (p, c), ts in by_panel_slot.items():
        if len(ts) > 1:
            errs.append(f"panel {p} slot {c} has {len(ts)} teams")
    return errs


def run(n_teams, n_panels, slot_minutes=7, seed=0, verbose=True):
    n_colors = -(-2 * n_teams // n_panels)          # ceil(2T / D) = Delta
    pairing, mult, degree = assign_panel_pairs(n_teams, n_panels, seed)

    edges = []
    for t, (a, b) in enumerate(pairing):
        edges += [(t, a), (t, b)]
    random.Random(seed).shuffle(edges)

    color_of = edge_color(edges, n_teams, n_panels, n_colors)
    color_of = improve_spacing(color_of, n_colors, n_panels)
    errs = verify(color_of, n_teams, n_panels, n_colors)

    overlap = {}
    for a, b in combinations(range(n_panels), 2):
        overlap[(a, b)] = mult[(a, b)]
    gaps = []
    by_team = defaultdict(list)
    for (t, p), c in color_of.items():
        by_team[t].append(c)
    for t in range(n_teams):
        gaps.append(abs(by_team[t][0] - by_team[t][1]))

    if verbose:
        print(f"=== {n_teams} teams, {n_panels} panels ({n_panels*2} judges), "
              f"{n_colors} slots x {slot_minutes} min = {n_colors*slot_minutes} min ===")
        print(f"valid schedule       : {'YES' if not errs else 'NO ' + str(errs[:3])}")
        print(f"presentations        : {len(color_of)} (expected {2*n_teams})")
        print(f"teams per panel      : min {min(degree)}, max {max(degree)}")
        print(f"shared teams between : min {min(overlap.values())}, "
              f"max {max(overlap.values())} (of {min(degree)} each panel sees)")
        print(f"gap between a team's : min {min(gaps)}, median {sorted(gaps)[len(gaps)//2]}, "
              f"max {max(gaps)} slots")
    return color_of, degree, overlap, gaps, errs, n_colors


if __name__ == "__main__":
    for panels in (7, 8, 10, 12):
        run(60, panels)
        print()
