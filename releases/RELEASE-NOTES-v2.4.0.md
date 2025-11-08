## AetherTicket v2.4.0 – Git-Integrated Installer

### Highlights
- **Git-powered setup**: installer now clones a tagged branch or specific ref directly from GitHub, reducing bundle size and ensuring fresh code.
- **Safe update workflow**: updater script fetches and resets against the desired Git ref while preserving data/logs/uploads.
- **Post-build pruning**: development dependencies removed after compilation for leaner deployments.
- **Documentation refresh**: setup guide explains tag/branch args and links to source repository.

### Installation
```bash
wget https://aetherpanel.com/downloads/aetherticket/aetherticket-setup.sh
chmod +x aetherticket-setup.sh
bash aetherticket-setup.sh v2.4.0
```

### Update
```bash
wget https://aetherpanel.com/downloads/aetherticket/aetherbot_updates.sh
chmod +x aetherbot_updates.sh
./aetherbot_updates.sh v2.4.0
```

### Removal
```bash
wget https://aetherpanel.com/downloads/aetherticket/remove_aetherticket.sh
chmod +x remove_aetherticket.sh
./remove_aetherticket.sh
```

### Notes
- Default branch install: `bash aetherticket-setup.sh` (defaults to `main`).
- Pin to feature branch: `bash aetherticket-setup.sh feature/sso-integration`.
- Update script accepts the same optional ref argument (`./aetherbot_updates.sh origin/main`).


