"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_EMISSION_TAO,
  BLOCKS_PER_DAY,
  EMA_CAPTURE as FALLBACK_EMA_CAPTURE,
  GATE_BAR as FALLBACK_GATE_BAR,
  GATE_EXPONENT as FALLBACK_GATE_EXPONENT,
  LIVE_BLOCK as FALLBACK_LIVE_BLOCK,
  LIVE_CAPTURE as FALLBACK_LIVE_CAPTURE,
  MINER_FRACTION,
  SUBNETS as FALLBACK_SUBNETS,
  TAO_PRICE_CAPTURE as FALLBACK_TAO_PRICE_CAPTURE,
  TAO_USD as FALLBACK_TAO_USD,
  type SubnetPoint,
} from "./emission-data";
import {
  alphaEmissionRate,
  applyAlphaPriceScenario,
  calculateEmissionRouting,
  calculateGrossAllocationGapUsd,
  calculateMinerLiquidation,
  calculateTaoShare,
  solveBurnForShare,
} from "./emission-model";
import type { LiveSnapshot } from "./taostats-snapshot";

type SurfaceMode = "difference" | "alpha" | "pressure";

function surfaceValue(
  mode: SurfaceMode,
  subnet: SubnetPoint,
  burn: number,
  taoShare: number,
  taoUsdRate: number,
) {
  const alphaRate = alphaEmissionRate(subnet.totalAlpha);
  const taoPerBlock = taoShare * BLOCK_EMISSION_TAO;
  const routing = calculateEmissionRouting(
    taoPerBlock,
    subnet.spotPrice,
    subnet.rootProportion,
    alphaRate,
  );
  if (mode === "alpha") return routing.alphaIn * BLOCKS_PER_DAY;
  const minerLiquidation = calculateMinerLiquidation(
    alphaRate,
    MINER_FRACTION,
    burn,
    subnet.spotPrice,
  );
  if (mode === "pressure") {
    return (routing.chainBuyTao - minerLiquidation.minerTao) * BLOCKS_PER_DAY;
  }
  const minerUsd = minerLiquidation.minerTao * taoUsdRate * BLOCKS_PER_DAY;
  const taoUsd = taoPerBlock * taoUsdRate * BLOCKS_PER_DAY;
  return calculateGrossAllocationGapUsd(taoUsd, minerUsd);
}

function compactUsd(value: number) {
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  const amount = Math.abs(value);
  if (amount >= 1_000_000) return `${sign}$${(amount / 1_000_000).toFixed(2)}m`;
  if (amount >= 1_000) return `${sign}$${(amount / 1_000).toFixed(1)}k`;
  return `${sign}$${amount.toFixed(0)}`;
}

function compactAlpha(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m α`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k α`;
  return `${value.toFixed(2)} α`;
}

function compactTao(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m τ`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k τ`;
  if (value >= 1) return `${value.toFixed(2)} τ`;
  if (value >= 0.01) return `${value.toFixed(3)} τ`;
  return `${value.toFixed(5)} τ`;
}

function compactSignedTao(value: number) {
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  return `${sign}${compactTao(Math.abs(value))}`;
}

function compactLiquidationTao(value: number) {
  return value > 0 ? `−${compactTao(value)}` : compactTao(0);
}

