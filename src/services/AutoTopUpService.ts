import type Stripe from "stripe";
import type { EntityManager } from "typeorm";

import { AppDataSource } from "../config/database";
import { clearCacheByPrefix } from "../config/utils/cache";
import {
  CREDITS_LOW_THRESHOLD_USD,
  CREDITS_MIN_PURCHASE_USD,
  chargeForCredit,
  roundUsd,
} from "../config/creditPricing";
import { OrganizationLicense } from "../entities/OrganizationLicense";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import {
  AutoTopUpBudgetService,
  type AutoTopUpBudgetState,
} from "./AutoTopUpBudgetService";
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
 * wrong (`invalid_request_error`), or the PaymentIntent settled into a state
 * that cannot capture off-session (`requires_payment_method`,
 * `requires_action`, `canceled`).
 *
 * An idempotency conflict is deliberately NOT here — see
 * `isIdempotencyConflict`.
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

/**
 * Stripe refusing a key because it was reused with DIFFERENT parameters.
 *
 * This says nothing about the earlier request's outcome — in fact it proves
 * that request reached Stripe, which is the case the key is held for. So it is
 * NOT a definitive decline: releasing the key here would let the next dip
 * capture a second PaymentIntent for a top-up that may already have been paid.
 *
 * Instead the attempt is PARKED: the key is kept, auto top-up is switched off
 * and the reason is recorded. Nothing silently re-charges, the customer sees
 * why, and re-enabling mints a fresh key — so it self-heals through the normal
 * UI instead of needing someone to touch the database.
 *
 * It should be unreachable: every path that changes the charge parameters
 * drops the key first. If it does fire, something changed them behind those
 * paths, and that is worth surfacing rather than guessing about.
 */
export function isIdempotencyConflict(error: unknown): boolean {
  const { type, code } = (error ?? {}) as { type?: string; code?: string };
  return (
    type === "StripeIdempotencyError" ||
    type === "idempotency_error" ||
    code === "idempotency_key_in_use"
  );
}

/**
 * Why auto top-up was switched off when its saved amount is no longer
 * purchasable (below the minimum, or not whole dollars, e.g. a config saved
 * when the minimum was US$10).
 */
export const autoTopUpInvalidAmountMessage = (amountUsd: number): string =>
  `Auto top-up was turned off: $${roundUsd(amountUsd)} is no longer a valid ` +
  `amount (whole dollars, minimum $${CREDITS_MIN_PURCHASE_USD}). Choose a ` +
  `new amount to turn it back on.`;

/** Why auto top-up was switched off when the customer's currency has no
 *  credit price. Shown to the customer, so no internal ids. */
export const autoTopUpCurrencyMessage = (currency: string): string =>
  `Auto top-up was turned off: credits can't be charged in ` +
  `${currency.toUpperCase()} yet. Contact support to keep topping up.`;

/**
 * The idempotency key a debit mints for a new auto top-up attempt. The `v2`
 * marks an attempt whose request is stored before it is sent
 * (`creditAutoTopUpAttemptRequest`); a key without it was claimed by the
 * version that priced every retry afresh, see `isPreStoredRequestKey`.
 */
export const autoTopUpAttemptKey = (licenseId: string, now: Date): string =>
  `auto-topup:v2:${licenseId}:${now.getTime()}`;

/** A key claimed before requests were stored: if it reached Stripe, it went
 *  out as `StripeService.legacyAutoTopUpRequest` builds it. */
export const isPreStoredRequestKey = (key: string): boolean =>
  !key.startsWith("auto-topup:v2:");

export const AUTO_TOP_UP_PARKED_MESSAGE =
  "Auto top-up was paused: a previous charge attempt is unresolved at the " +
  "payment provider. Contact support to resolve it before retrying.";

