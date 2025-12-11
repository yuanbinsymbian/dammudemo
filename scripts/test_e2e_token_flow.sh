#!/usr/bin/env bash
set -e
DOMAIN="$1"
TOKEN="$2"
ROUNDID="$3"
USERCOUNT="$4"
WAITSECS="$5"
POSTWAIT="$6"
if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ] || [ -z "$ROUNDID" ]; then
  echo "usage: scripts/test_e2e_token_flow.sh <domain> <token> <round_id> [user_count] [wait_secs] [post_wait_secs]"
  exit 1
fi
python3 "$(dirname "$0")/test_e2e_token_flow.py" "$DOMAIN" "$TOKEN" "$ROUNDID" "$USERCOUNT" "$WAITSECS" "$POSTWAIT"