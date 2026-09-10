import { AppDataSource } from "../config/database";
import { clearCacheByPrefix } from "../config/utils/cache";
import {
    CREDITS_LOW_THRESHOLD_USD,
    chargeForCredit,
    roundUsd,
} from "../config/creditPricing";
import { OrganizationLicense } from "../entities/OrganizationLicense";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { CreditService } from "./CreditService";
import { KodusNotificationClient } from "./KodusNotificationClient";
import { StripeService } from "./StripeService";

/** A declined/failed card is retried at most once per this window, so a bad
 *  card cannot be hammered on every debit sweep (every 5 minutes). */
export const AUTO_TOP_UP_RETRY_MS = 60 * 60 * 1000;

/** What the UI sees. Never the raw Stripe ids. */
export type AutoTopUpState = {
    enabled: boolean;
    thresholdUsd: number | null;
    amountUsd: number | null;
    /** "Visa •••• 4242", or null when no card is saved. */
    paymentMethod: string | null;
    lastAt: string | null;
    /** Last charge failure (a declined card), cleared by the next success. */
    lastError: string | null;
};

export type AutoTopUpSettingsInput = {
    enabled: boolean;
    thresholdUsd?: number;
    amountUsd?: number;
};

type LicenseAutoTopUpFields = Pick<
    OrganizationLicense,
    | "creditAutoTopUpEnabled"
    | "creditAutoTopUpThresholdUsd"
    | "creditAutoTopUpAmountUsd"
    | "creditPaymentMethodId"
    | "creditAutoTopUpLastAt"
>;

/**
 * Whether a debit that left the balance at `balanceUsd` should trigger an
 * automatic charge. Pure, so the rule is testable: enabled, a card on file,
 * a threshold/amount configured, balance at or below the threshold, and no
 * attempt inside the retry window (success or failure — a success lifts the
 * balance, so the window only really bites on failures).
 */
export function decideAutoTopUp(
    license: LicenseAutoTopUpFields,
    balanceUsd: number,
    now: Date = new Date(),
): boolean {
    if (!license.creditAutoTopUpEnabled) return false;
    if (!license.creditPaymentMethodId) return false;
    const threshold = license.creditAutoTopUpThresholdUsd;
    const amount = license.creditAutoTopUpAmountUsd;
    if (typeof threshold !== "number" || typeof amount !== "number") {
        return false;
    }
    if (!(amount > 0)) return false;
    if (balanceUsd > threshold) return false;
    const last = license.creditAutoTopUpLastAt
        ? new Date(license.creditAutoTopUpLastAt).getTime()
        : 0;
    return now.getTime() - last >= AUTO_TOP_UP_RETRY_MS;
}

export class AutoTopUpService {
    static stateOf(license: OrganizationLicense): AutoTopUpState {
        return {
            enabled: !!license.creditAutoTopUpEnabled,
            thresholdUsd:
                typeof license.creditAutoTopUpThresholdUsd === "number"
                    ? roundUsd(license.creditAutoTopUpThresholdUsd)
                    : null,
            amountUsd:
                typeof license.creditAutoTopUpAmountUsd === "number"
                    ? roundUsd(license.creditAutoTopUpAmountUsd)
                    : null,
            paymentMethod: license.creditPaymentMethodLabel ?? null,
            lastAt: license.creditAutoTopUpLastAt
                ? new Date(license.creditAutoTopUpLastAt).toISOString()
                : null,
            lastError: license.creditAutoTopUpLastError ?? null,
        };
    }

    /**
     * Save the settings. Enabling requires a card on file (the UI sends the
     * customer through the setup Checkout first). Threshold defaults to the
     * low-balance threshold; amount must be a valid purchase amount.
     */
    static async updateSettings(
        organizationId: string,
        teamId: string | undefined,
        input: AutoTopUpSettingsInput,
    ): Promise<
        | { ok: true; state: AutoTopUpState }
        | { ok: false; code: "LICENSE_NOT_FOUND" | "NO_PAYMENT_METHOD" | "INVALID_AMOUNT" | "INVALID_THRESHOLD" }
    > {
        const license = await OrganizationLicenseRepository.findOne({
            where: teamId ? { organizationId, teamId } : { organizationId },
        });
        if (!license) return { ok: false, code: "LICENSE_NOT_FOUND" };

        if (input.enabled) {
            if (!license.creditPaymentMethodId) {
                return { ok: false, code: "NO_PAYMENT_METHOD" };
            }
            const amount = CreditService.validatePurchaseAmount(
                input.amountUsd ?? license.creditAutoTopUpAmountUsd,
            );
            if (amount === null) return { ok: false, code: "INVALID_AMOUNT" };
            const thresholdRaw =
                input.thresholdUsd ??
                license.creditAutoTopUpThresholdUsd ??
                CREDITS_LOW_THRESHOLD_USD;
            const threshold = Number(thresholdRaw);
            if (!Number.isFinite(threshold) || threshold < 0 || threshold > amount) {
                return { ok: false, code: "INVALID_THRESHOLD" };
            }
            license.creditAutoTopUpEnabled = true;
            license.creditAutoTopUpThresholdUsd = roundUsd(threshold);
            license.creditAutoTopUpAmountUsd = amount;
            // Re-arm: a fresh opt-in should fire on the next qualifying debit.
            license.creditAutoTopUpLastAt = null;
            license.creditAutoTopUpLastError = null;
        } else {
            license.creditAutoTopUpEnabled = false;
            if (typeof input.thresholdUsd === "number") {
                license.creditAutoTopUpThresholdUsd = roundUsd(input.thresholdUsd);
            }
            if (typeof input.amountUsd === "number") {
                const amount = CreditService.validatePurchaseAmount(input.amountUsd);
                if (amount !== null) license.creditAutoTopUpAmountUsd = amount;
            }
        }
        await OrganizationLicenseRepository.save(license);
        clearCacheByPrefix("org-license");
        return { ok: true, state: this.stateOf(license) };
    }

