"""FPL helper data: expected points for every Premier League player over the next three gameweeks.

Player rates (minutes, share of their club's expected goals and assists, defensive contributions,
bonus, saves) come from the last gameweeks in pl-catalogue; fixtures and each side's expected goals
from the same model as the simulator (home advantage included).
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

GOAL = {"GKP": 6, "DEF": 6, "MID": 5, "FWD": 4}
CS = {"GKP": 4, "DEF": 4, "MID": 1, "FWD": 0}


def build(catalogue: Path, season: str, fixtures: list[dict], next_gw: int, horizon: int = 3, recent: int = 7) -> dict:
    base = catalogue / "data" / season
    m = pd.read_csv(base / "gws" / "merged_gw.csv")
    p = pd.read_csv(base / "players.csv")
    last = int(m.gw.max())
    m = m[m.gw > last - recent].copy()
    m["w"] = np.where(m.gw > last - 3, 1.5, 1.0)  # the last three weigh a bit more
    club_xg = m.groupby(["team", "gw"]).expected_goals.sum()
    gws = list(range(next_gw, next_gw + horizon))
    by_team: dict[str, list] = {}
    for f in fixtures:
        if f["r"] in gws:
            by_team.setdefault(f["h"], []).append((f["r"], f["lh"], f["la"], f["a"], True))
            by_team.setdefault(f["a"], []).append((f["r"], f["la"], f["lh"], f["h"], False))
    players = []
    for pid, g in m.groupby("element"):
        pos, team = g.position.iloc[-1], g.team.iloc[-1]
        W = g.w.values
        mins = float((g.minutes * W).sum() / W.sum())
        played = (g.minutes > 0).values
        pplay = float((played * W).sum() / W.sum())
        p60 = float(((g.minutes >= 60).values * W).sum() / W.sum())
        txg = club_xg.reindex(list(zip(g.team, g.gw))).fillna(0).values
        denom = max(float((txg * W).sum()), 1e-6)
        sg = float((g.expected_goals.values * W).sum() / denom)
        sa = float((g.expected_assists.values * W).sum() / denom)
        thr = 10 if pos == "DEF" else 12
        dc = 0.0 if pos == "GKP" else float(((g.defensive_contribution.values >= thr) * played * W).sum() / max((played * W).sum(), 1e-6))
        bonus = float((g.bonus.values * W).sum() / W.sum())
        saves = float((g.saves.values * W).sum() / W.sum())
        xp, opp = [], []
        for gw in gws:
            pts, names = 0.0, []
            for (r, tx, ox, o, home) in by_team.get(team, []):
                if r != gw:
                    continue
                names.append(f"{o} ({'H' if home else 'A'})")
                pts += (pplay + p60 + tx * (sg * GOAL[pos] + sa * 3) * (mins / 90) + math.exp(-ox) * CS[pos] * p60
                        - ((ox / 2) * p60 if pos in ("GKP", "DEF") else 0) + 2 * dc * pplay + bonus + (saves / 3 if pos == "GKP" else 0))
            xp.append(round(pts, 2))
            opp.append(", ".join(names) or "no match")
        info = p[p.player_id == pid]
        players.append({"id": int(pid), "name": str(info.web_name.iloc[0]) if len(info) else str(g.name.iloc[-1]),
                        "team": team, "pos": pos, "price": float(info.price.iloc[0]) if len(info) else None,
                        "xp": xp, "opp": opp, "mins": round(mins)})
    return {"gws": gws, "data_to_gw": last, "players": players}
