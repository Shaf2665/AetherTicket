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
import { createTicket, closeTicket, getTicketInfo, TicketRecord } from '../utils/database';
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

      // Check if user already has an open ticket (check both cache and database)
      const existingTicket = guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          ch.name === `ticket-${user.id}` &&
          ch.parentId === category.id
      );

      if (existingTicket) {
        // Also check database to ensure it's a valid ticket
        try {
          const ticketInfo = await getTicketInfo(existingTicket.id);
          if (ticketInfo && !ticketInfo.closed_at) {
            await interaction.reply({
              content: `You already have an open ticket: ${existingTicket}`,
              ephemeral: true,
            });
            return;
          }
        } catch (error) {
          logger.warn('Failed to check ticket in database, proceeding with cache check:', error);
        }
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

      // Log to database (handle errors gracefully)
      try {
        await createTicket(ticketChannel.id, user.id);
        logger.info(`Ticket created: ${ticketChannel.id} for user ${user.id}`);
      } catch (error) {
        logger.error(`Failed to create ticket record in database: ${error}`);
        // Continue anyway - the channel was created successfully
        // The ticket can still be used, but won't be tracked in the database
      }

      await interaction.reply({
        content: `Ticket created: ${ticketChannel}`,
        ephemeral: true,
      });
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

      // Check if this is a ticket channel (check database first, then fallback to name pattern)
      let ticketInfo: TicketRecord | undefined;
      try {
        ticketInfo = await getTicketInfo(textChannel.id);
      } catch (error) {
        logger.warn('Failed to check ticket in database, using fallback check:', error);
      }

      // Fallback: check if channel name matches ticket pattern
      if (!ticketInfo && textChannel.name.startsWith('ticket-')) {
        // Try to extract user ID from channel name
        const userIdMatch = textChannel.name.match(/^ticket-(\d+)$/);
        if (userIdMatch) {
          // This looks like a ticket channel, create a record if it doesn't exist
          try {
            await createTicket(textChannel.id, userIdMatch[1]);
            ticketInfo = await getTicketInfo(textChannel.id);
            logger.info(`Created missing ticket record for channel: ${textChannel.id}`);
          } catch (error) {
            logger.warn('Failed to create ticket record for existing channel:', error);
          }
        }
      }

      if (!ticketInfo) {
        await interaction.reply({
          content: 'This is not a ticket channel!',
          ephemeral: true,
        });
        return;
      }

      // Get channel messages for transcript (check permissions first)
      let transcript = '';
      try {
        // Check if bot has permission to read message history
        const botMember = await interaction.guild.members.fetch(interaction.client.user!.id);
        const permissions = textChannel.permissionsFor(botMember);
        
        if (permissions && permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
          const messages = await textChannel.messages.fetch({ limit: 100 });
          transcript = messages
            .map((msg) => `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content}`)
            .reverse()
            .join('\n');
        } else {
          logger.warn(`Bot does not have permission to read message history in channel ${textChannel.id}`);
          transcript = 'Transcript unavailable: Bot does not have permission to read message history.';
        }
      } catch (error) {
        logger.error(`Failed to fetch messages for transcript: ${error}`);
        transcript = 'Transcript unavailable: Failed to fetch messages.';
      }

      // Create closing embed
      const embed = new EmbedBuilder()
        .setColor(config.embedColor as ColorResolvable)
        .setTitle('Ticket Closed')
        .setDescription('This ticket has been closed. The channel will be deleted in 5 seconds.')
        .setFooter({ text: config.footerText })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Close ticket in database (handle errors gracefully)
      try {
        await closeTicket(textChannel.id, transcript);
        logger.info(`Ticket closed: ${textChannel.id}`);
      } catch (error) {
        logger.error(`Failed to close ticket in database: ${error}`);
        // Continue anyway - the channel will still be deleted
      }

      // Delete channel after delay
      setTimeout(async () => {
        try {
          // Check if bot has permission to delete the channel
          const botMember = await interaction.guild!.members.fetch(interaction.client.user!.id);
          const permissions = textChannel.permissionsFor(botMember);
          
          if (permissions && permissions.has(PermissionFlagsBits.ManageChannels)) {
            await textChannel.delete('Ticket closed');
            logger.info(`Ticket channel deleted: ${textChannel.id}`);
          } else {
            logger.error(`Bot does not have permission to delete channel ${textChannel.id}`);
            // Send a message to the channel instead
            try {
              await textChannel.send('⚠️ This ticket has been closed. Please delete this channel manually or grant the bot permission to delete channels.');
            } catch (sendError) {
              logger.error('Failed to send fallback message:', sendError);
            }
          }
        } catch (error) {
          logger.error('Failed to delete ticket channel:', error);
          // Try to send a message as fallback
          try {
            await textChannel.send('⚠️ This ticket has been closed. Please delete this channel manually.');
          } catch (sendError) {
            logger.error('Failed to send fallback message:', sendError);
          }
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

      // Check if this is a ticket channel (check database first, then fallback to name pattern)
      let ticketInfo: TicketRecord | undefined;
      try {
        ticketInfo = await getTicketInfo(textChannel.id);
      } catch (error) {
        logger.warn('Failed to check ticket in database, using fallback check:', error);
      }

      // Fallback: check if channel name matches ticket pattern
      if (!ticketInfo && textChannel.name.startsWith('ticket-')) {
        const userIdMatch = textChannel.name.match(/^ticket-(\d+)$/);
        if (userIdMatch) {
          try {
            await createTicket(textChannel.id, userIdMatch[1]);
            ticketInfo = await getTicketInfo(textChannel.id);
            logger.info(`Created missing ticket record for channel: ${textChannel.id}`);
          } catch (error) {
            logger.warn('Failed to create ticket record for existing channel:', error);
          }
        }
      }

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

      // Get ticket info from database (check database first, then fallback to name pattern)
      let ticketInfo: TicketRecord | undefined;
      try {
        ticketInfo = await getTicketInfo(textChannel.id);
      } catch (error) {
        logger.warn('Failed to check ticket in database, using fallback check:', error);
      }

      // Fallback: check if channel name matches ticket pattern
      if (!ticketInfo && textChannel.name.startsWith('ticket-')) {
        const userIdMatch = textChannel.name.match(/^ticket-(\d+)$/);
        if (userIdMatch) {
          try {
            await createTicket(textChannel.id, userIdMatch[1]);
            ticketInfo = await getTicketInfo(textChannel.id);
            logger.info(`Created missing ticket record for channel: ${textChannel.id}`);
          } catch (error) {
            logger.warn('Failed to create ticket record for existing channel:', error);
          }
        }
      }

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
