/**
 * OAuth 2.0 + PKCE loopback sign-in for the Remote (googleadsagent.ai) backend.
 *
 * Flow (RFC 7636 + RFC 8252):
 *   1. Generate PKCE verifier/challenge and CSRF state.
 *   2. Start an ephemeral loopback HTTP server on 127.0.0.1.
 *   3. Open the user's default browser to the Google OAuth consent page.
 *   4. User signs in with ANY Google account that has Google Ads access.
 *   5. Google redirects back to http://127.0.0.1:<port>/callback with code+state.
 *   6. Exchange code for tokens at https://oauth2.googleapis.com/token
 *      (no client secret required — PKCE proves we initiated the flow).
 *   7. Decode id_token to learn the user's email.
 *   8. Mint a googleadsagent.ai session via POST /api/auth
 *      { action: "create_api_session", refreshToken }.
 *
 * Security notes:
 *   - No client secret is shipped. We rely on PKCE (S256).
 *   - State parameter is verified to mitigate CSRF.
 *   - Loopback binds only to 127.0.0.1 on an ephemeral port and shuts down
 *     after one successful callback or a 120s timeout.
 *   - Tokens are NEVER logged. The caller is responsible for storing them
 *     via lib/session-store.js (which prefers the OS keychain).
 */

import { createServer } from "http";
import { createHash, randomBytes } from "crypto";
import { spawn } from "child_process";
import { URL, URLSearchParams } from "url";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "openid",
  "email",
].join(" ");

const DEFAULT_TIMEOUT_MS = 120_000;

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makePkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function decodeJwtUnverified(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(payload);
  } catch (_) {
    return null;
  }
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

function htmlResponse(title, body, isSuccess = true) {
  const color = isSuccess ? "#188038" : "#d93025";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #fff; color: #202124; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; }
  .card { max-width: 480px; padding: 32px; border: 1px solid #dadce0; border-radius: 12px;
          text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  h1 { font-size: 22px; margin: 0 0 12px; color: ${color}; }
  p  { font-size: 15px; color: #5f6368; margin: 0; }
  code { background: #f1f3f4; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div>
<script>setTimeout(()=>window.close(), 2500);</script>
</body></html>`;
}

export async function runLoginFlow({
  clientId,
  siteUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onPrompt = null,
} = {}) {
  if (!clientId) {
    throw new Error("OAuth client ID missing. Set GOOGLE_ADS_CLIENT_ID or GADS_CLI_OAUTH_CLIENT_ID in your extension .env.");
  }
  if (!siteUrl) {
    throw new Error("Remote site URL missing. Set GADS_SITE_URL in your extension .env (e.g., https://googleadsagent.ai).");
  }

  const { verifier, challenge } = makePkce();
  const state = base64url(randomBytes(24));

  const { port, authCodePromise, close } = await startLoopback(state, timeoutMs);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString()}`;

  if (onPrompt) onPrompt(authUrl);
  openInBrowser(authUrl);

  let code;
  try {
    code = await authCodePromise;
  } finally {
    close();
  }

  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  });
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok || tokenData.error) {
    throw new Error(`Google token exchange failed: ${tokenData.error_description || tokenData.error || tokenResp.statusText}`);
  }
  const { access_token, refresh_token, id_token } = tokenData;
  if (!refresh_token) {
    throw new Error("Google did not return a refresh_token. Revoke prior consent at https://myaccount.google.com/permissions and retry.");
  }

  const claims = id_token ? decodeJwtUnverified(id_token) : null;
  const email = claims?.email || null;
  if (!email) {
    throw new Error("Could not determine email from id_token. Please retry sign-in.");
  }

  const sessionResp = await fetch(`${siteUrl.replace(/\/+$/, "")}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create_api_session", refreshToken: refresh_token }),
  });
  const sessionData = await sessionResp.json().catch(() => ({}));
  if (!sessionResp.ok || !sessionData.sessionId) {
    throw new Error(`Remote session mint failed: ${sessionData.error || sessionResp.statusText}`);
  }

  return {
    email,
    refreshToken: refresh_token,
    accessToken: access_token,
    sessionId: sessionData.sessionId,
    accountsCount: typeof sessionData.accounts === "number" ? sessionData.accounts : null,
  };
}

function startLoopback(expectedState, timeoutMs) {
  return new Promise((resolveStart, rejectStart) => {
    let settled = false;
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

    const server = createServer((req, res) => {
      try {
        const u = new URL(req.url, `http://127.0.0.1`);
        if (u.pathname !== "/callback") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        const code = u.searchParams.get("code");
        const state = u.searchParams.get("state");
        const err = u.searchParams.get("error");
        if (err) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlResponse("Sign-in cancelled", `Error: <code>${err}</code>. You can close this tab.`, false));
          rejectCode(new Error(`OAuth error: ${err}`));
          return;
        }
        if (!code || state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlResponse("Sign-in failed", "Invalid state or missing code. Please retry.", false));
          rejectCode(new Error("State mismatch or missing code — possible CSRF."));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(htmlResponse("Signed in", "You can close this tab and return to your terminal."));
        resolveCode(code);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error");
        rejectCode(e);
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        rejectCode(new Error(`Sign-in timed out after ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs);

    server.on("error", (e) => {
      if (!settled) {
        settled = true;
        rejectStart(e);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      settled = true;
      resolveStart({
        port: addr.port,
        authCodePromise: codePromise,
        close: () => {
          clearTimeout(timer);
          try { server.close(); } catch (_) {}
        },
      });
    });
  });
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return false;
  try {
    const resp = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}
