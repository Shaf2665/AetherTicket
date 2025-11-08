#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="2.4.1"
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

# Detect Linux distribution
detect_distribution() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    case "$ID" in
      ubuntu|debian)
        echo "ubuntu"
        ;;
      centos|rhel)
        echo "centos"
        ;;
      fedora)
        echo "fedora"
        ;;
      *)
        echo "unknown"
        ;;
    esac
  else
    echo "unknown"
  fi
}

# Check if sudo is available
check_sudo() {
  if command -v sudo >/dev/null 2>&1; then
    # Test if sudo works (non-interactive)
    if sudo -n true 2>/dev/null || sudo -v 2>/dev/null; then
      return 0
    else
      # Sudo exists but may require password
      return 0
    fi
  else
    return 1
  fi
}

# Install Node.js via NodeSource
install_nodejs_nodesource() {
  local distro="$1"
  local needs_sudo="$2"
  
  if [[ "$needs_sudo" != "0" ]]; then
    log_error "sudo is required to install Node.js but is not available."
    log_error "Please install Node.js 20+ manually:"
    case "$distro" in
      ubuntu)
        log_error "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        log_error "  sudo apt-get install -y nodejs"
        ;;
      centos|fedora)
        log_error "  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -"
        log_error "  sudo yum install -y nodejs || sudo dnf install -y nodejs"
        ;;
      *)
        log_error "  Visit https://nodejs.org/ for installation instructions"
        ;;
    esac
    exit 1
  fi
  
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    log_error "curl or wget is required to install Node.js but neither is available."
    log_error "Please install curl or wget first, then run this script again."
    exit 1
  fi
  
  log_info "Installing Node.js 20.x via NodeSource..."
  
  case "$distro" in
    ubuntu)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || {
          log_error "Failed to add NodeSource repository."
          exit 1
        }
        sudo apt-get install -y nodejs || {
          log_error "Failed to install Node.js."
          exit 1
        }
      else
        log_error "curl is required for NodeSource installation."
        exit 1
      fi
      ;;
    centos|fedora)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - || {
          log_error "Failed to add NodeSource repository."
          exit 1
        }
        if command -v dnf >/dev/null 2>&1; then
          sudo dnf install -y nodejs || {
            log_error "Failed to install Node.js."
            exit 1
          }
        else
          sudo yum install -y nodejs || {
            log_error "Failed to install Node.js."
            exit 1
          }
        fi
      else
        log_error "curl is required for NodeSource installation."
        exit 1
      fi
      ;;
    *)
      log_error "Unsupported distribution for automatic Node.js installation."
      log_error "Please install Node.js 20+ manually from https://nodejs.org/"
      exit 1
      ;;
  esac
  
  # Verify installation
  if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js installation completed but 'node' command is not found in PATH."
    log_error "You may need to restart your terminal or run: source ~/.bashrc"
    exit 1
  fi
  
  local installed_version
  installed_version=$(node -v)
  log_info "Node.js installed successfully: $installed_version"
  
  # Verify npm is installed
  if ! command -v npm >/dev/null 2>&1; then
    log_warn "npm is not found in PATH. NodeSource should include npm."
    log_warn "You may need to restart your terminal."
  else
    local npm_version
    npm_version=$(npm -v)
    log_info "npm installed successfully: v$npm_version"
  fi
  
  # Double-check version
  local node_ver
  node_ver=$(node -v | sed 's/^v//')
  local node_major
  node_major="${node_ver%%.*}"
  if (( node_major < 20 )); then
    log_error "Installed Node.js version ($(node -v)) is still less than 20."
    log_error "Please install Node.js 20+ manually."
    exit 1
  fi
}

