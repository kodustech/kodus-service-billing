import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

/**
 * GET /trial-terms is read by the web app's onboarding screens before any
 * trial exists, through the browser-facing billing proxy. The router, the
 * controller and the service are the real thing; only the cache middleware is
 * stubbed, and Stripe gets a placeholder key (its client is built on import and
 * never called here).
 */
jest.mock("../middlewares/cacheMiddleware", () => ({
  cacheMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

describe("GET /api/billing/trial-terms", () => {
  let server: Server;
  let base: string;
  const original = process.env.TRIAL_DURATION;
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;
  const originalCredits = process.env.TRIAL_REVIEW_CREDITS_INCLUDED;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder";
    const { default: router } = await import("./subscription.routes");
    const app = express();
    app.use("/api/billing", router);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (original === undefined) delete process.env.TRIAL_DURATION;
    else process.env.TRIAL_DURATION = original;
    if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalStripeKey;
    if (originalCredits === undefined)
      delete process.env.TRIAL_REVIEW_CREDITS_INCLUDED;
    else process.env.TRIAL_REVIEW_CREDITS_INCLUDED = originalCredits;
  });

  it("answers without a service token, with the trial terms configured right now", async () => {
    process.env.TRIAL_DURATION = "7";
    process.env.TRIAL_REVIEW_CREDITS_INCLUDED = "3";

    const res = await fetch(`${base}/api/billing/trial-terms`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      trialDays: 7,
      trialReviewCreditsIncluded: 3,
    });
  });
});
