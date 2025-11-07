import fs from 'fs';
import path from 'path';
import { Client, REST, Routes, ActivityType } from 'discord.js';
import { logger } from '../utils/logger';
import { BotConfig } from '../utils/configLoader';
import type { CommandModule } from '../types/command';

export const name = 'ready';
export const once = true;

export async function execute(_readyClient: Client, client: Client, config: BotConfig) {
  logger.info(`Logged in as ${client.user?.tag}!`);

  // Set bot name and avatar
  try {
    if (config.botName && client.user) {
      await client.user.setUsername(config.botName);
      logger.info(`Bot name set to: ${config.botName}`);
    }

    if (config.avatar && fs.existsSync(config.avatar)) {
      const avatarPath = path.resolve(config.avatar);
      await client.user?.setAvatar(avatarPath);
      logger.info(`Bot avatar updated from: ${config.avatar}`);
    }
  } catch (error) {
    logger.error('Failed to set bot name/avatar:', error);
  }

  // Register slash commands
  const registeredCommands = Array.from(client.commands?.values() ?? []);
  const commands = registeredCommands.map((command: CommandModule) => command.data.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

  try {
    logger.info(`Started refreshing ${commands.length} application (/) commands.`);

    const clientId = process.env.CLIENT_ID!;
    const guildId = process.env.GUILD_ID;

    if (guildId) {
      // Register commands for specific guild (faster)
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      logger.info(
        `Successfully reloaded ${commands.length} application (/) commands for guild ${guildId}.`
      );
    } else {
      // Register commands globally (takes up to 1 hour)
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      logger.info(`Successfully reloaded ${commands.length} application (/) commands globally.`);
    }
  } catch (error) {
    logger.error('Failed to register commands:', error);
  }

  // Set bot activity
  client.user?.setActivity('Managing tickets', { type: ActivityType.Watching });

  logger.info('AetherTicket ready!');
}
