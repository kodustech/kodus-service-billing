import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum SubscriptionStatus {
  TRIAL = "trial",
  ACTIVE = "active",
  PAYMENT_FAILED = "payment_failed",
  CANCELED = "canceled",
  EXPIRED = "expired",
}

@Entity("organization_licenses")
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

  @Column({ type: "timestamp", nullable: true })
  trialEnd: Date;

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
