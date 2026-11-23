"""Build the season-simulator data from the PL X-ray repository (read only).

Usage: python scripts/build.py <path to a soccer_stats checkout> <output dir>
Nothing in soccer_stats is changed: its data files and model code are only read.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

up = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(up))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from plx.strength import predict, ratings  # noqa: E402  (soccer_stats model code, read only)

ROOT = Path(__file__).resolve().parents[1]
cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


def table(played: list[tuple]) -> dict:
    t: dict[str, dict] = {}
    for h, a, hs, as_ in played:
        for team, gf, ga in ((h, hs, as_), (a, as_, hs)):
            r = t.setdefault(team, {"p": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0, "pts": 0})
            r["p"] += 1; r["gf"] += gf; r["ga"] += ga
            if gf > ga: r["w"] += 1; r["pts"] += 3
            elif gf == ga: r["d"] += 1; r["pts"] += 1
            else: r["l"] += 1
    return t


def premier_league() -> dict:
    d = json.loads((up / "data" / "pl.json").read_text(encoding="utf-8"))
    c, der = d["cfg"], d["derived"]
    hg = {"home_factor": der["home_factor"], "away_factor": der["away_factor"]}
    teams = list(d["short"])
    R = ratings(d["matches"], teams, d["prior"], int(d["gw"]), c["ratings"], c["ratings"]["goal_level_prior"], hg)
    played = [(m["h"], m["a"], int(m["hs"]), int(m["as"])) for m in d["matches"]]
    done = {(m["h"], m["a"]) for m in d["matches"]}
    results = [{"r": int(m["gw"]), "h": m["h"], "a": m["a"], "hs": int(m["hs"]), "as": int(m["as"])} for m in d["matches"]]
    rest = []
    for f in d["fx"]:
        if (f[1], f[2]) in done:
            continue
        q = predict(f[1], f[2], R, c["prediction"]["dixon_coles_rho"], c["prediction"]["max_goals"])
        rest.append({"r": int(f[0]), "h": f[1], "a": f[2], "t": f[3], "lh": round(q["lh"], 3), "la": round(q["la"], 3)})
    return {"teams": sorted(teams), "played": played, "rest": rest, "results": results, "round_name": "Gameweek"}


def other(L: dict) -> dict:
    played, rest = [], []
    for rd in L["rounds"]:
        for m in rd["matches"]:
            if m.get("hs") is not None:
                played.append((m["h"], m["a"], int(m["hs"]), int(m["as"])))
            elif m.get("hlh") is not None:
                t = m["dt"].replace(" ", "T")[:16] + ":00Z"
                rest.append({"r": int(rd["r"]), "h": m["h"], "a": m["a"], "t": t, "lh": round(m["hlh"], 3), "la": round(m["hla"], 3)})
    teams = sorted({x for p in played for x in p[:2]} | {x for m in rest for x in (m["h"], m["a"])})
    return {"teams": teams, "played": played, "rest": rest, "round_name": "Round"}


leagues = []
srcs = {"Premier League": premier_league}
lj = json.loads((up / "data" / "leagues.json").read_text(encoding="utf-8"))
by_label = {L["label"]: L for L in lj["leagues"]}
for spec in cfg["leagues"]:
    data = premier_league() if spec["label"] == "Premier League" else other(by_label[spec["label"]])
    data["table"] = table(data.pop("played"))
    for t in data["teams"]:
        data["table"].setdefault(t, {"p": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0, "pts": 0})
    leagues.append({**spec, **data})

# Results played since the PL X-ray update (it refreshes on Tuesday, Wednesday and Friday).
import live  # noqa: E402

log: list[str] = []
for L in leagues:
    try:
        live.apply(L, L["espn"], cfg["user_agent"], log)
    except Exception as exc:  # noqa: BLE001 - without live results the model-day table still stands
        log.append(f"{L['label']}: live results not added ({exc})")
print("\n".join(log))

# Prediction game (Premier League) and FPL helper data.
import game  # noqa: E402

pl = next(L for L in leagues if L["label"] == "Premier League")
prev = {}
try:
    prev = {x["id"]: x["model"] for x in json.loads((ROOT / "state" / "model_picks.json").read_text())}
except (FileNotFoundError, ValueError):
    pass
gj = game.build(pl)
# Remember the model's pick for every fixture, so finished matches keep the pick it made before kickoff.
for f in gj["fixtures"]:
    prev[f["id"]] = f["model"]
for r in gj["results"]:
    if r["id"] in prev:
        r["model"] = prev[r["id"]]
(ROOT / "state").mkdir(exist_ok=True)
(ROOT / "state" / "model_picks.json").write_text(json.dumps([{"id": k, "model": v} for k, v in sorted(prev.items())], indent=0), encoding="utf-8")
pl.pop("results", None)

# FPL helper: expected points per player for the next three gameweeks (needs a pl-catalogue checkout).
import fpl  # noqa: E402

cat = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else None
if cat and cat.exists():
    try:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
        # The next FPL gameweek is the first one that has not kicked off yet.
        first = {}
        for f in gj["fixtures"] + gj["results"]:
            if "t" in f:
                first[f["r"]] = min(first.get(f["r"], f["t"]), f["t"])
        started = {x["r"] for x in gj["results"]}
        upcoming = [r for r, t in first.items() if t[:16] > now and r not in started]
        next_gw = min(upcoming) if upcoming else min(f["r"] for f in gj["fixtures"])
        fj = fpl.build(cat, lj["season"].replace("/", "-"), gj["fixtures"], next_gw)
        (out_fpl := out / "fpl.json")
        out.mkdir(parents=True, exist_ok=True)
        out_fpl.write_text(json.dumps({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **fj}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print("fpl players", len(fj["players"]), "gws", fj["gws"], "data to gw", fj["data_to_gw"])
    except Exception as exc:  # noqa: BLE001 - the simulator and the game still publish
        print("FPL data not built:", exc)
for L in leagues:
    L.pop("results", None)

payload = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "season": lj["season"],
           "noise": cfg["strength_noise"], "sims": cfg["sims"], "leagues": leagues}
out.mkdir(parents=True, exist_ok=True)
(out / "api.json").write_text(json.dumps({"api": cfg.get("api", "")}), encoding="utf-8")
(out / "game.json").write_text(json.dumps({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **gj}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
(out / "data.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
for f in (ROOT / "web").iterdir():
    shutil.copy(f, out / f.name)
print({L["label"]: (len(L["teams"]), len(L["rest"])) for L in leagues})
