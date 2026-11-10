import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";
import { numericTransformer } from "./CreditLedgerEntry";

/** Holds capacity until a charge is credited or definitively declined.
 * Unknown outcomes keep their reservation, including across month changes. */
@Entity("credit_auto_topup_reservations")
@Index("IDX_credit_auto_topup_reservation_license", ["licenseId"])
export class CreditAutoTopUpReservation {
  @PrimaryColumn({ type: "varchar" })
  key: string;

  @Column({ type: "uuid" })
  licenseId: string;

  @Column({
    type: "numeric",
    precision: 14,
    scale: 6,
    transformer: numericTransformer,
  })
  creditUsd: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
