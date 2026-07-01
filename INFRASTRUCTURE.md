# Infrastructure & Deployment Guide

## Overview

| | Production | Staging |
|---|---|---|
| **Landing** | `mythex.ai` | — |
| **Builder** | `app.mythex.ai` | `staging.app.mythex.ai` |
| **App Preview** | `<projectId>-preview.mythex.ai` | `<projectId>-staging-preview.mythex.ai` |
| **API** | `api.mythex.ai` | `api-staging.mythex.ai` |
| **Branch** | `main` | `develop` |

---

## AWS Account

- **Account ID:** `948075159962`
- **Region:** `us-west-2` (Oregon)
- **IAM Deploy User:** `deploy-admin` (AdministratorAccess)

---

## Cloudflare Account
- **Account ID:** `905e17326845b199c805398d7ecee945`

## Frontend Hosting (Cloudflare Pages)

The builder is a Vite SPA deployed to Cloudflare Pages — free, global CDN, automatic HTTPS.

| | Production | Staging |
|---|---|---|
| **Cloudflare Pages project** | `mythex-frontend` | `mythex-frontend-staging` |
| **URL** | `app.mythex.ai` | `staging.app.mythex.ai` |
| **Branch** | `main` | `develop` |

### Wildcard Preview Subdomains

`<projectId>-preview.mythex.ai` (prod) and `<projectId>-staging-preview.mythex.ai` (staging) are handled by a **Cloudflare Worker** (`infra/preview-worker/`) that proxies to the appropriate Pages project. Uses `*.mythex.ai` single-level wildcard — covered by Cloudflare Universal SSL.

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
| **URL** | `https://api.mythex.ai` | `https://api-staging.mythex.ai` |
| **Branch** | `main` | `develop` |
| **EC2 Name** | `mythex-backend-prod` (t3.small) | `mythex-backend-staging` (t3.micro) |
| **EC2 Instance** | `i-00f618a2701b60ece` | `i-0258c2afc477f64fe` |
| **EC2 IP** | `184.33.87.6` (Elastic IP) | `54.218.57.157` |
| **Database** | RDS PostgreSQL (managed) | Postgres in Docker |
| **Redis** | Docker on EC2 | Docker on EC2 |

### ECR Repository

```
948075159962.dkr.ecr.us-west-2.amazonaws.com/mythex-backend
```

Image tags: `:latest` (prod), `:staging` (staging), `:<commit-sha>` (both)

### SSH Access
```bash
ssh -i ~/.ssh/mythex-key.pem ec2-user@184.33.87.6    # prod (mythex-backend-prod)
ssh -i ~/.ssh/mythex-key.pem ec2-user@54.218.57.157  # staging (mythex-backend-staging)
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
- **Identifier:** `mythex-db`
- **Endpoint:** `mythex-db.c746o20miixe.us-west-2.rds.amazonaws.com:5432`
- **DB name:** `mythex`
- **User:** `jsonbased`
- **Instance class:** db.t3.micro
- **Public access:** No (VPC only)
- **Connection:** requires `?sslmode=require`

### Staging — Postgres in Docker
- Runs as `postgres` container on staging EC2
- **DB name:** `josn_based_staging` / **User:** `staging`
- Data in Docker volume `app_postgres_data`

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
| CNAME | `app` | `mythex-frontend.pages.dev` | Builder (auto-set by Pages custom domain) |
| CNAME | `staging.app` | `mythex-frontend-staging.pages.dev` | Staging builder |
| A | `*` | `192.0.2.1` (dummy) | Wildcard — intercepted by Cloudflare Worker |
| A | `api` | `184.33.87.6` | Backend prod (mythex-backend-prod) |
| A | `api-staging` | `54.218.57.157` | Backend staging |

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
| `PROD_EC2_IP` | `184.33.87.6` |
| `STAGING_EC2_IP` | `54.218.57.157` |
| `EC2_SSH_KEY` | contents of `~/.ssh/mythex-key.pem` |
| `PROD_DATABASE_URL` | RDS PostgreSQL connection string |
| `STAGING_DATABASE_URL` | Staging postgres connection string |
| `PROD_JWT_SECRET` | JWT signing secret (prod) |
| `STAGING_JWT_SECRET` | JWT signing secret (staging) |
| `PROD_JWT_REFRESH_SECRET` | JWT refresh secret (prod) |
| `STAGING_JWT_REFRESH_SECRET` | JWT refresh secret (staging) |
| `ANTHROPIC_API_KEY` | Anthropic API key (shared across envs) |
| `OPENAI_API_KEY` | OpenAI API key (shared across envs) |
| `UNSPLASH_ACCESS_KEY` | Unsplash key (shared across envs) |
| `PEXELS_API_KEY` | Pexels key (shared across envs) |
| `PROD_S3_PUBLIC_BUCKET` | `mythex-public-assets` |
| `PROD_S3_PRIVATE_BUCKET` | `mythex-private-storage` |
| `STAGING_S3_PUBLIC_BUCKET` | `mythex-public-assets-staging` |
| `STAGING_S3_PRIVATE_BUCKET` | `mythex-private-storage-staging` |
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

## S3 Buckets

All in `us-west-2`. Managed by the backend (CORS configured on startup).

| Bucket | Access | Used by |
|--------|--------|---------|
| `mythex-public-assets` | Public read | Production — user-uploaded public files |
| `mythex-private-storage` | Private | Production — private attachments, AI files |
| `mythex-public-assets-staging` | Public read | Staging — user-uploaded public files |
| `mythex-private-storage-staging` | Private | Staging — private attachments, AI files |

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
ssh -i ~/.ssh/mythex-key.pem ec2-user@184.33.87.6 \
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

## AWS Cleanup — Completed

The following old resources have been removed or renamed:
- ✅ `json-based-frontend` ECR repo — deleted
- ✅ `json-based-backend` ECR repo — deleted
- ✅ EC2 `json-based-server` → renamed to `mythex-backend-prod`
- ✅ EC2 `json-based-staging` → renamed to `mythex-backend-staging`
- ✅ Elastic IP `184.33.87.6` → attached to `mythex-backend-prod`
- ✅ RDS `json-based-postgres` → renamed to `mythex-db`
- ✅ Production database `josn_based_platform` → recreated as `mythex` (clean schema, data dropped intentionally)
- ✅ `PROD_DATABASE_URL` updated to `mythex-db.c746o20miixe.us-west-2.rds.amazonaws.com/mythex?sslmode=require`
- ✅ S3 `zraiq-platform-public` → deleted, replaced with `mythex-public-assets` + `mythex-public-assets-staging`
- ✅ S3 `zraiq-platform-private` → deleted, replaced with `mythex-private-storage` + `mythex-private-storage-staging`
