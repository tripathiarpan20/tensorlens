import { existsSync, readFileSync } from "node:fs";
import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

type HostingConfig = {
  d1: string | null;
  r2: string | null;
};

const hostingConfigUrl = new URL("./.openai/hosting.json", import.meta.url);
const hasHostingConfig = existsSync(hostingConfigUrl);
const hostingConfig: HostingConfig = hasHostingConfig
  ? JSON.parse(readFileSync(hostingConfigUrl, "utf8"))
  : { d1: null, r2: null };
const isVercelBuild = process.env.VERCEL === "1"
  || process.env.NITRO_PRESET === "vercel";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const deploymentPlugin = isVercelBuild
    ? (await import("nitro/vite")).nitro({ preset: "vercel" })
    : (await import("@cloudflare/vite-plugin")).cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      });

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...(hasHostingConfig && !isVercelBuild ? [sites()] : []),
      deploymentPlugin,
    ],
  };
});
