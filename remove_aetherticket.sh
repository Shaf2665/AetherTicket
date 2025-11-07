#!/usr/bin/env bash

set -euo pipefail

INSTALL_DIR_DEFAULT="$HOME/AetherTicket"
BACKUP_ROOT="$HOME/AetherTicket_backups"
LOG_FILE="/tmp/aetherticket-removal.log"
LOCK_FILE="/tmp/aetherticket-removal.lock"

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
log_info " AetherTicket Removal"
log_info "=========================================="

exec {LOCK_FD}>"$LOCK_FILE"
if ! flock -n "$LOCK_FD"; then
  log_error "Another maintenance task is running. Please retry later."
  exit 1
fi

INSTALL_DIR="${AETHERTICKET_INSTALL_DIR:-$INSTALL_DIR_DEFAULT}"
if [[ ! -d "$INSTALL_DIR" ]]; then
  log_error "Installation directory not found: $INSTALL_DIR"
  exit 1
fi

log_warn "This will permanently remove AetherTicket from $INSTALL_DIR"
read -r -p "Type 'remove' to confirm: " confirmation
if [[ "$confirmation" != "remove" ]]; then
  log_info "Aborting."
  exit 0
fi

stop_services() {
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^aetherticket.service'; then
    log_info "Stopping systemd service 'aetherticket'"
    sudo systemctl stop aetherticket 2>/dev/null || true
    sudo systemctl disable aetherticket 2>/dev/null || true
    sudo rm -f /etc/systemd/system/aetherticket.service 2>/dev/null || true
    sudo systemctl daemon-reload || true
  fi

  if command -v pm2 >/dev/null 2>&1 && pm2 ls | grep -q 'aetherticket'; then
    log_info "Stopping PM2 process 'aetherticket'"
    pm2 delete aetherticket 2>/dev/null || true
  fi

  local pids
  pids=$(pgrep -f 'node .*dist/index.js' || true)
  if [[ -n "$pids" ]]; then
    log_warn "Terminating running Node processes: $pids"
    pkill -f 'node .*dist/index.js' 2>/dev/null || true
  fi
}

stop_services

log_info "Removing installation directory"
rm -rf "$INSTALL_DIR"

if [[ -d "$BACKUP_ROOT" ]]; then
  log_warn "Backups are stored in $BACKUP_ROOT"
  read -r -p "Remove backups as well? (y/N): " remove_backups
  if [[ "$remove_backups" =~ ^[Yy]$ ]]; then
    rm -rf "$BACKUP_ROOT"
    log_info "Backups removed."
  else
    log_info "Backups preserved."
  fi
fi

log_info "Removal complete. Log file: $LOG_FILE"
log_info "=========================================="

