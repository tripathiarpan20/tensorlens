# Tensor Lens handoff

Last updated: 2026-09-04

## Start here

The local project is at:

```text
/Users/arpantripathi/Documents/Codex/2026-09-04/https-www-bittensor-com-docs-concepts/outputs/tensor-lens-emissions-dev
```

Run it with Node.js 22.13 or newer:

```bash
cd /Users/arpantripathi/Documents/Codex/2026-09-04/https-www-bittensor-com-docs-concepts/outputs/tensor-lens-emissions-dev
npm install
npm run dev
```

The normal local URL is `http://localhost:3000`. If that port is occupied,
Vinext chooses another port and prints it in the terminal.

Before changing code, read `AGENTS.md`. This project contains
`.openai/hosting.json`, so agents with access to the OpenAI Sites skills must
also follow the `sites-building` instructions. The requested deliverable is
local-only; do not publish or deploy unless the user explicitly asks.

## Product objective

Tensor Lens is an interactive Bittensor subnet emissions dashboard inspired by
the visualisations in the Bittensor emissions documentation.

The first 3D surface uses:

- x-axis: selected subnet miner burn percentage;
- y-axis: selected subnet TAO emission percentage;
- z-axis: miner emission value minus TAO emission value, in USD per day.

The second 3D surface uses the same x/y axes and:

- z-axis: `alpha_in` after the root-proportion cap, in alpha per day.

Miner burn and TAO emission are not independent scenario inputs. The white line
on each surface is the feasible network path. The miner-burn slider evaluates
TAO share directly; moving the TAO-emission slider numerically solves for the
burn that produces the requested share.

The page also provides subnet selection, live/fallback provenance, cap
diagnostics, and a fixed lower-left TaoStats API-key control.

## Core modelling decisions

For subnet `i`, the model must keep this exact calculation order:

```text
demand_share_i = price_ema_i / sum(price_ema)

burn_weight_i = demand_share_i * (1 - miner_burned_i)
burn_adjusted_share_i = burn_weight_i / sum(burn_weight)

gate_i = 1 / (1 + (theta / burn_adjusted_share_i)^h)
gated_weight_i = burn_adjusted_share_i * gate_i
final_share_i = gated_weight_i / sum(gated_weight)
```

After the gate normalization, emission is redistributed over records whose
`subnet_emission_enabled` value is true. A scenario changes only the selected
subnet's burn, but the complete subnet vector is recalculated. This is
essential: changing one subnet's burn changes other subnets' normalized shares.

Implementation: `app/emission-model.ts`.

### Gate

- Hill exponent `h`: 3.
- Live midpoint `theta`: the 32nd-highest positive burn-adjusted demand share
  in the freshly loaded network.
- The midpoint is fixed while a user moves scenario sliders, matching the
  intended between-update behaviour.
- A new live refresh may derive a new midpoint.

Implementation constants: `LIVE_GATE_RANK` and `LIVE_GATE_EXPONENT` in
`app/taostats-snapshot.ts`.

### Emission and value assumptions

- Block TAO emission: `0.5 TAO`.
- Modelled blocks per day: `7,200` (12-second blocks).
- Miner share of participant alpha emission: `41%`.
- Subnet alpha emission rate is halving-aware through
  `alphaEmissionRate(totalAlpha)`.

Current value equations:

```text
tao_per_block = final_share * 0.5

miner_usd_per_day =
  0.41 * (1 - burn) * alpha_emission_rate
  * spot_price_TAO_per_alpha * TAO_USD * 7,200

tao_usd_per_day = tao_per_block * TAO_USD * 7,200

net_usd_per_day = miner_usd_per_day - tao_usd_per_day
```

Current alpha cap equations:

```text
alpha_before_cap = tao_per_block / spot_price
alpha_cap = root_proportion * alpha_emission_rate
alpha_after_cap_per_block = min(alpha_before_cap, alpha_cap)
alpha_after_cap_per_day = alpha_after_cap_per_block * 7,200
```

The user also supplied this future/related EMA ramp formula, which should be
preserved when the model is extended to calculate EMA evolution rather than
consume TaoStats' already-computed moving price:

```text
ema_alpha = base_alpha * blocks_since_start
            / (blocks_since_start + halving_blocks)
```

The current dashboard consumes `moving_price` from TaoStats and does not
independently evolve price EMA over time.

## Why SN64 previously disagreed with TaoStats

