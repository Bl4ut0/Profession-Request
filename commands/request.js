const { SlashCommandBuilder } = require('discord.js');
const { handleRequestFlow } = require('../interactions/shared/requestFlow');
const log = require('../utils/logWriter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('request')
    .setDescription('Start a new profession/enchant request'),
  
  async execute(interaction, client) {
    try {
      // Kick off the dropdown-based request flow
      await handleRequestFlow(interaction, client);
    } catch (error) {
      log.error('Error in /request:', error);
      
      // Don't try to respond to expired interactions
      if (error.code === 10062) {
        log.debug('Interaction expired during request flow, but operation may have completed');
        return;
      }
      
      // Provide specific error message based on error type
      let errorMessage = '❌ An error occurred while starting your request.';
      if (error.message.includes('Guild not found')) {
        errorMessage = '❌ Bot is not connected to the guild. Please try again later.';
      } else if (error.message.includes('channel')) {
        errorMessage = '❌ Could not create or access the request channel. Please check bot permissions.';
      }
      
      // Only respond if we haven't already
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: errorMessage,
            flags: 1 << 6
          });
        } catch (replyError) {
          if (replyError.code !== 10062) {
            log.error('Failed to send error message:', replyError);
          }
        }
      }
    }
  }
};
