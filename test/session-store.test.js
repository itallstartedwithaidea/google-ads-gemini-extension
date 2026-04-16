/**
 * Tests for lib/session-store.js.
 *
 * Exercises both the v2.4 slim payload (sessionId only) and the v2.3
 * backward-compat payload (sessionId + refreshToken). Run: `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = dirname(__dirname);
const META = join(EXT_ROOT, "sessions.json");
const SECRETS = join(EXT_ROOT, "sessions.secrets.json");

function cleanup() {
  for (const p of [META, SECRETS]) {
    if (existsSync(p)) rmSync(p);
  }
}

test("session-store: v2.4 slim save -> getActive -> switch -> remove roundtrip", async (t) => {
  cleanup();
  t.after(cleanup);

  const store = await import("../lib/session-store.js");

  const saveA = await store.save({
    email: "alice@example.com",
    sessionId: "sid_alice",
    accountsCount: 3,
  });
  assert.equal(saveA.active, "alice@example.com");
  assert.ok(["keychain", "file"].includes(saveA.backend));

  let list = await store.listIdentities();
  assert.equal(list.active, "alice@example.com");
  assert.equal(list.identities.length, 1);
  assert.equal(list.identities[0].accountsCount, 3);

  const active = await store.getActive();
  assert.equal(active?.email, "alice@example.com");
  assert.equal(active?.sessionId, "sid_alice");
  // v2.4 slim entries have no refresh token.
  assert.ok(!active?.refreshToken);

  await store.save({ email: "bob@example.com", sessionId: "sid_bob", accountsCount: 7 });
  list = await store.listIdentities();
  assert.equal(list.active, "bob@example.com");
  assert.equal(list.identities.length, 2);

  await store.setActive("alice@example.com");
  const backToAlice = await store.getActive();
  assert.equal(backToAlice?.email, "alice@example.com");

  await store.updateSessionId("alice@example.com", "sid_alice_v2");
  const rotated = await store.getActive();
  assert.equal(rotated?.sessionId, "sid_alice_v2");

  await store.remove("alice@example.com");
  list = await store.listIdentities();
  assert.equal(list.active, "bob@example.com");
  assert.equal(list.identities.length, 1);

  await store.remove("bob@example.com");
  list = await store.listIdentities();
  assert.equal(list.active, null);
  assert.equal(list.identities.length, 0);
});

test("session-store: v2.3 payload keeps refreshToken readable (backward-compat)", async (t) => {
  cleanup();
  t.after(cleanup);
  const store = await import("../lib/session-store.js");

  await store.save({
    email: "legacy@example.com",
    sessionId: "sid_legacy",
    refreshToken: "rt_legacy",
    accountsCount: 5,
  });

  const active = await store.getActive();
  assert.equal(active?.email, "legacy@example.com");
  assert.equal(active?.sessionId, "sid_legacy");
  assert.equal(active?.refreshToken, "rt_legacy");

  await store.remove("legacy@example.com");
});

test("session-store: re-save with no refreshToken silently drops a v2.3 token", async (t) => {
  cleanup();
  t.after(cleanup);
  const store = await import("../lib/session-store.js");

  await store.save({
    email: "migrate@example.com",
    sessionId: "sid_old",
    refreshToken: "rt_old",
    accountsCount: 1,
  });
  let active = await store.getActive();
  assert.equal(active?.refreshToken, "rt_old");

  // Simulate a v2.4 re-login for the same email.
  await store.save({
    email: "migrate@example.com",
    sessionId: "sid_new",
    accountsCount: 2,
  });
  active = await store.getActive();
  assert.equal(active?.sessionId, "sid_new");
  assert.ok(!active?.refreshToken, "refreshToken should be dropped on v2.4 re-save");

  await store.remove("migrate@example.com");
});

test("session-store: getIdentity returns null for unknown email", async () => {
  cleanup();
  const store = await import("../lib/session-store.js");
  const id = await store.getIdentity("nobody@example.com");
  assert.equal(id, null);
});

test("session-store: save requires email and sessionId", async () => {
  const store = await import("../lib/session-store.js");
  await assert.rejects(() => store.save({}), /email is required/);
  await assert.rejects(() => store.save({ email: "x@y.z" }), /sessionId is required/);
});
