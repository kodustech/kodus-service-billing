import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Its own migration on purpose. The column belongs to the auto top-up feature
 * added by 1783200000000, but that migration had already run in a dev
 * environment by the time this column existed, and TypeORM never re-runs an
 * applied migration — so folding it in there would leave any such database
 * one column short of the entity, which surfaces as a 500 on the first license
 * read. A new migration reaches every environment.
 */
export class AddCreditAutoTopUpAttemptKey1783300000000 implements MigrationInterface {
  name = "AddCreditAutoTopUpAttemptKey1783300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Stripe idempotency key of the auto top-up attempt in flight. It must
    // survive retries after an UNKNOWN outcome (a timeout that may already
    // have captured the card), which is what stops a second charge.
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            ADD COLUMN IF NOT EXISTS "creditAutoTopUpAttemptKey" character varying
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "billing"."organization_licenses"
            DROP COLUMN IF EXISTS "creditAutoTopUpAttemptKey"
        `);
  }
}
