#!/usr/bin/env bash
set -euo pipefail

COLLECTION="${1:-.openapi/postman.json}"
REPORT="${2:-.openapi/newman-report.json}"

ENV_ARGS=()
if [[ -n "${NEWMAN_BEARER_TOKEN:-}" ]]; then
  ENV_ARGS+=(--env-var "bearer_token=${NEWMAN_BEARER_TOKEN}")
fi

npx newman run "$COLLECTION" "${ENV_ARGS[@]}" \
  --reporters json \
  --reporter-json-export "$REPORT"

echo "Newman report written to $REPORT"
