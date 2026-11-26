import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConnectionLicenses1795600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "billing"."user_licenses_git_tool_enum" ADD VALUE IF NOT EXISTS 'forgejo'`,
    );
    await queryRunner.query(`ALTER TABLE "billing"."organization_licenses"
      ADD COLUMN "primaryConnectionId" varchar`);

    // Plan type and status reuse the organization_licenses enum types, so a
    // new value is one ALTER TYPE for both tables.
    await queryRunner.query(`CREATE TABLE "billing"."connection_licenses" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "organizationLicenseId" uuid NOT NULL,
      "organizationId" varchar NOT NULL,
      "teamId" varchar NOT NULL,
      "connectionId" varchar NOT NULL,
      "subscriptionStatus" "billing"."organization_licenses_subscriptionstatus_enum" NOT NULL DEFAULT 'active',
      "planType" "billing"."organization_licenses_plantype_enum" NOT NULL DEFAULT 'free_byok',
      "stripeSubscriptionId" varchar,
      "totalLicenses" integer NOT NULL DEFAULT 0,
      "assignedLicenses" integer NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_connection_licenses_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_71c98afae5b83869e70936d388e" FOREIGN KEY ("organizationLicenseId")
        REFERENCES "billing"."organization_licenses"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_connection_licenses_license_connection"
      ON "billing"."connection_licenses" ("organizationLicenseId", "connectionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_connection_licenses_org_team"
      ON "billing"."connection_licenses" ("organizationId", "teamId")`);
    await queryRunner.query(`CREATE INDEX "IDX_connection_licenses_stripe_subscription_id"
      ON "billing"."connection_licenses" ("stripeSubscriptionId")`);

    await queryRunner.query(`ALTER TABLE "billing"."user_licenses"
      ADD COLUMN "connectionLicenseId" uuid,
      ADD COLUMN "git_host" varchar,
      ADD CONSTRAINT "FK_126ae473a175f900698e4a06c1b" FOREIGN KEY ("connectionLicenseId")
        REFERENCES "billing"."connection_licenses"("id") ON DELETE CASCADE`);
    await queryRunner.query(`CREATE INDEX "IDX_user_licenses_connection_license_status"
      ON "billing"."user_licenses" ("connectionLicenseId", "licenseStatus")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "billing"."IDX_user_licenses_connection_license_status"`);
    await queryRunner.query(`ALTER TABLE "billing"."user_licenses"
      DROP CONSTRAINT "FK_126ae473a175f900698e4a06c1b",
      DROP COLUMN "git_host",
      DROP COLUMN "connectionLicenseId"`);
    await queryRunner.query(`DROP TABLE "billing"."connection_licenses"`);
    await queryRunner.query(`ALTER TABLE "billing"."organization_licenses"
      DROP COLUMN "primaryConnectionId"`);
    // 'forgejo' stays in user_licenses_git_tool_enum: Postgres cannot drop an
    // enum value safely.
  }
}
