# PDP infrastructure

Everything runs in AWS account `342882684671`, region `ap-southeast-2`. All of it is managed by hand
with the AWS CLI or console; there is no Terraform. This page is the record of what exists and how
to recreate or change it. **Update it whenever you change the infrastructure.**

To inspect the live setup, ask Claude Code (it reads AWS through the `aws-inovaantage` MCP) or use the
CLI with `--profile inovaantage` (`aws login --profile inovaantage` when the session expires).

How code gets deployed is in [DEPLOYMENT.md](../DEPLOYMENT.md).

## At a glance

| | Dev | Production |
|---|---|---|
| Backend | AppRunner `PDP-Greenfield-Backend` (image `pdp:latest`) | AppRunner `pdp-prod-backend` (image `pdp:prod`) |
| Frontend | Amplify `PDP - Webapp`, branch `dev-fe-deployment` | Amplify `PDP - Webapp`, branch `prod-fe-deployment` |
| Database | Aurora `pdp-greenfield-dev-db` (public) | Aurora `pdp-prod` (private) |
| Secrets | Secrets Manager `pdp-dev/*` | Secrets Manager `pdp-prod/*` |
| Network | Default VPC | VPC `pdp-prod` |

Shared: ECR repository `pdp`, IAM user `bitbucket-deployer` (keys in Bitbucket).

## Production

All production resources are tagged `Project=pdp`, `Environment=prod`, `ManagedBy=manual`
(created 2026-11-09).

### Network

| Resource | ID | Settings |
|---|---|---|
| VPC | `vpc-0b3ed13d7621cd08d` | `10.42.0.0/16`, DNS support and hostnames on. No internet gateway, no NAT |
| Subnet | `subnet-045e437f3e462bf24` | `10.42.0.0/24`, ap-southeast-2a, private |
| Subnet | `subnet-0c4d0003e91dd2008` | `10.42.1.0/24`, ap-southeast-2b, private |
| Security group `pdp-prod-apprunner` | `sg-0c9932b08442a2bd4` | No inbound. Outbound TCP 5432 to `10.42.0.0/16` |
| Security group `pdp-prod-db` | `sg-06fed91bd3d2f2c58` | Inbound TCP 5432 from `pdp-prod-apprunner` only |
| AppRunner VPC connector `pdp-prod` | `…/vpcconnector/pdp-prod/1/d822609de1e449949dc544945121dcc5` | Both subnets, SG `pdp-prod-apprunner` |

The API makes no outbound internet calls, so it needs no NAT. AppRunner pulls the image and the
secrets on the service side, outside this VPC.

### Database

| Setting | Value |
|---|---|
| Cluster | `pdp-prod`, Aurora PostgreSQL 17.9, Serverless v2 0.5–8 ACU |
| Instance | `pdp-prod-1`, `db.serverless`, not publicly accessible, Performance Insights on |
| Endpoint | `pdp-prod.cluster-cxc4ckevrmjf.ap-southeast-2.rds.amazonaws.com:5432`, database `pdp`, user `pdp_admin` |
| Subnet group | `pdp-prod` (both private subnets) |
| Parameter group | `pdp-prod-aurora-pg17` (family `aurora-postgresql17`, `rds.force_ssl = 1`) |
| Protection | Encrypted, deletion protection on, 14-day backups at 15:00–16:00 UTC, maintenance Sun 16:30–17:30 UTC, Postgres logs to CloudWatch |

**Data:** on 2026-11-10 prod's data was replaced by a copy of dev's (all 97 shared tables, 473,320 rows,
verified table by table; users included, so prod's accounts and passwords are dev's). Dev's two legacy tables
`relationship_instance` (3 rows) and `support_domain_element_structure_link` (empty) don't exist in prod and
weren't copied. The copy ran from a temporary instance inside the VPC, which was deleted afterwards.

To scale it: `aws rds modify-db-cluster --db-cluster-identifier pdp-prod --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=16 --apply-immediately`

The database is private. To run SQL by hand you need something inside the VPC, for example a
temporary CloudShell VPC environment in the `pdp-prod` subnets with the `pdp-prod-apprunner` security group.

### Secrets (Secrets Manager)

| Secret | Used as | Notes |
|---|---|---|
| `pdp-prod/database-url` | `PDP_DATABASE_URL` | `postgresql://pdp_admin:<password>@<endpoint>:5432/pdp?sslmode=require` |
| `pdp-prod/jwt-secret` | `PDP_JWT_SECRET` | 64 random characters. Changing it signs everyone out |
| `pdp-prod/bootstrap-superadmin-password` | `PDP_BOOTSTRAP_SUPERADMIN_PASSWORD` | First-use password of `admin@solutionadvisor.com.au` |

Read one: `aws secretsmanager get-secret-value --secret-id pdp-prod/bootstrap-superadmin-password --query SecretString --output text --profile inovaantage`

