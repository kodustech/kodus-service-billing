import axios from "axios";

import { KodusNotificationClient } from "./KodusNotificationClient";

jest.mock("axios", () => {
  const mock = {
    post: jest.fn(),
    isAxiosError: (e: any) => e?.isAxiosError === true,
  };
  return { __esModule: true, default: mock, ...mock };
});
jest.mock("../config/utils/urlBuilder", () => ({
  buildKodusApiUrl: (path: string) => `https://api.kodus.io${path}`,
}));

const post = axios.post as jest.Mock;
const SECRET = "test-secret";

const sent = (n = 0) => {
  const [url, rawBody, config] = post.mock.calls[n];
  return { url: url as string, rawBody: rawBody as string, config };
};

const httpError = (status?: number) =>
  Object.assign(new Error(`HTTP ${status ?? "network"}`), {
    isAxiosError: true,
    response: status ? { status } : undefined,
  });

describe("KodusNotificationClient", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ status: 200 });
    process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    delete process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET;
  });

  const calls: Array<[string, () => Promise<void>]> = [
    [
      "payment-failed",
      () =>
        KodusNotificationClient.notifyPaymentFailed({
          organizationId: "org-1",
          amount: 2400,
          currency: "usd",
          failureReason: "declined",
        }),
    ],
    [
      "trial-expiring",
      () =>
        KodusNotificationClient.notifyTrialExpiring({
          organizationId: "org-1",
          trialEndsAt: "2026-10-01",
          daysRemaining: 3,
        }),
    ],
    [
      "plan-changed",
      () =>
        KodusNotificationClient.notifyPlanChanged({
          organizationId: "org-1",
          planType: "teams_byok",
        }),
    ],
    [
      "credits-purchased",
      () =>
        KodusNotificationClient.notifyCreditsPurchased({
          organizationId: "org-1",
          creditUsd: 100,
          balanceUsd: 142.5,
        }),
    ],
    [
      "credits-low",
      () =>
        KodusNotificationClient.notifyCreditsLow({
          organizationId: "org-1",
          balanceUsd: 1,
          thresholdUsd: 5,
          exhausted: false,
        }),
    ],
  ];

  // The kodus-ai ALB sends every `*/webhook*` path to its webhooks
  // ingestion service; these callbacks are served by the API (kodus-ai#2007).
  it.each(calls)(
    "%s goes to /billing/events on the API, never a */webhook* path",
    async (event, call) => {
      await call();

      const { url } = sent();
      expect(url).toBe(`https://api.kodus.io/billing/events/${event}`);
      expect(url).not.toMatch(/webhook/i);
    },
  );

  // Cross-service contract: kodus-ai verifies these exact bytes on
  // /billing/events/<event>. The same literal vector is pinned in kodus-ai's
  // apps/api/src/controllers/billingEvents.controller.spec.ts, on branch
  // fix/2007-webhooks-boot-memory (kodustech/kodus-ai#2008) until it merges.
  // Change both together.
  it("matches the golden vector kodus-ai verifies", async () => {
    process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET = "golden-vector-secret";
    jest.spyOn(Date, "now").mockReturnValue(1790000000000);

    await KodusNotificationClient.notifyPlanChanged({
      organizationId: "org-1",
      teamId: "team-1",
      planType: "teams_byok",
      subscriptionStatus: "active",
    });

    const { rawBody, config } = sent();
    expect(rawBody).toBe(
      '{"organizationId":"org-1","teamId":"team-1","planType":"teams_byok","subscriptionStatus":"active"}',
    );
    expect(config.headers["x-kodus-timestamp"]).toBe("1790000000000");
    expect(config.headers["x-kodus-signature"]).toBe(
      "a1e66b1c95da6a84331fc3813b4d5c0853d3c0a674080aa3ac4833bfa0fb5297",
    );
  });

  describe("legacy receiver fallback (deploy order / rollback skew)", () => {
    it.each([404, 401, 500, 502, 503])(
      "retries once on the legacy receiver when the API answers %i before its handler",
      async (status) => {
        post.mockRejectedValueOnce(httpError(status));
        const warn = jest
          .spyOn(console, "warn")
          .mockImplementation(() => undefined);

        await KodusNotificationClient.notifyPlanChanged({
          organizationId: "org-1",
        });

        expect(post).toHaveBeenCalledTimes(2);
        expect(sent(1).url).toBe(
          "https://api.kodus.io/billing/webhook/plan-changed",
        );
        // The primary rejection stays visible even though delivery landed.
        expect(warn.mock.calls[0][0]).toBe(
          `KodusNotificationClient: plan-changed rejected by /billing/events/plan-changed (${status}), retrying /billing/webhook/plan-changed`,
        );
      },
    );

    it("sends the legacy receiver the same bytes, signed over the body alone", async () => {
      post.mockRejectedValueOnce(httpError(404));
      jest.spyOn(console, "warn").mockImplementation(() => undefined);

      await KodusNotificationClient.notifyPlanChanged({
        organizationId: "org-1",
      });

      expect(post).toHaveBeenCalledTimes(2);
      expect(sent(1).url).toBe(
        "https://api.kodus.io/billing/webhook/plan-changed",
      );
      // Same bytes; the legacy receiver verifies an HMAC over the body alone
      // (literal vector for "test-secret" + these bytes).
      expect(sent(1).rawBody).toBe('{"organizationId":"org-1"}');
      expect(sent(1).rawBody).toBe(sent(0).rawBody);
      expect(sent(1).config.headers["x-kodus-signature"]).toBe(
        "46fe404f3230ff3c22cff1bc7cee871f70ea51ec09559d60a7585845dc9478a2",
      );
      expect(sent(1).config.headers["x-kodus-timestamp"]).toBeUndefined();
    });

    it.each([
      ["400", httpError(400)],
      ["504 (the handler may have run)", httpError(504)],
      ["a timeout", httpError()],
    ])("does not fall back on %s", async (_label, error) => {
      post.mockRejectedValueOnce(error);
      jest.spyOn(console, "error").mockImplementation(() => undefined);

      await KodusNotificationClient.notifyPlanChanged({
        organizationId: "org-1",
      });

      expect(post).toHaveBeenCalledTimes(1);
    });

    it("logs the path and status when a callback is dropped, never the host", async () => {
      post.mockRejectedValueOnce(httpError(504));
      const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

      await KodusNotificationClient.notifyPlanChanged({
        organizationId: "org-1",
      });

      expect(log.mock.calls[0][0]).toBe(
        "KodusNotificationClient: failed to deliver plan-changed to /billing/events/plan-changed (504)",
      );
      expect(log.mock.calls[0][0]).not.toContain("api.kodus.io");
    });

    it("logs the legacy path when the fallback fails too", async () => {
      post
        .mockRejectedValueOnce(httpError(404))
        .mockRejectedValueOnce(httpError(500));
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

      await KodusNotificationClient.notifyPlanChanged({
        organizationId: "org-1",
      });

      expect(log.mock.calls[0][0]).toBe(
        "KodusNotificationClient: failed to deliver plan-changed to /billing/webhook/plan-changed (500)",
      );
    });

    it("sends once when the API accepts it", async () => {
      await KodusNotificationClient.notifyPlanChanged({
        organizationId: "org-1",
      });

      expect(post).toHaveBeenCalledTimes(1);
    });
  });

  it("never throws when kodus-ai is unreachable", async () => {
    post.mockRejectedValue(new Error("ECONNREFUSED"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      KodusNotificationClient.notifyPlanChanged({ organizationId: "org-1" }),
    ).resolves.toBeUndefined();
  });
});
