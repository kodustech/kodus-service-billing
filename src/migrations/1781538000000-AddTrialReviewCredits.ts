import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrialReviewCredits1781538000000 implements MigrationInterface {
  name = "AddTrialReviewCredits1781538000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialReviewCreditsTotal" integer NOT NULL DEFAULT 0
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialReviewCreditsUsed" integer NOT NULL DEFAULT 0
        `);
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD "trialReviewCreditsRemaining" integer NOT NULL DEFAULT 0
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

    await queryRunner.query(`
            UPDATE "billing"."organization_licenses"
            SET
                "trialReviewCreditsTotal" = 5,
                "trialReviewCreditsUsed" = 0,
                "trialReviewCreditsRemaining" = 5,
                "trialCreditTier" = 'base',
                "trialUnlocks" = CASE
                    WHEN "planType"::text LIKE '%byok%' THEN '[
                        {"key":"team_setup","status":"locked","rewardCredits":5},
                        {"key":"multi_author_review","status":"locked","rewardCredits":5},
                        {"key":"byok","status":"completed"},
                        {"key":"referral","status":"locked","rewardCredits":5}
                    ]'::jsonb
                    ELSE '[
                        {"key":"team_setup","status":"locked","rewardCredits":5},
                        {"key":"multi_author_review","status":"locked","rewardCredits":5},
                        {"key":"byok","status":"available"},
                        {"key":"referral","status":"locked","rewardCredits":5}
                    ]'::jsonb
                END
            WHERE "subscriptionStatus" = 'trial'
              AND "trialReviewCreditsTotal" = 0
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
