#!/bin/sh
set -eu

WALLHUB_UID="${WALLHUB_UID:-10001}"
WALLHUB_GID="${WALLHUB_GID:-10001}"
WALLHUB_STEAMCOMMUNITY_302_DIR="${WALLHUB_STEAMCOMMUNITY_302_DIR:-/opt/steamcommunity_302}"

case "$WALLHUB_UID" in ''|0|*[!0-9]*) echo "WALLHUB_UID must be a non-root numeric ID" >&2; exit 1 ;; esac
case "$WALLHUB_GID" in ''|0|*[!0-9]*) echo "WALLHUB_GID must be a non-root numeric ID" >&2; exit 1 ;; esac

# Bind mounts hide the ownership created during image build, so runtime data
# directories must be prepared after Docker has mounted /data.
mkdir -p /data/SteamKit /data/Downloads /home/wallhub

# Keep one Dockerfile for amd64 and arm64. On arm64/mobile containers, default
# to lower memory pressure unless the user explicitly set these variables.
case "$(uname -m)" in
  aarch64|arm64)
    : "${DEPOTDOWNLOADER_MAX_DOWNLOADS:=12}"
    : "${WALLHUB_MAX_CONCURRENT_DOWNLOADS:=1}"
    : "${DOTNET_gcServer:=0}"
    : "${DOTNET_GCHeapHardLimit:=201326592}"
    export DEPOTDOWNLOADER_MAX_DOWNLOADS WALLHUB_MAX_CONCURRENT_DOWNLOADS DOTNET_gcServer DOTNET_GCHeapHardLimit
    ;;
esac

start_steamcommunity_302() {
  if [ "${WALLHUB_STEAMCOMMUNITY_302:-0}" != "1" ]; then
    return 0
  fi

  if [ ! -d "$WALLHUB_STEAMCOMMUNITY_302_DIR" ]; then
    echo "[Steamcommunity_302] Directory not found: $WALLHUB_STEAMCOMMUNITY_302_DIR" >&2
    exit 1
  fi

  if [ ! -f "$WALLHUB_STEAMCOMMUNITY_302_DIR/steamcommunity_302.cli" ]; then
    echo "[Steamcommunity_302] Missing steamcommunity_302.cli in $WALLHUB_STEAMCOMMUNITY_302_DIR" >&2
    exit 1
  fi

  chmod +x "$WALLHUB_STEAMCOMMUNITY_302_DIR/steamcommunity_302.cli" 2>/dev/null || true
  if [ -f "$WALLHUB_STEAMCOMMUNITY_302_DIR/steamcommunity_302.caddy" ]; then
    chmod +x "$WALLHUB_STEAMCOMMUNITY_302_DIR/steamcommunity_302.caddy" 2>/dev/null || true
  fi

  echo "[Steamcommunity_302] Starting from $WALLHUB_STEAMCOMMUNITY_302_DIR"
  (
    cd "$WALLHUB_STEAMCOMMUNITY_302_DIR"
    ./steamcommunity_302.cli
  ) &

  hosts_file="$WALLHUB_STEAMCOMMUNITY_302_DIR/S302.hosts"
  i=0
  while [ ! -s "$hosts_file" ] && [ "$i" -lt 30 ]; do
    i=$((i + 1))
    sleep 1
  done

  if [ -s "$hosts_file" ]; then
    echo "[Steamcommunity_302] Applying S302.hosts to container /etc/hosts"
    while IFS= read -r line; do
      case "$line" in
        ""|\#*) continue ;;
      esac
      grep -qxF "$line" /etc/hosts || printf '%s\n' "$line" >> /etc/hosts
    done < "$hosts_file"
  else
    echo "[Steamcommunity_302] S302.hosts was not generated; continuing without hosts injection" >&2
  fi
}

ensure_directory_owner() {
  target="$1"
  desired="$WALLHUB_UID:$WALLHUB_GID"
  mkdir -p "$target"
  current="$(stat -c '%u:%g' "$target" 2>/dev/null || true)"
  if [ "$current" = "$desired" ]; then
    return 0
  fi
  chown -R "$desired" "$target"
}

if [ "$(id -u)" = "0" ]; then
  ensure_directory_owner /data
  ensure_directory_owner /data/SteamKit
  ensure_directory_owner /data/Downloads
  ensure_directory_owner /home/wallhub
  start_steamcommunity_302
  exec gosu "$WALLHUB_UID:$WALLHUB_GID" "$@"
fi

exec "$@"
