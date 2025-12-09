#!/usr/bin/env bash
set -e
DOMAIN="$1"
APPID="$2"
ROOMID="$3"
ROUNDID="$4"
WINNER="$5"
LEFT_OPENID="$6"
RIGHT_OPENID="$7"
PARTICIPANTS="$8"
SECRET="$9"
if [ -z "$DOMAIN" ] || [ -z "$APPID" ] || [ -z "$ROOMID" ] || [ -z "$ROUNDID" ] || [ -z "$WINNER" ] || [ -z "$LEFT_OPENID" ] || [ -z "$RIGHT_OPENID" ]; then
  echo "usage: scripts/test_e2e_all.sh <domain> <app_id> <room_id> <round_id> <winner(Red|Blue|Draw)> <comment_open_id_left> <comment_open_id_right> [participants] [secret]"
  exit 1
fi
python3 "$(dirname "$0")/test_e2e_round.py" "$DOMAIN" "$ROOMID" "$ROUNDID" "$WINNER" "$LEFT_OPENID" "$RIGHT_OPENID" "$PARTICIPANTS"
python3 "$(dirname "$0")/test_e2e_round_verify.py" "$DOMAIN" "$APPID" "$ROOMID" "$LEFT_OPENID" "$RIGHT_OPENID" "$SECRET"