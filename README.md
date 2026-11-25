# FreshGuard — Intelligent Inventory Management & Secure Automated CI/CD Pipeline

Final-Year Project implementation for:
> *"Design and Implement a Secure, Automated CI/CD Pipeline for Deploying an Intelligent Inventory Management System to Minimize Food Waste and Prevent Stockouts in Food Retail Stores."*

## Architecture

- **Frontend (`frontend/`)**: React + Vite + Recharts SPA served via unprivileged Nginx (`/api` reverse proxy).
- **Backend API (`backend/`)**: Node.js + Express + Mongoose + Zod + JWT/RBAC + FEFO stock deduction engine + rule-based waste reduction engine + Prometheus `/metrics` & `/ready`.
- **ML Prediction Service (`ml-service/`)**: Python + FastAPI + scikit-learn (`MovingAverage7dBaseline`, `RidgeRegression`, `RandomForestRegressor`, and Stockout Risk Classifier) with expiry-aware day-by-day FEFO simulation and cold-start fallback.
- **Database**: MongoDB 7 with persistent storage and indexed collections (`products`, `inventory_batches`, `sales_records`, `waste_logs`, `reorder_recommendations`, `ml_model_runs`, `audit_logs`, `users`, `store_configs`).
- **CI/CD & DevSecOps**: 17-stage `Jenkinsfile` integrating Gitleaks, Jest/Vitest/pytest, SonarQube, npm/pip/OWASP dependency scanning, Docker multi-stage builds, Trivy container CVE gating, AWS EC2 deployment, DB initialization, smoke tests, and automated rollback.

## Quick Local Run (Docker Compose)

```bash
docker compose up --build
```

Once healthy:
- **Web App**: `http://localhost`
- **Backend Health / Readiness**: `http://localhost/health` and `http://localhost/ready`

### Default Seeded Demo Accounts
- `admin@freshguard.local` (`admin`)
- `manager@freshguard.local` (`manager`)
- `staff@freshguard.local` (`staff`)

Default local development password is set via `SEED_USER_PASSWORD` in `docker-compose.yml` (`FreshGuardDemo2026!`). Change this immediately in `.env.prod` for any cloud deployment.

## Local Development & Test Commands

```bash
# Backend
cd backend && npm install && npm test

# ML Service
cd ml-service && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && pytest

# Frontend
cd frontend && npm install && npm test && npm run build
```

## AWS EC2 Deployment Preparation

1. Provision an EC2 instance (Ubuntu 24.04, `t3.small` or `t3.medium`), open ports `80`/`443` and restrict port `22` to your Jenkins CI server IP.
2. Install Docker + Docker Compose plugin on EC2 and create `/opt/freshguard-inventory/.env.prod` from `.env.example` with strong random `JWT_SECRET` and `SEED_ON_EMPTY=false` (or custom `SEED_USER_PASSWORD`).
3. Configure Jenkins Credentials (`freshguard-registry-prefix`, `freshguard-registry-creds`, `freshguard-ec2-host`, `freshguard-ec2-user`, `freshguard-ec2-ssh-key`) and SonarQube server `SonarQubeServer`.
