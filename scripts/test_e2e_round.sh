#!/usr/bin/env bash
set -e
DOMAIN="$1"
ROOMID="$2"
ROUNDID="$3"
WINNER="$4"
LEFT_OPENID="$5"
RIGHT_OPENID="$6"
PARTICIPANTS="$7"
if [ -z "$DOMAIN" ] || [ -z "$ROOMID" ] || [ -z "$ROUNDID" ] || [ -z "$WINNER" ] || [ -z "$LEFT_OPENID" ] || [ -z "$RIGHT_OPENID" ]; then
  echo "usage: scripts/test_e2e_round.sh <domain> <room_id> <round_id> <winner(Red|Blue|Draw)> <comment_open_id_left> <comment_open_id_right> [participants]"
  echo "participants: openId,points,isWin;openId2,points2,isWin2"
  exit 1
fi
python3 "$(dirname "$0")/test_e2e_round.py" "$DOMAIN" "$ROOMID" "$ROUNDID" "$WINNER" "$LEFT_OPENID" "$RIGHT_OPENID" "$PARTICIPANTS"