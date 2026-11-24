import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import {
  OrganizationLicense,
  PlanType,
  SubscriptionStatus,
} from "./OrganizationLicense";

/**
 * Subscription and seats of a Git connection added beside the workspace's
 * first one. The workspace row (`organization_licenses`) keeps the trial, the
 * prepaid wallet, the Stripe customer, and the plan and seats of the
 * connection named in `primaryConnectionId`.
 */
@Entity("connection_licenses")
@Index("UQ_connection_licenses_license_connection", ["organizationLicenseId", "connectionId"], { unique: true })
@Index("IDX_connection_licenses_org_team", ["organizationId", "teamId"])
@Index("IDX_connection_licenses_stripe_subscription_id", ["stripeSubscriptionId"])
export class ConnectionLicense {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  organizationLicenseId: string;

  @ManyToOne(() => OrganizationLicense, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organizationLicenseId" })
  organizationLicense?: OrganizationLicense;

  @Column()
  organizationId: string;

  @Column()
  teamId: string;

  @Column()
  connectionId: string;

  @Column({
    type: "enum",
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  subscriptionStatus: SubscriptionStatus;

  @Column({
    type: "enum",
    enum: PlanType,
    default: PlanType.FREE_BYOK,
  })
  planType: PlanType;

  @Column({ type: "varchar", nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ default: 0 })
  totalLicenses: number;

  @Column({ default: 0 })
  assignedLicenses: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
