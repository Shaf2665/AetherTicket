#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="2.4.0"
INSTALL_DIR_DEFAULT="$HOME/AetherTicket"
BACKUP_ROOT="$HOME/AetherTicket_backups"
LOG_FILE="/tmp/aetherticket-update.log"
LOCK_FILE="/tmp/aetherticket-update.lock"
TARGET_REF="${1:-origin/main}"

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
require_cmd git

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

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  log_error "Installation directory is not a Git repository. Reinstall using the latest installer."
  exit 1
fi

log_info "Fetching latest code from GitHub (target: $TARGET_REF)"
git -C "$INSTALL_DIR" fetch --tags origin

if [[ "$TARGET_REF" == origin/* ]]; then
  BRANCH_NAME="${TARGET_REF#origin/}"
  git -C "$INSTALL_DIR" checkout "$BRANCH_NAME" 2>/dev/null || git -C "$INSTALL_DIR" checkout -B "$BRANCH_NAME" "$TARGET_REF"
  git -C "$INSTALL_DIR" reset --hard "$TARGET_REF"
else
  if git -C "$INSTALL_DIR" rev-parse --verify "$TARGET_REF" >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" checkout -f "$TARGET_REF"
  elif git -C "$INSTALL_DIR" rev-parse --verify "origin/$TARGET_REF" >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" checkout "$TARGET_REF" 2>/dev/null || git -C "$INSTALL_DIR" checkout -B "$TARGET_REF" "origin/$TARGET_REF"
    git -C "$INSTALL_DIR" reset --hard "origin/$TARGET_REF"
  elif git -C "$INSTALL_DIR" rev-parse --verify "refs/tags/$TARGET_REF" >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" checkout -f "tags/$TARGET_REF"
  else
    log_error "Unable to resolve Git ref '$TARGET_REF'."
    exit 1
  fi
fi

log_info "Preserving runtime assets"
for preserved in data logs uploads; do
  mkdir -p "$INSTALL_DIR/$preserved"
  chmod 700 "$INSTALL_DIR/$preserved"
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

log_info "Pruning development dependencies..."
npm prune --omit=dev || log_warn "npm prune failed; continuing with installed packages"

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

UPDATED_VERSION="$(node -e "console.log(require('$INSTALL_DIR/package.json').version || 'unknown')" 2>/dev/null || echo 'unknown')"

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
log_info " Updated version  : $UPDATED_VERSION"
log_info " Backup location  : $BACKUP_DIR"
log_info " Log file         : $LOG_FILE"
log_info "=========================================="

