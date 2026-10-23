import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { HttpClient, HttpError } from "../src/utils/http.js";
import { ProviderProtectionManager } from "../src/utils/provider-limiter.js";

const realFetch = globalThis.fetch;

function stubFetch(status: number) {
  const fetchMock = mock.fn(
    async () => new Response("{}", { status, statusText: "stub" }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("HttpClient retries", () => {
  it("does not retry a 404", async () => {
    const fetchMock = stubFetch(404);
    await assert.rejects(
      HttpClient.get("https://api.deezer.com/track/1", { bypassLimiter: true }),
      (err: unknown) => err instanceof HttpError && err.status === 404,
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it("retries a 503", async () => {
    const fetchMock = stubFetch(503);
    await assert.rejects(
      HttpClient.get("https://api.deezer.com/track/1", {
        bypassLimiter: true,
        retries: 1,
      }),
      (err: unknown) => err instanceof HttpError && err.status === 503,
    );
    assert.equal(fetchMock.mock.callCount(), 2);
  });
});

describe("provider limiter health", () => {
  const notFound = () =>
    new HttpError("HTTP 404: Not Found", 404, "Not Found", "https://x");
  const serverError = () =>
    new HttpError("HTTP 500: Server Error", 500, "Server Error", "https://x");

  it("does not count 4xx answers as provider failures", () => {
    const manager = new ProviderProtectionManager();
    for (let i = 0; i < 10; i++) manager.recordFailure("deezer", notFound());
    const metrics = manager.getLimiter("deezer").getMetrics();
    assert.equal(metrics.state, "HEALTHY");
    assert.equal(metrics.totalFailures, 0);
  });

  it("marks a provider degraded after repeated server errors", () => {
    const manager = new ProviderProtectionManager();
    for (let i = 0; i < 5; i++) manager.recordFailure("deezer", serverError());
    assert.equal(manager.getState("deezer"), "DEGRADED");
  });

  it("a 404 during the half-open probe restores the provider", () => {
    const manager = new ProviderProtectionManager();
    const limiter = manager.getLimiter("deezer");
    limiter.triggerCooldown(60, "test");
    // Pretend the cooldown elapsed
    (limiter as unknown as { cooldownEndsAt: number }).cooldownEndsAt = 0;
    assert.equal(limiter.getState(), "HALF_OPEN");
    manager.recordFailure("deezer", notFound());
    assert.equal(limiter.getState(), "HEALTHY");
    limiter.reset();
  });

  it("still cools down on a 429", () => {
    const manager = new ProviderProtectionManager();
    const tooMany = new HttpError(
      "HTTP 429: Too Many Requests",
      429,
      "Too Many Requests",
      "https://x",
    );
    manager.recordFailure("deezer", tooMany);
    assert.equal(manager.getState("deezer"), "COOLDOWN");
    manager.getLimiter("deezer").reset();
  });
});
