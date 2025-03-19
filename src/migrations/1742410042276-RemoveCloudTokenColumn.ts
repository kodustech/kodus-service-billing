import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class RemoveCloudTokenColumn1742410042276 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // First set the correct schema
        await queryRunner.query('SET search_path TO subscription;');
        await queryRunner.dropColumn("organization_licenses", "cloudToken");
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('SET search_path TO subscription;');
        await queryRunner.addColumn(
            "organization_licenses",
            new TableColumn({
                name: "cloudToken",
                type: "varchar",
                isNullable: true
            })
        );
    }
} 