function compactLiquidationUsd(value: number) {
  const amount = compactUsd(Math.abs(value)).replace("+", "");
  return value > 0 ? `−${amount}` : amount;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function IsometricSurface({
  mode,
  subnets,
  gateBar,
  gateExponent,
  taoUsdRate,
  subnet,
  burn,
  share,
  maxShare,
}: {
  mode: SurfaceMode;
  subnets: SubnetPoint[];
  gateBar: number;
  gateExponent: number;
  taoUsdRate: number;
  subnet: SubnetPoint;
  burn: number;
  share: number;
  maxShare: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number; action: "rotate" | "pan" } | null>(null);
  const [view, setView] = useState({ yaw: -Math.PI / 4, pitch: 0.9, zoom: 1, panX: 0, panY: 0 });
  const [sizeTick, setSizeTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setSizeTick((value) => value + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const steps = 34;
    const values: number[][] = [];
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (let yi = 0; yi <= steps; yi++) {
      values[yi] = [];
      for (let xi = 0; xi <= steps; xi++) {
        const value = surfaceValue(mode, subnet, xi / steps, (yi / steps) * maxShare, taoUsdRate);
        values[yi][xi] = value;
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    }
    const span = Math.max(1e-9, maxValue - minValue);
    const normalizedHeight = (value: number) => {
      const normalized = Math.min(1, Math.max(0, (value - minValue) / span));
      return Math.pow(normalized, 0.92) * 0.62;
    };
    const surfaceColor = (value: number) => {
      const t = Math.min(1, Math.max(0, (value - minValue) / span));
      const low = [67, 22, 180];
      const middle = [255, 19, 139];
      const high = [217, 255, 67];
      const split = 0.72;
      const from = t < split ? low : middle;
      const to = t < split ? middle : high;
      const amount = t < split ? t / split : (t - split) / (1 - split);
      const channels = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, .82)`;
    };
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch);
    const sp = Math.sin(view.pitch);
    const planeScale = Math.min(w * 0.66, h * 0.82) * view.zoom;
    const project = (x: number, y: number, z = 0) => {
      const px = x - 0.5;
      const py = y - 0.5;
      const rx = px * cy - py * sy;
      const ry = px * sy + py * cy;
      const projectedY = ry * cp - z * sp;
      const depth = ry * sp + z * cp;
      return {
        x: w * 0.5 + view.panX + rx * planeScale,
        y: h * 0.55 + view.panY + projectedY * planeScale,
        depth,
      };
    };

    const drawLine = (points: ReturnType<typeof project>[]) => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    };

    const drawAxis = (
      start: ReturnType<typeof project>,
      end: ReturnType<typeof project>,
      label: string,
      color: string,
      side: 1 | -1,
    ) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      const arrowSize = w < 500 ? 5 : 7;

      ctx.strokeStyle = color;
      ctx.lineWidth = w < 500 ? 1.2 : 1.5;
      drawLine([start, end]);
      drawLine([
        { ...end, x: end.x - ux * arrowSize + nx * arrowSize * 0.55, y: end.y - uy * arrowSize + ny * arrowSize * 0.55 },
        end,
        { ...end, x: end.x - ux * arrowSize - nx * arrowSize * 0.55, y: end.y - uy * arrowSize - ny * arrowSize * 0.55 },
      ]);

      let angle = Math.atan2(dy, dx);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      const offset = w < 500 ? 11 : 15;
      const labelX = (start.x + end.x) / 2 + nx * side * offset;
      const labelY = (start.y + end.y) / 2 + ny * side * offset;
      ctx.save();
      ctx.translate(labelX, labelY);
      ctx.rotate(angle);
      ctx.font = `700 ${w < 500 ? 7 : 9}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labelWidth = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(17,17,17,.9)";
      ctx.fillRect(-labelWidth / 2 - 6, -7, labelWidth + 12, 14);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.7;
      ctx.strokeRect(-labelWidth / 2 - 6, -7, labelWidth + 12, 14);
      ctx.fillStyle = color;
      ctx.fillText(label, 0, 0.5);
      ctx.restore();
    };

    const floorZ = -0.055;
    ctx.strokeStyle = "rgba(255,255,255,.1)";
    ctx.lineWidth = 0.7;
    for (let i = 0; i <= 10; i++) {
      const position = i / 10;
      drawLine([project(position, 0, floorZ), project(position, 1, floorZ)]);
      drawLine([project(0, position, floorZ), project(1, position, floorZ)]);
    }
    const floorCorners = [
      project(0, 0, floorZ),
      project(1, 0, floorZ),
      project(1, 1, floorZ),
      project(0, 1, floorZ),
    ];
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 1;
    drawLine([...floorCorners, floorCorners[0]]);
    ctx.strokeStyle = "rgba(255,255,255,.09)";
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      drawLine([project(x, y, floorZ), project(x, y, 0.68)]);
    }

    const cells: Array<{
      points: ReturnType<typeof project>[];
      value: number;
      depth: number;
    }> = [];
    for (let yi = 0; yi < steps; yi++) {
      for (let xi = 0; xi < steps; xi++) {
        const x0 = xi / steps;
        const x1 = (xi + 1) / steps;
        const y0 = yi / steps;
        const y1 = (yi + 1) / steps;
        const points = [
          project(x0, y0, normalizedHeight(values[yi][xi])),
          project(x1, y0, normalizedHeight(values[yi][xi + 1])),
          project(x1, y1, normalizedHeight(values[yi + 1][xi + 1])),
          project(x0, y1, normalizedHeight(values[yi + 1][xi])),
        ];
        cells.push({
          points,
          value: (values[yi][xi] + values[yi][xi + 1] + values[yi + 1][xi + 1] + values[yi + 1][xi]) / 4,
          depth: points.reduce((sum, point) => sum + point.depth, 0) / 4,
        });
      }
    }
    cells.sort((a, b) => a.depth - b.depth);
    for (const cell of cells) {
      ctx.beginPath();
      ctx.moveTo(cell.points[0].x, cell.points[0].y);
      for (let i = 1; i < cell.points.length; i++) ctx.lineTo(cell.points[i].x, cell.points[i].y);
      ctx.closePath();
      ctx.fillStyle = surfaceColor(cell.value);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    const edgePoints = [
      Array.from({ length: steps + 1 }, (_, index) => project(index / steps, 0, normalizedHeight(values[0][index]))),
      Array.from({ length: steps + 1 }, (_, index) => project(1, index / steps, normalizedHeight(values[index][steps]))),
      Array.from({ length: steps + 1 }, (_, index) => project(1 - index / steps, 1, normalizedHeight(values[steps][steps - index]))),
      Array.from({ length: steps + 1 }, (_, index) => project(0, 1 - index / steps, normalizedHeight(values[steps - index][0]))),
    ];
    ctx.strokeStyle = "rgba(255,255,255,.38)";
    ctx.lineWidth = 1.2;
    for (const edge of edgePoints) drawLine(edge);

    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const pathBurn = i / 80;
      const pathShare = calculateTaoShare(subnets, gateBar, gateExponent, subnet.netuid, pathBurn);
      const pathValue = surfaceValue(mode, subnet, pathBurn, pathShare, taoUsdRate);
      const point = project(
        pathBurn,
        maxShare ? pathShare / maxShare : 0,
        normalizedHeight(pathValue) + 0.015,
      );
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = mode === "difference" ? "#ff3f91" : mode === "alpha" ? "#d9ff43" : "#ff9f43";
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const markerValue = surfaceValue(mode, subnet, burn, share, taoUsdRate);
    const marker = project(
      burn,
      maxShare ? share / maxShare : 0,
      normalizedHeight(markerValue) + 0.022,
    );
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = mode === "difference" ? "#ff3f91" : mode === "alpha" ? "#d9ff43" : "#ff9f43";
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 13, 0, Math.PI * 2);
    ctx.strokeStyle = mode === "difference" ? "#ff3f91" : mode === "alpha" ? "#d9ff43" : "#ff9f43";
    ctx.lineWidth = 1;
    ctx.stroke();

    const taoAxisMaximum = maxShare * 100;
    const taoAxisLabel = `${taoAxisMaximum.toFixed(taoAxisMaximum < 1 ? 2 : 1)}%`;
    const valueAxisLabel = mode === "difference"
      ? "GROSS VALUE GAP"
      : mode === "alpha" ? "ALPHA IN" : "NET BUY PRESSURE";
    const axisFloor = floorZ - 0.012;
    drawAxis(
      project(0, 1, axisFloor),
      project(1, 1, axisFloor),
      "X · MINER BURN · 0% → 100%",
      "#ff3f91",
      1,
    );
    drawAxis(
      project(0, 0, axisFloor),
      project(0, 1, axisFloor),
      `Y · TAO EMISSION · 0% → ${taoAxisLabel}`,
      "#d9ff43",
      1,
    );
    drawAxis(
      project(0, 0, floorZ),
      project(0, 0, 0.68),
      `Z · ${valueAxisLabel} · LOW → HIGH`,
      "#ffffff",
      -1,
    );
  }, [burn, gateBar, gateExponent, maxShare, mode, share, sizeTick, subnet, subnets, taoUsdRate, view]);

  const resetView = () => setView({ yaw: -Math.PI / 4, pitch: 0.9, zoom: 1, panX: 0, panY: 0 });

  return (
    <div className="canvas-stage">
      <canvas
        ref={canvasRef}
        className="surface-canvas"
        role="img"
        tabIndex={0}
        aria-label={mode === "difference"
          ? "Interactive isometric gross allocation value-gap surface. X axis is miner burn, Y axis is TAO emission, and Z axis is the modeled result."
          : mode === "alpha"
            ? "Interactive isometric capped alpha injection surface. X axis is miner burn, Y axis is TAO emission, and Z axis is the modeled result."
            : "Interactive isometric net chain-buy pressure surface. X axis is miner burn, Y axis is TAO emission, and Z axis is the modeled result."}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            action: event.shiftKey || event.button === 1 ? "pan" : "rotate",
          };
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const dx = event.clientX - dragRef.current.x;
          const dy = event.clientY - dragRef.current.y;
          const action = dragRef.current.action;
          dragRef.current = { x: event.clientX, y: event.clientY, action };
          setView((current) => action === "pan"
            ? {
                ...current,
                panX: Math.max(-180, Math.min(180, current.panX + dx)),
                panY: Math.max(-150, Math.min(150, current.panY + dy)),
              }
            : {
                ...current,
                yaw: current.yaw + dx * 0.008,
                pitch: Math.max(0.38, Math.min(1.28, current.pitch + dy * 0.006)),
              });
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={(event) => {
          event.preventDefault();
          setView((current) => ({
            ...current,
            zoom: Math.max(0.72, Math.min(1.42, current.zoom - event.deltaY * 0.001)),
          }));
        }}
        onKeyDown={(event) => {
          if (event.shiftKey && event.key === "ArrowLeft") setView((current) => ({ ...current, panX: Math.max(-180, current.panX - 12) }));
          else if (event.shiftKey && event.key === "ArrowRight") setView((current) => ({ ...current, panX: Math.min(180, current.panX + 12) }));
          else if (event.shiftKey && event.key === "ArrowUp") setView((current) => ({ ...current, panY: Math.max(-150, current.panY - 12) }));
          else if (event.shiftKey && event.key === "ArrowDown") setView((current) => ({ ...current, panY: Math.min(150, current.panY + 12) }));
          else if (event.key === "ArrowLeft") setView((current) => ({ ...current, yaw: current.yaw - 0.08 }));
          else if (event.key === "ArrowRight") setView((current) => ({ ...current, yaw: current.yaw + 0.08 }));
          else if (event.key === "ArrowUp") setView((current) => ({ ...current, pitch: Math.max(0.38, current.pitch - 0.06) }));
          else if (event.key === "ArrowDown") setView((current) => ({ ...current, pitch: Math.min(1.28, current.pitch + 0.06) }));
          if (event.key === "+" || event.key === "=") setView((current) => ({ ...current, zoom: Math.min(1.42, current.zoom + 0.08) }));
          if (event.key === "-") setView((current) => ({ ...current, zoom: Math.max(0.72, current.zoom - 0.08) }));
        }}
      >
        Your browser does not support canvas.
      </canvas>
      <button className="view-reset" type="button" onClick={resetView}>Reset view</button>
      <div className="graph-legend">
        <span className="legend-path" /> Feasible burn → emission path
        <span className="legend-point" /> Current scenario
      </div>
      <div className={`value-key ${mode}`} aria-hidden="true">
        <span>LOW</span><i /><span>HIGH</span>
      </div>
      <div className="interaction-hint">DRAG · ROTATE &nbsp; / &nbsp; SHIFT + DRAG · MOVE &nbsp; / &nbsp; SCROLL · ZOOM</div>
    </div>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  describedBy,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  describedBy?: string;
}) {
  return (
    <label className="range-label">
      <span>{label}</span><output>{display}</output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-describedby={describedBy}
      />
      <span className="range-min">{min.toFixed(0)}%</span>
      <span className="range-max">{max.toFixed(2)}%</span>
    </label>
  );
}

