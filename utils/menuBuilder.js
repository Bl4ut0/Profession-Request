// utils/menuBuilder.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Builds the standardized menu content and button layout
 * Used by both primaryChannel.js and dmMenu.js for consistency
 * @returns {Object} { content, components }
 */
function buildMainMenu() {
  const config = require('../config/config.js');
  // First row: Manage Requests button (separated, top position)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('action_manage_requests')
      .setLabel('🔨 Manage Requests')
      .setStyle(ButtonStyle.Success)
  );

  // Second row: Primary action buttons (3 buttons in a row)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('action_request')
      .setLabel('🧵 Create New Request')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('action_status')
      .setLabel('📋 My Requests')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('action_manage_characters')
      .setLabel('👤 Manage Characters')
      .setStyle(ButtonStyle.Secondary)
  );

  const content = config.primaryMenuMessage;

  return {
    content,
    components: [row1, row2]
  };
}

module.exports = {
  buildMainMenu
};
