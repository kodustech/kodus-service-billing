import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreditAutoTopUp1783200000000 implements MigrationInterface {
  name = "AddCreditAutoTopUp1783200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Auto top-up settings + the saved Stripe payment method that funds it.
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditAutoTopUpEnabled" boolean NOT NULL DEFAULT false
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditAutoTopUpThresholdUsd" numeric(14,6)
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditAutoTopUpAmountUsd" numeric(14,6)
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditPaymentMethodId" character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditPaymentMethodLabel" character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditAutoTopUpLastAt" TIMESTAMP
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "creditAutoTopUpLastError" character varying
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `creditAutoTopUpAttemptKey` is listed here AND in 1783300000000 on
    // purpose: a database migrated by an earlier revision of this file had the
    // column created here, and its migration history still records that, so
    // reverting this one has to drop it. Every other database gets the column
    // from 1783300000000 instead. `IF EXISTS` is what lets both be true —
    // whichever revert ran first, the other becomes a no-op instead of an
    // error.
    for (const col of [
      "creditAutoTopUpAttemptKey",
      "creditAutoTopUpLastError",
      "creditAutoTopUpLastAt",
      "creditPaymentMethodLabel",
      "creditPaymentMethodId",
      "creditAutoTopUpAmountUsd",
      "creditAutoTopUpThresholdUsd",
      "creditAutoTopUpEnabled",
    ]) {
      await queryRunner.query(
        `ALTER TABLE "billing"."organization_licenses" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
  }
}
