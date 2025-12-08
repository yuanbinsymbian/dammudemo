#!/usr/bin/env bash
set -e
DOMAIN="$1"
APPID="$2"
ROOMID="$3"
OPENID="$4"
GROUPID="$5"
SECRET="$6"
if [ -z "$DOMAIN" ] || [ -z "$APPID" ] || [ -z "$ROOMID" ] || [ -z "$OPENID" ] || [ -z "$GROUPID" ]; then
  echo "usage: scripts/test_group.sh <domain> <app_id> <room_id> <open_id> <group_id> [secret]"
  exit 1
fi
python3 "$(dirname "$0")/test_group_push.py" "$DOMAIN" "$APPID" "$ROOMID" "$OPENID" "$GROUPID" "$SECRET"
python3 "$(dirname "$0")/test_group_query.py" "$DOMAIN" "$APPID" "$ROOMID" "$OPENID" "$SECRET"