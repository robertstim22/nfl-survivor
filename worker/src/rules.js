// Survivor rules that don't touch the database (easy to unit test).

export const PICK_LOCK_MS = 60 * 1000; // picks close 1 minute before kickoff
export const REGULAR_SEASON_WEEKS = 18;

export const lockTime = (kickoff) => kickoff - PICK_LOCK_MS;
export const isLocked = (kickoff, now = Date.now()) => now >= lockTime(kickoff);

/**
 * Returns an error message if the pick isn't allowed, otherwise null.
 * game: { week, kickoff, status, homeTeam, awayTeam }
 * existingPicks: [{ week, team, kickoff }] — this player's picks this season
 */
export function validatePick({ eliminatedWeek, currentWeek, game, team, existingPicks, now = Date.now() }) {
  if (eliminatedWeek != null) return "You've been eliminated, so you can't make more picks.";
  if (game.week !== currentWeek) return `You can only pick games in the current week (week ${currentWeek}).`;
  if (team !== game.homeTeam && team !== game.awayTeam) return "That team isn't playing in this game.";
  if (game.status !== "scheduled" || isLocked(game.kickoff, now)) {
    return "This game is locked. Picks close 1 minute before kickoff.";
  }
  const thisWeek = existingPicks.find((p) => p.week === game.week);
  if (thisWeek && thisWeek.team !== team && isLocked(thisWeek.kickoff, now)) {
    return `Your week ${game.week} pick (${thisWeek.team}) is already locked in.`;
  }
  const used = existingPicks.find((p) => p.team === team && p.week !== game.week);
  if (used) return `You already used ${team} in week ${used.week}. Each team can only be picked once.`;
  return null;
}

export function validateSignup({ username, displayName, password }) {
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username ?? "")) {
    return "Username must be 3–20 characters: letters, numbers, _ . or -";
  }
  if (!displayName || displayName.trim().length === 0 || displayName.length > 40) return "Please enter your name (max 40 characters).";
  return validatePassword(password);
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6) return "Password must be at least 6 characters.";
  if (password.length > 200) return "Password is too long.";
  return null;
}
