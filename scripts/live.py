"""Results played since the last PL X-ray model update, from ESPN's public scoreboard.

The model's expected goals for each remaining match stay as they are; only finished matches move
from "to play" into the table, so the simulator is up to date a few hours after the final whistle.
"""
from __future__ import annotations

import json
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher

URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates={day}"
DROP = {"fc", "afc", "cf", "ac", "as", "ss", "sc", "club", "de", "calcio", "1.", "fsv", "vfl", "vfb", "tsg", "rc", "ogc", "stade", "sv", "the", "and", "&", "cd", "ud", "rcd", "ca", "real", "1899", "05", "04"}
# Short names the two sources spell differently.
SAME = {"manchester": "man", "united": "utd", "nottingham": "nottm", "tottenham hotspur": "spurs", "tottenham": "spurs",
        "wolverhampton wanderers": "wolves", "internazionale": "inter", "paris saint germain": "psg", "paris sg": "psg",
        "borussia monchengladbach": "gladbach", "borussia m.gladbach": "gladbach", "monchengladbach": "gladbach",
        "athletic bilbao": "athletic", "rasenballsport leipzig": "rb leipzig", "brighton & hove albion": "brighton", "hove albion": ""}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("'", "").replace("-", " ")
    for k in sorted(SAME, key=len, reverse=True):
        s = s.replace(k, SAME[k])
    words = [w for w in s.split() if w not in DROP]
    return " ".join(words) or s


def sim(a: str, b: str) -> float:
    x, y = norm(a), norm(b)
    if not x or not y:
        return 0.0
    if x in y or y in x:
        return 1.0
    return SequenceMatcher(None, x, y).ratio()


def fetch(slug: str, start: date, end: date, ua: str) -> list[dict]:
    events = []
    d = start
    while d <= end:
        req = urllib.request.Request(URL.format(slug=slug, day=d.strftime("%Y%m%d")), headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=40) as r:
            events += json.loads(r.read()).get("events", [])
        d += timedelta(days=1)
    out = []
    for e in events:
        c = (e.get("competitions") or [{}])[0]
        if not (c.get("status") or {}).get("type", {}).get("completed"):
            continue
        side = {t["homeAway"]: t for t in c.get("competitors", [])}
        if "home" not in side or "away" not in side:
            continue
        names = lambda t: [t["team"].get(k) for k in ("displayName", "shortDisplayName", "name", "location") if t["team"].get(k)]  # noqa: E731
        out.append({"t": e["date"], "h": names(side["home"]), "a": names(side["away"]),
                    "hs": int(side["home"]["score"]), "as": int(side["away"]["score"])})
    return out


def apply(league: dict, slug: str, ua: str, log: list) -> None:
    """Move finished matches from league["rest"] into league["table"]; counts them in league["live"]."""
    rest = league["rest"]
    if not rest:
        return
    today = datetime.now(timezone.utc).date()
    # The PL X-ray data is at most a few days old; ten days back covers any gap.
    first = max(min(datetime.fromisoformat(m["t"].replace("Z", "+00:00")).date() for m in rest) - timedelta(days=3), today - timedelta(days=10))
    if first > today:
        return
    events = fetch(slug, first, today, ua)
    taken = set()
    played = []
    for e in events:
        et = datetime.fromisoformat(e["t"].replace("Z", "+00:00")).date()
        best, score = None, 0.0
        for i, m in enumerate(rest):
            if i in taken:
                continue
            mt = datetime.fromisoformat(m["t"].replace("Z", "+00:00")).date()
            if abs((mt - et).days) > 3:
                continue
            sh, sa = max(sim(n, m["h"]) for n in e["h"]), max(sim(n, m["a"]) for n in e["a"])
            if min(sh, sa) < 0.7:
                continue
            if sh + sa > score:
                best, score = i, sh + sa
        if best is None:
            log.append(f"{league['label']}: no match for {e['h'][0]} v {e['a'][0]} ({e['t'][:10]})")
            continue
        taken.add(best)
        played.append((rest[best]["h"], rest[best]["a"], e["hs"], e["as"]))
    for h, a, hs, as_ in played:
        for team, gf, ga in ((h, hs, as_), (a, as_, hs)):
            r = league["table"][team]
            r["p"] += 1; r["gf"] += gf; r["ga"] += ga
            if gf > ga: r["w"] += 1; r["pts"] += 3
            elif gf == ga: r["d"] += 1; r["pts"] += 1
            else: r["l"] += 1
    league["rest"] = [m for i, m in enumerate(rest) if i not in taken]
    league["live"] = len(played)
    log.append(f"{league['label']}: {len(played)} results added from ESPN, {len(events)} finished events checked")
