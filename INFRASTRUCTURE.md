# Infrastructure & Deployment Guide

## Overview

Two environments deployed on AWS (us-west-2 / Oregon):

| | Production | Staging |
|---|---|---|
| **URL** | http://44.255.113.95:3000 | http://54.218.57.157:3000 |
| **Branch** | `main` | `develop` |
| **EC2 Instance** | `i-00f618a2701b60ece` (t3.small) | `i-0258c2afc477f64fe` (t3.micro) |
| **EC2 IP** | `44.255.113.95` (stopped) | `54.218.57.157` |
| **Database** | RDS PostgreSQL (managed) | Postgres on EC2 (Docker) |
| **Redis** | Docker on EC2 | Docker on EC2 |
| **Cost** | ~$45/month | ~$8/month |

---

## AWS Account

- **Account ID:** `948075159962`
- **Region:** `us-west-2` (Oregon)
- **IAM Deploy User:** `deploy-admin` (AdministratorAccess)

---

## EC2 Servers

### Production — `44.255.113.95`
- **Instance:** `i-00f618a2701b60ece`
- **Type:** t3.small (2 vCPU, 2GB RAM)
- **OS:** Amazon Linux 2023
- **Storage:** 30GB gp3
- **App dir:** `/app`
- **SSH:** `ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@44.255.113.95`

### Staging — `54.218.57.157`
- **Instance:** `i-0258c2afc477f64fe`
- **Type:** t3.micro (2 vCPU, 1GB RAM)
- **OS:** Amazon Linux 2023
- **Storage:** 20GB gp3
- **App dir:** `/app`
- **SSH:** `ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@54.218.57.157`

### SSH Key
- **Name:** `mythex-frontend-key`
- **Local path:** `~/.ssh/mythex-frontend-key.pem`

---

## Database

### Production — RDS PostgreSQL 16
- **Identifier:** `mythex-frontend-postgres`
- **Endpoint:** `mythex-frontend-postgres.c746o20miixe.us-west-2.rds.amazonaws.com:5432`
- **DB name:** `josn_based_platform`
- **User:** `jsonbased`
- **Password:** stored in `/app/.env.backend` on production EC2
- **Instance class:** db.t3.micro
- **Storage:** 20GB gp2
- **Backups:** disabled (free tier)
- **Public access:** No (VPC only)

### Staging — Postgres in Docker
- Runs as `app-postgres-1` container on the staging EC2
- **DB name:** `josn_based_staging`
- **User:** `staging`
- Data stored in Docker volume `app_pg_data`
- **Note:** Data is lost if the container is removed

---

## Networking

- **VPC:** `vpc-01904a9a4be759f24` (default, `172.31.0.0/16`)
- **Subnet (EC2s):** `subnet-0a49e3a0948cac9e5` (us-west-2a)

### Security Groups
| Name | ID | Rules |
|---|---|---|
| `mythex-frontend-ec2-sg` | `sg-0b0d70e8449410005` | 22, 80, 443, 3000, 4000 open |
| `mythex-frontend-rds-sg` | `sg-0cef1d51d484e7b9b` | 5432 from EC2 SG only |

---

## Container Registry (ECR)

| Repo | URI |
|---|---|
| Frontend | `948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-frontend-frontend` |
| Backend | `948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-frontend-backend` |

### Image Tags
| Tag | Environment | Built from |
|---|---|---|
| `:latest` | Production | `main` branch |
| `:staging` | Staging | `develop` branch |
| `:<commit-sha>` | Both | Every deploy (for rollback) |

### Authenticate ECR locally
```bash
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin \
  948075159962.dkr.ecr.us-west-2.amazonaws.com
```

---

## IAM Roles

| Role | Used by | Permissions |
|---|---|---|
| `ecsTaskExecutionRole` | EC2 instances | ECR pull, CloudWatch logs |
| `mythex-frontend-ec2-role` | Both EC2s | ECR read-only |
| `mythex-frontend-backend-task-role` | Backend | S3 read/write |
| `mythex-frontend-frontend-task-role` | Frontend | — |

---

## CI/CD Pipelines (GitHub Actions)

