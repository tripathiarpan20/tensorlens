import { buildLiveSnapshot, type TaoStatsSnapshotPayload } from "../../../taostats-snapshot";

const TAOSTATS_API = "https://api.taostats.io";
const ROUTES = {
  subnet: "/api/subnet/latest/v1?limit=200&order=netuid_asc",
  pool: "/api/dtao/pool/latest/v1?limit=200&order=netuid_asc",
  pruning: "/api/subnet/pruning/latest/v1?limit=200&order=netuid_asc",
  price: "/api/price/latest/v1?asset=tao",
} as const;

async function fetchTaoStats(path: string, apiKey: string) {
  const response = await fetch(`${TAOSTATS_API}${path}`, {
    headers: {
      authorization: apiKey,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "invalid-key" : `taostats-${response.status}`);
  }
  return response.json();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 512) {
      return Response.json({ error: "Enter a valid TaoStats API key." }, { status: 400 });
    }

    const [subnet, pool, pruning, price] = await Promise.all([
      fetchTaoStats(ROUTES.subnet, apiKey),
      fetchTaoStats(ROUTES.pool, apiKey),
      fetchTaoStats(ROUTES.pruning, apiKey),
      fetchTaoStats(ROUTES.price, apiKey),
    ]);
    const snapshot = buildLiveSnapshot({ subnet, pool, pruning, price } as TaoStatsSnapshotPayload);
    return Response.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "invalid-key";
    return Response.json(
      { error: invalid ? "API key rejected by TaoStats." : "Could not build a live TaoStats snapshot." },
      { status: invalid ? 401 : 502, headers: { "cache-control": "no-store" } },
    );
  }
}
