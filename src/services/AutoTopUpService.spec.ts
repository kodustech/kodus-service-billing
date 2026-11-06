import "reflect-metadata";

const licenseRepo = {
  findOne: jest.fn(),
  save: jest.fn(async (x: unknown) => x),
};
const licenseUpdate = jest.fn(async () => undefined);

jest.mock("../config/database", () => ({
  AppDataSource: {
    getRepository: () => ({ update: licenseUpdate }),
    transaction: jest.fn(),
  },
}));
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: licenseRepo,
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
jest.mock("./KodusNotificationClient", () => ({
  KodusNotificationClient: {
    notifyCreditsPurchased: jest.fn(async () => undefined),
    notifyCreditsLow: jest.fn(async () => undefined),
  },
}));
/** What `StripeService.autoTopUpRequest` returns, minus the Stripe calls. */
const fakeRequest = (i: { creditUsd: number; chargeUsd: number }) => ({
  amount: Math.round(i.chargeUsd * 100),
  currency: "usd",
  customer: "cus_1",
  payment_method: "pm_123",
  off_session: true,
  confirm: true,
  metadata: {
    kind: "credit_auto_topup",
    creditUsd: String(i.creditUsd),
    chargeUsd: String(i.chargeUsd),
    priceId: "price_credits",
  },
});

jest.mock("./StripeService", () => ({
  StripeService: {
    autoTopUpRequest: jest.fn(),
    legacyAutoTopUpRequest: jest.fn(),
    createAutoTopUpIntent: jest.fn(),
    detachPaymentMethod: jest.fn(async () => undefined),
  },
}));
jest.mock("./CreditService", () => ({
  CreditService: {
    applyPurchase: jest.fn(),
    // Mirrors the real rule: whole dollars, a pack or 15..5000.
    validatePurchaseAmount: (n: unknown) => {
      const v = Number(n);
      if (!Number.isInteger(v)) return null;
      if ([20, 50, 100, 500].includes(v)) return v;
      return v >= 15 && v <= 5000 ? v : null;
    },
  },
}));

import {
  AUTO_TOP_UP_PARKED_MESSAGE,
  AUTO_TOP_UP_RETRY_MS,
  AutoTopUpService,
  autoTopUpAttemptKey,
  decideAutoTopUp,
  isPreStoredRequestKey,
} from "./AutoTopUpService";
import { CreditService } from "./CreditService";
import { KodusNotificationClient } from "./KodusNotificationClient";
import { StripeService } from "./StripeService";

const NOW = new Date("2026-09-09T12:00:00Z");

const license = (over: Record<string, unknown> = {}) => ({
  id: "lic-1",
  organizationId: "org-1",
  teamId: "team-1",
  creditBalanceUsd: 3,
  creditAutoTopUpEnabled: true,
  creditAutoTopUpThresholdUsd: 5,
  creditAutoTopUpAmountUsd: 50,
  creditPaymentMethodId: "pm_123",
  creditPaymentMethodLabel: "Visa •••• 4242",
  creditAutoTopUpLastAt: null,
  creditAutoTopUpLastError: null,
  // A charge only ever runs after a debit claimed the attempt and minted
  // this key under the row lock.
  creditAutoTopUpAttemptKey: "auto-topup:v2:lic-1:1789000000000",
  ...over,
});

beforeEach(() => {
  licenseRepo.findOne.mockReset();
  licenseRepo.save.mockClear();
  licenseUpdate.mockClear();
  (StripeService.createAutoTopUpIntent as jest.Mock).mockReset();
  (StripeService.autoTopUpRequest as jest.Mock)
    .mockReset()
    .mockImplementation(async (i) => fakeRequest(i));
  (StripeService.legacyAutoTopUpRequest as jest.Mock)
    .mockReset()
    .mockImplementation(async (i) => {
      const { priceId: _, ...metadata } = fakeRequest(i).metadata;
      return { ...fakeRequest(i), metadata };
    });
  (StripeService.detachPaymentMethod as jest.Mock).mockClear();
  (CreditService.applyPurchase as jest.Mock).mockReset();
  (KodusNotificationClient.notifyCreditsLow as jest.Mock).mockClear();
});

