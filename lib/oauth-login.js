/**
 * Proxy sign-in for the Remote (ahmeego.com) backend.
 *
 * The CLI delegates the entire Google OAuth dance to ahmeego.com, which
 * already has an approved, verified OAuth client. This means:
 *   - Zero Cloud Console setup for the user.
 *   - No client ID, client secret, or refresh token ever touches the CLI.
 *   - Works with ANY Google account that has Google Ads access.
 *
 * Flow:
 *   1. Generate a random, RFC 4122 v4 device_id.
 *   2. Open the user's default browser to:
 *        ${siteUrl}/api/auth/mobile-login?device_id=<id>&client=cli
 *      The site stores { deviceId, client: "cli" } in short-lived KV state
 *      and 302-redirects to Google's consent screen.
 *   3. User signs in with any Google account. The site's callback
 *      (/api/auth/mobile-callback) exchanges the code, discovers Google Ads
 *      accounts, creates an opaque sessionId, and writes
 *        mobile_auth_<device_id> -> { sessionId, email, name, avatar }
 *      to KV with a 5-minute TTL. For client=cli it renders a "you can close
 *      this tab" page with no mobile deep-link.
 *   4. CLI polls ${siteUrl}/api/auth/mobile-poll?device_id=<id> until it
 *      returns the session payload (200) or times out (default 120s).
 *   5. Session id is persisted via lib/session-store.js.
 *
 * Security:
 *   - device_id is a per-login random UUID; the handle self-destructs on
 *     first read (see functions/api/auth/mobile-poll.js).
 *   - No secrets are transferred over the loopback or query string — only
 *     the opaque sessionId that ahmeego.com mints.
 *   - The CLI never sees Google access/refresh tokens — they stay
 *     encrypted on the site side under auth:<sessionId>.
 */

import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { URLSearchParams } from "url";

const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

function uuidv4() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open"
    : platform === "win32" ? "cmd"
      : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.unref();
    return true;
  } catch (_) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run the proxy login flow.
 *
 * @param {Object} opts
 * @param {string} opts.siteUrl       - Base URL of ahmeego.com deployment.
 * @param {number} [opts.timeoutMs]   - Max time to wait for user to sign in.
 * @param {number} [opts.pollIntervalMs]
 * @param {(url: string) => void} [opts.onPrompt] - Called with the auth URL so
 *   the caller can print a manual-click fallback while the browser opens.
 * @returns {Promise<{ sessionId: string, email: string|null, name: string|null, avatar: string|null, accountsCount: number|null }>}
 */
export async function runLoginFlow({
  siteUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = POLL_INTERVAL_MS,
  onPrompt = null,
  _fetch = globalThis.fetch,
} = {}) {
  if (!siteUrl) {
    throw new Error("Remote site URL missing. Set GADS_SITE_URL in your extension .env (e.g., https://ahmeego.com).");
  }
  const base = siteUrl.replace(/\/+$/, "");
  const deviceId = uuidv4();

  const authUrl = `${base}/api/auth/mobile-login?${new URLSearchParams({
    device_id: deviceId,
    client: "cli",
  }).toString()}`;

  if (onPrompt) onPrompt(authUrl);
  openInBrowser(authUrl);

  const started = Date.now();
  const deadline = started + timeoutMs;
  const pollUrl = `${base}/api/auth/mobile-poll?${new URLSearchParams({ device_id: deviceId }).toString()}`;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    let resp;
    try {
      resp = await _fetch(pollUrl, { headers: { accept: "application/json" } });
    } catch (_) {
      continue;
    }
    if (resp.status === 202) continue;
    let data = null;
    try { data = await resp.json(); } catch (_) { /* fall through */ }

    if (resp.status >= 400) {
      const msg = (data && data.error) || resp.statusText || `HTTP ${resp.status}`;
      throw new Error(`Sign-in failed: ${msg}`);
    }
    if (data && data.sessionId) {
      return {
        sessionId: data.sessionId,
        email: data.email || null,
        name: data.name || null,
        avatar: data.avatar || null,
        accountsCount: typeof data.accountsCount === "number" ? data.accountsCount : null,
      };
    }
  }
  throw new Error(`Sign-in timed out after ${Math.round(timeoutMs / 1000)}s — no response from ${base}/api/auth/mobile-poll.`);
}

/**
 * Delete the remote session on the server so the opaque sessionId can't be
 * reused. Best-effort — a 404/expired response is treated as success because
 * the session is already effectively gone.
 *
 * Note: this does NOT revoke the user's Google grant. To fully revoke access
 * the user should visit https://myaccount.google.com/permissions.
 */
export async function deleteRemoteSession(siteUrl, sessionId, _fetch = globalThis.fetch) {
  if (!siteUrl || !sessionId) return false;
  const base = siteUrl.replace(/\/+$/, "");
  try {
    const resp = await _fetch(`${base}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout", sessionId }),
    });
    return resp.ok || resp.status === 404;
  } catch (_) {
    return false;
  }
}

/**
 * Backward-compatible shim for v2.3 code paths that imported
 * `revokeRefreshToken` from this module. v2.4+ no longer holds refresh
 * tokens in the CLI, so this is a no-op that returns true.
 */
export async function revokeRefreshToken(_refreshToken) {
  return true;
}
