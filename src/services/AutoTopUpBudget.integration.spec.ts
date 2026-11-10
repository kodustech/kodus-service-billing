import "reflect-metadata";
import { randomUUID } from "crypto";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import {
  captureRawBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WEBHOOK_SECRET_ENV,
  sign,
  signaturePayload,
} from "../config/utils/serviceToken";

jest.mock("./StripeService", () => ({
  StripeService: {
    autoTopUpRequest: jest.fn(async ({ creditUsd, chargeUsd }) => ({
      amount: Math.round(chargeUsd * 100),
      currency: "usd",
      customer: "cus_test",
      payment_method: "pm_test",
      off_session: true,
      confirm: true,
      metadata: { creditUsd: String(creditUsd), chargeUsd: String(chargeUsd) },
    })),
    createAutoTopUpIntent: jest.fn(),
    detachPaymentMethod: jest.fn(async () => undefined),
  },
}));
jest.mock("./KodusNotificationClient", () => ({
  KodusNotificationClient: {
    notifyCreditsLow: jest.fn(async () => undefined),
    notifyCreditsPurchased: jest.fn(async () => undefined),
  },
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));

import { AppDataSource as db } from "../config/database";
import { OrganizationLicense } from "../entities/OrganizationLicense";
import {
  CreditLedgerEntry,
  CreditLedgerEntryType,
} from "../entities/CreditLedgerEntry";
import { CreditAutoTopUpReservation } from "../entities/CreditAutoTopUpReservation";
import {
  AutoTopUpBudgetService,
  autoTopUpMonth,
} from "./AutoTopUpBudgetService";
import { AutoTopUpService } from "./AutoTopUpService";
import { CreditService } from "./CreditService";
import { StripeService } from "./StripeService";
import { AddAutoTopUpMonthlyLimit1794322000000 } from "../migrations/1794322000000-AddAutoTopUpMonthlyLimit";

// Opt-in, disposable local PostgreSQL only. Never run against .env production.
const integration =
  process.env.BILLING_INTEGRATION === "1" ? describe : describe.skip;
integration("monthly auto top-up budget — real PostgreSQL", () => {
  let wallet: OrganizationLicense;
  const licenses = () => db.getRepository(OrganizationLicense);
  const reservations = () => db.getRepository(CreditAutoTopUpReservation);
  const ledger = () => db.getRepository(CreditLedgerEntry);
  const fresh = () => licenses().findOneByOrFail({ id: wallet.id });
  const state = async (now?: Date) =>
    AutoTopUpBudgetService.stateOf(await fresh(), db.manager, now);
  const claim = async (key: string) =>
    licenses().update(wallet.id, { creditAutoTopUpAttemptKey: key });
  const purchase = async (
    amount: number,
    auto: boolean,
    createdAt = new Date(),
    teamId = wallet.teamId,
  ) => {
    // The ledger column is timestamp without time zone; production uses
    // database now() (UTC). Keep these boundary fixtures independent of TZ.
    await db.query(
      `INSERT INTO billing.credit_ledger_entries
      (id, "organizationId", "teamId", type, "amountUsd", "balanceAfterUsd", "usageKey", metadata, "createdAt")
      VALUES ($1,$2,$3,'purchase',$4,$4,$5,$6,$7::timestamptz AT TIME ZONE 'UTC')`,
      [
        randomUUID(),
        wallet.organizationId,
        teamId,
        amount,
        randomUUID(),
        { auto },
        createdAt.toISOString(),
      ],
    );
  };

  beforeAll(async () => {
    if (
      db.options.type !== "postgres" ||
      db.options.host !== "127.0.0.1" ||
      db.options.database !== "autotopup_test"
    ) {
      throw new Error(
        "Integration tests require a disposable local autotopup_test database",
      );
    }
    await db.initialize();
    await db.query('CREATE SCHEMA IF NOT EXISTS "billing"');
    await db.synchronize(true);
  });
  afterAll(async () => {
    if (db.isInitialized) await db.destroy();
  });
  beforeEach(async () => {
    (AutoTopUpService as any).resumeCursor = undefined;
    await reservations().deleteAll();
    await ledger().deleteAll();
    await licenses().deleteAll();
    wallet = await licenses().save(
      licenses().create({
        organizationId: randomUUID(),
        teamId: randomUUID(),
        creditBalanceUsd: 3,
        creditAutoTopUpEnabled: true,
        creditAutoTopUpAmountUsd: 50,
        creditAutoTopUpThresholdUsd: 5,
        creditAutoTopUpMonthlyLimitUsd: 100,
        creditPaymentMethodId: "pm_test",
        creditAutoTopUpAttemptKey: "auto-topup:v2:budget:1",
      }),
    );
    (StripeService.createAutoTopUpIntent as jest.Mock).mockReset();
  });

  it("persists the cap through the signed HTTP route and rejects invalid or unsigned writes", async () => {
    const oldSecret = process.env[WEBHOOK_SECRET_ENV];
    const oldStripe = process.env.STRIPE_SECRET_KEY;
    process.env[WEBHOOK_SECRET_ENV] = "integration-only-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_integration_no_network";
    let server: Server | undefined;
    try {
      const { default: router } = await import("../routes/subscription.routes");
      const app = express();
      app.use(express.json({ verify: captureRawBody }));
      app.use("/api/billing", router);
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const path = "/api/billing/credits/auto-topup";
      const send = (limit: unknown, signed = true) => {
        const body = JSON.stringify({
          organizationId: wallet.organizationId,
          teamId: wallet.teamId,
          enabled: true,
          monthlyLimitUsd: limit,
        });
        const ts = String(Date.now());
        return fetch(base + path, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
            ...(signed
              ? {
                  [TIMESTAMP_HEADER]: ts,
                  [SIGNATURE_HEADER]: sign(
                    "integration-only-secret",
                    signaturePayload("POST", path, "", ts, body),
                  ),
                }
              : {}),
          },
        });
      };
      expect((await send(200, false)).status).toBe(401);
      const saved = await send(200);
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({
        monthlyLimitUsd: 200,
        monthlyRemainingUsd: 200,
      });
      expect((await fresh()).creditAutoTopUpMonthlyLimitUsd).toBe(200);
      for (const invalid of [-1, 1.5, "200", true]) {
        const response = await send(invalid);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "INVALID_MONTHLY_LIMIT",
        });
      }
      expect((await fresh()).creditAutoTopUpMonthlyLimitUsd).toBe(200);
      expect((await send(null)).status).toBe(200);
      expect((await fresh()).creditAutoTopUpMonthlyLimitUsd).toBeNull();
    } finally {
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      if (oldSecret === undefined) delete process.env[WEBHOOK_SECRET_ENV];
      else process.env[WEBHOOK_SECRET_ENV] = oldSecret;
      if (oldStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = oldStripe;
    }
  });

  it("round-trips the migration without losing existing wallets", async () => {
    const runner = db.createQueryRunner();
    const migration = new AddAutoTopUpMonthlyLimit1794322000000();
    try {
      await licenses().update(wallet.id, {
        creditAutoTopUpAttemptRequest: {
          key: "stale-previous-attempt",
          params: {
            amount: 2000,
            currency: "usd",
            metadata: { creditUsd: "20" },
          },
        },
      });
      await migration.down(runner);
      await migration.up(runner);
      expect((await fresh()).creditAutoTopUpMonthlyLimitUsd).toBeNull();
      expect(
        await reservations().findOneByOrFail({
          key: wallet.creditAutoTopUpAttemptKey!,
        }),
      ).toMatchObject({ licenseId: wallet.id, creditUsd: 50 });
      await expect(
        db.query(
          `UPDATE billing.organization_licenses SET "creditAutoTopUpMonthlyLimitUsd" = -1`,
        ),
      ).rejects.toThrow();
    } finally {
      await runner.release();
    }
  });

  it("rejects stale, disabled and malformed attempts without holding capacity", async () => {
    expect(
      await AutoTopUpBudgetService.reserve(wallet.id, "stale-key", 50),
    ).toBe(false);
    for (const invalid of [0, -1, 1, 14, 25.5, 5001, Infinity, NaN]) {
      expect(
        await AutoTopUpBudgetService.reserve(
          wallet.id,
          wallet.creditAutoTopUpAttemptKey!,
          invalid,
        ),
      ).toBe(false);
    }
    await licenses().update(wallet.id, { creditAutoTopUpEnabled: false });
    expect(
      await AutoTopUpBudgetService.reserve(
        wallet.id,
        wallet.creditAutoTopUpAttemptKey!,
        50,
      ),
    ).toBe(false);
    expect(await reservations().count()).toBe(0);
  });

  it("counts only automatic purchases in this UTC month and this wallet", async () => {
    const now = new Date("2026-12-31T23:59:59.999Z");
    await purchase(40, true, new Date("2026-12-01T00:00:00Z"));
    await purchase(1000, false, now);
    await purchase(1000, true, new Date("2026-11-30T23:59:59.999Z"));
    await purchase(1000, true, now, "another-team");
    await purchase(1000, true, new Date("2027-01-01T00:00:00Z"));
    expect(await state(now)).toMatchObject({
      monthlyPurchasedUsd: 40,
      monthlyRemainingUsd: 60,
      resetsAt: "2027-01-01T00:00:00.000Z",
    });
  });

  it("serializes concurrent reservations and counts one replay only once", async () => {
    const key = wallet.creditAutoTopUpAttemptKey!;
    expect(
      await Promise.all(
        Array.from({ length: 12 }, () =>
          AutoTopUpBudgetService.reserve(wallet.id, key, 60),
        ),
      ),
    ).toEqual(Array(12).fill(true));
    expect(await reservations().count()).toBe(1);
    expect(await AutoTopUpBudgetService.reserve(wallet.id, key, 61)).toBe(
      false,
    );
    await claim("next-attempt");
    expect(
      await AutoTopUpBudgetService.reserve(wallet.id, "next-attempt", 50),
    ).toBe(false);
    expect(await state()).toMatchObject({
      monthlyReservedUsd: 60,
      monthlyRemainingUsd: 40,
    });
  });

  it("allows the exact cap, rejects exceeding it, and excludes manual purchases", async () => {
    await purchase(50, true);
    await purchase(500, false);
    expect(
      await AutoTopUpBudgetService.reserve(
        wallet.id,
        wallet.creditAutoTopUpAttemptKey!,
        50,
      ),
    ).toBe(true);
    expect(await state()).toMatchObject({
      monthlyRemainingUsd: 0,
      monthlyLimitReached: true,
    });
    await claim("next-attempt");
    expect(
      await AutoTopUpBudgetService.reserve(wallet.id, "next-attempt", 15),
    ).toBe(false);
  });

  it("zero blocks purchases; an omitted cap preserves it; null removes it", async () => {
    await AutoTopUpService.updateSettings(
      wallet.organizationId,
      wallet.teamId,
      { enabled: true, monthlyLimitUsd: 0 },
    );
    expect(
      await AutoTopUpBudgetService.reserve(
        wallet.id,
        wallet.creditAutoTopUpAttemptKey!,
        50,
      ),
    ).toBe(false);
    await AutoTopUpService.updateSettings(
      wallet.organizationId,
      wallet.teamId,
      { enabled: true },
    );
    expect((await fresh()).creditAutoTopUpMonthlyLimitUsd).toBe(0);
    await AutoTopUpService.updateSettings(
      wallet.organizationId,
      wallet.teamId,
      { enabled: true, monthlyLimitUsd: null },
    );
    await claim("unlimited");
    expect(
      await AutoTopUpBudgetService.reserve(wallet.id, "unlimited", 5000),
    ).toBe(true);
  });

  it("reopens capacity at UTC month/year rollover but retains unresolved reservations", async () => {
    await purchase(100, true, new Date("2026-12-31T23:59:59Z"));
    await reservations().insert({
      key: "unknown",
      licenseId: wallet.id,
      creditUsd: 20,
      createdAt: new Date("2026-12-31T23:59:59Z"),
    });
    expect(await state(new Date("2026-12-31T23:59:59.999Z"))).toMatchObject({
      monthlyRemainingUsd: 0,
    });
    expect(await state(new Date("2027-01-01T00:00:00Z"))).toMatchObject({
      monthlyPurchasedUsd: 0,
      monthlyReservedUsd: 20,
      monthlyRemainingUsd: 80,
    });
    expect(
      autoTopUpMonth(new Date("2028-02-29T23:59:59Z")).end.toISOString(),
    ).toBe("2028-03-01T00:00:00.000Z");
  });

  it("charges once, settles the reservation with the ledger and blocks the next purchase", async () => {
    await licenses().update(wallet.id, { creditAutoTopUpMonthlyLimitUsd: 50 });
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
      id: "pi_test",
      status: "succeeded",
      amount: 5350,
      currency: "usd",
    });
    expect(await AutoTopUpService.charge(wallet.id)).toMatchObject({
      charged: true,
      creditUsd: 50,
      balanceUsd: 53,
    });
    expect(await state()).toMatchObject({
      monthlyPurchasedUsd: 50,
      monthlyReservedUsd: 0,
      monthlyRemainingUsd: 0,
    });
    await claim("auto-topup:v2:budget:2");
    expect(await AutoTopUpService.charge(wallet.id)).toMatchObject({
      charged: false,
    });
    expect(StripeService.createAutoTopUpIntent).toHaveBeenCalledTimes(1);
    // Manual top-ups remain available after the automatic cap is reached.
    expect(
      await CreditService.applyPurchase({
        organizationId: wallet.organizationId,
        teamId: wallet.teamId,
        creditUsd: 20,
        usageKey: "manual",
      }),
    ).toMatchObject({ applied: true, balanceUsd: 73 });
    expect((await state()).monthlyPurchasedUsd).toBe(50);
  });

  it("holds an unknown charge across retries, settings changes and a later successful replay", async () => {
    (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValueOnce(
      new Error("timeout"),
    );
    expect(await AutoTopUpService.charge(wallet.id)).toMatchObject({
      charged: false,
    });
    expect((await state()).monthlyReservedUsd).toBe(50);
    await AutoTopUpService.updateSettings(
      wallet.organizationId,
      wallet.teamId,
      { enabled: true, monthlyLimitUsd: 0 },
    );
    // Resolve an already reserved attempt even after the cap is lowered.
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
      id: "pi_retry",
      status: "succeeded",
      amount: 5350,
      currency: "usd",
    });
    expect(await AutoTopUpService.charge(wallet.id)).toMatchObject({
      charged: true,
    });
    expect(await state()).toMatchObject({
      monthlyReservedUsd: 0,
      monthlyPurchasedUsd: 50,
    });
    const calls = (StripeService.createAutoTopUpIntent as jest.Mock).mock.calls;
    expect(calls[1]).toEqual([
      {
        amount: 5350,
        currency: "usd",
        customer: "cus_test",
        payment_method: "pm_test",
        off_session: true,
        confirm: true,
        metadata: { creditUsd: "50", chargeUsd: "53.5" },
      },
      "auto-topup:v2:budget:1",
    ]);
    expect(calls[0]).toEqual(calls[1]);
  });

  it("concurrent delivery of the same attempt credits and counts it only once", async () => {
    (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
      id: "pi_concurrent",
      status: "succeeded",
      amount: 5350,
      currency: "usd",
    });
    await Promise.all(
      Array.from({ length: 8 }, () => AutoTopUpService.charge(wallet.id)),
    );
    expect(await ledger().count()).toBe(1);
    expect((await fresh()).creditBalanceUsd).toBe(53);
    expect(await state()).toMatchObject({
      monthlyPurchasedUsd: 50,
      monthlyReservedUsd: 0,
    });
  });

  it("resumes after the monthly reset without needing a new debit, even with concurrent sweeps", async () => {
    const previousMonth = new Date();
    previousMonth.setUTCDate(1);
    previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
    await purchase(100, true, previousMonth);
    await licenses().update(wallet.id, {
      creditBalanceUsd: 0,
      creditAutoTopUpAttemptKey: null,
    });
    const charge = jest
      .spyOn(AutoTopUpService, "charge")
      .mockResolvedValue({ charged: false, reason: "observed" });
    try {
      await Promise.all([
        AutoTopUpService.resumeCappedWallets(),
        AutoTopUpService.resumeCappedWallets(),
      ]);
      expect(charge).toHaveBeenCalledTimes(1);
      expect(charge).toHaveBeenCalledWith(wallet.id);
      expect((await fresh()).creditAutoTopUpAttemptKey).toMatch(
        /^auto-topup:v2:/,
      );
      expect((await fresh()).creditBalanceUsd).toBe(0);
      expect(await ledger().count()).toBe(1); // The sweep adds no artificial usage.
    } finally {
      charge.mockRestore();
    }
  });

  it("does not resume while this month still lacks room for a full pack", async () => {
    await purchase(60, true);
    const charge = jest
      .spyOn(AutoTopUpService, "charge")
      .mockResolvedValue({ charged: false, reason: "observed" });
    try {
      await AutoTopUpService.resumeCappedWallets();
      expect(charge).not.toHaveBeenCalled();
      expect((await state()).monthlyRemainingUsd).toBe(40);
    } finally {
      charge.mockRestore();
    }
  });

  it.each(["amount", "card", "detach"])(
    "resolves the reserved request after %s changes without orphaning capacity",
    async (change) => {
      (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValueOnce(
        new Error("timeout"),
      );
      await AutoTopUpService.charge(wallet.id);
      if (change === "amount") {
        await AutoTopUpService.updateSettings(
          wallet.organizationId,
          wallet.teamId,
          { enabled: true, amountUsd: 100 },
        );
      } else if (change === "card") {
        await AutoTopUpService.attachPaymentMethod(
          await fresh(),
          "pm_new",
          "Visa new",
        );
      } else {
        expect(
          await AutoTopUpService.detachPaymentMethod(
            wallet.organizationId,
            wallet.teamId,
          ),
        ).toMatchObject({ monthlyLimitUsd: 100, monthlyReservedUsd: 50 });
        await AutoTopUpService.attachPaymentMethod(
          await fresh(),
          "pm_new",
          "Visa new",
        );
        await AutoTopUpService.updateSettings(
          wallet.organizationId,
          wallet.teamId,
          { enabled: true },
        );
      }
      expect((await fresh()).creditAutoTopUpAttemptKey).toBe(
        "auto-topup:v2:budget:1",
      );
      (StripeService.createAutoTopUpIntent as jest.Mock).mockResolvedValue({
        id: "pi_recovered",
        status: "succeeded",
        amount: 5350,
        currency: "usd",
      });
      expect(await AutoTopUpService.charge(wallet.id)).toMatchObject({
        charged: true,
        creditUsd: 50,
      });
      expect(await state()).toMatchObject({
        monthlyReservedUsd: 0,
        monthlyPurchasedUsd: 50,
        monthlyRemainingUsd: 50,
      });
      expect(
        (StripeService.createAutoTopUpIntent as jest.Mock).mock.calls[1],
      ).toEqual([
        {
          amount: 5350,
          currency: "usd",
          customer: "cus_test",
          payment_method: "pm_test",
          off_session: true,
          confirm: true,
          metadata: { creditUsd: "50", chargeUsd: "53.5" },
        },
        "auto-topup:v2:budget:1",
      ]);
    },
  );

  it("protects legacy unresolved attempts whose exact request is not stored", async () => {
    await reservations().insert({
      key: wallet.creditAutoTopUpAttemptKey!,
      licenseId: wallet.id,
      creditUsd: 50,
    });
    await expect(
      AutoTopUpService.updateSettings(wallet.organizationId, wallet.teamId, {
        enabled: true,
        amountUsd: 100,
      }),
    ).rejects.toThrow("AUTO_TOP_UP_PENDING");
    await expect(
      AutoTopUpService.attachPaymentMethod(await fresh(), "pm_new", "new card"),
    ).rejects.toThrow("AUTO_TOP_UP_PENDING");
    expect((await fresh()).creditAutoTopUpAmountUsd).toBe(50);
    expect((await state()).monthlyReservedUsd).toBe(50);
  });

  it("bounds each sweep and advances beyond a batch of blocked wallets", async () => {
    await licenses().update(wallet.id, { creditAutoTopUpEnabled: false });
    for (let i = 0; i < 101; i++) {
      await licenses().save(
        licenses().create({
          organizationId: randomUUID(),
          teamId: randomUUID(),
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          creditAutoTopUpEnabled: true,
          creditAutoTopUpAmountUsd: 50,
          creditAutoTopUpThresholdUsd: 5,
          creditAutoTopUpMonthlyLimitUsd: i === 100 ? 100 : 1,
          creditPaymentMethodId: "pm_test",
          creditBalanceUsd: 0,
        }),
      );
    }
    const charge = jest
      .spyOn(AutoTopUpService, "charge")
      .mockResolvedValue({ charged: false, reason: "observed" });
    try {
      await AutoTopUpService.resumeCappedWallets();
      expect(charge).not.toHaveBeenCalled();
      await AutoTopUpService.resumeCappedWallets();
      expect(charge).toHaveBeenCalledTimes(1);
      expect(charge).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000100",
      );
    } finally {
      charge.mockRestore();
    }
  });

  it("releases capacity only for definitive failures", async () => {
    (StripeService.createAutoTopUpIntent as jest.Mock).mockRejectedValue({
      type: "StripeCardError",
      message: "declined",
    });
    await AutoTopUpService.charge(wallet.id);
    expect((await state()).monthlyReservedUsd).toBe(0);
    expect((await fresh()).creditAutoTopUpAttemptKey).toBeNull();
  });
});
