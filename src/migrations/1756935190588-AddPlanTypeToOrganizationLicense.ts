import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlanTypeToOrganizationLicense1756935190588 implements MigrationInterface {
    name = 'AddPlanTypeToOrganizationLicense1756935190588'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "billing"."organization_licenses_plantype_enum" AS ENUM('free_byok', 'teams_byok', 'teams_managed', 'teams_managed_legacy', 'enterprise_byok', 'enterprise_managed')`);
        await queryRunner.query(`ALTER TABLE "billing"."organization_licenses" ADD "planType" "billing"."organization_licenses_plantype_enum" NOT NULL DEFAULT 'teams_managed_legacy'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billing"."organization_licenses" DROP COLUMN "planType"`);
        await queryRunner.query(`DROP TYPE "billing"."organization_licenses_plantype_enum"`);
    }

}
