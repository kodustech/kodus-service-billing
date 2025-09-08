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

  @Column({
    type: "enum",
    enum: PlanType,
    default: PlanType.TEAMS_MANAGED_LEGACY,
  })
  planType: PlanType;

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
