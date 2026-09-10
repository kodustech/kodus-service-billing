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
jest.mock("./StripeService", () => ({
    StripeService: {
        chargeSavedPaymentMethod: jest.fn(),
        detachPaymentMethod: jest.fn(async () => undefined),
    },
}));
jest.mock("./CreditService", () => ({
    CreditService: {
        applyPurchase: jest.fn(),
        validatePurchaseAmount: (n: unknown) => {
            const v = Number(n);
            if (!Number.isFinite(v)) return null;
            if ([20, 50, 100, 500].includes(v)) return v;
            return v >= 10 && v <= 5000 ? v : null;
        },
    },
}));

import {
    AUTO_TOP_UP_RETRY_MS,
    AutoTopUpService,
    decideAutoTopUp,
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
    ...over,
});

beforeEach(() => {
    licenseRepo.findOne.mockReset();
    licenseRepo.save.mockClear();
    licenseUpdate.mockClear();
    (StripeService.chargeSavedPaymentMethod as jest.Mock).mockReset();
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
            decideAutoTopUp(license({ creditAutoTopUpEnabled: false }) as any, 0, NOW),
        ).toBe(false);
        expect(
            decideAutoTopUp(license({ creditPaymentMethodId: null }) as any, 0, NOW),
        ).toBe(false);
        expect(
            decideAutoTopUp(license({ creditAutoTopUpAmountUsd: null }) as any, 0, NOW),
        ).toBe(false);
        expect(
            decideAutoTopUp(license({ creditAutoTopUpThresholdUsd: null }) as any, 0, NOW),
        ).toBe(false);
    });

    it("retries at most once per window (a declined card is not hammered every sweep)", () => {
        const recent = new Date(NOW.getTime() - AUTO_TOP_UP_RETRY_MS + 1000);
        const old = new Date(NOW.getTime() - AUTO_TOP_UP_RETRY_MS - 1000);
        expect(
            decideAutoTopUp(license({ creditAutoTopUpLastAt: recent }) as any, 0, NOW),
        ).toBe(false);
        expect(
            decideAutoTopUp(license({ creditAutoTopUpLastAt: old }) as any, 0, NOW),
        ).toBe(true);
    });
});

describe("updateSettings", () => {
    it("refuses to enable without a saved card (the UI sends the user to save one)", async () => {
        licenseRepo.findOne.mockResolvedValue(license({ creditPaymentMethodId: null }));
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
        licenseRepo.findOne.mockResolvedValue(license({ creditAutoTopUpLastError: "old" }));
        (StripeService.chargeSavedPaymentMethod as jest.Mock).mockResolvedValue({
            id: "pi_1",
            status: "succeeded",
        });
        (CreditService.applyPurchase as jest.Mock).mockResolvedValue({
            applied: true,
            balanceUsd: 53,
        });

        const r = await AutoTopUpService.charge("lic-1");

        expect(r).toEqual({ charged: true, creditUsd: 50, balanceUsd: 53 });
        expect(StripeService.chargeSavedPaymentMethod).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethodId: "pm_123",
                creditUsd: 50,
                chargeUsd: 53.5, // 7% markup
            }),
        );
        expect(CreditService.applyPurchase).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationId: "org-1",
                creditUsd: 50,
                usageKey: "stripe:pi:pi_1",
                metadata: expect.objectContaining({ auto: true, chargeUsd: 53.5 }),
            }),
        );
        expect(licenseUpdate).toHaveBeenCalledWith(
            { id: "lic-1" },
            { creditAutoTopUpLastError: null },
        );
    });

    it("records a declined card on the license and tells the org, without crediting anything", async () => {
        licenseRepo.findOne.mockResolvedValue(license({ creditBalanceUsd: 0 }));
        (StripeService.chargeSavedPaymentMethod as jest.Mock).mockRejectedValue(
            new Error("Your card was declined."),
        );

        const r = await AutoTopUpService.charge("lic-1");

        expect(r).toEqual({ charged: false, reason: "Your card was declined." });
        expect(CreditService.applyPurchase).not.toHaveBeenCalled();
        expect(licenseUpdate).toHaveBeenCalledWith(
            { id: "lic-1" },
            { creditAutoTopUpLastError: "Your card was declined." },
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
        (StripeService.chargeSavedPaymentMethod as jest.Mock).mockResolvedValue({
            id: "pi_2",
            status: "requires_action",
        });
        const r = await AutoTopUpService.charge("lic-1");
        expect(r.charged).toBe(false);
        expect(CreditService.applyPurchase).not.toHaveBeenCalled();
    });

    it("does nothing when the org turned it off between the claim and the charge", async () => {
        licenseRepo.findOne.mockResolvedValue(license({ creditAutoTopUpEnabled: false }));
        expect(await AutoTopUpService.charge("lic-1")).toEqual({
            charged: false,
            reason: "NOT_CONFIGURED",
        });
        expect(StripeService.chargeSavedPaymentMethod).not.toHaveBeenCalled();
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
