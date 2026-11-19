#!/usr/bin/env bash
set -euo pipefail

# Real PostgreSQL, disposable database, mocked Stripe. No production services.
cd "$(dirname "$0")/.."
container="kodus-auto-topup-test-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm --detach --name "$container" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=autotopup_test \
  -p 127.0.0.1::5432 postgres:17 >/dev/null

ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$container"
  exit 1
fi
port=$(docker port "$container" 5432/tcp | awk -F: '{print $NF}')
API_DATABASE_ENV=development API_BILLING_NODE_ENV=test \
PG_DB_HOST=127.0.0.1 PG_DB_PORT="$port" PG_DB_USERNAME=postgres \
PG_DB_PASSWORD=test PG_DB_DATABASE=autotopup_test PG_DB_SCHEMA=billing \
BILLING_INTEGRATION=1 pnpm exec jest --runInBand \
  src/services/AutoTopUpBudget.integration.spec.ts "$@"
