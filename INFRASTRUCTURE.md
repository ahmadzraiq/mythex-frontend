# Infrastructure & Deployment Guide

## Overview

| | Production | Staging |
|---|---|---|
| **Landing** | `mythex.ai` | — |
| **Builder** | `app.mythex.ai` | `staging.app.mythex.ai` |
| **App Preview** | `<projectId>.app.mythex.ai` | `<projectId>.staging.app.mythex.ai` |
| **API** | `api.mythex.ai` | `staging.api.mythex.ai` |
| **Branch** | `main` | `develop` |

---

## AWS Account

- **Account ID:** `948075159962`
- **Region:** `us-west-2` (Oregon)
- **IAM Deploy User:** `deploy-admin` (AdministratorAccess)

---

## Frontend Hosting (Cloudflare Pages)

The builder is a Vite SPA deployed to Cloudflare Pages — free, global CDN, automatic HTTPS.

| | Production | Staging |
|---|---|---|
| **Cloudflare Pages project** | `mythex-app` | `mythex-app` (develop branch) |
| **URL** | `app.mythex.ai` | `staging.app.mythex.ai` |
| **Branch** | `main` | `develop` |

### Wildcard Preview Subdomains

`<projectId>.app.mythex.ai` and `<projectId>.staging.app.mythex.ai` are handled by a **Cloudflare Worker** (`infra/preview-worker/`) that proxies requests to the main Pages deployment. The SPA reads `window.location.hostname` client-side to detect the project ID.

Deploy the worker once:
```bash
cd infra/preview-worker
npx wrangler deploy
```

### Deploy (GitHub Actions — automatic)
```
push to main    → vite build → Cloudflare Pages (production)
push to develop → vite build → Cloudflare Pages (staging branch)
```

No Docker, no ECR, no S3 for the frontend.

---

## Backend (EC2 + Docker)

| | Production | Staging |
|---|---|---|
| **URL** | `https://api.mythex.ai` | `https://staging.api.mythex.ai` |
| **Branch** | `main` | `develop` |
| **EC2 Instance** | `i-00f618a2701b60ece` (t3.small) | `i-0258c2afc477f64fe` (t3.micro) |
| **EC2 IP** | `44.255.113.95` | `54.218.57.157` |
| **Database** | RDS PostgreSQL (managed) | Postgres in Docker |
| **Redis** | Docker on EC2 | Docker on EC2 |

### ECR Repository

```
948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-backend
```

Image tags: `:latest` (prod), `:staging` (staging), `:<commit-sha>` (both)

### SSH Access
```bash
ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@44.255.113.95   # prod
ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@54.218.57.157   # staging
```

### Deploy (GitHub Actions — automatic)
```
push to main    → docker build → ECR :latest → SSH prod EC2  → docker compose pull + up
push to develop → docker build → ECR :staging → SSH staging EC2 → docker compose pull + up
```

---

## Landing Page (Cloudflare Pages)

- **Repo:** `ahmadzraiq/mythex-landing`
- **Deploy:** push to `main` → Cloudflare Pages auto-deploy
- **No build step** — pure static HTML/CSS/JS

---

## Database

### Production — RDS PostgreSQL 16
- **Identifier:** `mythex-frontend-postgres`
- **Endpoint:** `mythex-frontend-postgres.c746o20miixe.us-west-2.rds.amazonaws.com:5432`
- **DB name:** `josn_based_platform`
- **Instance class:** db.t3.micro
- **Public access:** No (VPC only)
- **Password:** stored in `/app/.env.backend` on prod EC2

### Staging — Postgres in Docker
- Runs as `postgres` container on staging EC2
- **DB name:** `mythex_staging` / **User:** `staging`
- Data in Docker volume `mythex_staging_pg_data`

---

## Networking

- **VPC:** `vpc-01904a9a4be759f24` (default, `172.31.0.0/16`)
- **Subnet (EC2s):** `subnet-0a49e3a0948cac9e5` (us-west-2a)

### Security Groups
| Name | ID | Rules |
|---|---|---|
| `mythex-frontend-ec2-sg` | `sg-0b0d70e8449410005` | 22, 80, 443, 4000 open |
| `mythex-frontend-rds-sg` | `sg-0cef1d51d484e7b9b` | 5432 from EC2 SG only |

---

## Cloudflare DNS Records

Set in Cloudflare dashboard for `mythex.ai`. All orange cloud (proxied).

| Type | Name | Target | Notes |
|---|---|---|---|
| CNAME | `@` | `mythex-landing.pages.dev` | Landing page |
| CNAME | `app` | `mythex-app.pages.dev` | Builder (auto-set by Pages custom domain) |
| CNAME | `staging.app` | `mythex-app.pages.dev` | Staging builder (auto-set by Pages custom domain) |
| CNAME | `*.app` | Worker route | Wildcard previews → Cloudflare Worker |
| CNAME | `*.staging.app` | Worker route | Wildcard staging previews → Cloudflare Worker |
| A | `api` | `44.255.113.95` | Backend prod |
| A | `staging.api` | `54.218.57.157` | Backend staging |

> `app` and `staging.app` DNS records are automatically managed when you add custom domains in Cloudflare Pages dashboard.

---

## GitHub Secrets

### `mythex-frontend` repo
| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Cloudflare Pages: Edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

