/**
 * Standalone migration runner, used by docker/prod-entrypoint.sh when
 * RUN_MIGRATIONS=true.
 *
 * It lives under `src/` so that `pnpm build` compiles it to
 * `lib/src/migration.js`: the built image has no reason to carry ts-node, and
 * running the TypeScript directly also typechecks a file outside the build's
 * tsconfig, which fails on `process`/`console` for want of node types.
 */
import "dotenv/config";
import { AppDataSource, initializeDatabase } from "./config/database";

// `initializeDatabase()` and not `AppDataSource.initialize()`: it runs the
// `CREATE SCHEMA IF NOT EXISTS` bootstrap first. Migrations now run BEFORE the
// app, so on a fresh database nothing else would have created the schema, and
// TypeORM would fail creating its `migrations` table there. With `set -e` in
// the entrypoint and `restart: unless-stopped` in compose, that is not a 500
// on first read — it is a container that never boots.
initializeDatabase()
  .then(() => {
    AppDataSource.runMigrations()
      .then(() => {
        console.log("Migrations executadas com sucesso!");
        process.exit(0);
      })
      .catch((error) => {
        console.error("Erro ao executar migrations:", error);
        process.exit(1);
      });
  })
  .catch((error) => {
    console.error("Erro ao conectar ao banco:", error);
    process.exit(1);
  });
