#!/usr/bin/env python3
"""
refresh-local-token.py — one-shot Method-1 refresh-token regenerator.

Two things this script does, in order:

1. Runs Google's installed-app OAuth flow on a pinned loopback port to obtain
   a fresh refresh token, then writes it into google-ads.yaml in your current
   working directory.

2. **Also writes the new refresh token (plus client_secret and developer_token)
   into the Gemini extension's `.env` file at
   `~/.gemini/extensions/google-ads-agent/.env`** if that file exists. This is
   critical because the Gemini MCP server reads
   `process.env.GOOGLE_ADS_REFRESH_TOKEN` at startup — it does NOT read
   google-ads.yaml. Without step 2, the extension keeps using whatever the OS
   keychain (set by `gemini extensions config google-ads-agent`) holds, which
   is usually the stale token that triggered `invalid_grant` in the first
   place. `.env` values override the keychain.

When to use this script:
- You're hitting `invalid_grant` errors from the Google Ads API (Method 1)
- Your stored refresh token has expired (default after 6 months of inactivity,
  immediate after password change or consent revocation)
- You want to switch the Method 1 lane to a different Google identity

Usage (run from the directory that contains google-ads.yaml):
    python refresh-local-token.py

Requirements (one-time):
    pip install google-auth-oauthlib pyyaml

Cloud Console requirement:
- Your OAuth client's "Authorized redirect URIs" must include
  `http://localhost:8081/` (with the trailing slash). Without it Google rejects
  the callback with `redirect_uri_mismatch`. Edit the client at
  https://console.cloud.google.com/apis/credentials and add the URI if missing.
- "Web application" client type is fine — that one URI is enough.

After the script finishes:
- Restart Gemini (`/quit` then `gemini`) so the MCP server re-reads `.env`.
- For Python projects (Buddy, google-ads-python, etc.) the new token in
  google-ads.yaml is picked up automatically on next `GoogleAdsClient.load_from_storage()`.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Missing deps. Install with:\n  pip install google-auth-oauthlib pyyaml")
    sys.exit(1)

YAML_PATH = Path.cwd() / "google-ads.yaml"
SCOPES = ["https://www.googleapis.com/auth/adwords"]

# Must match an entry in the OAuth client's Authorized redirect URIs in
# Google Cloud Console. We pin to port 8081 because Google's installed-app
# library generates `http://localhost:8081/` (with trailing slash), and that
# exact form must be registered server-side.
LOCAL_REDIRECT_PORT = 8081

# Standard install location of the Gemini extension. If your install path
# differs (e.g. dev-linked via `gemini extensions link`), set GADS_EXT_ENV in
# the environment to the absolute path of the .env to write.
GEMINI_EXT_ENV = Path.home() / ".gemini" / "extensions" / "google-ads-agent" / ".env"


def upsert_env(env_path: Path, values: dict[str, str]) -> None:
    """Idempotent in-place upsert of KEY=value lines in a dotenv file."""
    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    lines = text.splitlines()
    if not any("Method 1 sensitive credentials" in line for line in lines):
        if lines and lines[-1].strip() != "":
            lines.append("")
        lines.append("# Method 1 sensitive credentials (synced from google-ads.yaml)")
        lines.append("# These override any stale values in the OS keychain. Re-run")
        lines.append("# refresh-local-token.py whenever the refresh token rotates.")
        lines.append("# /quit + relaunch Gemini afterward to pick up changes.")
    for key, val in values.items():
        pattern = re.compile(rf"^{re.escape(key)}=.*$")
        replaced = False
        for i, line in enumerate(lines):
            if pattern.match(line):
                lines[i] = f"{key}={val}"
                replaced = True
                break
        if not replaced:
            lines.append(f"{key}={val}")
    env_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    if not YAML_PATH.exists():
        print(f"ERROR: google-ads.yaml not found in {Path.cwd()}")
        print("Run this script from the directory that contains google-ads.yaml,")
        print("or create one from the Google Ads Python client template:")
        print("  https://github.com/googleads/google-ads-python/blob/main/google-ads.yaml")
        return 1

    cfg = yaml.safe_load(YAML_PATH.read_text())
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")
    if not client_id or not client_secret:
        print("ERROR: client_id / client_secret missing in google-ads.yaml.")
        return 1

    flow = InstalledAppFlow.from_client_config(
        {
            "installed": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": ["http://localhost"],
            }
        },
        scopes=SCOPES,
    )

    print(f"Opening browser for Google sign-in (callback on port {LOCAL_REDIRECT_PORT})...")
    print("Pick the Google account that owns / has access to your MCC.\n")
    print(f"NOTE: If you get `redirect_uri_mismatch`, add `http://localhost:{LOCAL_REDIRECT_PORT}/`")
    print("      to your OAuth client's Authorized redirect URIs at")
    print("      https://console.cloud.google.com/apis/credentials\n")

    creds = flow.run_local_server(
        port=LOCAL_REDIRECT_PORT,
        prompt="consent",
        access_type="offline",
        open_browser=True,
    )

    if not creds.refresh_token:
        print("ERROR: No refresh_token returned. Did you already grant consent?")
        print("Visit https://myaccount.google.com/permissions, remove the app, then re-run.")
        return 1

    # Step 1 — write the new refresh token into google-ads.yaml.
    cfg["refresh_token"] = creds.refresh_token
    YAML_PATH.write_text(yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False))
    print(f"\n✓ Wrote new refresh_token to {YAML_PATH}")
    print(f"  refresh_token: {creds.refresh_token[:18]}…(redacted)")

    # Step 2 — sync the sensitive trio into the Gemini extension's .env so the
    # MCP server's `process.env.GOOGLE_ADS_REFRESH_TOKEN` sees the new value.
    # This step is idempotent: rerunning is safe and never duplicates lines.
    import os
    ext_env = Path(os.environ["GADS_EXT_ENV"]) if os.environ.get("GADS_EXT_ENV") else GEMINI_EXT_ENV
    if ext_env.exists():
        sync = {
            "GOOGLE_ADS_DEVELOPER_TOKEN": cfg.get("developer_token") or "",
            "GOOGLE_ADS_CLIENT_SECRET":   cfg.get("client_secret") or "",
            "GOOGLE_ADS_REFRESH_TOKEN":   cfg["refresh_token"],
        }
        if all(sync.values()):
            upsert_env(ext_env, sync)
            print(f"\n✓ Synced credentials to Gemini extension .env")
            print(f"  file: {ext_env}")
            print("  These override the OS keychain at MCP server startup.")
        else:
            print("\n⚠ Skipped extension .env sync — google-ads.yaml is missing")
            print("   developer_token or client_secret. Add them and rerun.")
    else:
        print(f"\nℹ Gemini extension .env not found at {ext_env}")
        print("  If you use the google-ads-agent extension elsewhere, set")
        print("  `GADS_EXT_ENV=/path/to/.env` and rerun, or run")
        print("  `gemini extensions config google-ads-agent` and paste the new token.")

    print("\nNext steps:")
    print("  1. Restart Gemini CLI: `/quit` then `gemini`")
    print("  2. Verify with `connection_status` and a real call like")
    print("     `account_health` against a leaf account.")
    print("\nTest from Python (Buddy / google-ads-python):")
    print("  python -c \"from google.ads.googleads.client import GoogleAdsClient;"
          " c=GoogleAdsClient.load_from_storage('google-ads.yaml');"
          " print('OK', c.login_customer_id)\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
