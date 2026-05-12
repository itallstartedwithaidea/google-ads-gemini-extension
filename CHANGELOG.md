# Changelog

All notable changes to the `google-ads-gemini-extension` (installed as `google-ads-agent`) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.4] — 2026-05-12

### Fixed
- **`scripts/refresh-local-token.py` now actually fixes `invalid_grant` for the Gemini extension.** The v2.4.3 version only wrote the new refresh token to `google-ads.yaml`, which the extension's MCP server never reads — the server reads `process.env.GOOGLE_ADS_REFRESH_TOKEN`, populated from the OS keychain (or `~/.gemini/extensions/google-ads-agent/.env`). The script now performs a second step that idempotently upserts `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CLIENT_SECRET`, and `GOOGLE_ADS_DEVELOPER_TOKEN` into the extension's `.env` so the MCP server picks up the new token after a `/quit` and relaunch. `.env` overrides the keychain.
- **README Common Gotcha #3 corrected.** Previous wording implied running the script alone fixed `invalid_grant` for the Gemini extension; in reality v2.4.3 left the keychain stale. New wording clearly explains both storage locations (Python `google-ads.yaml` vs Node MCP env var / keychain) and the dual-update requirement, and points users at the v2.4.4 script that handles both automatically.
- **Troubleshooting table** has a new row for the case "Method 1 keeps showing `invalid_grant` even after running the refresh script" (pre-v2.4.4 script footgun).

### Added
- `GADS_EXT_ENV` environment variable lets users with a non-standard extension install path point the script at the correct `.env`. If unset, the script defaults to `~/.gemini/extensions/google-ads-agent/.env` and falls through gracefully when the file doesn't exist.
- The script's success output now spells out the post-run "Restart Gemini, then verify with `connection_status` plus a real call like `account_health`" sequence so users don't stop halfway.

### Migration
- No behavior changes for existing keychains. If you ran v2.4.3's script and are still seeing `invalid_grant`, just rerun the v2.4.4 script — it'll detect the stale keychain entry, write the override to `.env`, and your next Gemini restart will use the working token.

## [2.4.3] — 2026-05-12

### Added
- **`scripts/refresh-local-token.py`** — one-shot Method 1 refresh-token regenerator. Reads `client_id` / `client_secret` from `google-ads.yaml`, runs the InstalledAppFlow OAuth dance on a pinned port (`http://localhost:8081/` to match the most common Cloud Console registration), captures the new refresh token, and rewrites the YAML in place. Replaces the manual OAuth Playground click-fest from the previous setup guide.
- **README "TL;DR — The Two Commands That Solve Most Problems"** — front-loaded section explaining the universal `/quit` → `gemini` → `/google-ads:logout` → `/google-ads:login` recovery sequence and *why* a chat-level restart isn't enough.
- **README "First-Time Setup — Click by Click"** — literal step-by-step beginner walkthrough, including which buttons to click in Google's consent screens.
- **README "Common Gotchas" section** — five field-tested issues with root-cause explanations:
  1. "0 accounts available" right after login → MCP server captured `GADS_SITE_URL` at startup, full process restart needed
  2. `redirect_uri_mismatch` from the local-token script → Cloud Console "Authorized redirect URIs" missing `http://localhost:8081/` (with trailing slash)
  3. `invalid_grant` from Method 1 → refresh token lifecycle and how to regenerate
  4. "Sign-in timed out after 120s" but browser said "Success" → just re-run `/google-ads:login`
  5. "0 leaf accounts found" on an MCC → access scoping vs stale env distinction
- **Expanded Troubleshooting table** — pre-existing entries kept; added rows for `redirect_uri_mismatch`, "0 accounts available", "Site credentials unavailable", `invalid_grant`, "Sign-in timed out", and `tail -f` of the audit log.

