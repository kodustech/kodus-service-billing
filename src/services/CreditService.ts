import { In, LessThan, QueryFailedError } from "typeorm";

import { AppDataSource } from "../config/database";
import { clearCacheByPrefix } from "../config/utils/cache";
import {
  CREDIT_PACKS_USD,
  CREDITS_LOW_THRESHOLD_USD,
  CREDITS_MARKUP_PCT,
  CREDITS_MAX_PURCHASE_USD,
  CREDITS_MIN_PURCHASE_USD,
  chargeForCredit,
  roundUsd,
} from "../config/creditPricing";
import {
  CreditLedgerEntry,
  CreditLedgerEntryType,
} from "../entities/CreditLedgerEntry";
import { OrganizationLicense } from "../entities/OrganizationLicense";
import { CreditLedgerRepository } from "../repositories/CreditLedgerRepository";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { KodusNotificationClient } from "./KodusNotificationClient";
import {
  AutoTopUpService,
  decideAutoTopUp,
  type AutoTopUpState,
} from "./AutoTopUpService";

/** Postgres unique-violation SQLSTATE — the ledger's idempotency signal. */
const UNIQUE_VIOLATION = "23505";

/** `beforeId` arrives straight from the query string; an unvalidated value
 *  makes Postgres raise 22P02 on the uuid comparison, i.e. a 500 for what is
 *  really just a malformed cursor. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Built once: the ledger filter validates caller-supplied types against it. */
const LEDGER_ENTRY_TYPES: ReadonlySet<string> = new Set(
  Object.values(CreditLedgerEntryType) as string[],
);

export type DebitEntryInput = {
  /** Idempotency key (a telemetry span id). Unique per organization. */
  usageKey: string;
  /** List-price cost of the usage, in USD (positive). */
  amountUsd: number;
  metadata?: Record<string, unknown>;
};

export type DebitResult = {
  applied: number;
  skipped: number;
  appliedUsd: number;
  balanceUsd: number;
  lowBalance: boolean;
  exhausted: boolean;
};

export type CreditBalance = {
  balanceUsd: number;
  lowThresholdUsd: number;
  markupPct: number;
  packsUsd: number[];
  minPurchaseUsd: number;
  maxPurchaseUsd: number;
  lifetimePurchasedUsd: number;
  lifetimeDebitedUsd: number;
  lastPurchaseAt: string | null;
  autoTopUp: AutoTopUpState;
};

type NotifyDecision = {
  lowBalance: boolean;
  exhausted: boolean;
  /** Which webhook to send, if any. Exhausted supersedes low. */
  send: "exhausted" | "low" | null;
};

/**
 * The prepaid-credit ledger ("Kodus as the provider").
 *
 * Money truth lives here: an append-only `credit_ledger_entries` table plus a
 * denormalized `creditBalanceUsd` on the license, both changed inside ONE
 * transaction under a `pessimistic_write` lock on the license row — the same
 * shape `consumeTrialReviewCredit` uses, so concurrent debits serialize and
 * the balance can never be updated from a stale read.
 *
 * Idempotency is enforced by the DB, not by scanning: UNIQUE (organizationId,
 * usageKey). A duplicate insert raises 23505 and is counted as `skipped`.
 */
