#!/usr/bin/env bash
set -e
export PORT=8000
node --stack-size=2048 server.js
