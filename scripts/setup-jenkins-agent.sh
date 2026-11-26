#!/usr/bin/env bash
set -euo pipefail

# Run this script once with sudo on your Ubuntu 24.04 Jenkins EC2 host
# so Python venv, Docker permissions, Trivy, and MongoDB test libs are ready.

apt-get update
apt-get install -y python3-venv python3.12-venv curl gnupg unzip libcurl4

# Ensure jenkins user can run docker builds and container scans
if id jenkins >/dev/null 2>&1; then
  usermod -aG docker jenkins || true
fi

# Install Trivy CLI if missing
if ! command -v trivy >/dev/null 2>&1; then
  curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
fi

# Restart Jenkins so group membership applies
systemctl restart jenkins || true
echo "Jenkins agent dependencies configured. Verify with: sudo -u jenkins docker ps"
