import { MigrationInterface, QueryRunner } from "typeorm";

export class Initial1743510739847 implements MigrationInterface {
    name = 'Initial1743510739847'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TYPE "billing"."organization_licenses_subscriptionstatus_enum" AS ENUM(
                'trial',
                'active',
                'payment_failed',
                'canceled',
                'expired'
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "billing"."organization_licenses" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organizationId" character varying NOT NULL,
                "teamId" character varying NOT NULL,
                "subscriptionStatus" "billing"."organization_licenses_subscriptionstatus_enum" NOT NULL DEFAULT 'trial',
                "trialEnd" TIMESTAMP NULL,
                "stripeCustomerId" character varying,
                "stripeSubscriptionId" character varying,
                "totalLicenses" integer NOT NULL DEFAULT '0',
                "assignedLicenses" integer NOT NULL DEFAULT '0',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_4dc5f4e9453cc4b8aab8502deb2" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TYPE "billing"."user_licenses_licensestatus_enum" AS ENUM('active', 'inactive')
        `);
        await queryRunner.query(`
            CREATE TYPE "billing"."user_licenses_git_tool_enum" AS ENUM('github', 'gitlab', 'bitbucket')
        `);
        await queryRunner.query(`
            CREATE TABLE "billing"."user_licenses" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "git_id" character varying NOT NULL,
                "licenseStatus" "billing"."user_licenses_licensestatus_enum" NOT NULL DEFAULT 'active',
                "git_tool" "billing"."user_licenses_git_tool_enum" NOT NULL,
                "assignedAt" TIMESTAMP NOT NULL,
                "organizationLicenseId" uuid NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_850fe9d8900b15b1e37ad337f11" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "billing"."user_licenses"
            ADD CONSTRAINT "FK_bd49b2370347ca7a56b9a2adaeb" FOREIGN KEY ("organizationLicenseId") REFERENCES "billing"."organization_licenses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "billing"."user_licenses" DROP CONSTRAINT "FK_bd49b2370347ca7a56b9a2adaeb"
        `);
        await queryRunner.query(`
            DROP TABLE "billing"."user_licenses"
        `);
        await queryRunner.query(`
            DROP TYPE "billing"."user_licenses_git_tool_enum"
        `);
        await queryRunner.query(`
            DROP TYPE "billing"."user_licenses_licensestatus_enum"
        `);
        await queryRunner.query(`
            DROP TABLE "billing"."organization_licenses"
        `);
        await queryRunner.query(`
            DROP TYPE "billing"."organization_licenses_subscriptionstatus_enum"
        `);
    }

}
