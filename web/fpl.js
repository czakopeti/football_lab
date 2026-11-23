(() => {
/* FPL Helper: expected points for the squad of any Fantasy Premier League team, the best transfers,
   captain and line-up. Expected points come from fpl.json (built weekly); the squad, bank and the
   players' live prices and fitness from the FPL API through the Football Lab server. */
const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } } };
const POS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const LIMITS = { GKP: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] };
let API = "", X = null, F = null;
const S = { id: ls.get("lab-fpl-id") || "", ft: 1, err: "", busy: false };

// Expected points for one player, adjusted for live fitness news.
function xp(p, live) {
  const base = (X.byId[p] && X.byId[p].xp) || [0, 0, 0];
  const l = live[p];
  let f = 1;
  if (l) { if (["i", "s", "u", "n"].includes(l.status)) f = 0; else if (l.chance != null) f = l.chance / 100; }
  return base.map((v) => v * f);
}
const score = (v) => v[0] + 0.6 * (v[1] + v[2]); // this gameweek counts most; the next two a little less

function bestXI(squad, k) {
  // squad: [{id, pos, x:[3]}]; k: which gameweek (0..2). Captain counts twice.
  const by = { GKP: [], DEF: [], MID: [], FWD: [] };
  squad.forEach((p) => by[p.pos].push(p));
  Object.values(by).forEach((a) => a.sort((x, y) => y.x[k] - x.x[k]));
  let best = null;
  for (let d = 3; d <= 5; d++) for (let m = 2; m <= 5; m++) {
    const f = 10 - d - m; if (f < 1 || f > 3) continue;
    if (by.DEF.length < d || by.MID.length < m || by.FWD.length < f || !by.GKP.length) continue;
    const xi = [by.GKP[0], ...by.DEF.slice(0, d), ...by.MID.slice(0, m), ...by.FWD.slice(0, f)];
    const cap = xi.reduce((a, b) => (b.x[k] > a.x[k] ? b : a));
    const tot = xi.reduce((a, b) => a + b.x[k], 0) + cap.x[k];
    if (!best || tot > best.tot) best = { tot, xi, cap, form: `${d}-${m}-${f}` };
  }
  return best;
}
const total = (sq) => [0, 1, 2].reduce((a, k) => a + (k ? 0.6 : 1) * bestXI(sq, k).tot, 0);

function transfers(squad, bank, live, n) {
  const clubCount = (sq) => sq.reduce((m, p) => ((m[p.team] = (m[p.team] || 0) + 1), m), {});
  const pool = {};
  for (const p of X.players) {
    const l = live[p.id]; if (!l) continue;
    if (squad.some((s) => s.id === p.id)) continue;
    const x = xp(p.id, live);
    (pool[p.pos] = pool[p.pos] || []).push({ id: p.id, name: p.name, team: p.team, pos: p.pos, cost: l.cost, x, opp: p.opp });
  }
  Object.values(pool).forEach((a) => a.sort((u, v) => score(v.x) - score(u.x)).splice(15));
  const base = total(squad);
  const one = [];
  for (const out of squad) for (const inn of pool[out.pos] || []) {
    if (inn.cost > out.sell + bank + 1e-9) continue;
    const sq = squad.map((p) => (p.id === out.id ? inn : p));
    if (Math.max(...Object.values(clubCount(sq))) > 3) continue;
    one.push({ moves: [[out, inn]], gain: total(sq) - base, bank: bank + out.sell - inn.cost, sq });
  }
  one.sort((a, b) => b.gain - a.gain);
  let two = null;
  if (n >= 1) {
    for (const a of one.slice(0, 12)) {
      for (const out of a.sq) {
        if (a.moves[0][1].id === out.id) continue;
        for (const inn of pool[out.pos] || []) {
          if (a.sq.some((p) => p.id === inn.id) || inn.cost > (out.sell ?? out.cost) + a.bank + 1e-9) continue;
          const sq = a.sq.map((p) => (p.id === out.id ? inn : p));
          if (Math.max(...Object.values(clubCount(sq))) > 3) continue;
          const g = total(sq) - base;
          if (!two || g > two.gain) two = { moves: [...a.moves, [out, inn]], gain: g };
        }
      }
    }
  }
  return { one: one.slice(0, 5), two };
}

