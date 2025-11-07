import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './utils/configLoader';
import { logger } from './utils/logger';
import { startWebUI } from './webui/server';
import { initDatabase } from './utils/database';
import { findAvailablePort, isPortAvailable } from './utils/portFinder';
import type { CommandModule } from './types/command';

type EventModule = {
  name: string;
  once?: boolean;
  execute: (...args: unknown[]) => unknown;
};

// Load configuration
const config = loadConfig();

// Initialize database (async, but don't block startup)
initDatabase()
  .then(() => {
    logger.info('Database initialized successfully');
  })
  .catch((err) => {
    logger.error('Failed to initialize database:', err);
    // Don't exit, database will be created on first use
  });

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Command collection
client.commands = new Collection<string, CommandModule>();

function loadCommandModules(commandsPath: string) {
  let commandFiles: string[] = [];

  try {
    commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
  } catch (error) {
    logger.error(`Failed to read commands directory at ${commandsPath}`, error);
    return;
  }

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const imported = require(filePath) as Partial<CommandModule> & { default?: CommandModule };
      const command = (imported?.default ?? imported) as Partial<CommandModule>;

      if (command?.data && command?.execute) {
        client.commands?.set(command.data.name, command as CommandModule);
        logger.info(`Loaded command: ${command.data.name}`);
      } else {
        logger.warn(`Command at ${filePath} is missing required "data" or "execute" export`);
      }
    } catch (error) {
      logger.error(`Failed to load command at ${filePath}`, error);
    }
  }
}

function loadEventModules(eventsPath: string) {
  let eventFiles: string[] = [];

  try {
    eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
  } catch (error) {
    logger.error(`Failed to read events directory at ${eventsPath}`, error);
    return;
  }

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const event = require(filePath) as EventModule & { default?: EventModule };
      const handler = event?.default ?? event;

      if (!handler?.name || typeof handler?.execute !== 'function') {
        logger.warn(`Event at ${filePath} is missing required "name" or "execute" export`);
        continue;
      }

      if (handler.once) {
        client.once(handler.name, (...args) => handler.execute(...args, client, config));
      } else {
        client.on(handler.name, (...args) => handler.execute(...args, client, config));
      }

      logger.info(`Loaded event: ${handler.name}`);
    } catch (error) {
      logger.error(`Failed to load event at ${filePath}`, error);
    }
  }
}

const commandsPath = path.join(__dirname, 'commands');
const eventsPath = path.join(__dirname, 'events');

loadCommandModules(commandsPath);
loadEventModules(eventsPath);

// Start Web UI with automatic port detection
(async () => {
  const preferredPort = parseInt(process.env.PORT || '8080', 10);
  let port = preferredPort;

  // Check if preferred port is available
  const portAvailable = await isPortAvailable(preferredPort);

  if (!portAvailable) {
    logger.warn(`Port ${preferredPort} is already in use. Searching for an available port...`);
    try {
      port = await findAvailablePort(preferredPort + 1, 20);
      logger.info(`Found available port: ${port}`);

      // Update .env file with the new port
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        try {
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (envContent.match(/^PORT=.*$/m)) {
            envContent = envContent.replace(/^PORT=.*$/m, `PORT=${port}`);
          } else {
            envContent = `${envContent.trim()}\nPORT=${port}\n`;
          }
          fs.writeFileSync(envPath, `${envContent.trim()}\n`, { mode: 0o600 });
          logger.info(`Updated .env file with new port: ${port}`);
        } catch (error) {
          logger.warn('Unable to update PORT value in .env file automatically', error);
        }
      }

      // Check for firewall
      const os = require('os');
      const platform = os.platform();
      let firewallDetected = false;
      let firewallInstructions = '';

      if (platform === 'linux') {
        // Check for UFW
        const { execSync } = require('child_process');
        try {
          execSync('which ufw', { stdio: 'ignore' });
          firewallDetected = true;
          firewallInstructions = `\n\n⚠️  Firewall detected (UFW). Please open port ${port}:\n   sudo ufw allow ${port}/tcp\n   sudo ufw reload\n`;
        } catch {
          // UFW not found, check for firewalld
          try {
            execSync('which firewall-cmd', { stdio: 'ignore' });
            firewallDetected = true;
            firewallInstructions = `\n\n⚠️  Firewall detected (firewalld). Please open port ${port}:\n   sudo firewall-cmd --permanent --add-port=${port}/tcp\n   sudo firewall-cmd --reload\n`;
          } catch {
            // No firewall detected
          }
        }
      }

      if (firewallDetected) {
        logger.warn(firewallInstructions);
        console.log(firewallInstructions);
      }

      logger.warn(
        `\n⚠️  IMPORTANT: Web UI is now running on port ${port} instead of ${preferredPort}`
      );
      logger.warn(`   Access it at: http://localhost:${port} or http://YOUR_SERVER_IP:${port}`);
      if (firewallDetected) {
        logger.warn(`   Make sure to open port ${port} in your firewall!`);
      }
    } catch (error) {
      logger.error(`Failed to find an available port: ${error}`);
      logger.error(`Please manually set PORT in .env to an available port`);
      process.exit(1);
    }
  }

  startWebUI(port, config, client);
})();

// Login to Discord
const token = process.env.DISCORD_TOKEN;
if (!token) {
  logger.error('DISCORD_TOKEN is not set in .env file');
  process.exit(1);
}

const requiredEnvVars = ['CLIENT_ID'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`${envVar} is not set in .env file`);
    process.exit(1);
  }
}

client.login(token).catch((error) => {
  logger.error('Failed to login to Discord:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection detected', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception detected', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});
