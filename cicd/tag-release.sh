#!/usr/bin/env bash
# Tag the released commit as prod-<build number> so git shows what production runs.
# Re-deploying or rolling back to an already tagged build leaves the tag alone.
#
# Needs: BITBUCKET_BUILD_NUMBER, BITBUCKET_COMMIT
set -euo pipefail

RELEASE_TAG="prod-${BITBUCKET_BUILD_NUMBER}"

if git ls-remote --exit-code --tags origin "refs/tags/${RELEASE_TAG}" >/dev/null; then
  echo "${RELEASE_TAG} already exists (re-deploy or rollback)"
else
  git tag "$RELEASE_TAG" "$BITBUCKET_COMMIT"
  git push origin "refs/tags/${RELEASE_TAG}"
  echo "Tagged ${BITBUCKET_COMMIT} as ${RELEASE_TAG}"
fi