### `mythex-backend` repo
| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | deploy-admin IAM access key |
| `AWS_SECRET_ACCESS_KEY` | deploy-admin IAM secret key |
| `AWS_ACCOUNT_ID` | `948075159962` |
| `AWS_REGION` | `us-west-2` |
| `PROD_EC2_IP` | `44.255.113.95` |
| `STAGING_EC2_IP` | `54.218.57.157` |
| `EC2_SSH_KEY` | contents of `~/.ssh/mythex-frontend-key.pem` |
| `PROD_DATABASE_URL` | RDS PostgreSQL connection string |
| `STAGING_DATABASE_URL` | Staging postgres connection string |
| `PROD_JWT_SECRET` | JWT signing secret (prod) |
| `STAGING_JWT_SECRET` | JWT signing secret (staging) |
| `PROD_JWT_REFRESH_SECRET` | JWT refresh secret (prod) |
| `STAGING_JWT_REFRESH_SECRET` | JWT refresh secret (staging) |
| `PROD_ANTHROPIC_API_KEY` | Anthropic API key (prod) |
| `STAGING_ANTHROPIC_API_KEY` | Anthropic API key (staging) |
| `PROD_OPENAI_API_KEY` | OpenAI API key (prod) |
| `STAGING_OPENAI_API_KEY` | OpenAI API key (staging) |
| `PROD_UNSPLASH_ACCESS_KEY` | Unsplash key (prod) |
| `STAGING_UNSPLASH_ACCESS_KEY` | Unsplash key (staging) |
| `PROD_PEXELS_API_KEY` | Pexels key (prod) |
| `STAGING_PEXELS_API_KEY` | Pexels key (staging) |
| `PROD_S3_PUBLIC_BUCKET` | S3 public assets bucket (prod) |
| `STAGING_S3_PUBLIC_BUCKET` | S3 public assets bucket (staging) |
| `PROD_S3_PRIVATE_BUCKET` | S3 private bucket (prod) |
| `STAGING_S3_PRIVATE_BUCKET` | S3 private bucket (staging) |
| `STAGING_POSTGRES_PASSWORD` | Staging docker postgres password |
| `PROD_FREE_PLAN_PROJECT_LIMIT` | Free plan project limit (prod) |
| `STAGING_FREE_PLAN_PROJECT_LIMIT` | Free plan project limit (staging) |
| `PROD_FREE_PLAN_ROW_LIMIT` | Free plan row limit |
| `STAGING_FREE_PLAN_ROW_LIMIT` | Free plan row limit |
| `PROD_FREE_PLAN_STORAGE_MB` | Free plan storage MB |
| `STAGING_FREE_PLAN_STORAGE_MB` | Free plan storage MB |
| `PROD_FREE_PLAN_API_CALLS_PER_MONTH` | Free plan API calls |
| `STAGING_FREE_PLAN_API_CALLS_PER_MONTH` | Free plan API calls |

### `mythex-landing` repo
| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Pages deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

---

## EC2 Setup (One-Time Per Server)

SSH into each EC2 and run:

```bash
# Install nginx
sudo yum install -y nginx

# Copy nginx config (from infra/nginx-ec2.conf in mythex-backend repo)
sudo cp nginx-ec2.conf /etc/nginx/conf.d/mythex.conf

# Start and enable nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Create app directory
sudo mkdir -p /app
sudo chown ec2-user:ec2-user /app

# Authenticate Docker with ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin \
  948075159962.dkr.ecr.us-west-2.amazonaws.com

# Copy docker-compose file (prod or staging)
cp infra/docker-compose.prod.yml /app/docker-compose.yml  # on prod EC2
cp infra/docker-compose.staging.yml /app/docker-compose.yml  # on staging EC2
```

---

## Common Operations

### View logs
```bash
cd /app && docker compose logs -f backend
cd /app && docker compose logs -f redis
```

### Restart a service
```bash
cd /app && docker compose restart backend
```

### Run Prisma migrations
```bash
cd /app && docker compose exec backend sh -c "npx prisma migrate deploy"
```

### Manual deploy (without GitHub Actions)
```bash
# Build and push from local
cd /Users/ahmadzraiq/Desktop/mythex-backend
docker build --platform linux/amd64 \
  -t 948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-backend:latest .
docker push 948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-backend:latest

# Deploy on prod EC2
ssh -i ~/.ssh/mythex-frontend-key.pem ec2-user@44.255.113.95 \
  "cd /app && docker compose pull backend && docker compose up -d backend"
```

---

## Monthly Cost Estimate

| Resource | Cost |
|---|---|
| EC2 prod (t3.small) | ~$15/mo |
| EC2 staging (t3.micro) | ~$8/mo |
| RDS prod (db.t3.micro + 20GB) | ~$15/mo |
| Cloudflare Pages (builder) | $0 |
| ECR (mythex-backend images) | ~$0.50/mo |
| Cloudflare CDN + Pages | $0 |
| **Total** | **~$39/mo** |

---

## AWS Cleanup Commands (Old Resources)

Run once after verifying new setup is live:

```bash
# Delete old ECR repos
aws ecr delete-repository --repository-name mythex-frontend-frontend --region us-west-2 --force
aws ecr delete-repository --repository-name mythex-frontend-backend --region us-west-2 --force

# Deregister old ECS task definitions
aws ecs list-task-definitions --family-prefix mythex-frontend-frontend --region us-west-2
# aws ecs deregister-task-definition --task-definition mythex-frontend-frontend:1 --region us-west-2

# Delete old CloudWatch log groups
aws logs delete-log-group --log-group-name /ecs/mythex-frontend-frontend --region us-west-2
aws logs delete-log-group --log-group-name /ecs/mythex-frontend-frontend-staging --region us-west-2

# Delete unused IAM role
aws iam delete-role --role-name mythex-frontend-frontend-task-role

# Check for unattached Elastic IPs (costs $3.60/mo each)
aws ec2 describe-addresses --region us-west-2 --query 'Addresses[?AssociationId==null]'
# aws ec2 release-address --allocation-id <eipalloc-id> --region us-west-2
```
