const deps = [
  "swagger-jsdoc",
  "swagger-ui-express",
  "ipaddr.js",
  "@redocly/cli",
  "openapi-to-postmanv2",
  "newman",
];

const fs = require("fs");
const path = require("path");

const missing = [];

for (const dep of deps) {
  try {
    require.resolve(dep);
    continue;
  } catch (error) {
    try {
      require.resolve(`${dep}/package.json`);
      continue;
    } catch (innerError) {
      const localPath = path.join(process.cwd(), "node_modules", dep);
      if (fs.existsSync(localPath)) {
        continue;
      }
      missing.push(dep);
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing OpenAPI deps: ${missing.join(", ")}`);
  process.exit(1);
}

process.exit(0);