describe("decideAutoTopUp — the trigger rule", () => {
  it("fires when enabled, a card is saved, and the balance is at or below the threshold", () => {
    expect(decideAutoTopUp(license() as any, 5, NOW)).toBe(true);
    expect(decideAutoTopUp(license() as any, 0, NOW)).toBe(true);
    expect(decideAutoTopUp(license() as any, -2, NOW)).toBe(true);
  });

  it("stays quiet above the threshold, when disabled, or without a card / amount", () => {
    expect(decideAutoTopUp(license() as any, 5.01, NOW)).toBe(false);
    expect(
      decideAutoTopUp(
        license({ creditAutoTopUpEnabled: false }) as any,
        0,
        NOW,
      ),
    ).toBe(false);
    expect(
      decideAutoTopUp(license({ creditPaymentMethodId: null }) as any, 0, NOW),
    ).toBe(false);
    expect(
      decideAutoTopUp(
        license({ creditAutoTopUpAmountUsd: null }) as any,
        0,
        NOW,
      ),
    ).toBe(false);
    expect(
      decideAutoTopUp(
        license({ creditAutoTopUpThresholdUsd: null }) as any,
        0,
        NOW,
      ),
    ).toBe(false);
  });

  it("retries at most once per window (a declined card is not hammered every sweep)", () => {
    const recent = new Date(NOW.getTime() - AUTO_TOP_UP_RETRY_MS + 1000);
    const old = new Date(NOW.getTime() - AUTO_TOP_UP_RETRY_MS - 1000);
    expect(
      decideAutoTopUp(
        license({ creditAutoTopUpLastAt: recent }) as any,
        0,
        NOW,
      ),
    ).toBe(false);
    expect(
      decideAutoTopUp(license({ creditAutoTopUpLastAt: old }) as any, 0, NOW),
    ).toBe(true);
  });
});

describe("updateSettings", () => {
  it("refuses to enable without a saved card (the UI sends the user to save one)", async () => {
    licenseRepo.findOne.mockResolvedValue(
      license({ creditPaymentMethodId: null }),
    );
    const r = await AutoTopUpService.updateSettings("org-1", "team-1", {
      enabled: true,
      amountUsd: 50,
    });
    expect(r).toEqual({ ok: false, code: "NO_PAYMENT_METHOD" });
    expect(licenseRepo.save).not.toHaveBeenCalled();
  });

  it("validates the amount as a purchase and the threshold against it", async () => {
    licenseRepo.findOne.mockResolvedValue(license());
    expect(
      await AutoTopUpService.updateSettings("org-1", "team-1", {
        enabled: true,
        amountUsd: 3,
      }),
    ).toEqual({ ok: false, code: "INVALID_AMOUNT" });
    expect(
      await AutoTopUpService.updateSettings("org-1", "team-1", {
        enabled: true,
        amountUsd: 20,
        thresholdUsd: 25,
      }),
    ).toEqual({ ok: false, code: "INVALID_THRESHOLD" });
  });

  it("enabling re-arms the attempt window and returns the UI state without Stripe ids", async () => {
    const lic = license({
      creditAutoTopUpEnabled: false,
      creditAutoTopUpLastAt: NOW,
      creditAutoTopUpLastError: "card_declined",
    });
    licenseRepo.findOne.mockResolvedValue(lic);
    const r = await AutoTopUpService.updateSettings("org-1", "team-1", {
      enabled: true,
      amountUsd: 100,
      thresholdUsd: 10,
    });
    expect(r.ok).toBe(true);
    expect(lic.creditAutoTopUpEnabled).toBe(true);
    expect(lic.creditAutoTopUpLastAt).toBeNull();
    expect(lic.creditAutoTopUpLastError).toBeNull();
    expect((r as any).state).toEqual({
      enabled: true,
      thresholdUsd: 10,
      amountUsd: 100,
      paymentMethod: "Visa •••• 4242",
      lastAt: null,
      lastError: null,
    });
    expect(JSON.stringify((r as any).state)).not.toContain("pm_123");
  });

  it("disabling keeps the card and any amounts for a later re-enable", async () => {
    const lic = license();
    licenseRepo.findOne.mockResolvedValue(lic);
    const r = await AutoTopUpService.updateSettings("org-1", "team-1", {
      enabled: false,
    });
    expect(r.ok).toBe(true);
    expect(lic.creditAutoTopUpEnabled).toBe(false);
    expect(lic.creditPaymentMethodId).toBe("pm_123");
    expect(lic.creditAutoTopUpAmountUsd).toBe(50);
  });
});

