"""
Final pipeline: search panel compositions, then schedule.
"""
import random
from collections import Counter

from scheduler import edge_color, improve_spacing, verify
from pipeline import assign_teams, make_teams, roster
from stage0v2 import candidate_plans
from stage0 import coverage_capacity


def score_plan(team_tracks, panel_sponsors, n_panels, seed=0):
    a, mult, deg = assign_teams(team_tracks, panel_sponsors, n_panels, seed)
    cov = [panel_sponsors[x] | panel_sponsors[y] for x, y in a]
    full = sum(1 for t in range(len(team_tracks)) if team_tracks[t] <= cov[t])
    seats = sum(len(team_tracks[t] & cov[t]) for t in range(len(team_tracks)))
    return full, seats, a, mult, deg


def solve(team_tracks, judges, seed=0, verbose=True, label=""):
    n_teams = len(team_tracks)
    n_panels = len(judges) // 2
    n_slots = -(-2 * n_teams // n_panels)

    best = None
    for name, panels in candidate_plans(judges, team_tracks, n_panels):
        ps = [{judges[a], judges[b]} - {None} for a, b in panels]
        full, seats, a, mult, deg = score_plan(team_tracks, ps, n_panels, seed)
        if best is None or (full, seats) > (best[0], best[1]):
            best = (full, seats, a, mult, deg, ps, panels, name)

    full, seats, assignment, mult, degree, panel_sponsors, panels, winner = best

    # Koenig: the number of slots needed is exactly the maximum degree of the
    # graph we actually built. Derive it rather than assuming the ideal, so a
    # coverage-driven imbalance costs one extra slot instead of crashing.
    n_slots = max(n_slots, max(degree))

    edges = []
    for t, (x, y) in enumerate(assignment):
        edges += [(t, x), (t, y)]
    random.Random(seed).shuffle(edges)
    color_of = edge_color(edges, n_teams, n_panels, n_slots)
    color_of = improve_spacing(color_of, n_slots, n_panels)
    errs = verify(color_of, n_teams, n_panels, n_slots)

    gaps = {}
    for (t, p), c in color_of.items():
        gaps.setdefault(t, []).append(c)
    gaps = [abs(v[0] - v[1]) for v in gaps.values()]
    ov = list(Counter(assignment).values())
    wanted = sum(len(tr) for tr in team_tracks)
    impossible = sum(1 for tr in team_tracks if len(tr) > 4)

    if verbose:
        kinds = Counter(tuple(sorted((str(judges[a]), str(judges[b]))))
                        for a, b in panels)
        print(f"--- {label} ---")
        print(f"  {len(judges)} judges -> {n_panels} panels x {n_slots} slots")
        print(f"  winning strategy  : {winner}")
        print(f"  panel types       : {dict(kinds)}")
        print(f"  schedule valid    : {'YES' if not errs else 'NO'}")
        print(f"  fully covered     : {full}/{n_teams} ({100*full//n_teams}%)"
              + (f"  [{impossible} need >4 tracks]" if impossible else ""))
        print(f"  track-seats met   : {seats}/{wanted} ({100*seats//max(wanted,1)}%)")
        print(f"  teams per panel   : {min(degree)}-{max(degree)}")
        print(f"  overlap           : {min(ov)}-{max(ov)}")
        print(f"  min gap           : {min(gaps)} slots")
    return dict(full=full, seats=seats, wanted=wanted, errs=errs, winner=winner,
                degree=degree, ov=ov, gaps=gaps, n_slots=n_slots,
                color_of=color_of, assignment=assignment, panels=panels,
                panel_sponsors=panel_sponsors, impossible=impossible)
