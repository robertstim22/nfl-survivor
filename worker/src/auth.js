// Username/password auth using PBKDF2 (Web Crypto) and bearer session tokens.

const ITERATIONS = 30000; // keeps sign-in within the free plan's per-request CPU budget
const SESSION_MS = 180 * 24 * 3600 * 1000;
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

export async function hashPassword(password, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(bits), salt };
}

export async function verifyPassword(password, hash, salt) {
  const { hash: candidate } = await hashPassword(password, salt);
  return timingSafeEqual(candidate, hash);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sha256 = async (s) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export async function createSession(db, userId) {
  const token = randomHex(32);
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_MS)
    .run();
  return token;
}

export async function getSessionUser(db, request) {
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256(m[1]), Date.now())
    .first();
}

export async function deleteSession(db, request) {
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer ([0-9a-f]{64})$/);
  if (m) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(m[1])).run();
}
