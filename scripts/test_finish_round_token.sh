#!/usr/bin/env bash
set -e
DOMAIN="$1"
TOKEN="$2"
ROUNDID="$3"
USERCOUNT="$4"
if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ] || [ -z "$ROUNDID" ]; then
  echo "usage: scripts/test_finish_round_token.sh <domain> <token> <round_id> [user_count]"
  exit 1
fi
python3 "$(dirname "$0")/test_finish_round_token.py" "$DOMAIN" "$TOKEN" "$ROUNDID" "$USERCOUNT"