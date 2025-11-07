import { Interaction, Client } from 'discord.js';
import { logger } from '../utils/logger';
import { BotConfig } from '../utils/configLoader';

export const name = 'interactionCreate';
export const once = false;

export async function execute(interaction: Interaction, client: Client, config: BotConfig) {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands?.get(interaction.commandName);

  if (!command) {
    logger.warn(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction, config);
  } catch (error) {
    logger.error(`Error executing ${interaction.commandName}:`, error);

    const errorMessage = {
      content: 'There was an error while executing this command!',
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
}
