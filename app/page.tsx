"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_EMISSION_TAO,
  BLOCKS_PER_DAY,
  EMA_CAPTURE,
  GATE_BAR,
  GATE_EXPONENT,
  LIVE_BLOCK,
  LIVE_CAPTURE,
  MINER_FRACTION,
  SUBNETS,
  TAO_PRICE_CAPTURE,
  TAO_USD,
  type SubnetPoint,
} from "./emission-data";

type SurfaceMode = "difference" | "alpha";

const enabledSubnets = SUBNETS.filter((subnet) => subnet.emissionEnabled);

function alphaEmissionRate(totalAlpha: number) {
  let rate = 1;
  let threshold = 10_500_000;
  while (totalAlpha >= threshold && rate > 1 / 1024) {
    rate /= 2;
    threshold = 21_000_000 - (21_000_000 - threshold) / 2;
  }
  return rate;
}

function calculateTaoShare(selectedNetuid: number, selectedBurn: number) {
  const emaTotal = SUBNETS.reduce((sum, subnet) => sum + subnet.emaPrice, 0);
  const adjusted = SUBNETS.map((subnet) => {
    const burn = subnet.netuid === selectedNetuid ? selectedBurn : subnet.minerBurned;
    return {
      subnet,
      weight: (subnet.emaPrice / emaTotal) * (1 - Math.min(1, Math.max(0, burn))),
    };
  });
  const adjustedTotal = adjusted.reduce((sum, item) => sum + item.weight, 0);
  const gated = adjusted.map((item) => {
    const share = adjustedTotal > 0 ? item.weight / adjustedTotal : 0;
    const gate = share > 0 ? 1 / (1 + Math.pow(GATE_BAR / share, GATE_EXPONENT)) : 0;
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

function solveBurnForShare(netuid: number, targetShare: number) {
  let low = 0;
  let high = 1;
  const highShare = calculateTaoShare(netuid, low);
  if (targetShare >= highShare) return 0;
  if (targetShare <= calculateTaoShare(netuid, high)) return 1;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    const share = calculateTaoShare(netuid, mid);
    if (share > targetShare) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function surfaceValue(mode: SurfaceMode, subnet: SubnetPoint, burn: number, taoShare: number) {
  const alphaRate = alphaEmissionRate(subnet.totalAlpha);
  const taoPerBlock = taoShare * BLOCK_EMISSION_TAO;
  if (mode === "alpha") {
    return Math.min(taoPerBlock / Math.max(subnet.spotPrice, 1e-9), subnet.rootProportion * alphaRate) * BLOCKS_PER_DAY;
  }
  const minerUsd =
    MINER_FRACTION * (1 - burn) * alphaRate * subnet.spotPrice * TAO_USD * BLOCKS_PER_DAY;
  const taoUsd = taoPerBlock * TAO_USD * BLOCKS_PER_DAY;
  return minerUsd - taoUsd;
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

function Surface3D({
  mode,
  subnet,
  burn,
  share,
  maxShare,
}: {
  mode: SurfaceMode;
  subnet: SubnetPoint;
  burn: number;
  share: number;
  maxShare: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ yaw: -0.72, pitch: 0.92, zoom: 1 });
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

    const steps = 22;
    const values: number[][] = [];
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (let yi = 0; yi <= steps; yi++) {
      values[yi] = [];
      for (let xi = 0; xi <= steps; xi++) {
        const value = surfaceValue(mode, subnet, xi / steps, (yi / steps) * maxShare);
        values[yi][xi] = value;
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    }
    const span = Math.max(1e-9, maxValue - minValue);
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch);
    const sp = Math.sin(view.pitch);
    const project = (x: number, y: number, value: number) => {
      const px = x - 0.5;
      const py = y - 0.5;
      const pz = ((value - minValue) / span - 0.5) * 0.9;
      const rx = px * cy - py * sy;
      const ry = px * sy + py * cy;
      const projectedY = ry * cp - pz * sp;
      const depth = ry * sp + pz * cp;
      return {
        x: w * 0.5 + rx * Math.min(w, h * 1.45) * 0.82 * view.zoom,
        y: h * 0.51 + projectedY * Math.min(h, w * 0.68) * 0.76 * view.zoom,
        depth,
      };
    };

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
          project(x0, y0, values[yi][xi]),
          project(x1, y0, values[yi][xi + 1]),
          project(x1, y1, values[yi + 1][xi + 1]),
          project(x0, y1, values[yi + 1][xi]),
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
      const t = (cell.value - minValue) / span;
      const hue = mode === "difference" ? 236 + t * 103 : 188 - t * 112;
      ctx.beginPath();
      ctx.moveTo(cell.points[0].x, cell.points[0].y);
      for (let i = 1; i < cell.points.length; i++) ctx.lineTo(cell.points[i].x, cell.points[i].y);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 88%, ${47 + t * 10}%, .78)`;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const pathBurn = i / 80;
      const pathShare = calculateTaoShare(subnet.netuid, pathBurn);
      const pathValue = surfaceValue(mode, subnet, pathBurn, pathShare);
      const point = project(pathBurn, maxShare ? pathShare / maxShare : 0, pathValue);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = mode === "difference" ? "#ff3f91" : "#d9ff43";
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const markerValue = surfaceValue(mode, subnet, burn, share);
    const marker = project(burn, maxShare ? share / maxShare : 0, markerValue);
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = mode === "difference" ? "#ff3f91" : "#d9ff43";
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 13, 0, Math.PI * 2);
    ctx.strokeStyle = mode === "difference" ? "#ff3f91" : "#d9ff43";
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [burn, maxShare, mode, share, sizeTick, subnet, view]);

  const resetView = () => setView({ yaw: -0.72, pitch: 0.92, zoom: 1 });

  return (
    <div className="canvas-stage">
      <canvas
        ref={canvasRef}
        className="surface-canvas"
        role="img"
        tabIndex={0}
        aria-label={mode === "difference" ? "Interactive three-dimensional net emissions value surface" : "Interactive three-dimensional capped alpha injection surface"}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const dx = event.clientX - dragRef.current.x;
          const dy = event.clientY - dragRef.current.y;
          dragRef.current = { x: event.clientX, y: event.clientY };
          setView((current) => ({
            ...current,
            yaw: current.yaw + dx * 0.008,
            pitch: Math.max(0.28, Math.min(1.35, current.pitch + dy * 0.006)),
          }));
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
          if (event.key === "ArrowLeft") setView((current) => ({ ...current, yaw: current.yaw - 0.08 }));
          if (event.key === "ArrowRight") setView((current) => ({ ...current, yaw: current.yaw + 0.08 }));
          if (event.key === "ArrowUp") setView((current) => ({ ...current, pitch: Math.max(0.28, current.pitch - 0.06) }));
          if (event.key === "ArrowDown") setView((current) => ({ ...current, pitch: Math.min(1.35, current.pitch + 0.06) }));
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
      <span className="axis axis-z">{mode === "difference" ? "NET · USD/DAY" : "α_IN · ALPHA/DAY"}</span>
      <span className="axis axis-x">MINER BURN % →</span>
      <span className="axis axis-y">TAO EMISSION % →</span>
      <div className="interaction-hint">DRAG · ROTATE &nbsp; / &nbsp; SCROLL · ZOOM</div>
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
  const [selectedNetuid, setSelectedNetuid] = useState(4);
  const selectedSubnet = useMemo(
    () => SUBNETS.find((subnet) => subnet.netuid === selectedNetuid) ?? SUBNETS[3],
    [selectedNetuid],
  );
  const [burnPercent, setBurnPercent] = useState(selectedSubnet.minerBurned * 100);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  useEffect(() => {
    setBurnPercent(selectedSubnet.minerBurned * 100);
  }, [selectedSubnet]);

  const burn = burnPercent / 100;
  const taoShare = calculateTaoShare(selectedSubnet.netuid, burn);
  const maxShare = Math.max(calculateTaoShare(selectedSubnet.netuid, 0), 0.0001);
  const sharePercent = taoShare * 100;
  const maxSharePercent = maxShare * 100;
  const alphaRate = alphaEmissionRate(selectedSubnet.totalAlpha);
  const taoPerBlock = taoShare * BLOCK_EMISSION_TAO;
  const minerUsd =
    MINER_FRACTION * (1 - burn) * alphaRate * selectedSubnet.spotPrice * TAO_USD * BLOCKS_PER_DAY;
  const taoUsd = taoPerBlock * TAO_USD * BLOCKS_PER_DAY;
  const netUsd = minerUsd - taoUsd;
  const alphaBeforeCap = taoPerBlock / Math.max(selectedSubnet.spotPrice, 1e-9);
  const alphaCap = selectedSubnet.rootProportion * alphaRate;
  const alphaAfterCap = Math.min(alphaBeforeCap, alphaCap);
  const capped = alphaAfterCap + 1e-9 < alphaBeforeCap;

  const resetScenario = () => setBurnPercent(selectedSubnet.minerBurned * 100);
  const setSharePercent = (value: number) => {
    setBurnPercent(solveBurnForShare(selectedSubnet.netuid, value / 100) * 100);
  };
  const verifyApiKey = async () => {
    if (!apiKey.trim()) return;
    setApiKeyStatus("checking");
    try {
      const response = await fetch("/api/taostats/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const result = (await response.json()) as { valid?: boolean };
      setApiKeyStatus(response.ok && result.valid ? "valid" : "invalid");
    } catch {
      setApiKeyStatus("invalid");
    }
  };

  return (
    <main id="top">
      <nav className="nav-shell">
        <a className="wordmark" href="#top" aria-label="Tensor Lens home">TENSOR<span>LENS</span></a>
        <div className="nav-links">
          <a href="#value-surface">Value surface</a>
          <a href="#alpha-surface">Alpha cap</a>
          <a href="#method">Method</a>
        </div>
        <div className="nav-meta"><span className="pulse" /> FINNEY · SNAPSHOT</div>
      </nav>

      <header className="hero">
        <div className="eyebrow">BITTENSOR EMISSIONS LAB / 01</div>
        <h1>See where emission<br /><em>value diverges.</em></h1>
        <p>Model how miner burn reshapes a subnet&apos;s TAO allocation, miner value and capped alpha injection — using the latest TaoStats market snapshot.</p>
      </header>

      <section className="snapshot-bar" aria-label="Current network snapshot">
        <article><span>TAO / USD</span><b>$${TAO_USD.toFixed(2)}</b><small>as at {shortDate(TAO_PRICE_CAPTURE)}</small></article>
        <article><span>BLOCK EMISSION</span><b>{BLOCK_EMISSION_TAO.toFixed(2)} τ</b><small>{BLOCKS_PER_DAY.toLocaleString()} blocks / day</small></article>
        <article><span>ACTIVE MODEL</span><b>SN{selectedSubnet.netuid}</b><small>{selectedSubnet.name}</small></article>
        <article><span>ROOT PROPORTION</span><b>{(selectedSubnet.rootProportion * 100).toFixed(2)}%</b><small>live cap input</small></article>
      </section>

      <section className="selector-band">
        <div>
          <span>CHOOSE A SUBNET</span>
          <p>The model includes {SUBNETS.length} current pools; allocation excludes emission-disabled subnets.</p>
        </div>
        <label>
          <span className="sr-only">Subnet</span>
          <select value={selectedNetuid} onChange={(event) => setSelectedNetuid(Number(event.target.value))}>
            {enabledSubnets.map((subnet) => (
              <option value={subnet.netuid} key={subnet.netuid}>SN{subnet.netuid} · {subnet.name}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="model-shell" id="value-surface">
        <div className="model-head">
          <div>
            <span className="section-index">01</span>
            <h2>Value difference surface</h2>
            <p>Miner alpha value after burn − TAO injection value · USD / day</p>
          </div>
          <div className="subnet-chip"><b>SN{selectedSubnet.netuid}</b><span>{selectedSubnet.name}</span></div>
        </div>
        <div className="workspace-grid">
          <Surface3D mode="difference" subnet={selectedSubnet} burn={burn} share={taoShare} maxShare={maxShare} />
          <aside className="control-panel">
            <div className="control-title"><span>LINKED SCENARIO</span><b>01</b></div>
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
              <span>NET DIFFERENCE</span>
              <b className={netUsd >= 0 ? "positive" : "negative"}>{compactUsd(netUsd)}</b>
              <small>{netUsd >= 0 ? "Miner value leads TAO injection" : "TAO injection leads miner value"} per day</small>
            </div>
            <div className="metric-pair">
              <div><span>MINER VALUE / DAY</span><b>{compactUsd(minerUsd)}</b></div>
              <div><span>TAO VALUE / DAY</span><b>{compactUsd(taoUsd)}</b></div>
              <div><span>TAO / BLOCK</span><b>{taoPerBlock.toFixed(5)} τ</b></div>
              <div><span>EMA PRICE</span><b>{selectedSubnet.emaPrice.toFixed(6)}</b></div>
            </div>
            <button className="reset-scenario" type="button" onClick={resetScenario}>Reset to reference burn ↗</button>
          </aside>
        </div>
      </section>

      <section className="model-shell alpha-shell" id="alpha-surface">
        <div className="model-head">
          <div>
            <span className="section-index">02</span>
            <h2>Alpha injection after cap</h2>
            <p>min(tao_in ÷ spot price, root proportion × alpha emission) · α / day</p>
          </div>
          <div className={`cap-badge ${capped ? "is-capped" : ""}`}>{capped ? "CAP BINDING" : "BELOW CAP"}</div>
        </div>
        <div className="workspace-grid">
          <Surface3D mode="alpha" subnet={selectedSubnet} burn={burn} share={taoShare} maxShare={maxShare} />
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
              <div><span>SPOT PRICE</span><b>{selectedSubnet.spotPrice.toFixed(6)} τ/α</b></div>
            </div>
            <p className="cap-note">{capped ? "Excess TAO is routed to protocol buybacks rather than liquidity injection." : "TAO injection remains price-neutral because the root-proportion cap is not reached."}</p>
          </aside>
        </div>
      </section>

      <section className="method" id="method">
        <div className="method-intro">
          <span className="eyebrow">MODEL NOTES / 03</span>
          <h2>What the surfaces mean.</h2>
          <p>The coloured plane shows every burn/emission combination. The white line is the subset the network can actually produce because TAO emission is a function of miner burn; the ring marks your current scenario.</p>
        </div>
        <div className="formula-grid">
          <article>
            <span>01 · DEMAND</span>
            <code>dᵢ = EMAᵢ / Σ EMA</code>
            <p>Each eligible subnet&apos;s moving price becomes its starting demand share.</p>
          </article>
          <article>
            <span>02 · BURN + GATE</span>
            <code>sᵢ ∝ dᵢ(1 − burnᵢ) · gate(dᵢ)</code>
            <p>The selected burn is renormalized across the network, passed through the Hill gate, then adjusted for enabled subnets.</p>
          </article>
          <article>
            <span>03 · VALUE GAP</span>
            <code>Δ$ = miner α value − tao_in value</code>
            <p>Miner value uses 41% of participant alpha emission after the scenario burn, priced at the current subnet spot and TAO/USD price.</p>
          </article>
          <article>
            <span>04 · ALPHA CAP</span>
            <code>α_in = min(tao_in / price, root_prop × α rate)</code>
            <p>The second surface shows the price-neutral injection after the protocol&apos;s root-proportion cap.</p>
          </article>
        </div>
      </section>

      <section className="provenance">
        <div>
          <span>MARKET SNAPSHOT</span>
          <b>TaoStats MCP · block {LIVE_BLOCK.toLocaleString()}</b>
          <small>{shortDate(LIVE_CAPTURE)} · prices, root proportions, supply and enablement for {SUBNETS.length} pools</small>
        </div>
        <div>
          <span>EMA + BURN BASELINE</span>
          <b>Bittensor emissions snapshot</b>
          <small>{shortDate(EMA_CAPTURE)} · public reference inputs; current scenario overrides the selected subnet burn</small>
        </div>
        <div>
          <span>MODEL SOURCE</span>
          <b>Bittensor runtime formula</b>
          <small>0.5 τ / block · 12-second blocks · fixed reference gate midpoint</small>
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
            {apiKeyStatus === "checking" && "Checking with TaoStats…"}
            {apiKeyStatus === "valid" && "Key valid · ready"}
            {apiKeyStatus === "invalid" && "Key invalid or TaoStats unreachable"}
            {apiKeyStatus === "idle" && "Held in memory only · never stored"}
          </p>
          <button type="button" className="verify-key" onClick={verifyApiKey} disabled={!apiKey.trim() || apiKeyStatus === "checking"}>
            Verify
          </button>
        </div>
      </aside>
    </main>
  );
}
