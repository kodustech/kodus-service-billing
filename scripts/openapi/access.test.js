require("ts-node/register/transpile-only");
const assert = require("assert");

const { parseBasicAuth } = require("../../src/config/docs/access");
const { buildDocsGuard } = require("../../src/middlewares/apiDocsGuard");

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
  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
}

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
  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
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
