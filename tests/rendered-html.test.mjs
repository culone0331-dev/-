import assert from "node:assert/strict";
import test from "node:test";

async function fetchRoute(path, init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html", ...(init.headers ?? {}) },
      ...init,
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the quiz racer top page", async () => {
  const response = await fetchRoute("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ピットイン・クイズレーサー<\/title>/);
  assert.match(
    html,
    /クイズに答えて車を改造し、レースに挑戦するお店向けゲーム。/,
  );
  assert.match(html, /welcome-page/);
  assert.match(html, /クイズに答えて/);
  assert.match(html, /車を育てよう。/);
  assert.match(html, /スタート/);

  // the app has grown past the starter's placeholder loading skeleton
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("renders the thirty second race demo page", async () => {
  const response = await fetchRoute("/demo");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /DEMO RACE/);
  assert.match(html, /demo-track/);
});

// Note: /api/garage-save imports the D1 binding via `cloudflare:workers`,
// which only resolves inside a real Workers runtime (wrangler/miniflare).
// It can't be exercised through a plain Node ESM import like the page
// routes above, so its validation logic is covered by manual/integration
// testing under `wrangler dev` instead.
