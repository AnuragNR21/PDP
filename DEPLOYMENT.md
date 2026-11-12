# Deployment

Deployments only happen when someone starts one. Merging to `master` deploys nothing.

In Bitbucket, go to **Pipelines → Run pipeline** and choose:
- **Branch**: any branch
- **Pipeline**: `custom: deploy-to-dev` or `custom: deploy-to-prod`

| Environment | Backend (AppRunner) | Frontend (Amplify) | Database |
|-------------|--------------------|--------------------|----------|
| Dev | `PDP-Greenfield-Backend`, runs `pdp:latest` | https://dev.powerdataplatform.com.au | Aurora `pdp-greenfield-dev-db` |
| Production | `pdp-prod-backend`, runs `pdp:prod` | https://app.powerdataplatform.com.au | Aurora `pdp-prod` (private) |

All of it is in AWS account `342882684671`, region `ap-southeast-2`, and is managed by hand. What
exists, and how to change it, is in [infra/README.md](infra/README.md).

Both frontends are branches of one Amplify app, `PDP - Webapp`. Amplify builds the branches
`dev-fe-deployment` and `prod-fe-deployment`, each with its own `VITE_API_BASE_URL`. **Those two
branches belong to the pipeline: never commit, push or open pull requests from them.** The pipeline
force-pushes the commit being deployed onto them.

## Pipeline

| Pipeline | Steps |
|----------|-------|
| `deploy-to-dev` | 1. **Build backend image** 2. **Deploy to dev** |
| `deploy-to-prod` | 1. **Build backend image** 2. **Deploy to production** |
| Pull requests (automatic) | Run backend tests |

**Build backend image** ([cicd/build-backend.sh](cicd/build-backend.sh)) pushes `pdp:<commit sha>`.
A commit is built only once. If its image already exists, for example because it was deployed to
dev first, the image is reused, so production runs exactly what dev ran.

**Deploy** is the same script for both environments, [cicd/deploy.sh](cicd/deploy.sh). Bitbucket
deployment variables are the only difference between them. It does this in order, and stops at the
first failure:
1. Points the environment's image tag (`IMAGE_TAG`) at the commit's image ([cicd/deploy-backend.sh](cicd/deploy-backend.sh)).
2. Redeploys the environment's AppRunner service, waits for it, and checks `/api/platform/health`.
3. Force-pushes the commit to the environment's deployment branch (`AMPLIFY_BRANCH`). Amplify builds and publishes it; the step waits for that build and fails if it fails ([cicd/deploy-frontend.sh](cicd/deploy-frontend.sh)). The backend is always deployed first.
4. Production only: tags the commit `prod-<build number>` in git, so the tags show what has been released ([cicd/tag-release.sh](cicd/tag-release.sh)).

The scripts read their inputs from environment variables, so you can run them from your machine with the same values.

### Typical release

1. Merge the pull request to `master`.
2. Run `deploy-to-dev` on `master` and check the change on dev.
3. Run `deploy-to-prod` on `master`. If nothing was merged in between, this reuses the image dev ran.

To try a feature branch on dev before merging, run `deploy-to-dev` on that branch.

### Rolling back

Either:
- **Deployments → Production**: open an earlier release and click **Redeploy**, or
- **Commits**: open the last good commit and use **Run pipeline → deploy-to-prod**.

The image for an earlier commit already exists, so nothing is rebuilt. To see what is live, find the
newest `prod-*` tag: `git fetch --tags && git tag -l 'prod-*' --sort=-v:refname | head -1`.

Rolling back the code does not roll back the database. A release that changed the schema may
need a forward fix instead.

## Bitbucket configuration

**Repository settings → Repository variables** (used by every step):

| Variable | Value | Secured |
|----------|-------|---------|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | keys of IAM user `bitbucket-deployer` | ✓ |
| `AWS_ACCOUNT_ID` | `342882684671` | |
| `AWS_REGION` | `ap-southeast-2` | |
| `ECR_REPOSITORY_NAME` | `pdp` | |

**Repository settings → Deployments**: the same variables in each environment.

| Variable | Test (dev) | Production |
|----------|-----------|------------|
| `IMAGE_TAG` | `latest` | `prod` |
| `APPRUNNER_SERVICE_ARN` | `arn:aws:apprunner:ap-southeast-2:342882684671:service/PDP-Greenfield-Backend/afb209237f364d918e44e652b81b148c` | `arn:aws:apprunner:ap-southeast-2:342882684671:service/pdp-prod-backend/18546360af354aa4982636216bf3ed11` |
| `API_BASE_URL` | `https://pgezstywkm.ap-southeast-2.awsapprunner.com` | `https://yepkyypbxk.ap-southeast-2.awsapprunner.com` |
| `AMPLIFY_APP_ID` | `d211z5zlnjzk1b` | `d211z5zlnjzk1b` |
| `AMPLIFY_BRANCH` | `dev-fe-deployment` | `prod-fe-deployment` |

Optional: `SKIP_FRONTEND=true` in an environment deploys its backend only.

If a repository-level `APPRUNNER_SERVICE_ARN` is left over from the old pipeline, delete it.

Recommended: because any branch can be deployed to production, set **Deployments → Production →
Branches allowed to deploy** to `master` (deployment permissions per user need Bitbucket Premium).
Branch restrictions on `dev-fe-deployment` / `prod-fe-deployment` must still allow the pipeline to force-push.

## Backend configuration

The app reads every setting with the `PDP_` prefix (see `backend/app/config.py`).

| Variable | Notes |
|----------|-------|
| `PDP_DATABASE_URL` | Postgres connection URL |
| `PDP_JWT_SECRET` | Long random value, unique per environment. Rotating it signs everyone out |
| `PDP_JWT_HOURS` | Access token lifetime (default `8`) |
| `PDP_BOOTSTRAP_SUPERADMIN_EMAIL` / `_PASSWORD` | The Super Admin seeded on first start. The password must be changed at first sign-in |
| `PDP_FRONTEND_BASE_URL` | Public frontend URL, used in invitation and password-reset links |
| `PDP_ALLOWED_ORIGINS` | JSON list of CORS origins, e.g. `["https://prod-fe-deployment.d211z5zlnjzk1b.amplifyapp.com"]` |
| `PDP_INVITATION_DAYS` / `PDP_PASSWORD_RESET_HOURS` | How long those links stay valid (defaults `7` and `2`) |
| `PDP_BUILD_ID` / `_COMMIT` / `_TIME` | Built into the image by the pipeline, shown in Admin > Application Information |

Each environment sets these in its definition file, [infra/prod/apprunner-service.json](infra/prod/apprunner-service.json)
or [infra/dev/apprunner-service.json](infra/dev/apprunner-service.json). Secrets come from Secrets Manager
(`pdp-prod/*`, `pdp-dev/*`).

## Troubleshooting

- **"Image pdp:<commit> not found" in the deploy step**: the build step didn't push. Run the pipeline again from the start.
- **AppRunner deployment fails**: look at the service's application logs in CloudWatch (`/aws/apprunner/<service>/<id>/application`). It's usually a missing or invalid `PDP_*` value, or the database is unreachable.
- **Frontend loads but API calls fail with CORS errors**: `PDP_ALLOWED_ORIGINS` doesn't include the frontend's URL.
- **Frontend step fails**: open the Amplify console → `PDP - Webapp` → the deployment branch → the failed build for its log.
- **Frontend calls the wrong API**: check the branch's `VITE_API_BASE_URL` in Amplify (App settings → Environment variables).
- **Check an image locally**: `docker build backend -t pdp:local && docker run -p 8000:8000 -e PDP_DATABASE_URL=... pdp:local`
