import {
  SERVICE_TOKEN_ENV,
  SIGNATURE_HEADER,
  WEBHOOK_SECRET_ENV,
  requireServiceToken,
  serviceSecret,
  sign,
  signaturePayload,
} from "./serviceToken";

/**
 * The credit routes carry money and take the organizationId from the request,
 * so this signature is what stands between them and anything that can reach
 * the service. It must fail CLOSED, must reuse the webhook secret both
 * deployments already share, and a signature must not be replayable across
 * routes.
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
    } = {},
  ) => {
    const method = over.method ?? "POST";
    const url = over.url ?? "/api/billing/credits/debit";
    const body = over.body ?? { organizationId: "org-1" };
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
        SECRET,
        signaturePayload(
          method,
          url.split("?")[0],
          method === "GET" || method === "DELETE" ? "" : JSON.stringify(body),
        ),
      ));
    const req = {
      method,
      url,
      originalUrl: url,
      path: url.replace("/api/billing", ""),
      body,
      header: (name: string) =>
        name.toLowerCase() === SIGNATURE_HEADER ? signature : undefined,
    };
    return { req, res, next: jest.fn() };
  };

  let savedDedicated: string | undefined;
  let savedWebhook: string | undefined;
  beforeEach(() => {
    savedDedicated = process.env[SERVICE_TOKEN_ENV];
    savedWebhook = process.env[WEBHOOK_SECRET_ENV];
    delete process.env[SERVICE_TOKEN_ENV];
    process.env[WEBHOOK_SECRET_ENV] = SECRET;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
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

  it("prefers the dedicated secret when set (key separation is optional)", () => {
    process.env[SERVICE_TOKEN_ENV] = "dedicated";
    expect(serviceSecret()).toBe("dedicated");
    const { req, res, next } = build(); // signed with the webhook secret
    requireServiceToken(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(401);
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
    // The same signature, replayed against the debit route.
    const replay = build({
      method: "POST",
      url: "/api/billing/credits/debit",
      signature: read.req.header(SIGNATURE_HEADER),
    });
    requireServiceToken(read.req as never, read.res as never, read.next);
    expect(read.next).toHaveBeenCalledTimes(1);
    requireServiceToken(replay.req as never, replay.res as never, replay.next);
    expect(replay.next).not.toHaveBeenCalled();
    expect(replay.res.code).toBe(401);
  });

  it("signs GET/DELETE over an empty body (no body is sent)", () => {
    for (const method of ["GET", "DELETE"]) {
      const { req, res, next } = build({
        method,
        url: "/api/billing/credits/payment-method?organizationId=org-1",
        body: {},
      });
      requireServiceToken(req as never, res as never, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.code).toBe(0);
    }
  });

  it("ignores the query string, so a proxy reordering params cannot 401", () => {
    const signed = sign(
      SECRET,
      signaturePayload("GET", "/api/billing/credits/balance", ""),
    );
    const { req, res, next } = build({
      method: "GET",
      url: "/api/billing/credits/balance?teamId=t&organizationId=o",
      signature: signed,
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
