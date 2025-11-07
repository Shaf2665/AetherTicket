# AetherTicket v2.3.6 (Audit Build)

## Highlights
- Hardened installer (`aetherticket-setup.sh`) with locking, unified logging, staged file deployment, and secure credential handling
- New maintenance scripts for safe updates (`aetherbot_updates.sh`) and guided removal (`remove_aetherticket.sh`)
- Discord bot core now loads commands/events from typed registries and enforces graceful shutdown/error handling
- Web UI secured with Helmet, rate limiting, optional Basic Auth, sanitized configuration/avatars, and loopback host binding by default
- Atomic configuration writes, strict file permissions, and centralized validation utilities
- ESLint + Prettier toolchain added; TypeScript build/lint pass cleanly

## Contents
- `aetherticket-source-v2.3.6.tar.gz` – full source tree (without runtime artifacts)
- `aetherticket-setup.sh` – installer script
- `aetherbot_updates.sh` – backup-aware updater
- `remove_aetherticket.sh` – safe removal helper
- `setup.sh` – legacy entry point (delegates to new installer)

## Installation (Fresh)
```bash
wget <host>/aetherticket-setup.sh
chmod +x aetherticket-setup.sh
./aetherticket-setup.sh
```

## Update Existing Install
```bash
wget <host>/aetherbot_updates.sh
chmod +x aetherbot_updates.sh
./aetherbot_updates.sh
```

## Removal
```bash
wget <host>/remove_aetherticket.sh
chmod +x remove_aetherticket.sh
./remove_aetherticket.sh
```

## Notes
- Set `WEBUI_PASSWORD` (and optional `WEBUI_USERNAME`) to protect the Web UI
- Use `WEBUI_HOST=0.0.0.0` only when sitting behind HTTPS/reverse proxy
- Review `/tmp/aetherticket-*.log` if installations or updates encounter issues
- `multer@1.x` still ships; plan migration to 2.x in a future release
