#!/usr/bin/env bash
set -e
DOMAIN="$1"
ROOMID="$2"
ROUNDID="$3"
WINNER="$4"
PARTICIPANTS="$5"
if [ -z "$DOMAIN" ] || [ -z "$ROOMID" ] || [ -z "$ROUNDID" ] || [ -z "$WINNER" ]; then
  echo "usage: scripts/test_finish_round.sh <domain> <room_id> <round_id> <winner(Red|Blue|Draw)> [participants]"
  echo "participants: openId,points,isWin;openId2,points2,isWin2"
  exit 1
fi
python3 "$(dirname "$0")/test_finish_round.py" "$DOMAIN" "$ROOMID" "$ROUNDID" "$WINNER" "$PARTICIPANTS"