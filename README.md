# Football Lab

Football tools built on the [PL X-ray](https://czakopeti.github.io/soccer_stats/) model, kept in their own repository so the PL X-ray site is never touched.

1. **Season Simulator** (live): every remaining match of the Premier League, La Liga, Bundesliga, Serie A and Ligue 1 played 10,000 times in the browser; fix any result and watch title, top-four and relegation chances move.
2. **Predictor** (`predict.html`): predict every Premier League score (3 points exact, 1 right result), against everyone, private leagues and the model itself. Picks lock at kickoff.
3. **FPL Helper** (`fpl.html`): enter an FPL team ID for expected points over the next three gameweeks, the best one or two transfers, line-up and captain.

The Predictor and the FPL Helper use a small Cloudflare Worker (`worker/`, free plan) with a D1 database for players, picks and leagues, and as a relay for public FPL data. `.github/workflows/worker.yml` deploys it once the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets exist, then writes its address to `config.json`.

## How it updates
`.github/workflows/weekly.yml` runs on Tuesday, Wednesday and Friday after the PL X-ray build (and on demand). It checks out `czakopeti/soccer_stats` and `oladeeayo/pl-catalogue` read-only, adds results played since then from ESPN's public scoreboard (`scripts/live.py`), takes the current tables and the model's expected goals for every remaining match (`scripts/build.py`), and publishes `site/` to GitHub Pages. The simulation itself runs in the visitor's browser (`web/sim.js`).
