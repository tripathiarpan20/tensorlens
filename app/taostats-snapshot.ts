import type { SubnetPoint } from "./emission-data.ts";
import { deriveRankGateBar } from "./emission-model.ts";

export const LIVE_GATE_RANK = 32;
export const LIVE_GATE_EXPONENT = 3;

type TaoStatsEnvelope = { data?: unknown };
type TaoStatsRecord = Record<string, unknown>;

export type TaoStatsSnapshotPayload = {
  subnet: TaoStatsEnvelope;
  pool: TaoStatsEnvelope;
  pruning: TaoStatsEnvelope;
  price: TaoStatsEnvelope;
};

export type LiveSnapshot = {
  subnets: SubnetPoint[];
  taoUsd: number;
  taoPriceCapturedAt: string;
  capturedAt: string;
  blockMin: number;
  blockMax: number;
  gateBar: number;
  gateRank: number;
  gateExponent: number;
};

function rows(value: TaoStatsEnvelope) {
  return Array.isArray(value.data) ? value.data.filter(
    (item): item is TaoStatsRecord => Boolean(item) && typeof item === "object",
  ) : [];
}

function finite(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function netuid(value: TaoStatsRecord) {
  return Math.trunc(finite(value.netuid));
}

function perToken(value: unknown) {
  return finite(value) / 1_000_000_000;
}

export function buildLiveSnapshot(payload: TaoStatsSnapshotPayload): LiveSnapshot {
  const subnetRows = rows(payload.subnet);
  const poolRows = rows(payload.pool);
  const pruningRows = rows(payload.pruning);
  const priceRows = rows(payload.price);
  const pools = new Map(poolRows.map((row) => [netuid(row), row]));
  const pruning = new Map(pruningRows.map((row) => [netuid(row), row]));

  const subnets = subnetRows
    .filter((row) => {
      const id = netuid(row);
      return id > 0
        && row.registration_block_number !== null
        && row.registration_block_number !== undefined
        && row.subtoken_enabled === true
        && row.registration_allowed === true
        && pools.has(id)
        && pruning.has(id);
    })
    .map((row): SubnetPoint => {
      const id = netuid(row);
      const pool = pools.get(id)!;
      const moving = pruning.get(id)!;
      return {
        netuid: id,
        name: typeof pool.name === "string" && pool.name.trim() ? pool.name.trim() : `Subnet ${id}`,
        spotPrice: finite(pool.price),
        rootProportion: finite(pool.root_prop),
        totalAlpha: perToken(pool.total_alpha),
        totalTao: perToken(pool.total_tao),
        emissionEnabled: pool.subnet_emission_enabled === true,
        emaPrice: perToken(moving.moving_price),
        minerBurned: Math.min(1, Math.max(0, finite(row.incentive_burn))),
        emaFromReference: false,
      };
    })
    .filter((subnet) => subnet.emaPrice >= 0 && subnet.spotPrice > 0)
    .sort((a, b) => a.netuid - b.netuid);

  if (!subnets.length) throw new Error("TaoStats returned no eligible subnet records.");

  const blockNumbers = [...subnetRows, ...poolRows, ...pruningRows]
    .map((row) => finite(row.block_number))
    .filter((block) => block > 0);
  const timestamps = [...subnetRows, ...poolRows, ...pruningRows]
    .map((row) => typeof row.timestamp === "string" ? row.timestamp : "")
    .filter(Boolean)
    .sort();
  const price = priceRows[0] ?? {};
  const taoUsd = finite(price.price);
  if (taoUsd <= 0) throw new Error("TaoStats returned an invalid TAO price.");

  return {
    subnets,
    taoUsd,
    taoPriceCapturedAt: typeof price.last_updated === "string"
      ? price.last_updated
      : typeof price.updated_at === "string" ? price.updated_at : timestamps.at(-1) ?? new Date().toISOString(),
    capturedAt: timestamps.at(-1) ?? new Date().toISOString(),
    blockMin: Math.min(...blockNumbers),
    blockMax: Math.max(...blockNumbers),
    gateBar: deriveRankGateBar(subnets, LIVE_GATE_RANK),
    gateRank: LIVE_GATE_RANK,
    gateExponent: LIVE_GATE_EXPONENT,
  };
}
