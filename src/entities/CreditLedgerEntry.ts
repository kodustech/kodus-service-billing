import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ValueTransformer,
} from "typeorm";

/**
 * Postgres `numeric` comes back from the driver as a string; the app works in
 * plain numbers (USD with 6 decimals). Shared by every money column.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) =>
    value === null || value === undefined ? value : Number(value),
};

export enum CreditLedgerEntryType {
  /** Money in — a Stripe checkout for a credit pack. */
  PURCHASE = "purchase",
  /** Money out — metered LLM usage on the Kodus provider. */
  DEBIT = "debit",
  /** Manual adjustment by Kodus (goodwill, correction). Signed. */
  ADJUSTMENT = "adjustment",
  /** Money back to the customer. Negative. */
  REFUND = "refund",
}

/**
 * One line of an org's prepaid-credit ledger. The ledger is append-only; the
 * denormalized `creditBalanceUsd` on `organization_licenses` is updated in the
 * same transaction as each insert, under a row lock, so the two never drift.
 *
 * `usageKey` is the idempotency key — a Stripe session id for a purchase, a
 * telemetry span id for a debit — enforced by a UNIQUE (organizationId,
 * usageKey) index so a retried request can never double-charge.
 */
@Entity("credit_ledger_entries")
@Index("IDX_credit_ledger_org_created", ["organizationId", "createdAt"])
@Index("UQ_credit_ledger_org_usage_key", ["organizationId", "usageKey"], {
  unique: true,
})
export class CreditLedgerEntry {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  organizationId: string;

  @Column({ nullable: true })
  teamId?: string;

  @Column({ type: "enum", enum: CreditLedgerEntryType })
  type: CreditLedgerEntryType;

  /** Signed USD: purchases positive, debits/refunds negative. */
  @Column({
    type: "numeric",
    precision: 14,
    scale: 6,
    transformer: numericTransformer,
  })
  amountUsd: number;

  /** Balance right after this entry was applied (audit trail). */
  @Column({
    type: "numeric",
    precision: 14,
    scale: 6,
    transformer: numericTransformer,
  })
  balanceAfterUsd: number;

  @Column()
  usageKey: string;

  /** Free-form context: model, tokens, correlationId, prNumber, Stripe ids… */
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
