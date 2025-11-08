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

# Cleanup lock files from /tmp/
cleanup_lock_files() {
  log_info "Cleaning up lock files from /tmp/..."
  local lock_files=(
    "/tmp/aetherticket-install.lock"
    "/tmp/aetherticket-update.lock"
    "/tmp/aetherticket-removal.lock"
  )
  
  local removed=0
  for lock_file in "${lock_files[@]}"; do
    if [[ -f "$lock_file" ]]; then
      rm -f "$lock_file" 2>/dev/null && {
        log_info "Removed lock file: $lock_file"
        ((removed++)) || true
      }
    fi
  done
  
  if [[ $removed -eq 0 ]]; then
    log_info "No lock files found to remove."
  fi
}

# Cleanup log files from /tmp/
cleanup_log_files() {
  log_warn "Log files are stored in /tmp/"
  read -r -p "Remove AetherTicket log files from /tmp/? (y/N): " remove_logs
  if [[ "$remove_logs" =~ ^[Yy]$ ]]; then
    log_info "Removing log files from /tmp/..."
    local log_files=(
      "/tmp/aetherticket-install.log"
      "/tmp/aetherticket-update.log"
      "/tmp/aetherticket-removal.log"
    )
    
    local removed=0
    for log_file in "${log_files[@]}"; do
      if [[ -f "$log_file" ]]; then
        rm -f "$log_file" 2>/dev/null && {
          log_info "Removed log file: $log_file"
          ((removed++)) || true
        }
      fi
    done
    
    if [[ $removed -eq 0 ]]; then
      log_info "No log files found to remove."
    else
      log_info "Log files removed."
    fi
  else
    log_info "Log files preserved."
  fi
}

# Cleanup cron jobs
cleanup_cron_jobs() {
  if command -v crontab >/dev/null 2>&1; then
    local cron_entries
    cron_entries=$(crontab -l 2>/dev/null | grep -i aetherticket || true)
    
    if [[ -n "$cron_entries" ]]; then
      log_warn "Found AetherTicket-related cron jobs:"
      echo "$cron_entries" | while IFS= read -r line; do
        log_warn "  $line"
      done
      read -r -p "Remove AetherTicket cron jobs? (y/N): " remove_cron
      if [[ "$remove_cron" =~ ^[Yy]$ ]]; then
        crontab -l 2>/dev/null | grep -v -i aetherticket | crontab - 2>/dev/null && {
          log_info "Cron jobs removed."
        } || {
          log_warn "Failed to remove cron jobs. You may need to edit crontab manually."
        }
      else
        log_info "Cron jobs preserved."
      fi
    else
      log_info "No AetherTicket cron jobs found."
    fi
  fi
}

# Cleanup firewall rules
cleanup_firewall_rules() {
  local port
  # Try to detect port from .env file if it still exists in backups
  if [[ -d "$BACKUP_ROOT" ]]; then
    local latest_backup
    latest_backup=$(ls -td "$BACKUP_ROOT"/*/ 2>/dev/null | head -1)
    if [[ -n "$latest_backup" && -f "$latest_backup/.env" ]]; then
      # shellcheck source=/dev/null
      port=$(grep "^PORT=" "$latest_backup/.env" 2>/dev/null | cut -d'=' -f2 || echo "")
    fi
  fi
  
  # If no port found, check common default
  port=${port:-8080}
  
  if command -v ufw >/dev/null 2>&1; then
    local ufw_rules
    ufw_rules=$(sudo ufw status numbered 2>/dev/null | grep -E "($port|aetherticket)" || true)
    if [[ -n "$ufw_rules" ]]; then
      log_warn "Found UFW firewall rules that may be related to AetherTicket:"
      echo "$ufw_rules" | while IFS= read -r line; do
        log_warn "  $line"
      done
      read -r -p "Remove UFW firewall rules for port $port? (y/N): " remove_firewall
      if [[ "$remove_firewall" =~ ^[Yy]$ ]]; then
        # Try to delete by port first (works if rule is simple)
        if sudo ufw delete allow "$port/tcp" 2>/dev/null; then
          log_info "UFW firewall rule for port $port removed."
        else
          # If that fails, try to find and delete by rule number
          local rule_num
          rule_num=$(sudo ufw status numbered 2>/dev/null | grep "$port/tcp" | head -1 | sed -n 's/^\[ *\([0-9]*\)\].*/\1/p' || echo "")
          if [[ -n "$rule_num" ]]; then
            echo "y" | sudo ufw delete "$rule_num" 2>/dev/null && {
              log_info "UFW firewall rule for port $port removed."
            } || {
              log_warn "Failed to remove UFW firewall rule. You may need to remove it manually:"
              log_warn "  sudo ufw delete allow $port/tcp"
            }
          else
            log_warn "Could not find UFW firewall rule to remove. You may need to remove it manually:"
            log_warn "  sudo ufw delete allow $port/tcp"
          fi
        fi
      else
        log_info "Firewall rules preserved."
      fi
    else
      log_info "No UFW firewall rules found for AetherTicket."
    fi
  elif command -v firewall-cmd >/dev/null 2>&1; then
    if sudo firewall-cmd --list-ports 2>/dev/null | grep -q "$port"; then
      log_warn "Found firewalld rule for port $port"
      read -r -p "Remove firewalld rule for port $port? (y/N): " remove_firewall
      if [[ "$remove_firewall" =~ ^[Yy]$ ]]; then
        sudo firewall-cmd --permanent --remove-port="$port/tcp" 2>/dev/null && {
          sudo firewall-cmd --reload 2>/dev/null || true
          log_info "Firewalld rule for port $port removed."
        } || {
          log_warn "Failed to remove firewalld rule. You may need to remove it manually."
        }
      else
        log_info "Firewall rules preserved."
      fi
    else
      log_info "No firewalld rules found for AetherTicket."
    fi
  fi
}

# Perform complete cleanup
cleanup_lock_files
cleanup_log_files
cleanup_cron_jobs
cleanup_firewall_rules

log_info "Removal complete. Log file: $LOG_FILE"
log_info "=========================================="

