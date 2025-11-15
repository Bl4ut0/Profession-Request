// commands/status.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/database');
const config = require('../config/config.js');
const log = require('../utils/logWriter');
const { resolveResponseChannel } = require('../utils/requestChannel');
const cleanupService = require('../utils/cleanupService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('View pending and recent requests for your characters'),

  async execute(interaction, client) {
    try {
      const userId = interaction.user.id;
      const characters = await db.getCharactersByUser(userId);

      if (!characters || characters.length === 0) {
        return interaction.reply({
          content: '❌ You have no registered characters. Use `/register` in the server (not in DMs).',
          flags: 1 << 6
        });
      }

      const pending = await db.getRequestsByUserId(userId, ['open', 'claimed', 'in_progress']);
      const history = await db.getRequestsByUserId(userId, ['complete', 'denied'], config.requestHistoryLimit);

      const responseChannel = await resolveResponseChannel(interaction, client);
      
      // Schedule cleanup if in channel mode
      if (config.requestMode === 'channel') {
        cleanupService.scheduleChannelDeletion(responseChannel);
      }

      let content = `📦 **Pending Requests:**\n`;

      if (pending.length === 0) {
        content += `No pending requests.\n`;
      } else {
        for (const req of pending) {
          content += `• ${req.character} — ${req.request_name} to ${req.gear_slot} (${req.status}`;
          if (req.claimed_by_name) content += ` by ${req.claimed_by_name}`;
          content += `)\n`;
        }
      }

      content += `\n📜 **Recent Completed or Denied Requests:**\n`;
      if (history.length === 0) {
        content += `No recent history.`;
      } else {
        for (const req of history) {
          const emoji = req.status === 'complete' ? '✅' : '🚫';
          content += `• ${emoji} ${req.character} — ${req.request_name} to ${req.gear_slot}`;
          if (req.status === 'complete') {
            content += ` (by ${req.claimed_by_name})`;
          } else if (req.status === 'denied') {
            content += ` — Reason: ${req.deny_reason || 'No reason provided'}`;
          }
          content += `\n`;
        }
      }

      await responseChannel.send({ content });
      
      // Reply with navigation
      const confirmation = config.requestMode === 'dm'
        ? '✅ I\'ve sent your status via DM—please check your direct messages.'
        : `✅ Your status is in <#${responseChannel.id}>.`;
      
      await interaction.reply({ content: confirmation, flags: 1 << 6 });
    } catch (error) {
      log.error('Error in /status:', error);
      const errorMessage = error.message.includes('channel')
        ? '❌ Could not create status channel. Check bot permissions.'
        : '❌ An error occurred while retrieving your status.';
      
      await interaction.reply({ content: errorMessage, flags: 1 << 6 });
    }
  }
};
