import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  ColorResolvable,
  ChannelType,
  TextChannel,
} from 'discord.js';
import { BotConfig } from '../utils/configLoader';
import { createTicket, closeTicket, getTicketInfo } from '../utils/database';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket management commands')
  .addSubcommand((subcommand) =>
    subcommand.setName('create').setDescription('Create a new support ticket')
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('close').setDescription('Close the current ticket')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add')
      .setDescription('Add a user to the current ticket')
      .addUserOption((option) =>
        option.setName('user').setDescription('The user to add to the ticket').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('info').setDescription('Get information about the current ticket')
  );

export async function execute(interaction: ChatInputCommandInteraction, config: BotConfig) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server!',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === 'create') {
      const user = interaction.user;
      const guild = interaction.guild;

      // Find or create ticket category
      let category = guild.channels.cache.find(
        (ch) => ch.type === ChannelType.GuildCategory && ch.name === config.ticketCategory
      );

      if (!category) {
        category = await guild.channels.create({
          name: config.ticketCategory,
          type: ChannelType.GuildCategory,
        });
        logger.info(`Created ticket category: ${config.ticketCategory}`);
      }

      // Check if user already has an open ticket
      const existingTicket = guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          ch.name === `ticket-${user.id}` &&
          ch.parentId === category.id
      );

      if (existingTicket) {
        await interaction.reply({
          content: `You already have an open ticket: ${existingTicket}`,
          ephemeral: true,
        });
        return;
      }

      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: `ticket-${user.id}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });

      // Add support role if it exists
      const supportRole = guild.roles.cache.find((role) => role.name === config.supportRole);
      if (supportRole) {
        await ticketChannel.permissionOverwrites.edit(supportRole, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }

      // Create welcome embed
      const embed = new EmbedBuilder()
        .setColor(config.embedColor as ColorResolvable)
        .setTitle('Support Ticket Created')
        .setDescription(
          `Hello ${user}, welcome to your support ticket!\n\nPlease describe your issue and a staff member will assist you shortly.`
        )
        .setFooter({ text: config.footerText })
        .setTimestamp();

      await ticketChannel.send({ embeds: [embed] });
      await ticketChannel.send(`<@${user.id}>`);

      // Log to database
      await createTicket(ticketChannel.id, user.id);

      await interaction.reply({
        content: `Ticket created: ${ticketChannel}`,
        ephemeral: true,
      });

      logger.info(`Ticket created: ${ticketChannel.id} for user ${user.id}`);
    } else if (subcommand === 'close') {
      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'This command can only be used in a ticket channel!',
          ephemeral: true,
        });
        return;
      }

      const textChannel = channel as TextChannel;

      // Check if this is a ticket channel
      const ticketInfo = await getTicketInfo(textChannel.id);
      if (!ticketInfo) {
        await interaction.reply({
          content: 'This is not a ticket channel!',
          ephemeral: true,
        });
        return;
      }

      // Get channel messages for transcript
      const messages = await textChannel.messages.fetch({ limit: 100 });
      const transcript = messages
        .map((msg) => `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content}`)
        .reverse()
        .join('\n');

      // Create closing embed
      const embed = new EmbedBuilder()
        .setColor(config.embedColor as ColorResolvable)
        .setTitle('Ticket Closed')
        .setDescription('This ticket has been closed. The channel will be deleted in 5 seconds.')
        .setFooter({ text: config.footerText })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Close ticket in database
      await closeTicket(textChannel.id, transcript);

      logger.info(`Ticket closed: ${textChannel.id}`);

      // Delete channel after delay
      setTimeout(async () => {
        try {
          await textChannel.delete();
        } catch (error) {
          logger.error('Failed to delete ticket channel:', error);
        }
      }, 5000);
    } else if (subcommand === 'add') {
      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'This command can only be used in a ticket channel!',
          ephemeral: true,
        });
        return;
      }

      const textChannel = channel as TextChannel;
      const userToAdd = interaction.options.getUser('user', true);

      // Check if this is a ticket channel
      const ticketInfo = await getTicketInfo(textChannel.id);
      if (!ticketInfo) {
        await interaction.reply({
          content: 'This is not a ticket channel!',
          ephemeral: true,
        });
        return;
      }

      // Add user to channel
      await textChannel.permissionOverwrites.edit(userToAdd, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(config.embedColor as ColorResolvable)
        .setTitle('User Added to Ticket')
        .setDescription(`${userToAdd} has been added to this ticket.`)
        .setFooter({ text: config.footerText })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      await textChannel.send(`<@${userToAdd.id}> has been added to this ticket.`);

      logger.info(`User ${userToAdd.id} added to ticket ${textChannel.id}`);
    } else if (subcommand === 'info') {
      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'This command can only be used in a ticket channel!',
          ephemeral: true,
        });
        return;
      }

      const textChannel = channel as TextChannel;

      // Get ticket info from database
      const ticketInfo = await getTicketInfo(textChannel.id);
      if (!ticketInfo) {
        await interaction.reply({
          content: 'This is not a ticket channel!',
          ephemeral: true,
        });
        return;
      }

      // Get user from ticket
      const user = await interaction.client.users.fetch(ticketInfo.user_id);

      // Create info embed
      const embed = new EmbedBuilder()
        .setColor(config.embedColor as ColorResolvable)
        .setTitle('Ticket Information')
        .addFields(
          { name: 'Ticket ID', value: ticketInfo.id.toString(), inline: true },
          { name: 'Channel ID', value: ticketInfo.channel_id, inline: true },
          { name: 'Created By', value: `${user.tag} (${user.id})`, inline: false },
          {
            name: 'Created At',
            value: new Date(ticketInfo.created_at).toLocaleString(),
            inline: true,
          },
          { name: 'Status', value: ticketInfo.closed_at ? 'Closed' : 'Open', inline: true }
        )
        .setFooter({ text: config.footerText })
        .setTimestamp();

      if (ticketInfo.closed_at) {
        embed.addFields({
          name: 'Closed At',
          value: new Date(ticketInfo.closed_at).toLocaleString(),
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    logger.error(`Failed to execute ticket ${subcommand}:`, error);
    await interaction.reply({
      content: 'An error occurred while executing this command. Please try again later.',
      ephemeral: true,
    });
  }
}
