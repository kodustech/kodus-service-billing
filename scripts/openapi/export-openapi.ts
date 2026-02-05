import fs from "fs";
import path from "path";
import axios from "axios";
import { buildOpenApiSpec } from "../../src/config/docs/openapi";
import { getDocsEnv, DocsEnv } from "../../src/config/docs/env";

const DEFAULT_EXPORT_HOSTS = ["localhost", "127.0.0.1", "::1"];

function normalizeHost(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname;
    } catch (error) {
      return null;
    }
  }

  return trimmed;
}

export function resolveAllowedHosts(env: DocsEnv): Set<string> {
  const hosts = new Set<string>();

  if (env.serverUrls) {
    const serverHosts = env.serverUrls
      .split(",")
      .map((entry) => entry.split("|")[0])
      .map((entry) => normalizeHost(entry))
      .filter((entry): entry is string => Boolean(entry));
    serverHosts.forEach((host) => hosts.add(host));
  }

  DEFAULT_EXPORT_HOSTS.forEach((host) => hosts.add(host));

  return hosts;
}

export function isHostAllowed(host: string, allowlist: Set<string>): boolean {
  return allowlist.has(host);
}

function assertAllowedUrl(url: URL, allowlist: Set<string>) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`URL protocol not allowed: ${url.protocol}`);
  }

  if (!isHostAllowed(url.hostname, allowlist)) {
    throw new Error(
      `Host not allowed: ${url.hostname}. Allowed: ${Array.from(allowlist).join(", ")}`
    );
  }
}

export async function exportSpec() {
  const env = getDocsEnv();
  const outputDir = path.join(process.cwd(), ".openapi");
  const outputFile = path.join(outputDir, "openapi.json");

  let spec: unknown;

  if (env.baseUrl) {
    const url = new URL(env.specPath, env.baseUrl);
    const allowedHosts = resolveAllowedHosts(env);
    assertAllowedUrl(url, allowedHosts);
    const response = await axios.get(url.toString(), { timeout: 10000 });
    spec = response.data;
  } else {
    spec = buildOpenApiSpec();
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(spec, null, 2), "utf8");

  console.log(`OpenAPI spec written to ${outputFile}`);
}

if (require.main === module) {
  exportSpec().catch((error) => {
    console.error("Failed to export OpenAPI spec:", error);
    process.exit(1);
  });
}
