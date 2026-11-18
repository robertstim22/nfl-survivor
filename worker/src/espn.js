// Imports NFL games, kickoff times, spreads and scores from ESPN's public
// scoreboard feed (no API key required).

export const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export async function fetchWeek(season, week, base = ESPN_SCOREBOARD) {
  const res = await fetch(`${base}?dates=${season}&seasontype=2&week=${week}&limit=100`, {
    headers: { accept: "application/json", "user-agent": "nfl-survivor" },
  });
  if (!res.ok) throw new Error(`ESPN week ${week}: HTTP ${res.status}`);
  return parseScoreboard(await res.json(), season, week);
}

/** Which regular-season week ESPN considers current (used before any games are imported). */
export async function fetchCurrentWeekNumber(season, base = ESPN_SCOREBOARD) {
  const res = await fetch(`${base}?dates=${season}&seasontype=2`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN scoreboard: HTTP ${res.status}`);
  const json = await res.json();
  return Number(json?.week?.number) || 1;
}

export function parseScoreboard(json, season, week) {
  const games = [];
  for (const event of json?.events ?? []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

    const status = parseStatus(comp.status?.type ?? event.status?.type ?? {});
    const hasScore = status === "in_progress" || status === "final";
    const homeScore = hasScore ? toInt(home.score) : null;
    const awayScore = hasScore ? toInt(away.score) : null;

    let winner = null;
    if (status === "final" && homeScore != null && awayScore != null) {
      winner = homeScore > awayScore ? home.team.abbreviation : awayScore > homeScore ? away.team.abbreviation : "TIE";
    }
    const { homeSpread, spreadText } = parseSpread(comp.odds?.[0], home.team.abbreviation);

    games.push({
      id: String(event.id),
      season,
      week: Number(event.week?.number ?? json?.week?.number ?? week),
      kickoff: Date.parse(comp.date ?? event.date),
      homeTeam: home.team.abbreviation,
      awayTeam: away.team.abbreviation,
      homeName: home.team.displayName ?? home.team.abbreviation,
      awayName: away.team.displayName ?? away.team.abbreviation,
      homeLogo: home.team.logo ?? null,
      awayLogo: away.team.logo ?? null,
      homeScore,
      awayScore,
      status,
      homeSpread,
      spreadText,
      winner,
    });
  }
  return games;
}

function parseStatus(t) {
  const name = String(t?.name ?? "");
  if (name === "STATUS_POSTPONED" || name === "STATUS_CANCELED") return "postponed";
  if (t?.completed || t?.state === "post") return "final";
  if (t?.state === "in") return "in_progress";
  return "scheduled";
}

/** ESPN odds look like { details: "KC -3.5" }; convert to a home-team line. */
export function parseSpread(odds, homeAbbr) {
  if (!odds) return { homeSpread: null, spreadText: null };
  const details = typeof odds.details === "string" ? odds.details.trim() : "";
  if (/^(even|pk|pick)/i.test(details)) return { homeSpread: 0, spreadText: "PK" };
  const m = details.match(/^([A-Z]{2,4})\s+([-+]?\d+(?:\.\d+)?)$/);
  if (m) {
    const line = Number(m[2]);
    return { homeSpread: m[1] === homeAbbr ? line : -line, spreadText: details };
  }
  if (typeof odds.spread === "number") return { homeSpread: odds.spread, spreadText: details || null };
  return { homeSpread: null, spreadText: details || null };
}

function toInt(v) {
  const n = Number(v);
  return v === "" || v == null || !Number.isFinite(n) ? null : Math.trunc(n);
}
