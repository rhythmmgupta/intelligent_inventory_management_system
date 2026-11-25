#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost}"

echo "Running smoke tests against ${BASE_URL}..."

for i in $(seq 1 15); do
  if curl -fsS "${BASE_URL}/health" >/dev/null; then
    break
  fi
  if [[ ${i} -eq 15 ]]; then
    echo "FAIL: /health endpoint did not respond with 200."
    exit 1
  fi
  sleep 2
done

READY_JSON=$(curl -fsS "${BASE_URL}/ready")
echo "Readiness status: ${READY_JSON}"

if ! echo "${READY_JSON}" | grep -q '"mongodb":"up"'; then
  echo "FAIL: MongoDB dependency is not healthy."
  exit 1
fi

FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/")
if [[ "${FRONTEND_STATUS}" != "200" ]]; then
  echo "FAIL: Frontend root returned HTTP ${FRONTEND_STATUS}."
  exit 1
fi

# Verify unauthenticated /api/inventory enforces JWT auth (401)
UNAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/inventory")
if [[ "${UNAUTH_STATUS}" != "401" ]]; then
  echo "FAIL: Protected endpoint /api/inventory returned ${UNAUTH_STATUS} instead of 401."
  exit 1
fi

echo "All smoke tests passed successfully."
