(() => {
/* Premier League Predictor: predict scores, 3 points for the exact score, 1 for the right result.
   Picks lock at kickoff; the server (Cloudflare Worker) stores them and builds the leaderboards. */
const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (t) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } } };
let API = "", G = null, ME = null, BOARD = null;
const S = { round: null, view: "all", msg: "", err: "", draft: {} };

async function call(path, body) {
  const r = await fetch(API + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
  return j;
}
const token = () => ls.get("lab-token");
const pts = (p, r) => (p[0] === r[0] && p[1] === r[1] ? 3 : Math.sign(p[0] - p[1]) === Math.sign(r[0] - r[1]) ? 1 : 0);

async function loadMe() {
  if (!token()) { ME = null; return; }
  try { ME = await call(`/api/me?token=${encodeURIComponent(token())}`); } catch (e) { if (/Unknown player/.test(e.message)) { ls.del("lab-token"); ME = null; } else throw e; }
}
async function loadBoard() {
  const p = new URLSearchParams();
  if (S.view === "round") p.set("round", S.round);
  if (S.view.startsWith("L:")) p.set("league", S.view.slice(2));
  if (token()) p.set("token", token());
  BOARD = await call(`/api/board?${p}`);
}

function render() {
  const now = Date.now();
  const upcoming = G.fixtures.filter((f) => Date.parse(f.t) > now);
  const rounds = [...new Set([...G.results.map((r) => r.r), ...G.fixtures.map((f) => f.r)])].sort((a, b) => a - b);
  if (S.round == null) S.round = upcoming.length ? Math.min(...upcoming.map((f) => f.r)) : Math.max(...rounds);
  const fx = G.fixtures.filter((f) => f.r === S.round).sort((a, b) => a.t.localeCompare(b.t));
  const res = G.results.filter((r) => r.r === S.round);
  const mine = (ME && ME.picks) || {};
  const myPts = res.reduce((a, r) => a + (mine[r.id] ? pts(mine[r.id], [r.hs, r.as]) : 0), 0);
  const modelPts = res.reduce((a, r) => a + (r.model ? pts(r.model, [r.hs, r.as]) : 0), 0);
  const prob = (f) => { // home / draw / away chances from the model's expected goals
    const P = (l, k) => Math.exp(-l) * l ** k / [1, 1, 2, 6, 24, 120, 720, 5040, 40320][k];
    let w = 0, d = 0, l = 0; for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) { const p = P(f.lh, i) * P(f.la, j); if (i > j) w += p; else if (i === j) d += p; else l += p; }
    const t = w + d + l; return [w / t, d / t, l / t].map((x) => Math.round(x * 100) + "%");
  };
  app.innerHTML = `
  <span class="kicker">Football Lab · Premier League</span>
  <h1>Predictor</h1>
  <p class="note">Predict the score of every Premier League match: 3 points for the exact score, 1 for the right result. Picks lock at kickoff. You play against everyone else and against our model, which picks the score that should earn it the most points.</p>
  ${S.msg ? `<div class="msg">${esc(S.msg)}</div>` : ""}${S.err ? `<div class="msg err">${esc(S.err)}</div>` : ""}
  ${ME ? `<p class="note">Playing as <b>${esc(ME.name)}</b>.</p>` : `
  <div class="panel"><b>Join in</b><p class="note">Just a name, no email or password. Your picks are saved on this device; you can move them to another device with your player code.</p>
    <div class="row"><input type="text" id="name" maxlength="24" placeholder="Your name"><button class="btn primary" id="join">Start predicting</button></div>
    <details style="margin-top:8px"><summary class="note" style="cursor:pointer">Played before on another device?</summary><div class="row" style="margin-top:6px"><input type="text" id="code" placeholder="Player code"><button class="btn" id="restore">Restore</button></div></details></div>`}
  <div class="panel">
    <div class="row" style="justify-content:space-between"><div class="row"><b>Gameweek</b>
      <select id="round">${rounds.map((r) => `<option value="${r}" ${r === S.round ? "selected" : ""}>${r}</option>`).join("")}</select></div>
      ${res.length ? `<span class="note">This gameweek so far: you <b>${myPts}</b> · the model <b>${modelPts}</b></span>` : ""}</div>
    <div class="matches" style="margin-top:10px">
    ${fx.map((f) => {
      const p = S.draft[f.id] || mine[f.id] || ["", ""];
      const locked = Date.parse(f.t) <= now, pr = prob(f);
      return `<div class="m"><div class="when">${esc(when(f.t))}${locked ? " · locked" : ""}</div><div class="teams"><span>${esc(f.h)}</span><span>${esc(f.a)}</span></div>
        <div class="score"><input type="number" min="0" max="15" inputmode="numeric" data-id="${esc(f.id)}" data-s="0" value="${p[0]}" ${locked || !ME ? "disabled" : ""}><span class="vs">–</span><input type="number" min="0" max="15" inputmode="numeric" data-id="${esc(f.id)}" data-s="1" value="${p[1]}" ${locked || !ME ? "disabled" : ""}></div>
        <p class="note" style="text-align:center">Model chances: home ${pr[0]} · draw ${pr[1]} · away ${pr[2]}${locked ? ` · model pick ${f.model[0]}–${f.model[1]}` : ""}</p></div>`;
    }).join("")}
    ${res.map((r) => {
      const p = mine[r.id];
      const k = p ? pts(p, [r.hs, r.as]) : null;
      return `<div class="m"><div class="when">Full time</div><div class="teams"><span>${esc(r.h)}</span><span>${esc(r.a)}</span></div>
        <div class="score"><b class="mono" style="font-size:20px">${r.hs}–${r.as}</b></div>
        <p class="note" style="text-align:center">You ${p ? `${p[0]}–${p[1]} <span class="pill ${k ? "ok" : "no"}">+${k}</span>` : "no pick"} · model ${r.model ? `${r.model[0]}–${r.model[1]} <span class="pill ${pts(r.model, [r.hs, r.as]) ? "ok" : "no"}">+${pts(r.model, [r.hs, r.as])}</span>` : "–"}</p></div>`;
    }).join("")}
    </div>
    ${ME && fx.some((f) => Date.parse(f.t) > now) ? `<div class="row" style="margin-top:10px"><button class="btn primary" id="save">Save my picks</button><span class="note">You can change them until each kickoff.</span></div>` : ""}
  </div>
  <div class="panel">
    <div class="row" style="justify-content:space-between"><b>Leaderboard</b>
      <select id="view"><option value="all" ${S.view === "all" ? "selected" : ""}>Everyone, whole season</option><option value="round" ${S.view === "round" ? "selected" : ""}>Everyone, gameweek ${S.round}</option>
      ${((ME && ME.leagues) || []).map((l) => `<option value="L:${esc(l.code)}" ${S.view === "L:" + l.code ? "selected" : ""}>${esc(l.name)} (league)</option>`).join("")}</select></div>
    ${BOARD ? `<div class="tw"><table><thead><tr><th class="l">#</th><th class="l">Player</th><th>Points</th><th>Exact</th><th>Right result</th><th>Picks scored</th></tr></thead><tbody>
      ${BOARD.rows.map((x, i) => `<tr${ME && x.id === ME.id ? ' style="background:var(--panel2)"' : ""}><td class="l mono">${i + 1}</td><td class="l">${x.model ? "<b>🤖 The Model</b>" : esc(x.name)}</td><td class="mono"><b>${x.pts}</b></td><td class="mono">${x.exact}</td><td class="mono">${x.right}</td><td class="mono">${x.n}</td></tr>`).join("") || `<tr><td class="l" colspan="6">No scored picks yet.</td></tr>`}
    </tbody></table></div>${BOARD.you && BOARD.you > 100 ? `<p class="note">You are ${BOARD.you}. of ${BOARD.total}.</p>` : ""}` : `<p class="note">Loading…</p>`}
  </div>
  ${ME ? `<div class="panel grid2">
    <div><b>Private league</b><p class="note">Make a league for your friends and share the link.</p><div class="row"><input type="text" id="lname" maxlength="32" placeholder="League name"><button class="btn" id="mkleague">Create</button></div></div>
    <div><b>Join a league</b><p class="note">Got a code from a friend?</p><div class="row"><input type="text" id="lcode" maxlength="8" placeholder="Code"><button class="btn" id="joinleague">Join</button></div></div>
    ${(ME.leagues || []).length ? `<div style="grid-column:1/-1"><p class="note">Your leagues: ${ME.leagues.map((l) => `<b>${esc(l.name)}</b> <span class="pill">${esc(l.code)}</span> <a href="#" data-share="${esc(l.code)}" style="color:var(--ink)">copy invite link</a>`).join(" · ")}</p></div>` : ""}
    <div style="grid-column:1/-1"><details><summary class="note" style="cursor:pointer">Your player code (to play on another device)</summary><p class="mono" style="word-break:break-all">${esc(token())}</p><p class="note">Keep it private: anyone with it can change your picks.</p></details></div>
  </div>` : ""}`;
}

