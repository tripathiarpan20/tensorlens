import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAlphaPriceScenario,
  solveBurnForShare,
  calculateEmissionRouting,
  calculateGrossAllocationGapUsd,
  calculateMinerLiquidation,
  calculateTaoShare,
  deriveRankGateBar,
} from "../app/emission-model.ts";
import { buildLiveSnapshot } from "../app/taostats-snapshot.ts";

function point(netuid, emaPrice, minerBurned = 0) {
  return {
    netuid,
    name: `SN${netuid}`,
    spotPrice: 0.1,
    rootProportion: 0.2,
    totalAlpha: 1_000_000,
    totalTao: 100_000,
    emissionEnabled: true,
    emaPrice,
    minerBurned,
    emaFromReference: false,
  };
}

test("gross allocation gap compares total TAO allocation with miner liquidation", () => {
  assert.equal(calculateGrossAllocationGapUsd(250, 180), 70);
  assert.equal(calculateGrossAllocationGapUsd(180, 250), -70);
  assert.equal(calculateGrossAllocationGapUsd(250, 250), 0);
});

test("TAO allocation is split between price-neutral liquidity and chain buys", () => {
  const capped = calculateEmissionRouting(10, 2, 0.25, 8);
  assert.deepEqual(capped, {
    alphaTarget: 5,
    alphaCap: 2,
    alphaIn: 2,
    liquidityTao: 4,
    chainBuyTao: 6,
  });

  const belowCap = calculateEmissionRouting(3, 2, 0.5, 8);
  assert.equal(belowCap.alphaIn, 1.5);
  assert.equal(belowCap.liquidityTao, 3);
  assert.equal(belowCap.chainBuyTao, 0);
  assert.equal(belowCap.liquidityTao + belowCap.chainBuyTao, 3);
});

test("miner liquidation converts all post-burn miner alpha to TAO at spot", () => {
  const liquidation = calculateMinerLiquidation(1, 0.41, 0.25, 2);
  assert.equal(liquidation.minerAlpha, 0.3075);
  assert.equal(liquidation.minerTao, 0.615);
});

test("changing one subnet burn renormalizes every subnet", () => {
  const subnets = [point(1, 0.6), point(2, 0.4)];
  const gateBar = 0.1;
  const baseline = calculateTaoShare(subnets, gateBar, 3, 1, 0);
  const selectedBurns = calculateTaoShare(subnets, gateBar, 3, 1, 0.5);
  const otherSubnetBurns = calculateTaoShare(
    [point(1, 0.6), point(2, 0.4, 0.5)],
    gateBar,
    3,
    1,
    0,
  );

  assert.ok(selectedBurns < baseline);
  assert.ok(otherSubnetBurns > baseline);
});

test("rank gate uses the requested burn-adjusted demand rank", () => {
  const subnets = Array.from({ length: 33 }, (_, index) => point(index + 1, 33 - index));
  const bar = deriveRankGateBar(subnets, 32);
  const total = subnets.reduce((sum, subnet) => sum + subnet.emaPrice, 0);
  assert.ok(Math.abs(bar - 2 / total) < Number.EPSILON);
});

test("TaoStats records become one normalized live model snapshot", () => {
  const records = Array.from({ length: 33 }, (_, index) => {
    const id = index + 1;
    return {
      subnet: {
        netuid: id,
        block_number: 100,
        timestamp: "2026-09-04T08:00:00Z",
        registration_block_number: 10,
        subtoken_enabled: true,
        registration_allowed: true,
        incentive_burn: id === 1 ? "0.25" : "0",
      },
      pool: {
        netuid: id,
        block_number: 101,
        timestamp: "2026-09-04T08:00:12Z",
        name: `Subnet ${id}`,
        price: "0.1",
        root_prop: "0.2",
        total_alpha: "2000000000000000",
        total_tao: "50000000000000",
        subnet_emission_enabled: true,
      },
      pruning: {
        netuid: id,
        block_number: 102,
        timestamp: "2026-09-04T08:00:24Z",
        moving_price: String((34 - id) * 1_000_000_000),
      },
    };
  });

  const snapshot = buildLiveSnapshot({
    subnet: { data: records.map((record) => record.subnet) },
    pool: { data: records.map((record) => record.pool) },
    pruning: { data: records.map((record) => record.pruning) },
    price: { data: [{ price: "230.5", last_updated: "2026-09-04T08:00:00Z" }] },
  });

  assert.equal(snapshot.subnets.length, 33);
  assert.equal(snapshot.subnets[0].minerBurned, 0.25);
  assert.equal(snapshot.subnets[0].totalAlpha, 2_000_000);
  assert.equal(snapshot.taoUsd, 230.5);
  assert.equal(snapshot.blockMin, 100);
  assert.equal(snapshot.blockMax, 102);
  assert.ok(snapshot.gateBar > 0);
});


test("spot price scenarios update routing and liquidation without changing demand or the snapshot", () => {
  const subnets = [point(1, 0.6, 0.3), point(2, 0.4)];
  const scenario = applyAlphaPriceScenario(subnets, 1, 0.2);
  assert.equal(scenario[0].spotPrice, 0.2);
  assert.equal(scenario[0].emaPrice, subnets[0].emaPrice);
  assert.equal(scenario[1], subnets[1]);
  assert.equal(subnets[0].spotPrice, 0.1);
  const share = calculateTaoShare(subnets, 0.1, 3, 1, 0.3);
  assert.equal(calculateTaoShare(scenario, 0.1, 3, 1, 0.3), share);
  const before = calculateEmissionRouting(0.03, 0.1, 0.2, 1);
  const after = calculateEmissionRouting(0.03, scenario[0].spotPrice, 0.2, 1);
  assert.ok(after.alphaIn < before.alphaIn);
  assert.ok(after.chainBuyTao < before.chainBuyTao);
  const minerBefore = calculateMinerLiquidation(1, 0.41, 0.3, 0.1).minerTao;
  const minerAfter = calculateMinerLiquidation(1, 0.41, 0.3, scenario[0].spotPrice).minerTao;
  assert.equal(minerAfter, minerBefore * 2);
  assert.ok(calculateGrossAllocationGapUsd(0.03, minerAfter) < calculateGrossAllocationGapUsd(0.03, minerBefore));
});

test("optional EMA scaling renormalizes allocation and preserves inverse burn solving at a fixed gate", () => {
  const subnets = [point(1, 0.6, 0.3), point(2, 0.4)];
  const gate = deriveRankGateBar(subnets, 2);
  const scenario = applyAlphaPriceScenario(subnets, 1, 0.2, true);
  assert.equal(scenario[0].emaPrice, 1.2);
  assert.equal(scenario[1], subnets[1]);
  const share = calculateTaoShare(scenario, gate, 3, 1, 0.3);
  assert.ok(share > calculateTaoShare(subnets, gate, 3, 1, 0.3));
  assert.ok(Math.abs(solveBurnForShare(scenario, gate, 3, 1, share) - 0.3) < 1e-10);
  const lowerBurnShare = calculateTaoShare(scenario, gate, 3, 1, 0.1);
  assert.ok(lowerBurnShare > share);
});

test("disabled, invalid and reference-price scenarios preserve baseline inputs", () => {
  const subnets = [point(1, 0.6), point(2, 0.4)];
  for (const price of [null, NaN, Infinity, -1, 0, 1e-12]) {
    assert.equal(applyAlphaPriceScenario(subnets, 1, price, true), subnets);
  }
  assert.deepEqual(applyAlphaPriceScenario(subnets, 1, 0.1, true), subnets);
});
