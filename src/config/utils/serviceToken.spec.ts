import {
  SERVICE_TOKEN_ENV,
  SIGNATURE_HEADER,
  SIGNATURE_MAX_SKEW_MS,
  TIMESTAMP_HEADER,
  WEBHOOK_SECRET_ENV,
  acceptedSecrets,
  canonicalQuery,
  requireServiceToken,
  signaturePayload,
  sign,
} from "./serviceToken";

/**
 * The credit routes carry money and take the organizationId from the request,
 * so this signature is what stands between them and anything that can reach
 * the service. It must fail CLOSED, must reuse the webhook secret both
 * deployments already share, and a signature must be usable for exactly one
 * request: one route, one org, one five-minute window.
 */
describe("requireServiceToken", () => {
  const SECRET = "shared-webhook-secret";

  const build = (
    over: {
      method?: string;
      url?: string;
      body?: unknown;
      /** `null` = send no header at all; a string = send that value. */
      signature?: string | null;
      /** `null` = send no timestamp; a number = send that one. */
      timestamp?: number | null;
      secret?: string;
    } = {},
  ) => {
    const method = over.method ?? "POST";
    const url = over.url ?? "/api/billing/credits/debit";
    const body = over.body ?? { organizationId: "org-1" };
    const [path, queryString = ""] = url.split("?");
    const rawBody =
      method === "GET" || method === "DELETE" ? "" : JSON.stringify(body);
    const timestamp =
      over.timestamp === null
        ? undefined
        : String(over.timestamp ?? Date.now());
    const res = {
      code: 0,
      body: undefined as unknown,
      status(c: number) {
        this.code = c;
        return this;
      },
      json(b: unknown) {
        this.body = b;
        return this;
      },
    };
    const signature =
      over.signature === null
        ? undefined
        : (over.signature ??
          sign(
            over.secret ?? SECRET,
            signaturePayload(
              method,
              path,
              queryString,
              timestamp ?? "",
              rawBody,
            ),
          ));
    const headers: Record<string, string | undefined> = {
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
    };
    const req = {
      method,
      url,
      originalUrl: url,
      path: path.replace("/api/billing", ""),
      body,
      rawBody,
      header: (name: string) => headers[name.toLowerCase()],
    };
    return { req, res, next: jest.fn(), signature, timestamp };
  };

  let savedDedicated: string | undefined;
  let savedWebhook: string | undefined;
  beforeEach(() => {
    savedDedicated = process.env[SERVICE_TOKEN_ENV];
    savedWebhook = process.env[WEBHOOK_SECRET_ENV];
    delete process.env[SERVICE_TOKEN_ENV];
    process.env[WEBHOOK_SECRET_ENV] = SECRET;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    for (const [k, v] of [
      [SERVICE_TOKEN_ENV, savedDedicated],
      [WEBHOOK_SECRET_ENV, savedWebhook],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    jest.restoreAllMocks();
  });

  it("accepts a request signed with the shared webhook secret (no new env needed)", () => {
    const { req, res, next } = build();
    requireServiceToken(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.code).toBe(0);
  });

  it("accepts EITHER secret, so a stale dedicated var cannot break callers", () => {
    process.env[SERVICE_TOKEN_ENV] = "dedicated";
    expect(acceptedSecrets()).toEqual(["dedicated", SECRET]);

    for (const secret of ["dedicated", SECRET]) {
      const { req, res, next } = build({ secret });
      requireServiceToken(req as never, res as never, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.code).toBe(0);
    }

    const other = build({ secret: "neither-of-them" });
    requireServiceToken(other.req as never, other.res as never, other.next);
    expect(other.next).not.toHaveBeenCalled();
    expect(other.res.code).toBe(401);
  });

  it("rejects a missing or wrong signature with 401", () => {
    for (const signature of [null, "", "deadbeef", sign("other", "x")]) {
      const { req, res, next } = build({ signature });
      requireServiceToken(req as never, res as never, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.code).toBe(401);
    }
  });

  it("does not let a signature for one route be replayed on another", () => {
    const read = build({
      method: "GET",
      url: "/api/billing/credits/balance?organizationId=org-1",
    });
    // The same signature (and timestamp), replayed against the debit route.
    const replay = build({
      method: "POST",
      url: "/api/billing/credits/debit",
      signature: read.signature,
      timestamp: Number(read.timestamp),
    });
    requireServiceToken(read.req as never, read.res as never, read.next);
    expect(read.next).toHaveBeenCalledTimes(1);
    requireServiceToken(replay.req as never, replay.res as never, replay.next);
    expect(replay.next).not.toHaveBeenCalled();
    expect(replay.res.code).toBe(401);
  });

  it("binds the signature to the ORG in the query (the GET routes read it there)", () => {
    const mine = build({
      method: "GET",
      url: "/api/billing/credits/balance?organizationId=org-1",
    });
    requireServiceToken(mine.req as never, mine.res as never, mine.next);
    expect(mine.next).toHaveBeenCalledTimes(1);

    // Same route, same timestamp, same signature — another org's id.
    for (const url of [
      "/api/billing/credits/balance?organizationId=victim",
      "/api/billing/credits/balance?organizationId=org-1&teamId=other-team",
      "/api/billing/credits/balance",
    ]) {
      const stolen = build({
        method: "GET",
        url,
        signature: mine.signature,
        timestamp: Number(mine.timestamp),
      });
      requireServiceToken(
        stolen.req as never,
        stolen.res as never,
        stolen.next,
      );
      expect(stolen.next).not.toHaveBeenCalled();
      expect(stolen.res.code).toBe(401);
    }
  });

  it("binds the signature to the BODY (a debit cannot be re-aimed)", () => {
    const signed = build({
      url: "/api/billing/credits/debit",
      body: { organizationId: "org-1", entries: [{ amountUsd: 1 }] },
    });
    const tampered = build({
      url: "/api/billing/credits/debit",
      body: { organizationId: "victim", entries: [{ amountUsd: 1 }] },
      signature: signed.signature,
      timestamp: Number(signed.timestamp),
    });
    requireServiceToken(
      tampered.req as never,
      tampered.res as never,
      tampered.next,
    );
    expect(tampered.next).not.toHaveBeenCalled();
    expect(tampered.res.code).toBe(401);
  });

  it("expires: a leaked signature stops working outside the skew window", () => {
    const fresh = build({ timestamp: Date.now() });
    requireServiceToken(fresh.req as never, fresh.res as never, fresh.next);
    expect(fresh.next).toHaveBeenCalledTimes(1);

    for (const offset of [
      -SIGNATURE_MAX_SKEW_MS - 1000,
      SIGNATURE_MAX_SKEW_MS + 1000,
    ]) {
      const stale = build({ timestamp: Date.now() + offset });
      requireServiceToken(stale.req as never, stale.res as never, stale.next);
      expect(stale.next).not.toHaveBeenCalled();
      expect(stale.res.code).toBe(401);
    }
  });

  it("requires a parsable timestamp header", () => {
    for (const timestamp of [null, NaN]) {
      const { req, res, next } = build({
        timestamp: timestamp as number | null,
      });
      requireServiceToken(req as never, res as never, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.code).toBe(401);
    }
  });

  it("verifies the RAW body bytes, not a re-serialization", () => {
    // Pretty-printed JSON: `JSON.stringify(req.body)` would produce different
    // bytes, so signing the raw payload is the only thing that can match.
    const pretty = JSON.stringify({ organizationId: "org-1" }, null, 2);
    const timestamp = String(Date.now());
    const signature = sign(
      SECRET,
      signaturePayload(
        "POST",
        "/api/billing/credits/debit",
        "",
        timestamp,
        pretty,
      ),
    );
    const headers: Record<string, string> = {
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
    };
    const res = {
      code: 0,
      status(c: number) {
        this.code = c;
        return this;
      },
      json() {
        return this;
      },
    };
    const next = jest.fn();
    requireServiceToken(
      {
        method: "POST",
        url: "/api/billing/credits/debit",
        originalUrl: "/api/billing/credits/debit",
        path: "/credits/debit",
        body: JSON.parse(pretty),
        rawBody: pretty,
        header: (name: string) => headers[name.toLowerCase()],
      } as never,
      res as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("ignores param ORDER, so a proxy reordering the query cannot 401", () => {
    expect(canonicalQuery("teamId=t&organizationId=o")).toBe(
      canonicalQuery("organizationId=o&teamId=t"),
    );
    const timestamp = String(Date.now());
    const signature = sign(
      SECRET,
      signaturePayload(
        "GET",
        "/api/billing/credits/balance",
        "organizationId=o&teamId=t",
        timestamp,
        "",
      ),
    );
    const { req, res, next } = build({
      method: "GET",
      url: "/api/billing/credits/balance?teamId=t&organizationId=o",
      signature,
      timestamp: Number(timestamp),
    });
    requireServiceToken(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("FAILS CLOSED when no secret is configured at all (500, never open)", () => {
    delete process.env[WEBHOOK_SECRET_ENV];
    const { req, res, next } = build();
    requireServiceToken(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: "Service secret not configured" });
  });
});

/**
 * GOLDEN VECTORS — byte-for-byte the same table as
 * `libs/common/utils/billing-signature.spec.ts` in kodus-ai (the API and the
 * web sign with that module). They are the only mechanical link between the
 * two repos: if either side changes what goes into the payload, one of the two
 * suites goes red instead of production answering 401 on every credit call.
 *
 * Do not "fix" a failure by updating the hex. Change both repos, or neither.
 */
describe("the signature contract with kodus-ai", () => {
  const GOLDEN_SECRET = "kodus-test-secret";
  const GOLDEN_VECTORS = [
    {
      name: "balance read (query signed, empty body)",
      method: "GET",
      path: "/api/billing/credits/balance",
      query: "organizationId=o&teamId=t",
      timestamp: "1789000000000",
      rawBody: "",
      signature:
        "263cfb56c87efae7f51f0d20fd2b9f2aab96d4de33ffd4e820eae3375fc68037",
    },
    {
      name: "debit (body signed, no query)",
      method: "POST",
      path: "/api/billing/credits/debit",
      query: "",
      timestamp: "1789000000000",
      rawBody: JSON.stringify({
        organizationId: "o",
        entries: [{ usageKey: "span:1", amountUsd: 0.5 }],
      }),
      signature:
        "03692a4564a44ae550d2ed76e831bf783961fe94be767f3059a1293ac30c84f6",
    },
  ];

  it.each(GOLDEN_VECTORS)("verifies what kodus-ai signs: $name", (vector) => {
    expect(
      sign(
        GOLDEN_SECRET,
        signaturePayload(
          vector.method,
          vector.path,
          vector.query,
          vector.timestamp,
          vector.rawBody,
        ),
      ),
    ).toBe(vector.signature);
  });

  it("accepts a golden-vector request end to end (inside the skew window)", () => {
    const vector = GOLDEN_VECTORS[0];
    const timestamp = String(Date.now());
    const signature = sign(
      GOLDEN_SECRET,
      signaturePayload(
        vector.method,
        vector.path,
        vector.query,
        timestamp,
        vector.rawBody,
      ),
    );
    const headers: Record<string, string> = {
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
    };
    const res = {
      code: 0,
      status(c: number) {
        this.code = c;
        return this;
      },
      json() {
        return this;
      },
    };
    const next = jest.fn();
    const saved = process.env[WEBHOOK_SECRET_ENV];
    process.env[WEBHOOK_SECRET_ENV] = GOLDEN_SECRET;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    requireServiceToken(
      {
        method: vector.method,
        url: `${vector.path}?${vector.query}`,
        originalUrl: `${vector.path}?${vector.query}`,
        path: "/credits/balance",
        header: (name: string) => headers[name.toLowerCase()],
      } as never,
      res as never,
      next,
    );
    if (saved === undefined) delete process.env[WEBHOOK_SECRET_ENV];
    else process.env[WEBHOOK_SECRET_ENV] = saved;
    jest.restoreAllMocks();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.code).toBe(0);
  });
});
