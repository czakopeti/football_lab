// Football Lab game server: the prediction game (players, picks, leaderboards, private leagues)
// and a relay for public Fantasy Premier League data, which browsers cannot fetch directly.

const json = (data, status = 200, env) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", ...cors(env) },
});
const cors = (env) => ({
  "access-control-allow-origin": env ? env.SITE : "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
});
const bad = (msg, env, status = 400) => json({ error: msg }, status, env);
const now = () => new Date().toISOString();
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);

async function game(env) {
  const r = await fetch(env.GAME_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error("game data unavailable");
  return r.json();
}

async function player(env, token) {
  if (!token || token.length < 20) return null;
  return env.DB.prepare("SELECT id, name FROM players WHERE token = ?").bind(token).first();
}

function points(p, res, sc) {
  if (p[0] === res[0] && p[1] === res[1]) return { pts: sc.exact, exact: 1, right: 1 };
  const s = (a, b) => Math.sign(a - b);
  return s(p[0], p[1]) === s(res[0], res[1]) ? { pts: sc.result, exact: 0, right: 1 } : { pts: 0, exact: 0, right: 0 };
}

async function board(env, G, round, code) {
  const results = new Map(G.results.map((r) => [r.id, r]));
  let sql = "SELECT p.player_id, p.match_id, p.round, p.hs, p.aws, pl.name FROM picks p JOIN players pl ON pl.id = p.player_id";
  const args = [];
  if (code) { sql += " JOIN members m ON m.player_id = p.player_id AND m.code = ?"; args.push(code); }
  if (round) { sql += (code ? " AND" : " WHERE") + " p.round = ?"; args.push(round); }
  const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
  const tally = new Map();
  for (const r of rows) {
    const t = tally.get(r.player_id) || { id: r.player_id, name: r.name, pts: 0, exact: 0, right: 0, n: 0 };
    const res = results.get(r.match_id);
    if (res) { const q = points([r.hs, r.aws], [res.hs, res.as], G.scoring); t.pts += q.pts; t.exact += q.exact; t.right += q.right; t.n += 1; }
    tally.set(r.player_id, t);
  }
  // The model plays too, with the picks it made before each kickoff.
  const m = { id: 0, name: "The Model", model: true, pts: 0, exact: 0, right: 0, n: 0 };
  for (const res of G.results) {
    if (!res.model || (round && res.r !== round)) continue;
    const q = points(res.model, [res.hs, res.as], G.scoring); m.pts += q.pts; m.exact += q.exact; m.right += q.right; m.n += 1;
  }
  const list = [...tally.values(), m].sort((a, b) => b.pts - a.pts || b.exact - a.exact || a.n - b.n);
  return list;
}

const code6 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

async function fpl(env, id) {
  const H = { "user-agent": "Mozilla/5.0 (compatible; football-lab)" };
  const get = async (u, ttl) => { const r = await fetch(u, { headers: H, cf: { cacheTtl: ttl, cacheEverything: true } }); if (!r.ok) throw new Error(`FPL ${r.status}`); return r.json(); };
  const boot = await get("https://fantasy.premierleague.com/api/bootstrap-static/", 900);
  const cur = boot.events.find((e) => e.is_current) || boot.events.find((e) => e.is_next);
  const next = boot.events.find((e) => e.is_next);
  const players = boot.elements.map((e) => ({ id: e.id, cost: e.now_cost / 10, status: e.status, chance: e.chance_of_playing_next_round, news: e.news, pos: e.element_type, team: e.team, name: e.web_name }));
  if (!id) return { players, next: next && next.id };
  const entry = await get(`https://fantasy.premierleague.com/api/entry/${id}/`, 60);
  const picks = await get(`https://fantasy.premierleague.com/api/entry/${id}/event/${cur.id}/picks/`, 60);
  // Chips already played (name and gameweek), so the helper knows which ones are left.
  let chips = [];
  try { chips = ((await get(`https://fantasy.premierleague.com/api/entry/${id}/history/`, 60)).chips || []).map((c) => ({ name: c.name, gw: c.event })); } catch (e) { chips = null; }
  // The picks are those of the last gameweek played; transfers already made for the coming one are
  // applied on top (the public transfers list shows them before the deadline), with the bank moved by
  // the sale and purchase prices.
  let squad = picks.picks.map((p) => ({ id: p.element, pos: p.position, captain: p.is_captain, vice: p.is_vice_captain, selling: p.selling_price ? p.selling_price / 10 : null }));
  let bank = (picks.entry_history.bank || 0) / 10, pending = [];
  try {
    const tr = await get(`https://fantasy.premierleague.com/api/entry/${id}/transfers/`, 30);
    for (const t of tr.filter((t) => t.event > cur.id).sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
      const i = squad.findIndex((p) => p.id === t.element_out);
      if (i < 0) continue;
      squad[i] = { ...squad[i], id: t.element_in, selling: t.element_in_cost / 10, captain: false, vice: false };
      bank += (t.element_out_cost - t.element_in_cost) / 10;
      pending.push({ out: t.element_out, in: t.element_in });
    }
  } catch (e) { /* keep last gameweek's squad */ }
  return {
    players, next: next && next.id, gw: cur.id,
    team: { name: entry.name, manager: `${entry.player_first_name} ${entry.player_last_name}`, bank: Math.round(bank * 10) / 10, value: (picks.entry_history.value || 0) / 10,
      chip: picks.active_chip, chips, pending, picks: squad },
  };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    try {
      if (path === "/api/join" && req.method === "POST") {
        const b = await req.json();
        const name = clean(b.name, 24);
        if (name.length < 2) return bad("Pick a name of at least 2 characters.", env);
        const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
        const r = await env.DB.prepare("INSERT INTO players (name, token, created) VALUES (?, ?, ?) RETURNING id").bind(name, token, now()).first();
        return json({ id: r.id, name, token }, 200, env);
      }
      if (path === "/api/me") {
        const me = await player(env, url.searchParams.get("token"));
        if (!me) return bad("Unknown player.", env, 404);
        const picks = (await env.DB.prepare("SELECT match_id, hs, aws FROM picks WHERE player_id = ?").bind(me.id).all()).results || [];
        const leagues = (await env.DB.prepare("SELECT l.code, l.name FROM members m JOIN leagues l ON l.code = m.code WHERE m.player_id = ?").bind(me.id).all()).results || [];
        return json({ ...me, picks: Object.fromEntries(picks.map((p) => [p.match_id, [p.hs, p.aws]])), leagues }, 200, env);
      }
      if (path === "/api/picks" && req.method === "POST") {
        const b = await req.json();
        const me = await player(env, b.token);
        if (!me) return bad("Unknown player.", env, 404);
        const G = await game(env);
        const fx = new Map(G.fixtures.map((f) => [f.id, f]));
        const t = Date.now();
        const stmts = [];
        let locked = 0;
        for (const p of (b.picks || []).slice(0, 60)) {
          const f = fx.get(p.m);
          const hs = Number(p.hs), as = Number(p.as);
          if (!f || !Number.isInteger(hs) || !Number.isInteger(as) || hs < 0 || as < 0 || hs > 15 || as > 15) continue;
          if (Date.parse(f.t) <= t) { locked++; continue; }
          stmts.push(env.DB.prepare("INSERT INTO picks (player_id, match_id, round, hs, aws, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(player_id, match_id) DO UPDATE SET hs = excluded.hs, aws = excluded.aws, updated = excluded.updated")
            .bind(me.id, f.id, f.r, hs, as, now()));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ saved: stmts.length, locked }, 200, env);
      }
      if (path === "/api/board") {
        const G = await game(env);
        const round = Number(url.searchParams.get("round")) || null;
        const code = clean(url.searchParams.get("league"), 8).toUpperCase() || null;
        const list = await board(env, G, round, code);
        const me = await player(env, url.searchParams.get("token"));
        const rank = me ? list.findIndex((x) => x.id === me.id) + 1 : 0;
        return json({ rows: list.slice(0, 100), total: list.length, you: rank || null }, 200, env);
      }
      if (path === "/api/league" && req.method === "POST") {
        const b = await req.json();
        const me = await player(env, b.token);
        if (!me) return bad("Unknown player.", env, 404);
        const name = clean(b.name, 32);
        if (name.length < 2) return bad("Give the league a name.", env);
        let code = code6();
        for (let i = 0; i < 3 && (await env.DB.prepare("SELECT 1 FROM leagues WHERE code = ?").bind(code).first()); i++) code = code6();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO leagues (code, name, owner, created) VALUES (?, ?, ?, ?)").bind(code, name, me.id, now()),
          env.DB.prepare("INSERT OR IGNORE INTO members (code, player_id) VALUES (?, ?)").bind(code, me.id),
        ]);
        return json({ code, name }, 200, env);
      }
      if (path === "/api/league/join" && req.method === "POST") {
        const b = await req.json();
        const me = await player(env, b.token);
        if (!me) return bad("Unknown player.", env, 404);
        const code = clean(b.code, 8).toUpperCase();
        const L = await env.DB.prepare("SELECT code, name FROM leagues WHERE code = ?").bind(code).first();
        if (!L) return bad("No league with that code.", env, 404);
        await env.DB.prepare("INSERT OR IGNORE INTO members (code, player_id) VALUES (?, ?)").bind(code, me.id).run();
        return json(L, 200, env);
      }
      if (path.startsWith("/api/fpl")) {
        const id = path.split("/")[3];
        if (id && !/^\d{1,9}$/.test(id)) return bad("A team ID is a number.", env);
        return json(await fpl(env, id), 200, env);
      }
      return bad("Not found.", env, 404);
    } catch (e) {
      return bad(String(e.message || e), env, 502);
    }
  },
};
