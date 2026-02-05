import fs from "fs";
import path from "path";
import axios from "axios";
import { buildOpenApiSpec } from "../../src/config/docs/openapi";
import { getDocsEnv } from "../../src/config/docs/env";

async function exportSpec() {
  const env = getDocsEnv();
  const outputDir = path.join(process.cwd(), ".openapi");
  const outputFile = path.join(outputDir, "openapi.json");

  let spec: unknown;

  if (env.baseUrl) {
    const url = new URL(env.specPath, env.baseUrl).toString();
    const response = await axios.get(url, { timeout: 10000 });
    spec = response.data;
  } else {
    spec = buildOpenApiSpec();
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(spec, null, 2), "utf8");

  console.log(`OpenAPI spec written to ${outputFile}`);
}

exportSpec().catch((error) => {
  console.error("Failed to export OpenAPI spec:", error);
  process.exit(1);
});