export class CreditService {
  /** Validate a purchase amount: a listed pack, or a custom amount in bounds. */
  static validatePurchaseAmount(amountUsd: unknown): number | null {
    const n = Number(amountUsd);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n * 100) / 100;
    if (CREDIT_PACKS_USD.includes(rounded)) return rounded;
    if (rounded < CREDITS_MIN_PURCHASE_USD) return null;
    if (rounded > CREDITS_MAX_PURCHASE_USD) return null;
    return rounded;
  }

  static async getBalance(
    organizationId: string,
    teamId?: string,
  ): Promise<CreditBalance | null> {
    const license = await OrganizationLicenseRepository.findOne({
      where: teamId ? { organizationId, teamId } : { organizationId },
    });
    if (!license) return null;

    // Totals scoped like the balance row: the org's ledger, narrowed to
    // the team when the caller asked for a team's license.
    const totalsQb = CreditLedgerRepository.createQueryBuilder("e")
      .select("e.type", "type")
      .addSelect("COALESCE(SUM(e.amountUsd), 0)", "sum")
      .addSelect("MAX(e.createdAt)", "last")
      .where("e.organizationId = :organizationId", { organizationId });
    if (teamId) {
      totalsQb.andWhere("e.teamId = :teamId", { teamId });
    }
    const totals = await totalsQb
      .groupBy("e.type")
      .getRawMany<{ type: string; sum: string; last: Date | null }>();

    const byType = new Map(totals.map((t) => [t.type, t]));
    const purchased = Number(
      byType.get(CreditLedgerEntryType.PURCHASE)?.sum ?? 0,
    );
    const debited = -Number(byType.get(CreditLedgerEntryType.DEBIT)?.sum ?? 0);
    const lastPurchase =
      byType.get(CreditLedgerEntryType.PURCHASE)?.last ?? null;

    return {
      balanceUsd: roundUsd(license.creditBalanceUsd ?? 0),
      lowThresholdUsd: CREDITS_LOW_THRESHOLD_USD,
      markupPct: CREDITS_MARKUP_PCT,
      packsUsd: CREDIT_PACKS_USD,
      minPurchaseUsd: CREDITS_MIN_PURCHASE_USD,
      maxPurchaseUsd: CREDITS_MAX_PURCHASE_USD,
      lifetimePurchasedUsd: roundUsd(purchased),
      lifetimeDebitedUsd: roundUsd(debited),
      lastPurchaseAt: lastPurchase
        ? new Date(lastPurchase).toISOString()
        : null,
      autoTopUp: AutoTopUpService.stateOf(license),
    };
  }

  /**
   * Newest first. `types` is pushed into the query (a filtered page is a
   * full page, not "the matching rows among the newest N"). The cursor is
   * `(createdAt, id)`: every row of one debit batch shares `createdAt`
   * (transaction-stable `now()`), so a date-only cursor would drop the rest
   * of a batch once a page ends inside it. Pass the last row's `createdAt`
   * AND `id` as `before` / `beforeId` to continue.
   */
  static async listLedger(
    organizationId: string,
    options: {
      limit?: number;
      before?: Date;
      beforeId?: string;
      types?: string[];
    } = {},
  ): Promise<CreditLedgerEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const validTypes = (options.types ?? []).filter((t) =>
      LEDGER_ENTRY_TYPES.has(t),
    );
    const qb = CreditLedgerRepository.createQueryBuilder("e")
      .where("e.organizationId = :organizationId", { organizationId })
      .orderBy("e.createdAt", "DESC")
      .addOrderBy("e.id", "DESC")
      .take(limit);
    if (validTypes.length > 0) {
      qb.andWhere({ type: In(validTypes) });
    }
    // `createdAt` is a MICROSECOND timestamp in Postgres, and every row of one
    // debit batch shares it (transaction-stable `now()`). A cursor that passes
    // through JavaScript loses that precision — the driver parses a
    // `timestamp` into a Date, which is milliseconds — so the comparison would
    // run against a value strictly SMALLER than the row's real one: `<
    // :before` drops the rest of the batch and `= :before` matches nothing.
    // Reading the row first does NOT fix that; the truncation only moves.
    //
    // So the timestamp never leaves the database: the keyset comparison is a
    // row-value against a subquery, resolved inside Postgres, and only the
    // cursor's id crosses the wire.
    const cursorId =
      options.beforeId && UUID_RE.test(options.beforeId)
        ? options.beforeId
        : undefined;

    // Does that row exist, and belong to this org? Asked with `SELECT 1`, so
    // again no timestamp is materialised. (An unvalidated id would also make
    // Postgres raise 22P02 on the uuid comparison — a 500 for a malformed
    // cursor.)
    const cursorExists = cursorId
      ? !!(await CreditLedgerRepository.createQueryBuilder("c")
          .select("1", "present")
          .where("c.id = :cursorId", { cursorId })
          .andWhere("c.organizationId = :organizationId", { organizationId })
          .getRawOne())
      : false;

    if (cursorExists) {
      qb.andWhere(
        `(e."createdAt", e."id") < (SELECT c2."createdAt", c2."id" ` +
          `FROM ${CreditLedgerRepository.metadata.tablePath} c2 ` +
          `WHERE c2."id" = :cursorId AND c2."organizationId" = :organizationId)`,
        { cursorId, organizationId },
      );
    } else if (options.before) {
      // No usable cursor id (absent, malformed, another org's, deleted): the
      // timestamp alone, which is the best that value can offer.
      qb.andWhere({ createdAt: LessThan(options.before) });
    }
    return qb.getMany();
  }

  /**
   * Credit the org after a paid checkout. Idempotent on `usageKey` (the
   * Stripe checkout-session id): a redelivered webhook is a no-op.
   */
  static async applyPurchase(input: {
    organizationId: string;
    teamId?: string;
    creditUsd: number;
    usageKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ applied: boolean; balanceUsd: number }> {
    const creditUsd = roundUsd(input.creditUsd);
    if (!(creditUsd > 0)) {
      throw new Error("creditUsd must be positive");
    }

    const outcome = await AppDataSource.transaction(async (manager) => {
      const licenses = manager.getRepository(OrganizationLicense);
      const ledger = manager.getRepository(CreditLedgerEntry);

      const license = await licenses.findOne({
        where: input.teamId
          ? {
              organizationId: input.organizationId,
              teamId: input.teamId,
            }
          : { organizationId: input.organizationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!license) {
        throw new Error("LICENSE_NOT_FOUND");
      }

      const balanceAfter = roundUsd(
        (license.creditBalanceUsd ?? 0) + creditUsd,
      );
      try {
        await ledger.insert({
          organizationId: input.organizationId,
          teamId: input.teamId ?? license.teamId,
          type: CreditLedgerEntryType.PURCHASE,
          amountUsd: creditUsd,
          balanceAfterUsd: balanceAfter,
          usageKey: input.usageKey,
          metadata: input.metadata ?? {},
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return {
            applied: false,
            balanceUsd: roundUsd(license.creditBalanceUsd ?? 0),
            license: null,
          };
        }
        throw error;
      }

      license.creditBalanceUsd = balanceAfter;
      // A top-up re-arms the one-shot notifications once the balance is
      // back above the threshold, so the next dip alerts again.
      if (balanceAfter > CREDITS_LOW_THRESHOLD_USD) {
        license.creditsLowNotifiedAt = null;
      }
      if (balanceAfter > 0) {
        license.creditsExhaustedNotifiedAt = null;
      }
      await licenses.save(license);

      return { applied: true, balanceUsd: balanceAfter, license };
    });

    clearCacheByPrefix("org-license");

    if (outcome.applied && outcome.license) {
      KodusNotificationClient.notifyCreditsPurchased({
        organizationId: outcome.license.organizationId,
        teamId: outcome.license.teamId,
        creditUsd,
        balanceUsd: outcome.balanceUsd,
      }).catch(() => {
        /* client swallows internally; defense-in-depth only */
      });
    }

    return { applied: outcome.applied, balanceUsd: outcome.balanceUsd };
  }

  /**
   * Debit metered usage. Entries are applied one by one inside a single
   * locked transaction; a duplicate `usageKey` is skipped (23505), never
   * re-charged. The balance MAY go negative — usage already happened; the
   * API's pre-review gate is what stops the next one.
   */
  static async debit(input: {
    organizationId: string;
    teamId?: string;
    entries: DebitEntryInput[];
  }): Promise<DebitResult> {
    const entries = (input.entries ?? []).filter(
      (e) =>
        e &&
        typeof e.usageKey === "string" &&
        e.usageKey.length > 0 &&
        Number.isFinite(Number(e.amountUsd)) &&
        Number(e.amountUsd) >= 0,
    );

    const outcome = await AppDataSource.transaction(async (manager) => {
      const licenses = manager.getRepository(OrganizationLicense);
      const ledger = manager.getRepository(CreditLedgerEntry);

      const license = await licenses.findOne({
        where: input.teamId
          ? {
              organizationId: input.organizationId,
              teamId: input.teamId,
            }
          : { organizationId: input.organizationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!license) {
        throw new Error("LICENSE_NOT_FOUND");
      }

      let balance = roundUsd(license.creditBalanceUsd ?? 0);
      let applied = 0;
      let skipped = 0;
      let appliedUsd = 0;

      for (const entry of entries) {
        const amount = roundUsd(Number(entry.amountUsd));
        const balanceAfter = roundUsd(balance - amount);
        try {
          // A savepoint per row so ONE duplicate does not poison the
          // whole transaction (Postgres aborts the tx on any error).
          await manager.query("SAVEPOINT credit_debit_row");
          await ledger.insert({
            organizationId: input.organizationId,
            teamId: input.teamId ?? license.teamId,
            type: CreditLedgerEntryType.DEBIT,
            amountUsd: -amount,
            balanceAfterUsd: balanceAfter,
            usageKey: entry.usageKey,
            metadata: entry.metadata ?? {},
          });
          await manager.query("RELEASE SAVEPOINT credit_debit_row");
          balance = balanceAfter;
          applied += 1;
          appliedUsd = roundUsd(appliedUsd + amount);
        } catch (error) {
          await manager.query("ROLLBACK TO SAVEPOINT credit_debit_row");
          if (isUniqueViolation(error)) {
            skipped += 1;
            continue;
          }
          throw error;
        }
      }

      const decision = decideNotification(license, balance);
      const now = new Date();
      // Claim the auto top-up attempt under the row lock: the debit
      // that flips `creditAutoTopUpLastAt` is the only one that charges,
      // so two concurrent sweeps can never double-charge one dip.
      const autoTopUp = decideAutoTopUp(license, balance, now);
      if (autoTopUp) {
        license.creditAutoTopUpLastAt = now;
        // Mint the Stripe idempotency key HERE, under the lock, and only when
        // there is none in flight. A previous attempt whose outcome is unknown
        // (a timeout) left its key behind on purpose: reusing it is what stops
        // Stripe from charging a captured payment a second time.
        license.creditAutoTopUpAttemptKey =
          license.creditAutoTopUpAttemptKey ??
          `auto-topup:${license.id}:${now.getTime()}`;
      }
      if (applied > 0 || decision.send || autoTopUp) {
        license.creditBalanceUsd = balance;
        if (decision.send === "low") {
          license.creditsLowNotifiedAt = now;
        } else if (decision.send === "exhausted") {
          license.creditsExhaustedNotifiedAt = now;
          license.creditsLowNotifiedAt = license.creditsLowNotifiedAt ?? now;
        }
        await licenses.save(license);
      }

      return {
        license,
        balance,
        applied,
        skipped,
        appliedUsd,
        decision,
        autoTopUp,
      };
    });

    if (outcome.autoTopUp) {
      // Outside the transaction: a Stripe round-trip must not hold the
      // license row lock. Failures are recorded on the license.
      AutoTopUpService.charge(outcome.license.id).catch((err) =>
        console.error("Auto top-up crashed", err),
      );
    }

    if (outcome.applied > 0) {
      clearCacheByPrefix("org-license");
    }

    if (outcome.decision.send) {
      KodusNotificationClient.notifyCreditsLow({
        organizationId: outcome.license.organizationId,
        teamId: outcome.license.teamId,
        balanceUsd: outcome.balance,
        thresholdUsd: CREDITS_LOW_THRESHOLD_USD,
        exhausted: outcome.decision.send === "exhausted",
      }).catch(() => {
        /* client swallows internally; defense-in-depth only */
      });
    }

    return {
      applied: outcome.applied,
      skipped: outcome.skipped,
      appliedUsd: outcome.appliedUsd,
      balanceUsd: outcome.balance,
      lowBalance: outcome.decision.lowBalance,
      exhausted: outcome.decision.exhausted,
    };
  }

  /**
   * Manual, signed adjustment by Kodus (goodwill, correction, a seeded test
   * balance). Same transaction shape as a purchase; idempotent on
   * `usageKey` so a retried admin call cannot double-apply. Re-arms the
   * one-shot notifications like a purchase does when the balance recovers.
   */
  static async adjust(input: {
    organizationId: string;
    teamId?: string;
    amountUsd: number;
    usageKey: string;
    reason: string;
    actor?: string;
  }): Promise<{ applied: boolean; balanceUsd: number }> {
    const amount = roundUsd(Number(input.amountUsd));
    if (!Number.isFinite(amount) || amount === 0) {
      throw new Error("amountUsd must be a non-zero number");
    }

    const outcome = await AppDataSource.transaction(async (manager) => {
      const licenses = manager.getRepository(OrganizationLicense);
      const ledger = manager.getRepository(CreditLedgerEntry);

      const license = await licenses.findOne({
        where: input.teamId
          ? {
              organizationId: input.organizationId,
              teamId: input.teamId,
            }
          : { organizationId: input.organizationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!license) {
        throw new Error("LICENSE_NOT_FOUND");
      }

      const balanceAfter = roundUsd((license.creditBalanceUsd ?? 0) + amount);
      try {
        await ledger.insert({
          organizationId: input.organizationId,
          teamId: input.teamId ?? license.teamId,
          type: CreditLedgerEntryType.ADJUSTMENT,
          amountUsd: amount,
          balanceAfterUsd: balanceAfter,
          usageKey: input.usageKey,
          metadata: { reason: input.reason, actor: input.actor },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return {
            applied: false,
            balanceUsd: roundUsd(license.creditBalanceUsd ?? 0),
          };
        }
        throw error;
      }

      license.creditBalanceUsd = balanceAfter;
      if (balanceAfter > CREDITS_LOW_THRESHOLD_USD) {
        license.creditsLowNotifiedAt = null;
      }
      if (balanceAfter > 0) {
        license.creditsExhaustedNotifiedAt = null;
      }
      await licenses.save(license);
      return { applied: true, balanceUsd: balanceAfter };
    });

    clearCacheByPrefix("org-license");
    return outcome;
  }

  /** The Stripe charge (USD) for a credit amount — surfaced to the UI. */
  static quote(creditUsd: number): {
    creditUsd: number;
    chargeUsd: number;
    markupPct: number;
  } {
    return {
      creditUsd,
      chargeUsd: chargeForCredit(creditUsd),
      markupPct: CREDITS_MARKUP_PCT,
    };
  }
}

/** Exported for the spec: which one-shot notification a new balance triggers. */
export function decideNotification(
  license: Pick<
    OrganizationLicense,
    "creditsLowNotifiedAt" | "creditsExhaustedNotifiedAt"
  >,
  balance: number,
): NotifyDecision {
  const exhausted = balance <= 0;
  const lowBalance = balance <= CREDITS_LOW_THRESHOLD_USD;
  if (exhausted && !license.creditsExhaustedNotifiedAt) {
    return { lowBalance, exhausted, send: "exhausted" };
  }
  if (lowBalance && !exhausted && !license.creditsLowNotifiedAt) {
    return { lowBalance, exhausted, send: "low" };
  }
  return { lowBalance, exhausted, send: null };
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string; driverError?: { code?: string } })?.code ??
    (error as { driverError?: { code?: string } })?.driverError?.code;
  return (
    code === UNIQUE_VIOLATION ||
    (error instanceof QueryFailedError &&
      (error as unknown as { driverError?: { code?: string } }).driverError
        ?.code === UNIQUE_VIOLATION)
  );
}
