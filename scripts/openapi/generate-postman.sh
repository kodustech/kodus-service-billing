#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:-.openapi/openapi.json}"
OUTPUT="${2:-.openapi/postman.json}"

npx openapi-to-postmanv2 -s "$INPUT" -o "$OUTPUT" -p

node scripts/openapi/patch-postman.js "$OUTPUT"

echo "Postman collection written to $OUTPUT"
