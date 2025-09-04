import { DataSource } from "typeorm";
import { join } from 'path';
import "dotenv/config";
import { UserLicense } from "../entities/UserLicense";
import { OrganizationLicense } from "../entities/OrganizationLicense";

const isDev = process.env.API_DATABASE_ENV === "development";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.PG_DB_HOST || "db_postgres",
  port: parseInt(process.env.PG_DB_PORT || "5432"),
  username: process.env.PG_DB_USERNAME,
  password: process.env.PG_DB_PASSWORD,
  database: process.env.PG_DB_DATABASE,
  schema: process.env.PG_DB_SCHEMA || "subscription",
  synchronize: process.env.API_BILLING_NODE_ENV === "development",
  logging: process.env.API_BILLING_NODE_ENV === "development",
  ssl: !isDev
    ? {
        rejectUnauthorized: false, // necessário para RDS
      }
    : false,
  entities: [UserLicense, OrganizationLicense],
  migrations: [join(__dirname, '../migrations/*{.ts,.js}')],
  subscribers: [join(__dirname, './subscribers/*{.ts,.js}')],
});

export const initializeDatabase = async () => {
  const isDev = process.env.API_DATABASE_ENV === "development";

  const tempDataSource = new DataSource({
    type: "postgres",
    host: process.env.PG_DB_HOST || "db_postgres",
    port: parseInt(process.env.PG_DB_PORT || "5432"),
    username: process.env.PG_DB_USERNAME,
    password: process.env.PG_DB_PASSWORD,
    database: process.env.PG_DB_DATABASE,
    ssl: !isDev
      ? {
          rejectUnauthorized: false,
        }
      : false,
  });

  await tempDataSource.initialize();

  try {
    const schema = process.env.PG_DB_SCHEMA || "subscription";
    await tempDataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    console.log(`Schema "${schema}" created or already exists`);
  } catch (error) {
    console.error("Error creating schema:", error);
  } finally {
    await tempDataSource.destroy();
  }

  await AppDataSource.initialize();
  console.log("Main DataSource initialized successfully");
};