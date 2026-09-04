# Tensor Lens — Bittensor Emissions Lab

Tensor Lens gives subnet owners and miners a shared view of the same emissions
system. Explore how miner burn changes a subnet's burn-adjusted TAO share,
compare the daily value directed to the subnet with the alpha value earned by
miners, and see when the root-proportion alpha injection cap binds.

## One model, both sides of the subnet

- **Subnet owners** can test how burn strategy changes TAO allocation, net
  subnet value, and capped alpha injection across the full network.
- **Miners** can see how burn affects miner-side alpha value and why changes to
  one subnet alter every enabled subnet's share.
- **Both** can compare scenarios with the same assumptions, live inputs, and
  formulas instead of reasoning from separate headline metrics.

The net difference is deliberately subnet-first:

```text
subnet net value = TAO injection value − miner alpha value after burn
```

A positive result means TAO injection value is greater; a negative result means
miner alpha value is greater. The individual values remain visible beside the
net result so both audiences can understand the trade-off.

The app includes:

- two rotatable and zoomable 3D canvas surfaces;
- bidirectionally linked miner-burn and TAO-emission controls;
- a bundled fallback plus a live, same-request TaoStats snapshot;
- subnet selection and cap diagnostics;
- a lower-left TaoStats loader that keeps the key in memory only.

## Requirements

- Node.js 22.13 or newer
- npm
- Internet access when loading a TaoStats snapshot

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The visualisations open with a clearly labelled bundled fallback. Enter a
TaoStats API key and choose **Load live** to replace it with one request-scoped
snapshot containing current subnet eligibility, moving prices, miner burns,
emission-enabled flags, pool state, root proportions, and TAO/USD price. The
key is sent only to the local server and documented `api.taostats.io` routes. It
is not written to disk, browser storage, logs, or source files.

## Verify the project

```bash
npm test
```

This builds the production worker and checks the rendered dashboard.

## Project map

- `app/page.tsx` — dashboard UI and canvas rendering
- `app/emission-model.ts` — burn, normalization, gate, and inverse-share model
- `app/emission-data.ts` — bundled offline fallback
- `app/taostats-snapshot.ts` — live response normalization and gate derivation
- `app/api/taostats/snapshot/route.ts` — stateless live-data proxy
- `app/globals.css` — responsive visual system
- `tests/rendered-html.test.mjs` — production render checks
- `AGENTS.md` — repository-specific guidance for coding agents

## Useful commands

- `npm run dev` — start the local development server
- `npm run build` — create the production build
- `npm test` — build and run render checks
- `npm run lint` — run ESLint

The emissions model follows the formulas documented at
[Bittensor Emissions](https://www.bittensor.com/docs/concepts/emissions).
