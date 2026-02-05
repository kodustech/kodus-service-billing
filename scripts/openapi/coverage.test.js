require("ts-node/register/transpile-only");
const assert = require("assert");

const { buildOpenApiSpec } = require("../../src/config/docs/openapi");

const spec = buildOpenApiSpec();

const expected = [
  ["get", "/health"],
  ["get", "/health/ready"],
  ["post", "/api/billing/trial"],
  ["post", "/api/billing/create-checkout-session"],
  ["post", "/api/billing/webhook"],
  ["get", "/api/billing/plans"],
  ["get", "/api/billing/validate-org-license"],
  ["post", "/api/billing/assign-license"],
  ["get", "/api/billing/check-user-license"],
  ["get", "/api/billing/users-with-license"],
  ["get", "/api/billing/portal/{organizationId}/{teamId}"],
  ["post", "/api/billing/update-trial"],
  ["post", "/api/billing/migrate-to-free"],
];

for (const [method, path] of expected) {
  assert.ok(spec.paths[path], `Missing path: ${path}`);
  assert.ok(
    spec.paths[path][method],
    `Missing method ${method.toUpperCase()} for ${path}`
  );
}
