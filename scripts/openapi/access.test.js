require("ts-node/register/transpile-only");
const assert = require("assert");

const {
  parseAllowlist,
  isIpAllowed,
  parseBasicAuth,
} = require("../../src/config/docs/access");

assert.deepStrictEqual(parseAllowlist(""), []);
assert.deepStrictEqual(parseAllowlist("  "), []);
assert.deepStrictEqual(parseAllowlist("10.0.0.0/8, 192.168.0.0/16"), [
  "10.0.0.0/8",
  "192.168.0.0/16",
]);

assert.equal(isIpAllowed("1.1.1.1", []), false);
assert.equal(isIpAllowed("10.10.10.10", ["10.0.0.0/8"]), true);
assert.equal(isIpAllowed("192.168.1.10", ["10.0.0.0/8"]), false);

assert.deepStrictEqual(parseBasicAuth(undefined), null);
assert.deepStrictEqual(parseBasicAuth("Bearer abc"), null);
assert.deepStrictEqual(parseBasicAuth("Basic ZGV2OmRldnBhc3M="), {
  user: "dev",
  pass: "devpass",
});
