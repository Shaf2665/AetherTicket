"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const configLoader_1 = require("./utils/configLoader");
const logger_1 = require("./utils/logger");
const server_1 = require("./webui/server");
const database_1 = require("./utils/database");
const portFinder_1 = require("./utils/portFinder");
// Load configuration
const config = (0, configLoader_1.loadConfig)();
// Initialize database (async, but don't block startup)
(0, database_1.initDatabase)()
    .then(() => {
    logger_1.logger.info('Database initialized successfully');
})
    .catch((err) => {
    logger_1.logger.error('Failed to initialize database:', err);
    // Don't exit, database will be created on first use
});
// Initialize Discord client
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent,
    ],
    partials: [discord_js_1.Partials.Channel],
});
// Command collection
client.commands = new discord_js_1.Collection();
function loadCommandModules(commandsPath) {
    let commandFiles = [];
    try {
        commandFiles = fs_1.default.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
    }
    catch (error) {
        logger_1.logger.error(`Failed to read commands directory at ${commandsPath}`, error);
        return;
    }
    for (const file of commandFiles) {
        const filePath = path_1.default.join(commandsPath, file);
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
            const imported = require(filePath);
            const command = (imported?.default ?? imported);
            if (command?.data && command?.execute) {
                client.commands?.set(command.data.name, command);
                logger_1.logger.info(`Loaded command: ${command.data.name}`);
            }
            else {
                logger_1.logger.warn(`Command at ${filePath} is missing required "data" or "execute" export`);
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to load command at ${filePath}`, error);
        }
    }
}
function loadEventModules(eventsPath) {
    let eventFiles = [];
    try {
        eventFiles = fs_1.default.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
    }
    catch (error) {
        logger_1.logger.error(`Failed to read events directory at ${eventsPath}`, error);
        return;
    }
    for (const file of eventFiles) {
        const filePath = path_1.default.join(eventsPath, file);
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
            const event = require(filePath);
            const handler = event?.default ?? event;
            if (!handler?.name || typeof handler?.execute !== 'function') {
                logger_1.logger.warn(`Event at ${filePath} is missing required "name" or "execute" export`);
                continue;
            }
            if (handler.once) {
                client.once(handler.name, (...args) => handler.execute(...args, client, config));
            }
            else {
                client.on(handler.name, (...args) => handler.execute(...args, client, config));
            }
            logger_1.logger.info(`Loaded event: ${handler.name}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to load event at ${filePath}`, error);
        }
    }
}
const commandsPath = path_1.default.join(__dirname, 'commands');
const eventsPath = path_1.default.join(__dirname, 'events');
loadCommandModules(commandsPath);
loadEventModules(eventsPath);
// Start Web UI with automatic port detection
(async () => {
    const preferredPort = parseInt(process.env.PORT || '8080', 10);
    let port = preferredPort;
    // Check if preferred port is available
    const portAvailable = await (0, portFinder_1.isPortAvailable)(preferredPort);
    if (!portAvailable) {
        logger_1.logger.warn(`Port ${preferredPort} is already in use. Searching for an available port...`);
        try {
            port = await (0, portFinder_1.findAvailablePort)(preferredPort + 1, 20);
            logger_1.logger.info(`Found available port: ${port}`);
            // Update .env file with the new port
            const envPath = path_1.default.join(process.cwd(), '.env');
            if (fs_1.default.existsSync(envPath)) {
                try {
                    let envContent = fs_1.default.readFileSync(envPath, 'utf8');
                    if (envContent.match(/^PORT=.*$/m)) {
                        envContent = envContent.replace(/^PORT=.*$/m, `PORT=${port}`);
                    }
                    else {
                        envContent = `${envContent.trim()}\nPORT=${port}\n`;
                    }
                    fs_1.default.writeFileSync(envPath, `${envContent.trim()}\n`, { mode: 0o600 });
                    logger_1.logger.info(`Updated .env file with new port: ${port}`);
                }
                catch (error) {
                    logger_1.logger.warn('Unable to update PORT value in .env file automatically', error);
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
                }
                catch {
                    // UFW not found, check for firewalld
                    try {
                        execSync('which firewall-cmd', { stdio: 'ignore' });
                        firewallDetected = true;
                        firewallInstructions = `\n\n⚠️  Firewall detected (firewalld). Please open port ${port}:\n   sudo firewall-cmd --permanent --add-port=${port}/tcp\n   sudo firewall-cmd --reload\n`;
                    }
                    catch {
                        // No firewall detected
                    }
                }
            }
            if (firewallDetected) {
                logger_1.logger.warn(firewallInstructions);
                console.log(firewallInstructions);
            }
            logger_1.logger.warn(`\n⚠️  IMPORTANT: Web UI is now running on port ${port} instead of ${preferredPort}`);
            logger_1.logger.warn(`   Access it at: http://localhost:${port} or http://YOUR_SERVER_IP:${port}`);
            if (firewallDetected) {
                logger_1.logger.warn(`   Make sure to open port ${port} in your firewall!`);
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to find an available port: ${error}`);
            logger_1.logger.error(`Please manually set PORT in .env to an available port`);
            process.exit(1);
        }
    }
    (0, server_1.startWebUI)(port, config, client);
})();
// Login to Discord
const token = process.env.DISCORD_TOKEN;
if (!token) {
    logger_1.logger.error('DISCORD_TOKEN is not set in .env file');
    process.exit(1);
}
const requiredEnvVars = ['CLIENT_ID'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        logger_1.logger.error(`${envVar} is not set in .env file`);
        process.exit(1);
    }
}
client.login(token).catch((error) => {
    logger_1.logger.error('Failed to login to Discord:', error);
    process.exit(1);
});
// Graceful shutdown
process.on('SIGINT', () => {
    logger_1.logger.info('Shutting down gracefully...');
    client.destroy();
    process.exit(0);
});
process.on('unhandledRejection', (error) => {
    logger_1.logger.error('Unhandled promise rejection detected', error);
});
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught exception detected', error);
    process.exit(1);
});
process.on('SIGTERM', () => {
    logger_1.logger.info('Shutting down gracefully...');
    client.destroy();
    process.exit(0);
});
//# sourceMappingURL=index.js.map