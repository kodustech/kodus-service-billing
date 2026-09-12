import "reflect-metadata";

// --- isolate the module under test from DB/side-effectful imports ---
// A fake ledger that enforces the UNIQUE (organizationId, usageKey) rule the
// real table has, raising Postgres' 23505 on a duplicate, so idempotency is
// exercised through the same error path the service handles in prod.
const inserted: Array<Record<string, unknown>> = [];
const ledgerRepo = {
  insert: jest.fn(async (row: Record<string, unknown>) => {
    const dup = inserted.some(
      (r) =>
        r.organizationId === row.organizationId && r.usageKey === row.usageKey,
    );
    if (dup) {
      const err = new Error("duplicate key") as Error & {
        code?: string;
      };
      err.code = "23505";
      throw err;
    }
    inserted.push(row);
    return { identifiers: [{ id: "x" }] };
  }),
};
const licenseRepo = {
  findOne: jest.fn(),
  save: jest.fn(async (x: unknown) => x),
};
const managerQuery = jest.fn(async () => undefined);

jest.mock("../config/database", () => ({
  AppDataSource: {
    transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
      cb({
        getRepository: (entity: { name: string }) =>
          entity.name === "CreditLedgerEntry" ? ledgerRepo : licenseRepo,
        query: managerQuery,
      }),
    ),
    getRepository: () => ({}),
  },
}));
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: { findOne: jest.fn(), save: jest.fn() },
}));
jest.mock("../repositories/CreditLedgerRepository", () => ({
  CreditLedgerRepository: {
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  },
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
// Auto top-up is its own module (own spec); here it only needs to answer
// the trigger question and be observable when the debit claims an attempt.
const autoTopUpDecision = { value: false };
jest.mock("./AutoTopUpService", () => ({
  AutoTopUpService: {
    stateOf: () => ({
      enabled: false,
      thresholdUsd: null,
      amountUsd: null,
      paymentMethod: null,
      lastAt: null,
      lastError: null,
    }),
    charge: jest.fn(async () => ({ charged: true })),
  },
  decideAutoTopUp: jest.fn(() => autoTopUpDecision.value),
}));
jest.mock("./KodusNotificationClient", () => ({
  KodusNotificationClient: {
    notifyCreditsPurchased: jest.fn(async () => undefined),
    notifyCreditsLow: jest.fn(async () => undefined),
  },
}));

import { CreditService, decideNotification } from "./CreditService";
import { AutoTopUpService } from "./AutoTopUpService";
import { KodusNotificationClient } from "./KodusNotificationClient";
import { clearCacheByPrefix } from "../config/utils/cache";
import { CREDITS_LOW_THRESHOLD_USD } from "../config/creditPricing";
import { CreditLedgerRepository } from "../repositories/CreditLedgerRepository";

const license = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "lic-1",
  organizationId: "org-1",
  teamId: "team-1",
  creditBalanceUsd: 10,
  creditsLowNotifiedAt: null,
  creditsExhaustedNotifiedAt: null,
  creditAutoTopUpLastAt: null as Date | null,
  creditAutoTopUpAttemptKey: null as string | null,
  ...over,
});

beforeEach(() => {
  inserted.length = 0;
  licenseRepo.findOne.mockReset();
  licenseRepo.save.mockClear();
  ledgerRepo.insert.mockClear();
  managerQuery.mockClear();
  (KodusNotificationClient.notifyCreditsLow as jest.Mock).mockClear();
  (KodusNotificationClient.notifyCreditsPurchased as jest.Mock).mockClear();
  (clearCacheByPrefix as jest.Mock).mockClear();
  (AutoTopUpService.charge as jest.Mock).mockClear();
  autoTopUpDecision.value = false;
});

describe("debit — auto top-up claim", () => {
  it("stamps the attempt under the lock and charges once, outside the transaction", async () => {
    const lic = license({ creditBalanceUsd: 4 });
    licenseRepo.findOne.mockResolvedValue(lic);
    autoTopUpDecision.value = true;

    await CreditService.debit({
      organizationId: "org-1",
      teamId: "team-1",
      entries: [{ usageKey: "span:1", amountUsd: 1 }],
    });

    expect(lic.creditAutoTopUpLastAt).toBeInstanceOf(Date);
    // The Stripe idempotency key is minted HERE, under the lock, so every
    // retry of this attempt presents the same one.
    expect(lic.creditAutoTopUpAttemptKey).toBe(
      `auto-topup:lic-1:${lic.creditAutoTopUpLastAt!.getTime()}`,
    );
    expect(licenseRepo.save).toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(AutoTopUpService.charge).toHaveBeenCalledTimes(1);
    expect(AutoTopUpService.charge).toHaveBeenCalledWith("lic-1");
  });

  it("does not touch the attempt marker when the rule says no", async () => {
    const lic = license({ creditBalanceUsd: 40 });
    licenseRepo.findOne.mockResolvedValue(lic);
    await CreditService.debit({
      organizationId: "org-1",
      teamId: "team-1",
      entries: [{ usageKey: "span:2", amountUsd: 1 }],
    });
    expect(lic.creditAutoTopUpLastAt).toBeNull();
    expect(AutoTopUpService.charge).not.toHaveBeenCalled();
  });

  it("keeps a key from an attempt whose outcome is unknown", async () => {
    // A previous charge timed out and left its key behind on purpose. The
    // next qualifying debit re-stamps the timestamp but must NOT mint a
    // new key, or Stripe would charge a captured payment twice.
    const lic = license({
      creditBalanceUsd: 4,
      creditAutoTopUpAttemptKey: "auto-topup:lic-1:111",
    });
    licenseRepo.findOne.mockResolvedValue(lic);
    autoTopUpDecision.value = true;

    await CreditService.debit({
      organizationId: "org-1",
      teamId: "team-1",
      entries: [{ usageKey: "span:3", amountUsd: 1 }],
    });

    expect(lic.creditAutoTopUpAttemptKey).toBe("auto-topup:lic-1:111");
  });
});

describe("validatePurchaseAmount", () => {
  it("accepts listed packs and in-bounds custom amounts, rejects the rest", () => {
    expect(CreditService.validatePurchaseAmount(100)).toBe(100);
    expect(CreditService.validatePurchaseAmount("50")).toBe(50);
    expect(CreditService.validatePurchaseAmount(37.5)).toBe(37.5);
    expect(CreditService.validatePurchaseAmount(1)).toBeNull();
    expect(CreditService.validatePurchaseAmount(1_000_000)).toBeNull();
    expect(CreditService.validatePurchaseAmount("abc")).toBeNull();
    expect(CreditService.validatePurchaseAmount(undefined)).toBeNull();
  });
});

describe("quote", () => {
  it("charges the credit amount plus the markup, to the cent", () => {
    const q = CreditService.quote(100);
    expect(q.creditUsd).toBe(100);
    expect(q.chargeUsd).toBeCloseTo(100 * (1 + q.markupPct / 100), 2);
  });
});

describe("debit", () => {
  it("applies each entry, decrements the balance and appends signed ledger rows", async () => {
    const lic = license({ creditBalanceUsd: 10 });
    licenseRepo.findOne.mockResolvedValue(lic);

    const result = await CreditService.debit({
      organizationId: "org-1",
      teamId: "team-1",
      entries: [
        { usageKey: "span:1", amountUsd: 0.25 },
        { usageKey: "span:2", amountUsd: 0.5, metadata: { pr: 42 } },
      ],
    });

    expect(result).toMatchObject({
      applied: 2,
      skipped: 0,
      appliedUsd: 0.75,
      balanceUsd: 9.25,
      lowBalance: false,
      exhausted: false,
    });
    expect(lic.creditBalanceUsd).toBe(9.25);
    expect(inserted.map((r) => r.amountUsd)).toEqual([-0.25, -0.5]);
    expect(inserted[1].balanceAfterUsd).toBe(9.25);
    expect(inserted[1].metadata).toEqual({ pr: 42 });
    expect(clearCacheByPrefix).toHaveBeenCalledWith("org-license");
    // Row-level savepoints: one per entry, released on success.
    expect(managerQuery).toHaveBeenCalledWith("SAVEPOINT credit_debit_row");
    expect(managerQuery).toHaveBeenCalledWith(
      "RELEASE SAVEPOINT credit_debit_row",
    );
  });

  it("is idempotent per usageKey: a duplicate is skipped, never charged twice", async () => {
    const lic = license({ creditBalanceUsd: 10 });
    licenseRepo.findOne.mockResolvedValue(lic);

    await CreditService.debit({
      organizationId: "org-1",
      entries: [{ usageKey: "span:1", amountUsd: 1 }],
    });
    const again = await CreditService.debit({
      organizationId: "org-1",
      entries: [
        { usageKey: "span:1", amountUsd: 1 },
        { usageKey: "span:9", amountUsd: 2 },
      ],
    });

    expect(again).toMatchObject({ applied: 1, skipped: 1, appliedUsd: 2 });
    expect(lic.creditBalanceUsd).toBe(7);
    expect(managerQuery).toHaveBeenCalledWith(
      "ROLLBACK TO SAVEPOINT credit_debit_row",
    );
  });

  it("lets the balance go negative (usage already happened) and flags exhausted", async () => {
    const lic = license({ creditBalanceUsd: 0.1 });
    licenseRepo.findOne.mockResolvedValue(lic);

    const result = await CreditService.debit({
      organizationId: "org-1",
      entries: [{ usageKey: "span:1", amountUsd: 0.4 }],
    });

    expect(result.balanceUsd).toBeCloseTo(-0.3, 6);
    expect(result.exhausted).toBe(true);
    expect(result.lowBalance).toBe(true);
  });

  it("drops malformed entries instead of failing the batch", async () => {
    const lic = license({ creditBalanceUsd: 10 });
    licenseRepo.findOne.mockResolvedValue(lic);

    const result = await CreditService.debit({
      organizationId: "org-1",
      entries: [
        { usageKey: "", amountUsd: 1 },
        { usageKey: "span:neg", amountUsd: -1 },
        { usageKey: "span:nan", amountUsd: Number("x") },
        { usageKey: "span:ok", amountUsd: 1 },
      ] as any,
    });

    expect(result.applied).toBe(1);
    expect(lic.creditBalanceUsd).toBe(9);
  });

  it("throws LICENSE_NOT_FOUND for an unknown org", async () => {
    licenseRepo.findOne.mockResolvedValue(null);
    await expect(
      CreditService.debit({
        organizationId: "nope",
        entries: [{ usageKey: "span:1", amountUsd: 1 }],
      }),
    ).rejects.toThrow("LICENSE_NOT_FOUND");
  });

  describe("one-shot low / exhausted notifications", () => {
    it("fires `low` once when crossing the threshold, not again while low", async () => {
      const lic = license({
        creditBalanceUsd: CREDITS_LOW_THRESHOLD_USD + 1,
      });
      licenseRepo.findOne.mockResolvedValue(lic);

      await CreditService.debit({
        organizationId: "org-1",
        entries: [{ usageKey: "span:1", amountUsd: 1.5 }],
      });
      expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledWith(
        expect.objectContaining({ exhausted: false, organizationId: "org-1" }),
      );
      expect(lic.creditsLowNotifiedAt).toBeInstanceOf(Date);

      await CreditService.debit({
        organizationId: "org-1",
        entries: [{ usageKey: "span:2", amountUsd: 0.1 }],
      });
      expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledTimes(1);
    });

    it("fires `exhausted` once when hitting zero, even if `low` already fired", async () => {
      const lic = license({
        creditBalanceUsd: 1,
        creditsLowNotifiedAt: new Date(),
      });
      licenseRepo.findOne.mockResolvedValue(lic);

      await CreditService.debit({
        organizationId: "org-1",
        entries: [{ usageKey: "span:1", amountUsd: 1 }],
      });
      expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledWith(
        expect.objectContaining({ exhausted: true }),
      );
      expect(lic.creditsExhaustedNotifiedAt).toBeInstanceOf(Date);

      await CreditService.debit({
        organizationId: "org-1",
        entries: [{ usageKey: "span:2", amountUsd: 1 }],
      });
      expect(KodusNotificationClient.notifyCreditsLow).toHaveBeenCalledTimes(1);
    });
  });
});

describe("applyPurchase", () => {
  it("credits the balance, appends a positive row and re-arms notifications", async () => {
    const lic = license({
      creditBalanceUsd: -2,
      creditsLowNotifiedAt: new Date(),
      creditsExhaustedNotifiedAt: new Date(),
    });
    licenseRepo.findOne.mockResolvedValue(lic);

    const result = await CreditService.applyPurchase({
      organizationId: "org-1",
      teamId: "team-1",
      creditUsd: 100,
      usageKey: "stripe:checkout:cs_1",
      metadata: { chargeUsd: 107 },
    });

    expect(result).toEqual({ applied: true, balanceUsd: 98 });
    expect(lic.creditBalanceUsd).toBe(98);
    expect(lic.creditsLowNotifiedAt).toBeNull();
    expect(lic.creditsExhaustedNotifiedAt).toBeNull();
    expect(inserted[0]).toMatchObject({
      type: "purchase",
      amountUsd: 100,
      balanceAfterUsd: 98,
      usageKey: "stripe:checkout:cs_1",
    });
    expect(KodusNotificationClient.notifyCreditsPurchased).toHaveBeenCalledWith(
      expect.objectContaining({ creditUsd: 100, balanceUsd: 98 }),
    );
  });

  it("is idempotent on the Stripe session id (a redelivered webhook is a no-op)", async () => {
    const lic = license({ creditBalanceUsd: 0 });
    licenseRepo.findOne.mockResolvedValue(lic);

    await CreditService.applyPurchase({
      organizationId: "org-1",
      creditUsd: 20,
      usageKey: "stripe:checkout:cs_dup",
    });
    const second = await CreditService.applyPurchase({
      organizationId: "org-1",
      creditUsd: 20,
      usageKey: "stripe:checkout:cs_dup",
    });

    expect(second).toEqual({ applied: false, balanceUsd: 20 });
    expect(lic.creditBalanceUsd).toBe(20);
    expect(
      KodusNotificationClient.notifyCreditsPurchased,
    ).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-positive amount", async () => {
    await expect(
      CreditService.applyPurchase({
        organizationId: "org-1",
        creditUsd: 0,
        usageKey: "x",
      }),
    ).rejects.toThrow(/positive/);
  });
});

describe("decideNotification", () => {
  it("exhausted supersedes low; each fires once until re-armed", () => {
    const fresh = {
      creditsLowNotifiedAt: null,
      creditsExhaustedNotifiedAt: null,
    };
    expect(decideNotification(fresh, 100).send).toBeNull();
    expect(decideNotification(fresh, CREDITS_LOW_THRESHOLD_USD).send).toBe(
      "low",
    );
    expect(decideNotification(fresh, 0).send).toBe("exhausted");
    expect(
      decideNotification(
        { creditsLowNotifiedAt: new Date(), creditsExhaustedNotifiedAt: null },
        1,
      ).send,
    ).toBeNull();
    expect(
      decideNotification(
        { creditsLowNotifiedAt: null, creditsExhaustedNotifiedAt: new Date() },
        -5,
      ).send,
    ).toBeNull();
  });
});

describe("adjust (admin)", () => {
  it("applies a signed adjustment, idempotent on usageKey, and re-arms notifications", async () => {
    const lic = license({
      creditBalanceUsd: -1,
      creditsLowNotifiedAt: new Date(),
      creditsExhaustedNotifiedAt: new Date(),
    });
    licenseRepo.findOne.mockResolvedValue(lic);

    const first = await CreditService.adjust({
      organizationId: "org-1",
      amountUsd: 26,
      usageKey: "adjust:seed",
      reason: "seed",
    });
    expect(first).toEqual({ applied: true, balanceUsd: 25 });
    expect(inserted[0]).toMatchObject({ type: "adjustment", amountUsd: 26 });
    expect(lic.creditsLowNotifiedAt).toBeNull();
    expect(lic.creditsExhaustedNotifiedAt).toBeNull();

    const again = await CreditService.adjust({
      organizationId: "org-1",
      amountUsd: 26,
      usageKey: "adjust:seed",
      reason: "seed",
    });
    expect(again).toEqual({ applied: false, balanceUsd: 25 });

    const down = await CreditService.adjust({
      organizationId: "org-1",
      amountUsd: -25,
      usageKey: "adjust:zero",
      reason: "test exhaustion",
    });
    expect(down.balanceUsd).toBe(0);
  });

  it("rejects a zero or non-numeric amount", async () => {
    await expect(
      CreditService.adjust({
        organizationId: "o",
        amountUsd: 0,
        usageKey: "x",
        reason: "r",
      }),
    ).rejects.toThrow(/non-zero/);
  });
});

/**
 * The ledger cursor is `(createdAt, id)`, and `createdAt` is a MICROSECOND
 * timestamp in Postgres while the value the client echoes back has been
 * through JSON — milliseconds. Filtering on the truncated value drops the rest
 * of a debit batch from pagination forever (every row of one batch shares the
 * transaction's `now()`), which is the very thing the id was added to fix.
 * So the cursor row is resolved server-side, by id, and its STORED timestamp
 * is what the query filters on. Kody caught this on PR #51.
 */
describe("listLedger — cursor precision", () => {
  /**
   * `createdAt` is a MICROSECOND timestamp and a whole debit batch shares it,
   * so the keyset cursor must compare against the value Postgres holds. Any
   * round trip through JavaScript truncates it to milliseconds — the driver
   * parses a timestamp into a Date — and the batch's remaining rows become
   * unreachable. Reading the cursor row into JS does not fix that; it only
   * moves the truncation (Kody, PR #51, twice). So the comparison is a
   * row-value against a subquery and ONLY the cursor id crosses the wire.
   */
  const builders = () => {
    const main = {
      sql: [] as Array<{ sql: unknown; params?: Record<string, unknown> }>,
      where: jest.fn(() => main),
      andWhere: jest.fn((sql: unknown, params?: Record<string, unknown>) => {
        main.sql.push({ sql, params });
        return main;
      }),
      orderBy: jest.fn(() => main),
      addOrderBy: jest.fn(() => main),
      take: jest.fn(() => main),
      getMany: jest.fn(async () => []),
    };
    const cursor = {
      found: true,
      select: jest.fn(() => cursor),
      where: jest.fn(() => cursor),
      andWhere: jest.fn(() => cursor),
      getRawOne: jest.fn(async () =>
        cursor.found ? { present: 1 } : undefined,
      ),
    };
    (CreditLedgerRepository.createQueryBuilder as jest.Mock).mockImplementation(
      (alias: string) => (alias === "c" ? cursor : main),
    );
    return { main, cursor };
  };

  beforeEach(() => {
    (CreditLedgerRepository as unknown as Record<string, unknown>).metadata = {
      tablePath: "billing.credit_ledger_entries",
    };
  });

  it("compares inside Postgres and binds no timestamp at all", async () => {
    const { main, cursor } = builders();
    cursor.found = true;

    await CreditService.listLedger("org-1", {
      // The client echoes back a millisecond-truncated value; it must not be
      // what the query filters on.
      before: new Date("2026-09-10T12:00:00.000Z"),
      beforeId: "3f1a7c62-5b0e-4f7a-9c11-2b6d8e4a7f90",
      limit: 10,
    });

    const keyset = main.sql.find(
      (c) => typeof c.sql === "string" && c.sql.includes("SELECT c2."),
    );
    expect(keyset).toBeDefined();
    expect(keyset!.sql).toContain('(e."createdAt", e."id") <');
    expect(keyset!.sql).toContain("billing.credit_ledger_entries");
    // Only ids and the org id are bound — no Date anywhere.
    expect(keyset!.params).toEqual({
      cursorId: "3f1a7c62-5b0e-4f7a-9c11-2b6d8e4a7f90",
      organizationId: "org-1",
    });
    for (const call of main.sql) {
      for (const value of Object.values(call.params ?? {})) {
        expect(value).not.toBeInstanceOf(Date);
      }
    }
    // The existence check asks for a constant, never for the timestamp.
    expect(cursor.select).toHaveBeenCalledWith("1", "present");
  });

  it("falls back to the timestamp when the cursor row is gone", async () => {
    const { main, cursor } = builders();
    cursor.found = false;
    const before = new Date("2026-09-10T12:00:00.000Z");

    await CreditService.listLedger("org-1", {
      before,
      beforeId: "3f1a7c62-5b0e-4f7a-9c11-2b6d8e4a7f90",
    });

    expect(main.andWhere).toHaveBeenCalledWith({
      createdAt: expect.anything(),
    });
    expect(
      main.sql.some(
        (c) => typeof c.sql === "string" && c.sql.includes("SELECT c2."),
      ),
    ).toBe(false);
  });

  it("never sends a malformed cursor to Postgres (22P02 would be a 500)", async () => {
    const { main, cursor } = builders();

    await CreditService.listLedger("org-1", {
      before: new Date("2026-09-10T12:00:00.000Z"),
      beforeId: "not-a-uuid; drop table",
    });

    // No lookup at all, and the page still comes back (timestamp fallback).
    expect(cursor.getRawOne).not.toHaveBeenCalled();
    expect(main.andWhere).toHaveBeenCalledWith({
      createdAt: expect.anything(),
    });
  });
});
