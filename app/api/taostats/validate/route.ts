const TAOSTATS_MCP_URL = "https://mcp.taostats.io?tools=data";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 512) {
      return Response.json({ valid: false }, { status: 400 });
    }

    const response = await fetch(TAOSTATS_MCP_URL, {
      method: "POST",
      headers: {
        authorization: apiKey,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "tensor-lens-local", version: "1.0.0" },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    const valid = response.ok && text.includes('"serverInfo"') && text.includes('"Taostats MCP Server"');
    return Response.json({ valid }, { status: valid ? 200 : 401 });
  } catch {
    return Response.json({ valid: false }, { status: 502 });
  }
}
