#!/usr/bin/env bash
# One deploy step for every environment. Bitbucket supplies the per-environment values
# from Repository settings > Deployments > <environment> (see DEPLOYMENT.md):
#   IMAGE_TAG, APPRUNNER_SERVICE_ARN, API_BASE_URL, AMPLIFY_APP_ID, AMPLIFY_BRANCH
# Optional: SKIP_FRONTEND=true deploys the backend only (then the AMPLIFY_* values aren't needed).
set -euo pipefail

CI_DIR="$(cd "$(dirname "$0")" && pwd)"
export AWS_DEFAULT_REGION="${AWS_REGION:?}"

REQUIRED=(ECR_REPOSITORY_NAME IMAGE_TAG APPRUNNER_SERVICE_ARN API_BASE_URL)
if [ "${SKIP_FRONTEND:-false}" != "true" ]; then
  REQUIRED+=(AMPLIFY_APP_ID AMPLIFY_BRANCH)
fi
for var in "${REQUIRED[@]}"; do
  [ -n "${!var:-}" ] || { echo "Missing deployment variable: $var"; exit 1; }
done

echo "Deploying ${BITBUCKET_BRANCH:-?} @ ${BITBUCKET_COMMIT} to ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-local}"

"$CI_DIR/install-aws-cli.sh"
"$CI_DIR/deploy-backend.sh"

if [ "${SKIP_FRONTEND:-false}" = "true" ]; then
  echo "SKIP_FRONTEND=true: frontend not deployed"
else
  "$CI_DIR/deploy-frontend.sh"
fi

if [ "${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-}" = "production" ]; then
  "$CI_DIR/tag-release.sh"
fi
