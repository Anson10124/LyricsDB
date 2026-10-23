const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ResolverService } = require("../dist/resolver/resolver.service.js");

function serviceWithLimiter() {
  const consumed = [];
  const limiter = { consume: (ip, type) => consumed.push([ip, type]) };
  const service = new ResolverService({}, limiter);
  service.resolver = { resolve: async () => ({ metadata: {}, links: {} }) };
  return { service, consumed };
}

test("direct resolver calls charge the client's uncached bucket", async () => {
  const { service, consumed } = serviceWithLimiter();
  await service.resolveUrl("https://open.spotify.com/track/x", undefined, undefined, "203.0.113.7");
  assert.deepEqual(consumed, [["203.0.113.7", "uncached"]]);
});

test("internal calls without a client IP do not charge a shared bucket", async () => {
  const { service, consumed } = serviceWithLimiter();
  for (let i = 0; i < 10; i++) {
    await service.resolveUrl("https://open.spotify.com/track/x");
  }
  assert.deepEqual(consumed, []);
});
