require("ts-node/register/transpile-only");
const assert = require("assert");

const { buildOpenApiSpec } = require("../../src/config/docs/openapi");

const spec = buildOpenApiSpec();

assert.ok(spec);
assert.equal(spec.openapi, "3.0.3");
assert.ok(spec.info);
assert.ok(spec.paths);
assert.ok(!spec.security || spec.security.length === 0);
if (spec.components && spec.components.securitySchemes) {
  assert.fail("Unexpected securitySchemes defined in spec");
}
