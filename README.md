# Tensor Lens — Bittensor Emissions Lab

An interactive local dashboard for exploring the relationship between miner
burn, TAO emission share, daily emission value, and capped alpha injection.

The app includes:

- two rotatable and zoomable 3D canvas surfaces;
- bidirectionally linked miner-burn and TAO-emission controls;
- 128 non-root subnet pool snapshots;
- subnet selection and cap diagnostics;
- a lower-left TaoStats API-key verifier that keeps the key in memory only.

## Requirements

- Node.js 22.13 or newer
- npm
- Internet access when verifying a TaoStats API key

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The dashboard data snapshot is bundled, so the visualisations work without an
API key. The API-key box sends the key only to the local server route, which
forwards it to `https://mcp.taostats.io` for verification. It is not written to
disk, browser storage, logs, or source files.

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

- `app/page.tsx` — dashboard UI, model calculations, and canvas rendering
- `app/emission-data.ts` — bundled TaoStats/Bittensor snapshot
- `app/api/taostats/validate/route.ts` — stateless API-key verification
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
