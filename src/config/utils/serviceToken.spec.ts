import {
  SERVICE_TOKEN_ENV,
  SERVICE_TOKEN_HEADER,
  requireServiceToken,
} from "./serviceToken";

/**
 * The credit routes carry money and take the organizationId from the request,
 * so the shared service token is what stands between them and any caller that
 * can reach the service. It must fail CLOSED (unset secret ⇒ nothing answers)
 * and never leak timing on a wrong token.
 */
describe("requireServiceToken", () => {
  const build = (header?: string) => {
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
    const req = {
      method: "POST",
      path: "/credits/debit",
      header: (name: string) =>
        name.toLowerCase() === SERVICE_TOKEN_HEADER ? header : undefined,
    };
    const next = jest.fn();
    return { req, res, next };
  };

  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[SERVICE_TOKEN_ENV];
    process.env[SERVICE_TOKEN_ENV] = "s3cret-token";
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[SERVICE_TOKEN_ENV];
    else process.env[SERVICE_TOKEN_ENV] = saved;
    jest.restoreAllMocks();
  });

  it("passes a request carrying the configured token", () => {
    const { req, res, next } = build("s3cret-token");
    requireServiceToken(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.code).toBe(0);
  });

  it("rejects a missing token with 401", () => {
    const { req, res, next } = build(undefined);
    requireServiceToken(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(401);
  });

  it("rejects a wrong token with 401, of any length", () => {
    for (const wrong of ["nope", "s3cret-toke", "s3cret-token-plus", ""]) {
      const { req, res, next } = build(wrong);
      requireServiceToken(req as never, res as never, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.code).toBe(401);
    }
  });

  it("FAILS CLOSED when the secret is not configured (500, never open)", () => {
    delete process.env[SERVICE_TOKEN_ENV];
    const { req, res, next } = build("anything");
    requireServiceToken(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(500);
    expect(res.body).toEqual({
      error: "CREDITS_SERVICE_TOKEN not configured",
    });
  });

  it("treats a blank secret as unconfigured", () => {
    process.env[SERVICE_TOKEN_ENV] = "   ";
    const { req, res, next } = build("   ");
    requireServiceToken(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(500);
  });
});
