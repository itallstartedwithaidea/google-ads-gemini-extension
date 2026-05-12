#!/usr/bin/env python3
"""
refresh-local-token.py — one-shot Method-1 refresh-token regenerator.

Reads client_id / client_secret from google-ads.yaml in the current working
directory, runs Google's installed-app OAuth flow (pops a browser, captures the
redirect on a local loopback port), prints the new refresh token, and rewrites
google-ads.yaml in place so the next google-ads-api call works immediately.

When to use this:
- You're hitting `invalid_grant` errors from the Google Ads API
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

Notes:
- The Google account you sign in with MUST have access to whatever
  `login_customer_id` is set in google-ads.yaml.
- Refresh tokens are long-lived but get invalidated by:
    * 6 months of inactivity
    * password change on the Google account
    * revoking access at https://myaccount.google.com/permissions
    * issuing >50 new refresh tokens for the same client (oldest get evicted)
"""
from __future__ import annotations

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

    cfg["refresh_token"] = creds.refresh_token
    YAML_PATH.write_text(yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False))

    print(f"\n✓ Wrote new refresh_token to {YAML_PATH}")
    print(f"  refresh_token: {creds.refresh_token[:18]}…(redacted)")
    print("\nTest with:")
    print("  python -c \"from google.ads.googleads.client import GoogleAdsClient;"
          " c=GoogleAdsClient.load_from_storage('google-ads.yaml');"
          " print('OK', c.login_customer_id)\"")
    print("\nThen restart Gemini CLI (`/quit`, then `gemini`) so the MCP server")
    print("re-reads the updated credentials.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
