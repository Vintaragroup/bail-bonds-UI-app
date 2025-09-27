# Deployment & Containerization Guide

_Last updated: 2025-01-15_

## 1. Objectives
- Provide a repeatable way to run the full stack (Node API, React front-end, supporting services) in development, staging, and production.
- Support rapid iteration in a dev sandbox without risking production stability.
- Enable CI/CD pipelines that build, scan, test, and promote immutable container images.
- Document onboarding steps so new engineers can run the stack locally and deploy with confidence.

## 2. System Overview
| Component | Tech | Responsibility | Notes |
| --- | --- | --- | --- |
| Front-end | React + Vite | Authentication UI, dashboard, admin tooling | Served via Node/Express or a static CDN in production |
| API | Node.js (Express) | REST endpoints (`/api/*`), auth middleware, MongoDB access, Firebase admin | Depends on MongoDB Atlas + Firebase project |
| Database | MongoDB Atlas | Case data, users, auth audit | External managed service |
| Identity | Firebase Auth | User records, SSO providers, ID tokens | Require service account credentials |
| Observability | TBD | Logs, metrics, traces | Placeholder until platform selected |

## 3. Containerization Strategy
1. **Base Images**
   - API: `node:20-alpine` (or company base image). Includes production dependencies only.
   - Front-end: Build with `node:20-alpine`, serve via `nginx:alpine` or Express static hosting. Decide on SSR vs. static.
2. **Multi-stage builds**
   - Stage 1: install deps (respecting `package-lock.json`), run lints/tests.
   - Stage 2: copy built assets only.
3. **Runtime configuration**
   - Environment variables provided via `.env` files in dev, secrets store in staging/prod.
   - Mount Firebase service-account JSON as secret (Kubernetes secret, AWS Secret Manager, etc.).
4. **Image tagging**
   - `asap-bail-books-api:<git-sha>` and `asap-bail-books-web:<git-sha>`.
   - Promote by retagging to `:staging` and `:prod` after validation.

## 4. Local Development (Docker Compose)
```yaml
version: '3.9'
services:
  api:
    build:
      context: ./server
      dockerfile: Dockerfile
    env_file:
      - server/.env
    volumes:
      - ./server/src:/app/src
      - ./server/openapi.yaml:/app/openapi.yaml
    ports:
      - "8080:8080"
    depends_on:
      - mongo
    command: npm run dev
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    env_file:
      - .env
    volumes:
      - ./src:/app/src
    ports:
      - "5173:5173"
    command: npm run dev -- --host
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
volumes:
  mongo-data:
```
- In dev, Firebase Auth usually uses the emulator suite; document commands to start it when ready.
- Compose targets rapid feedback. Production images should be immutable and not mount host volumes.

## 5. Production Deployment Workflow
1. **Build phase** (CI)
   - Install dependencies (`npm ci` front-end & server).
   - Run `npm run lint`, `npm run test`, `npm run build`.
   - Docker build for API & front-end (multi-stage, no dev deps).
   - Scan images (Trivy/Grype) and fail build on critical vulns.
   - Generate SBOM (Syft) for each image.
2. **Release artifacts**
   - Push images to registry (e.g., GHCR, ECR, GCR) and sign with cosign/notary for provenance.
   - Publish SBOM + vulnerability report alongside build artifacts for audit trail.
3. **Staging deployment**
   - Apply Kubernetes manifest or ECS task definition referencing new tags.
   - Run smoke tests (Cypress API checks, health endpoints, login).
   - Verify observability hooks (logs/metrics).
4. **Promotion**
   - Gate via approval.
   - Retag images to `:prod` and deploy to production cluster.
   - Run post-deploy validation + rollback plan (previous tag).

## 6. Environment Configuration
- **Common variables**
  - `NODE_ENV`, `PORT`, `MONGO_URI`, `MONGO_DB`, `SESSION_SECRET`.
  - `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` (path or JSON), `WEB_ORIGIN`.
  - Front-end `VITE_API_URL`, `VITE_FIREBASE_*` keys.
- **Secrets Management**
  - Dev: `.env` checked into repo with sample values (`.env.example`).
  - Staging/Prod: use secret manager (AWS Parameter Store, GCP Secret Manager) or Kubernetes Secrets.
  - Rotate service-account keys periodically; prefer Workload Identity over static keys if policy allows.
  - Enforce least-privilege IAM bindings for Firebase admin, Mongo Atlas, and CI/CD service accounts; document approvals.

## 7. Testing & Quality Gates
- **Unit/Integration Tests**
  - API: Jest/Supertest or Vitest to cover auth flows, role checks, metadata endpoints.
  - Front-end: React Testing Library for auth context, Cypress for end-to-end login flows.
- **Security Checks**
  - Dependency scanning (npm audit, Snyk).
  - Container vulnerability scan (Trivy, Grype).
  - Lint for secret leaks (gitleaks) before merge.
  - Verify image signatures and archive SBOM attestation to support SOC2 evidence requests.
- **Performance**
  - Optional load tests on `/api/dashboard` and login endpoints.

## 8. Onboarding Checklist
1. Install prerequisites (Docker, Node, npm, Firebase CLI).
2. Clone repo, run `npm install` at root and `npm install` in `server/`.
3. Copy `.env.example` files and set local credentials.
4. Start Docker Compose (`docker compose up api web mongo`).
5. Seed initial SuperUser (existing script in `server/scripts/create-firebase-user.mjs`).
6. Verify front-end at `http://localhost:5173` and API docs at `http://localhost:8080/api/docs`.

## 9. Security & Compliance Considerations
- Maintain policy-aligned change management: feature branches → PR review → CI evidence stored (build logs, test results).
- Keep infrastructure-as-code (Terraform/Helm) versioned for auditability; record deploy approvals (aligns with SOC2 CC7/CC8).
- Centralize logs/metrics with retention policies that satisfy SOC2/GDPR needs; enable immutable auth audit logging exports.
- Enforce MFA on all privileged accounts (Firebase Console, Mongo Atlas, CI/CD, registry) and document rotation cadence for secrets.
- Run scheduled vulnerability assessments/penetration tests; track remediation through ticketing with due dates.
- Document disaster recovery (Mongo snapshots, Firebase export strategy) and rehearse at least annually.
- Ensure vendor risk assessments for Firebase, MongoDB Atlas, hosting provider, and any third-party auth plugins are current.

## 10. Outstanding Decisions
- Choose hosting target: Kubernetes (GKE/EKS), ECS Fargate, or managed PaaS (Render, Fly.io).
- Observability stack (Datadog, Grafana/Loki, OpenTelemetry collector).
- CDN strategy for front-end assets (CloudFront, Cloudflare) vs. Express static serving.
- Blue/green vs. rolling update strategy for API.

---
_Primary owners: DevOps + Application Engineering. Update this doc as infrastructure decisions solidify._
