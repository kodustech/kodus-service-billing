import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIndices1768845668034 implements MigrationInterface {
  name = "AddIndices1768845668034";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_org_licenses_stripe_subscription_id" ON "billing"."organization_licenses" ("stripeSubscriptionId")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_org_licenses_stripe_customer_id" ON "billing"."organization_licenses" ("stripeCustomerId")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_org_licenses_status_trialend" ON "billing"."organization_licenses" ("subscriptionStatus", "trialEnd")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_org_licenses_subscription_status" ON "billing"."organization_licenses" ("subscriptionStatus")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_org_licenses_organizationid" ON "billing"."organization_licenses" ("organizationId")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_org_licenses_orgid_teamid" ON "billing"."organization_licenses" ("organizationId", "teamId")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_licenses_license_status" ON "billing"."user_licenses" ("licenseStatus")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_licenses_git_id_tool" ON "billing"."user_licenses" ("git_id", "git_tool")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_licenses_git_id" ON "billing"."user_licenses" ("git_id")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_licenses_orgid_status" ON "billing"."user_licenses" ("organizationLicenseId", "licenseStatus")
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_licenses_org_license_id" ON "billing"."user_licenses" ("organizationLicenseId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_user_licenses_org_license_id"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_user_licenses_orgid_status"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_user_licenses_git_id"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_user_licenses_git_id_tool"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_user_licenses_license_status"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_org_licenses_orgid_teamid"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_org_licenses_organizationid"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_org_licenses_subscription_status"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_org_licenses_status_trialend"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_org_licenses_stripe_customer_id"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_org_licenses_stripe_subscription_id"
        `);
  }
}