# Install Git via package manager
install_git() {
  local distro="$1"
  local needs_sudo="$2"
  
  if [[ "$needs_sudo" != "0" ]]; then
    log_error "sudo is required to install Git but is not available."
    log_error "Please install Git manually:"
    case "$distro" in
      ubuntu)
        log_error "  sudo apt update && sudo apt install -y git"
        ;;
      centos|fedora)
        log_error "  sudo yum install -y git || sudo dnf install -y git"
        ;;
      *)
        log_error "  Visit https://git-scm.com/download/linux for installation instructions"
        ;;
    esac
    exit 1
  fi
  
  log_info "Installing Git via package manager..."
  
  case "$distro" in
    ubuntu)
      sudo apt update || {
        log_error "Failed to update package list."
        exit 1
      }
      sudo apt install -y git || {
        log_error "Failed to install Git."
        exit 1
      }
      ;;
    centos|fedora)
      if command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y git || {
          log_error "Failed to install Git."
          exit 1
        }
      else
        sudo yum install -y git || {
          log_error "Failed to install Git."
          exit 1
        }
      fi
      ;;
    *)
      log_error "Unsupported distribution for automatic Git installation."
      log_error "Please install Git manually from https://git-scm.com/download/linux"
      exit 1
      ;;
  esac
  
  # Verify installation
  if ! command -v git >/dev/null 2>&1; then
    log_error "Git installation completed but 'git' command is not found in PATH."
    log_error "You may need to restart your terminal or run: source ~/.bashrc"
    exit 1
  fi
  
  local git_version
  git_version=$(git --version)
  log_info "Git installed successfully: $git_version"
}

# Check and install Node.js with user confirmation
check_and_install_nodejs() {
  local distro
  distro=$(detect_distribution)
  local has_sudo=0
  check_sudo || has_sudo=1
  
  if ! command -v node >/dev/null 2>&1; then
    log_warn "Node.js is not installed."
    log_info "Node.js 20+ is required for AetherTicket."
    read -r -p "Install Node.js 20.x automatically? (Y/n): " install_choice
    install_choice=${install_choice:-Y}
    if [[ "$install_choice" =~ ^[Yy]$ ]]; then
      if [[ "$distro" == "unknown" ]]; then
        log_error "Unable to detect Linux distribution for automatic installation."
        log_error "Please install Node.js 20+ manually from https://nodejs.org/"
        exit 1
      fi
      install_nodejs_nodesource "$distro" "$has_sudo"
    else
      log_error "Node.js installation declined by user."
      log_error "Please install Node.js 20+ manually and run this script again."
      log_error "Visit https://nodejs.org/ for installation instructions."
      exit 1
    fi
  else
    local node_version
    node_version=$(node -v | sed 's/^v//')
    local node_major
    node_major="${node_version%%.*}"
    if (( node_major < 20 )); then
      log_warn "Node.js version $(node -v) is less than required (20+)."
      log_info "AetherTicket requires Node.js 20 or higher."
      read -r -p "Upgrade Node.js to 20.x automatically? (Y/n): " upgrade_choice
      upgrade_choice=${upgrade_choice:-Y}
      if [[ "$upgrade_choice" =~ ^[Yy]$ ]]; then
        if [[ "$distro" == "unknown" ]]; then
          log_error "Unable to detect Linux distribution for automatic installation."
          log_error "Please upgrade Node.js to 20+ manually."
          exit 1
        fi
        install_nodejs_nodesource "$distro" "$has_sudo"
      else
        log_error "Node.js upgrade declined by user."
        log_error "Please upgrade Node.js to 20+ manually and run this script again."
        exit 1
      fi
    else
      log_info "Detected Node.js $(node -v) ✓"
    fi
  fi
  
  # Verify npm is available
  if ! command -v npm >/dev/null 2>&1; then
    log_error "npm is not installed. Node.js installation may be incomplete."
    log_error "Please ensure npm is installed and run this script again."
    exit 1
  fi
}

# Check and install Git with user confirmation
check_and_install_git() {
  local distro
  distro=$(detect_distribution)
  local has_sudo=0
  check_sudo || has_sudo=1
  
  if ! command -v git >/dev/null 2>&1; then
    log_warn "Git is not installed."
    log_info "Git is required to update the AetherTicket repository from GitHub."
    read -r -p "Install Git automatically? (Y/n): " install_choice
    install_choice=${install_choice:-Y}
    if [[ "$install_choice" =~ ^[Yy]$ ]]; then
      if [[ "$distro" == "unknown" ]]; then
        log_error "Unable to detect Linux distribution for automatic installation."
        log_error "Please install Git manually from https://git-scm.com/download/linux"
        exit 1
      fi
      install_git "$distro" "$has_sudo"
    else
      log_error "Git installation declined by user."
      log_error "Please install Git manually and run this script again."
      log_error "Visit https://git-scm.com/download/linux for installation instructions."
      exit 1
    fi
  else
    log_info "Detected Git $(git --version) ✓"
  fi
}

log_info "Checking prerequisites..."

# Check and install Node.js if needed
check_and_install_nodejs

# Check and install Git if needed
check_and_install_git

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

