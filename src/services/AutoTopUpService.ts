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

/**
 * Whether a failed charge reached a DEFINITIVE answer, i.e. one that says the
 * money did NOT move and never will for this attempt. Only then is it safe to
 * release the idempotency key and let the next dip mint a new one.
 *
 * Definitive: the card was declined (`card_error`), the request itself was
 * wrong (`invalid_request_error`), Stripe refused the key because it was
 * reused with different parameters (`idempotency_error` — nothing was
 * captured), or the PaymentIntent settled into a state that cannot capture
 * off-session (`requires_payment_method`, `requires_action`, `canceled`).
 *
 * NOT definitive: a timeout, a dropped connection, a Stripe 5xx, a rate
 * limit. There the charge may well have been captured with the response lost,
 * so the retry MUST reuse the key.
 */
export function isDefinitiveDecline(error: unknown): boolean {
  const { type, code } = (error ?? {}) as { type?: string; code?: string };
  if (type === "StripeCardError" || type === "card_error") return true;
  if (type === "StripeInvalidRequestError" || type === "invalid_request_error")
    return true;
  // Structured Stripe codes, never the human message: a decline is data.
  if (
    code &&
    [
      "card_declined",
      "expired_card",
      "incorrect_cvc",
      "insufficient_funds",
    ].includes(code)
  )
    return true;
  // Stripe refusing a key that was reused with DIFFERENT parameters captured
  // nothing: that key is dead and holding on to it would freeze auto top-up
  // for good.
  if (
    type === "StripeIdempotencyError" ||
    type === "idempotency_error" ||
    code === "idempotency_key_in_use"
  )
    return true;
  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();
  return (
    message.includes("requires_payment_method") ||
    message.includes("requires_action") ||
    message.includes("is canceled") ||
    message.includes("card_declined")
  );
}

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
    | {
        ok: false;
        code:
          | "LICENSE_NOT_FOUND"
          | "NO_PAYMENT_METHOD"
          | "INVALID_AMOUNT"
          | "INVALID_THRESHOLD";
      }
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
      // The AMOUNT is part of what an idempotency key covers, so a key held
      // over from an attempt with an unknown outcome cannot be reused after
      // this: Stripe would refuse it and auto top-up would stall for good.
      license.creditAutoTopUpAttemptKey = null;
    } else {
      license.creditAutoTopUpEnabled = false;
      license.creditAutoTopUpAttemptKey = null;
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
    // A different card is a different charge: any key still in flight is
    // unusable, so drop it rather than have Stripe refuse the next attempt.
    license.creditAutoTopUpAttemptKey = null;
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
    license.creditAutoTopUpAttemptKey = null;
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
  static async charge(
    licenseId: string,
  ): Promise<
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
    // The debit that claimed this attempt minted the idempotency key under
    // the row lock. It is REUSED across retries until the attempt reaches
    // a definitive outcome, which is the whole point: after a Stripe
    // timeout the card may already be captured, and a fresh key would
    // charge it again. No key means nothing claimed this attempt — a
    // caller bug, never a reason to invent one and charge.
    const idempotencyKey = license.creditAutoTopUpAttemptKey;
    if (!idempotencyKey) {
      console.error(
        `Auto top-up called for org ${license.organizationId} with no ` +
          `attempt key — the debit that claims the attempt mints it. ` +
          `Refusing to charge.`,
      );
      return { charged: false, reason: "NO_ATTEMPT_CLAIMED" };
    }
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
      // Definitive outcome: release the key so the NEXT dip mints a
      // fresh one.
      await AppDataSource.getRepository(OrganizationLicense).update(
        { id: license.id },
        { creditAutoTopUpLastError: null, creditAutoTopUpAttemptKey: null },
      );
      clearCacheByPrefix("org-license");
      return { charged: true, creditUsd, balanceUsd: applied.balanceUsd };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Auto top-up failed for org ${license.organizationId}: ${message}`,
      );
      // A card that SAID NO is a definitive answer: release the key, so
      // the next dip is a new charge attempt. Anything else (timeout,
      // network, Stripe 5xx) leaves the outcome unknown — keep the key so
      // the retry cannot double-charge a payment already captured.
      const definitive = isDefinitiveDecline(error);
      await AppDataSource.getRepository(OrganizationLicense).update(
        { id: license.id },
        {
          creditAutoTopUpLastError: message.slice(0, 250),
          ...(definitive ? { creditAutoTopUpAttemptKey: null } : {}),
        },
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
