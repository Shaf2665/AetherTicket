"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.once = exports.name = void 0;
exports.execute = execute;
const logger_1 = require("../utils/logger");
const configLoader_1 = require("../utils/configLoader");
exports.name = 'interactionCreate';
exports.once = false;
async function execute(interaction, client, _config) {
    if (!interaction.isChatInputCommand())
        return;
    const command = client.commands?.get(interaction.commandName);
    if (!command) {
        logger_1.logger.warn(`No command matching ${interaction.commandName} was found.`);
        return;
    }
    // Reload config on each command execution to pick up WebUI changes
    const config = (0, configLoader_1.loadConfig)();
    try {
        await command.execute(interaction, config);
    }
    catch (error) {
        logger_1.logger.error(`Error executing ${interaction.commandName}:`, error);
        const errorMessage = {
            content: 'There was an error while executing this command!',
            ephemeral: true,
        };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        }
        else {
            await interaction.reply(errorMessage);
        }
    }
}
//# sourceMappingURL=interactionCreate.js.map