The initial bundled dataset mixed an older price-EMA capture from 2026-08-11
with live pool/eligibility/enablement values from 2026-09-04. The formula was
internally applying its stages, but to an incoherent network snapshot.

For the old fallback, SN64 at 0% burn moved through approximately:

```text
raw EMA share                  6.586%
burn-adjusted share           9.297%
post-gate share              12.070%
after enabled redistribution 14.862%
```

The user's TaoStats comparison was about 12.51%. A screenshot also showed SN107
receiving emission while the mixed local data marked it disabled, which was
another sign that the source rows did not describe one coherent network state.

The fix was not a one-subnet correction. The API-key action now loads and
normalizes the complete current subnet network before calculating any scenario.
The old bundled values remain only as a clearly labelled historical/offline
fallback and must not be presented as live.

## TaoStats integration

The UI sends a stateless `POST` to `/api/taostats/snapshot` with:

```json
{ "apiKey": "entered-in-the-local-page" }
```

The server route concurrently calls these documented TaoStats REST endpoints:

```text
/api/subnet/latest/v1?limit=200&order=netuid_asc
/api/dtao/pool/latest/v1?limit=200&order=netuid_asc
/api/subnet/pruning/latest/v1?limit=200&order=netuid_asc
/api/price/latest/v1?asset=tao
```

Base URL: `https://api.taostats.io`.

The API key is forwarded in the `authorization` header. Requests use
`cache: no-store`, have a 15-second timeout, and return a normalized
`LiveSnapshot`, never the credential.

MCP route discovery established that the available TaoStats MCP data tools did
not expose all fields required for this calculation, especially pruning/moving
price data. The app therefore uses the documented REST routes directly with the
same credential. The separate `/api/taostats/validate` MCP-initialize route
still exists but is no longer used by the page's primary Load live flow.

### Live field mapping

- `price_ema`: `pruning.moving_price / 1e9`;
- miner burn: `subnet.incentive_burn`, clamped to `[0, 1]`;
- spot price: `pool.price`;
- root proportion: `pool.root_prop`;
- total alpha: `pool.total_alpha / 1e9`;
- total TAO: `pool.total_tao / 1e9`;
- emission flag: `pool.subnet_emission_enabled`;
- TAO/USD: first row from `/api/price/latest/v1?asset=tao`.

Live eligibility currently requires all of the following:

- `netuid > 0`;
- a non-null registration block;
- `subtoken_enabled === true`;
- `registration_allowed === true`;
- matching pool and pruning rows;
- positive spot price and a non-negative moving price.

The snapshot reports `blockMin` and `blockMax` across the subnet, pool, and
pruning feeds. The four latest endpoints are requested together but are not an
atomic archive read, so they can span several blocks. The UI deliberately shows
the block range rather than claiming a single exact block.

### Last observed live reconciliation

During implementation, the supplied API key was confirmed valid. Do not copy
the key into this file, source, fixtures, environment files, logs, commits, or
future chat summaries.

The live end-to-end check on 2026-09-04 produced:

- 125 eligible subnet records;
- source blocks `8,992,689–8,992,696`;
- derived `theta = 0.8749212476%`;
- SN64 burn `0%`;
- SN64 modelled TAO share `12.499056869%`;
- TAO/USD approximately `$228.7057`.

These numbers are evidence from that refresh, not permanent fixtures. A future
refresh is expected to change them.

## Credential and security decisions

- Never store or reproduce the user's TaoStats API key.
- The key exists only in React component memory while the page is open.
- Do not add `localStorage`, `sessionStorage`, cookies, database persistence, or
  environment-file persistence for the key.
- Do not place the key in URLs or client-visible source.
- Do not log request bodies or authorization headers.
- API routes must not echo upstream authorization failures or credentials.
- The page may distinguish a rejected/unavailable load in user-safe language.
- `.env*` files are ignored.

## UI decisions already implemented

- One responsive single-page dashboard in `app/page.tsx` and
  `app/globals.css`.
- Two custom canvas-based 3D surfaces; no third-party charting dependency.
- Mouse/touch rotation and zoom plus keyboard support must remain intact.
- The coloured plane shows the mathematical x/y surface; the white line shows
  burn/emission pairs the network can actually produce; a ring marks the active
  scenario.
- Bidirectionally linked sliders: burn calculates share, while share uses a
  48-iteration binary solve for burn.
- Only emission-enabled subnets appear in the selector.
- Selecting another subnet resets the scenario to that subnet's reference burn.
- Lower-left fixed API-key dock with password masking, show/hide, live status,
  Load live, and Refresh live.
