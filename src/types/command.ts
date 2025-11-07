import { SlashCommandBuilder, ChatInputCommandInteraction, Awaitable } from 'discord.js';
import { BotConfig } from '../utils/configLoader';

export interface CommandModule {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction, config: BotConfig) => Awaitable<void>;
}
