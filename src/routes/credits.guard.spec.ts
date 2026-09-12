import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WEBHOOK_SECRET_ENV,
  captureRawBody,
  sign,
  signaturePayload,
} from "../config/utils/serviceToken";

/**
 * The `/credits/*` routes move money and take the organizationId from the
 * request, so the ONLY thing standing in front of them is one line in
 * subscription.routes.ts:
 *
 *     router.use("/credits", requireServiceToken);
 *
 * A unit test of the middleware cannot see that line. Delete it, or let a
 * route-grouping refactor register a credit route above it, and every unit
 * test still passes while the balance, the ledger and the debit endpoint are
 * open to anything that can reach the service.
 *
 * So this test speaks HTTP to the REAL router: it enumerates every registered
 * `/credits/*` route and asserts each one answers 401 unsigned and gets
 * through when signed. A new credit route added in the wrong place fails here.
 *
 * The controller is stubbed (it would need Postgres and Stripe); the router,
 * the guard and express's body parsing are the real thing.
 */
jest.mock("../controllers/SubscriptionController", () => ({
  SubscriptionController: new Proxy(
    {},
    {
      get:
        () =>
        async (_req: express.Request, res: express.Response): Promise<void> => {
          res.status(200).json({ stub: true });
        },
    },
  ),
}));

jest.mock("../middlewares/cacheMiddleware", () => ({
  cacheMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

const SECRET = "shared-webhook-secret";

type CreditRoute = { method: string; path: string };

/** Every `/credits/*` route the router actually registers. */
function creditRoutes(router: express.Router): CreditRoute[] {
  const out: CreditRoute[] = [];
  for (const layer of (router as unknown as { stack: any[] }).stack) {
    const route = layer?.route;
    if (!route?.path || !String(route.path).startsWith("/credits")) continue;
    const methods = route.methods ?? layer.route?.methods ?? {};
    for (const method of Object.keys(methods)) {
      if (methods[method])
        out.push({ method: method.toUpperCase(), path: route.path });
    }
  }
  return out;
}

describe("/credits/* is guarded at the router, not just in theory", () => {
  let server: Server;
  let base: string;
  let routes: CreditRoute[];
  let savedWebhook: string | undefined;

  beforeAll(async () => {
    savedWebhook = process.env[WEBHOOK_SECRET_ENV];
    process.env[WEBHOOK_SECRET_ENV] = SECRET;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const { default: router } = await import("./subscription.routes");
    routes = creditRoutes(router);

    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.use("/api/billing", router);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (savedWebhook === undefined) delete process.env[WEBHOOK_SECRET_ENV];
    else process.env[WEBHOOK_SECRET_ENV] = savedWebhook;
    jest.restoreAllMocks();
  });

  const call = async (
    route: CreditRoute,
    opts: { signed: boolean } = { signed: false },
  ) => {
    const query = "organizationId=org-1";
    const url = `/api/billing${route.path}?${query}`;
    const sendsBody = route.method !== "GET" && route.method !== "DELETE";
    const rawBody = sendsBody
      ? JSON.stringify({ organizationId: "org-1" })
      : "";
    const headers: Record<string, string> = sendsBody
      ? { "Content-Type": "application/json" }
      : {};
    if (opts.signed) {
      const timestamp = String(Date.now());
      headers[TIMESTAMP_HEADER] = timestamp;
      headers[SIGNATURE_HEADER] = sign(
        SECRET,
        signaturePayload(
          route.method,
          `/api/billing${route.path}`,
          query,
          timestamp,
          // GET/DELETE are signed over an empty body: none is sent.
          sendsBody ? rawBody : "",
        ),
      );
    }
    return fetch(`${base}${url}`, {
      method: route.method,
      headers,
      body: sendsBody ? rawBody : undefined,
    });
  };

  it("registers the credit routes it is supposed to", () => {
    // A sanity floor: if the enumeration ever returns nothing, the assertions
    // below would pass vacuously.
    expect(routes.length).toBeGreaterThanOrEqual(8);
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      expect.arrayContaining([
        "DELETE /credits/payment-method",
        "GET /credits/balance",
        "GET /credits/ledger",
        "POST /credits/adjust",
        "POST /credits/checkout",
        "POST /credits/debit",
      ]),
    );
  });

  it("answers 401 on every credit route when the request is not signed", async () => {
    for (const route of routes) {
      const res = await call(route);
      expect({
        route: `${route.method} ${route.path}`,
        status: res.status,
      }).toEqual({ route: `${route.method} ${route.path}`, status: 401 });
    }
  });

  it("lets a correctly signed request through on every credit route", async () => {
    for (const route of routes) {
      const res = await call(route, { signed: true });
      expect({
        route: `${route.method} ${route.path}`,
        status: res.status,
      }).toEqual({ route: `${route.method} ${route.path}`, status: 200 });
    }
  });

  it("does not guard the routes that were always public (no regression)", async () => {
    const res = await fetch(
      `${base}/api/billing/validate-license?organizationId=org-1`,
    );
    expect(res.status).not.toBe(401);
  });
});
