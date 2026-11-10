import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoTopUpMonthlyLimit1794322000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing"."organization_licenses"
      ADD COLUMN "creditAutoTopUpMonthlyLimitUsd" numeric(14,6)
      CHECK ("creditAutoTopUpMonthlyLimitUsd" >= 0)`);
    await queryRunner.query(`CREATE TABLE "billing"."credit_auto_topup_reservations" (
      "key" varchar PRIMARY KEY,
      "licenseId" uuid NOT NULL REFERENCES "billing"."organization_licenses"("id"),
      "creditUsd" numeric(14,6) NOT NULL CHECK ("creditUsd" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_credit_auto_topup_reservation_license"
      ON "billing"."credit_auto_topup_reservations" ("licenseId")`);
    // An attempt left by the previous deployment may already have charged.
    // Reserve it before allowing users to configure their first monthly cap.
    await queryRunner.query(`INSERT INTO "billing"."credit_auto_topup_reservations"
      ("key", "licenseId", "creditUsd")
      SELECT "key", "id", "amount" FROM (
        SELECT "creditAutoTopUpAttemptKey" AS "key", "id",
          CASE WHEN "creditAutoTopUpAttemptRequest" ->> 'key' = "creditAutoTopUpAttemptKey"
            THEN COALESCE(("creditAutoTopUpAttemptRequest" -> 'params' -> 'metadata' ->> 'creditUsd')::numeric,
              "creditAutoTopUpAmountUsd")
            ELSE "creditAutoTopUpAmountUsd"
          END AS "amount"
        FROM "billing"."organization_licenses"
        WHERE "creditAutoTopUpAttemptKey" IS NOT NULL
      ) pending WHERE "amount" > 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "billing"."credit_auto_topup_reservations"`,
    );
    await queryRunner.query(`ALTER TABLE "billing"."organization_licenses"
      DROP COLUMN "creditAutoTopUpMonthlyLimitUsd"`);
  }
}
