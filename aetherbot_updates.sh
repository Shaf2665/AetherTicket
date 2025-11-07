#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="2.3.6"
INSTALL_DIR_DEFAULT="$HOME/AetherTicket"
BACKUP_ROOT="$HOME/AetherTicket_backups"
LOG_FILE="/tmp/aetherticket-update.log"
LOCK_FILE="/tmp/aetherticket-update.lock"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

umask 077

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  local level="$1"; shift
  printf '%s [%s] %s\n' "$(timestamp)" "$level" "$*"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@" 1>&2; }

cleanup() {
  local exit_code=$?
  if [[ -n "${STAGING_DIR:-}" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi
  if [[ -n "${LOCK_FD:-}" ]]; then
    flock -u "$LOCK_FD" 2>/dev/null || true
  fi
  exit "$exit_code"
}

exec > >(tee -a "$LOG_FILE") 2>&1
trap cleanup EXIT

log_info "=========================================="
log_info " AetherTicket Update (v$SCRIPT_VERSION)"
log_info "=========================================="

exec {LOCK_FD}>"$LOCK_FILE"
if ! flock -n "$LOCK_FD"; then
  log_error "Another update is currently running. Please wait and retry."
  exit 1
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Required command '$cmd' is not installed."
    exit 1
  fi
}

require_cmd node
require_cmd npm

INSTALL_DIR="${AETHERTICKET_INSTALL_DIR:-$INSTALL_DIR_DEFAULT}"
if [[ ! -d "$INSTALL_DIR" ]]; then
  log_error "AetherTicket is not installed at $INSTALL_DIR"
  exit 1
fi

log_info "Using installation directory: $INSTALL_DIR"

CURRENT_VERSION="unknown"
if [[ -f "$INSTALL_DIR/package.json" ]]; then
  CURRENT_VERSION="$(node -e "console.log(require('$INSTALL_DIR/package.json').version || 'unknown')" 2>/dev/null || echo 'unknown')"
fi
log_info "Detected installed version: $CURRENT_VERSION"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

log_info "Creating backup at $BACKUP_DIR"
rsync -a "$INSTALL_DIR/" "$BACKUP_DIR/"

log_info "Preparing new source files..."
STAGING_DIR="$(mktemp -d)"

EXCLUDES=(
  "--exclude" ".git"
  "--exclude" "node_modules"
  "--exclude" "dist"
  "--exclude" "data"
  "--exclude" "logs"
  "--exclude" "uploads"
  "--exclude" "audit-report.txt"
  "--exclude" "*.log"
)

SOURCE_ARCHIVE_URL="${AETHERTICKET_SOURCE_URL:-}"

if [[ -n "$SOURCE_ARCHIVE_URL" ]]; then
  log_info "Downloading source archive from $SOURCE_ARCHIVE_URL"
  require_cmd curl
  curl -fsSL "$SOURCE_ARCHIVE_URL" -o "$STAGING_DIR/source.tar.gz"
  tar -xzf "$STAGING_DIR/source.tar.gz" -C "$STAGING_DIR"
  ROOT_CONTENT_DIR="$(find "$STAGING_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$ROOT_CONTENT_DIR" ]]; then
    log_error "Source archive did not contain expected files."
    exit 1
  fi
  STAGING_SRC="$ROOT_CONTENT_DIR"
else
  log_info "No source URL provided, using local project files at $SCRIPT_DIR"
  STAGING_SRC="$STAGING_DIR"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${EXCLUDES[@]}" "$SCRIPT_DIR/" "$STAGING_SRC/"
  else
    (cd "$SCRIPT_DIR" && tar cf - .) | (cd "$STAGING_SRC" && tar xf -)
    rm -rf "$STAGING_SRC/.git" "$STAGING_SRC/node_modules" "$STAGING_SRC/dist" "$STAGING_SRC/data" "$STAGING_SRC/logs" "$STAGING_SRC/uploads"
  fi
fi

if [[ ! -f "$STAGING_SRC/package.json" ]]; then
  log_error "Staging source is missing package.json"
  exit 1
fi

log_info "Copying application files to installation directory"
rsync -a --delete "${EXCLUDES[@]}" "$STAGING_SRC/" "$INSTALL_DIR/"

# Restore preserved assets
for preserved in config.json .env data logs uploads; do
  if [[ -d "$BACKUP_DIR/$preserved" && ! -d "$INSTALL_DIR/$preserved" ]]; then
    cp -R "$BACKUP_DIR/$preserved" "$INSTALL_DIR/"
  fi
  if [[ -f "$BACKUP_DIR/$preserved" && ! -f "$INSTALL_DIR/$preserved" ]]; then
    cp "$BACKUP_DIR/$preserved" "$INSTALL_DIR/"
  fi
done

chmod 600 "$INSTALL_DIR/config.json" 2>/dev/null || true
chmod 600 "$INSTALL_DIR/.env" 2>/dev/null || true
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/uploads"
chmod 700 "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/uploads"

log_info "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --no-fund --no-audit

log_info "Building application..."
npm run build

log_info "Performing quick health check"
node - <<'NODE'
try {
  const { loadConfig } = require('./dist/utils/configLoader');
  loadConfig();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
NODE

if [[ $? -ne 0 ]]; then
  log_warn "Configuration validation failed; please review config.json"
fi

restart_service() {
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^aetherticket.service'; then
    log_info "Restarting systemd service 'aetherticket'"
    sudo systemctl restart aetherticket && return 0
  fi

  if command -v pm2 >/dev/null 2>&1 && pm2 ls | grep -q 'aetherticket'; then
    log_info "Restarting PM2 process 'aetherticket'"
    pm2 restart aetherticket && return 0
  fi

  local pids
  pids=$(pgrep -f 'node .*dist/index.js' || true)
  if [[ -n "$pids" ]]; then
    log_warn "Found running Node processes for AetherTicket. Please restart them manually. PIDs: $pids"
    return 1
  fi

  log_info "No managed process detected. Start the bot with 'npm start' if needed."
  return 0
}

restart_service || true

log_info "=========================================="
log_info " Update complete"
log_info " Previous version : $CURRENT_VERSION"
log_info " Updated version  : $SCRIPT_VERSION"
log_info " Backup location  : $BACKUP_DIR"
log_info " Log file         : $LOG_FILE"
log_info "=========================================="

