#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="2.4.0"
INSTALL_DIR_DEFAULT="$HOME/AetherTicket"
LOG_FILE="/tmp/aetherticket-install.log"
LOCK_FILE="/tmp/aetherticket-install.lock"
REPO_URL="https://github.com/Shaf2665/AetherTicket.git"
VERSION="${1:-main}"

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
log_info " AetherTicket Setup (v$SCRIPT_VERSION)"
log_info " Target ref: $VERSION"
log_info "=========================================="

# Acquire lock to prevent concurrent installations
exec {LOCK_FD}>"$LOCK_FILE"
if ! flock -n "$LOCK_FD"; then
  log_error "Another installation is currently running. Please try again later."
  exit 1
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Required command '$cmd' is not available. Please install it and retry."
    exit 1
  fi
}

log_info "Checking prerequisites..."
require_cmd node
require_cmd npm
require_cmd git

# Node.js version check
NODE_VERSION="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if (( NODE_MAJOR < 20 )); then
  log_error "Node.js 20 or higher is required. Detected version: $(node -v)"
  exit 1
fi
log_info "Detected Node.js $(node -v)"

prompt_secret() {
  local prompt="$1"
  local var
  while true; do
    read -r -s -p "$prompt" var
    echo
    if [[ -n "$var" ]]; then
      printf '%s' "$var"
      return
    fi
    log_warn "Value cannot be empty."
  done
}

prompt_optional() {
  local prompt="$1"
  local default_value="$2"
  read -r -p "$prompt" input
  if [[ -z "$input" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$input"
  fi
}

INSTALL_DIR="${AETHERTICKET_INSTALL_DIR:-$INSTALL_DIR_DEFAULT}"
log_info "Installation directory: $INSTALL_DIR"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  log_warn "Existing Git repository detected at $INSTALL_DIR"
  read -r -p "Reuse existing repository and reset to '$VERSION'? (Y/n): " reuse_repo
  reuse_repo=${reuse_repo:-Y}
  if [[ ! "$reuse_repo" =~ ^[Yy]$ ]]; then
    log_error "Installation aborted by user to avoid overwriting existing repository."
    exit 1
  fi
fi

if [[ -d "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
  log_error "Installation directory is not empty. Please back up and remove it or set AETHERTICKET_INSTALL_DIR."
  exit 1
fi

mkdir -p "$INSTALL_DIR"

ENV_FILE="$INSTALL_DIR/.env"
CONFIG_FILE="$INSTALL_DIR/config.json"

reuse_env=false
if [[ -f "$ENV_FILE" ]]; then
  log_warn "Existing .env file detected."
  read -r -p "Reuse existing Discord credentials? (Y/n): " reuse_choice
  reuse_choice=${reuse_choice:-Y}
  if [[ "$reuse_choice" =~ ^[Yy]$ ]]; then
    reuse_env=true
  fi
fi

if [[ "$reuse_env" == false ]]; then
  DISCORD_TOKEN="$(prompt_secret "Enter your Discord Bot Token: ")"
  CLIENT_ID="$(prompt_secret "Enter your Discord Application (Client) ID: ")"
  read -r -p "Enter your Discord Guild/Server ID (optional): " GUILD_ID || GUILD_ID=""
else
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  DISCORD_TOKEN="${DISCORD_TOKEN:-}"
  CLIENT_ID="${CLIENT_ID:-}"
  GUILD_ID="${GUILD_ID:-}"
fi

PORT_DEFAULT="${PORT:-8080}"
PORT_VALUE="$(prompt_optional "Preferred Web UI port [${PORT_DEFAULT}]: " "$PORT_DEFAULT")"

write_env_file() {
  local tmp_file="$ENV_FILE.tmp"
  cat >"$tmp_file" <<EOF
DISCORD_TOKEN=$DISCORD_TOKEN
CLIENT_ID=$CLIENT_ID
GUILD_ID=${GUILD_ID}
PORT=${PORT_VALUE}
EOF
  mv "$tmp_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log_info "Saved credentials to .env (permissions set to 600)."
}

if [[ "$reuse_env" == false ]]; then
  write_env_file
else
  log_info "Reusing existing credentials."
fi

log_info "Cloning AetherTicket source from GitHub..."
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch --tags --prune origin
  if git -C "$INSTALL_DIR" rev-parse --verify "origin/$VERSION" >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" checkout "$VERSION" 2>/dev/null || git -C "$INSTALL_DIR" checkout -B "$VERSION" "origin/$VERSION"
    git -C "$INSTALL_DIR" reset --hard "origin/$VERSION"
  elif git -C "$INSTALL_DIR" rev-parse --verify "refs/tags/$VERSION" >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" checkout -f "tags/$VERSION"
  else
    log_error "Ref '$VERSION' not found in existing repository."
    exit 1
  fi
else
  rm -rf "$INSTALL_DIR"
  if ! git clone --single-branch --branch "$VERSION" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null; then
    log_warn "Failed to clone ref '$VERSION' directly; falling back to cloning default branch."
    git clone "$REPO_URL" "$INSTALL_DIR"
    if ! git -C "$INSTALL_DIR" checkout -f "$VERSION"; then
      log_error "Unable to checkout ref '$VERSION' after cloning."
      exit 1
    fi
  fi
fi

# Ensure essential directories exist with secure permissions
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/uploads"
chmod 700 "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/uploads"

if [[ ! -f "$CONFIG_FILE" ]]; then
  log_info "Creating config.json from template"
  cp "$INSTALL_DIR/config.example.json" "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
else
  chmod 600 "$CONFIG_FILE" || true
fi

log_info "Installing dependencies (this may take a minute)..."
cd "$INSTALL_DIR"
npm install --no-fund --no-audit

log_info "Building TypeScript assets..."
npm run build

log_info "Pruning development dependencies..."
npm prune --omit=dev || log_warn "npm prune failed; continuing with installed packages"

log_info "Initializing database if required..."
node - <<'NODE'
const { initDatabase } = require('./dist/utils/database');
initDatabase()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
NODE
if [[ $? -ne 0 ]]; then
  log_warn "Database initialization failed; it will be created on first run."
fi

detect_firewall() {
  local port="$1"
  if command -v ufw >/dev/null 2>&1; then
    log_warn "Firewall detected (UFW). If you need external access, run:"
    log_warn "  sudo ufw allow ${port}/tcp"
    log_warn "  sudo ufw reload"
  elif command -v firewall-cmd >/dev/null 2>&1; then
    log_warn "Firewall detected (firewalld). If you need external access, run:"
    log_warn "  sudo firewall-cmd --permanent --add-port=${port}/tcp"
    log_warn "  sudo firewall-cmd --reload"
  fi
}

detect_firewall "$PORT_VALUE"

log_info "=========================================="
log_info " AetherTicket installed successfully!"
log_info " Version: v$SCRIPT_VERSION"
log_info " Directory: $INSTALL_DIR"
log_info " Log file: $LOG_FILE"
log_info "------------------------------------------"
log_info " Next steps:"
log_info "  1. cd $INSTALL_DIR"
log_info "  2. npm start"
log_info "  3. Open http://localhost:${PORT_VALUE} (or your server IP)"
log_info "------------------------------------------"
log_info " Need to run in background? Try:"
log_info "  nohup npm start > logs/bot.log 2>&1 &"
log_info "=========================================="

