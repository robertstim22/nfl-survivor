-- Run once: npm run db:init  (safe to re-run)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One player's participation in one season.
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  eliminated_week INTEGER,            -- NULL = still alive
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, season)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,                -- ESPN event id
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,           -- epoch ms
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_name TEXT NOT NULL,
  away_name TEXT NOT NULL,
  home_logo TEXT,
  away_logo TEXT,
  home_score INTEGER,
  away_score INTEGER,
  status TEXT NOT NULL,               -- scheduled | in_progress | final | postponed
  home_spread REAL,                   -- negative = home team favored
  spread_text TEXT,                   -- e.g. "KC -3.5"
  winner TEXT,                        -- team abbreviation, 'TIE', or NULL
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_season_week ON games (season, week);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id),
  team TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | WIN | LOSS
  updated_at INTEGER NOT NULL,
  UNIQUE (entry_id, week),                  -- one pick per week
  UNIQUE (entry_id, team)                   -- each team only once per season
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