async function refresh(msg) {
  S.msg = msg || ""; S.err = "";
  try { await loadMe(); await loadBoard(); } catch (e) { S.err = e.message; }
  render();
}

app.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.id === "join") { const n = document.getElementById("name").value; const r = await call("/api/join", { name: n }); ls.set("lab-token", r.token); await joinFromLink(); return refresh(`Welcome, ${r.name}! Pick your scores below.`); }
    if (t.id === "restore") { ls.set("lab-token", document.getElementById("code").value.trim()); return refresh("Restored."); }
    if (t.id === "save") {
      const picks = Object.entries(S.draft).filter(([, v]) => v[0] !== "" && v[1] !== "").map(([m, v]) => ({ m, hs: +v[0], as: +v[1] }));
      if (!picks.length) { S.err = "Enter at least one score first."; return render(); }
      const r = await call("/api/picks", { token: token(), picks }); S.draft = {};
      return refresh(`Saved ${r.saved} pick${r.saved === 1 ? "" : "s"}${r.locked ? `; ${r.locked} had already kicked off` : ""}.`);
    }
    if (t.id === "mkleague") { const r = await call("/api/league", { token: token(), name: document.getElementById("lname").value }); S.view = "L:" + r.code; return refresh(`League “${r.name}” created. Invite code ${r.code}.`); }
    if (t.id === "joinleague") { const r = await call("/api/league/join", { token: token(), code: document.getElementById("lcode").value }); S.view = "L:" + r.code; return refresh(`You joined “${r.name}”.`); }
    if (t.dataset.share) { e.preventDefault(); const u = `${location.origin}${location.pathname}?join=${t.dataset.share}`; try { await navigator.clipboard.writeText(u); S.msg = "Invite link copied."; } catch (x) { S.msg = u; } return render(); }
  } catch (x) { S.err = x.message; render(); }
});
app.addEventListener("input", (e) => {
  const t = e.target; if (!t.dataset.id) return;
  const cur = S.draft[t.dataset.id] || ((ME && ME.picks[t.dataset.id]) || ["", ""]).slice();
  cur[+t.dataset.s] = t.value === "" ? "" : Math.max(0, Math.min(15, parseInt(t.value, 10) || 0));
  S.draft[t.dataset.id] = cur;
});
app.addEventListener("change", async (e) => {
  if (e.target.id === "round") { S.round = +e.target.value; if (S.view === "round") await loadBoard().catch(() => {}); render(); }
  if (e.target.id === "view") { S.view = e.target.value; BOARD = null; render(); await loadBoard().catch((x) => { S.err = x.message; }); render(); }
});

async function joinFromLink() {
  const code = new URLSearchParams(location.search).get("join");
  if (code && token()) { try { const r = await call("/api/league/join", { token: token(), code }); S.view = "L:" + r.code; S.msg = `You joined “${r.name}”.`; } catch (e) { S.err = e.message; } history.replaceState(null, "", location.pathname); }
}

Promise.all([fetch("game.json").then((r) => r.json()), fetch("api.json").then((r) => r.json()).catch(() => ({}))]).then(async ([g, a]) => {
  G = g; API = (a && a.api) || "";
  if (!API) { app.innerHTML = `<span class="kicker">Football Lab · Premier League</span><h1>Predictor</h1><p class="note">The game opens in a few days. Come back soon.</p>`; return; }
  await loadMe().catch(() => {});
  await joinFromLink();
  if (new URLSearchParams(location.search).get("join") && !token()) S.msg = "Pick a name to join your friend's league.";
  render();
  await loadBoard().catch((x) => { S.err = x.message; });
  render();
}).catch(() => { app.innerHTML = `<p class="note" style="padding:40px 0">The game data could not be loaded. Try again in a minute.</p>`; });
})();
