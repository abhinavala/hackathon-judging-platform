"""
Regenerates tests/scheduler/goldens.json from the Python reference in
scheduler/ (run from the repo root):

    python3 tests/scheduler/make_goldens.py

The TypeScript port (lib/scheduler/) must reproduce these outputs exactly.
scheduler/*.py is imported as-is and never modified.

Each scenario is run under several PYTHONHASHSEED values. Python iterates
sets of strings in hash order, which can change the last bit of a float sum
and so a tie-break; a scenario is kept for exact comparison only if the
Python agrees with itself across every hash seed.
"""
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "scheduler"))

import scheduler as S  # noqa: E402
from pipeline import make_teams, roster  # noqa: E402
from stage0 import coverage_capacity  # noqa: E402
from pipeline2 import solve  # noqa: E402

SPONSORS = ["AWS", "A10", "GCP", "MSFT"]
HASH_SEEDS = ["0", "1", "2", "3"]


def track_aware_inputs(n=60):
    rng = random.Random(20261108)
    out = []
    for i in range(n):
        k = rng.randint(2, 4)
        sponsors = SPONSORS[:k]
        T = rng.randint(40, 70)
        J = rng.randint(14, 24)
        probs = {s: round(rng.uniform(0.1, 0.6), 3) for s in sponsors}
        counts = [rng.randint(1, 4) for _ in sponsors]
        kw = dict(zip(sponsors, counts))
        kw["none"] = max(0, J - sum(counts))
        out.append({"id": f"track-{i}", "T": T, "probs": probs, "roster": kw, "seed": i})
    return out


def unconstrained_inputs():
    cases = [(60, 12, 206)]  # double-booked a panel before the edge_color path-flip fix
    rng = random.Random(7)
    for _ in range(23):
        cases.append((rng.choice([45, 52, 60, 64, 70]), rng.choice([7, 8, 9, 10, 11, 12]), rng.randint(0, 999)))
    return [{"id": f"plain-{T}x{D}-s{seed}", "T": T, "D": D, "seed": seed} for T, D, seed in cases]


def run_track(spec):
    tt = make_teams(spec["T"], spec["probs"], seed=spec["seed"])
    judges = roster(**spec["roster"])
    r = solve(tt, judges, seed=spec["seed"], verbose=False)
    return {
        "teamTracks": [sorted(t) for t in tt],
        "judges": judges,
        "winner": r["winner"],
        "panels": [list(p) for p in r["panels"]],
        "assignment": [list(p) for p in r["assignment"]],
        "nSlots": r["n_slots"],
        "colorOf": [x for (t, p), c in r["color_of"].items() for x in (t, p, c)],
        "full": r["full"],
        "seats": r["seats"],
        "wanted": r["wanted"],
        "degree": r["degree"],
        "errs": r["errs"],
    }


