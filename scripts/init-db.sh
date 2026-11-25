#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"

echo "Running idempotent MongoDB index & bootstrap check..."
docker compose -f "${COMPOSE_FILE}" exec -T backend node src/scripts/initDb.js
echo "Database initialization verification complete."
