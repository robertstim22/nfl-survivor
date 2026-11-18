import { ESPN_SCOREBOARD, fetchCurrentWeekNumber, fetchWeek } from "./espn.js";
import { lockTime, REGULAR_SEASON_WEEKS } from "./rules.js";

const espnBase = (env) => env.ESPN_URL || ESPN_SCOREBOARD;

/** The earliest week with an unfinished game, or the last imported week, or null. */
export async function getCurrentWeek(db, season) {
  const next = await db
    .prepare(
      `SELECT week FROM games WHERE season = ? AND status IN ('scheduled','in_progress')
       ORDER BY week, kickoff LIMIT 1`,
    )
    .bind(season)
    .first();
  if (next) return next.week;
  const last = await db.prepare("SELECT MAX(week) AS week FROM games WHERE season = ?").bind(season).first();
  return last?.week ?? null;
}

export async function importWeek(env, season, week) {
  const games = await fetchWeek(season, week, espnBase(env));
  if (games.length === 0) return 0;
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO games (id, season, week, kickoff, home_team, away_team, home_name, away_name, home_logo, away_logo,
       home_score, away_score, status, home_spread, spread_text, winner, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       week = excluded.week, kickoff = excluded.kickoff, home_score = excluded.home_score,
       away_score = excluded.away_score, status = excluded.status,
       home_spread = COALESCE(excluded.home_spread, games.home_spread),
       spread_text = COALESCE(excluded.spread_text, games.spread_text),
       winner = excluded.winner, home_logo = excluded.home_logo, away_logo = excluded.away_logo,
       updated_at = excluded.updated_at`,
  );
  await env.DB.batch(
    games.map((g) =>
      stmt.bind(g.id, g.season, g.week, g.kickoff, g.homeTeam, g.awayTeam, g.homeName, g.awayName, g.homeLogo,
        g.awayLogo, g.homeScore, g.awayScore, g.status, g.homeSpread, g.spreadText, g.winner, now),
    ),
  );
  return games.length;
}

/**
 * Scheduled sync: refresh the current week and the next one (spreads,
 * kickoff changes, scores), then grade picks. Kept to two ESPN calls so it
 * fits comfortably in the free plan's limits.
 */
export async function syncCurrent(env) {
  const season = Number(env.SEASON);
  let week = await getCurrentWeek(env.DB, season);
  if (week == null) week = await fetchCurrentWeekNumber(season, espnBase(env));
  const weeks = [week, week + 1].filter((w) => w >= 1 && w <= REGULAR_SEASON_WEEKS);
  let imported = 0;
  for (const w of weeks) imported += await importWeek(env, season, w);
  const graded = await gradePicks(env.DB, season);
  return { weeks, imported, ...graded };
}

/**
 * Grades picks on finished games (ties count as losses) and eliminates
 * players who lost or skipped a finished week. Each pick and each week is only
 * processed once, so an admin "reinstate" sticks.
 */
export async function gradePicks(db, season) {
  const pending = await db
    .prepare(
      `SELECT p.id, p.entry_id, p.week, p.team, g.winner FROM picks p JOIN games g ON g.id = p.game_id
       WHERE p.season = ? AND p.result = 'PENDING' AND g.status = 'final'`,
    )
    .bind(season)
    .all();

  const stmts = [];
  let eliminated = 0;
  for (const p of pending.results) {
    const won = p.winner === p.team;
    stmts.push(db.prepare("UPDATE picks SET result = ? WHERE id = ?").bind(won ? "WIN" : "LOSS", p.id));
    if (!won) {
      eliminated++;
      stmts.push(
        db
          .prepare("UPDATE entries SET eliminated_week = ? WHERE id = ? AND (eliminated_week IS NULL OR eliminated_week > ?)")
          .bind(p.week, p.entry_id, p.week),
      );
    }
  }

  // Missed picks: once all of a week's games are over, anyone still alive who
  // joined before the week's last game locked and didn't pick is eliminated.
  const key = `missed_checked_${season}`;
  const checked = Number((await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first())?.value ?? 0);
  const weeks = await db
    .prepare(
      `SELECT week, MAX(kickoff) AS last_kickoff,
              SUM(CASE WHEN status IN ('final','postponed') THEN 0 ELSE 1 END) AS open
       FROM games WHERE season = ? AND week > ? GROUP BY week ORDER BY week`,
    )
    .bind(season, checked)
    .all();
  let newChecked = checked;
  for (const w of weeks.results) {
    if (w.open > 0) break; // stop at the first week that isn't finished
    stmts.push(
      db
        .prepare(
          `UPDATE entries SET eliminated_week = ?
           WHERE season = ? AND eliminated_week IS NULL AND created_at < ?
             AND NOT EXISTS (SELECT 1 FROM picks p WHERE p.entry_id = entries.id AND p.week = ?)`,
        )
        .bind(w.week, season, lockTime(w.last_kickoff), w.week),
    );
    newChecked = w.week;
  }
  if (newChecked !== checked) {
    stmts.push(
      db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(key, String(newChecked)),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { graded: pending.results.length, losses: eliminated, weeksClosed: newChecked - checked };
}
