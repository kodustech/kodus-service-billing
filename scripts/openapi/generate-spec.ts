import fs from "fs";
import path from "path";
import { buildOpenApiSpec } from "../../src/config/docs/openapi";

const outputDir = path.join(process.cwd(), ".openapi");
const outputFile = path.join(outputDir, "openapi.json");

fs.mkdirSync(outputDir, { recursive: true });

const spec = buildOpenApiSpec();
fs.writeFileSync(outputFile, JSON.stringify(spec, null, 2), "utf8");

console.log(`OpenAPI spec written to ${outputFile}`);
