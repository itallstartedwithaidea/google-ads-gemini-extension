/**
 * Multi-identity session store for the Google Ads Agent extension.
 *
 * Stores one or more Google account identities that the user has signed
 * in with via the Remote backend (googleadsagent.ai).
 *
 * Non-secret metadata (email, addedAt, accountsCount, active pointer)
 * lives in `sessions.json` next to this file. Secrets (refreshToken,
 * sessionId) live in the OS keychain via `keytar` when available; if
 * keytar cannot load (e.g. Linux without libsecret), we fall back to
 * `sessions.secrets.json` with 0600 file permissions. Both files are
 * listed in .gitignore.
 */

import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = dirname(__dirname);
const META_FILE = join(EXT_ROOT, "sessions.json");
const SECRETS_FILE = join(EXT_ROOT, "sessions.secrets.json");

const KEYTAR_SERVICE = "gemini-google-ads-agent";

let _keytar = null;
let _keytarTried = false;

async function loadKeytar() {
  if (_keytarTried) return _keytar;
  _keytarTried = true;
  try {
    const mod = await import("keytar");
    _keytar = mod.default || mod;
    await _keytar.findCredentials(KEYTAR_SERVICE);
    return _keytar;
  } catch (_) {
    _keytar = null;
    return null;
  }
}

function readJsonSafe(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(path, data, restrictPerms = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  if (restrictPerms) {
    try { chmodSync(path, 0o600); } catch (_) { /* windows etc. */ }
  }
}

function readMeta() {
  return readJsonSafe(META_FILE, { active: null, identities: [] });
}

function writeMeta(meta) {
  writeJson(META_FILE, meta, false);
}

async function readSecrets() {
  const keytar = await loadKeytar();
  if (keytar) {
    const creds = await keytar.findCredentials(KEYTAR_SERVICE);
    const out = {};
    for (const c of creds) {
      try { out[c.account] = JSON.parse(c.password); } catch (_) {}
    }
    return out;
  }
  return readJsonSafe(SECRETS_FILE, {});
}

async function writeSecret(email, secret) {
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.setPassword(KEYTAR_SERVICE, email, JSON.stringify(secret));
    return "keychain";
  }
  const all = readJsonSafe(SECRETS_FILE, {});
  all[email] = secret;
  writeJson(SECRETS_FILE, all, true);
  return "file";
}

async function deleteSecret(email) {
  const keytar = await loadKeytar();
  if (keytar) {
    try { await keytar.deletePassword(KEYTAR_SERVICE, email); } catch (_) {}
  }
  const all = readJsonSafe(SECRETS_FILE, {});
  if (all[email]) {
    delete all[email];
    writeJson(SECRETS_FILE, all, true);
  }
}

export async function listIdentities() {
  const meta = readMeta();
  return {
    active: meta.active,
    identities: Array.isArray(meta.identities) ? meta.identities : [],
    backend: (await loadKeytar()) ? "keychain" : "file",
  };
}

export async function getActive() {
  const meta = readMeta();
  if (!meta.active) return null;
  const idx = (meta.identities || []).find((i) => i.email === meta.active);
  if (!idx) return null;
  const secrets = await readSecrets();
  const secret = secrets[meta.active];
  if (!secret) return null;
  return {
    email: idx.email,
    addedAt: idx.addedAt,
    accountsCount: idx.accountsCount,
    refreshToken: secret.refreshToken,
    sessionId: secret.sessionId,
  };
}

export async function getIdentity(email) {
  const meta = readMeta();
  const idx = (meta.identities || []).find((i) => i.email === email);
  if (!idx) return null;
  const secrets = await readSecrets();
  const secret = secrets[email];
  if (!secret) return null;
  return {
    email: idx.email,
    addedAt: idx.addedAt,
    accountsCount: idx.accountsCount,
    refreshToken: secret.refreshToken,
    sessionId: secret.sessionId,
  };
}

export async function save({ email, refreshToken, sessionId, accountsCount }) {
  if (!email) throw new Error("session-store.save: email is required");
  if (!refreshToken) throw new Error("session-store.save: refreshToken is required");
  const backend = await writeSecret(email, { refreshToken, sessionId: sessionId || null });

  const meta = readMeta();
  const identities = Array.isArray(meta.identities) ? meta.identities : [];
  const existing = identities.find((i) => i.email === email);
  if (existing) {
    existing.updatedAt = new Date().toISOString();
    if (typeof accountsCount === "number") existing.accountsCount = accountsCount;
  } else {
    identities.push({
      email,
      addedAt: new Date().toISOString(),
      accountsCount: typeof accountsCount === "number" ? accountsCount : null,
    });
  }
  meta.identities = identities;
  meta.active = email;
  writeMeta(meta);
  return { backend, active: email };
}

export async function setActive(email) {
  const meta = readMeta();
  const exists = (meta.identities || []).some((i) => i.email === email);
  if (!exists) throw new Error(`No stored identity for ${email} — run /google-ads:login first.`);
  meta.active = email;
  writeMeta(meta);
  return email;
}

export async function updateSessionId(email, sessionId) {
  const secrets = await readSecrets();
  const existing = secrets[email];
  if (!existing) return false;
  await writeSecret(email, { ...existing, sessionId });
  return true;
}

export async function remove(email) {
  await deleteSecret(email);
  const meta = readMeta();
  meta.identities = (meta.identities || []).filter((i) => i.email !== email);
  if (meta.active === email) meta.active = meta.identities[0]?.email || null;
  writeMeta(meta);
  return meta.active;
}

export async function backendInfo() {
  return {
    backend: (await loadKeytar()) ? "keychain" : "file",
    metaFile: META_FILE,
    secretsFile: SECRETS_FILE,
  };
}
