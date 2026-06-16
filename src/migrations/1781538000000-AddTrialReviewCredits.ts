import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrialReviewCredits1781538000000 implements MigrationInterface {
  name = "AddTrialReviewCredits1781538000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable, NO default: existing (legacy) trials stay NULL and keep their
    // old unlimited-reviews behavior. A NULL `trialReviewCreditsTotal` is the
    // "legacy trial" marker the API checks. Only trials created after this
    // ships get credits — set explicitly in createTrialLicense. We deliberately
    // do NOT backfill existing trials, so nobody mid-trial gets capped.
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialReviewCreditsTotal" integer
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialReviewCreditsUsed" integer
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialReviewCreditsRemaining" integer
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialCreditTier" character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialUnlocks" jsonb NOT NULL DEFAULT '[]'::jsonb
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialReviewCreditUsageKeys" jsonb NOT NULL DEFAULT '[]'::jsonb
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "trialReviewCreditUsageKeys"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "trialUnlocks"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "trialCreditTier"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "trialReviewCreditsRemaining"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "trialReviewCreditsUsed"
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN "trialReviewCreditsTotal"
        `);
  }
}
