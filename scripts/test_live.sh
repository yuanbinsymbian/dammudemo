#!/usr/bin/env bash
set -e
DOMAIN="$1"
TOKEN="$2"
if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
  echo "usage: scripts/test_live.sh <domain> <token>"
  exit 1
fi
curl -sS "https://${DOMAIN}/v1/ping" || true
python3 "$(dirname "$0")/test_live.py" "$DOMAIN" "$TOKEN"