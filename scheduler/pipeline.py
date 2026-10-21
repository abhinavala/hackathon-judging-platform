"""
Full four-stage pipeline with track-aware judge pairing, plus a repair pass.
"""
import random
from itertools import combinations
from collections import Counter

from scheduler import edge_color, improve_spacing, verify
from stage0 import form_panels, coverage_capacity, panel_summary


# ---------------------------------------------------------------- stage 1
def assign_teams(team_tracks, panel_sponsors, n_panels, seed=0, repair_rounds=200):
    """
    Give every team two panels covering as many of its tracks as possible,
    while keeping panel workloads equal and panel-pair overlap low.
    """
    n_teams = len(team_tracks)
    cap = -(-2 * n_teams // n_panels)
    rng = random.Random(seed)
    pairs = list(combinations(range(n_panels), 2))
    cover = {p: panel_sponsors[p[0]] | panel_sponsors[p[1]] for p in pairs}

    mult = {p: 0 for p in pairs}
    degree = [0] * n_panels
    assignment = [None] * n_teams

    # SCARCITY. A sponsor seen by few panels is a scarce resource: every time a
    # team that does NOT want that sponsor is seated on one of its panels, a
    # sighting is burned. Teams needing a scarce sponsor go first, and teams
    # that do not need it are steered away from those panels.
    demand = Counter()
    for tr in team_tracks:
        for s in tr:
            demand[s] += 1
    panels_with = Counter()
    for pi in range(n_panels):
        for s in panel_sponsors[pi]:
            panels_with[s] += 1
    n_slots = cap
    scarcity = {s: demand[s] / max(panels_with[s] * n_slots, 1)
                for s in demand}

    def waste(t, p):
        """How much scarce capacity this seating burns."""
        return sum(scarcity.get(s, 0)
                   for s in cover[p] - team_tracks[t])

    # Hardest teams first: most tracks, then scarcest tracks.
    def hardness(t):
        tr = team_tracks[t]
        return (-len(tr), -sum(scarcity.get(s, 0) for s in tr))

    for t in sorted(range(n_teams), key=hardness):
        want = team_tracks[t]
        room = [p for p in pairs if degree[p[0]] < cap and degree[p[1]] < cap]
        if not room:
            # Capacity is exactly 2T when D*cap == 2T, so the last few teams can
            # find every legal pair exhausted. Relax the cap by one rather than
            # failing; the slot count is derived from the real degrees later.
            slack = 1
            while not room:
                room = [p for p in pairs
                        if degree[p[0]] < cap + slack and degree[p[1]] < cap + slack]
                slack += 1
        best_cov = max(len(want & cover[p]) for p in room)
        legal = [p for p in room if len(want & cover[p]) == best_cov]
        pick = min(legal, key=lambda p: (round(waste(t, p), 3), mult[p],
                                         degree[p[0]] + degree[p[1]], rng.random()))
        mult[pick] += 1
        degree[pick[0]] += 1
        degree[pick[1]] += 1
        assignment[t] = pick

    # ------- repair: try to lift still-uncovered teams by swapping with a
    # team that does not need the panel it is sitting on.
    def missing(t):
        return team_tracks[t] - cover[assignment[t]]

    for _ in range(repair_rounds):
        stuck = [t for t in range(n_teams) if missing(t)]
        if not stuck:
            break
        improved = False
        for t in stuck:
            want = team_tracks[t]
            cur = len(want & cover[assignment[t]])
            for u in range(n_teams):
                if u == t:
                    continue
                pu = assignment[u]
                if len(want & cover[pu]) <= cur:
                    continue
                # swapping must not make u worse
                wu = team_tracks[u]
                if len(wu & cover[assignment[t]]) < len(wu & cover[pu]):
                    continue
                assignment[t], assignment[u] = pu, assignment[t]
                improved = True
                break
            if improved:
                break
        if not improved:
            break

    mult = Counter(assignment)
    degree = [0] * n_panels
    for p in assignment:
        degree[p[0]] += 1
        degree[p[1]] += 1
    return assignment, mult, degree


# ---------------------------------------------------------------- full run
def run(team_tracks, judges, seed=0, verbose=True, label=""):
    n_teams = len(team_tracks)
    n_panels = len(judges) // 2
    n_slots = -(-2 * n_teams // n_panels)

    panels, panel_sponsors, leftover, needed = form_panels(
        judges, team_tracks, n_slots)
    assignment, mult, degree = assign_teams(
        team_tracks, panel_sponsors, n_panels, seed)

    edges = []
    for t, (a, b) in enumerate(assignment):
        edges += [(t, a), (t, b)]
    random.Random(seed).shuffle(edges)
    color_of = edge_color(edges, n_teams, n_panels, n_slots)
    color_of = improve_spacing(color_of, n_slots, n_panels)
    errs = verify(color_of, n_teams, n_panels, n_slots)

    # coverage accounting
    cover = [panel_sponsors[a] | panel_sponsors[b] for a, b in assignment]
    full = sum(1 for t in range(n_teams) if team_tracks[t] <= cover[t])
    seats_wanted = sum(len(tr) for tr in team_tracks)
    seats_got = sum(len(team_tracks[t] & cover[t]) for t in range(n_teams))
    impossible = sum(1 for tr in team_tracks if len(tr) > 4)

    gaps = {}
    for (t, p), c in color_of.items():
        gaps.setdefault(t, []).append(c)
    gaps = [abs(v[0] - v[1]) for v in gaps.values()]
    ov = list(mult.values())

    if verbose:
        print(f"--- {label} ---")
        print(f"  judges {len(judges)} -> {n_panels} panels x {n_slots} slots")
        print(f"  panel types       : {dict(panel_summary(panels, judges))}")
        print(f"  schedule valid    : {'YES' if not errs else 'NO ' + str(errs[:2])}")
        print(f"  teams fully covered: {full}/{n_teams} ({100*full//n_teams}%)"
              + (f"   [{impossible} impossible: >4 tracks]" if impossible else ""))
        print(f"  track-seats met   : {seats_got}/{seats_wanted} "
              f"({100*seats_got//max(seats_wanted,1)}%)")
        print(f"  teams per panel   : {min(degree)}-{max(degree)}")
        print(f"  panel-pair overlap: {min(ov)}-{max(ov)}")
        print(f"  min gap           : {min(gaps)} slots")
        if leftover is not None:
            print(f"  NOTE: odd judge count, judge {leftover} unassigned")
    return dict(full=full, n=n_teams, seats_got=seats_got, seats_wanted=seats_wanted,
                errs=errs, degree=degree, ov=ov, gaps=gaps, impossible=impossible,
                n_slots=n_slots, n_panels=n_panels)


def make_teams(n, probs, seed=0):
    rng = random.Random(seed)
    return [{s for s, pr in probs.items() if rng.random() < pr} for _ in range(n)]


def roster(**kw):
    """roster(AWS=4, A10=3, none=9) -> list of sponsor labels"""
    out = []
    for k, v in kw.items():
        out += [None if k == "none" else k] * v
    return out
