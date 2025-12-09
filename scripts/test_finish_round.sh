#!/usr/bin/env bash
set -e
DOMAIN="$1"
ROOMID="$2"
ROUNDID="$3"
USERCOUNT="$4"
if [ -z "$DOMAIN" ] || [ -z "$ROOMID" ] || [ -z "$ROUNDID" ]; then
  echo "usage: scripts/test_finish_round.sh <domain> <room_id> <round_id> [user_count]"
  exit 1
fi
python3 "$(dirname "$0")/test_finish_round.py" "$DOMAIN" "$ROOMID" "$ROUNDID" "$USERCOUNT"