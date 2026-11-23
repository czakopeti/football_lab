"""Prediction game data: Premier League fixtures with kickoff times, the model's own picks, and results.

The game server (worker/) reads this file to lock picks at kickoff and to score them.
"""
from __future__ import annotations

import math


def _pois(l: float, k: int) -> float:
    return math.exp(-l) * l ** k / math.factorial(k)


def model_pick(lh: float, la: float) -> tuple[int, int]:
    """The score with the most expected points under the game's scoring (3 exact, 1 right result)."""
    grid = {(i, j): _pois(lh, i) * _pois(la, j) for i in range(7) for j in range(7)}
    res = {"H": sum(p for (i, j), p in grid.items() if i > j), "D": sum(p for (i, j), p in grid.items() if i == j),
           "A": sum(p for (i, j), p in grid.items() if i < j)}
    best, ev = (1, 1), -1.0
    for (i, j), p in grid.items():
        if i > 4 or j > 4:
            continue
        r = "H" if i > j else "D" if i == j else "A"
        e = 3 * p + (res[r] - p)
        if e > ev:
            best, ev = (i, j), e
    return best


def build(pl: dict) -> dict:
    """pl: the simulator's Premier League entry, after live results were added."""
    fixtures = []
    for m in pl["rest"]:
        hs, as_ = model_pick(m["lh"], m["la"])
        fixtures.append({"id": f"{m['h']}|{m['a']}", "r": m["r"], "h": m["h"], "a": m["a"], "t": m["t"],
                         "lh": m["lh"], "la": m["la"], "model": [hs, as_]})
    results = [{"id": f"{x['h']}|{x['a']}", "r": x["r"], "h": x["h"], "a": x["a"], "hs": x["hs"], "as": x["as"],
                **({"model": x["model"]} if x.get("model") else {})} for x in pl["results"]]
    return {"league": "Premier League", "fixtures": fixtures, "results": results,
            "scoring": {"exact": 3, "result": 1}}
