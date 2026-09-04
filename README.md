# Tensor Lens — Bittensor Emissions Lab

An interactive local dashboard for exploring the relationship between miner
burn, TAO emission share, daily emission value, and capped alpha injection.

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

## Start your own Git history

The exported folder intentionally contains no `.git` directory:

```bash
git init
git add .
git commit -m "Initial Tensor Lens dashboard"
```

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