    /** Record the card Stripe saved (from a Checkout or a setup session). */
    static async attachPaymentMethod(
        license: OrganizationLicense,
        paymentMethodId: string,
        label: string | null,
    ): Promise<void> {
        license.creditPaymentMethodId = paymentMethodId;
        license.creditPaymentMethodLabel = label;
        license.creditAutoTopUpLastError = null;
        await OrganizationLicenseRepository.save(license);
        clearCacheByPrefix("org-license");
    }

    /** Forget the card. Auto top-up cannot run without one, so it turns off. */
    static async detachPaymentMethod(
        organizationId: string,
        teamId: string | undefined,
    ): Promise<AutoTopUpState | null> {
        const license = await OrganizationLicenseRepository.findOne({
            where: teamId ? { organizationId, teamId } : { organizationId },
        });
        if (!license) return null;
        const pm = license.creditPaymentMethodId;
        license.creditPaymentMethodId = null;
        license.creditPaymentMethodLabel = null;
        license.creditAutoTopUpEnabled = false;
        license.creditAutoTopUpLastError = null;
        await OrganizationLicenseRepository.save(license);
        clearCacheByPrefix("org-license");
        if (pm) {
            await StripeService.detachPaymentMethod(pm).catch((err) =>
                console.error("Auto top-up: could not detach card on Stripe", err),
            );
        }
        return this.stateOf(license);
    }

    /**
     * Charge the saved card and credit the ledger. Called AFTER the debit
     * transaction that claimed the attempt (it stamped `creditAutoTopUpLastAt`
     * under the row lock), so this never runs twice for one dip. Idempotent
     * on the PaymentIntent id, like a Checkout purchase is on its session id.
     */
    static async charge(licenseId: string): Promise<
        | { charged: true; creditUsd: number; balanceUsd: number }
        | { charged: false; reason: string }
    > {
        const license = await OrganizationLicenseRepository.findOne({
            where: { id: licenseId },
        });
        if (!license) return { charged: false, reason: "LICENSE_NOT_FOUND" };
        const amount = license.creditAutoTopUpAmountUsd;
        const pm = license.creditPaymentMethodId;
        if (!license.creditAutoTopUpEnabled || !pm || !amount) {
            return { charged: false, reason: "NOT_CONFIGURED" };
        }

        const creditUsd = roundUsd(amount);
        const chargeUsd = chargeForCredit(creditUsd);
        // The debit that claimed this attempt stamped `creditAutoTopUpLastAt`
        // under the row lock; keyed on it, a retry of the same attempt (a
        // Stripe timeout after the charge went through) gets the same
        // PaymentIntent back — never a second charge.
        const attemptAt = license.creditAutoTopUpLastAt
            ? new Date(license.creditAutoTopUpLastAt).getTime()
            : Date.now();
        const idempotencyKey = `auto-topup:${license.id}:${attemptAt}`;
        try {
            const intent = await StripeService.chargeSavedPaymentMethod({
                license,
                paymentMethodId: pm,
                chargeUsd,
                creditUsd,
                idempotencyKey,
            });
            if (intent.status !== "succeeded") {
                throw new Error(`payment_intent ${intent.id} is ${intent.status}`);
            }
            const applied = await CreditService.applyPurchase({
                organizationId: license.organizationId,
                teamId: license.teamId,
                creditUsd,
                usageKey: `stripe:pi:${intent.id}`,
                metadata: {
                    auto: true,
                    stripePaymentIntentId: intent.id,
                    chargeUsd,
                    paymentMethod: license.creditPaymentMethodLabel,
                },
            });
            await AppDataSource.getRepository(OrganizationLicense).update(
                { id: license.id },
                { creditAutoTopUpLastError: null },
            );
            clearCacheByPrefix("org-license");
            return { charged: true, creditUsd, balanceUsd: applied.balanceUsd };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            console.error(
                `Auto top-up failed for org ${license.organizationId}: ${message}`,
            );
            await AppDataSource.getRepository(OrganizationLicense).update(
                { id: license.id },
                { creditAutoTopUpLastError: message.slice(0, 250) },
            );
            clearCacheByPrefix("org-license");
            KodusNotificationClient.notifyCreditsLow({
                organizationId: license.organizationId,
                teamId: license.teamId,
                balanceUsd: roundUsd(license.creditBalanceUsd ?? 0),
                thresholdUsd: CREDITS_LOW_THRESHOLD_USD,
                exhausted: (license.creditBalanceUsd ?? 0) <= 0,
                autoTopUpError: message.slice(0, 250),
            }).catch(() => {
                /* client swallows internally */
            });
            return { charged: false, reason: message };
        }
    }
}
