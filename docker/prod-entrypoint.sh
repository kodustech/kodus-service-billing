#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Boot for the built image (prod / homolog).
#
# WHY THIS EXISTS: nothing in this service's deploy ran migrations. The deploy
# is `docker compose up -d --force-recreate`, `synchronize` is off outside
# development, and the DataSource does not set `migrationsRun`, so a release
# whose entity gained a column shipped against a table that never got it. The
# first read of that entity then answers 500 — which is exactly how it was
# found, on PR #51.
#
# Same shape as kodus-ai's docker/prod-entrypoint.sh: opt in with
# RUN_MIGRATIONS, run the COMPILED runner, warn instead of guessing if it is
# missing, then hand over to the app.
# ---------------------------------------------------------------------------

# An explicit command wins, and is checked FIRST: `docker compose run app node
# lib/src/migration.js`, a debug shell, anything. It has to come before the
# migration block — with RUN_MIGRATIONS on (the compose default) and `set -e`
# active, a failing automatic migration would exit the container before ever
# reaching the command, which is exactly the command someone runs to
# investigate that failure.
if [ "$#" -gt 0 ]; then
  echo "▶ Running the requested command instead of the app: $*"
  exec "$@"
fi

RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
PM2_ENV="${PM2_ENV:-production}"

echo "▶ kodus-service-billing boot"
echo "  - RUN_MIGRATIONS: $RUN_MIGRATIONS"
echo "  - PM2_ENV: $PM2_ENV"

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "▶ Running billing migrations..."
  if [ -f "lib/src/migration.js" ]; then
    # Compiled, so the container needs no ts-node and no typecheck of a file
    # that lives outside the build's tsconfig.
    node lib/src/migration.js
  else
    echo "⚠️  lib/src/migration.js not found — skipping migrations."
    echo "    The image was built without it; run 'pnpm build' or migrate by hand."
  fi
else
  echo "▶ Skipping migrations (RUN_MIGRATIONS=$RUN_MIGRATIONS)"
fi

echo "▶ Starting the app"
exec pm2-runtime start ecosystem.config.js --env "$PM2_ENV"
