"""
Stage 0: form the judge pairs themselves, driven by track demand.

Previously panels were given. Now we get a roster of judges, each tagged with a
sponsor affiliation (or None for alums/profs), and we decide who pairs with whom
BEFORE assigning teams. Panel composition becomes an output.

Pipeline:
  Stage 0  pair judges into panels        <- new
  Stage 1  assign teams to panels         <- track-aware
  Stage 2  edge-colour into time slots    <- unchanged
  Stage 3  spacing repair                 <- unchanged
"""
import math
from collections import Counter, defaultdict
from itertools import combinations


# ---------------------------------------------------------------- feasibility
def coverage_capacity(judges, team_tracks, n_slots):
    """
    The key insight: a judge from sponsor s sits on exactly one panel and sees
    n_slots teams over the round. So s-judges collectively produce

        judges_from_s x n_slots

    team-sightings, and each team wanting s needs at least one of them.
    This bound is independent of how we pair anyone -- it is a property of the
    roster alone, so it can be checked the moment judges confirm.
    """
    have = Counter(j for j in judges if j is not None)
    need = Counter()
    for tr in team_tracks:
        for s in tr:
            need[s] += 1

    rows = []
    for s in sorted(set(have) | set(need)):
        capacity = have[s] * n_slots
        rows.append({
            "sponsor": s,
            "judges": have[s],
            "teams_wanting": need[s],
            "capacity": capacity,
            "ok": need[s] <= capacity,
            "min_judges": math.ceil(need[s] / n_slots) if n_slots else 0,
        })
    return rows


# ---------------------------------------------------------------- stage 0
def form_panels(judges, team_tracks, n_slots, cooccur_bonus=True):
    """
    Pair judges into panels so that the number of panels containing an s-judge
    meets demand for every sponsor s.

    Two ideas drive the pairing:

    1. NEED. Sponsor s must appear on at least ceil(n_s / n_slots) panels,
       because each panel sees at most n_slots teams.

    2. CO-OCCURRENCE. If many teams submit to both AWS and A10, a single
       AWS+A10 panel covers both tracks in one visit, leaving that team's other
       visit completely unconstrained. Pairing co-occurring sponsors buys
       flexibility; pairing a sponsor with itself wastes a seat, since both
       judges cover the same track for the same team.
    """
    idx_by_sponsor = defaultdict(list)
    for i, s in enumerate(judges):
        idx_by_sponsor[s].append(i)

    need = Counter()
    for tr in team_tracks:
        for s in tr:
            need[s] += 1
    panels_needed = {s: math.ceil(n / n_slots) for s, n in need.items()}

    co = Counter()
    for tr in team_tracks:
        for a, b in combinations(sorted(tr), 2):
            co[(a, b)] += 1

    def co_score(a, b):
        if not cooccur_bonus or a is None or b is None or a == b:
            return 0
        return co[tuple(sorted((a, b)))]

    remaining = {s: list(v) for s, v in idx_by_sponsor.items()}
    outstanding = dict(panels_needed)
    panels, leftover_note = [], None

    def take(s):
        return remaining[s].pop()

    def avail(s):
        return len(remaining.get(s, []))

    # Phase A -- satisfy outstanding need, pairing needy sponsors together.
    while True:
        needy = [s for s, k in outstanding.items() if k > 0 and avail(s) > 0]
        if not needy:
            break
        # Most urgent sponsor first: largest need relative to judges left.
        s = max(needy, key=lambda x: (outstanding[x] / max(avail(x), 1), outstanding[x]))
        partners = [t for t in needy if t != s and avail(t) > 0]
        if partners:
            t = max(partners, key=lambda x: (co_score(s, x), outstanding[x]))
        else:
            # No other needy sponsor: prefer an unaffiliated judge, else slack.
            if avail(None) > 0:
                t = None
            else:
                slack = [x for x in remaining
                         if x != s and avail(x) > 0 and outstanding.get(x, 0) <= 0]
                if slack:
                    t = max(slack, key=lambda x: (co_score(s, x), avail(x)))
                elif avail(s) >= 2:
                    t = s           # last resort: two judges from the same sponsor
                else:
                    break
        a, b = take(s), take(t)
        panels.append((a, b))
        outstanding[s] = outstanding.get(s, 0) - 1
        if t is not None and t in outstanding:
            outstanding[t] -= 1

    # Phase B -- pair whoever is left, spreading affiliations where possible.
    pool = [(s, i) for s, v in remaining.items() for i in v]
    pool.sort(key=lambda x: (x[0] is None, str(x[0])))
    while len(pool) >= 2:
        s, i = pool.pop(0)
        j_idx = next((k for k, (t, _) in enumerate(pool) if t != s), 0)
        t, j = pool.pop(j_idx)
        panels.append((i, j))
    if pool:
        leftover_note = pool[0][1]

    panel_sponsors = [
        {judges[a], judges[b]} - {None} for a, b in panels
    ]
    return panels, panel_sponsors, leftover_note, panels_needed


# ---------------------------------------------------------------- reporting
def panel_summary(panels, judges):
    kinds = Counter()
    for a, b in panels:
        kinds[tuple(sorted((str(judges[a]), str(judges[b]))))] += 1
    return kinds
