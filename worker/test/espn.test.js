import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScoreboard, parseSpread } from "../src/espn.js";

const team = (a, n) => ({ abbreviation: a, displayName: n, logo: `https://x/${a}.png` });
const ev = (id, h, a, state, odds) => ({
  id, week: { number: 12 },
  competitions: [{
    date: "2026-11-22T18:00Z",
    status: { type: { state, completed: state === "post", name: state === "post" ? "STATUS_FINAL" : "STATUS_SCHEDULED" } },
    competitors: [
      { homeAway: "home", score: h[2] ?? "0", team: team(h[0], h[1]) },
      { homeAway: "away", score: a[2] ?? "0", team: team(a[0], a[1]) },
    ],
    odds: odds ? [odds] : undefined,
  }],
});

test("parses scheduled, final and tied games", () => {
  const games = parseScoreboard({ events: [
    ev("1", ["KC", "Chiefs"], ["BUF", "Bills"], "pre", { details: "KC -3.5" }),
    ev("2", ["NYJ", "Jets", "17"], ["MIA", "Dolphins", "24"], "post"),
    ev("3", ["DAL", "Cowboys", "20"], ["NYG", "Giants", "20"], "post"),
  ] }, 2026, 12);
  assert.deepEqual(
    { ...games[0], kickoff: undefined },
    { id: "1", season: 2026, week: 12, kickoff: undefined, homeTeam: "KC", awayTeam: "BUF", homeName: "Chiefs", awayName: "Bills",
      homeLogo: "https://x/KC.png", awayLogo: "https://x/BUF.png", homeScore: null, awayScore: null, status: "scheduled",
      homeSpread: -3.5, spreadText: "KC -3.5", winner: null },
  );
  assert.equal(games[0].kickoff, Date.parse("2026-11-22T18:00:00Z"));
  assert.equal(games[1].winner, "MIA");
  assert.equal(games[2].winner, "TIE");
});

test("spreads", () => {
  assert.deepEqual(parseSpread({ details: "BUF -6" }, "KC"), { homeSpread: 6, spreadText: "BUF -6" });
  assert.deepEqual(parseSpread({ details: "EVEN" }, "KC"), { homeSpread: 0, spreadText: "PK" });
  assert.deepEqual(parseSpread(undefined, "KC"), { homeSpread: null, spreadText: null });
});
