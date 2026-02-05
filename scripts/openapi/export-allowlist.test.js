require("ts-node/register/transpile-only");
const assert = require("assert");

const {
  resolveAllowedHosts,
  isHostAllowed,
} = require("../../scripts/openapi/export-openapi");
const { getDocsEnv } = require("../../src/config/docs/env");

process.env.API_DOCS_BASE_URL = "http://localhost:3992";
process.env.API_DOCS_SERVER_URLS = "https://qa.api.kodus.io|QA";
process.env.API_DOCS_EXPORT_ALLOWLIST = "";

{
  const hosts = resolveAllowedHosts(getDocsEnv());
  assert.ok(hosts.has("localhost"));
  assert.ok(hosts.has("qa.api.kodus.io"));
  assert.equal(isHostAllowed("localhost", hosts), true);
  assert.equal(isHostAllowed("example.com", hosts), false);
}

process.env.API_DOCS_EXPORT_ALLOWLIST = "internal.example.com,127.0.0.1";

{
  const hosts = resolveAllowedHosts(getDocsEnv());
  assert.ok(hosts.has("internal.example.com"));
  assert.ok(hosts.has("127.0.0.1"));
  assert.equal(hosts.has("qa.api.kodus.io"), false);
}
