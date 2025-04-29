import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAzureReposOptionInUserLicenseTable1745944871993 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TYPE "billing"."user_licenses_git_tool_enum" ADD VALUE IF NOT EXISTS 'azure_repos';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        console.log('Não é possível remover um valor de enum no PostgreSQL de forma segura');
    }

}