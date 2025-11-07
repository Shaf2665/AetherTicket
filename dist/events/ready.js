"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.once = exports.name = void 0;
exports.execute = execute;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const discord_js_1 = require("discord.js");
const logger_1 = require("../utils/logger");
exports.name = 'ready';
exports.once = true;
async function execute(_readyClient, client, config) {
    logger_1.logger.info(`Logged in as ${client.user?.tag}!`);
    // Set bot name and avatar
    try {
        if (config.botName && client.user) {
            await client.user.setUsername(config.botName);
            logger_1.logger.info(`Bot name set to: ${config.botName}`);
        }
        if (config.avatar && fs_1.default.existsSync(config.avatar)) {
            const avatarPath = path_1.default.resolve(config.avatar);
            await client.user?.setAvatar(avatarPath);
            logger_1.logger.info(`Bot avatar updated from: ${config.avatar}`);
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to set bot name/avatar:', error);
    }
    // Register slash commands
    const registeredCommands = Array.from(client.commands?.values() ?? []);
    const commands = registeredCommands.map((command) => command.data.toJSON());
    const rest = new discord_js_1.REST().setToken(process.env.DISCORD_TOKEN);
    try {
        logger_1.logger.info(`Started refreshing ${commands.length} application (/) commands.`);
        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;
        if (guildId) {
            // Register commands for specific guild (faster)
            await rest.put(discord_js_1.Routes.applicationGuildCommands(clientId, guildId), { body: commands });
            logger_1.logger.info(`Successfully reloaded ${commands.length} application (/) commands for guild ${guildId}.`);
        }
        else {
            // Register commands globally (takes up to 1 hour)
            await rest.put(discord_js_1.Routes.applicationCommands(clientId), { body: commands });
            logger_1.logger.info(`Successfully reloaded ${commands.length} application (/) commands globally.`);
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to register commands:', error);
    }
    // Set bot activity
    client.user?.setActivity('Managing tickets', { type: discord_js_1.ActivityType.Watching });
    logger_1.logger.info('AetherTicket ready!');
}
//# sourceMappingURL=ready.js.map