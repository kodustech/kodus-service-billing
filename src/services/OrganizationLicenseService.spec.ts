import "reflect-metadata";

// --- isolate the module under test from DB/side-effectful imports ---
const txRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x: unknown) => x),
};

jest.mock("../config/database", () => ({
    AppDataSource: {
        transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
            cb({ getRepository: () => txRepo }),
        ),
    },
}));
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
    OrganizationLicenseRepository: {
        findOne: jest.fn(),
        create: jest.fn((x: unknown) => x),
        save: jest.fn(async (x: unknown) => x),
    },
}));
jest.mock("../repositories/UserLicenseRepository", () => ({
    UserLicenseRepository: {},
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
jest.mock("../config/utils/urlBuilder", () => ({ buildLogApiUrl: jest.fn() }));
jest.mock("axios", () => ({ post: jest.fn() }));

import {
    OrganizationLicenseService,
    normalizeTrialCredits,
} from "./OrganizationLicenseService";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { SubscriptionStatus, TrialCreditTier } from "../entities/OrganizationLicense";

const futureTrialEnd = () => new Date(Date.now() + 86_400_000);

describe("normalizeTrialCredits", () => {
    it("LEGACY (null total): no change, all credit fields stay null", () => {
        const lic: any = {
            trialReviewCreditsTotal: null,
            trialReviewCreditsUsed: null,
            trialReviewCreditsRemaining: null,
            planType: "teams_byok",
        };

        expect(normalizeTrialCredits(lic)).toBe(false);
        expect(lic.trialReviewCreditsTotal).toBeNull();
        expect(lic.trialReviewCreditsUsed).toBeNull();
        expect(lic.trialReviewCreditsRemaining).toBeNull();
    });

    it("credited trial: derives used=0, remaining=total, tier=base, arrays", () => {
        const lic: any = {
            trialReviewCreditsTotal: 5,
            planType: "teams_byok",
        };

        expect(normalizeTrialCredits(lic)).toBe(true);
        expect(lic.trialReviewCreditsUsed).toBe(0);
        expect(lic.trialReviewCreditsRemaining).toBe(5);
        expect(lic.trialCreditTier).toBe(TrialCreditTier.BASE);
        expect(Array.isArray(lic.trialUnlocks)).toBe(true);
        expect(Array.isArray(lic.trialReviewCreditUsageKeys)).toBe(true);
    });

    it("clamps a negative used to 0", () => {
        const lic: any = {
            trialReviewCreditsTotal: 5,
            trialReviewCreditsUsed: -3,
            trialReviewCreditsRemaining: 5,
            trialCreditTier: "base",
            trialUnlocks: [],
            trialReviewCreditUsageKeys: [],
        };

        normalizeTrialCredits(lic);
        expect(lic.trialReviewCreditsUsed).toBe(0);
    });
});

describe("OrganizationLicenseService.consumeTrialReviewCredit", () => {
    const baseTrial = () => ({
        subscriptionStatus: SubscriptionStatus.TRIAL,
        planType: "teams_byok",
        trialEnd: futureTrialEnd(),
        trialReviewCreditsTotal: 5,
        trialReviewCreditsUsed: 2,
        trialReviewCreditsRemaining: 3,
        trialCreditTier: "base",
        trialUnlocks: [],
        trialReviewCreditUsageKeys: [] as string[],
    });

    beforeEach(() => txRepo.findOne.mockReset());

    it("consumes one credit and records the usageKey", async () => {
        const lic = baseTrial();
        txRepo.findOne.mockResolvedValue(lic);

        const r = await OrganizationLicenseService.consumeTrialReviewCredit(
            "org",
            "team",
            "repo:1",
        );

        expect(r.allowed).toBe(true);
        expect(lic.trialReviewCreditsRemaining).toBe(2);
        expect(lic.trialReviewCreditsUsed).toBe(3);
        expect(lic.trialReviewCreditUsageKeys).toContain("repo:1");
    });

    it("is idempotent for a repeated usageKey (no second decrement)", async () => {
        const lic = { ...baseTrial(), trialReviewCreditUsageKeys: ["repo:1"] };
        txRepo.findOne.mockResolvedValue(lic);

        const r = await OrganizationLicenseService.consumeTrialReviewCredit(
            "org",
            "team",
            "repo:1",
        );

        expect(r.allowed).toBe(true);
        expect(r.alreadyConsumed).toBe(true);
        expect(lic.trialReviewCreditsRemaining).toBe(3);
        expect(lic.trialReviewCreditsUsed).toBe(2);
    });

    it("blocks when credits are exhausted", async () => {
        const lic = {
            ...baseTrial(),
            trialReviewCreditsUsed: 5,
            trialReviewCreditsRemaining: 0,
        };
        txRepo.findOne.mockResolvedValue(lic);

        const r = await OrganizationLicenseService.consumeTrialReviewCredit(
            "org",
            "team",
            "repo:9",
        );

        expect(r.allowed).toBe(false);
        expect(r.reason).toBe("TRIAL_REVIEW_CREDITS_EXHAUSTED");
    });

    it("allows a LEGACY trial (null credits) without gating", async () => {
        const lic = {
            ...baseTrial(),
            trialReviewCreditsTotal: null,
            trialReviewCreditsUsed: null,
            trialReviewCreditsRemaining: null,
        };
        txRepo.findOne.mockResolvedValue(lic);

        const r = await OrganizationLicenseService.consumeTrialReviewCredit(
            "org",
            "team",
            "repo:9",
        );

        expect(r.allowed).toBe(true);
        expect(r.reason).toBe("LEGACY_TRIAL");
    });

    it("allows when not a trial (e.g. active plan)", async () => {
        txRepo.findOne.mockResolvedValue({
            subscriptionStatus: SubscriptionStatus.ACTIVE,
        });

        const r = await OrganizationLicenseService.consumeTrialReviewCredit(
            "org",
            "team",
        );

        expect(r.allowed).toBe(true);
    });
});

describe("OrganizationLicenseService.createTrialLicense", () => {
    const repo = OrganizationLicenseRepository as unknown as {
        findOne: jest.Mock;
        create: jest.Mock;
        save: jest.Mock;
    };

    it("seeds a new trial with the included credits", async () => {
        repo.findOne.mockResolvedValue(null);

        const license = await OrganizationLicenseService.createTrialLicense(
            "org",
            "team",
        );

        expect(license.trialReviewCreditsTotal).toBe(5);
        expect(license.trialReviewCreditsRemaining).toBe(5);
        expect(license.trialReviewCreditsUsed).toBe(0);
        expect(license.trialCreditTier).toBe(TrialCreditTier.BASE);
        expect(Array.isArray(license.trialUnlocks)).toBe(true);
    });
});

describe("OrganizationLicenseService.recalculateTrialUnlocks", () => {
    beforeEach(() => txRepo.findOne.mockReset());

    it("leaves a LEGACY trial (null credits) unlimited — unlock signals never coerce null to a number", async () => {
        const lic = {
            subscriptionStatus: SubscriptionStatus.TRIAL,
            planType: "teams_byok",
            trialEnd: futureTrialEnd(),
            trialReviewCreditsTotal: null,
            trialReviewCreditsUsed: null,
            trialReviewCreditsRemaining: null,
            trialUnlocks: [],
            trialReviewCreditUsageKeys: [],
        };
        txRepo.findOne.mockResolvedValue(lic);

        const r = await OrganizationLicenseService.recalculateTrialUnlocks(
            "org",
            "team",
            {
                companyEmailVerified: true,
                workspaceMembersCount: 5,
                codeHostMembersCount: 20,
            },
        );

        // The legacy NULL marker must survive — no credits assigned, no save.
        expect(r.trialReviewCreditsTotal ?? null).toBeNull();
        expect(lic.trialReviewCreditsTotal).toBeNull();
        expect(txRepo.save).not.toHaveBeenCalled();
    });
});