/** What the UI sees. Never the raw Stripe ids. */
export type AutoTopUpState = Partial<AutoTopUpBudgetState> & {
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
  /** Omitted preserves the saved cap, null removes it, zero pauses purchases. */
  monthlyLimitUsd?: number | null;
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
          | "INVALID_THRESHOLD"
          | "INVALID_MONTHLY_LIMIT";
      }
  > {
    const outcome = await AppDataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrganizationLicense);
      const license = await repo.findOne({
        where: teamId ? { organizationId, teamId } : { organizationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!license)
        return { ok: false as const, code: "LICENSE_NOT_FOUND" as const };
      if (input.monthlyLimitUsd !== undefined) {
        if (
          input.monthlyLimitUsd !== null &&
          (typeof input.monthlyLimitUsd !== "number" ||
            !Number.isSafeInteger(input.monthlyLimitUsd) ||
            input.monthlyLimitUsd < 0 ||
            input.monthlyLimitUsd > 99999999)
        ) {
          return { ok: false as const, code: "INVALID_MONTHLY_LIMIT" as const };
        }
        license.creditAutoTopUpMonthlyLimitUsd = input.monthlyLimitUsd;
      }

      const wasEnabled = !!license.creditAutoTopUpEnabled;
      // Read BEFORE the assignments below overwrite it.
      const previousAmount = license.creditAutoTopUpAmountUsd;
      const keepAttempt = await this.keepReservedAttempt(
        license,
        manager,
        input.amountUsd !== undefined && input.amountUsd !== previousAmount,
      );

      if (input.enabled) {
        if (!license.creditPaymentMethodId) {
          return { ok: false, code: "NO_PAYMENT_METHOD" } as const;
        }
        const amount = CreditService.validatePurchaseAmount(
          input.amountUsd ?? license.creditAutoTopUpAmountUsd,
        );
        if (amount === null)
          return { ok: false, code: "INVALID_AMOUNT" } as const;
        const thresholdRaw =
          input.thresholdUsd ??
          license.creditAutoTopUpThresholdUsd ??
          CREDITS_LOW_THRESHOLD_USD;
        const threshold = Number(thresholdRaw);
        if (
          !Number.isFinite(threshold) ||
          threshold < 0 ||
          threshold > amount
        ) {
          return { ok: false, code: "INVALID_THRESHOLD" } as const;
        }
        license.creditAutoTopUpEnabled = true;
        license.creditAutoTopUpThresholdUsd = roundUsd(threshold);
        license.creditAutoTopUpAmountUsd = amount;
        // Re-arm: a fresh opt-in should fire on the next qualifying debit.
        license.creditAutoTopUpLastAt = null;
        license.creditAutoTopUpLastError = null;
        // Only unreserved attempts can be superseded. A reserved request is
        // already authorized and must resolve under its original key/params;
        // new settings apply to the next purchase.
        if (!keepAttempt && (amount !== previousAmount || !wasEnabled)) {
          license.creditAutoTopUpAttemptKey = null;
        }
      } else {
        license.creditAutoTopUpEnabled = false;
        // The key stays: turning the feature off does not resolve an attempt
        // that is already in flight, and the next enable clears it anyway.
        if (typeof input.thresholdUsd === "number") {
          license.creditAutoTopUpThresholdUsd = roundUsd(input.thresholdUsd);
        }
        if (typeof input.amountUsd === "number") {
          const amount = CreditService.validatePurchaseAmount(input.amountUsd);
          if (amount !== null) license.creditAutoTopUpAmountUsd = amount;
        }
      }
      await repo.save(license);
      return {
        ok: true as const,
        state: {
          ...this.stateOf(license),
          ...(await AutoTopUpBudgetService.stateOf(license, manager)),
        },
      };
    });
    if (outcome.ok) clearCacheByPrefix("org-license");
    return outcome;
  }

  /** Never orphan a reservation by rotating its key. A stored request can be
   * resolved verbatim after settings change; a legacy unknown request must
   * be resolved before its amount/card can be changed. */
  private static async keepReservedAttempt(
    license: OrganizationLicense,
    manager: EntityManager,
    changesCharge: boolean,
  ): Promise<boolean> {
    const pending = await AutoTopUpBudgetService.hasPending(
      license.id,
      license.creditAutoTopUpAttemptKey,
      manager,
    );
    if (
      pending &&
      changesCharge &&
      license.creditAutoTopUpAttemptRequest?.key !==
        license.creditAutoTopUpAttemptKey
    ) {
      throw new Error(
        "AUTO_TOP_UP_PENDING: resolve the previous charge before changing its amount or card",
      );
    }
    return pending;
  }

  /** Record the card Stripe saved (from a Checkout or a setup session). */
  static async attachPaymentMethod(
    license: OrganizationLicense,
    paymentMethodId: string,
    label: string | null,
  ): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrganizationLicense);
      const current = await repo.findOne({
        where: { id: license.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error("LICENSE_NOT_FOUND");
      const keepAttempt = await this.keepReservedAttempt(
        current,
        manager,
        current.creditPaymentMethodId !== paymentMethodId,
      );
      current.creditPaymentMethodId = paymentMethodId;
      current.creditPaymentMethodLabel = label;
      current.creditAutoTopUpLastError = null;
      if (!keepAttempt) current.creditAutoTopUpAttemptKey = null;
      await repo.save(current);
    });
    clearCacheByPrefix("org-license");
  }

  /** Forget the card. Auto top-up cannot run without one, so it turns off. */
  static async detachPaymentMethod(
    organizationId: string,
    teamId: string | undefined,
  ): Promise<AutoTopUpState | null> {
    const outcome = await AppDataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrganizationLicense);
      const license = await repo.findOne({
        where: teamId ? { organizationId, teamId } : { organizationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!license) return null;
      const keepAttempt = await this.keepReservedAttempt(
        license,
        manager,
        true,
      );
      const pm = license.creditPaymentMethodId;
      license.creditPaymentMethodId = null;
      license.creditPaymentMethodLabel = null;
      license.creditAutoTopUpEnabled = false;
      license.creditAutoTopUpLastError = null;
      if (!keepAttempt) license.creditAutoTopUpAttemptKey = null;
      await repo.save(license);
      return {
        pm,
        state: {
          ...this.stateOf(license),
          ...(await AutoTopUpBudgetService.stateOf(license, manager)),
        },
      };
    });
    if (!outcome) return null;
    clearCacheByPrefix("org-license");
    if (outcome.pm)
      await StripeService.detachPaymentMethod(outcome.pm).catch((error) =>
        console.error("Auto top-up: could not detach card on Stripe", {
          message:
            error instanceof Error ? error.message : "Unknown provider error",
        }),
      );
    return outcome.state;
  }

  /** A wallet stopped by its monthly cap may have no balance to run another
   * review, hence no new debit to trigger a refill. Sweep capped wallets so
   * month rollover (or raising a cap) does not require new paid usage first.
   * Empty debits use the SAME row lock / cooldown as normal usage. */
  private static resumeCursor: string | undefined;
  static async resumeCappedWallets(): Promise<void> {
    const cursor = this.resumeCursor;
    const query = await OrganizationLicenseRepository.createQueryBuilder("l")
      .where('l."creditAutoTopUpEnabled" = true')
      .andWhere('l."creditAutoTopUpMonthlyLimitUsd" > 0')
      .andWhere('l."creditPaymentMethodId" IS NOT NULL')
      .andWhere('l."creditBalanceUsd" <= l."creditAutoTopUpThresholdUsd"')
      .orderBy("l.id", "ASC")
      .take(100);
    if (cursor) query.andWhere("l.id > :cursor", { cursor });
    const candidates = await query.getMany();
    this.resumeCursor =
      candidates.length === 100
        ? candidates[candidates.length - 1].id
        : undefined;
    for (const license of candidates) {
      try {
        if (!decideAutoTopUp(license, license.creditBalanceUsd)) continue;
        const budget = await AutoTopUpBudgetService.stateOf(license);
        if (
          budget.monthlyRemainingUsd! < license.creditAutoTopUpAmountUsd! &&
          !(license.creditAutoTopUpAttemptKey && budget.monthlyReservedUsd > 0)
        )
          continue;
        await CreditService.debit({
          organizationId: license.organizationId,
          teamId: license.teamId,
          entries: [],
        });
      } catch (error) {
        console.error(`Auto top-up resume failed for license ${license.id}`, {
          message:
            error instanceof Error ? error.message : "Unknown sweep error",
        });
      }
    }
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

    // Stripe accepts a reused key only with IDENTICAL parameters. A retry
    // therefore replays the request stored for this key rather than pricing
    // it again: the Price, the markup or the customer's currency may have
    // moved since, and a refused key parks the attempt without crediting a
    // charge that may already be captured. A key claimed before requests
    // were stored is replayed as that version sent it.
    const stored = license.creditAutoTopUpAttemptRequest;
    let prepare: () => Promise<Stripe.PaymentIntentCreateParams>;
    if (stored?.key === idempotencyKey) {
      prepare = async () => stored.params;
    } else if (isPreStoredRequestKey(idempotencyKey)) {
      const creditUsd = roundUsd(amount);
      prepare = () =>
        StripeService.legacyAutoTopUpRequest({
          license,
          paymentMethodId: pm,
          creditUsd,
          chargeUsd: chargeForCredit(creditUsd),
        });
    } else {
      // A saved amount that is no longer purchasable (a config from before
      // the US$15 minimum, or a fractional one) is never bumped to the
      // minimum: an off-session charge must not exceed what the customer
      // agreed to. Auto top-up is switched off with the reason, once, rather
      // than re-claimed and re-notified every hour; re-enabling needs a valid
      // amount (updateSettings).
      const creditUsd = CreditService.validatePurchaseAmount(amount);
      if (creditUsd === null) {
        console.error(
          `Auto top-up turned off for org ${license.organizationId}: amount ` +
            `${amount} is not a valid purchase amount`,
        );
        await this.stopBeforeStripe(
          license,
          idempotencyKey,
          autoTopUpInvalidAmountMessage(amount),
        );
        return { charged: false, reason: "INVALID_AMOUNT" };
      }
      prepare = () =>
        StripeService.autoTopUpRequest({
          license,
          paymentMethodId: pm,
          chargeUsd: chargeForCredit(creditUsd),
          creditUsd,
        });
    }

    try {
      const request = await prepare();
      if (stored?.key !== idempotencyKey) {
        // Stored BEFORE it is sent, so a timeout leaves the exact request
        // behind for the retry. Only while this attempt still holds the
        // key: a settings change that dropped it means the attempt is over.
        const written = await AppDataSource.getRepository(
          OrganizationLicense,
        ).update(
          { id: license.id, creditAutoTopUpAttemptKey: idempotencyKey },
          {
            creditAutoTopUpAttemptRequest: {
              key: idempotencyKey,
              params: request,
            },
          },
        );
        if (written?.affected === 0) {
          return { charged: false, reason: "ATTEMPT_SUPERSEDED" };
        }
      }
      // What this attempt buys comes from its own request, not from the
      // settings now: a replay credits what was charged.
      const creditUsd = Number(request.metadata?.creditUsd);
      const chargeUsd = Number(request.metadata?.chargeUsd);
      if (
        !(await AutoTopUpBudgetService.reserve(
          license.id,
          idempotencyKey,
          creditUsd,
        ))
      ) {
        return {
          charged: false,
          reason: "MONTHLY_LIMIT_REACHED_OR_ATTEMPT_SUPERSEDED",
        };
      }
      const intent = await StripeService.createAutoTopUpIntent(
        request,
        idempotencyKey,
      );
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
          autoTopUpAttemptKey: idempotencyKey,
          stripePaymentIntentId: intent.id,
          chargeUsd,
          // What was actually charged, in minor units of `currency`.
          amountMinor: intent.amount,
          currency: intent.currency,
          paymentMethod: license.creditPaymentMethodLabel,
        },
      });
      // Also clean up a replay whose purchase was already credited before a
      // process interruption. applyPurchase releases atomically on first insert.
      await AutoTopUpBudgetService.release(license.id, idempotencyKey);
      // Definitive outcome: release the key so the NEXT dip mints a
      // fresh one.
      await AppDataSource.getRepository(OrganizationLicense).update(
        { id: license.id, creditAutoTopUpAttemptKey: idempotencyKey },
        {
          creditAutoTopUpLastError: null,
          creditAutoTopUpAttemptKey: null,
          creditAutoTopUpAttemptRequest: null,
        },
      );
      clearCacheByPrefix("org-license");
      return { charged: true, creditUsd, balanceUsd: applied.balanceUsd };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Auto top-up failed for org ${license.organizationId}: ${message}`,
      );
      // Raised while pricing a NEW attempt, before anything is sent to
      // Stripe (a replayed request is never re-priced). Kept as plain
      // failures, the attempt would be re-claimed and fail the same way
      // every hour.
      const code = (error as { code?: string } | null)?.code;
      if (code === "CREDIT_CURRENCY_NOT_SUPPORTED") {
        const currency = (error as { currency?: string }).currency ?? "";
        await this.stopBeforeStripe(
          license,
          idempotencyKey,
          autoTopUpCurrencyMessage(currency),
        );
        return { charged: false, reason: code };
      }
      if (code === "CREDITS_PRICE_NOT_CONFIGURED") {
        // Our deploy, not the customer's settings: nothing to tell them.
        // The key is released and auto top-up stays on, so it resumes by
        // itself once the Price id is set (the boot log already warns).
        await AppDataSource.getRepository(OrganizationLicense).update(
          { id: license.id, creditAutoTopUpAttemptKey: idempotencyKey },
          {
            creditAutoTopUpAttemptKey: null,
            creditAutoTopUpAttemptRequest: null,
          },
        );
        clearCacheByPrefix("org-license");
        return { charged: false, reason: code };
      }
      // An idempotency conflict is the one failure where retrying is the
      // dangerous move: the key is registered at Stripe, so the earlier
      // request got there, and its outcome is unknown. PARK it — keep the
      // key, switch auto top-up off, say why — instead of charging again.
      // A reserved attempt stays under its original key on re-enable; a
      // genuine parameter conflict requires reconciliation by support.
      const parked = isIdempotencyConflict(error);
      // A card that SAID NO is a definitive answer: release the key, so the
      // next dip is a new charge attempt. Anything else (timeout, network,
      // Stripe 5xx) leaves the outcome unknown — keep the key so the retry
      // cannot double-charge a payment already captured.
      const definitive = !parked && isDefinitiveDecline(error);
      if (definitive) {
        await AutoTopUpBudgetService.release(license.id, idempotencyKey);
      }
      const reportedError = parked
        ? AUTO_TOP_UP_PARKED_MESSAGE
        : message.slice(0, 250);
      await AppDataSource.getRepository(OrganizationLicense).update(
        { id: license.id, creditAutoTopUpAttemptKey: idempotencyKey },
        {
          creditAutoTopUpLastError: reportedError,
          ...(definitive
            ? {
                creditAutoTopUpAttemptKey: null,
                creditAutoTopUpAttemptRequest: null,
              }
            : {}),
          ...(parked ? { creditAutoTopUpEnabled: false } : {}),
        },
      );
      clearCacheByPrefix("org-license");
      this.notifyFailure(license, reportedError);
      return {
        charged: false,
        reason: parked ? "PARKED_IDEMPOTENCY_CONFLICT" : message,
      };
    }
  }

  /**
   * Switch auto top-up off for a reason only the customer can fix, and tell
   * them once. Only for an attempt that never reached Stripe — a new one,
   * with no request stored under its key — so the key is released too.
   * Scoped to that key: a re-enable or a new card saved while the attempt
   * was being priced already dropped it, and must not be switched back off.
   */
  private static async stopBeforeStripe(
    license: OrganizationLicense,
    idempotencyKey: string,
    reportedError: string,
  ): Promise<void> {
    const written = await AppDataSource.getRepository(
      OrganizationLicense,
    ).update(
      { id: license.id, creditAutoTopUpAttemptKey: idempotencyKey },
      {
        creditAutoTopUpEnabled: false,
        creditAutoTopUpLastError: reportedError,
        creditAutoTopUpAttemptKey: null,
        creditAutoTopUpAttemptRequest: null,
      },
    );
    clearCacheByPrefix("org-license");
    if (written?.affected === 0) return;
    this.notifyFailure(license, reportedError);
  }

  /** Tell the customer an auto top-up did not happen, and why. */
  private static notifyFailure(
    license: OrganizationLicense,
    reportedError: string,
  ): void {
    KodusNotificationClient.notifyCreditsLow({
      organizationId: license.organizationId,
      teamId: license.teamId,
      balanceUsd: roundUsd(license.creditBalanceUsd ?? 0),
      thresholdUsd: CREDITS_LOW_THRESHOLD_USD,
      exhausted: (license.creditBalanceUsd ?? 0) <= 0,
      autoTopUpError: reportedError,
    }).catch(() => {
      /* client swallows internally */
    });
  }
}
