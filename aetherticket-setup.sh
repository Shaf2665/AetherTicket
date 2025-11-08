#!/usr/bin/env bash

set -euo pipefail

SCRIPT_VERSION="2.4.2"
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
    log_info "Git is required to clone the AetherTicket repository from GitHub."
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

