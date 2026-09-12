import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrepaidCredits1783100000000 implements MigrationInterface {
  name = "AddPrepaidCredits1783100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Denormalized balance + one-shot notification markers on the license.
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditBalanceUsd" numeric(14,6) NOT NULL DEFAULT 0
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditsLowNotifiedAt" TIMESTAMP
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditsExhaustedNotifiedAt" TIMESTAMP
        `);

    // Append-only ledger. The UNIQUE (organizationId, usageKey) index is the
    // idempotency guarantee: a retried purchase webhook or debit batch cannot
    // apply twice.
    await queryRunner.query(`
            CREATE TYPE "billing"."credit_ledger_entries_type_enum"
            AS ENUM('purchase', 'debit', 'adjustment', 'refund')
        `);
    await queryRunner.query(`
            CREATE TABLE "billing"."credit_ledger_entries" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organizationId" character varying NOT NULL,
                "teamId" character varying,
                "type" "billing"."credit_ledger_entries_type_enum" NOT NULL,
                "amountUsd" numeric(14,6) NOT NULL,
                "balanceAfterUsd" numeric(14,6) NOT NULL,
                "usageKey" character varying NOT NULL,
                "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_credit_ledger_entries" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_credit_ledger_org_created"
            ON "billing"."credit_ledger_entries" ("organizationId", "createdAt")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_credit_ledger_org_usage_key"
            ON "billing"."credit_ledger_entries" ("organizationId", "usageKey")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."UQ_credit_ledger_org_usage_key"
        `);
    await queryRunner.query(`
            DROP INDEX IF EXISTS "billing"."IDX_credit_ledger_org_created"
        `);
    await queryRunner.query(`DROP TABLE "billing"."credit_ledger_entries"`);
    await queryRunner.query(`
            DROP TYPE "billing"."credit_ledger_entries_type_enum"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "creditsExhaustedNotifiedAt"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "creditsLowNotifiedAt"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "creditBalanceUsd"
        `);
  }
}
