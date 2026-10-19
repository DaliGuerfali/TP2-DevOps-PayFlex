#!/usr/bin/env bash
# DEMO ONLY - scenario "data-leak".
# Simulates a developer mistake: a config file with credentials and a customer card
# number ends up in the build. Every value is random and generated at runtime, so no
# secret is ever committed to the repository. The artifact scan must catch it.
set -euo pipefail

target="src/config/legacy-gateway.js"
mkdir -p "$(dirname "$target")"

rand() { LC_ALL=C tr -dc "$1" < /dev/urandom | head -c "$2"; }

# Random Visa-like PAN with a valid Luhn checksum (not a public test number).
luhn_pan() {
  local body="4$(rand '0-9' 14)" sum=0 digit
  for ((i = ${#body} - 1, pos = 0; i >= 0; i--, pos++)); do
    digit=${body:i:1}
    if (( pos % 2 == 0 )); then digit=$((digit * 2)); (( digit > 9 )) && digit=$((digit - 9)); fi
    sum=$((sum + digit))
  done
  echo "${body}$(( (10 - sum % 10) % 10 ))"
}

private_key="$(openssl genrsa 2048 2>/dev/null)"

cat > "$target" <<EOF
// TODO remove before release - legacy payment gateway credentials
module.exports = {
  stripeSecretKey: 'sk_live_$(rand 'a-zA-Z0-9' 24)',
  awsAccessKeyId: 'AKIA$(rand 'A-Z2-7' 16)',
  awsSecretAccessKey: '$(rand 'a-zA-Z0-9' 40)',
  fallbackCustomerCard: '$(luhn_pan)',
  signingKey: \`${private_key}\`,
};
EOF

echo "::warning title=Démo data-leak::Fichier $target injecté dans le build (secrets factices générés à l'exécution)"
