import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialMigration1234567890123 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Criar o schema
        await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "subscription"`);
        
        // Enum para status da assinatura
        await queryRunner.query(`CREATE TYPE "subscription"."subscription_status_enum" AS ENUM ('trial', 'active', 'payment_failed', 'canceled', 'expired')`);
        
        // Enum para status da licença
        await queryRunner.query(`CREATE TYPE "subscription"."license_status_enum" AS ENUM ('active', 'inactive')`);
        
        // Enum para ferramentas git
        await queryRunner.query(`CREATE TYPE "subscription"."git_tool_enum" AS ENUM ('github', 'gitlab', 'bitbucket')`);
        
        // Tabela organization_licenses
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
        
        // Tabela user_licenses
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
        
        // Índices
        await queryRunner.query(`CREATE INDEX "IDX_organization_id" ON "subscription"."organization_licenses" ("organizationId")`);
        await queryRunner.query(`CREATE INDEX "IDX_user_id" ON "subscription"."user_licenses" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_org_license_id" ON "subscription"."user_licenses" ("organizationLicenseId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverter tudo na ordem inversa
        await queryRunner.query(`DROP INDEX "subscription"."IDX_org_license_id"`);
        await queryRunner.query(`DROP INDEX "subscription"."IDX_user_id"`);
        await queryRunner.query(`DROP INDEX "subscription"."IDX_organization_id"`);
        
        await queryRunner.query(`DROP TABLE "subscription"."user_licenses"`);
        await queryRunner.query(`DROP TABLE "subscription"."organization_licenses"`);
        
        await queryRunner.query(`DROP TYPE "subscription"."git_tool_enum"`);
        await queryRunner.query(`DROP TYPE "subscription"."license_status_enum"`);
        await queryRunner.query(`DROP TYPE "subscription"."subscription_status_enum"`);
        
        // Opcional: remover o schema inteiro
        // await queryRunner.query(`DROP SCHEMA "subscription" CASCADE`);
    }
} 