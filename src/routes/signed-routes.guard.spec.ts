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
 * The `/credits/*` routes move money and the `/connections*` routes decide
 * which Git connection a subscription applies to; both take the tenant from
 * the request, so the ONLY thing standing in front of them is one line each
 * in subscription.routes.ts:
 *
 *     router.use("/credits", requireServiceToken);
 *     router.use("/connections", requireServiceToken);
 *
 * A unit test of the middleware cannot see those lines. Delete one, or let a
 * route-grouping refactor register a route above it, and every unit test
 * still passes while the routes behind it are open to anything that can
 * reach the service.
 *
 * So this test speaks HTTP to the REAL router: it enumerates every registered
 * route under each guarded prefix and asserts each one answers 401 unsigned
 * and gets through when signed. A new route added in the wrong place fails
 * here.
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

type GuardedRoute = { method: string; path: string };

/** Every route the router actually registers under `prefix`. */
function routesUnder(router: express.Router, prefix: string): GuardedRoute[] {
  const out: GuardedRoute[] = [];
  for (const layer of (router as unknown as { stack: any[] }).stack) {
    const route = layer?.route;
    const path = String(route?.path ?? "");
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    const methods = route.methods ?? layer.route?.methods ?? {};
    for (const method of Object.keys(methods)) {
      if (methods[method]) out.push({ method: method.toUpperCase(), path });
    }
  }
  return out;
}

const GUARDED: Array<{ prefix: string; floor: number; expected: string[] }> = [
  {
    prefix: "/credits",
    floor: 8,
    expected: [
      "DELETE /credits/payment-method",
      "GET /credits/balance",
      "GET /credits/ledger",
      "POST /credits/adjust",
      "POST /credits/checkout",
      "POST /credits/debit",
    ],
  },
  {
    prefix: "/connections",
    floor: 3,
    expected: [
      "GET /connections",
      "POST /connections/primary",
      "POST /connections/release",
    ],
  },
];

describe("service-to-service routes are guarded at the router, not just in theory", () => {
  let server: Server;
  let base: string;
  let router: express.Router;
  let savedWebhook: string | undefined;

  beforeAll(async () => {
    savedWebhook = process.env[WEBHOOK_SECRET_ENV];
    process.env[WEBHOOK_SECRET_ENV] = SECRET;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    router = (await import("./subscription.routes")).default;

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
    route: GuardedRoute,
    opts: { signed: boolean } = { signed: false },
  ) => {
    const query = "organizationId=org-1&teamId=team-1";
    const url = `/api/billing${route.path}?${query}`;
    const sendsBody = route.method !== "GET" && route.method !== "DELETE";
    const rawBody = sendsBody
      ? JSON.stringify({ organizationId: "org-1", teamId: "team-1" })
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

  describe.each(GUARDED)("$prefix", ({ prefix, floor, expected }) => {
    it("registers the routes it is supposed to", () => {
      const routes = routesUnder(router, prefix);
      // A sanity floor: if the enumeration ever returns nothing, the
      // assertions below would pass vacuously.
      expect(routes.length).toBeGreaterThanOrEqual(floor);
      expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
        expect.arrayContaining(expected),
      );
    });

    it("answers 401 on every route when the request is not signed", async () => {
      for (const route of routesUnder(router, prefix)) {
        const res = await call(route);
        expect({
          route: `${route.method} ${route.path}`,
          status: res.status,
        }).toEqual({ route: `${route.method} ${route.path}`, status: 401 });
      }
    });

    it("lets a correctly signed request through on every route", async () => {
      for (const route of routesUnder(router, prefix)) {
        const res = await call(route, { signed: true });
        expect({
          route: `${route.method} ${route.path}`,
          status: res.status,
        }).toEqual({ route: `${route.method} ${route.path}`, status: 200 });
      }
    });
  });

  it("does not guard the routes that were always public (no regression)", async () => {
    const res = await fetch(
      `${base}/api/billing/validate-license?organizationId=org-1`,
    );
    expect(res.status).not.toBe(401);
  });
});
