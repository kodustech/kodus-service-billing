#!/bin/bash

# Lista de todas as chaves que você precisa
KEYS=(
    "/qa/kodus-service-billing/NODE_ENV"
    "/qa/kodus-service-billing/PORT"
    "/qa/kodus-service-billing/PG_DB_HOST"
    "/qa/kodus-service-billing/PG_DB_PORT"
    "/qa/kodus-service-billing/PG_DB_USERNAME"
    "/qa/kodus-service-billing/PG_DB_PASSWORD"
    "/qa/kodus-service-billing/PG_DB_DATABASE"
    "/qa/kodus-service-billing/PG_DB_SCHEMA"

    "/qa/kodus-service-billing/STRIPE_SECRET_KEY"
    "/qa/kodus-service-billing/STRIPE_PRICE_ID"
    "/qa/kodus-service-billing/STRIPE_PRICE_ID_TEAMS_BYOK"
    "/qa/kodus-service-billing/STRIPE_PRICE_ID_TEAMS_MANAGED"
    "/qa/kodus-service-billing/STRIPE_PRICE_ID_TEAMS_MANAGED_LEGACY"
    "/qa/kodus-service-billing/STRIPE_PRICE_ID_ENTERPRISE_BYOK"
    "/qa/kodus-service-billing/STRIPE_PRICE_ID_ENTERPRISE_MANAGED"
    "/qa/kodus-service-billing/STRIPE_WEBHOOK_SECRET"
    "/qa/kodus-service-billing/TRIAL_DURATION"
    "/qa/kodus-service-billing/CLOUD_TOKEN_SECRET"
    "/qa/kodus-service-billing/CORS_URLS"
    "/qa/kodus-service-billing/FRONTEND_URL"

    "/qa/kodus-service-billing/API_BILLING_NODE_ENV"
    "/qa/kodus-service-billing/API_DATABASE_ENV"
    "/qa/kodus-service-billing/ADMIN_TOKEN"

    "/qa/kodus-service-billing/API_BILLING_HOSTNAME_API_ORCHESTRATOR"
    "/qa/kodus-service-billing/API_BILLING_PORT_API_ORCHESTRATOR"
    "/qa/kodus-service-billing/GLOBAL_API_CONTAINER_NAME"
)

# Lista de todas as chaves que você precisa

ENV_FILE=".env.qa"

# Limpe o arquivo .env existente ou crie um novo
> $ENV_FILE

# Busque cada chave e adicione-a ao arquivo .env
for KEY in "${KEYS[@]}"; do
  VALUE=$(aws ssm get-parameter --name "$KEY" --with-decryption --query "Parameter.Value" --output text)
  echo "${KEY##*/}=$VALUE" >> $ENV_FILE
done