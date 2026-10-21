"""
Stage 0 v2: generate several candidate panel compositions, score each by
actually running the assignment, keep the winner.

Why search instead of a single rule? Because the two sensible rules point in
opposite directions and which one wins depends on the roster:

  SPREAD (sponsor + unaffiliated) maximises the NUMBER of sponsor-bearing
  panels, so AWS teams and A10 teams do not compete for the same seats.
  Best when sponsor judges are scarce.

  MIX (sponsor + different sponsor) lets one visit cover two tracks at once.
  Necessary when teams submit to 3+ tracks, because a team sees only 2 panels
  and an all-spread layout can never cover more than 2 sponsors for one team.

The whole pipeline runs in milliseconds, so we do not need to guess: build a
handful of candidates and measure.
"""
import random
from collections import Counter, defaultdict
from itertools import combinations


def _panels_from_plan(judges, plan):
    """plan: list of (sponsorA, sponsorB) label pairs -> concrete judge indices."""
    pool = defaultdict(list)
    for i, s in enumerate(judges):
        pool[s].append(i)
    panels = []
    for a, b in plan:
        if not pool[a] or not pool[b] or (a == b and len(pool[a]) < 2):
            return None
        ia = pool[a].pop()
        ib = pool[b].pop()
        panels.append((ia, ib))
    return panels


def _strategy_spread(sponsors, counts, n_panels):
    """Each sponsor judge paired with an unaffiliated judge where possible."""
    plan, c = [], dict(counts)
    for s in sponsors:
        while c.get(s, 0) > 0 and c.get(None, 0) > 0 and len(plan) < n_panels:
            plan.append((s, None)); c[s] -= 1; c[None] -= 1
    return plan, c


def _strategy_mix(sponsors, counts, n_panels, co):
    """Sponsor judges paired with each other, most co-occurring first."""
    plan, c = [], dict(counts)
    order = sorted(combinations(sponsors, 2), key=lambda p: -co.get(tuple(sorted(p)), 0))
    for a, b in order:
        while c.get(a, 0) > 0 and c.get(b, 0) > 0 and len(plan) < n_panels:
            plan.append((a, b)); c[a] -= 1; c[b] -= 1
    return plan, c


def _strategy_hybrid(sponsors, counts, n_panels, co, n_mixed):
    """n_mixed co-occurring mixed panels, remaining sponsors spread."""
    plan, c = _strategy_mix(sponsors, counts, min(n_mixed, n_panels), co)
    rest, c = _strategy_spread(sponsors, c, n_panels - len(plan))
    return plan + rest, c


def _finish(plan, c, n_panels):
    """Pair whatever judges remain, then pad."""
    plan = list(plan)
    leftovers = []
    for s, k in c.items():
        leftovers += [s] * max(0, k)
    leftovers.sort(key=lambda s: (s is None, str(s)))
    while len(leftovers) >= 2 and len(plan) < n_panels:
        a = leftovers.pop(0)
        j = next((k for k, t in enumerate(leftovers) if t != a), 0)
        b = leftovers.pop(j)
        plan.append((a, b))
    return plan


def candidate_plans(judges, team_tracks, n_panels):
    counts = Counter(judges)
    sponsors = sorted([s for s in counts if s is not None], key=str)
    co = Counter()
    for tr in team_tracks:
        for a, b in combinations(sorted(tr), 2):
            co[(a, b)] += 1

    plans = []
    for name, plan_c in [
        ("spread", _strategy_spread(sponsors, counts, n_panels)),
        ("mix", _strategy_mix(sponsors, counts, n_panels, co)),
    ]:
        plans.append((name, _finish(plan_c[0], plan_c[1], n_panels)))
    for k in range(1, min(n_panels, 7)):
        p, c = _strategy_hybrid(sponsors, counts, n_panels, co, k)
        plans.append((f"hybrid-{k}", _finish(p, c, n_panels)))

    # a few random restarts as a safety net
    rng = random.Random(12345)
    flat = [s for s, k in counts.items() for _ in range(k)]
    for r in range(60):
        f = flat[:]
        rng.shuffle(f)
        plan = [(f[2 * i], f[2 * i + 1]) for i in range(min(n_panels, len(f) // 2))]
        plans.append((f"random-{r}", plan))

    out = []
    for name, plan in plans:
        panels = _panels_from_plan(judges, plan)
        if panels and len(panels) == n_panels:
            out.append((name, panels))
    return out
