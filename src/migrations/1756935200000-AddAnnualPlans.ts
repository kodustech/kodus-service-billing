import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAnnualPlans1756935200000 implements MigrationInterface {
    name = 'AddAnnualPlans1756935200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "billing"."organization_licenses_plantype_enum" ADD VALUE IF NOT EXISTS 'teams_byok_annual'`);
        await queryRunner.query(`ALTER TYPE "billing"."organization_licenses_plantype_enum" ADD VALUE IF NOT EXISTS 'teams_managed_annual'`);
        await queryRunner.query(`ALTER TYPE "billing"."organization_licenses_plantype_enum" ADD VALUE IF NOT EXISTS 'enterprise_byok_annual'`);
        await queryRunner.query(`ALTER TYPE "billing"."organization_licenses_plantype_enum" ADD VALUE IF NOT EXISTS 'enterprise_managed_annual'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Note: PostgreSQL doesn't support removing enum values directly
        // This would require recreating the enum type and updating all references
        // For safety, we'll leave the enum values in place
        console.log('Note: Removing enum values requires manual intervention in PostgreSQL');
    }
}
