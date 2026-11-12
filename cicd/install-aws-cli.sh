#!/usr/bin/env bash
# Install AWS CLI v2 in a CI container (no-op when it is already there).
set -euo pipefail

if command -v aws >/dev/null 2>&1; then
  exit 0
fi

apt-get update -qq && apt-get install -y -qq unzip zip >/dev/null
curl -sSf https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install >/dev/null
aws --version
