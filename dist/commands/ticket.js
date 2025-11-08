"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const database_1 = require("../utils/database");
const logger_1 = require("../utils/logger");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket management commands')
    .addSubcommand((subcommand) => subcommand.setName('create').setDescription('Create a new support ticket'))
    .addSubcommand((subcommand) => subcommand.setName('close').setDescription('Close the current ticket'))
    .addSubcommand((subcommand) => subcommand
    .setName('add')
    .setDescription('Add a user to the current ticket')
    .addUserOption((option) => option.setName('user').setDescription('The user to add to the ticket').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('info').setDescription('Get information about the current ticket'));
async function execute(interaction, config) {
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
            let category = guild.channels.cache.find((ch) => ch.type === discord_js_1.ChannelType.GuildCategory && ch.name === config.ticketCategory);
            if (!category) {
                category = await guild.channels.create({
                    name: config.ticketCategory,
                    type: discord_js_1.ChannelType.GuildCategory,
                });
                logger_1.logger.info(`Created ticket category: ${config.ticketCategory}`);
            }
            // Check if user already has an open ticket (check both cache and database)
            const existingTicket = guild.channels.cache.find((ch) => ch.type === discord_js_1.ChannelType.GuildText &&
                ch.name === `ticket-${user.id}` &&
                ch.parentId === category.id);
            if (existingTicket) {
                // Also check database to ensure it's a valid ticket
                try {
                    const ticketInfo = await (0, database_1.getTicketInfo)(existingTicket.id);
                    if (ticketInfo && !ticketInfo.closed_at) {
                        await interaction.reply({
                            content: `You already have an open ticket: ${existingTicket}`,
                            ephemeral: true,
                        });
                        return;
                    }
                }
                catch (error) {
                    logger_1.logger.warn('Failed to check ticket in database, proceeding with cache check:', error);
                }
            }
            // Create ticket channel
            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.id}`,
                type: discord_js_1.ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [discord_js_1.PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: user.id,
                        allow: [
                            discord_js_1.PermissionFlagsBits.ViewChannel,
                            discord_js_1.PermissionFlagsBits.SendMessages,
                            discord_js_1.PermissionFlagsBits.ReadMessageHistory,
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
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Support Ticket Created')
                .setDescription(`Hello ${user}, welcome to your support ticket!\n\nPlease describe your issue and a staff member will assist you shortly.`)
                .setFooter({ text: config.footerText })
                .setTimestamp();
            await ticketChannel.send({ embeds: [embed] });
            await ticketChannel.send(`<@${user.id}>`);
            // Log to database (handle errors gracefully)
            try {
                await (0, database_1.createTicket)(ticketChannel.id, user.id);
                logger_1.logger.info(`Ticket created: ${ticketChannel.id} for user ${user.id}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to create ticket record in database: ${error}`);
                // Continue anyway - the channel was created successfully
                // The ticket can still be used, but won't be tracked in the database
            }
            await interaction.reply({
                content: `Ticket created: ${ticketChannel}`,
                ephemeral: true,
            });
        }
        else if (subcommand === 'close') {
            const channel = interaction.channel;
            if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
                await interaction.reply({
                    content: 'This command can only be used in a ticket channel!',
                    ephemeral: true,
                });
                return;
            }
            const textChannel = channel;
            // Check if this is a ticket channel (check database first, then fallback to name pattern)
            let ticketInfo;
            try {
                ticketInfo = await (0, database_1.getTicketInfo)(textChannel.id);
            }
            catch (error) {
                logger_1.logger.warn('Failed to check ticket in database, using fallback check:', error);
            }
            // Fallback: check if channel name matches ticket pattern
            if (!ticketInfo && textChannel.name.startsWith('ticket-')) {
                // Try to extract user ID from channel name
                const userIdMatch = textChannel.name.match(/^ticket-(\d+)$/);
                if (userIdMatch) {
                    // This looks like a ticket channel, create a record if it doesn't exist
                    try {
                        await (0, database_1.createTicket)(textChannel.id, userIdMatch[1]);
                        ticketInfo = await (0, database_1.getTicketInfo)(textChannel.id);
                        logger_1.logger.info(`Created missing ticket record for channel: ${textChannel.id}`);
                    }
                    catch (error) {
                        logger_1.logger.warn('Failed to create ticket record for existing channel:', error);
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
                const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
                const permissions = textChannel.permissionsFor(botMember);
                if (permissions && permissions.has(discord_js_1.PermissionFlagsBits.ReadMessageHistory)) {
                    const messages = await textChannel.messages.fetch({ limit: 100 });
                    transcript = messages
                        .map((msg) => `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content}`)
                        .reverse()
                        .join('\n');
                }
                else {
                    logger_1.logger.warn(`Bot does not have permission to read message history in channel ${textChannel.id}`);
                    transcript = 'Transcript unavailable: Bot does not have permission to read message history.';
                }
            }
            catch (error) {
                logger_1.logger.error(`Failed to fetch messages for transcript: ${error}`);
                transcript = 'Transcript unavailable: Failed to fetch messages.';
            }
            // Create closing embed
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Ticket Closed')
                .setDescription('This ticket has been closed. The channel will be deleted in 5 seconds.')
                .setFooter({ text: config.footerText })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            // Close ticket in database (handle errors gracefully)
            try {
                await (0, database_1.closeTicket)(textChannel.id, transcript);
                logger_1.logger.info(`Ticket closed: ${textChannel.id}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to close ticket in database: ${error}`);
                // Continue anyway - the channel will still be deleted
            }
            // Delete channel after delay
            setTimeout(async () => {
                try {
                    // Check if bot has permission to delete the channel
                    const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
                    const permissions = textChannel.permissionsFor(botMember);
                    if (permissions && permissions.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
                        await textChannel.delete('Ticket closed');
                        logger_1.logger.info(`Ticket channel deleted: ${textChannel.id}`);
                    }
                    else {
                        logger_1.logger.error(`Bot does not have permission to delete channel ${textChannel.id}`);
                        // Send a message to the channel instead
                        try {
                            await textChannel.send('⚠️ This ticket has been closed. Please delete this channel manually or grant the bot permission to delete channels.');
                        }
                        catch (sendError) {
                            logger_1.logger.error('Failed to send fallback message:', sendError);
                        }
                    }
                }
                catch (error) {
                    logger_1.logger.error('Failed to delete ticket channel:', error);
                    // Try to send a message as fallback
                    try {
                        await textChannel.send('⚠️ This ticket has been closed. Please delete this channel manually.');
                    }
                    catch (sendError) {
                        logger_1.logger.error('Failed to send fallback message:', sendError);
                    }
                }
            }, 5000);
        }
        else if (subcommand === 'add') {
            const channel = interaction.channel;
            if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
                await interaction.reply({
                    content: 'This command can only be used in a ticket channel!',
                    ephemeral: true,
                });
                return;
            }
            const textChannel = channel;
            const userToAdd = interaction.options.getUser('user', true);
            // Check if this is a ticket channel (check database first, then fallback to name pattern)
            let ticketInfo;
            try {
                ticketInfo = await (0, database_1.getTicketInfo)(textChannel.id);
            }
            catch (error) {
                logger_1.logger.warn('Failed to check ticket in database, using fallback check:', error);
            }
            // Fallback: check if channel name matches ticket pattern
            if (!ticketInfo && textChannel.name.startsWith('ticket-')) {
                const userIdMatch = textChannel.name.match(/^ticket-(\d+)$/);
                if (userIdMatch) {
                    try {
                        await (0, database_1.createTicket)(textChannel.id, userIdMatch[1]);
                        ticketInfo = await (0, database_1.getTicketInfo)(textChannel.id);
                        logger_1.logger.info(`Created missing ticket record for channel: ${textChannel.id}`);
                    }
                    catch (error) {
                        logger_1.logger.warn('Failed to create ticket record for existing channel:', error);
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
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('User Added to Ticket')
                .setDescription(`${userToAdd} has been added to this ticket.`)
                .setFooter({ text: config.footerText })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await textChannel.send(`<@${userToAdd.id}> has been added to this ticket.`);
            logger_1.logger.info(`User ${userToAdd.id} added to ticket ${textChannel.id}`);
        }
        else if (subcommand === 'info') {
            const channel = interaction.channel;
            if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
                await interaction.reply({
                    content: 'This command can only be used in a ticket channel!',
                    ephemeral: true,
                });
                return;
            }
            const textChannel = channel;
            // Get ticket info from database (check database first, then fallback to name pattern)
            let ticketInfo;
            try {
                ticketInfo = await (0, database_1.getTicketInfo)(textChannel.id);
            }
            catch (error) {
                logger_1.logger.warn('Failed to check ticket in database, using fallback check:', error);
            }
            // Fallback: check if channel name matches ticket pattern
            if (!ticketInfo && textChannel.name.startsWith('ticket-')) {
                const userIdMatch = textChannel.name.match(/^ticket-(\d+)$/);
                if (userIdMatch) {
                    try {
                        await (0, database_1.createTicket)(textChannel.id, userIdMatch[1]);
                        ticketInfo = await (0, database_1.getTicketInfo)(textChannel.id);
                        logger_1.logger.info(`Created missing ticket record for channel: ${textChannel.id}`);
                    }
                    catch (error) {
                        logger_1.logger.warn('Failed to create ticket record for existing channel:', error);
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
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Ticket Information')
                .addFields({ name: 'Ticket ID', value: ticketInfo.id.toString(), inline: true }, { name: 'Channel ID', value: ticketInfo.channel_id, inline: true }, { name: 'Created By', value: `${user.tag} (${user.id})`, inline: false }, {
                name: 'Created At',
                value: new Date(ticketInfo.created_at).toLocaleString(),
                inline: true,
            }, { name: 'Status', value: ticketInfo.closed_at ? 'Closed' : 'Open', inline: true })
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
    }
    catch (error) {
        logger_1.logger.error(`Failed to execute ticket ${subcommand}:`, error);
        await interaction.reply({
            content: 'An error occurred while executing this command. Please try again later.',
            ephemeral: true,
        });
    }
}
//# sourceMappingURL=ticket.js.map