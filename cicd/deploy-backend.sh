#!/usr/bin/env bash
# Point the environment's image tag (IMAGE_TAG: latest for dev, prod for production) at this
# commit's image, redeploy its AppRunner service, wait for it, and check the health endpoint.
#
# Needs: ECR_REPOSITORY_NAME, BITBUCKET_COMMIT, IMAGE_TAG, APPRUNNER_SERVICE_ARN, API_BASE_URL
set -euo pipefail

BUILD_TAG="${BITBUCKET_COMMIT}"

# ── 1. Promote the image (no rebuild) ─────────────────────────────────────
IMAGE_ARGS=(--repository-name "$ECR_REPOSITORY_NAME" --image-ids "imageTag=${BUILD_TAG}")
MANIFEST=$(aws ecr batch-get-image "${IMAGE_ARGS[@]}" --query 'images[0].imageManifest' --output text)
MEDIA_TYPE=$(aws ecr batch-get-image "${IMAGE_ARGS[@]}" --query 'images[0].imageManifestMediaType' --output text)
if [ -z "$MANIFEST" ] || [ "$MANIFEST" = "None" ]; then
  echo "Image ${ECR_REPOSITORY_NAME}:${BUILD_TAG} not found. Re-run the pipeline from the build step."
  exit 1
fi

if aws ecr put-image --repository-name "$ECR_REPOSITORY_NAME" --image-tag "$IMAGE_TAG" \
     --image-manifest "$MANIFEST" --image-manifest-media-type "$MEDIA_TYPE" \
     >/dev/null 2>/tmp/put-image.err; then
  echo "${ECR_REPOSITORY_NAME}:${IMAGE_TAG} -> ${BUILD_TAG}"
else
  grep -q ImageAlreadyExistsException /tmp/put-image.err || { cat /tmp/put-image.err; exit 1; }
  echo "${ECR_REPOSITORY_NAME}:${IMAGE_TAG} already points at ${BUILD_TAG}"
fi

# ── 2. Redeploy and wait ──────────────────────────────────────────────────
aws apprunner start-deployment --service-arn "$APPRUNNER_SERVICE_ARN" >/dev/null
echo "AppRunner deployment started"

sleep 20
for _ in $(seq 1 90); do
  STATUS=$(aws apprunner describe-service --service-arn "$APPRUNNER_SERVICE_ARN" --query 'Service.Status' --output text)
  [ "$STATUS" = "RUNNING" ] && break
  [ "$STATUS" = "OPERATION_IN_PROGRESS" ] || { echo "AppRunner status: $STATUS"; exit 1; }
  sleep 10
done

OUTCOME=$(aws apprunner list-operations --service-arn "$APPRUNNER_SERVICE_ARN" --max-results 1 \
  --query 'OperationSummaryList[0].Status' --output text)
echo "Backend deployment: $OUTCOME"
[ "$OUTCOME" = "SUCCEEDED" ] || exit 1

# ── 3. Health check ───────────────────────────────────────────────────────
curl -sSf --retry 5 --retry-delay 5 --retry-all-errors "${API_BASE_URL}/api/platform/health"
echo
