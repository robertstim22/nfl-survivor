import { createSession, deleteSession, getSessionUser, hashPassword, verifyPassword } from "./auth.js";
import { isLocked, lockTime, REGULAR_SEASON_WEEKS, validatePassword, validatePick, validateSignup } from "./rules.js";
import { ensureSchema } from "./schema.js";
import { getCurrentWeek, gradePicks, importWeek, syncCurrent } from "./sync.js";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      await ensureSchema(env.DB);
      const body = await route(request, env);
      return Response.json(body ?? { ok: true }, { headers: cors });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return Response.json({ error: status === 500 ? "Something went wrong." : e.message }, { status, headers: cors });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB).then(() => syncCurrent(env)).then((r) => console.log("sync", JSON.stringify(r))));
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "access-control-allow-origin": allowed ? origin : env.ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const db = env.DB;
  const season = Number(env.SEASON);
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};

  // ---- public ----
  if (method === "GET" && (path === "" || path === "/api")) return { name: "nfl-survivor", season };

  if (method === "POST" && path === "/api/signup") {
    // Sign-up is open to anyone with the site's address, unless you set an INVITE_CODE secret.
    if (env.INVITE_CODE && body.invite !== env.INVITE_CODE) {
      throw new HttpError(403, "This invite link isn't valid. Ask the commissioner for a new one.");
    }
    const username = String(body.username ?? "").trim();
    const displayName = String(body.displayName ?? "").trim();
    const err = validateSignup({ username, displayName, password: body.password });
    if (err) throw new HttpError(400, err);
    const exists = await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
    if (exists) throw new HttpError(409, "That username is taken. Try another.");
    const { hash, salt } = await hashPassword(body.password);
    const now = Date.now();
    const user = await db
      .prepare("INSERT INTO users (username, display_name, pass_hash, pass_salt, created_at) VALUES (?,?,?,?,?) RETURNING id")
      .bind(username, displayName, hash, salt, now)
      .first();
    await db.prepare("INSERT INTO entries (user_id, season, created_at) VALUES (?,?,?)").bind(user.id, season, now).run();
    return { token: await createSession(db, user.id) };
  }

  if (method === "POST" && path === "/api/login") {
    const user = await db
      .prepare("SELECT id, pass_hash, pass_salt FROM users WHERE username = ?")
      .bind(String(body.username ?? "").trim())
      .first();
    if (!user || !(await verifyPassword(String(body.password ?? ""), user.pass_hash, user.pass_salt))) {
      throw new HttpError(401, "Wrong username or password.");
    }
    // Returning players are entered into a new season when they sign in.
    await db.prepare("INSERT OR IGNORE INTO entries (user_id, season, created_at) VALUES (?,?,?)").bind(user.id, season, Date.now()).run();
    return { token: await createSession(db, user.id) };
  }

  // ---- signed in ----
  const user = await getSessionUser(db, request);
  if (!user) throw new HttpError(401, "Please sign in.");
  const isAdmin = user.username.toLowerCase() === String(env.ADMIN_USERNAME ?? "").toLowerCase();
  const entry = await db
    .prepare("SELECT id, eliminated_week AS eliminatedWeek, created_at AS createdAt FROM entries WHERE user_id = ? AND season = ?")
    .bind(user.id, season)
    .first();

  if (method === "POST" && path === "/api/logout") return deleteSession(db, request);

  if (method === "GET" && path === "/api/me") return { user: { ...user, isAdmin }, entry, season };

  if (method === "POST" && path === "/api/password") {
    const row = await db.prepare("SELECT pass_hash, pass_salt FROM users WHERE id = ?").bind(user.id).first();
    if (!(await verifyPassword(String(body.currentPassword ?? ""), row.pass_hash, row.pass_salt))) {
      throw new HttpError(400, "Your current password is wrong.");
    }
    const err = validatePassword(body.newPassword);
    if (err) throw new HttpError(400, err);
    const { hash, salt } = await hashPassword(body.newPassword);
    await db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(hash, salt, user.id).run();
    return { ok: true };
  }

  if (method === "GET" && path === "/api/week") {
    const currentWeek = await getCurrentWeek(db, season);
    const games = currentWeek == null ? [] : await gamesForWeek(db, season, currentWeek);
    const picks = entry ? await picksForEntry(db, entry.id) : [];
    return { season, week: currentWeek, games, picks, entry, now: Date.now() };
  }

  if (method === "POST" && path === "/api/pick") {
    if (!entry) throw new HttpError(403, "You're not entered in this season's pool.");
    const game = await db.prepare(gameSelect("WHERE id = ? AND season = ?")).bind(String(body.gameId), season).first();
    if (!game) throw new HttpError(404, "Game not found.");
    const team = String(body.team ?? "");
    const error = validatePick({
      eliminatedWeek: entry.eliminatedWeek,
      currentWeek: await getCurrentWeek(db, season),
      game,
      team,
      existingPicks: await picksForEntry(db, entry.id),
    });
    if (error) throw new HttpError(400, error);
    try {
      await db
        .prepare(
          `INSERT INTO picks (entry_id, season, week, game_id, team, updated_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT (entry_id, week) DO UPDATE SET game_id = excluded.game_id, team = excluded.team,
             result = 'PENDING', updated_at = excluded.updated_at`,
        )
        .bind(entry.id, season, game.week, game.id, team, Date.now())
        .run();
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new HttpError(400, `You already used ${team} this season.`);
      throw e;
    }
    return { ok: true, team };
  }

  if (method === "GET" && path === "/api/standings") {
    const currentWeek = (await getCurrentWeek(db, season)) ?? 1;
    const entries = await db
      .prepare(
        `SELECT e.id, e.user_id AS userId, u.display_name AS name, e.eliminated_week AS eliminatedWeek
         FROM entries e JOIN users u ON u.id = e.user_id WHERE e.season = ?`,
      )
      .bind(season)
      .all();
    const picks = await db
      .prepare(
        `SELECT p.entry_id AS entryId, p.week, p.team, p.result, g.kickoff
         FROM picks p JOIN games g ON g.id = p.game_id WHERE p.season = ?`,
      )
      .bind(season)
      .all();
    const now = Date.now();
    return {
      currentWeek,
      entries: entries.results.map((e) => ({
        name: e.name,
        isMe: e.userId === user.id,
        eliminatedWeek: e.eliminatedWeek,
        picks: picks.results
          .filter((p) => p.entryId === e.id)
          .map((p) => {
            // Other players' picks stay hidden until that game locks.
            const visible = e.userId === user.id || isLocked(p.kickoff, now);
            return { week: p.week, team: visible ? p.team : null, result: p.result };
          }),
      })),
    };
  }

  // ---- admin ----
  if (path.startsWith("/api/admin/")) {
    if (!isAdmin) throw new HttpError(403, "Admins only.");

    if (method === "GET" && path === "/api/admin/players") {
      const week = await getCurrentWeek(db, season);
      const rows = await db
        .prepare(
          `SELECT e.id AS entryId, u.id AS userId, u.username, u.display_name AS name,
                  e.eliminated_week AS eliminatedWeek, (p.id IS NOT NULL) AS picked
           FROM entries e JOIN users u ON u.id = e.user_id
           LEFT JOIN picks p ON p.entry_id = e.id AND p.week = ?
           WHERE e.season = ? ORDER BY u.display_name COLLATE NOCASE`,
        )
        .bind(week ?? -1, season)
        .all();
      const last = await db.prepare("SELECT MAX(updated_at) AS t FROM games WHERE season = ?").bind(season).first();
      // Only whether each player has picked, never which team (the admin plays too).
      return { week, players: rows.results.map((p) => ({ ...p, picked: !!p.picked })), lastSync: last?.t ?? null, invite: env.INVITE_CODE || null };
    }

    if (method === "POST" && path === "/api/admin/sync") {
      if (body.week != null) {
        const week = Number(body.week);
        if (!(week >= 1 && week <= REGULAR_SEASON_WEEKS)) throw new HttpError(400, "Bad week.");
        const imported = await importWeek(env, season, week);
        return { imported, ...(await gradePicks(db, season)) };
      }
      return syncCurrent(env);
    }

    if (method === "POST" && path === "/api/admin/eliminate") {
      const week = body.week == null ? null : Number(body.week);
      await db.prepare("UPDATE entries SET eliminated_week = ? WHERE id = ? AND season = ?").bind(week, Number(body.entryId), season).run();
      return { ok: true };
    }

    if (method === "POST" && path === "/api/admin/reset-password") {
      const err = validatePassword(body.password);
      if (err) throw new HttpError(400, err);
      const { hash, salt } = await hashPassword(body.password);
      await db.batch([
        db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(hash, salt, Number(body.userId)),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(Number(body.userId)),
      ]);
      return { ok: true };
    }

    if (method === "POST" && path === "/api/admin/remove") {
      await db.prepare("DELETE FROM users WHERE id = ?").bind(Number(body.userId)).run();
      return { ok: true };
    }
  }

  throw new HttpError(404, "Not found.");
}

const gameSelect = (where) =>
  `SELECT id, week, kickoff, status, home_team AS homeTeam, away_team AS awayTeam, home_name AS homeName,
          away_name AS awayName, home_logo AS homeLogo, away_logo AS awayLogo, home_score AS homeScore,
          away_score AS awayScore, home_spread AS homeSpread, spread_text AS spreadText, winner
   FROM games ${where}`;

async function gamesForWeek(db, season, week) {
  const rows = await db.prepare(gameSelect("WHERE season = ? AND week = ? ORDER BY kickoff, id")).bind(season, week).all();
  return rows.results.map((g) => ({ ...g, lockTime: lockTime(g.kickoff) }));
}

async function picksForEntry(db, entryId) {
  const rows = await db
    .prepare(
      `SELECT p.week, p.team, p.result, p.game_id AS gameId, g.kickoff
       FROM picks p JOIN games g ON g.id = p.game_id WHERE p.entry_id = ? ORDER BY p.week`,
    )
    .bind(entryId)
    .all();
  return rows.results;
}
