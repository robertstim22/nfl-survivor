import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocked, validatePick, validateSignup } from "../src/rules.js";

const now = Date.parse("2026-11-22T17:00:00Z");
const game = (over = {}) => ({ week: 12, kickoff: now + 3600_000, status: "scheduled", homeTeam: "KC", awayTeam: "LV", ...over });
const base = { eliminatedWeek: null, currentWeek: 12, game: game(), team: "KC", existingPicks: [], now };

test("picks lock exactly 1 minute before kickoff", () => {
  const k = Date.parse("2026-11-22T18:00:00Z");
  assert.equal(isLocked(k, k - 61_000), false);
  assert.equal(isLocked(k, k - 60_000), true);
});

test("valid pick", () => assert.equal(validatePick(base), null));

test("cannot reuse a team from another week", () => {
  const err = validatePick({ ...base, existingPicks: [{ week: 3, team: "KC", kickoff: 0 }] });
  assert.match(err, /already used KC in week 3/);
});

test("cannot pick a locked or started game", () => {
  assert.match(validatePick({ ...base, game: game({ kickoff: now + 59_000 }) }), /locked/);
  assert.match(validatePick({ ...base, game: game({ status: "in_progress" }) }), /locked/);
});

test("can change pick only while current pick's game is unlocked", () => {
  const open = [{ week: 12, team: "LV", kickoff: now + 7200_000 }];
  assert.equal(validatePick({ ...base, existingPicks: open }), null);
  const locked = [{ week: 12, team: "DET", kickoff: now - 1000 }];
  assert.match(validatePick({ ...base, existingPicks: locked }), /already locked in/);
});

test("eliminated players and wrong weeks are rejected", () => {
  assert.match(validatePick({ ...base, eliminatedWeek: 4 }), /eliminated/);
  assert.match(validatePick({ ...base, currentWeek: 13 }), /current week/);
  assert.match(validatePick({ ...base, team: "BUF" }), /isn't playing/);
});

test("signup validation", () => {
  assert.equal(validateSignup({ username: "mike_r", displayName: "Mike", password: "secret1" }), null);
  assert.match(validateSignup({ username: "m", displayName: "Mike", password: "secret1" }), /Username/);
  assert.match(validateSignup({ username: "mike", displayName: "Mike", password: "123" }), /Password/);
});
