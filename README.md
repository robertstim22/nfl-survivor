# 🏈 NFL Survivor

A private NFL survivor pool for you and your friends. The website is a static page on GitHub Pages; a small
Cloudflare Worker with a built-in database (D1) stores accounts and picks and enforces the rules.

**Rules**
- Each week, every player picks one NFL team to win.
- If your team wins, you survive. If it loses **or ties**, you're eliminated.
- You can't pick the same team twice in a season (blocked in the site, the API and the database).
- You can pick or change your pick until **1 minute before that game's kickoff**.
- If you don't pick in a week, you're eliminated once that week's games are finished.
- Other players' picks stay hidden until their game locks.

Games, kickoff times, spreads and scores come from ESPN's public scoreboard feed (no API key) and
sync every 10 minutes.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `app.js`, `style.css` | The website (served by GitHub Pages) |
| `config.js` | The Worker's URL — edit after deploying |
| `worker/src/` | The API: accounts, picks, ESPN import, grading, scheduled sync |
| `worker/schema.sql` | Database tables |
| `worker/wrangler.toml` | Worker settings: season, admin username, schedule |

## Setup

You need a free Cloudflare account (the same one as player-tracker is fine).

1. **Create the database and deploy the Worker**
   ```bash
   cd worker
   npm install
   npx wrangler login
   npx wrangler d1 create nfl-survivor
   ```
   Copy the `database_id` it prints into `worker/wrangler.toml`, and set `ADMIN_USERNAME` there to the
   username you'll sign up with. Then:
   ```bash
   npm run db:init
   npx wrangler secret put INVITE_CODE
   npm run deploy
   ```
   For `INVITE_CODE`, type any hard-to-guess word or phrase (no spaces) — it goes in the invite link.
   `deploy` prints the Worker's URL, like `https://nfl-survivor.<you>.workers.dev`.

2. **Point the website at the Worker:** put that URL in `config.js`, commit and push.

3. **Turn on GitHub Pages:** repo Settings → Pages → Deploy from a branch → `main` / `(root)`.
   The site will be at `https://robertstim22.github.io/nfl-survivor/`.

4. **Sign up and invite friends:** open `https://robertstim22.github.io/nfl-survivor/#/join/<INVITE_CODE>`,
   create your account (with the `ADMIN_USERNAME` username), then go to **Admin** and click
   **Import full season**. Send friends the invite link shown on the Admin page.

To change the invite link later, run `npx wrangler secret put INVITE_CODE` again.

## Admin page

- Invite link to send friends
- **Who hasn't picked** this week, so you can nudge them
- Sync now / import the full season
- Eliminate or reinstate a player, reset a forgotten password, remove a player

## Next season

Change `SEASON` in `worker/wrangler.toml` and run `npm run deploy`. Returning players are entered into the new
season when they sign in; new friends join with the invite link.

## Development

```bash
cd worker
npm test                 # unit tests for pick rules and the ESPN parser
npm run db:init:local    # local database
npx wrangler dev         # API on http://localhost:8787
```
Then serve the repo root (e.g. `npx serve ..`) with `config.js` pointing at `http://localhost:8787`.
