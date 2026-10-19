#!/usr/bin/env bash
# Prepares the ephemeral SonarQube Community container started by the CI job:
#   1. waits until the server is UP
#   2. replaces the default admin password with a random one (never stored)
#   3. creates the project and the "PayFlex Gate" quality gate matching the TP thresholds
#   4. generates an analysis token and exports SONAR_TOKEN for the next steps
set -euo pipefail

HOST="${SONAR_HOST_URL:-http://localhost:9000}"
PROJECT_KEY="${SONAR_PROJECT_KEY:-payflex-api}"
GATE="PayFlex Gate"

echo "Waiting for SonarQube at $HOST ..."
for _ in $(seq 1 90); do
  if curl -fs "$HOST/api/system/status" | grep -q '"status":"UP"'; then break; fi
  sleep 5
done
curl -fs "$HOST/api/system/status" | grep -q '"status":"UP"' || { echo "SonarQube did not start"; exit 1; }
echo "SonarQube is UP"

ADMIN_PASSWORD="$(openssl rand -hex 16)Aa1!"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$ADMIN_PASSWORD"
# admin:admin is SonarQube's public factory default, replaced right below.
curl -fs -u admin:admin -X POST "$HOST/api/users/change_password" --data-urlencode "login=admin" --data-urlencode "previousPassword=admin" --data-urlencode "password=$ADMIN_PASSWORD" # gitleaks:allow
AUTH="admin:$ADMIN_PASSWORD"

api() { curl -fs -u "$AUTH" -X POST "$HOST/api/$1" "${@:2}" > /dev/null; }

api projects/create --data-urlencode "project=$PROJECT_KEY" --data-urlencode "name=PayFlex API"
api qualitygates/create --data-urlencode "name=$GATE"
# coverage < 70 % -> ERROR ; reliability/security rating D or E (critical/blocker bug or vulnerability) -> ERROR
api qualitygates/create_condition --data-urlencode "gateName=$GATE" -d metric=coverage -d op=LT -d error=70
api qualitygates/create_condition --data-urlencode "gateName=$GATE" -d metric=reliability_rating -d op=GT -d error=3
api qualitygates/create_condition --data-urlencode "gateName=$GATE" -d metric=security_rating -d op=GT -d error=3
api qualitygates/select --data-urlencode "gateName=$GATE" --data-urlencode "projectKey=$PROJECT_KEY"
echo "Project $PROJECT_KEY created with quality gate '$GATE'"

TOKEN="$(curl -fs -u "$AUTH" -X POST "$HOST/api/user_tokens/generate" --data-urlencode "name=ci-$(date +%s)" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')"
[ -n "$TOKEN" ] || { echo "Token generation failed"; exit 1; }
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "::add-mask::$TOKEN"
  echo "SONAR_TOKEN=$TOKEN" >> "$GITHUB_ENV"
else
  echo "SONAR_TOKEN=$TOKEN"
fi