### Flow
```
push to develop  →  build :staging image  →  push ECR  →  SSH staging EC2  →  docker compose pull + up
push to main     →  build :latest image   →  push ECR  →  SSH prod EC2     →  docker compose pull + up
```

### Required GitHub Secrets (both repos)
| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | deploy-admin IAM access key |
| `AWS_SECRET_ACCESS_KEY` | deploy-admin IAM secret key |
| `PROD_EC2_IP` | `44.255.113.95` |
| `STAGING_EC2_IP` | `54.218.57.157` |
| `EC2_SSH_KEY` | contents of `~/.ssh/mythex-frontend-key.pem` |

### Workflow files
- Frontend: `.github/workflows/deploy.yml` in `mythex-frontend` repo
- Backend: `.github/workflows/deploy.yml` in `mythex-frontend-backend` repo

---

## Services on Each EC2

Both servers run via Docker Compose at `/app/docker-compose.yml`.

### Production containers
| Container | Image | Port |
|---|---|---|
| `app-frontend-1` | ECR `mythex-frontend-frontend:latest` | 3000 |
| `app-backend-1` | ECR `mythex-frontend-backend:latest` | 4000 |
| `app-redis-1` | `redis:7-alpine` | 6379 (internal) |

### Staging containers
| Container | Image | Port |
|---|---|---|
| `app-frontend-1` | ECR `mythex-frontend-frontend:staging` | 3000 |
| `app-backend-1` | ECR `mythex-frontend-backend:staging` | 4000 |
| `app-postgres-1` | `postgres:16-alpine` | 5432 (internal) |
| `app-redis-1` | `redis:7-alpine` | 6379 (internal) |

---

## Common Operations

### View logs
```bash
# Production
ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@44.255.113.95
cd /app && docker compose logs -f backend
cd /app && docker compose logs -f frontend

# Staging
ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@44.248.35.175
cd /app && docker compose logs -f backend
```

### Restart a service
```bash
cd /app && docker compose restart backend
cd /app && docker compose restart frontend
```

### Manual deploy (without GitHub Actions)
```bash
# 1. Build and push from your Mac
cd /Users/ahmadzraiq/Desktop/mythex-frontend-backend
docker build --platform linux/amd64 -t 948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-frontend-backend:latest .
docker push 948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-frontend-backend:latest

# 2. Deploy on server
ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@44.255.113.95 \
  "cd /app && docker compose pull backend && docker compose up -d backend"
```

### Run Prisma migrations
```bash
ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@44.255.113.95
cd /app
docker compose exec backend sh -c "npx prisma migrate deploy"
```

### Full schema sync (if migrations are out of sync)
```bash
docker compose exec -T backend sh -c "npx prisma db push --skip-generate --accept-data-loss"
```

---

## Known Fixes Applied

| Issue | Fix |
|---|---|
| Middleware treated IP `44.x.x.x` as project subdomain | Added `isIpHost()` check in `middleware.ts` |
| `auth_token` cookie not set over HTTP | Changed `secure` flag from `NODE_ENV=production` to `COOKIE_SECURE=true` env var |
| Builder page crashed with `useSearchParams` during Next.js build | Wrapped `BuilderPageInner` in `<Suspense>` and added `export const dynamic = 'force-dynamic'` |
| Prisma binary target mismatch on Alpine | Added `linux-musl-openssl-3.0.x` to `binaryTargets` in `schema.prisma` |
| `refresh_tokens` table missing | Ran `prisma db push` after initial migration deploy |

---

## Upgrading to HTTPS (when you get a domain)

1. Point your domain DNS to the EC2 IP via Cloudflare (free, enables HTTPS)
2. Update `ALLOWED_ORIGINS` in `/app/.env.backend` on each server
3. Update `BACKEND_URL` in `/app/.env.frontend` on each server
4. Set `COOKIE_SECURE=true` in `/app/.env.backend` on each server
5. Restart: `cd /app && docker compose up -d`

---

## Scaling Up (when needed)

When traffic grows, upgrade to ECS Fargate:
- All Dockerfiles, task definitions, and ECS config are already in `infra/` folders
- Run `infra/aws-setup.sh` to provision VPC, RDS Multi-AZ, ElastiCache
- Update GitHub Actions workflows (swap SSH deploy steps for ECS deploy steps)
- Estimated cost at scale: $180–$320/month
