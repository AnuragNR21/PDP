#!/usr/bin/env bash
# Deploy the frontend by moving the environment's deployment branch (AMPLIFY_BRANCH, e.g.
# dev-fe-deployment or prod-fe-deployment) to this commit. Amplify watches that branch, builds
# it with the branch's own VITE_API_BASE_URL, and publishes it. This script waits for that
# build and fails if it fails.
#
# The deployment branches are owned by the pipeline: never commit or push to them by hand.
#
# Needs: AMPLIFY_APP_ID, AMPLIFY_BRANCH, BITBUCKET_COMMIT
set -euo pipefail

COMMIT="$BITBUCKET_COMMIT"
AMPLIFY_ARGS=(--app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH")

# ── 1. Point the deployment branch at this commit ────────────────────────
CURRENT=$(git ls-remote origin "refs/heads/${AMPLIFY_BRANCH}" | cut -f1)

if [ "$CURRENT" = "$COMMIT" ]; then
  # Same commit as last time (re-deploy): a push would change nothing, so ask Amplify to rebuild.
  echo "${AMPLIFY_BRANCH} already at ${COMMIT}; asking Amplify to rebuild"
  aws amplify start-job "${AMPLIFY_ARGS[@]}" --job-type RELEASE --job-reason "Pipeline re-deploy of ${COMMIT}" >/dev/null
else
  git push --force origin "${COMMIT}:refs/heads/${AMPLIFY_BRANCH}"
  echo "${AMPLIFY_BRANCH} -> ${COMMIT}"
fi

# ── 2. Find Amplify's build of this commit ────────────────────────────────
JOB_ID=""
for _ in $(seq 1 30); do
  JOB_ID=$(aws amplify list-jobs "${AMPLIFY_ARGS[@]}" --max-items 10 \
    --query "jobSummaries[?commitId=='${COMMIT}'] | [0].jobId" --output text)
  [ -n "$JOB_ID" ] && [ "$JOB_ID" != "None" ] && break
  JOB_ID=""
  sleep 10
done
[ -n "$JOB_ID" ] || { echo "Amplify didn't start a build for ${COMMIT} on ${AMPLIFY_BRANCH} within 5 minutes"; exit 1; }
echo "Amplify job ${JOB_ID} is building ${COMMIT}"

# ── 3. Wait for it ────────────────────────────────────────────────────────
STATUS=""
for _ in $(seq 1 90); do
  STATUS=$(aws amplify get-job "${AMPLIFY_ARGS[@]}" --job-id "$JOB_ID" --query 'job.summary.status' --output text)
  case "$STATUS" in
    SUCCEED) break ;;
    FAILED|CANCELLED) echo "Amplify job ${JOB_ID}: ${STATUS} (see the Amplify console for the build log)"; exit 1 ;;
  esac
  sleep 10
done

echo "Frontend deployment: ${STATUS}"
[ "$STATUS" = "SUCCEED" ]
