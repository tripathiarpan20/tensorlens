# AGENTS.md

## Project purpose

Tensor Lens is a single-page Bittensor emissions modelling dashboard. Preserve
the relationship between miner burn, burn-adjusted TAO share, the Hill emission
gate, daily USD value, and the root-proportion alpha injection cap.

## Local workflow

1. Use Node.js 22.13 or newer.
2. Install dependencies with `npm install`.
3. Run the development site with `npm run dev`.
4. Run `npm test` before handing off a change.

## Architecture

- Keep the main product surface in `app/page.tsx` and its styles in
  `app/globals.css`.
- Keep bundled fallback constants and subnet records in `app/emission-data.ts`.
- Keep network-wide share calculations in `app/emission-model.ts` and live
  TaoStats response normalization in `app/taostats-snapshot.ts`.
- `app/api/taostats/snapshot/route.ts` is intentionally stateless and may only
  relay a supplied credential to documented routes on `https://api.taostats.io`.
- Preserve the `sites()` Vite plugin and Cloudflare Worker-compatible ESM
  output.

## Security constraints

- Never commit a TaoStats API key or place one in client-visible source,
  environment examples, fixtures, logs, URLs, or generated output.
- API keys entered in the page must remain in React memory only.
- The validation route must not echo, cache, persist, or log credentials.
- Do not add browser storage for credentials.
- Never return the credential or raw authorization failures to the browser.

## Model invariants

- TAO emission share is dependent on miner burn; keep the two scenario controls
  bidirectionally linked.
- Maintain the documented normalization order: EMA demand share, miner-burn
  scaling, Hill gate, then enabled-subnet redistribution.
- Build a live scenario from the same request's subnet, pool, pruning/moving
  price, and TAO-price feeds. Never mix historical EMA values with live flags.
- Hold the fetched rank-32 gate midpoint fixed while a user moves a scenario
  slider; a refresh may derive a new midpoint from the refreshed network.
- Compute capped alpha injection as
  `min(tao_in / spot_price, root_proportion * alpha_emission_rate)`.
- Use 7,200 blocks per day for 12-second block modelling unless the network
  assumptions are deliberately revised and clearly labelled.

## UI expectations

- Retain keyboard and touch support for the 3D canvases.
- Keep the TaoStats API-key control anchored in the lower-left corner.
- Maintain accessible labels and live validation status text.
- Do not introduce third-party charting packages unless the canvas renderer can
  no longer satisfy a concrete requirement.
