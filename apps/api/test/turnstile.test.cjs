const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const { ForbiddenException } = require("@nestjs/common");
const { TurnstileService } = require("../dist/turnstile/turnstile.service.js");

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

function serviceWith(env, siteverifyResult) {
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_HOSTNAMES;
  Object.assign(process.env, env);
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: init.body.toString() });
    return { ok: true, json: async () => siteverifyResult };
  };
  return { service: new TurnstileService(), calls };
}

const enabledEnv = {
  TURNSTILE_SITE_KEY: "site",
  TURNSTILE_SECRET_KEY: "secret",
  TURNSTILE_HOSTNAMES: "lyricsdb.example.com",
};

test("empty secret disables checks without calling siteverify", async () => {
  const { service, calls } = serviceWith({ TURNSTILE_SITE_KEY: "site" }, {});
  assert.equal(service.isEnabled(), false);
  assert.equal(service.getPublicSiteKey(), null);
  await service.verify(undefined, "verify-track");
  assert.equal(calls.length, 0);
});

test("accepts a successful token for the expected action and hostname", async () => {
  const { service, calls } = serviceWith(enabledEnv, {
    success: true,
    action: "verify-track",
    hostname: "lyricsdb.example.com",
  });
  assert.equal(service.getPublicSiteKey(), "site");
  await service.verify("token", "verify-track", "1.2.3.4");
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, /remoteip=1\.2\.3\.4/);
});

test("rejects missing tokens, wrong actions and foreign hostnames", async () => {
  const cases = [
    [undefined, { success: true, action: "verify-track", hostname: "lyricsdb.example.com" }],
    ["token", { success: false, "error-codes": ["timeout-or-duplicate"] }],
    ["token", { success: true, action: "other", hostname: "lyricsdb.example.com" }],
    ["token", { success: true, action: "verify-track", hostname: "evil.example.com" }],
  ];
  for (const [token, result] of cases) {
    const { service } = serviceWith(enabledEnv, result);
    await assert.rejects(
      service.verify(token, "verify-track"),
      ForbiddenException,
    );
  }
});

test("fails closed when siteverify is unreachable", async () => {
  const { service } = serviceWith(enabledEnv, {});
  global.fetch = async () => {
    throw new Error("network down");
  };
  await assert.rejects(service.verify("token", "verify-track"), ForbiddenException);
});
