(() => {
/* Season simulator: every remaining match played many times with the PL X-ray model's expected goals
   (home advantage included). You can fix any result and the whole season is played again. */
const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pc = (x) => (x >= 0.995 ? "100%" : x > 0 && x < 0.005 ? "<1%" : Math.round(x * 100) + "%");
const S = { lg: 0, round: null, fixed: {} };
try { const s = JSON.parse(localStorage.getItem("lab-sim") || "{}"); Object.assign(S, { lg: s.lg || 0, fixed: s.fixed || {} }); } catch (e) { /* storage blocked */ }
const save = () => { try { localStorage.setItem("lab-sim", JSON.stringify({ lg: S.lg, fixed: S.fixed })); } catch (e) { /* storage blocked */ } };
let D = null;
const base = {}; // league code -> baseline result (no fixed results)

// Random numbers: a small fast generator, seeded so the same inputs give the same table.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function poisson(l, u) { let p = Math.exp(-l), k = 0, c = p; while (u > c && k < 15) { k++; p *= l / k; c += p; } return k; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// Chances of home win, draw, away win from the two expected-goal numbers.
function hda(lh, la) {
  const ph = [], pa = []; let a = Math.exp(-lh), b = Math.exp(-la);
  for (let k = 0; k <= 10; k++) { ph.push(a); pa.push(b); a *= lh / (k + 1); b *= la / (k + 1); }
  let w = 0, d = 0, l = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = ph[i] * pa[j]; if (i > j) w += p; else if (i === j) d += p; else l += p; }
  const t = w + d + l; return [w / t, d / t, l / t];
}
const key = (m) => m.h + "|" + m.a;

function simulate(L, fixed) {
  const T = L.teams, n = T.length, idx = Object.fromEntries(T.map((t, i) => [t, i]));
  const N = D.sims, r = rng(20261123 + L.code.charCodeAt(0));
  const posCount = T.map(() => new Float64Array(n)), ptsSum = new Float64Array(n);
  const basePts = T.map((t) => L.table[t].pts), baseGd = T.map((t) => L.table[t].gf - L.table[t].ga), baseGf = T.map((t) => L.table[t].gf);
  const games = L.rest.map((m) => ({ h: idx[m.h], a: idx[m.a], lh: m.lh, la: m.la, f: fixed[key(m)] || null }));
  const pts = new Float64Array(n), gd = new Float64Array(n), gf = new Float64Array(n), s = new Float64Array(n), ord = T.map((_, i) => i), tie = new Float64Array(n);
  for (let it = 0; it < N; it++) {
    for (let i = 0; i < n; i++) { pts[i] = basePts[i]; gd[i] = baseGd[i]; gf[i] = baseGf[i]; s[i] = Math.exp(D.noise * gauss(r)); tie[i] = r(); }
    for (const g of games) {
      let hs, as;
      const lh = g.lh * s[g.h] / s[g.a], la = g.la * s[g.a] / s[g.h];
      if (g.f) {
        // A fixed result: draw scores until they match it, so goal difference stays realistic.
        for (let k = 0; k < 30; k++) { hs = poisson(lh, r()); as = poisson(la, r()); if ((g.f === "H" && hs > as) || (g.f === "D" && hs === as) || (g.f === "A" && hs < as)) break; }
        if (!((g.f === "H" && hs > as) || (g.f === "D" && hs === as) || (g.f === "A" && hs < as))) { hs = g.f === "A" ? 0 : 1; as = g.f === "H" ? 0 : g.f === "D" ? 1 : 1; }
      } else { hs = poisson(lh, r()); as = poisson(la, r()); }
      gf[g.h] += hs; gf[g.a] += as; gd[g.h] += hs - as; gd[g.a] += as - hs;
      if (hs > as) pts[g.h] += 3; else if (hs < as) pts[g.a] += 3; else { pts[g.h] += 1; pts[g.a] += 1; }
    }
    ord.sort((x, y) => pts[y] - pts[x] || gd[y] - gd[x] || gf[y] - gf[x] || tie[y] - tie[x]);
    for (let p = 0; p < n; p++) posCount[ord[p]][p] += 1;
    for (let i = 0; i < n; i++) ptsSum[i] += pts[i];
  }
  return T.map((t, i) => {
    const dist = Array.from(posCount[i], (c) => c / N);
    const top = dist.slice(0, L.top).reduce((a, b) => a + b, 0), bot = dist.slice(n - L.bottom).reduce((a, b) => a + b, 0);
    return { team: t, exp: ptsSum[i] / N, dist, title: dist[0], top, bot };
  });
}

function heat(x, kind) {
  if (x < 0.005) return "";
  const a = Math.min(1, 0.12 + x * 0.88).toFixed(2);
  return kind === "bad" ? `background:color-mix(in srgb, var(--bad) ${Math.round(a * 60)}%, transparent)` : `background:color-mix(in srgb, var(--accent) ${Math.round(a * 60)}%, transparent)`;
}
// Change against the model-only season, in percentage points; for relegation a rise is bad news.
function delta(now, was, bad) {
  if (was == null) return "";
  const d = Math.round((now - was) * 100);
  const good = bad ? d < 0 : d > 0;
  return d ? `<span class="d ${good ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>` : "";
}
function strip(dist, L) {
  const n = dist.length;
  return `<span class="strip" title="Chance of each finishing place, 1st on the left">${dist.map((p, k) => {
    const col = k < L.top ? "var(--accent)" : k >= n - L.bottom ? "var(--bad)" : "var(--sub)";
    return `<i style="width:${100 / n}%;background:${col};opacity:${p < 0.005 ? 0.06 : Math.min(1, 0.15 + p * 1.6)}"></i>`;
  }).join("")}</span>`;
}

function render(res) {
  const L = D.leagues[S.lg], fixed = S.fixed[L.code] || {};
  const B = base[L.code];
  const byTeam = Object.fromEntries((B || []).map((x) => [x.team, x]));
  const nFixed = Object.keys(fixed).length;
  const rows = [...res].sort((x, y) => y.exp - x.exp || L.table[y.team].pts - L.table[x.team].pts);
  const nowRank = [...L.teams].sort((x, y) => L.table[y].pts - L.table[x].pts || (L.table[y].gf - L.table[y].ga) - (L.table[x].gf - L.table[x].ga) || L.table[y].gf - L.table[x].gf);
  const rounds = [...new Set(L.rest.map((m) => m.r))].sort((a, b) => a - b);
  if (S.round == null || !rounds.includes(S.round)) S.round = rounds[0];
  const ms = L.rest.filter((m) => m.r === S.round).sort((a, b) => a.t.localeCompare(b.t));
  const when = (t) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  app.innerHTML = `
  <span class="kicker">Football Lab · ${esc(D.season)}</span>
  <h1>Season Simulator</h1>
  <p class="note">Every remaining match played ${D.sims.toLocaleString("en-GB")} times with our expected-goals model, home advantage included. Pick any result below and the whole season is played again. Updated ${esc(new Date(D.updated).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}.</p>
  <div class="tabs">${D.leagues.map((l, i) => `<button data-lg="${i}" class="${i === S.lg ? "on" : ""}">${esc(l.label)}</button>`).join("")}</div>
  <div class="panel"><div class="tw" id="tbl"><table><thead><tr><th class="l">Club</th><th class="hide-s">Now</th><th>Pts</th><th>Proj. pts</th><th>Title</th><th>${esc(L.top_label)}</th><th>${esc(L.bottom_label)}</th><th class="l hide-s">Finishing place</th></tr></thead><tbody>
  ${rows.map((x) => {
    const t = L.table[x.team], b = nFixed ? byTeam[x.team] : null;
    const zone = x.top >= 0.5 ? "zone-top" : x.bot >= 0.5 ? "zone-bot" : "";
    return `<tr class="${zone}"><td class="l"><b>${esc(x.team)}</b></td><td class="mono hide-s">${nowRank.indexOf(x.team) + 1}.</td><td class="mono">${t.pts}</td><td class="mono">${x.exp.toFixed(1)}${b ? delta(x.exp / 100, b.exp / 100) : ""}</td>
      <td><span class="pct" style="${heat(x.title)}">${pc(x.title)}</span>${b ? delta(x.title, b.title) : ""}</td>
      <td><span class="pct" style="${heat(x.top)}">${pc(x.top)}</span>${b ? delta(x.top, b.top) : ""}</td>
      <td><span class="pct" style="${heat(x.bot, "bad")}">${pc(x.bot)}</span>${b ? delta(x.bot, b.bot, true) : ""}</td>
      <td class="l hide-s">${strip(x.dist, L)}</td></tr>`;
  }).join("")}
  </tbody></table></div>
  <div class="legend"><span><i style="background:var(--accent)"></i>${esc(L.top_label)}</span><span><i style="background:var(--bad)"></i>${esc(L.bottom_label)}</span><span>Sorted by projected points. Ties on points split by goal difference, then goals scored.</span></div></div>

  <div class="panel">
    <div class="row" style="justify-content:space-between"><div class="row"><b>What if…</b>
      <select id="round">${rounds.map((r) => `<option value="${r}" ${r === S.round ? "selected" : ""}>${esc(L.round_name)} ${r}</option>`).join("")}</select></div>
      ${nFixed ? `<button class="btn" id="reset">Clear ${nFixed} result${nFixed > 1 ? "s" : ""}</button>` : ""}</div>
    <p class="note">Choose a result to fix it; the arrows in the table show how far each chance moves, in percentage points. Model shows our chances for that match.</p>
    <div class="matches">${ms.map((m) => {
      const p = hda(m.lh, m.la), f = fixed[key(m)];
      const b = (v, label, sub) => `<button data-k="${esc(key(m))}" data-v="${v}" class="${(f || "") === v ? "on" : ""}">${label}<small>${sub}</small></button>`;
      return `<div class="m"><div class="when">${esc(when(m.t))}</div><div class="teams"><span>${esc(m.h)}</span><span>${esc(m.a)}</span></div>
        <div class="seg">${b("", "Model", m.lh.toFixed(1) + "–" + m.la.toFixed(1))}${b("H", "Home", pc(p[0]))}${b("D", "Draw", pc(p[1]))}${b("A", "Away", pc(p[2]))}</div></div>`;
    }).join("")}</div>
  </div>
  <p class="note">The model: each club's attack and defence from expected goals (shot quality), steadied by last season, with this season's home advantage; the same ratings as the <a href="https://czakopeti.github.io/soccer_stats/" style="color:var(--ink)">PL X-ray</a> fair odds. Every simulated season also nudges each club's strength up or down a little at random, because no rating is certain. It knows nothing about injuries, transfers or a new manager.</p>`;
}

function run() {
  const L = D.leagues[S.lg];
  app.classList.add("busy");
  setTimeout(() => {
    if (!base[L.code]) base[L.code] = simulate(L, {});
    const fixed = S.fixed[L.code] || {};
    const res = Object.keys(fixed).length ? simulate(L, fixed) : base[L.code];
    render(res);
    app.classList.remove("busy");
  }, 10);
}

app.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.lg != null) { S.lg = +t.dataset.lg; S.round = null; save(); run(); return; }
  if (t.id === "reset") { S.fixed[D.leagues[S.lg].code] = {}; save(); run(); return; }
  if (t.dataset.k) {
    const code = D.leagues[S.lg].code, f = (S.fixed[code] = S.fixed[code] || {});
    if (t.dataset.v) f[t.dataset.k] = t.dataset.v; else delete f[t.dataset.k];
    save(); run();
  }
});
app.addEventListener("change", (e) => { if (e.target.id === "round") { S.round = +e.target.value; run(); } });

fetch("data.json").then((r) => r.json()).then((d) => {
  D = d;
  // Drop fixed results for matches already played.
  for (const L of D.leagues) { const live = new Set(L.rest.map(key)); const f = S.fixed[L.code] || {}; for (const k of Object.keys(f)) if (!live.has(k)) delete f[k]; }
  if (S.lg >= D.leagues.length) S.lg = 0;
  run();
}).catch(() => { app.innerHTML = `<p class="note" style="padding:40px 0">The simulator data could not be loaded. Try again in a minute.</p>`; });
window.__sim = { S, run, simulate };
})();
