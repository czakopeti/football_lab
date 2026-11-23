# Football Lab

Football tools built on the [PL X-ray](https://czakopeti.github.io/soccer_stats/) model, kept in their own repository so the PL X-ray site is never touched.

1. **Season Simulator** (live): every remaining match of the Premier League, La Liga, Bundesliga, Serie A and Ligue 1 played 10,000 times in the browser; fix any result and watch title, top-four and relegation chances move.
2. Prediction game (planned): beat the model and your friends, week by week.
3. FPL helper (planned): best transfers, captain and line-up for any Fantasy Premier League team.

## How it updates
`.github/workflows/weekly.yml` runs on Tuesday, Wednesday and Friday after the PL X-ray build (and on demand). It checks out `czakopeti/soccer_stats` read-only, takes the current tables and the model's expected goals for every remaining match (`scripts/build.py`), and publishes `site/` to GitHub Pages. The simulation itself runs in the visitor's browser (`web/sim.js`).
