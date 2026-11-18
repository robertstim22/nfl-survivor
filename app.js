// NFL Survivor front end: a small hash-routed app that talks to the Worker API.
(() => {
  const API = String(window.SURVIVOR_API || "").replace(/\/$/, "");
  const app = document.getElementById("app");
  const ET = "America/New_York";
  let me = null; // { user, entry, season }

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get: () => { try { return localStorage.getItem("survivor_token"); } catch { return null; } },
    set: (t) => { try { t ? localStorage.setItem("survivor_token", t) : localStorage.removeItem("survivor_token"); } catch {} },
  };
  const fmt = (ms, opts) => new Intl.DateTimeFormat("en-US", { timeZone: ET, ...opts }).format(new Date(ms));
  const kickoffText = (ms) => fmt(ms, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const timeText = (ms) => fmt(ms, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const msg = (el, text, kind = "error") => { el.innerHTML = text ? `<p class="msg ${kind}">${esc(text)}</p>` : ""; };

  async function api(path, body) {
    const headers = { "content-type": "application/json" };
    const token = store.get();
    if (token) headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(API + path, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !path.startsWith("/api/login")) {
      store.set(null); me = null; location.hash = "#/login";
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setNav() {
    document.getElementById("nav-links").hidden = !me;
    document.getElementById("admin-link").hidden = !me?.user?.isAdmin;
  }

  // ---------- router ----------
  async function render() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [, page, arg] = hash.split("/");
    if (page === "join") return renderJoin(decodeURIComponent(arg || ""));
    if (!store.get()) return renderLogin();
    if (!me) {
      try { me = await api("/api/me"); } catch (e) { if (!store.get()) return renderLogin(); app.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; return; }
    }
    setNav();
    if (page === "login") return (location.hash = "#/");
    if (page === "standings") return renderStandings();
    if (page === "admin") return renderAdmin();
    if (page === "account") return renderAccount();
    return renderHome();
  }
  const showError = (e) => { app.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; };
  window.addEventListener("hashchange", () => render().catch(showError));

  // ---------- login / join ----------
  function renderLogin() {
    me = null; setNav();
    app.innerHTML = `
      <div class="card">
        <h1>Sign in</h1>
        <form class="stack" id="f">
          <label>Username <input name="username" autocomplete="username" required /></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
          <button>Sign in</button>
          <div id="m"></div>
        </form>
        <p>New here? <a href="#/join">Create an account</a></p>
        <p class="muted">Forgot your password? Ask the commissioner to reset it.</p>
      </div>`;
    onSubmit("f", async (data) => {
      const { token } = await api("/api/login", data);
      store.set(token); location.hash = "#/"; render();
    });
  }

  function renderJoin(invite) {
    app.innerHTML = `
      <div class="card">
        <h1>Join the Survivor Pool</h1>
        <p>Each week, pick one NFL team to win. If they win, you survive. If they lose (or tie), you're out.
           You can't use the same team twice, and picks lock 1 minute before kickoff.</p>
        <form class="stack" id="f">
          <label>Your name <input name="displayName" maxlength="40" required placeholder="e.g. Mike R." /></label>
          <label>Username <input name="username" autocomplete="username" required pattern="[A-Za-z0-9_.\\-]{3,20}" title="3–20 letters, numbers, _ . or -" /></label>
          <label>Password <input name="password" type="password" autocomplete="new-password" minlength="6" required /></label>
          <button>Join</button>
          <div id="m"></div>
        </form>
        <p class="muted">Already joined? <a href="#/login">Sign in</a></p>
      </div>`;
    onSubmit("f", async (data) => {
      const { token } = await api("/api/signup", { ...data, invite });
      store.set(token); me = null; location.hash = "#/";
    });
  }

  function onSubmit(id, handler) {
    const form = document.getElementById(id);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("button");
      const m = form.querySelector("#m") || form.querySelector(".m");
      btn.disabled = true; msg(m, "");
      try { await handler(Object.fromEntries(new FormData(form)), m); }
      catch (e) { msg(m, e.message); }
      finally { btn.disabled = false; }
    });
  }

  // ---------- home: make a pick ----------
  let homeTimer = null;
  async function renderHome(flash) {
    clearTimeout(homeTimer);
    const data = await api("/api/week");
    const { week, games, picks, entry, now } = data;
    if (!entry) {
      app.innerHTML = `<div class="card"><h1>Not entered</h1><p>You aren't in the ${esc(data.season)} pool.</p></div>`;
      return;
    }
    const alive = entry.eliminatedWeek == null;
    const thisPick = picks.find((p) => p.week === week);
    const used = picks.filter((p) => p.week !== week);
    const usedWeek = Object.fromEntries(used.map((p) => [p.team, p.week]));
    const pickLocked = thisPick ? now >= thisPick.kickoff - 60000 : false;

    const statusLine = !alive
      ? `<span class="status out">Eliminated in week ${esc(entry.eliminatedWeek)}</span>`
      : `<span class="status alive">Alive</span> <span class="muted">${
          thisPick
            ? `Your pick: <b>${esc(thisPick.team)}</b>${pickLocked ? " (locked)" : " — you can change it until 1 minute before kickoff"}`
            : "No pick yet — picks lock 1 minute before each game's kickoff."
        }</span>`;

    const teamBtn = (g, home) => {
      const abbr = home ? g.homeTeam : g.awayTeam;
      const name = home ? g.homeName : g.awayName;
      const logo = home ? g.homeLogo : g.awayLogo;
      const selected = thisPick?.team === abbr;
      let reason = null;
      if (!alive) reason = "Eliminated";
      else if (g.status !== "scheduled" || now >= g.lockTime) reason = "Locked";
      else if (usedWeek[abbr]) reason = `Used in week ${usedWeek[abbr]}`;
      else if (pickLocked) reason = "Your pick is locked";
      if (selected) reason = null;
      let spread = "";
      if (g.homeSpread != null) {
        const v = home ? g.homeSpread : -g.homeSpread;
        spread = v === 0 ? "PK" : v > 0 ? `+${v}` : `${v}`;
      }
      return `<button class="team ${selected ? "selected" : ""}" data-game="${esc(g.id)}" data-team="${esc(abbr)}"
                ${reason || selected ? "disabled" : ""} title="${esc(reason || `Pick ${name}`)}">
          ${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" />` : ""}
          <span class="team-name">${home ? "@ " : ""}${esc(name)}</span>
          ${spread ? `<span class="spread">${esc(spread)}</span>` : ""}
          ${selected ? `<span class="badge">Your pick</span>` : ""}
          ${reason ? `<span class="reason">${esc(reason)}</span>` : ""}
        </button>`;
    };

    const gameMeta = (g) => {
      let right = "";
      if (g.status === "scheduled" && now < g.lockTime) right = `Locks ${esc(timeText(g.lockTime))}`;
      if (g.status === "in_progress") right = `<span class="score">Live: ${esc(g.awayTeam)} ${g.awayScore ?? 0} – ${esc(g.homeTeam)} ${g.homeScore ?? 0}</span>`;
      if (g.status === "final") right = `<span class="score">Final: ${esc(g.awayTeam)} ${g.awayScore} – ${esc(g.homeTeam)} ${g.homeScore}</span>`;
      if (g.status === "postponed") right = "Postponed";
      if (g.spreadText) right += ` · Line: ${esc(g.spreadText)}`;
      return `<div class="game-meta"><span>${esc(kickoffText(g.kickoff))}</span><span>${right}</span></div>`;
    };

    app.innerHTML = `
      <h1>${week ? `Week ${esc(week)}` : "No games yet"}</h1>
      <p class="row">${statusLine}</p>
      <div id="flash"></div>
      ${used.length ? `<h2>Teams you've used</h2><div class="chips">${used.map((p) => `<span class="chip">W${esc(p.week)}: ${esc(p.team)}</span>`).join("")}</div>` : ""}
      <h2>Games</h2>
      ${games.length ? "" : `<p class="muted">No games imported yet. They sync automatically every 10 minutes${me.user.isAdmin ? ` — or use <a href="#/admin">Admin → Sync</a>` : ""}.</p>`}
      ${games.map((g) => `<div class="card">${gameMeta(g)}<div class="matchup">${teamBtn(g, false)}${teamBtn(g, true)}</div></div>`).join("")}`;

    if (flash) msg(document.getElementById("flash"), flash.text, flash.kind);
    app.querySelectorAll("button.team").forEach((b) =>
      b.addEventListener("click", async () => {
        app.querySelectorAll("button.team").forEach((x) => (x.disabled = true));
        try {
          await api("/api/pick", { gameId: b.dataset.game, team: b.dataset.team });
          await renderHome({ text: `Saved: ${b.dataset.team}. You can change it until 1 minute before that game kicks off.`, kind: "success" });
        } catch (e) {
          await renderHome({ text: e.message, kind: "error" });
        }
      }),
    );
    // Refresh every minute so games lock on screen as kickoff approaches.
    homeTimer = setTimeout(() => { if ((location.hash || "#/") === "#/" && !document.hidden) renderHome(); }, 60000);
  }

  // ---------- standings ----------
  async function renderStandings() {
    const { currentWeek, entries } = await api("/api/standings");
    entries.sort((a, b) => (b.eliminatedWeek ?? 99) - (a.eliminatedWeek ?? 99) || a.name.localeCompare(b.name));
    const weeks = Array.from({ length: currentWeek }, (_, i) => i + 1);
    const alive = entries.filter((e) => e.eliminatedWeek == null).length;
    app.innerHTML = `
      <h1>Standings</h1>
      <p class="muted">${alive} of ${entries.length} still alive. Other players' picks are hidden (✓) until their game locks.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>Status</th>${weeks.map((w) => `<th>W${w}</th>`).join("")}</tr></thead>
        <tbody>${entries.map((e) => `
          <tr>
            <td>${esc(e.name)}${e.isMe ? " (you)" : ""}</td>
            <td><span class="status ${e.eliminatedWeek == null ? "alive" : "out"}">${e.eliminatedWeek == null ? "Alive" : `Out W${esc(e.eliminatedWeek)}`}</span></td>
            ${weeks.map((w) => {
              const p = e.picks.find((x) => x.week === w);
              if (!p) return `<td class="muted">${e.eliminatedWeek && w > e.eliminatedWeek ? "" : "—"}</td>`;
              const cls = p.result === "WIN" ? "win" : p.result === "LOSS" ? "loss" : "";
              return `<td class="${cls}">${p.team ? esc(p.team) : "✓"}</td>`;
            }).join("")}
          </tr>`).join("")}
        </tbody>
      </table></div>`;
  }

  // ---------- account ----------
  function renderAccount() {
    app.innerHTML = `
      <h1>Account</h1>
      <p class="muted">Signed in as <b>${esc(me.user.username)}</b> (${esc(me.user.displayName)})</p>
      <div class="card">
        <h2 style="margin-top:0">Change password</h2>
        <form class="stack" id="f">
          <label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
          <label>New password <input name="newPassword" type="password" autocomplete="new-password" minlength="6" required /></label>
          <button>Change password</button>
          <div id="m"></div>
        </form>
      </div>
      <button class="secondary" id="logout">Sign out</button>`;
    onSubmit("f", async (data, m) => {
      await api("/api/password", data);
      document.getElementById("f").reset();
      msg(m, "Password changed.", "success");
    });
    document.getElementById("logout").addEventListener("click", async () => {
      try { await api("/api/logout", {}); } catch {}
      store.set(null); me = null; location.hash = "#/login"; render();
    });
  }

  // ---------- admin ----------
  async function renderAdmin(flash) {
    if (!me.user.isAdmin) return (location.hash = "#/");
    const { week, players, lastSync, invite } = await api("/api/admin/players");
    const siteUrl = `${location.origin}${location.pathname}`;
    const inviteUrl = invite ? `${siteUrl}#/join/${encodeURIComponent(invite)}` : `${siteUrl}#/join`;
    const missing = players.filter((p) => p.eliminatedWeek == null && !p.pick);
    app.innerHTML = `
      <h1>Admin</h1>
      <div id="flash"></div>
      <h2>Invite friends</h2>
      <div class="card">
        <p class="muted">Send this link to friends. They'll choose their own username and password.</p>
        <code class="invite">${esc(inviteUrl)}</code>
      </div>

      <h2>Week ${esc(week ?? "–")}: who hasn't picked</h2>
      <div class="card">
        ${missing.length
          ? `<p>${missing.map((p) => `<span class="chip">${esc(p.name)}</span>`).join(" ")}</p><p class="muted">Send them a nudge!</p>`
          : `<p class="muted">Everyone who's alive has picked. 🎉</p>`}
      </div>

      <h2>Game sync</h2>
      <div class="card">
        <p class="muted">Games, spreads and scores sync automatically every 10 minutes.
          ${lastSync ? `Last update: ${esc(kickoffText(lastSync))}.` : "Nothing imported yet."}</p>
        <div class="row">
          <button id="sync">Sync now</button>
          <button class="secondary" id="sync-all">Import full season</button>
        </div>
        <div id="sync-m"></div>
      </div>

      <h2>Players (${players.length})</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>W${esc(week ?? "")} pick</th><th>Status</th><th></th></tr></thead>
        <tbody>${players.map((p) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td class="muted">${esc(p.username)}</td>
            <td>${esc(p.pick ?? "—")}</td>
            <td><span class="status ${p.eliminatedWeek == null ? "alive" : "out"}">${p.eliminatedWeek == null ? "Alive" : `Out W${esc(p.eliminatedWeek)}`}</span></td>
            <td><div class="row">
              ${p.eliminatedWeek == null
                ? `<button class="link" data-act="eliminate" data-entry="${p.entryId}">eliminate</button>`
                : `<button class="link" data-act="reinstate" data-entry="${p.entryId}">reinstate</button>`}
              <button class="link" data-act="reset" data-user="${p.userId}" data-name="${esc(p.name)}">reset password</button>
              <button class="link" data-act="remove" data-user="${p.userId}" data-name="${esc(p.name)}">remove</button>
            </div></td>
          </tr>`).join("")}
        </tbody>
      </table></div>`;

    if (flash) msg(document.getElementById("flash"), flash.text, flash.kind);
    const syncM = document.getElementById("sync-m");
    document.getElementById("sync").addEventListener("click", async (ev) => {
      ev.target.disabled = true; msg(syncM, "Syncing…", "success");
      try {
        const r = await api("/api/admin/sync", {});
        await renderAdmin({ text: `Synced weeks ${r.weeks.join(", ")}: ${r.imported} games, ${r.graded} picks graded.`, kind: "success" });
      } catch (e) { msg(syncM, e.message); ev.target.disabled = false; }
    });
    document.getElementById("sync-all").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      let total = 0;
      try {
        for (let w = 1; w <= 18; w++) {
          msg(syncM, `Importing week ${w} of 18…`, "success");
          total += (await api("/api/admin/sync", { week: w })).imported;
        }
        await renderAdmin({ text: `Imported ${total} games for the full season.`, kind: "success" });
      } catch (e) { msg(syncM, e.message); ev.target.disabled = false; }
    });
    app.querySelectorAll("button[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const { act, entry, user, name } = b.dataset;
        try {
          if (act === "eliminate") {
            const w = prompt("Eliminated in which week?", week ?? "");
            if (!w) return;
            await api("/api/admin/eliminate", { entryId: entry, week: Number(w) });
          } else if (act === "reinstate") {
            await api("/api/admin/eliminate", { entryId: entry, week: null });
          } else if (act === "reset") {
            const pw = prompt(`New temporary password for ${name} (at least 6 characters):`);
            if (!pw) return;
            await api("/api/admin/reset-password", { userId: user, password: pw });
            return renderAdmin({ text: `Password reset for ${name}. Send them the new password.`, kind: "success" });
          } else if (act === "remove") {
            if (!confirm(`Remove ${name} and all their picks? This can't be undone.`)) return;
            await api("/api/admin/remove", { userId: user });
          }
          await renderAdmin();
        } catch (e) { renderAdmin({ text: e.message, kind: "error" }); }
      }),
    );
  }

  render().catch(showError);
})();
