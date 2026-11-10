import type { EntityManager } from "typeorm";
import { AppDataSource } from "../config/database";
import { roundUsd } from "../config/creditPricing";
import { CreditAutoTopUpReservation } from "../entities/CreditAutoTopUpReservation";
import {
  CreditLedgerEntry,
  CreditLedgerEntryType,
} from "../entities/CreditLedgerEntry";
import { OrganizationLicense } from "../entities/OrganizationLicense";

export function autoTopUpMonth(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export type AutoTopUpBudgetState = {
  monthlyLimitUsd: number | null;
  monthlyPurchasedUsd: number;
  monthlyReservedUsd: number;
  monthlyRemainingUsd: number | null;
  monthlyLimitReached: boolean;
  resetsAt: string;
};

export class AutoTopUpBudgetService {
  static async stateOf(
    license: OrganizationLicense,
    manager: EntityManager = AppDataSource.manager,
    now = new Date(),
  ): Promise<AutoTopUpBudgetState> {
    const { start, end } = autoTopUpMonth(now);
    const purchased = await manager
      .getRepository(CreditLedgerEntry)
      .createQueryBuilder("e")
      .select('COALESCE(SUM(e."amountUsd"), 0)', "total")
      .where('e."organizationId" = :org AND e."teamId" = :team', {
        org: license.organizationId,
        team: license.teamId,
      })
      .andWhere("e.type = :type", { type: CreditLedgerEntryType.PURCHASE })
      .andWhere("e.metadata ->> 'auto' = 'true'")
      .andWhere('e."createdAt" >= :start AND e."createdAt" < :end', {
        start: start.toISOString(),
        end: end.toISOString(),
      })
      .getRawOne<{ total: string }>();
    const reserved = await manager
      .getRepository(CreditAutoTopUpReservation)
      .createQueryBuilder("r")
      .select('COALESCE(SUM(r."creditUsd"), 0)', "total")
      .where('r."licenseId" = :id', { id: license.id })
      .getRawOne<{ total: string }>();
    const monthlyPurchasedUsd = roundUsd(Number(purchased?.total ?? 0));
    const monthlyReservedUsd = roundUsd(Number(reserved?.total ?? 0));
    const monthlyLimitUsd = license.creditAutoTopUpMonthlyLimitUsd ?? null;
    const monthlyRemainingUsd =
      monthlyLimitUsd === null
        ? null
        : Math.max(
            0,
            roundUsd(
              monthlyLimitUsd - monthlyPurchasedUsd - monthlyReservedUsd,
            ),
          );
    return {
      monthlyLimitUsd,
      monthlyPurchasedUsd,
      monthlyReservedUsd,
      monthlyRemainingUsd,
      monthlyLimitReached:
        monthlyRemainingUsd !== null &&
        monthlyRemainingUsd < (license.creditAutoTopUpAmountUsd ?? 0),
      resetsAt: end.toISOString(),
    };
  }

  /** Every caller serializes on the wallet row BEFORE checking capacity.
   * Reserve even for unlimited wallets: adding a cap during a pending charge
   * must account for that charge. Replays reuse their existing reservation. */
  static async reserve(
    licenseId: string,
    key: string,
    creditUsd: number,
  ): Promise<boolean> {
    return AppDataSource.transaction(async (manager) => {
      const license = await manager.getRepository(OrganizationLicense).findOne({
        where: { id: licenseId },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !license?.creditAutoTopUpEnabled ||
        license.creditAutoTopUpAttemptKey !== key
      )
        return false;
      const reservations = manager.getRepository(CreditAutoTopUpReservation);
      const existing = await reservations.findOneBy({ key, licenseId });
      if (existing) return existing.creditUsd === creditUsd;
      if (!Number.isFinite(creditUsd) || creditUsd <= 0) return false;
      const state = await this.stateOf(license, manager);
      if (
        state.monthlyRemainingUsd !== null &&
        creditUsd > state.monthlyRemainingUsd
      )
        return false;
      await reservations.insert({ key, licenseId, creditUsd });
      return true;
    });
  }

  static async release(
    licenseId: string,
    key: string,
    manager: EntityManager = AppDataSource.manager,
  ) {
    // Same lock order as reserve / purchase; never hold a DB lock over Stripe.
    await manager
      .getRepository(CreditAutoTopUpReservation)
      .delete({ key, licenseId });
  }
}