describe("charge — the off-session purchase", () => {
  it("charges credit + markup, credits the ledger idempotently on the PaymentIntent, clears the error", async () => {
    licenseRepo.findOne.mockResolvedValue(
      license({ creditAutoTopUpLastError: "old" }),
    );
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
      id: "pi_1",
      status: "succeeded",
      amount: 5350,
      currency: "usd",
    });
    (CreditService.applyPurchase as jest.Mock).mockResolvedValue({
      applied: true,
      balanceUsd: 53,
    });

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({ charged: true, creditUsd: 50, balanceUsd: 53 });
    expect(StripeService.autoTopUpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethodId: "pm_123",
        creditUsd: 50,
        chargeUsd: 53.5, // 7% markup
      }),
    );
    expect(StripeService.createAutoTopUpIntent).toHaveBeenCalledWith(
      fakeRequest({ creditUsd: 50, chargeUsd: 53.5 }),
      "auto-topup:v2:lic-1:1789000000000",
    );
    expect(CreditService.applyPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        creditUsd: 50,
        usageKey: "stripe:pi:pi_1",
        metadata: expect.objectContaining({
          auto: true,
          chargeUsd: 53.5,
          // What was actually charged, in the customer's currency.
          amountMinor: 5350,
          currency: "usd",
        }),
      }),
    );
    // A charge that went through is definitive: release the key so the
    // NEXT dip mints a fresh one.
    expect(licenseUpdate).toHaveBeenCalledWith(
      { id: "lic-1" },
      {
        creditAutoTopUpLastError: null,
        creditAutoTopUpAttemptKey: null,
        creditAutoTopUpAttemptRequest: null,
      },
    );
  });

  it("records a declined card on the license and tells the org, without crediting anything", async () => {
    licenseRepo.findOne.mockResolvedValue(license({ creditBalanceUsd: 0 }));
    // What Stripe actually throws for a decline: a typed error with a code,
    // not a bare Error carrying prose.
    (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Your card was declined."), {
        type: "StripeCardError",
        code: "card_declined",
      }),
    );

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({ charged: false, reason: "Your card was declined." });
    expect(CreditService.applyPurchase).not.toHaveBeenCalled();
    // "declined" is an ANSWER: the money did not move and never will for
    // this attempt, so the key is released.
    expect(licenseUpdate).toHaveBeenCalledWith(
      { id: "lic-1" },
      {
        creditAutoTopUpLastError: "Your card was declined.",
        creditAutoTopUpAttemptKey: null,
        creditAutoTopUpAttemptRequest: null,
      },
    );
    expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        exhausted: true,
        autoTopUpError: "Your card was declined.",
      }),
    );
  });

  it("treats a non-succeeded intent (needs authentication) as a failure", async () => {
    licenseRepo.findOne.mockResolvedValue(license());
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
      id: "pi_2",
      status: "requires_action",
    });
    const r = await AutoTopUpService.charge("lic-1");
    expect(r.charged).toBe(false);
    expect(CreditService.applyPurchase).not.toHaveBeenCalled();
  });

  it("records the presentment currency of a BRL charge on the ledger entry", async () => {
    licenseRepo.findOne.mockResolvedValue(license());
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
      id: "pi_brl",
      status: "succeeded",
      amount: 29100, // 50 × R$5.82
      currency: "brl",
    });
    (CreditService.applyPurchase as jest.Mock).mockResolvedValue({
      applied: true,
      balanceUsd: 53,
    });

    const r = await AutoTopUpService.charge("lic-1");

    // The ledger is still credited in USD, whatever was charged.
    expect(r).toEqual({ charged: true, creditUsd: 50, balanceUsd: 53 });
    expect(CreditService.applyPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        creditUsd: 50,
        metadata: expect.objectContaining({
          amountMinor: 29100,
          currency: "brl",
        }),
      }),
    );
  });

  /** What an attempt that never reached Stripe writes when only the
   *  customer can fix it: off, key released, reason shown once. */
  const stoppedWith = (shown: string) => ({
    creditAutoTopUpEnabled: false,
    creditAutoTopUpLastError: shown,
    creditAutoTopUpAttemptKey: null,
    creditAutoTopUpAttemptRequest: null,
  });

  it("turns auto top-up off for a saved amount below the new US$15 minimum, instead of charging more than agreed", async () => {
    // A config saved when the minimum was US$10. Bumping it to 15 would be
    // an off-session charge the customer never agreed to. Leaving it on
    // re-claimed the attempt and re-notified the customer every hour.
    licenseRepo.findOne.mockResolvedValue(
      license({ creditAutoTopUpAmountUsd: 10, creditBalanceUsd: 1 }),
    );

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({ charged: false, reason: "INVALID_AMOUNT" });
    expect(StripeService.createAutoTopUpIntent).not.toHaveBeenCalled();
    expect(CreditService.applyPurchase).not.toHaveBeenCalled();
    // Literal on purpose: this copy is stored on the license and shown by
    // the web app and the notification, so a change must break a test here.
    const shown =
      "Auto top-up was turned off: $10 is no longer a valid amount (whole " +
      "dollars, minimum $15). Choose a new amount to turn it back on.";
    // The key is released: no request was stored under it, so nothing was
    // ever sent with it.
    expect(licenseUpdate).toHaveBeenCalledWith(
      { id: "lic-1" },
      stoppedWith(shown),
    );
    expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledTimes(1);
    expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        autoTopUpError: shown,
      }),
    );
  });

  it("turns auto top-up off for a fractional saved amount (credits are whole dollars)", async () => {
    licenseRepo.findOne.mockResolvedValue(
      license({ creditAutoTopUpAmountUsd: 37.5 }),
    );
    const r = await AutoTopUpService.charge("lic-1");
    expect(r).toEqual({ charged: false, reason: "INVALID_AMOUNT" });
    expect(StripeService.createAutoTopUpIntent).not.toHaveBeenCalled();
    expect(licenseUpdate).toHaveBeenCalledWith(
      { id: "lic-1" },
      expect.objectContaining({ creditAutoTopUpEnabled: false }),
    );
  });

  it("turns auto top-up off for a currency the credit price is not sold in, with no internal id in the copy", async () => {
    licenseRepo.findOne.mockResolvedValue(license());
    (StripeService.autoTopUpRequest as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Credits can't be charged in EUR yet."), {
        code: "CREDIT_CURRENCY_NOT_SUPPORTED",
        currency: "eur",
        priceId: "price_x",
      }),
    );

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({
      charged: false,
      reason: "CREDIT_CURRENCY_NOT_SUPPORTED",
    });
    expect(StripeService.createAutoTopUpIntent).not.toHaveBeenCalled();
    const shown =
      "Auto top-up was turned off: credits can't be charged in EUR yet. " +
      "Contact support to keep topping up.";
    expect(licenseUpdate).toHaveBeenLastCalledWith(
      { id: "lic-1" },
      stoppedWith(shown),
    );
    expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({ autoTopUpError: shown }),
    );
  });

  it("releases the key but stays on, silently, when the credit Price is not configured", async () => {
    // Our deploy, not their settings: nothing for the customer to fix, and
    // it resumes by itself once STRIPE_CREDITS_PRICE_ID is set.
    licenseRepo.findOne.mockResolvedValue(license());
    (StripeService.autoTopUpRequest as jest.Mock).mockRejectedValue(
      Object.assign(new Error("STRIPE_CREDITS_PRICE_ID is not set"), {
        code: "CREDITS_PRICE_NOT_CONFIGURED",
      }),
    );

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({
      charged: false,
      reason: "CREDITS_PRICE_NOT_CONFIGURED",
    });
    expect(licenseUpdate).toHaveBeenLastCalledWith(
      { id: "lic-1" },
      { creditAutoTopUpAttemptKey: null, creditAutoTopUpAttemptRequest: null },
    );
    expect(KodusNotificationClient.notifyCreditsLow).not.toHaveBeenCalled();
  });

  it("does nothing when the org turned it off between the claim and the charge", async () => {
    licenseRepo.findOne.mockResolvedValue(
      license({ creditAutoTopUpEnabled: false }),
    );
    expect(await AutoTopUpService.charge("lic-1")).toEqual({
      charged: false,
      reason: "NOT_CONFIGURED",
    });
    expect(StripeService.createAutoTopUpIntent).not.toHaveBeenCalled();
  });
});

