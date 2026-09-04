import assert from "node:assert/strict";
import test from "node:test";

import { calculateTaoShare, deriveRankGateBar } from "../app/emission-model.ts";
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
