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
| `worker/src/schema.js` | Database tables (created automatically) |
| `worker/wrangler.toml` | Worker settings: season, admin username, schedule |

## Setup (all in your web browser)

You need a free Cloudflare account (the same one as player-tracker is fine).

1. **Deploy the Worker from GitHub.** In the Cloudflare dashboard, go to **Workers & Pages → Create →
   Import a repository**, connect GitHub if asked, and pick `robertstim22/nfl-survivor`. Use these settings:
   - Project name: `nfl-survivor` (must match `name` in `worker/wrangler.toml`)
   - Root directory (under advanced settings): `worker`
   - Leave the deploy command as `npx wrangler deploy`

   Click **Deploy**. The first deploy creates the database automatically, and the Worker creates its tables
   the first time it runs. When it finishes, copy the Worker's address, like
   `https://nfl-survivor.<your-subdomain>.workers.dev`. From then on, Cloudflare redeploys the Worker
   whenever you push to GitHub.

2. **Point the website at the Worker:** on GitHub, open `config.js`, click the pencil icon, paste the
   Worker address, and commit.

3. **Turn on GitHub Pages:** repo **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
   The site will be at `https://robertstim22.github.io/nfl-survivor/`.

4. **Create your account:** open the site, click **Create an account**, and sign up with the username set as
   `ADMIN_USERNAME` in `worker/wrangler.toml` (currently `tim`). Go to **Admin** and click
   **Import full season**.

5. **Invite friends:** send them the site link. They click **Create an account** and pick their own
   username and password.

Settings such as the season, admin username and schedule live in `worker/wrangler.toml`. You can edit
it on GitHub the same way as `config.js`; Cloudflare redeploys automatically.

### Optional: invite code

Anyone with the site's address can sign up, and you can remove anyone from the Admin page. If you want to
lock sign-up down, add a secret named `INVITE_CODE` to the Worker (Cloudflare dashboard → the
`nfl-survivor` Worker → **Settings → Variables and Secrets**). The Admin page then shows an invite link
containing the code, and sign-up only works through that link.

## Admin page

- The link to send friends
- **Who hasn't picked** this week, so you can nudge them
- Sync now / import the full season
- Eliminate or reinstate a player, reset a forgotten password, remove a player

## Next season

Change `SEASON` in `worker/wrangler.toml` and commit. Returning players are entered into the new
season when they sign in; new friends join with the invite link.

## Development

```bash
cd worker
npm test                 # unit tests for pick rules and the ESPN parser
npx wrangler dev         # API on http://localhost:8787
```
Then serve the repo root (e.g. `npx serve ..`) with `config.js` pointing at `http://localhost:8787`.