Change the database password (in both places, then redeploy the backend):
```bash
NEW=$(openssl rand -hex 20)
aws rds modify-db-cluster --db-cluster-identifier pdp-prod --master-user-password "$NEW" --apply-immediately
aws secretsmanager put-secret-value --secret-id pdp-prod/database-url \
  --secret-string "postgresql://pdp_admin:${NEW}@pdp-prod.cluster-cxc4ckevrmjf.ap-southeast-2.rds.amazonaws.com:5432/pdp?sslmode=require"
```

AppRunner reads secrets only when an instance starts, so redeploy after changing one.

### IAM

| Role | Trusted by | Permissions |
|---|---|---|
| `pdp-prod-apprunner-ecr-access` | `build.apprunner.amazonaws.com` | `AWSAppRunnerServicePolicyForECRAccess` (pull the image) |
| `pdp-prod-apprunner-instance` | `tasks.apprunner.amazonaws.com` | Inline `read-pdp-prod-secrets`: `secretsmanager:GetSecretValue` on the three `pdp-prod/*` secrets |

`bitbucket-deployer` has `AmazonEC2ContainerRegistryPowerUser` and `AWSAppRunnerFullAccess`, which
cover building and deploying backends, plus one inline policy per environment to watch and restart that environment's frontend builds:
`pdp-amplify-deploy-prod` ([prod/pipeline-amplify-policy.json](prod/pipeline-amplify-policy.json)) and
`pdp-amplify-deploy-dev` ([dev/pipeline-amplify-policy.json](dev/pipeline-amplify-policy.json)). Apply a change with
`aws iam put-user-policy --user-name bitbucket-deployer --policy-name pdp-amplify-deploy-<env> --policy-document file://infra/<env>/pipeline-amplify-policy.json --profile inovaantage`.

### Backend (AppRunner)

Service `pdp-prod-backend`, created 2026-11-09. CORS allows `https://app.powerdataplatform.com.au` and the
`prod-fe-deployment…` URL; invitation links use `https://app.powerdataplatform.com.au`.
- ARN `arn:aws:apprunner:ap-southeast-2:342882684671:service/pdp-prod-backend/18546360af354aa4982636216bf3ed11`
- URL `https://yepkyypbxk.ap-southeast-2.awsapprunner.com`

Autoscaling configuration `pdp-prod` (revision 1): 1–3 instances, 100 concurrent requests each.
The service definition is [prod/apprunner-service.json](prod/apprunner-service.json): 2 vCPU / 4 GB,
port 8000, health check `GET /api/platform/health`, egress through the VPC connector, secrets from above.

## Frontend (Amplify)

One app, `PDP - Webapp` (`d211z5zlnjzk1b`), connected to `bitbucket.org/solution-advisor/core`. It builds
with `npm ci && npm run build` in `frontend/` and publishes `frontend/dist`. An app-level rewrite
(`/<*>` → `/index.html`, 404-200) handles page routes.

| Amplify branch | Stage | Auto-build | `VITE_API_BASE_URL` | URL |
|---|---|---|---|---|
| `dev-fe-deployment` | Development | on | `https://pgezstywkm.ap-southeast-2.awsapprunner.com` | **https://dev.powerdataplatform.com.au** (also https://dev-fe-deployment.d211z5zlnjzk1b.amplifyapp.com) |
| `prod-fe-deployment` | Production | on | `https://yepkyypbxk.ap-southeast-2.awsapprunner.com` | **https://app.powerdataplatform.com.au** (also https://prod-fe-deployment.d211z5zlnjzk1b.amplifyapp.com) |

The git branches `dev-fe-deployment` and `prod-fe-deployment` belong to the pipeline, which force-pushes
the deployed commit onto them (see [DEPLOYMENT.md](../DEPLOYMENT.md)). Each branch's `VITE_API_BASE_URL`
overrides the value in `frontend/.env.production` at build time.

**Custom domain:** `app.powerdataplatform.com.au` → `prod-fe-deployment`, Amplify-managed certificate, root domain not
mapped (added 2026-11-10). DNS for `powerdataplatform.com.au` is at Bluehost (registrar Melbourne IT), not Route 53, so its
two CNAME records are kept there by hand: `app` → `d1emo2k9prevxy.cloudfront.net`, and the certificate validation record
`_241a29001a26bc6132cba6a29f9d5932` → `_6b2d0289f01361ddce9aa3fc0d4e5773.wzccmgtwzk.acm-validations.aws`. Keep both;
the second one renews the certificate. Status: `aws amplify get-domain-association --app-id d211z5zlnjzk1b --domain-name powerdataplatform.com.au --profile inovaantage`

`dev.powerdataplatform.com.au` is registered separately (its own Amplify domain and certificate, root → `dev-fe-deployment`).
Its Bluehost records: `dev` → `d2qh2aydehb3gf.cloudfront.net`, and the certificate validation record
`_cd8970a6b63282b87722dcb088412f23.dev` → `_3a634e542d0a3e5d8aefb2480fa136af.wzccmgtwzk.acm-validations.aws`.

