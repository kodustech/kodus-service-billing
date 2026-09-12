import { DataSource } from "typeorm";
import { join } from "path";
import "dotenv/config";
import { UserLicense } from "../entities/UserLicense";
import { OrganizationLicense } from "../entities/OrganizationLicense";
import { CreditLedgerEntry } from "../entities/CreditLedgerEntry";

const isDev = process.env.API_DATABASE_ENV === "development";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.PG_DB_HOST || "db_postgres",
  port: parseInt(process.env.PG_DB_PORT || "5432"),
  username: process.env.PG_DB_USERNAME,
  password: process.env.PG_DB_PASSWORD,
  database: process.env.PG_DB_DATABASE,
  schema: process.env.PG_DB_SCHEMA || "billing",
  synchronize: process.env.API_BILLING_NODE_ENV === "development",
  logging: process.env.API_BILLING_NODE_ENV === "development",
  ssl: !isDev
    ? {
        rejectUnauthorized: false, // necessário para RDS
      }
    : false,
  entities: [UserLicense, OrganizationLicense, CreditLedgerEntry],
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

  const schema = process.env.PG_DB_SCHEMA || "billing";
  try {
    try {
      await tempDataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      console.log(`Schema "${schema}" created or already exists`);
    } catch (error) {
      // Do NOT rethrow here: a role with no CREATE privilege on the database
      // can fail this statement even when the schema already exists, and that
      // deployment boots perfectly well today. What must not be swallowed is
      // the schema being genuinely ABSENT afterwards — migrations then die
      // inside `runMigrations()` with `schema "x" does not exist`, pointing at
      // the wrong culprit, and with `set -e` in the entrypoint plus
      // `restart: unless-stopped` that becomes a crash loop.
      console.error("Error creating schema:", error);
      // `pg_namespace`, not `information_schema.schemata`: that view only
      // shows schemas the connected role can reach, so a least-privilege role
      // — exactly the case this guard exists for — would report an existing
      // schema as absent and get told to create something that is already
      // there. The catalog is not privilege-filtered, so the later error is
      // the real one (a missing GRANT, say).
      const [{ present }] = (await tempDataSource.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_namespace WHERE nspname = $1
         ) AS present`,
        [schema],
      )) as Array<{ present: boolean }>;
      if (!present) {
        throw new Error(
          `Schema "${schema}" does not exist and could not be created: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await tempDataSource.destroy();
  }

  await AppDataSource.initialize();
  console.log("Main DataSource initialized successfully");
};
