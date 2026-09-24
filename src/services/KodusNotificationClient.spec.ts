import axios from "axios";
import { createHmac } from "crypto";

import { KodusNotificationClient } from "./KodusNotificationClient";

jest.mock("axios");
jest.mock("../config/utils/urlBuilder", () => ({
  buildKodusApiUrl: (path: string) => `https://api.kodus.io${path}`,
}));

const post = axios.post as jest.Mock;
const SECRET = "test-secret";

const sent = () => {
  const [url, rawBody, config] = post.mock.calls[0];
  return { url: url as string, rawBody: rawBody as string, config };
};

describe("KodusNotificationClient", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ status: 200 });
    process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET = SECRET;
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

  it("signs the exact bytes it sends", async () => {
    await KodusNotificationClient.notifyPlanChanged({
      organizationId: "org-1",
      planType: "free",
    });

    const { rawBody, config } = sent();
    expect(config.headers["x-kodus-signature"]).toBe(
      createHmac("sha256", SECRET).update(rawBody).digest("hex"),
    );
  });

  it("never throws when kodus-ai is unreachable", async () => {
    post.mockRejectedValue(new Error("ECONNREFUSED"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      KodusNotificationClient.notifyPlanChanged({ organizationId: "org-1" }),
    ).resolves.toBeUndefined();
  });
});
