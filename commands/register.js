const { SlashCommandBuilder } = require('discord.js');
const { handleCharacterManagement } = require('../interactions/shared/characterFlow');
const log = require('../utils/logWriter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Manage your characters (register, view, delete)'),

  async execute(interaction, client) {
    try {
      // Trigger the character management flow
      await handleCharacterManagement(interaction, client);
    } catch (error) {
      log.error('Error in /register:', error);
      return interaction.reply({
        content: '❌ An error occurred while opening character management.',
        flags: 1 << 6
      });
    }
  }
};
