# Scheduling algorithm (Phase 3)

Reference implementation in Python, validated before porting to TypeScript.

- `scheduler.py`  core: panel pairing, Koenig edge colouring, spacing repair
- `stage0v2.py`   track-aware judge pairing (searches panel compositions)
- `pipeline.py`   track-aware team assignment
- `pipeline2.py`  full pipeline entry point: `solve(team_tracks, judges)`

Validation: 800 schedules across 4 configs with zero invalid results;
150 randomised track-aware scenarios, zero invalid, 83ms median.

Port notes: keep it a pure module with no database calls, so the property
tests move across unchanged.