To point a frontend at a different API:
`aws amplify update-branch --app-id d211z5zlnjzk1b --branch-name prod-fe-deployment --environment-variables VITE_API_BASE_URL=https://… --profile inovaantage`
then redeploy it.

The old dev URL `https://master.d211z5zlnjzk1b.amplifyapp.com` was retired on 2026-11-10 (the Amplify `master`
branch was deleted). It is still listed in the dev backend's `PDP_ALLOWED_ORIGINS` and in `allowed_origins` in
`backend/app/config.py`; both entries are harmless and can be removed whenever convenient.

## Account limits

- **Fargate on-demand vCPU: 6** (AppRunner runs on it). Dev and prod use 2 each, and a deploy briefly
  needs 2 more, so only one service can deploy at a time and prod can't scale past 2 instances.
  An increase to 16 was requested on 2026-11-10 (request `64a6791ad96047f3b3ed474d554a21952kwvnaO4`).
  Check it: `aws service-quotas get-service-quota --service-code fargate --quota-code L-3032A538 --profile inovaantage`
- **AppRunner: two services per region.** Dev and prod use both slots (`GP4-Backend-Dev` was deleted
  on 2026-11-09 to make room). Ask AWS Support to raise it before adding a service.
- **Amplify `CreateApp`** was rejected on 2026-11-09 (`LimitExceededException` / "Rate exceeded", with
  1 app in the account). Not needed by the current setup; a Support case was opened.

## Changing a backend

Each backend has a definition file: [prod/apprunner-service.json](prod/apprunner-service.json) and
[dev/apprunner-service.json](dev/apprunner-service.json). They hold settings and secret ARNs, never
secret values. Edit the file, commit it, then apply it:
```bash
ENV=prod   # or dev
NAME=$(python3 -c "import json; print(json.load(open('infra/$ENV/apprunner-service.json'))['ServiceName'])")
ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='$NAME'].ServiceArn" --output text --profile inovaantage)
python3 -c "import json; d=json.load(open('infra/$ENV/apprunner-service.json')); [d.pop(k, None) for k in ('ServiceName','Tags')]; print(json.dumps(d))" > /tmp/pdp-update.json
aws apprunner update-service --service-arn "$ARN" --cli-input-json file:///tmp/pdp-update.json --profile inovaantage
```
That restarts the service with the new settings. Its image tag (`prod` or `latest`) stays the same; the
pipeline decides which build it points at. Change one backend at a time (see [Account limits](#account-limits)).

## Dev

Dev predates this page. Its backend and frontend follow the production layout; its database and
network don't.

| Resource | Notes |
|---|---|
| AppRunner `PDP-Greenfield-Backend` | Defined in [dev/apprunner-service.json](dev/apprunner-service.json): 2 vCPU / 4 GB, runs `pdp:latest`, HTTP health check `/api/platform/health`, default (public) egress, default autoscaling |
| Secrets Manager `pdp-dev/database-url`, `pdp-dev/jwt-secret`, `pdp-dev/bootstrap-superadmin-password` | Moved out of plain env vars on 2026-11-10. Read them as for prod, with `pdp-dev/…` |
| IAM role `pdp-dev-apprunner-instance` | Trusted by `tasks.apprunner.amazonaws.com`; inline `read-pdp-dev-secrets` allows `GetSecretValue` on those three secrets only |
| Image access | Shared role `service-role/AppRunnerECRAccessRole` |
| CORS | `PDP_ALLOWED_ORIGINS` allows `https://dev.powerdataplatform.com.au`, the `dev-fe-deployment…` URL and the old `master…` URL. Invitation links use `https://dev.powerdataplatform.com.au` |
| Aurora `pdp-greenfield-dev-db` | PostgreSQL 17.9 Serverless v2, 2–16 ACU, publicly accessible, **not encrypted**, no deletion protection, 7-day backups. Not in a definition file |

## Cost

Production at the current sizes costs roughly US$130–250 a month, depending on traffic. Aurora at its
0.5 ACU minimum is about US$70–80 of that. AppRunner charges for memory while idle and for vCPU while
handling requests.

## Deleting production

The Aurora cluster has deletion protection, and deleting it should take a final snapshot:
```bash
aws rds modify-db-cluster --db-cluster-identifier pdp-prod --no-deletion-protection --apply-immediately
aws rds delete-db-instance --db-instance-identifier pdp-prod-1
aws rds delete-db-cluster --db-cluster-identifier pdp-prod --final-db-snapshot-identifier pdp-prod-final
```
Then delete, in this order: the AppRunner service, VPC connector, autoscaling configuration, security
groups, subnet group, subnets, VPC, parameter group, secrets, IAM roles.
