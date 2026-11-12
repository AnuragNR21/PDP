#!/usr/bin/env bash
# Build the backend image for this commit and push it as pdp:<commit sha>.
# A commit is built only once: if its image already exists (for example it was deployed
# to dev before), it is reused, so production runs exactly the image dev ran.
# The deploy step then moves the environment's tag to it (see deploy-backend.sh).
#
# Needs: AWS_ACCOUNT_ID, AWS_REGION, ECR_REPOSITORY_NAME, BITBUCKET_BUILD_NUMBER, BITBUCKET_COMMIT
set -euo pipefail

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE="${REGISTRY}/${ECR_REPOSITORY_NAME}:${BITBUCKET_COMMIT}"

if aws ecr describe-images --region "$AWS_REGION" --repository-name "$ECR_REPOSITORY_NAME" \
     --image-ids "imageTag=${BITBUCKET_COMMIT}" >/dev/null 2>&1; then
  echo "${IMAGE} already exists; reusing it"
  exit 0
fi

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"

# Build info is shown in Admin > Application Information
docker build backend \
  --build-arg "PDP_BUILD_ID=${BITBUCKET_BUILD_NUMBER}" \
  --build-arg "PDP_BUILD_COMMIT=${BITBUCKET_COMMIT}" \
  --build-arg "PDP_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "$IMAGE"

docker push "$IMAGE"
echo "Pushed ${IMAGE}"
