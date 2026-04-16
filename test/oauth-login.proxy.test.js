/**
 * Tests for lib/oauth-login.js proxy flow (v2.4).
 *
 * The login flow only needs:
 *   1. A site URL
 *   2. A fetch that returns 202 until the user finishes, then a session JSON
 * We stub fetch and skip the browser spawn (we don't assert on it; it runs
 * detached and stdio: "ignore" on darwin/linux/windows).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoginFlow, deleteRemoteSession } from "../lib/oauth-login.js";

function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    if (typeof next === "function") return next();
    const { status = 200, body = null, headers = {} } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      headers,
      async json() {
        if (body === null) throw new Error("no body");
        return typeof body === "string" ? JSON.parse(body) : body;
      },
    };
  };
  fn.calls = calls;
  return fn;
}

test("runLoginFlow: happy path — polls until sessionId arrives", async () => {
  const _fetch = mockFetch([
    { status: 202, body: { pending: true } },
    { status: 202, body: { pending: true } },
    {
      status: 200,
      body: {
        sessionId: "user-abc",
        email: "test@example.com",
        name: "Test User",
        avatar: "https://x/a.png",
      },
    },
  ]);

  const start = Date.now();
  const result = await runLoginFlow({
    siteUrl: "https://example.ai/",
    timeoutMs: 10_000,
    pollIntervalMs: 20,
    onPrompt: () => {},
    _fetch,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.sessionId, "user-abc");
  assert.equal(result.email, "test@example.com");
  assert.equal(result.name, "Test User");
  assert.ok(elapsed < 5_000, `flow should be fast (was ${elapsed}ms)`);

  const urls = _fetch.calls.map((c) => c.url);
  assert.ok(urls.every((u) => u.startsWith("https://example.ai/api/auth/mobile-poll?device_id=")));
  // Same device_id across all polls.
  const ids = urls.map((u) => new URL(u).searchParams.get("device_id"));
  assert.equal(new Set(ids).size, 1);
});

test("runLoginFlow: device_id is a random UUID v4 per call", async () => {
  const observed = [];
  const makeRun = () => {
    const _fetch = mockFetch([
      { status: 200, body: { sessionId: "sid_" + Math.random(), email: "x@y.z" } },
    ]);
    return runLoginFlow({
      siteUrl: "https://example.ai",
      timeoutMs: 5000,
      pollIntervalMs: 10,
      onPrompt: (u) => observed.push(new URL(u).searchParams.get("device_id")),
      _fetch,
    });
  };
  await makeRun();
  await makeRun();
  await makeRun();
  assert.equal(observed.length, 3);
  assert.equal(new Set(observed).size, 3, "each call should use a fresh device_id");
  for (const id of observed) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
});

test("runLoginFlow: throws on 400 with site error message", async () => {
  const _fetch = mockFetch([
    { status: 400, body: { error: "invalid device_id" } },
  ]);
  await assert.rejects(
    () => runLoginFlow({
      siteUrl: "https://example.ai",
      timeoutMs: 5000,
      pollIntervalMs: 10,
      onPrompt: () => {},
      _fetch,
    }),
    /Sign-in failed: invalid device_id/
  );
});

test("runLoginFlow: times out when user never completes", async () => {
  const _fetch = async () => ({
    ok: true, status: 202, statusText: "Accepted", headers: {},
    async json() { return { pending: true }; },
  });
  await assert.rejects(
    () => runLoginFlow({
      siteUrl: "https://example.ai",
      timeoutMs: 150,
      pollIntervalMs: 30,
      onPrompt: () => {},
      _fetch,
    }),
    /Sign-in timed out/
  );
});

test("runLoginFlow: requires siteUrl", async () => {
  await assert.rejects(
    () => runLoginFlow({ _fetch: async () => ({}) }),
    /Remote site URL missing/
  );
});

test("deleteRemoteSession: posts logout and treats 404 as success", async () => {
  const _fetch404 = mockFetch([{ status: 404, body: { error: "not found" } }]);
  assert.equal(await deleteRemoteSession("https://example.ai", "sid", _fetch404), true);

  const _fetch200 = mockFetch([{ status: 200, body: { ok: true } }]);
  assert.equal(await deleteRemoteSession("https://example.ai", "sid", _fetch200), true);

  const _fetch500 = mockFetch([{ status: 500, body: { error: "boom" } }]);
  assert.equal(await deleteRemoteSession("https://example.ai", "sid", _fetch500), false);

  // Missing args are best-effort no-ops.
  assert.equal(await deleteRemoteSession("", "sid"), false);
  assert.equal(await deleteRemoteSession("https://x", ""), false);
});