def run_plain(spec):
    T, D, seed = spec["T"], spec["D"], spec["seed"]
    pairing, _, degree = S.assign_panel_pairs(T, D, seed)
    n_colors = max(-(-2 * T // D), max(degree))
    edges = [e for t, (a, b) in enumerate(pairing) for e in ((t, a), (t, b))]
    random.Random(seed).shuffle(edges)
    col = S.edge_color(edges, T, D, n_colors)
    errs = S.verify(col, T, D, n_colors)
    spaced = S.improve_spacing(col, n_colors, D) if not errs else None
    return {
        "pairing": [list(p) for p in pairing],
        "nColors": n_colors,
        "colorOf": [x for (t, p), c in col.items() for x in (t, p, c)],
        "errs": errs,
        "spaced": None if spaced is None else [x for (t, p), c in spaced.items() for x in (t, p, c)],
    }


def worker():
    """Child process: run every scenario under the inherited PYTHONHASHSEED."""
    print(json.dumps({
        "track": {s["id"]: run_track(s) for s in track_aware_inputs()},
        "plain": {s["id"]: run_plain(s) for s in unconstrained_inputs()},
    }))


def numerics():
    out = {"random": [], "shuffle": [], "round": [], "sum": [], "makeTeams": None}
    for seed in [0, 1, 42, 206, 12345, 20261108, 2**32 + 5, 2**53 - 1]:
        r = random.Random(seed)
        out["random"].append({"seed": seed, "values": [r.random() for _ in range(12)]})
        r = random.Random(seed)
        xs = list(range(40))
        r.shuffle(xs)
        out["shuffle"].append({"seed": seed, "result": xs})
    rng = random.Random(3)
    xs = [0.0625, 0.0005, 0.0015, 0.0025, 2.675, 1.0005, 0.1235, 0.5, 1.5, 2.5,
          -0.0625, 1 / 3, 2 / 3, 0.6, 0.4 + 0.2, 36 / 60, 24 / 45, 0.6 + 0.533333]
    xs += [rng.random() * rng.choice([1, 3, 10]) for _ in range(200)]
    xs += [rng.randint(1, 70) / rng.randint(1, 4) / rng.randint(7, 18) for _ in range(200)]
    out["round"] = [[x, round(x, 3)] for x in xs]
    for _ in range(200):
        vals = [rng.randint(1, 70) / (rng.randint(1, 4) * rng.randint(7, 18)) for _ in range(rng.randint(1, 5))]
        out["sum"].append([vals, sum(vals)])
    tt = make_teams(60, {"AWS": 0.6, "A10": 0.4}, seed=1)
    out["makeTeams"] = {"n": 60, "probs": [["AWS", 0.6], ["A10", 0.4]], "seed": 1,
                        "teams": [sorted(t) for t in tt]}
    return out


def capacity_cases():
    rng = random.Random(55)
    out = []
    for i in range(40):
        k = rng.randint(1, 4)
        sponsors = SPONSORS[:k]
        T = rng.randint(30, 70)
        probs = {s: round(rng.uniform(0.1, 0.8), 3) for s in sponsors}
        kw = {s: rng.randint(0, 4) for s in sponsors}
        kw["none"] = rng.randint(4, 14)
        tt = make_teams(T, probs, seed=i)
        judges = roster(**kw)
        n_slots = -(-2 * T // max(len(judges) // 2, 1))
        out.append({"teamTracks": [sorted(t) for t in tt], "judges": judges, "nSlots": n_slots,
                    "rows": coverage_capacity(judges, tt, n_slots)})
    return out


def regression():
    judges = roster(AWS=4, A10=3, none=9)
    explicit = [{"AWS", "A10"}] * 12 + [{"AWS"}] * 24 + [{"A10"}] * 12 + [set()] * 12
    configs = {
        "explicit-counts": [set(t) for t in explicit],
        "make-teams-seed-1": make_teams(60, {"AWS": 0.6, "A10": 0.4}, seed=1),
    }
    out = {}
    for name, tt in configs.items():
        r = solve(tt, judges, seed=0, verbose=False)
        out[name] = {
            "teamTracks": [sorted(t) for t in tt],
            "judges": judges,
            "full": r["full"], "seats": r["seats"], "wanted": r["wanted"],
            "nSlots": r["n_slots"], "minGap": min(r["gaps"]),
            "degree": [min(r["degree"]), max(r["degree"])],
            "winner": r["winner"], "valid": not r["errs"],
        }
    return out


def main():
    runs = []
    for hs in HASH_SEEDS:
        env = dict(os.environ, PYTHONHASHSEED=hs)
        done = subprocess.run([sys.executable, __file__, "--worker"], env=env,
                              capture_output=True, text=True, check=True)
        runs.append(json.loads(done.stdout))

    def agreed(section):
        keep, dropped = {}, []
        for key, value in runs[0][section].items():
            if all(r[section][key] == value for r in runs[1:]):
                keep[key] = value
            else:
                dropped.append(key)
        return keep, dropped

    track, track_dropped = agreed("track")
    plain, plain_dropped = agreed("plain")
    goldens = {
        "generatedBy": "tests/scheduler/make_goldens.py from scheduler/*.py",
        "python": sys.version.split()[0],
        "numerics": numerics(),
        "track": track,
        "plain": plain,
        "regression": regression(),
        "capacity": capacity_cases(),
        "hashSeedDependent": track_dropped + plain_dropped,
    }
    path = os.path.join(HERE, "goldens.json")
    with open(path, "w") as f:
        json.dump(goldens, f, separators=(",", ":"))
        f.write("\n")
    invalid_plain = [k for k, v in plain.items() if v["errs"]]
    print(f"wrote {path}: {len(track)} track-aware scenarios "
          f"({len(track_dropped)} hash-seed dependent, dropped), {len(plain)} unconstrained "
          f"({len(plain_dropped)} dropped); Python-invalid unconstrained cases: {invalid_plain}")


if __name__ == "__main__":
    worker() if "--worker" in sys.argv else main()
