import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

import { numericTransformer } from "./CreditLedgerEntry";

export enum SubscriptionStatus {
  TRIAL = "trial",
  ACTIVE = "active",
  PAYMENT_FAILED = "payment_failed",
  CANCELED = "canceled",
  EXPIRED = "expired",
}

export enum PlanType {
  FREE_BYOK = "free_byok",
  TEAMS_BYOK = "teams_byok",
  TEAMS_BYOK_ANNUAL = "teams_byok_annual",
  TEAMS_MANAGED = "teams_managed",
  TEAMS_MANAGED_ANNUAL = "teams_managed_annual",
  TEAMS_MANAGED_LEGACY = "teams_managed_legacy",
  ENTERPRISE_BYOK = "enterprise_byok",
  ENTERPRISE_BYOK_ANNUAL = "enterprise_byok_annual",
  ENTERPRISE_MANAGED = "enterprise_managed",
  ENTERPRISE_MANAGED_ANNUAL = "enterprise_managed_annual",
}

export enum TrialCreditTier {
  BASE = "base",
  TEAM_SIGNAL = "team_signal",
  QUALIFIED = "qualified",
  MANUAL = "manual",
}

export enum TrialUnlockStatus {
  LOCKED = "locked",
  AVAILABLE = "available",
  COMPLETED = "completed",
  CLAIMED = "claimed",
}

export type TrialUnlock = {
  key: string;
  status: TrialUnlockStatus | string;
  rewardCredits?: number;
  title?: string;
  description?: string;
  completedAt?: string;
};

@Entity("organization_licenses")
@Index("IDX_org_licenses_orgid_teamid", ["organizationId", "teamId"])
@Index("IDX_org_licenses_organizationid", ["organizationId"])
@Index("IDX_org_licenses_subscription_status", ["subscriptionStatus"])
@Index("IDX_org_licenses_status_trialend", ["subscriptionStatus", "trialEnd"])
@Index("IDX_org_licenses_stripe_customer_id", ["stripeCustomerId"])
@Index("IDX_org_licenses_stripe_subscription_id", ["stripeSubscriptionId"])
export class OrganizationLicense {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  organizationId: string;

  @Column()
  teamId: string;

  @Column({
    type: "enum",
    enum: SubscriptionStatus,
    default: SubscriptionStatus.TRIAL,
  })
  subscriptionStatus: SubscriptionStatus;

  @Column({
    type: "enum",
    enum: PlanType,
    default: PlanType.TEAMS_MANAGED_LEGACY,
  })
  planType: PlanType;

  @Column({ type: "timestamp", nullable: true })
  trialEnd: Date;

  // Nullable on purpose: a NULL total marks a "legacy" trial (created before
  // the credit model) that must keep unlimited reviews. New trials get these
  // set explicitly in createTrialLicense.
  @Column({ type: "integer", nullable: true })
  trialReviewCreditsTotal: number | null;

  @Column({ type: "integer", nullable: true })
  trialReviewCreditsUsed: number | null;

  @Column({ type: "integer", nullable: true })
  trialReviewCreditsRemaining: number | null;

  @Column({ nullable: true })
  trialCreditTier?: string;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  trialUnlocks: TrialUnlock[];

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  trialReviewCreditUsageKeys: string[];

  // Prepaid credits ("Kodus as the provider"). The balance is denormalized
  // from credit_ledger_entries and only ever changes inside the same
  // transaction that appends a ledger row, under a row lock. May go negative:
  // usage is metered after the fact, so a running review can overshoot; the
  // gate on the API side blocks the NEXT review, not the one in flight.
  @Column({
    type: "numeric",
    precision: 14,
    scale: 6,
    default: 0,
    transformer: numericTransformer,
  })
  creditBalanceUsd: number;

  // One notification per crossing: set when the low-balance / exhausted
  // webhook fires, cleared by the next purchase that lifts the balance back.
  @Column({ type: "timestamp", nullable: true })
  creditsLowNotifiedAt: Date | null;

  @Column({ type: "timestamp", nullable: true })
  creditsExhaustedNotifiedAt: Date | null;

  // Auto top-up: when the balance dips to `threshold`, charge the saved card
  // for `amount` of credit (plus markup) without the customer in the loop.
  // The card is the one Stripe saved on the last Checkout (off_session) or an
  // explicit setup session. `lastAt` is set inside the debit transaction that
  // decides to attempt, so concurrent debits cannot double-charge; `lastError`
  // surfaces a declined card in the UI.
  @Column({ type: "boolean", default: false })
  creditAutoTopUpEnabled: boolean;

  @Column({
    type: "numeric",
    precision: 14,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  creditAutoTopUpThresholdUsd: number | null;

  @Column({
    type: "numeric",
    precision: 14,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  creditAutoTopUpAmountUsd: number | null;

  @Column({ type: "varchar", nullable: true })
  creditPaymentMethodId: string | null;

  @Column({ type: "varchar", nullable: true })
  creditPaymentMethodLabel: string | null;

  @Column({ type: "timestamp", nullable: true })
  creditAutoTopUpLastAt: Date | null;

  @Column({ type: "varchar", nullable: true })
  creditAutoTopUpLastError: string | null;

  @Column({ nullable: true })
  stripeCustomerId?: string;

  @Column({ nullable: true })
  stripeSubscriptionId?: string;

  @Column({ default: 0 })
  totalLicenses: number;

  @Column({ default: 0 })
  assignedLicenses: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
