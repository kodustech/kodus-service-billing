require("ts-node/register/transpile-only");
const assert = require("assert");

const {
  parseAllowlist,
  isIpAllowed,
  parseBasicAuth,
} = require("../../src/config/docs/access");
const { buildDocsGuard } = require("../../src/middlewares/apiDocsGuard");

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

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const encodedAuth = Buffer.from("dev:devpass").toString("base64");

process.env.API_DOCS_IP_ALLOWLIST = "";
process.env.API_DOCS_BASIC_USER = "dev";
process.env.API_DOCS_BASIC_PASS = "devpass";

{
  const guard = buildDocsGuard();
  const req = { ip: "10.0.0.1", headers: { authorization: `Basic ${encodedAuth}` } };
  const res = makeRes();
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
}

process.env.API_DOCS_IP_ALLOWLIST = "10.0.0.0/8";
process.env.API_DOCS_BASIC_USER = "dev";
process.env.API_DOCS_BASIC_PASS = "devpass";

{
  const guard = buildDocsGuard();
  const req = { ip: "192.168.0.1", headers: { authorization: `Basic ${encodedAuth}` } };
  const res = makeRes();
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
}

{
  const guard = buildDocsGuard();
  const req = { ip: "10.1.1.1", headers: {} };
  const res = makeRes();
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["WWW-Authenticate"], "Basic");
  assert.equal(nextCalled, false);
}

{
  const guard = buildDocsGuard();
  const req = { ip: "10.1.1.1", headers: { authorization: `Basic ${encodedAuth}` } };
  const res = makeRes();
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
}
