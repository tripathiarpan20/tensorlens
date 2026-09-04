import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
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

test("server-renders the Tensor Lens emissions dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Tensor Lens — Bittensor Emissions Lab/i);
  assert.match(html, /See where emission/);
  assert.match(html, /Gross allocation value gap/);
  assert.match(html, /Accounting comparison.*total TAO allocation.*miner liquidation value/i);
  assert.match(html, /NOT NET MARKET PRESSURE/i);
  assert.match(html, /GROSS GAP.*ACCOUNTING VIEW/i);
  assert.match(html, /Alpha injection after cap/);
  assert.match(html, /Net chain-buy pressure/);
  assert.match(html, /isometric height mesh/i);
  assert.match(html, /SHIFT \+ DRAG.*MOVE/i);
  assert.match(html, /X axis is miner burn.*Y axis is TAO emission.*Z axis is the modeled result/i);
  assert.match(html, /NET CHAIN-BUY PRESSURE.*DAY/i);
  assert.match(html, /MINER LIQUIDATION.*DAY/i);
  assert.match(html, /TOTAL TAO ALLOCATION.*DAY/i);
  assert.match(html, /value="10" selected="">SN<!-- -->10<!-- --> · <!-- -->Pareton/);
  assert.match(html, /TaoStats|TAOSTATS CONNECTION/);
  assert.match(html, /TAOSTATS CONNECTION/);
  assert.match(html, /HISTORICAL FALLBACK/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships finished metadata, data, and social preview", async () => {
  const [page, layout, packageJson, data] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/emission-data.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /IsometricSurface/);
  assert.match(page, /X · MINER BURN/);
  assert.match(page, /Y · TAO EMISSION/);
  assert.match(page, /calculateTaoShare/);
  assert.match(page, /\/api\/taostats\/snapshot/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /twitter/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(data, /export const SUBNETS/);
  assert.match(data, /"netuid": 128/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
