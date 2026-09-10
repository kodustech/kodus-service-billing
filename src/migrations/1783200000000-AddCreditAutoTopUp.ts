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
        `ALTER TABLE "billing"."organization_licenses" DROP COLUMN "${col}"`
      );
    }
  }
}
