# Changelog

All notable changes to the `google-ads-gemini-extension` (installed as `google-ads-agent`) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] — 2026-04-16

### Added
- **Zero-setup `/google-ads:login`.** The CLI now delegates the entire Google OAuth flow to [googleadsagent.ai](https://googleadsagent.ai), which already has an approved, verified OAuth client. No Google Cloud Console setup, no client IDs, no client secrets, no refresh tokens on the CLI — users just open the browser, pick any Google account, approve, and come back.
- **Site-side proxy endpoints** (`googleadsagent.ai`): `mobile-login.js` and `mobile-callback.js` now accept `?client=cli`, store it in short-lived KV state, and render a "you can close this tab" page on completion instead of a mobile deep-link.
- **`lib/oauth-login.js` → `deleteRemoteSession()`** — best-effort server-side session deletion on `/google-ads:logout` so an opaque session id can't outlive the sign-out.
- **`.env.example`** — template with Method 1 and Method 2 clearly separated; no `GADS_CLI_OAUTH_CLIENT_ID` noise.
- **`test/oauth-login.proxy.test.js`** — happy path + device_id uniqueness + error handling + timeouts + `deleteRemoteSession()` behavior with mocked site endpoints.
- **`test/session-store.test.js`** — additional coverage for v2.4 slim payloads (no refresh token) plus v2.3 backward-compatible payloads.

### Changed
- **`remote_login` tool** — rewritten around the proxy flow. No more PKCE loopback, no more `GADS_CLI_OAUTH_CLIENT_ID`, no more `GOOGLE_ADS_CLIENT_ID` required for Method 2.
- **`remote_switch` tool** — now validates the stored `sessionId` against the site before switching; falls back to v2.3 refresh-token mint if one is still on disk; otherwise prompts the user to `/google-ads:login` again.
- **`remote_logout` tool** — now calls `deleteRemoteSession()` on the site and instructs the user to visit `https://myaccount.google.com/permissions` to fully revoke Google access.
- **`session-store.save()`** — `refreshToken` is now optional; `sessionId` is the required secret. v2.3 identities with stored refresh tokens keep working for auto-refresh; on next save they migrate to the slimmer v2.4 record.
- **`autoRefreshSession()`** — v2.4 sign-ins no longer hit this path (site holds the refresh token under a 90-day session TTL); v2.3 identities with a stored refresh token still auto-refresh for backward compatibility.
- **`README.md`** + locale callouts — "Sign in in 30 seconds, any Google account" section rewritten; Method 1 vs Method 2 table; new "Auth Tools" section; migration notes for v2.2 and v2.3 users.
- **`commands/google-ads/login.toml`** — prompt rewritten to describe the proxy flow and forbid asking users for client IDs, refresh tokens, or session IDs.

### Fixed
- **OAuth policy error** on sign-in (`redirect_uri=http://127.0.0.1:XXXXX/callback` rejected because the extension's OAuth client was of type "Web application"). The proxy model eliminates the need for users to bring their own OAuth client at all.

### Security
- Google refresh tokens never touch the CLI — they stay encrypted on googleadsagent.ai under `auth:<sessionId>`.
- Per-login random UUID `device_id`; the polling handle self-destructs on first read (5-minute TTL).
- Only the opaque `sessionId` ever crosses back to the CLI; it's stored in the OS keychain via `keytar`, with a `0600`-permission gitignored file as fallback on systems without libsecret.

### Migration notes
- **v2.3 users**: no action required. Your existing `sessions.json` + keychain entries keep working. Running `/google-ads:login` for the same account silently upgrades that identity to the v2.4 record shape (refresh token removed from local storage).
- **v2.2 users and earlier**: run `/google-ads:login` once — that's it.
- Method 1 (static API credentials) is completely unchanged.

## [2.3.0] — 2026-04-16

### Added
- **Dual-lane sign-in.** Method 1 (static API credentials in `.env`) and Method 2 (browser OAuth with any Google account) now run side-by-side. Neither contaminates the other.
- **`/google-ads:login`** — one-command browser sign-in. Uses OAuth 2.0 + PKCE (RFC 7636) with a 127.0.0.1 loopback redirect (RFC 8252). No client secret shipped with the extension; no copy-pasting session IDs.
- **`/google-ads:switch <email>`** — hop between previously signed-in Google accounts with zero re-auth. Uses the refresh token already in your OS keychain.
- **`/google-ads:status`** — shows the state of both lanes side-by-side. Lists all stored Remote identities with account counts. Never prints tokens.
- **`/google-ads:logout [email]`** — revokes the refresh token at Google's revocation endpoint, deletes the keychain entry, removes the identity from `sessions.json`.
- **Multi-identity store** (`lib/session-store.js`) — saves multiple Google account identities keyed by email, with an `active` pointer. Secrets live in the OS keychain via `keytar` (macOS Keychain / Windows Credential Manager / Linux libsecret), with a `0600`-permission gitignored file as fallback.
- **PKCE OAuth loopback module** (`lib/oauth-login.js`) — cryptographically-random CSRF `state`, ephemeral loopback port, 120s timeout, auto-closing success page, never logs tokens.
- Four new MCP tools: `remote_login`, `remote_switch`, `remote_status`, `remote_logout`.
- `test/session-store.test.js` — three tests covering save/getActive/setActive/updateSessionId/remove roundtrip, argument validation, and unknown-email handling. Runs against whichever backend keytar selects.
- `npm test` script wired to `node --test`.

### Changed
- `autoRefreshSession()` now uses the **active identity's own** refresh token from the session store rather than silently reading `GOOGLE_ADS_REFRESH_TOKEN` (Method 1). This fixes a subtle cross-contamination where Method 1's refresh token was being used to mint Method 2 sessions.
- `SITE_SESSION` is now swappable at runtime via `setActiveSession()` — identities can be switched without restarting the MCP server.
- `package.json` description now leads with the dual-lane sign-in capability.

### Fixed
- `hooks/log-tool-call.js` — removed unresolved git merge conflict markers (`<<<<<<< HEAD` / `>>>>>>> f57ab3b`) that were causing the recurring `Hook(s) [audit-log] failed for event AfterTool` warning on every tool call. The hook now reliably writes audit entries and pipes stdin through on parse failure so the tool chain is never broken.

### Security
- Added OAuth 2.0 + PKCE sign-in flow with no shipped client secret.
- Added CSRF protection via random `state` parameter verified on callback.
- Added automatic token revocation at `oauth2.googleapis.com/revoke` on logout.
- Added `sessions.json` and `sessions.secrets.json` to `.gitignore` so refresh tokens never land in git.

### Migration
- **Backward compatible.** Existing users with `GADS_SITE_SESSION_ID` in their `.env` keep working — it's honored as a fallback when no identity is stored. Run `/google-ads:login` once to migrate into the keychain-backed store; afterward you can delete `GADS_SITE_SESSION_ID` from `.env`.
- `keytar` is an `optionalDependency`, so installs never fail on environments without native build tooling. The extension auto-falls-back to the `0600` file store when keytar can't load.

### Dependencies
- Added `keytar ^7.9.0` as `optionalDependencies`.

## [2.2.0] — 2026-04-14

### Added
- Dual-backend MCP server: local Google Ads API (existing) merged with remote googleadsagent.ai access for 700+ accounts.
- `GADS_SITE_URL` and `GADS_SITE_SESSION_ID` settings.
- `list_accounts` now deduplicates across Local + Remote sources.

## [2.1.0] — 2026-04-14

### Added
- 7 write tools with per-call confirmation gating.
- GAQL write-blocking hook (blocks non-SELECT operations).
- Audit logging hook writing to `~/.gemini/logs/google-ads-agent.log`.

[2.3.0]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.3.0
[2.2.0]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.2.0
[2.1.0]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.1.0