describe("detachPaymentMethod", () => {
  it("forgets the card, turns auto top-up off, and detaches on Stripe", async () => {
    const lic = license();
    licenseRepo.findOne.mockResolvedValue(lic);
    const state = await AutoTopUpService.detachPaymentMethod("org-1", "team-1");
    expect(state?.enabled).toBe(false);
    expect(state?.paymentMethod).toBeNull();
    expect(lic.creditPaymentMethodId).toBeNull();
    expect(StripeService.detachPaymentMethod).toHaveBeenCalledWith("pm_123");
  });
});

describe("attempt keys", () => {
  it("mints keys that are never mistaken for a pre-stored-request attempt", () => {
    // The prefix routes the replay: a minted key read as pre-stored would
    // replay every new attempt as the old USD request. Literal, so a drift
    // in the format breaks here (CreditService.spec mocks the minter).
    const key = autoTopUpAttemptKey("lic-1", NOW);
    expect(key).toBe(`auto-topup:v2:lic-1:${NOW.getTime()}`);
    expect(isPreStoredRequestKey(key)).toBe(false);
    expect(isPreStoredRequestKey("auto-topup:lic-1:1789000000000")).toBe(true);
  });
});

describe("charge — idempotency across retries", () => {
  /**
   * The scenario this exists for: Stripe captured the card and the response
   * was lost. The attempt's outcome is UNKNOWN, so the key must survive and
   * the retry — a different sweep, minutes or hours later — must present the
   * SAME key, or Stripe charges the card twice. Keying on the attempt
   * timestamp instead made this impossible, because every sweep re-stamped
   * it (Kody, PR #51).
   */
  it("reuses the stored key after an UNKNOWN outcome, so a captured charge is not charged twice", async () => {
    const claimed = license({
      creditAutoTopUpAttemptKey: "auto-topup:v2:lic-1:111",
    });
    licenseRepo.findOne.mockResolvedValue(claimed);

    // 1st attempt: the network drops. Nothing is known about the money.
    (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("socket hang up"), {
        type: "StripeConnectionError",
      }),
    );
    const first = await AutoTopUpService.charge("lic-1");
    expect(first.charged).toBe(false);
    // The key is NOT cleared — the update carries only the error.
    expect(licenseUpdate).toHaveBeenLastCalledWith(
      { id: "lic-1" },
      { creditAutoTopUpLastError: "socket hang up" },
    );

    // 2nd attempt (the next sweep): same key, so Stripe returns the very
    // same PaymentIntent instead of creating a second charge.
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValueOnce(
      {
        id: "pi_same",
        status: "succeeded",
      },
    );
    (CreditService.applyPurchase as jest.Mock).mockResolvedValue({
      applied: true,
      balanceUsd: 53,
    });
    await AutoTopUpService.charge("lic-1");

    const keys = (
      StripeService.createAutoTopUpIntent as jest.Mock
    ).mock.calls.map((c) => c[1]);
    expect(keys).toEqual(["auto-topup:v2:lic-1:111", "auto-topup:v2:lic-1:111"]);
    // The ledger side is idempotent on the PaymentIntent id as well.
    expect(CreditService.applyPurchase).toHaveBeenLastCalledWith(
      expect.objectContaining({ usageKey: "stripe:pi:pi_same" }),
    );
  });

  it("stores the request before sending it, and a retry replays it after the Price or currency moved", async () => {
    const key = "auto-topup:v2:lic-1:111";
    licenseRepo.findOne.mockResolvedValueOnce(
      license({ creditAutoTopUpAttemptKey: key }),
    );
    (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("socket hang up"), {
        type: "StripeConnectionError",
      }),
    );
    await AutoTopUpService.charge("lic-1");

    const sent = fakeRequest({ creditUsd: 50, chargeUsd: 53.5 });
    // Written, under this attempt's key, before Stripe was called.
    expect(licenseUpdate).toHaveBeenCalledWith(
      { id: "lic-1", creditAutoTopUpAttemptKey: key },
      { creditAutoTopUpAttemptRequest: { key, params: sent } },
    );
    expect(licenseUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      (StripeService.createAutoTopUpIntent as jest.Mock).mock
        .invocationCallOrder[0],
    );

    // Before the retry the customer's currency became BRL: pricing the
    // attempt again would send BRL 29100 under a key Stripe holds for
    // USD 5350, and Stripe would refuse it.
    (StripeService.autoTopUpRequest as jest.Mock).mockResolvedValue({
      ...sent,
      amount: 29100,
      currency: "brl",
    });
    licenseRepo.findOne.mockResolvedValueOnce(
      license({
        creditAutoTopUpAttemptKey: key,
        creditAutoTopUpAttemptRequest: { key, params: sent },
      }),
    );
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValueOnce({
      id: "pi_same",
      status: "succeeded",
      amount: 5350,
      currency: "usd",
    });
    (CreditService.applyPurchase as jest.Mock).mockResolvedValue({
      applied: true,
      balanceUsd: 53,
    });
    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({ charged: true, creditUsd: 50, balanceUsd: 53 });
    expect(StripeService.autoTopUpRequest).toHaveBeenCalledTimes(1);
    expect(
      (StripeService.createAutoTopUpIntent as jest.Mock).mock.calls,
    ).toEqual([
      [sent, key],
      [sent, key],
    ]);
  });

  it("replays an attempt claimed before requests were stored as that version sent it", async () => {
    // A key without `v2` may have reached Stripe as USD at chargeUsd, with
    // no Price. US$10 was valid then, so it is replayed, not skipped.
    licenseRepo.findOne.mockResolvedValue(
      license({
        creditAutoTopUpAttemptKey: "auto-topup:lic-1:111",
        creditAutoTopUpAmountUsd: 10,
      }),
    );
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
      id: "pi_old",
      status: "succeeded",
      amount: 1070,
      currency: "usd",
    });
    (CreditService.applyPurchase as jest.Mock).mockResolvedValue({
      applied: true,
      balanceUsd: 13,
    });

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({ charged: true, creditUsd: 10, balanceUsd: 13 });
    expect(StripeService.autoTopUpRequest).not.toHaveBeenCalled();
    expect(StripeService.legacyAutoTopUpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ creditUsd: 10, chargeUsd: 10.7 }),
    );
    const [params, key] = (StripeService.createAutoTopUpIntent as jest.Mock)
      .mock.calls[0];
    expect(key).toBe("auto-topup:lic-1:111");
    expect(params.metadata).not.toHaveProperty("priceId");
    expect(licenseUpdate).toHaveBeenCalledWith(
      { id: "lic-1", creditAutoTopUpAttemptKey: "auto-topup:lic-1:111" },
      {
        creditAutoTopUpAttemptRequest: {
          key: "auto-topup:lic-1:111",
          params,
        },
      },
    );
  });

  it("does not charge an attempt whose key was dropped before its request was stored", async () => {
    licenseRepo.findOne.mockResolvedValue(license());
    licenseUpdate.mockResolvedValueOnce({ affected: 0 } as never);

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({ charged: false, reason: "ATTEMPT_SUPERSEDED" });
    expect(StripeService.createAutoTopUpIntent).not.toHaveBeenCalled();
  });

  it("PARKS the attempt when Stripe refuses the key, instead of re-charging", async () => {
    // The conflict proves the earlier request reached Stripe, and says
    // nothing about whether it captured. Releasing the key here is how you
    // charge a customer twice; so the attempt is parked instead.
    licenseRepo.findOne.mockResolvedValue(license());
    (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Keys for idempotent requests..."), {
        type: "StripeIdempotencyError",
      }),
    );

    const r = await AutoTopUpService.charge("lic-1");

    expect(r).toEqual({
      charged: false,
      reason: "PARKED_IDEMPOTENCY_CONFLICT",
    });
    const [, patch] = licenseUpdate.mock.calls[
      licenseUpdate.mock.calls.length - 1
    ] as unknown as [unknown, Record<string, unknown>];
    // Key KEPT, feature off, reason recorded.
    expect(patch).not.toHaveProperty("creditAutoTopUpAttemptKey");
    expect(patch.creditAutoTopUpEnabled).toBe(false);
    expect(patch.creditAutoTopUpLastError).toBe(AUTO_TOP_UP_PARKED_MESSAGE);
    expect(CreditService.applyPurchase).not.toHaveBeenCalled();
  });

  it("recovers a parked attempt when the customer turns it back on", async () => {
    const lic = license({
      creditAutoTopUpEnabled: false,
      creditAutoTopUpAttemptKey: "auto-topup:v2:lic-1:111",
      creditAutoTopUpLastError: AUTO_TOP_UP_PARKED_MESSAGE,
    });
    licenseRepo.findOne.mockResolvedValue(lic);

    await AutoTopUpService.updateSettings("org-1", "team-1", {
      enabled: true,
    });

    // A re-enable is the deliberate fresh start: new key next dip.
    expect(lic.creditAutoTopUpAttemptKey).toBeNull();
    expect(lic.creditAutoTopUpLastError).toBeNull();
  });

  it("keeps a key in flight across a NO-OP save", async () => {
    const lic = license({
      creditAutoTopUpAttemptKey: "auto-topup:v2:lic-1:111",
      creditAutoTopUpAmountUsd: 50,
    });
    licenseRepo.findOne.mockResolvedValue(lic);

    await AutoTopUpService.updateSettings("org-1", "team-1", {
      enabled: true,
      amountUsd: 50,
    });

    expect(lic.creditAutoTopUpAttemptKey).toBe("auto-topup:v2:lic-1:111");
  });

  it.each([
    {
      name: "the amount changes",
      run: async (lic: Record<string, unknown>) => {
        licenseRepo.findOne.mockResolvedValue(lic);
        await AutoTopUpService.updateSettings("org-1", "team-1", {
          enabled: true,
          amountUsd: 100,
        });
      },
    },
    {
      name: "the card changes",
      run: async (lic: Record<string, unknown>) =>
        AutoTopUpService.attachPaymentMethod(
          lic as never,
          "pm_new",
          "Visa •••• 1111",
        ),
    },
    {
      name: "the card is removed",
      run: async (lic: Record<string, unknown>) => {
        licenseRepo.findOne.mockResolvedValue(lic);
        await AutoTopUpService.detachPaymentMethod("org-1", "team-1");
      },
    },
  ])("drops a key in flight when $name", async ({ run }) => {
    const lic = license({ creditAutoTopUpAttemptKey: "auto-topup:v2:lic-1:111" });
    await run(lic as never);
    expect(lic.creditAutoTopUpAttemptKey).toBeNull();
  });

  it("does NOT drop the key when the feature is merely switched off", async () => {
    // Turning it off resolves nothing at the payment provider.
    const lic = license({ creditAutoTopUpAttemptKey: "auto-topup:v2:lic-1:111" });
    licenseRepo.findOne.mockResolvedValue(lic);
    await AutoTopUpService.updateSettings("org-1", "team-1", {
      enabled: false,
    });
    expect(lic.creditAutoTopUpAttemptKey).toBe("auto-topup:v2:lic-1:111");
  });

  it("refuses to charge when no attempt was claimed (never invents a key)", async () => {
    licenseRepo.findOne.mockResolvedValue(
      license({ creditAutoTopUpAttemptKey: null }),
    );
    expect(await AutoTopUpService.charge("lic-1")).toEqual({
      charged: false,
      reason: "NO_ATTEMPT_CLAIMED",
    });
    expect(StripeService.createAutoTopUpIntent).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a declined card",
      error: Object.assign(new Error("nope"), { type: "StripeCardError" }),
      definitive: true,
    },
    {
      name: "an invalid request",
      error: Object.assign(new Error("bad"), {
        type: "StripeInvalidRequestError",
      }),
      definitive: true,
    },
    {
      name: "an intent that needs authentication",
      error: new Error("payment_intent pi_x is requires_action"),
      definitive: true,
    },
    {
      name: "a timeout",
      error: Object.assign(new Error("timeout"), {
        type: "StripeConnectionError",
      }),
      definitive: false,
    },
    {
      name: "a Stripe 5xx",
      error: Object.assign(new Error("boom"), { type: "StripeAPIError" }),
      definitive: false,
    },
  ])(
    "releases the key only on a definitive outcome: $name",
    async ({ error, definitive }) => {
      licenseRepo.findOne.mockResolvedValue(license());
      (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValue(
        error,
      );

      await AutoTopUpService.charge("lic-1");

      expect(licenseUpdate).toHaveBeenLastCalledWith(
        { id: "lic-1" },
        definitive
          ? expect.objectContaining({ creditAutoTopUpAttemptKey: null })
          : expect.not.objectContaining({ creditAutoTopUpAttemptKey: null }),
      );
    },
  );
});
