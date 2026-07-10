#!/bin/sh
set -eu

STATE_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$STATE_DIR"
  chown -R appuser:appgroup "$STATE_DIR"
  exec runuser -u appuser -- "$@"
fi

mkdir -p "$STATE_DIR"
exec "$@"
