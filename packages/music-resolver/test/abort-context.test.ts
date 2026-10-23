import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  currentAbortSignal,
  runWithAbortSignal,
} from "../src/utils/abort-context.js";
import { HttpClient } from "../src/utils/http.js";
import { ProviderProtectionManager } from "../src/utils/provider-limiter.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("caller cancellation", () => {
  it("HttpClient does not start a request for an aborted caller", async () => {
    const fetchMock = mock.fn(async () => new Response("{}"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const caller = new AbortController();
    caller.abort();
    await assert.rejects(
      runWithAbortSignal(caller.signal, () =>
        HttpClient.get("https://api.deezer.com/track/1", { bypassLimiter: true }),
      ),
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("HttpClient stops retrying once the caller aborts mid-request", async () => {
    const fetchMock = mock.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(init.signal!.reason),
          );
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const caller = new AbortController();
    const request = runWithAbortSignal(caller.signal, () =>
      HttpClient.get("https://api.deezer.com/track/1", { bypassLimiter: true }),
    );
    setTimeout(() => caller.abort(new Error("client gone")), 10);
    await assert.rejects(request, /client gone/);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it("drops a queued task when its caller aborts", async () => {
    const manager = new ProviderProtectionManager();
    const limiter = manager.getLimiter("musixmatch"); // concurrency 2
    const gates = [deferred(), deferred()];
    const running = gates.map((g) => manager.schedule("musixmatch", () => g.promise));

    const caller = new AbortController();
    const queuedTask = mock.fn(async () => "ran");
    const queued = runWithAbortSignal(caller.signal, () =>
      manager.schedule("musixmatch", queuedTask),
    );
    assert.equal(limiter.getMetrics().queueLength, 1);

    caller.abort(new Error("client gone"));
    await assert.rejects(queued, /client gone/);
    assert.equal(limiter.getMetrics().queueLength, 0);

    gates.forEach((g) => g.resolve());
    await Promise.all(running);
    assert.equal(queuedTask.mock.callCount(), 0);
  });

  it("an aborted caller's failure does not count against the provider", async () => {
    const manager = new ProviderProtectionManager();
    const caller = new AbortController();
    const task = runWithAbortSignal(caller.signal, () =>
      manager.schedule("deezer", () => {
        caller.abort();
        return Promise.reject(new Error("aborted"));
      }),
    );
    await assert.rejects(task);
    assert.equal(manager.getLimiter("deezer").getMetrics().totalFailures, 0);
  });

  it("queued tasks run with their own caller's signal", async () => {
    const manager = new ProviderProtectionManager();
    const limiter = manager.getLimiter("musixmatch"); // concurrency 2
    const blocker = deferred();
    const blockerTask = manager.schedule("musixmatch", () => blocker.promise);

    const a = new AbortController();
    const b = new AbortController();
    const gateA = deferred();
    const taskA = runWithAbortSignal(a.signal, () =>
      manager.schedule("musixmatch", () => gateA.promise),
    );
    let seenByB: AbortSignal | undefined;
    // B is queued and gets started by A's completion
    const taskB = runWithAbortSignal(b.signal, () =>
      manager.schedule("musixmatch", async () => {
        seenByB = currentAbortSignal();
      }),
    );
    assert.equal(limiter.getMetrics().queueLength, 1);

    gateA.resolve();
    await Promise.all([taskA, taskB]);
    assert.equal(seenByB, b.signal);
    blocker.resolve();
    await blockerTask;
  });
});
