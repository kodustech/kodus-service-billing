import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreditCurrencyAndAttemptRequest1783400000000 implements MigrationInterface {
  name = "AddCreditCurrencyAndAttemptRequest1783400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Currency of the org's last paid credit purchase. Stripe only sets
    // `customer.currency` for recurring billing, so for a credit-only customer
    // this column is the one record of the currency they paid in.
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD COLUMN IF NOT EXISTS "creditCurrency" character varying
        `);
    // The exact PaymentIntent request sent under `creditAutoTopUpAttemptKey`.
    // Stripe rejects a reused idempotency key with different parameters, so a
    // retry after an unknown outcome replays this instead of re-pricing.
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD COLUMN IF NOT EXISTS "creditAutoTopUpAttemptRequest" jsonb
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN IF EXISTS "creditAutoTopUpAttemptRequest"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN IF EXISTS "creditCurrency"
        `);
  }
}
