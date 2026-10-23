import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  getDeezerJwt,
  refreshDeezerJwt,
  resetTokenCache,
} from "../dist/jwt-manager.js";

const realFetch = globalThis.fetch;

function fakeDb(rows = []) {
  const calls = { selects: 0, upserts: [] };
  const client = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            calls.selects++;
            return rows;
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values) => ({
        onConflictDoUpdate: async () => {
          calls.upserts.push(values);
        },
      }),
    }),
  };
  return { client, calls };
}

function stubDeezerAuth({ fail = false, delayMs = 0 } = {}) {
  let issued = 0;
  const fetchMock = mock.fn(async () => {
    await sleep(delayMs);
    if (fail) return new globalThis.Response("", { status: 503 });
    issued++;
    return globalThis.Response.json({ jwt: `token-${issued}` });
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => resetTokenCache());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("token cache", () => {
  it("concurrent callers share one refresh", async () => {
    const fetchMock = stubDeezerAuth({ delayMs: 10 });
    const { client, calls } = fakeDb();
    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => getDeezerJwt(client)),
    );
    assert.deepEqual(new Set(tokens), new Set(["token-1"]));
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(calls.upserts.length, 1);
  });

  it("serves later calls from memory without a DB read", async () => {
    stubDeezerAuth();
    const { client, calls } = fakeDb();
    await getDeezerJwt(client);
    const selectsAfterFirst = calls.selects;
    assert.equal(await getDeezerJwt(client), "token-1");
    assert.equal(calls.selects, selectsAfterFirst);
  });

  it("uses a valid DB token and caches it", async () => {
    const fetchMock = stubDeezerAuth();
    const { client, calls } = fakeDb([
      { provider: "deezer", token: "db-token", expireAt: new Date(Date.now() + 60_000) },
    ]);
    assert.equal(await getDeezerJwt(client), "db-token");
    assert.equal(await getDeezerJwt(client), "db-token");
    assert.equal(calls.selects, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("a forced refresh replaces the cached token", async () => {
    stubDeezerAuth();
    const { client } = fakeDb();
    assert.equal(await getDeezerJwt(client), "token-1");
    assert.equal(await refreshDeezerJwt(client), "token-2");
    assert.equal(await getDeezerJwt(client), "token-2");
  });

  it("backs off briefly after a failed refresh", async () => {
    const fetchMock = stubDeezerAuth({ fail: true });
    const { client } = fakeDb();
    await assert.rejects(getDeezerJwt(client));
    await assert.rejects(getDeezerJwt(client));
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});