function render() {
  const head = `<span class="kicker">Football Lab · Fantasy Premier League</span><h1>FPL Helper</h1>
  <p class="note">Enter your FPL team ID and get expected points for your squad over the next three gameweeks, the best transfers, your line-up and captain. Free, nothing to sign up for.</p>
  <div class="panel"><div class="row"><input type="text" id="tid" inputmode="numeric" placeholder="Team ID, e.g. 1234567" value="${esc(S.id)}" style="width:200px">
    <label class="note">Free transfers <select id="ft">${[1, 2, 3, 4, 5].map((n) => `<option ${n === S.ft ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <button class="btn primary" id="go">${S.busy ? "Loading…" : "Analyse my team"}</button></div>
    <p class="note">Where is my team ID? On the FPL website open <b>Points</b>: it is the number in the address, after <span class="mono">/entry/</span>.</p>
    ${S.err ? `<div class="msg err">${esc(S.err)}</div>` : ""}</div>`;
  if (!F) { app.innerHTML = head; return; }
  const live = Object.fromEntries(F.players.map((p) => [p.id, p]));
  const squad = F.team.picks.map((p) => {
    const info = X.byId[p.id] || {}; const l = live[p.id] || {};
    return { id: p.id, name: l.name || info.name || "?", team: info.team || "?", pos: POS[l.pos] || info.pos, cost: l.cost, sell: p.selling ?? l.cost, x: xp(p.id, live), opp: info.opp || ["", "", ""], news: l.news, status: l.status };
  });
  const b = bestXI(squad, 0);
  const T = transfers(squad, F.team.bank, live, S.ft);
  const free = S.ft;
  const mv = (m) => m.map(([o, i]) => `<b>${esc(o.name)}</b> → <b>${esc(i.name)}</b> <span class="note">(${esc(i.team)}, £${i.cost.toFixed(1)}m)</span>`).join("<br>");
  const twoHit = T.two ? T.two.gain - (free >= 2 ? 0 : 4) : null;
  const rec = (() => {
    if (!T.one.length || T.one[0].gain < 0.5) return `Save your transfer: no move adds even half a point.`;
    if (T.two && twoHit > T.one[0].gain + 0.5) return `Make two transfers${free >= 2 ? "" : " (−4 points)"}: about <b>+${twoHit.toFixed(1)}</b> expected points after the hit.`;
    return `Make the top single transfer: about <b>+${T.one[0].gain.toFixed(1)}</b> expected points.`;
  })();
  const bench = squad.filter((p) => !b.xi.includes(p)).sort((x, y) => (x.pos === "GKP") - (y.pos === "GKP") || y.x[0] - x.x[0]);
  app.innerHTML = head + `
  <div class="panel"><b>${esc(F.team.name)}</b> <span class="note">· ${esc(F.team.manager)} · bank £${F.team.bank.toFixed(1)}m${F.team.chip ? ` · chip: ${esc(F.team.chip)}` : ""}</span>
    <p style="margin:10px 0 4px">${rec}</p>
    <div class="tw"><table><thead><tr><th class="l">Best single transfers</th><th>Gain</th></tr></thead><tbody>
    ${T.one.map((t) => `<tr><td class="l">${mv(t.moves)}</td><td class="mono">+${t.gain.toFixed(1)}</td></tr>`).join("") || `<tr><td class="l" colspan="2">None that fit your budget.</td></tr>`}
    ${T.two ? `<tr><td class="l"><span class="note">Best pair:</span><br>${mv(T.two.moves)}</td><td class="mono">+${T.two.gain.toFixed(1)}${free >= 2 ? "" : `<br><span class="note">−4 hit: ${twoHit >= 0 ? "+" : ""}${twoHit.toFixed(1)}</span>`}</td></tr>` : ""}
    </tbody></table></div>
    <p class="note">Gain: extra expected points from your best line-up, this gameweek plus 0.6 × each of the next two. Prices are current FPL prices; your selling price can be a little lower.</p></div>
  <div class="panel"><b>Line-up for gameweek ${X.gws[0]}</b> <span class="note">· ${b.form} · about ${b.tot.toFixed(1)} points with the captain</span>
    <div class="tw"><table><thead><tr><th class="l">Player</th><th class="l">Next</th>${X.gws.map((g) => `<th>GW${g}</th>`).join("")}<th></th></tr></thead><tbody>
    ${[...b.xi, ...bench].map((p, i) => `<tr${i === 11 ? ' style="border-top:2px solid var(--line)"' : ""}><td class="l"><b>${esc(p.name)}</b> <span class="note">${esc(p.pos)} · ${esc(p.team)}</span>${p === b.cap ? ' <span class="pill ok">C</span>' : ""}${i >= 11 ? ' <span class="pill">bench</span>' : ""}${p.status && p.status !== "a" ? ` <span class="pill no" title="${esc(p.news || "")}">${esc(p.news ? p.news.slice(0, 40) : "doubtful")}</span>` : ""}</td>
      <td class="l note">${esc(p.opp[0])}</td>${p.x.map((v) => `<td class="mono">${v.toFixed(1)}</td>`).join("")}<td></td></tr>`).join("")}
    </tbody></table></div>
    <p class="note">Expected points: minutes, share of the club's expected goals and assists, clean-sheet chance, defensive contributions, bonus and saves from the last seven gameweeks (player data to gameweek ${X.data_to_gw}), against each opponent's expected goals from our model. A player flagged doubtful counts at his chance of playing; injured or suspended counts zero.</p></div>`;
}

async function analyse() {
  S.err = ""; S.id = (document.getElementById("tid").value || "").trim(); S.ft = +document.getElementById("ft").value;
  if (!/^\d+$/.test(S.id)) { S.err = "A team ID is a number."; return render(); }
  ls.set("lab-fpl-id", S.id);
  S.busy = true; render();
  try { const r = await fetch(`${API}/api/fpl/${S.id}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || "FPL did not answer"); F = j; }
  catch (e) { S.err = /404/.test(e.message) ? "No FPL team with that ID." : `Could not load the team: ${e.message}`; F = null; }
  S.busy = false; render();
}
app.addEventListener("click", (e) => { if (e.target.id === "go") analyse(); });
app.addEventListener("keydown", (e) => { if (e.target.id === "tid" && e.key === "Enter") analyse(); });
app.addEventListener("change", (e) => { if (e.target.id === "ft") { S.ft = +e.target.value; if (F) render(); } });

Promise.all([fetch("fpl.json").then((r) => r.json()), fetch("api.json").then((r) => r.json()).catch(() => ({}))]).then(([x, a]) => {
  X = x; X.byId = Object.fromEntries(x.players.map((p) => [p.id, p])); API = (a && a.api) || "";
  if (!API) { app.innerHTML = `<span class="kicker">Football Lab · Fantasy Premier League</span><h1>FPL Helper</h1><p class="note">Opens in a few days. Come back soon.</p>`; return; }
  render();
  if (S.id) analyse();
}).catch(() => { app.innerHTML = `<p class="note" style="padding:40px 0">The data could not be loaded. Try again in a minute.</p>`; });
window.__fpl = { S };
})();