### Changed
- Replaced the **"Getting Credentials → From OAuth Playground"** section with the helper-script path. Playground stays documented as a fallback.
- Step-by-step setup now explicitly tells users to add `http://localhost:8081/` to their OAuth client's Authorized redirect URIs during initial Cloud Console setup, so they avoid Common Gotcha #2 from the start.
- Extension structure tree in the README now lists `scripts/`.

### Migration
- No behavior changes. v2.4.2 keychains and configs work as-is. New script is purely additive.

## [2.4.2] — 2026-05-12

### Changed
- **Rebranded the proxy backend domain from `googleadsagent.ai` to `ahmeego.com`.** The previous domain remains live as a 301-redirect alias and continues to work for existing sessions; new installs should use the new domain. The Cloudflare Pages project, OAuth client, and API routes are unchanged — only the canonical hostname moved.
- `.env.example` default updated: `GADS_SITE_URL=https://ahmeego.com`.
- README, GEMINI.md, command prompts, and tool descriptions now reference `ahmeego.com`. CHANGELOG history (this file's prior entries) is preserved as-is for accurate version history.

### Migration
- **Existing users — no action required if you don't care about cosmetics.** Your current keychain session is still valid; the old domain still resolves.
- **To pick up the new domain locally:** edit `~/.gemini/extensions/google-ads-agent/.env` and set `GADS_SITE_URL=https://ahmeego.com`, then run `/google-ads:logout` followed by `/google-ads:login` to mint a fresh session against the new domain.

## [2.4.1] — 2026-04-16

### Fixed
- **`/google-ads:login` actually signs in now.** v2.4.0 shipped a proxy `lib/oauth-login.js` but left `server.js` and the four `.toml` command prompts wired to the v2.3 PKCE loopback flow — `remote_login` required a `clientId` env var that the proxy flow no longer uses, and it tried to persist a `refreshToken` the proxy flow never returns. All four command prompts now accurately describe the zero-setup browser-to-googleadsagent.ai flow.
- **`remote_switch`** now prefers the stored opaque sessionId (reused directly, valid for 90 days server-side). It falls back to minting a fresh session via `create_api_session` only for legacy v2.3 identities that still carry a refresh token, so v2.4 identities that were never given a refresh token no longer fail with "Session mint failed".
- **`remote_logout`** now calls googleadsagent.ai's `/api/auth` logout to invalidate the opaque session server-side. Google token revocation is still attempted for legacy v2.3 identities that carry a refresh token.
- `server.js` version string bumped to match `package.json` (was still `2.3.0`).

### Changed
- Tool descriptions for `remote_login`, `remote_switch`, `remote_logout` now describe the v2.4 proxy flow (no Cloud Console, no client IDs, no refresh tokens in the CLI, browser-to-site, opaque session only).

### Migration
- Fully backward compatible. v2.3 users with refresh tokens in the keychain continue to work; their identities upgrade to the slimmer session-only shape on next `/google-ads:login`.

## [2.4.0] — 2026-04-16

### Added
- **Zero-setup proxy sign-in.** `lib/oauth-login.js` now delegates the entire Google OAuth dance to googleadsagent.ai, which holds a verified OAuth client. Users sign in with ANY Google account — no Cloud Console project, no client IDs, no secrets ever touch the CLI. The Google refresh token stays encrypted on the site; the CLI only ever holds an opaque session ID.
- Site-side `client=cli` passthrough on `mobile-login`/`mobile-callback` (googleadsagent-site PR #42) so the existing mobile OAuth endpoints double as the CLI login transport.

### Changed
- `lib/session-store.save()` makes `refreshToken` optional — new sign-ins persist only `{ sessionId }`. v2.3 users auto-upgrade: existing refresh tokens are still read, but the next re-login drops them from storage.

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

[2.4.2]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.4.2
[2.4.4]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.4.4
[2.4.3]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.4.3
[2.4.1]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.4.1
[2.4.0]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.4.0
[2.3.0]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.3.0
[2.2.0]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.2.0
[2.1.0]: https://github.com/itallstartedwithaidea/google-ads-gemini-extension/releases/tag/v2.1.0