- Before loading a key, the page prominently says `HISTORICAL FALLBACK`.
- After loading, the page says `LIVE INPUTS` and shows the feed block range.
- The loaded gate midpoint remains fixed until Refresh live.
- API errors leave the current in-memory snapshot/fallback available.
- Site metadata and a generated `public/og.png` social preview are present.

## Project architecture

- `app/page.tsx`: UI state, 3D canvas renderer, sliders, scenario readouts, and
  live snapshot loading.
- `app/globals.css`: responsive styling and live/fallback states.
- `app/emission-model.ts`: network-wide share calculation, inverse burn solve,
  alpha halving rate, and rank gate derivation.
- `app/emission-data.ts`: bundled historical fallback and modelling constants.
- `app/taostats-snapshot.ts`: TaoStats response normalization and live gate
  derivation.
- `app/api/taostats/snapshot/route.ts`: stateless live-data proxy.
- `app/api/taostats/validate/route.ts`: older standalone MCP credential check;
  currently unused by the main UI.
- `tests/emission-model.test.mjs`: cross-subnet normalization, gate-rank, and
  live normalization tests.
- `tests/rendered-html.test.mjs`: production worker render and shipped-asset
  checks.
- `AGENTS.md`: non-negotiable repository guidance.
- `.openai/hosting.json`, `vite.config.ts`, and `worker/index.ts`: Vinext/OpenAI
  Sites/Cloudflare-compatible build structure. Preserve this structure.

There is no D1 or R2 use in the product. Starter database/example files remain
in the scaffold but are not part of the current dashboard state.

## Verification status

The most recent completed validation before this handoff was:

```text
npm run lint  -> passed
npm test      -> passed
5 tests       -> passed, 0 failed
production build completed successfully
```

`npm test` runs the production build and all `tests/*.test.mjs` tests. Run both
`npm run lint` and `npm test` after future implementation changes.

A secret scan found no copy of the supplied API key in the project. Keep that
true.

## Git state

The parent workspace ignores `/outputs/`, which originally made this project
invisible when Git walked up to the parent repository. A repository was
therefore initialized directly inside this project on branch `main`.

There are currently no commits. Existing files were marked with
`git add --intent-to-add .`, so `git diff` shows the full delivered project
without actually staging its contents. Generated directories such as
`node_modules`, `.next`, `.vinext`, `.wrangler`, and `dist` remain ignored.

Useful review commands:

```bash
git status
git diff --stat
git diff
```

When ready to create the baseline:

```bash
git add .
git commit -m "Initial Tensor Lens dashboard"
```

After `git add .`, use `git diff --cached` to review what will be committed.

## Known limitations and next decisions

1. **Latest is not atomic.** The four TaoStats `latest` routes can span a small
   block range. For a truly exact single-block snapshot, investigate TaoStats
   archive routes or Bittensor light-client/RPC storage and read every required
   field at the same block hash.
2. **Fallback is historical and internally mixed.** It is intentionally and
   visibly labelled offline-only. A future improvement could replace it with a
   newly captured coherent fixture, or disable numerical comparison until live
   data is loaded.
3. **Rank-32 gate derivation should remain auditable.** The derived midpoint
   reconciled SN64 to TaoStats, but if runtime storage exposes the exact active
   midpoint, prefer that authoritative field and add a comparison test.
4. **The old validate route is redundant.** It can be removed if no external
   consumer needs it. The live snapshot route already proves whether a key can
   access all required feeds.
5. **Client error wording is intentionally broad.** The UI currently combines
   invalid key, incomplete data, and TaoStats network failure. Improve this only
   with safe categories that do not expose credentials or raw upstream bodies.
6. **EMA evolution is not simulated.** The app consumes live `moving_price`;
   it does not yet expose `base_alpha`, `blocks_since_start`, or
   `halving_blocks` as time-evolution controls.
7. **Financial interpretation.** This is an exploratory model, not financial
   advice. Preserve that footer qualification.

## Recommended first action in the next conversation

Ask the next agent to read `HANDOFF.md` and `AGENTS.md`, inspect `git diff`, and
state whether the next task is:

- improving snapshot atomicity;
- replacing/disabling the historical fallback;
- validating the formulas against current runtime storage;
- refining the UI/3D interaction; or
- preparing the initial Git commit.

Do not re-enter the prior TaoStats API key into chat. Use the local lower-left
input when a live refresh is needed.
