import type { SubnetPoint } from "./emission-data.ts";

export function calculateGrossAllocationGapUsd(
  taoAllocationUsd: number,
  minerLiquidationUsd: number,
) {
  return taoAllocationUsd - minerLiquidationUsd;
}

export function calculateEmissionRouting(
  taoAllocation: number,
  spotPrice: number,
  rootProportion: number,
  alphaEmission: number,
) {
  const safeTaoAllocation = Math.max(0, taoAllocation);
  const safeSpotPrice = Math.max(spotPrice, 1e-9);
  const alphaTarget = safeTaoAllocation / safeSpotPrice;
  const alphaCap = Math.max(0, rootProportion) * Math.max(0, alphaEmission);
  const alphaIn = Math.min(alphaTarget, alphaCap);
  const liquidityTao = Math.min(safeTaoAllocation, alphaIn * safeSpotPrice);

  return {
    alphaTarget,
    alphaCap,
    alphaIn,
    liquidityTao,
    chainBuyTao: Math.max(0, safeTaoAllocation - liquidityTao),
  };
}

export function calculateMinerLiquidation(
  alphaEmission: number,
  minerFraction: number,
  minerBurn: number,
  spotPrice: number,
) {
  const minerAlpha = Math.max(0, alphaEmission)
    * Math.min(1, Math.max(0, minerFraction))
    * (1 - Math.min(1, Math.max(0, minerBurn)));

  return {
    minerAlpha,
    minerTao: minerAlpha * Math.max(0, spotPrice),
  };
}

export function alphaEmissionRate(totalAlpha: number) {
  let rate = 1;
  let threshold = 10_500_000;
  while (totalAlpha >= threshold && rate > 1 / 1024) {
    rate /= 2;
    threshold = 21_000_000 - (21_000_000 - threshold) / 2;
  }
  return rate;
}

export function calculateTaoShare(
  subnets: SubnetPoint[],
  gateBar: number,
  gateExponent: number,
  selectedNetuid: number,
  selectedBurn: number,
) {
  const emaTotal = subnets.reduce((sum, subnet) => sum + subnet.emaPrice, 0);
  const adjusted = subnets.map((subnet) => {
    const burn = subnet.netuid === selectedNetuid ? selectedBurn : subnet.minerBurned;
    return {
      subnet,
      weight: emaTotal > 0
        ? (subnet.emaPrice / emaTotal) * (1 - Math.min(1, Math.max(0, burn)))
        : 0,
    };
  });
  const adjustedTotal = adjusted.reduce((sum, item) => sum + item.weight, 0);
  const gated = adjusted.map((item) => {
    const share = adjustedTotal > 0 ? item.weight / adjustedTotal : 0;
    const gate = share > 0 && gateBar > 0
      ? 1 / (1 + Math.pow(gateBar / share, gateExponent))
      : share > 0 ? 1 : 0;
    return { ...item, gated: share * gate };
  });
  const gatedTotal = gated.reduce((sum, item) => sum + item.gated, 0);
  const normalized = gated.map((item) => ({
    ...item,
    final: gatedTotal > 0 ? item.gated / gatedTotal : 0,
  }));
  const enabledTotal = normalized.reduce(
    (sum, item) => sum + (item.subnet.emissionEnabled ? item.final : 0),
    0,
  );
  const selected = normalized.find((item) => item.subnet.netuid === selectedNetuid);
  return selected?.subnet.emissionEnabled && enabledTotal > 0 ? selected.final / enabledTotal : 0;
}

export function solveBurnForShare(
  subnets: SubnetPoint[],
  gateBar: number,
  gateExponent: number,
  netuid: number,
  targetShare: number,
) {
  let low = 0;
  let high = 1;
  const highShare = calculateTaoShare(subnets, gateBar, gateExponent, netuid, low);
  if (targetShare >= highShare) return 0;
  if (targetShare <= calculateTaoShare(subnets, gateBar, gateExponent, netuid, high)) return 1;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    const share = calculateTaoShare(subnets, gateBar, gateExponent, netuid, mid);
    if (share > targetShare) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function deriveRankGateBar(
  subnets: Pick<SubnetPoint, "emaPrice" | "minerBurned">[],
  rank: number,
) {
  const total = subnets.reduce((sum, subnet) => sum + subnet.emaPrice, 0);
  if (total <= 0 || rank <= 0) return 0;
  const weights = subnets.map(
    (subnet) => (subnet.emaPrice / total) * (1 - Math.min(1, Math.max(0, subnet.minerBurned))),
  );
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return 0;
  const positiveShares = weights
    .map((weight) => weight / weightTotal)
    .filter((share) => share > 0)
    .sort((a, b) => b - a);
  return positiveShares[Math.min(rank, positiveShares.length) - 1] ?? 0;
}
