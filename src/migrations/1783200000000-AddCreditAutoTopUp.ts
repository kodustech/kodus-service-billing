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
    // `creditAutoTopUpAttemptKey` is deliberately NOT here: 1783300000000 owns
    // it. Dropping it from this down() would strip the column while that
    // migration is still recorded as applied, and since its up() is
    // `ADD COLUMN IF NOT EXISTS`, `migration:run` could never put it back —
    // every license read would then fail on a missing column. A database that
    // got the column from an earlier revision of THIS file simply keeps it
    // after a revert, which is harmless: 1783300000000's up() is idempotent.
    //
    // `IF EXISTS` stays on the seven columns below, so a revert is repeatable.
    for (const col of [
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
