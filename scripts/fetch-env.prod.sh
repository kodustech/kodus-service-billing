#!/bin/bash

# Lista de todas as chaves que você precisa
KEYS=(
    "/prod/kodus-service-billing/NODE_ENV"
    "/prod/kodus-service-billing/PORT"
    "/prod/kodus-service-billing/PG_DB_HOST"
    "/prod/kodus-service-billing/PG_DB_PORT"
    "/prod/kodus-service-billing/PG_DB_USERNAME"
    "/prod/kodus-service-billing/PG_DB_PASSWORD"
    "/prod/kodus-service-billing/PG_DB_DATABASE"
    "/prod/kodus-service-billing/PG_DB_SCHEMA"

    "/prod/kodus-service-billing/STRIPE_SECRET_KEY"
    "/prod/kodus-service-billing/STRIPE_PRICE_ID"
    "/prod/kodus-service-billing/STRIPE_WEBHOOK_SECRET"
    "/prod/kodus-service-billing/TRIAL_DURATION"
    "/prod/kodus-service-billing/CLOUD_TOKEN_SECRET"
    "/prod/kodus-service-billing/CORS_URLS"
    "/prod/kodus-service-billing/FRONTEND_URL"

    "/prod/kodus-service-billing/API_BILLING_NODE_ENV"
    "/prod/kodus-service-billing/API_DATABASE_ENV"

    "/prod/kodus-service-billing/ADMIN_TOKEN"

    "/prod/kodus-service-billing/API_BILLING_HOSTNAME_API_ORCHESTRATOR"
    "/prod/kodus-service-billing/API_BILLING_PORT_API_ORCHESTRATOR"
    "/prod/kodus-service-billing/GLOBAL_API_CONTAINER_NAME"
)

# Lista de todas as chaves que você precisa

ENV_FILE=".env.prod"

# Limpe o arquivo .env existente ou crie um novo
> $ENV_FILE

# Busque cada chave e adicione-a ao arquivo .env
for KEY in "${KEYS[@]}"; do
  VALUE=$(aws ssm get-parameter --name "$KEY" --with-decryption --query "Parameter.Value" --output text)
  echo "${KEY##*/}=$VALUE" >> $ENV_FILE
done