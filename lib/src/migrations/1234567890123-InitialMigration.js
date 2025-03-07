"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitialMigration1234567890123 = void 0;
class InitialMigration1234567890123 {
    async up(queryRunner) {
        await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "subscription"`);
        await queryRunner.query(`CREATE TYPE "subscription"."subscription_status_enum" AS ENUM ('trial', 'active', 'payment_failed', 'canceled', 'expired')`);
        await queryRunner.query(`CREATE TYPE "subscription"."license_status_enum" AS ENUM ('active', 'inactive')`);
        await queryRunner.query(`CREATE TYPE "subscription"."git_tool_enum" AS ENUM ('github', 'gitlab', 'bitbucket')`);
        await queryRunner.query(`
            CREATE TABLE "subscription"."organization_licenses" (
                "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                "organizationId" VARCHAR NOT NULL,
                "subscriptionStatus" "subscription"."subscription_status_enum" NOT NULL DEFAULT 'trial',
                "cloudToken" VARCHAR NOT NULL,
                "trialEnd" TIMESTAMP NOT NULL,
                "stripeCustomerId" VARCHAR,
                "stripeSubscriptionId" VARCHAR,
                "totalLicenses" INTEGER NOT NULL DEFAULT 0,
                "assignedLicenses" INTEGER NOT NULL DEFAULT 0,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "subscription"."user_licenses" (
                "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                "userId" VARCHAR NOT NULL,
                "git_id" VARCHAR NOT NULL,
                "licenseStatus" "subscription"."license_status_enum" NOT NULL DEFAULT 'active',
                "git_tool" "subscription"."git_tool_enum" NOT NULL,
                "assignedAt" TIMESTAMP NOT NULL,
                "organizationLicenseId" UUID NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_user_licenses_organization_licenses" FOREIGN KEY ("organizationLicenseId") 
                REFERENCES "subscription"."organization_licenses" ("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_organization_id" ON "subscription"."organization_licenses" ("organizationId")`);
        await queryRunner.query(`CREATE INDEX "IDX_user_id" ON "subscription"."user_licenses" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_org_license_id" ON "subscription"."user_licenses" ("organizationLicenseId")`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "subscription"."IDX_org_license_id"`);
        await queryRunner.query(`DROP INDEX "subscription"."IDX_user_id"`);
        await queryRunner.query(`DROP INDEX "subscription"."IDX_organization_id"`);
        await queryRunner.query(`DROP TABLE "subscription"."user_licenses"`);
        await queryRunner.query(`DROP TABLE "subscription"."organization_licenses"`);
        await queryRunner.query(`DROP TYPE "subscription"."git_tool_enum"`);
        await queryRunner.query(`DROP TYPE "subscription"."license_status_enum"`);
        await queryRunner.query(`DROP TYPE "subscription"."subscription_status_enum"`);
    }
}
exports.InitialMigration1234567890123 = InitialMigration1234567890123;
//# sourceMappingURL=1234567890123-InitialMigration.js.map