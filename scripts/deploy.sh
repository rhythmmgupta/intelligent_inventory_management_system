#!/usr/bin/env bash
set -euo pipefail

STATE_FILE=".deploy-state"
COMPOSE_FILE="docker-compose.prod.yml"

load_state() {
  if [[ -f "${STATE_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${STATE_FILE}"
  fi
  CURRENT_TAG="${CURRENT_TAG:-}"
  PREVIOUS_TAG="${PREVIOUS_TAG:-}"
  CURRENT_REGISTRY="${CURRENT_REGISTRY:-}"
}

save_state() {
  cat > "${STATE_FILE}" <<EOF
CURRENT_REGISTRY="${1}"
CURRENT_TAG="${2}"
PREVIOUS_TAG="${3}"
EOF
}

wait_for_ready() {
  local max_attempts=20
  local attempt=1
  while [[ ${attempt} -le ${max_attempts} ]]; do
    if curl -fsS "http://127.0.0.1/ready" >/dev/null 2>&1; then
      echo "Application /ready check passed."
      return 0
    fi
    echo "Waiting for /ready (${attempt}/${max_attempts})..."
    sleep 4
    attempt=$((attempt + 1))
  done
  echo "ERROR: Application failed to become ready in time."
  return 1
}

deploy_version() {
  local registry="$1"
  local new_tag="$2"
  if [[ ! -f ".env.prod" ]]; then
    echo "ERROR: .env.prod missing in $(pwd). Copy .env.example and set production secrets first."
    exit 1
  fi
  load_state

  local prev="${CURRENT_TAG}"
  export REGISTRY_PREFIX="${registry}"
  export IMAGE_TAG="${new_tag}"

  echo "Deploying tag ${new_tag} (previous healthy tag: ${prev:-none})..."
  docker compose -f "${COMPOSE_FILE}" pull
  docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

  if wait_for_ready; then
    save_state "${registry}" "${new_tag}" "${prev}"
    echo "Deployment succeeded for ${new_tag}."
  else
    echo "Deployment verification failed. Initiating automatic rollback..."
    if [[ -n "${prev}" ]]; then
      rollback_version "${prev}"
    fi
    exit 1
  fi
}

rollback_version() {
  load_state
  local target_tag="${1:-${PREVIOUS_TAG}}"
  if [[ -z "${target_tag}" || -z "${CURRENT_REGISTRY}" ]]; then
    echo "ERROR: No previous verified deployment tag recorded for rollback."
    exit 1
  fi

  echo "Rolling back deployment to tag: ${target_tag}..."
  export REGISTRY_PREFIX="${CURRENT_REGISTRY}"
  export IMAGE_TAG="${target_tag}"

  docker compose -f "${COMPOSE_FILE}" pull
  docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans
  wait_for_ready
  save_state "${CURRENT_REGISTRY}" "${target_tag}" "${CURRENT_TAG}"
  echo "Rollback completed successfully to ${target_tag}."
}

case "${1:-}" in
  --deploy)
    deploy_version "${2:?Registry prefix required}" "${3:?Image tag required}"
    ;;
  --rollback)
    rollback_version "${2:-}"
    ;;
  *)
    echo "Usage: $0 --deploy <registry> <tag> | --rollback [tag]"
    exit 2
    ;;
esac