export default function Home() {
  const [selectedNetuid, setSelectedNetuid] = useState(10);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const modelSubnets = snapshot?.subnets ?? FALLBACK_SUBNETS;
  const enabledSubnets = useMemo(
    () => modelSubnets.filter((subnet) => subnet.emissionEnabled),
    [modelSubnets],
  );
  const gateBar = snapshot?.gateBar ?? FALLBACK_GATE_BAR;
  const gateExponent = snapshot?.gateExponent ?? FALLBACK_GATE_EXPONENT;
  const taoUsdRate = snapshot?.taoUsd ?? FALLBACK_TAO_USD;
  const referenceSubnet = useMemo(
    () => modelSubnets.find((subnet) => subnet.netuid === selectedNetuid)
      ?? enabledSubnets[0]
      ?? modelSubnets[0],
    [enabledSubnets, modelSubnets, selectedNetuid],
  );
  const [burnPercent, setBurnPercent] = useState(referenceSubnet.minerBurned * 100);
  const [priceEnabled, setPriceEnabled] = useState(false);
  const [targetPriceInput, setTargetPriceInput] = useState("");
  const [scaleEma, setScaleEma] = useState(false);
  const targetPrice = Number(targetPriceInput);
  const validTargetPrice = targetPriceInput.trim() !== "" && Number.isFinite(targetPrice) && targetPrice >= 1e-9;
  const scenarioSubnets = useMemo(
    () => applyAlphaPriceScenario(modelSubnets, referenceSubnet.netuid,
      priceEnabled && validTargetPrice ? targetPrice : null, scaleEma),
    [modelSubnets, referenceSubnet.netuid, priceEnabled, validTargetPrice, targetPrice, scaleEma],
  );
  const selectedSubnet = scenarioSubnets.find((subnet) => subnet.netuid === referenceSubnet.netuid)!;
  const resetPriceScenario = () => {
    setPriceEnabled(false);
    setTargetPriceInput("");
    setScaleEma(false);
  };
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<"idle" | "loading" | "live" | "invalid">("idle");
  const [apiKeyMessage, setApiKeyMessage] = useState("");

  const burn = burnPercent / 100;
  const taoShare = calculateTaoShare(scenarioSubnets, gateBar, gateExponent, selectedSubnet.netuid, burn);
  const maxShare = Math.max(
    calculateTaoShare(scenarioSubnets, gateBar, gateExponent, selectedSubnet.netuid, 0),
    0.0001,
  );
  const sharePercent = taoShare * 100;
  const maxSharePercent = maxShare * 100;
  const alphaRate = alphaEmissionRate(selectedSubnet.totalAlpha);
  const taoPerBlock = taoShare * BLOCK_EMISSION_TAO;
  const minerLiquidation = calculateMinerLiquidation(
    alphaRate,
    MINER_FRACTION,
    burn,
    selectedSubnet.spotPrice,
  );
  const minerUsd = minerLiquidation.minerTao * taoUsdRate * BLOCKS_PER_DAY;
  const taoUsd = taoPerBlock * taoUsdRate * BLOCKS_PER_DAY;
  const grossAllocationGapUsd = calculateGrossAllocationGapUsd(taoUsd, minerUsd);
  const routing = calculateEmissionRouting(
    taoPerBlock,
    selectedSubnet.spotPrice,
    selectedSubnet.rootProportion,
    alphaRate,
  );
  const alphaBeforeCap = routing.alphaTarget;
  const alphaCap = routing.alphaCap;
  const alphaAfterCap = routing.alphaIn;
  const liquidityTaoPerBlock = routing.liquidityTao;
  const chainBuyTaoPerBlock = routing.chainBuyTao;
  const totalTaoPerDay = taoPerBlock * BLOCKS_PER_DAY;
  const liquidityTaoPerDay = liquidityTaoPerBlock * BLOCKS_PER_DAY;
  const chainBuyTaoPerDay = chainBuyTaoPerBlock * BLOCKS_PER_DAY;
  const chainBuyUsdPerDay = chainBuyTaoPerDay * taoUsdRate;
  const minerLiquidationTaoPerDay = minerLiquidation.minerTao * BLOCKS_PER_DAY;
  const netBuyTaoPerBlock = chainBuyTaoPerBlock - minerLiquidation.minerTao;
  const netBuyTaoPerDay = netBuyTaoPerBlock * BLOCKS_PER_DAY;
  const netBuyUsdPerDay = netBuyTaoPerDay * taoUsdRate;
  const chainBuyShare = taoPerBlock > 0 ? chainBuyTaoPerBlock / taoPerBlock : 0;
  const capped = alphaAfterCap + 1e-9 < alphaBeforeCap;

  const resetScenario = () => setBurnPercent(selectedSubnet.minerBurned * 100);
  const selectSubnet = (nextNetuid: number) => {
    const nextSubnet = modelSubnets.find((subnet) => subnet.netuid === nextNetuid);
    if (!nextSubnet) return;
    resetPriceScenario();
    setSelectedNetuid(nextNetuid);
    setBurnPercent(nextSubnet.minerBurned * 100);
  };
  const setSharePercent = (value: number) => {
    setBurnPercent(
      solveBurnForShare(scenarioSubnets, gateBar, gateExponent, selectedSubnet.netuid, value / 100) * 100,
    );
  };
  const loadLiveSnapshot = async () => {
    if (!apiKey.trim()) return;
    setApiKeyStatus("loading");
    setApiKeyMessage("");
    try {
      const response = await fetch("/api/taostats/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const result = (await response.json()) as LiveSnapshot & { error?: string };
      if (!response.ok || !Array.isArray(result.subnets) || !result.subnets.length) {
        throw new Error(result.error ?? "TaoStats returned an invalid snapshot.");
      }
      resetPriceScenario();
      setSnapshot(result);
      const nextSubnet = result.subnets.find(
        (subnet) => subnet.netuid === selectedNetuid && subnet.emissionEnabled,
      ) ?? result.subnets.find((subnet) => subnet.netuid === 64 && subnet.emissionEnabled)
        ?? result.subnets.find((subnet) => subnet.emissionEnabled)
        ?? result.subnets[0];
      setSelectedNetuid(nextSubnet.netuid);
      setBurnPercent(nextSubnet.minerBurned * 100);
      setApiKeyStatus("live");
    } catch {
      setApiKeyStatus("invalid");
      setApiKeyMessage("Key rejected, data incomplete, or TaoStats unreachable.");
    }
  };

  return (
    <main id="top">
      <nav className="nav-shell">
        <a className="wordmark" href="#top" aria-label="Tensor Lens home">TENSOR<span>LENS</span></a>
        <div className="nav-links">
          <a href="#chain-buys">Net pressure</a>
          <a href="#alpha-surface">Alpha cap</a>
          <a href="#value-surface">Gross comparison</a>
          <a href="#method">Method</a>
        </div>
        <div className="nav-meta"><span className={`pulse ${snapshot ? "" : "fallback"}`} /> FINNEY · {snapshot ? "LIVE" : "FALLBACK"}</div>
      </nav>

      <header className="hero">
        <div className="eyebrow">BITTENSOR EMISSIONS LAB / 01</div>
        <h1>See where emission<br /><em>value diverges.</em></h1>
        <p>Model how miner burn reshapes a subnet&apos;s TAO allocation, miner value, capped liquidity injection and chain-buy surplus — using one coherent TaoStats snapshot when connected.</p>
      </header>

      <section className="snapshot-bar" aria-label="Current network snapshot">
        <article><span>TAO / USD</span><b>$${taoUsdRate.toFixed(2)}</b><small>as at {shortDate(snapshot?.taoPriceCapturedAt ?? FALLBACK_TAO_PRICE_CAPTURE)}</small></article>
        <article><span>BLOCK EMISSION</span><b>{BLOCK_EMISSION_TAO.toFixed(2)} τ</b><small>{BLOCKS_PER_DAY.toLocaleString()} blocks / day</small></article>
        <article><span>ACTIVE MODEL</span><b>SN{selectedSubnet.netuid}</b><small>{selectedSubnet.name}</small></article>
        <article><span>ROOT PROPORTION</span><b>{(selectedSubnet.rootProportion * 100).toFixed(2)}%</b><small>live cap input</small></article>
      </section>

      <div className={`data-state-strip ${snapshot ? "is-live" : "is-fallback"}`} role="status">
        <span>{snapshot ? "LIVE INPUTS" : "HISTORICAL FALLBACK"}</span>
        <p>{snapshot
          ? `TaoStats feeds reconciled across blocks ${snapshot.blockMin.toLocaleString()}–${snapshot.blockMax.toLocaleString()}.`
          : "These bundled values are for offline display only. Enter a TaoStats key below and choose Load live before comparing emissions."}</p>
      </div>

      <section className="selector-band">
        <div>
          <span>CHOOSE A SUBNET</span>
          <p>The model includes {modelSubnets.length} eligible pools; every burn change renormalizes the complete network.</p>
        </div>
        <label>
          <span className="sr-only">Subnet</span>
          <select value={selectedNetuid} onChange={(event) => selectSubnet(Number(event.target.value))}>
            {enabledSubnets.map((subnet) => (
              <option value={subnet.netuid} key={subnet.netuid}>SN{subnet.netuid} · {subnet.name}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="price-scenario" aria-label="Alpha price scenario">
        <label className="price-toggle">
          <input type="checkbox" checked={priceEnabled} aria-controls="price-scenario-controls"
            onChange={(event) => {
              setPriceEnabled(event.target.checked);
              if (event.target.checked && !validTargetPrice) setTargetPriceInput(String(referenceSubnet.spotPrice));
            }} />
          Model target alpha price
        </label>
        <p>Explore a target price, then lower miner burn in section 01 and compare all three sections.</p>
        {priceEnabled && <div id="price-scenario-controls" className="price-scenario-controls">
          <label className="price-field" htmlFor="target-alpha-price">
            Target alpha price · τ / α
            <input id="target-alpha-price" type="number" min="0.000000001" step="any"
              value={targetPriceInput} onChange={(event) => setTargetPriceInput(event.target.value)}
              aria-invalid={!validTargetPrice} aria-describedby="price-scenario-status price-assumption" />
          </label>
          <div className="price-reference" id="price-scenario-status" role="status">
            <span>Reference {referenceSubnet.spotPrice.toFixed(6)} τ / α</span>
            <b>{validTargetPrice
              ? `Target $${(targetPrice * taoUsdRate).toFixed(4)} / α`
              : "Enter a price of at least 0.000000001 τ / α. Reference price is in use."}</b>
          </div>
          <label className="price-toggle price-ema-toggle">
            <input type="checkbox" checked={scaleEma} onChange={(event) => setScaleEma(event.target.checked)} />
            Scale EMA demand price by the same percentage
          </label>
          <p id="price-assumption">{scaleEma
            ? "Hypothetical EMA scaling changes network allocation and the linked burn curve; it does not predict when EMA catches up."
            : "Spot-only scenario: EMA demand and the burn-to-TAO allocation curve stay fixed. Liquidation value and injection routing use the target price."}
            {" "}Other subnets, root proportion, supply and the loaded gate midpoint stay fixed. All three sections use this scenario.</p>
          <button type="button" className="price-reset" onClick={resetPriceScenario}>Reset to reference price</button>
        </div>}
      </section>

      <section className="model-shell buyback-shell" id="chain-buys">
        <div className="model-head">
          <div>
            <span className="section-index">01</span>
            <h2>Net chain-buy pressure</h2>
            <p>Gross chain-buy TAO − 100% miner-emission liquidation · τ / day</p>
          </div>
          <div className={`cap-badge ${netBuyTaoPerBlock > 0 ? "is-buying" : netBuyTaoPerBlock < 0 ? "is-selling" : ""}`}>
            {netBuyTaoPerBlock > 0 ? "NET BUY PRESSURE" : netBuyTaoPerBlock < 0 ? "NET SELL PRESSURE" : "BALANCED"}
          </div>
        </div>
        <div className="workspace-grid">
          <IsometricSurface
            mode="pressure"
            subnets={scenarioSubnets}
            gateBar={gateBar}
            gateExponent={gateExponent}
            taoUsdRate={taoUsdRate}
            subnet={selectedSubnet}
            burn={burn}
            share={taoShare}
            maxShare={maxShare}
          />
          <aside className="control-panel buyback-panel">
            <div className="control-title"><span>EMISSION ROUTING</span><b>01</b></div>
            <Slider
              label="Miner burn"
              value={burnPercent}
              display={`${burnPercent.toFixed(1)}%`}
              min={0}
              max={100}
              step={0.1}
              onChange={setBurnPercent}
              describedBy="linked-note-pressure"
            />
            <Slider
              label="TAO emission"
              value={sharePercent}
              display={`${sharePercent.toFixed(3)}%`}
              min={0}
              max={maxSharePercent}
              step={Math.max(0.001, maxSharePercent / 500)}
              onChange={setSharePercent}
              describedBy="linked-note-pressure"
            />
            <p className="linked-note" id="linked-note-pressure"><i /> Synced with section 03. Moving TAO emission solves for the miner-burn value that produces it.</p>
            <div className="alpha-result chain-buy-result">
              <span>NET CHAIN-BUY PRESSURE / DAY</span>
              <div className={`chain-buy-result-values ${netBuyTaoPerDay >= 0 ? "positive" : "negative"}`}>
                <b>{compactSignedTao(netBuyTaoPerDay)}</b>
                <strong>{compactUsd(netBuyUsdPerDay)}</strong>
              </div>
              <small>Gross chain buys − 100% miner liquidation · {netBuyTaoPerBlock.toFixed(5)} τ / block</small>
            </div>
            <div
              className="routing-meter"
              aria-label={`${((1 - chainBuyShare) * 100).toFixed(1)} percent to liquidity pool and ${(chainBuyShare * 100).toFixed(1)} percent to chain buys`}
            >
              <span className="routing-lp" style={{ width: `${(1 - chainBuyShare) * 100}%` }} />
              <span className="routing-buy" style={{ width: `${chainBuyShare * 100}%` }} />
            </div>
            <div className="routing-labels" aria-hidden="true">
              <span>LP {((1 - chainBuyShare) * 100).toFixed(1)}%</span>
              <span>CHAIN BUY {(chainBuyShare * 100).toFixed(1)}%</span>
            </div>
            <div className="metric-pair">
              <div><span>GROSS CHAIN BUY / DAY</span><b>{compactTao(chainBuyTaoPerDay)}</b></div>
              <div><span>MINER LIQUIDATION / DAY</span><b>{compactLiquidationTao(minerLiquidationTaoPerDay)}</b></div>
              <div><span>GROSS CHAIN BUY VALUE / DAY</span><b>{compactUsd(chainBuyUsdPerDay)}</b></div>
              <div><span>MINER LIQUIDATION VALUE / DAY</span><b>{compactLiquidationUsd(minerUsd)}</b></div>
              <div><span>TOTAL TAO ALLOCATION / DAY</span><b>{compactTao(totalTaoPerDay)}</b></div>
              <div><span>PRICE-NEUTRAL LP TAO / DAY</span><b>{compactTao(liquidityTaoPerDay)}</b></div>
            </div>
            <p className="cap-note">The LP portion is paired with newly minted α_in. Net pressure assumes miners immediately liquidate 100% of their post-burn alpha emission at the displayed spot price.</p>
          </aside>
        </div>
      </section>

      <section className="model-shell alpha-shell" id="alpha-surface">
        <div className="model-head">
          <div>
            <span className="section-index">02</span>
            <h2>Alpha injection after cap</h2>
            <p>min(TAO allocation ÷ spot price, root proportion × alpha emission) · α / day</p>
          </div>
          <div className={`cap-badge ${capped ? "is-capped" : ""}`}>{capped ? "CAP BINDING" : "BELOW CAP"}</div>
        </div>
        <div className="workspace-grid">
          <IsometricSurface
            mode="alpha"
            subnets={scenarioSubnets}
            gateBar={gateBar}
            gateExponent={gateExponent}
            taoUsdRate={taoUsdRate}
            subnet={selectedSubnet}
            burn={burn}
            share={taoShare}
            maxShare={maxShare}
          />
          <aside className="control-panel alpha-panel">
            <div className="control-title"><span>CAP READOUT</span><b>02</b></div>
            <div className="alpha-result">
              <span>α_IN AFTER CAP</span>
              <b>{compactAlpha(alphaAfterCap * BLOCKS_PER_DAY)}</b>
              <small>{alphaAfterCap.toFixed(5)} α / block</small>
            </div>
            <div className="cap-meter" aria-label={`${Math.min(100, (alphaBeforeCap / Math.max(alphaCap, 1e-9)) * 100).toFixed(0)} percent of alpha injection cap`}>
              <span style={{ width: `${Math.min(100, (alphaBeforeCap / Math.max(alphaCap, 1e-9)) * 100)}%` }} />
            </div>
            <div className="metric-pair">
              <div><span>PRICE-NEUTRAL TARGET</span><b>{alphaBeforeCap.toFixed(5)} α</b></div>
              <div><span>INJECTION CAP</span><b>{alphaCap.toFixed(5)} α</b></div>
              <div><span>ROOT PROPORTION</span><b>{(selectedSubnet.rootProportion * 100).toFixed(2)}%</b></div>
              <div><span>{priceEnabled && validTargetPrice ? "TARGET SPOT PRICE" : "SPOT PRICE"}</span><b>{selectedSubnet.spotPrice.toFixed(6)} τ/α</b></div>
            </div>
            <p className="cap-note">{capped ? "Excess TAO is routed to protocol buybacks rather than liquidity injection." : "TAO injection remains price-neutral because the root-proportion cap is not reached."}</p>
          </aside>
        </div>
      </section>

      <section className="model-shell" id="value-surface">
        <div className="model-head">
          <div>
            <span className="section-index">03</span>
            <h2>Gross allocation value gap</h2>
            <p>Accounting comparison: total TAO allocation − miner liquidation value · USD / day</p>
          </div>
          <div className="subnet-chip"><b>SN{selectedSubnet.netuid}</b><span>{selectedSubnet.name}</span></div>
        </div>
        <div className="model-clarifier" role="note">
          <strong>NOT NET MARKET PRESSURE</strong>
          <span>This gross figure counts price-neutral LP TAO alongside chain buys.</span>
          <a href="#chain-buys">See the real net buy/sell pressure in section 01 ↑</a>
        </div>
        <div className="workspace-grid">
          <IsometricSurface
            mode="difference"
            subnets={scenarioSubnets}
            gateBar={gateBar}
            gateExponent={gateExponent}
            taoUsdRate={taoUsdRate}
            subnet={selectedSubnet}
            burn={burn}
            share={taoShare}
            maxShare={maxShare}
          />
          <aside className="control-panel">
            <div className="control-title"><span>LINKED SCENARIO</span><b>03</b></div>
            <Slider
              label="Miner burn"
              value={burnPercent}
              display={`${burnPercent.toFixed(1)}%`}
              min={0}
              max={100}
              step={0.1}
              onChange={setBurnPercent}
              describedBy="linked-note"
            />
            <Slider
              label="TAO emission"
              value={sharePercent}
              display={`${sharePercent.toFixed(3)}%`}
              min={0}
              max={maxSharePercent}
              step={Math.max(0.001, maxSharePercent / 500)}
              onChange={setSharePercent}
              describedBy="linked-note"
            />
            <p className="linked-note" id="linked-note"><i /> Bidirectionally linked. Moving TAO emission solves for the miner-burn value that produces it.</p>
            <div className="scenario-result">
              <span>GROSS GAP · ACCOUNTING VIEW</span>
              <b className={grossAllocationGapUsd >= 0 ? "positive" : "negative"}>{compactUsd(grossAllocationGapUsd)}</b>
              <small>{grossAllocationGapUsd > 0
                ? "Total TAO allocation exceeds miner liquidation"
                : grossAllocationGapUsd < 0
                  ? "Miner liquidation exceeds total TAO allocation"
                  : "Total TAO allocation and miner liquidation are equal"} per day · not net price pressure</small>
            </div>
            <div className="metric-pair">
              <div><span>MINER LIQUIDATION VALUE / DAY</span><b>{compactUsd(minerUsd)}</b></div>
              <div><span>GROSS TAO ALLOCATION VALUE / DAY</span><b>{compactUsd(taoUsd)}</b></div>
              <div><span>TAO / BLOCK</span><b>{taoPerBlock.toFixed(5)} τ</b></div>
              <div><span>{priceEnabled && validTargetPrice && scaleEma ? "SCENARIO EMA PRICE" : "EMA PRICE"}</span><b>{selectedSubnet.emaPrice.toFixed(6)}</b></div>
            </div>
            <button className="reset-scenario" type="button" onClick={resetScenario}>Reset to reference burn ↗</button>
          </aside>
        </div>
      </section>

      <section className="method" id="method">
        <div className="method-intro">
          <span className="eyebrow">MODEL NOTES / 04</span>
          <h2>What the surfaces mean.</h2>
          <p>Each canvas is an isometric height mesh: miner burn and TAO emission form the floor, while elevation and colour carry the relative modeled result. The white line is the subset the network can actually produce; the ring marks your current scenario.</p>
        </div>
        <div className="formula-grid">
          <article>
            <span>01 · DEMAND</span>
            <code>dᵢ = EMAᵢ / Σ EMA</code>
            <p>Each eligible subnet&apos;s moving price becomes its starting demand share.</p>
          </article>
          <article>
            <span>02 · BURN + GATE</span>
            <code>sᵢ → sᵢ·gate(sᵢ) → normalize</code>
            <p>Burn-adjusted demand is renormalized across every eligible subnet, passed through the fixed Hill gate, then redistributed over enabled subnets.</p>
          </article>
          <article>
            <span>03 · GROSS VALUE GAP</span>
            <code>gross Δ$ = total TAO value − miner liquidation</code>
            <p>This accounting comparison includes price-neutral LP injection, so it is explicitly not a measure of net buy or sell pressure.</p>
          </article>
          <article>
            <span>04 · ALPHA CAP</span>
            <code>α_in = min(tao_alloc / price, root_prop × α rate)</code>
            <p>The second surface shows the price-neutral injection after the protocol&apos;s root-proportion cap.</p>
          </article>
          <article>
            <span>05 · NET PRESSURE</span>
            <code>tao_net = tao_buy − (miner α × price)</code>
            <p>Section one shows the market-impact view by subtracting the TAO value of 100% miner liquidation from chain buys.</p>
          </article>
          <article>
            <span>06 · RECONCILIATION</span>
            <code>tao_alloc = tao_LP + tao_buy</code>
            <p>The total TAO value in section three contains both routes; section one isolates only the chain-buy surplus.</p>
          </article>
        </div>
      </section>

      <section className="provenance">
        <div>
          <span>MARKET SNAPSHOT</span>
          <b>{snapshot ? `TaoStats live · block ${snapshot.blockMin.toLocaleString()}–${snapshot.blockMax.toLocaleString()}` : `Bundled fallback · block ${FALLBACK_LIVE_BLOCK.toLocaleString()}`}</b>
          <small>{shortDate(snapshot?.capturedAt ?? FALLBACK_LIVE_CAPTURE)} · moving prices, burns, eligibility, enablement and pools fetched together</small>
        </div>
        <div>
          <span>EMA + BURN BASELINE</span>
          <b>{snapshot ? "Same-request TaoStats inputs" : "Historical reference inputs"}</b>
          <small>{snapshot ? `${modelSubnets.length} eligible subnets · scenario overrides the selected burn and optional alpha price` : `${shortDate(FALLBACK_EMA_CAPTURE)} · connect a key to replace this fallback`}</small>
        </div>
        <div>
          <span>MODEL SOURCE</span>
          <b>Bittensor runtime formula · θ {(gateBar * 100).toFixed(3)}%</b>
          <small>0.5 τ / block · 12-second blocks · rank-32 midpoint fixed for the loaded scenario</small>
        </div>
      </section>

      <footer>
        <a className="wordmark" href="#top">TENSOR<span>LENS</span></a>
        <p>Emission surfaces for exploration, not financial advice.</p>
        <div>
          <a href="https://www.bittensor.com/docs/concepts/emissions" target="_blank" rel="noreferrer">Bittensor docs ↗</a>
          <a href="https://mcp.taostats.io/" target="_blank" rel="noreferrer">TaoStats ↗</a>
        </div>
      </footer>

      <aside className="api-key-dock" aria-label="TaoStats API key">
        <div className="api-key-title">
          <div><span className="pulse" /> TAOSTATS CONNECTION</div>
          <small>LOCAL SESSION</small>
        </div>
        <label htmlFor="taostats-api-key">API key</label>
        <div className="api-key-input">
          <input
            id="taostats-api-key"
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setApiKeyStatus("idle");
              setApiKeyMessage("");
            }}
            placeholder="tao-••••••••:••••••••"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" onClick={() => setShowApiKey((visible) => !visible)} aria-pressed={showApiKey}>
            {showApiKey ? "Hide" : "Show"}
          </button>
        </div>
        <div className="api-key-actions">
          <p className={`api-key-status ${apiKeyStatus}`} aria-live="polite">
            {apiKeyStatus === "loading" && "Loading four live TaoStats feeds…"}
            {apiKeyStatus === "live" && snapshot && `Live · blocks ${snapshot.blockMin.toLocaleString()}–${snapshot.blockMax.toLocaleString()}`}
            {apiKeyStatus === "invalid" && (apiKeyMessage || "Key invalid or TaoStats unreachable")}
            {apiKeyStatus === "idle" && (snapshot ? "Snapshot retained · reload to refresh" : "Held in memory only · never stored")}
          </p>
          <button type="button" className="verify-key" onClick={loadLiveSnapshot} disabled={!apiKey.trim() || apiKeyStatus === "loading"}>
            {snapshot ? "Refresh live" : "Load live"}
          </button>
        </div>
      </aside>
    </main>
  );
}
