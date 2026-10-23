import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { HttpClient, HttpError } from "../src/utils/http.js";
import {
  globalProviderLimiter,
  ProviderProtectionManager,
  ProviderRateLimitedError,
} from "../src/utils/provider-limiter.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  globalProviderLimiter.resetAll();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function elapseCooldown(manager: ProviderProtectionManager, provider: string) {
  const limiter = manager.getLimiter(provider);
  (limiter as unknown as { cooldownEndsAt: number }).cooldownEndsAt = 0;
  return limiter;
}

const tooMany = () =>
  new HttpError("HTTP 429: Too Many Requests", 429, "Too Many Requests", "https://x");

describe("provider circuit breaker", () => {
  it("rejects immediately while cooling down", async () => {
    const manager = new ProviderProtectionManager();
    manager.triggerCooldown("deezer", 60, "test");
    const task = mock.fn(async () => "ok");
    await assert.rejects(
      manager.schedule("deezer", task),
      (err: unknown) => err instanceof ProviderRateLimitedError,
    );
    assert.equal(task.mock.callCount(), 0);
    manager.resetAll();
  });

  it("lets a single probe through in HALF_OPEN, then resumes full concurrency", async () => {
    const manager = new ProviderProtectionManager();
    manager.triggerCooldown("deezer", 60, "test");
    const limiter = elapseCooldown(manager, "deezer");
    assert.equal(limiter.getState(), "HALF_OPEN");

    const gates = [deferred(), deferred(), deferred()];
    const tasks = gates.map((gate) =>
      manager.schedule("deezer", () => gate.promise),
    );

    assert.equal(limiter.getMetrics().activeCount, 1);
    assert.equal(limiter.getMetrics().queueLength, 2);

    gates[0]!.resolve();
    await tasks[0];
    assert.equal(limiter.getState(), "HEALTHY");
    assert.equal(limiter.getMetrics().activeCount, 2);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all(tasks);
  });

  it("a 429 starts one base-length cooldown", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 429, statusText: "Too Many Requests" })) as typeof fetch;
    await assert.rejects(HttpClient.get("https://api.deezer.com/track/1"));
    const metrics = globalProviderLimiter.getLimiter("deezer").getMetrics();
    assert.equal(metrics.state, "COOLDOWN");
    assert.ok(metrics.remainingCooldownSeconds! <= 60);
  });

  it("concurrent 429s do not escalate the cooldown", () => {
    const manager = new ProviderProtectionManager();
    for (let i = 0; i < 4; i++) manager.recordFailure("deezer", tooMany());
    const metrics = manager.getLimiter("deezer").getMetrics();
    assert.equal(metrics.state, "COOLDOWN");
    assert.ok(metrics.remainingCooldownSeconds! <= 60);
    manager.resetAll();
  });

  it("a failed probe doubles the cooldown", () => {
    const manager = new ProviderProtectionManager();
    manager.recordFailure("deezer", tooMany());
    elapseCooldown(manager, "deezer").getState();
    manager.recordFailure("deezer", tooMany());
    const metrics = manager.getLimiter("deezer").getMetrics();
    assert.ok(metrics.remainingCooldownSeconds! > 60);
    manager.resetAll();
  });
});
