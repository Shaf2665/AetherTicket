# AetherTicket v2.3.6 (Audit Build)

A free, self-hosted, white-label Discord Ticket Bot that lets you manage support tickets effortlessly — and make it your own.

## Features

- 🎫 **Easy Ticket Management** - Create, close, and manage support tickets with slash commands
- 🎨 **White-Label** - Fully customizable bot name, avatar, and branding
- 🌐 **Web UI** - Local web interface for easy configuration (no coding required)
- 💾 **Local Storage** - All ticket data stored locally in SQLite database
- 🔒 **Privacy-First** - Runs entirely on your own server, no central hosting
- ⚡ **Lightweight** - Minimal resource usage, perfect for small to medium servers

## Quick Start

1. **Download the setup script:**
   ```bash
   wget https://aetherpanel.com/downloads/aetherticket-setup.sh
   chmod +x aetherticket-setup.sh
   ```

2. **Run the secure installer:**
   ```bash
   ./aetherticket-setup.sh
   ```
   - Creates `~/AetherTicket`
   - Installs dependencies and builds the bot
   - Writes `.env` with `chmod 600`
   - Generates `config.json` (or keeps your existing one)
   - Logs to `/tmp/aetherticket-install.log`

3. **Start the bot:**
   ```bash
   cd ~/AetherTicket
   npm start
   ```

4. **Configure via Web UI:**
   The Web UI binds to `127.0.0.1` by default for safety. Access it locally or via SSH tunnel:

   ```bash
   ssh -L 8080:127.0.0.1:8080 user@your-server
   ```

   Then open http://localhost:8080 in your browser.

   To expose it publicly, set `WEBUI_HOST=0.0.0.0` and secure the endpoint with `WEBUI_PASSWORD`.

## Requirements

- Node.js 20 or higher
- Discord Bot Token
- Discord Server with admin permissions

## Documentation

Full setup guide: https://aetherpanel.com/docs/aetherticket-setup

## Commands

- `/ticket create` - Create a new support ticket
- `/ticket close` - Close the current ticket
- `/ticket add @user` - Add a user to the ticket
- `/ticket info` - Get information about the current ticket

## Configuration

Edit `config.json` (permissions enforced to `600`) or use the Web UI.

```json
{
  "botName": "AetherTicket",
  "avatar": "./avatar.png",
  "embedColor": "#5865F2",
  "footerText": "Powered by AetherPanel",
  "ticketCategory": "Support Tickets",
  "supportRole": "Support"
}
```

## Docker Deployment

```bash
docker build -t aetherticket .
docker run -d \
  --name aetherticket \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/uploads:/app/uploads \
  --env-file .env \
  aetherticket
```

## Maintenance Scripts

- **Update:** `./aetherbot_updates.sh`
  - Creates timestamped backups in `~/AetherTicket_backups`
  - Preserves `.env`, `config.json`, data, logs, uploads
  - Attempts to restart systemd or PM2 services automatically

- **Removal:** `./remove_aetherticket.sh`
  - Stops running services and cleans up install directory
  - Optionally removes backups

All maintenance scripts write detailed logs to `/tmp/aetherticket-*.log`.

## License

MIT

## Support

Visit https://aetherpanel.com for more information.

