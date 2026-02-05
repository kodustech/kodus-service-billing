require("ts-node/register/transpile-only");
const assert = require("assert");

const { registerApiDocs } = require("../../src/config/docs/registerDocs");

function makeApp() {
  return {
    useCalls: [],
    getCalls: [],
    use(...args) {
      this.useCalls.push(args);
    },
    get(...args) {
      this.getCalls.push(args);
    },
  };
}

process.env.API_DOCS_ENABLED = "false";
{
  const app = makeApp();
  const registered = registerApiDocs(app);
  assert.equal(registered, false);
  assert.equal(app.useCalls.length, 0);
  assert.equal(app.getCalls.length, 0);
}

process.env.API_DOCS_ENABLED = "true";
process.env.API_DOCS_PATH = "/docs";
process.env.API_DOCS_SPEC_PATH = "/openapi.json";
process.env.API_DOCS_BASIC_USER = "dev";
process.env.API_DOCS_BASIC_PASS = "devpass";
process.env.API_DOCS_IP_ALLOWLIST = "127.0.0.1/32";

{
  const app = makeApp();
  const registered = registerApiDocs(app);
  assert.equal(registered, true);
  const usePaths = app.useCalls.map((call) => call[0]);
  const getPaths = app.getCalls.map((call) => call[0]);
  assert.ok(usePaths.includes("/docs"));
  assert.ok(getPaths.includes("/openapi.json"));
  assert.ok(getPaths.includes("/docs-json"));
}
